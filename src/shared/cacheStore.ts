import type { SyncedSettings, Task, TaskFolder, TaskList } from './types'
import { DEFAULT_SYNCED_SETTINGS } from './types'

/**
 * The local-first cache every platform keeps: a working copy mirroring the repo's `data/` directory, the last
 * content known to match GitHub (`synced`, the base for conflict diffs), the remote side of unresolved conflicts,
 * and the sync bookkeeping. The desktop app implements it on disk (`main/localCache.ts`); the Android app in memory
 * with IndexedDB behind it (`memoryCacheStore.ts`). Every method is synchronous, so a read-modify-write of the
 * metadata can't be interleaved with another one.
 */
export interface CacheStore {
  getAllTasks(): Task[]
  getTask(id: string): Task | null
  writeTaskLocal(task: Task): void
  removeTaskLocal(id: string): void
  getSyncedTask(id: string): Task | null
  setSyncedTask(task: Task): void
  removeSyncedTask(id: string): void

  getLists(): TaskList[]
  writeListsLocal(lists: TaskList[]): void
  getFolders(): TaskFolder[]
  writeFoldersLocal(folders: TaskFolder[]): void
  /** Stored settings merged over the defaults. */
  getSettings(): SyncedSettings
  writeSettingsLocal(settings: SyncedSettings): void

  getSyncMeta(): SyncMeta
  writeSyncMeta(meta: SyncMeta): void
  markTaskDirty(id: string): void
  markTaskDeleted(id: string): void
  markListsDirty(): void
  markFoldersDirty(): void
  markSettingsDirty(): void

  getConflictRemote(id: string): Task | null
  markTaskConflict(id: string, remoteVersion: Task): void
  clearTaskConflict(id: string): void
  /** Marks a conflicted task's local copy as accepted-remote: local now matches remote, nothing left to push. */
  acceptRemoteTask(task: Task): void
}

export interface SyncMeta {
  /** Blob sha of each repo file as of the last sync: the optimistic-concurrency token for the next write. */
  fileShas: Record<string, string>
  dirtyTaskIds: string[]
  deletedTaskIds: string[]
  /** Tasks with an unresolved edit-vs-edit conflict (persisted so a restart doesn't lose them). */
  conflictTaskIds: string[]
  listsDirty: boolean
  foldersDirty: boolean
  settingsDirty: boolean
  lastSyncedAt: string | null
}

export function emptySyncMeta(): SyncMeta {
  return {
    fileShas: {},
    dirtyTaskIds: [],
    deletedTaskIds: [],
    conflictTaskIds: [],
    listsDirty: false,
    foldersDirty: false,
    settingsDirty: false,
    lastSyncedAt: null
  }
}

/** Fields a settings file doesn't have yet (written by an older version) get their defaults. */
export function mergeSyncedSettings(stored: Partial<SyncedSettings>): SyncedSettings {
  const d = DEFAULT_SYNCED_SETTINGS
  return {
    ranking: { ...d.ranking, ...stored.ranking },
    archive: { ...d.archive, ...stored.archive },
    appearance: { ...d.appearance, ...stored.appearance },
    extensions: {
      installed: stored.extensions?.installed ?? d.extensions.installed,
      googleCalendar: { ...d.extensions.googleCalendar, ...stored.extensions?.googleCalendar },
      obsidian: { ...d.extensions.obsidian, ...stored.extensions?.obsidian },
      microsoftTodo: { ...d.extensions.microsoftTodo, ...stored.extensions?.microsoftTodo }
    }
  }
}
