import type { SyncConflict, SyncResult, SyncedSettings, Task, TaskFolder, TaskList } from './types'
import type { CacheStore, SyncMeta } from './cacheStore'
import { GitHubConflictError, commitNewFiles, deleteFile, getDataTree, getFileContent, putFile } from './github'

/**
 * Manual, bidirectional sync: push everything queued locally, then pull everything new
 * from GitHub. Runs push-before-pull so a device that has been offline always tries to
 * land its own edits first; anything that lost the race comes back as a conflict rather
 * than silently overwriting someone else's change.
 *
 * Conflict policy (deliberately simple, scoped to what was asked for):
 *  - Task edited on both sides differently -> surfaced as a SyncConflict for the user to resolve. Until it is
 *    resolved the task is neither pushed nor pulled.
 *  - Task deleted locally but edited remotely -> the remote edit wins, local deletion is dropped.
 *  - Task edited locally but deleted remotely -> the local edit wins, file is recreated on push.
 *  - lists.json / folders.json / settings.json (single shared files) -> last writer to sync wins;
 *    a losing local edit is discarded in favor of pulling the current remote copy.
 *
 * The user can keep editing while a sync runs (and auto-sync makes that common), so the sync never holds the
 * metadata across a network call: every change to it is a synchronous read-modify-write, and a dirty mark is only
 * cleared if what was pushed is still what the cache holds.
 *
 * Environment-agnostic: the cache is passed in (disk on desktop, memory + IndexedDB on Android).
 */
export async function syncNow(cache: CacheStore, token: string, owner: string, repo: string, branch: string): Promise<SyncResult> {
  const conflicts: SyncConflict[] = []
  let pushed = 0
  let pulled = 0

  const update = (change: (meta: SyncMeta) => void): void => {
    const meta = cache.getSyncMeta()
    change(meta)
    cache.writeSyncMeta(meta)
  }
  const setSha = (path: string, sha: string | undefined): void =>
    update((m) => {
      if (sha) m.fileShas[path] = sha
      else delete m.fileShas[path]
    })
  /** Records a pushed task. It stays dirty if it was edited again while the push was in flight. */
  const taskPushed = (task: Task, content: string, sha: string): void => {
    cache.setSyncedTask(task)
    const current = cache.getTask(task.id)
    const unchanged = current !== null && serialize(current) === content
    update((m) => {
      m.fileShas[taskPath(task.id)] = sha
      if (unchanged) m.dirtyTaskIds = m.dirtyTaskIds.filter((x) => x !== task.id)
    })
  }

  try {
    // ---- Phase 1 (bulk): many new tasks at once (an import) go up as one commit ----
    const start = cache.getSyncMeta()
    const newTasks = start.dirtyTaskIds
      .filter((id) => !start.fileShas[taskPath(id)] && !start.conflictTaskIds.includes(id))
      .map((id) => cache.getTask(id))
      .filter((t): t is Task => t !== null)
    if (newTasks.length >= BATCH_THRESHOLD) {
      const files = newTasks.map((t) => ({ path: taskPath(t.id), content: serialize(t) }))
      const shas = await commitNewFiles(token, owner, repo, branch, files, `Add ${newTasks.length} tasks`)
      // null = couldn't batch safely; the per-file loop below pushes them and handles any conflict.
      if (shas) {
        newTasks.forEach((task, i) => {
          const sha = shas.get(files[i].path)
          if (!sha) return
          taskPushed(task, files[i].content, sha)
          pushed++
        })
      }
    }

    // ---- Phase 1: push local task edits ----
    for (const id of cache.getSyncMeta().dirtyTaskIds) {
      const meta = cache.getSyncMeta()
      if (!meta.dirtyTaskIds.includes(id)) continue // pushed in bulk above, or deleted meanwhile
      if (meta.conflictTaskIds.includes(id)) continue // waits for the user to pick a side
      const local = cache.getTask(id)
      if (!local) {
        update((m) => (m.dirtyTaskIds = m.dirtyTaskIds.filter((x) => x !== id)))
        continue
      }
      const path = taskPath(id)
      const knownSha = meta.fileShas[path]
      const content = serialize(local)
      try {
        const newSha = await putFile(token, owner, repo, path, branch, content, commitMessage(local, knownSha ? 'update' : 'add'), knownSha)
        taskPushed(local, content, newSha)
        pushed++
      } catch (err) {
        if (!(err instanceof GitHubConflictError)) throw err
        const remoteFile = await getFileContent(token, owner, repo, path, branch)
        if (remoteFile) {
          const remoteTask = JSON.parse(remoteFile.content) as Task
          conflicts.push({ taskId: id, local, remote: remoteTask, base: cache.getSyncedTask(id) })
          cache.markTaskConflict(id, remoteTask)
          setSha(path, remoteFile.sha)
        } else {
          setSha(path, undefined) // remote deleted it; recreate on next push
        }
      }
    }

    // ---- Phase 1b: push local task deletions ----
    for (const id of cache.getSyncMeta().deletedTaskIds) {
      const meta = cache.getSyncMeta()
      if (!meta.deletedTaskIds.includes(id)) continue // recreated meanwhile
      const path = taskPath(id)
      const knownSha = meta.fileShas[path]
      const forget = (): void => update((m) => (m.deletedTaskIds = m.deletedTaskIds.filter((x) => x !== id)))
      if (!knownSha) {
        forget()
        cache.removeSyncedTask(id)
        continue
      }
      try {
        await deleteFile(token, owner, repo, path, branch, `Delete task ${id}`, knownSha)
        setSha(path, undefined)
        cache.removeSyncedTask(id)
        forget()
        pushed++
      } catch (err) {
        if (!(err instanceof GitHubConflictError)) throw err
        const remoteFile = await getFileContent(token, owner, repo, path, branch)
        // The remote edit wins over the deletion, unless the task was recreated here in the meantime.
        if (remoteFile && !cache.getTask(id)) {
          const remoteTask = JSON.parse(remoteFile.content) as Task
          cache.writeTaskLocal(remoteTask)
          cache.setSyncedTask(remoteTask)
          setSha(path, remoteFile.sha)
        }
        forget()
      }
    }

    // ---- Phase 1c: push lists, folders and settings (last-sync-wins on conflict) ----
    for (const file of sharedFiles(cache)) {
      if (!cache.getSyncMeta()[file.dirtyFlag]) continue
      const content = serialize(file.read())
      const knownSha = cache.getSyncMeta().fileShas[file.path]
      // Whether the file was edited again while the request was in flight; if so it stays dirty for the next sync.
      const editedSince = (): boolean => serialize(file.read()) !== content
      try {
        setSha(file.path, await putFile(token, owner, repo, file.path, branch, content, `Update ${file.path}`, knownSha))
        pushed++
        if (!editedSince()) update((m) => (m[file.dirtyFlag] = false))
      } catch (err) {
        if (!(err instanceof GitHubConflictError)) throw err
        const remoteFile = await getFileContent(token, owner, repo, file.path, branch)
        if (!remoteFile) continue // gone remotely: stays dirty and is recreated next sync
        setSha(file.path, remoteFile.sha)
        if (editedSince()) continue
        // Another device synced first: its copy replaces this device's edit.
        file.write(JSON.parse(remoteFile.content))
        update((m) => (m[file.dirtyFlag] = false))
      }
    }

    // ---- Phase 2: pull everything that's new/changed on the remote ----
    const remoteEntries = await getDataTree(token, owner, repo, branch)
    const remoteByPath = new Map(remoteEntries.map((e) => [e.path, e.sha]))

    const knownTaskPaths = Object.keys(cache.getSyncMeta().fileShas).filter((p) => p.startsWith('data/tasks/'))
    const remoteTaskPaths = [...remoteByPath.keys()].filter((p) => p.startsWith('data/tasks/'))

    for (const path of new Set([...knownTaskPaths, ...remoteTaskPaths])) {
      const id = idFromTaskPath(path)
      // A pending conflict mustn't be clobbered, and a pending local edit is pushed (or conflicts) next time.
      const busy = (): boolean => {
        const m = cache.getSyncMeta()
        return m.conflictTaskIds.includes(id) || m.dirtyTaskIds.includes(id) || m.deletedTaskIds.includes(id)
      }
      if (busy()) continue

      const remoteSha = remoteByPath.get(path)
      if (remoteSha === cache.getSyncMeta().fileShas[path]) continue

      if (remoteSha === undefined) {
        if (cache.getTask(id)) cache.removeTaskLocal(id)
        cache.removeSyncedTask(id)
        setSha(path, undefined)
        continue
      }
      const remoteFile = await getFileContent(token, owner, repo, path, branch)
      if (remoteFile && !busy()) {
        const remoteTask = JSON.parse(remoteFile.content) as Task
        cache.writeTaskLocal(remoteTask)
        cache.setSyncedTask(remoteTask)
        setSha(path, remoteFile.sha)
        pulled++
      }
    }

    for (const file of sharedFiles(cache)) {
      const remoteSha = remoteByPath.get(file.path)
      if (!remoteSha || remoteSha === cache.getSyncMeta().fileShas[file.path] || cache.getSyncMeta()[file.dirtyFlag]) continue
      const remoteFile = await getFileContent(token, owner, repo, file.path, branch)
      if (!remoteFile || cache.getSyncMeta()[file.dirtyFlag]) continue
      file.write(JSON.parse(remoteFile.content))
      setSha(file.path, remoteFile.sha)
      pulled++
    }

    update((m) => (m.lastSyncedAt = new Date().toISOString()))
    return { pushed, pulled, conflicts, error: null, extensions: [] }
  } catch (err) {
    // Progress so far is already in the metadata.
    return { pushed, pulled, conflicts, error: err instanceof Error ? err.message : String(err), extensions: [] }
  }
}

/** New tasks at or above this count are pushed as one commit instead of one commit each. */
const BATCH_THRESHOLD = 10

interface SharedFile {
  path: string
  dirtyFlag: 'listsDirty' | 'foldersDirty' | 'settingsDirty'
  read(): unknown
  write(value: unknown): void
}

/** The single shared files, in push order. */
function sharedFiles(cache: CacheStore): SharedFile[] {
  return [
    { path: 'data/lists.json', dirtyFlag: 'listsDirty', read: () => cache.getLists(), write: (v) => cache.writeListsLocal(v as TaskList[]) },
    { path: 'data/folders.json', dirtyFlag: 'foldersDirty', read: () => cache.getFolders(), write: (v) => cache.writeFoldersLocal(v as TaskFolder[]) },
    { path: 'data/settings.json', dirtyFlag: 'settingsDirty', read: () => cache.getSettings(), write: (v) => cache.writeSettingsLocal(v as SyncedSettings) }
  ]
}

function taskPath(id: string): string {
  return `data/tasks/${id}.json`
}
function idFromTaskPath(path: string): string {
  return path.replace('data/tasks/', '').replace(/\.json$/, '')
}
function serialize(value: unknown): string {
  return JSON.stringify(value, null, 2)
}
function commitMessage(task: Task, kind: 'add' | 'update'): string {
  return `${kind === 'add' ? 'Add' : 'Update'} task: ${task.title.slice(0, 60)}`
}
