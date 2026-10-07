import type { SyncConflict, SyncResult, Task, TaskFolder, TaskList, SyncedSettings } from '@shared/types'
import { GitHubConflictError, deleteFile, getDataTree, getFileContent, putFile } from './github'
import * as cache from './localCache'

/**
 * Manual, bidirectional sync: push everything queued locally, then pull everything new
 * from GitHub. Runs push-before-pull so a device that has been offline always tries to
 * land its own edits first; anything that lost the race comes back as a conflict rather
 * than silently overwriting someone else's change.
 *
 * Conflict policy (deliberately simple, scoped to what was asked for):
 *  - Task edited on both sides differently -> surfaced as a SyncConflict for the user to resolve.
 *  - Task deleted locally but edited remotely -> the remote edit wins, local deletion is dropped.
 *  - Task edited locally but deleted remotely -> the local edit wins, file is recreated on push.
 *  - lists.json / folders.json / settings.json (single shared files) -> last writer to sync wins;
 *    a losing local edit is discarded in favor of pulling the current remote copy.
 */
export async function syncNow(token: string, owner: string, repo: string, branch: string): Promise<SyncResult> {
  const meta = cache.getSyncMeta()
  const conflicts: SyncConflict[] = []
  let pushed = 0
  let pulled = 0

  try {
    // ---- Phase 1: push local task edits ----
    for (const id of [...meta.dirtyTaskIds]) {
      const local = cache.getTask(id)
      if (!local) {
        meta.dirtyTaskIds = meta.dirtyTaskIds.filter((x) => x !== id)
        continue
      }
      const path = taskPath(id)
      const knownSha = meta.fileShas[path]
      try {
        const newSha = await putFile(token, owner, repo, path, branch, serialize(local), commitMessage(local, knownSha ? 'update' : 'add'), knownSha)
        meta.fileShas[path] = newSha
        cache.setSyncedTask(local)
        meta.dirtyTaskIds = meta.dirtyTaskIds.filter((x) => x !== id)
        pushed++
      } catch (err) {
        if (!(err instanceof GitHubConflictError)) throw err
        const remoteFile = await getFileContent(token, owner, repo, path, branch)
        if (remoteFile) {
          const remoteTask = JSON.parse(remoteFile.content) as Task
          conflicts.push({ taskId: id, local, remote: remoteTask, base: cache.getSyncedTask(id) })
          cache.markTaskConflict(id, remoteTask)
          meta.fileShas[path] = remoteFile.sha
        } else {
          delete meta.fileShas[path] // remote deleted it; recreate on next push
        }
      }
    }

    // ---- Phase 1b: push local task deletions ----
    for (const id of [...meta.deletedTaskIds]) {
      const path = taskPath(id)
      const knownSha = meta.fileShas[path]
      if (!knownSha) {
        meta.deletedTaskIds = meta.deletedTaskIds.filter((x) => x !== id)
        cache.removeSyncedTask(id)
        continue
      }
      try {
        await deleteFile(token, owner, repo, path, branch, `Delete task ${id}`, knownSha)
        delete meta.fileShas[path]
        cache.removeSyncedTask(id)
        meta.deletedTaskIds = meta.deletedTaskIds.filter((x) => x !== id)
        pushed++
      } catch (err) {
        if (!(err instanceof GitHubConflictError)) throw err
        const remoteFile = await getFileContent(token, owner, repo, path, branch)
        if (remoteFile) {
          const remoteTask = JSON.parse(remoteFile.content) as Task
          cache.writeTaskLocal(remoteTask)
          cache.setSyncedTask(remoteTask)
          meta.fileShas[path] = remoteFile.sha
        }
        meta.deletedTaskIds = meta.deletedTaskIds.filter((x) => x !== id)
      }
    }

    // ---- Phase 1c/1d: push lists & settings (last-sync-wins on conflict) ----
    if (meta.listsDirty) {
      const result = await pushSingleFile(token, owner, repo, branch, LISTS_PATH, cache.getLists(), meta)
      if (result === 'pulled-instead') cache.writeListsLocal(JSON.parse((await getFileContent(token, owner, repo, LISTS_PATH, branch))!.content))
      else pushed++
      meta.listsDirty = false
    }
    if (meta.foldersDirty) {
      const result = await pushSingleFile(token, owner, repo, branch, FOLDERS_PATH, cache.getFolders(), meta)
      if (result === 'pulled-instead') cache.writeFoldersLocal(JSON.parse((await getFileContent(token, owner, repo, FOLDERS_PATH, branch))!.content))
      else pushed++
      meta.foldersDirty = false
    }
    if (meta.settingsDirty) {
      const result = await pushSingleFile(token, owner, repo, branch, SETTINGS_PATH, cache.getSettings(), meta)
      if (result === 'pulled-instead') cache.writeSettingsLocal(JSON.parse((await getFileContent(token, owner, repo, SETTINGS_PATH, branch))!.content))
      else pushed++
      meta.settingsDirty = false
    }

    // ---- Phase 2: pull everything that's new/changed on the remote ----
    const remoteEntries = await getDataTree(token, owner, repo, branch)
    const remoteByPath = new Map(remoteEntries.map((e) => [e.path, e.sha]))

    const knownTaskPaths = Object.keys(meta.fileShas).filter((p) => p.startsWith('data/tasks/'))
    const remoteTaskPaths = [...remoteByPath.keys()].filter((p) => p.startsWith('data/tasks/'))
    const allTaskPaths = new Set([...knownTaskPaths, ...remoteTaskPaths])

    for (const path of allTaskPaths) {
      const id = idFromTaskPath(path)
      if (meta.conflictTaskIds.includes(id)) continue // already surfaced above; don't clobber the pending conflict
      if (meta.dirtyTaskIds.includes(id) || meta.deletedTaskIds.includes(id)) continue // still has a local edit pending

      const remoteSha = remoteByPath.get(path)
      const localSha = meta.fileShas[path]
      if (remoteSha === localSha) continue

      if (remoteSha === undefined) {
        if (cache.getTask(id)) cache.removeTaskLocal(id)
        cache.removeSyncedTask(id)
        delete meta.fileShas[path]
        continue
      }
      const remoteFile = await getFileContent(token, owner, repo, path, branch)
      if (remoteFile) {
        const remoteTask = JSON.parse(remoteFile.content) as Task
        cache.writeTaskLocal(remoteTask)
        cache.setSyncedTask(remoteTask)
        meta.fileShas[path] = remoteFile.sha
        pulled++
      }
    }

    pulled += await pullSingleFileIfChanged(token, owner, repo, branch, LISTS_PATH, remoteByPath, meta, (lists: TaskList[]) => cache.writeListsLocal(lists))
    pulled += await pullSingleFileIfChanged(token, owner, repo, branch, FOLDERS_PATH, remoteByPath, meta, (folders: TaskFolder[]) => cache.writeFoldersLocal(folders))
    pulled += await pullSingleFileIfChanged(token, owner, repo, branch, SETTINGS_PATH, remoteByPath, meta, (s: SyncedSettings) => cache.writeSettingsLocal(s))

    meta.lastSyncedAt = new Date().toISOString()
    cache.writeSyncMeta(meta)
    return { pushed, pulled, conflicts, error: null }
  } catch (err) {
    cache.writeSyncMeta(meta) // keep whatever progress we made
    return { pushed, pulled, conflicts, error: err instanceof Error ? err.message : String(err) }
  }
}

const LISTS_PATH = 'data/lists.json'
const FOLDERS_PATH = 'data/folders.json'
const SETTINGS_PATH = 'data/settings.json'

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

async function pushSingleFile(
  token: string,
  owner: string,
  repo: string,
  branch: string,
  path: string,
  value: unknown,
  meta: cache.SyncMeta
): Promise<'pushed' | 'pulled-instead'> {
  const knownSha = meta.fileShas[path]
  try {
    const newSha = await putFile(token, owner, repo, path, branch, serialize(value), `Update ${path}`, knownSha)
    meta.fileShas[path] = newSha
    return 'pushed'
  } catch (err) {
    if (!(err instanceof GitHubConflictError)) throw err
    const remoteFile = await getFileContent(token, owner, repo, path, branch)
    if (remoteFile) meta.fileShas[path] = remoteFile.sha
    return 'pulled-instead'
  }
}

async function pullSingleFileIfChanged<T>(
  token: string,
  owner: string,
  repo: string,
  branch: string,
  path: string,
  remoteByPath: Map<string, string>,
  meta: cache.SyncMeta,
  apply: (value: T) => void
): Promise<number> {
  const remoteSha = remoteByPath.get(path)
  if (!remoteSha || remoteSha === meta.fileShas[path]) return 0
  const remoteFile = await getFileContent(token, owner, repo, path, branch)
  if (!remoteFile) return 0
  apply(JSON.parse(remoteFile.content) as T)
  meta.fileShas[path] = remoteFile.sha
  return 1
}
