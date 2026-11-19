import type { SyncedSettings, Task, TaskFolder, TaskList } from './types'
import { emptySyncMeta, mergeSyncedSettings, type CacheStore, type SyncMeta } from './cacheStore'

/**
 * A `CacheStore` held in memory, for platforms without a synchronous filesystem (the Android app) and for tests.
 * Records are keyed like the desktop cache's files: `tasks/<id>`, `synced/tasks/<id>`, `conflicts/<id>`, `lists`,
 * `folders`, `settings`, `sync-meta`. Load `initial` from wherever the records are persisted, and persist each
 * change from `onChange` (value `undefined` = the record was removed).
 */
export interface MemoryCacheOptions {
  initial?: Iterable<readonly [string, unknown]>
  onChange?: (key: string, value: unknown) => void
}

const TASKS = 'tasks/'
const SYNCED_TASKS = 'synced/tasks/'
const CONFLICTS = 'conflicts/'

export function createMemoryCacheStore(options: MemoryCacheOptions = {}): CacheStore {
  const records = new Map<string, unknown>(options.initial ?? [])

  // Values are copied on the way in and out, like reading and writing files, so callers can't alias the cache.
  const read = <T>(key: string): T | null => (records.has(key) ? (structuredClone(records.get(key)) as T) : null)
  const write = (key: string, value: unknown): void => {
    const copy = structuredClone(value)
    records.set(key, copy)
    options.onChange?.(key, copy)
  }
  const remove = (key: string): void => {
    if (records.delete(key)) options.onChange?.(key, undefined)
  }

  const getSyncMeta = (): SyncMeta => ({ ...emptySyncMeta(), ...read<Partial<SyncMeta>>('sync-meta') })
  const updateMeta = (change: (meta: SyncMeta) => void): void => {
    const meta = getSyncMeta()
    change(meta)
    write('sync-meta', meta)
  }
  const without = (ids: string[], id: string): string[] => ids.filter((x) => x !== id)
  const withId = (ids: string[], id: string): string[] => (ids.includes(id) ? ids : [...ids, id])

  return {
    getAllTasks: () => {
      const tasks: Task[] = []
      for (const [key, value] of records) if (key.startsWith(TASKS)) tasks.push(structuredClone(value) as Task)
      return tasks
    },
    getTask: (id) => read<Task>(TASKS + id),
    writeTaskLocal: (task) => write(TASKS + task.id, task),
    removeTaskLocal: (id) => remove(TASKS + id),
    getSyncedTask: (id) => read<Task>(SYNCED_TASKS + id),
    setSyncedTask: (task) => write(SYNCED_TASKS + task.id, task),
    removeSyncedTask: (id) => remove(SYNCED_TASKS + id),

    getLists: () => read<TaskList[]>('lists') ?? [],
    writeListsLocal: (lists) => write('lists', lists),
    getFolders: () => read<TaskFolder[]>('folders') ?? [],
    writeFoldersLocal: (folders) => write('folders', folders),
    getSettings: () => mergeSyncedSettings(read<Partial<SyncedSettings>>('settings') ?? {}),
    writeSettingsLocal: (settings) => write('settings', settings),

    getSyncMeta,
    writeSyncMeta: (meta) => write('sync-meta', meta),
    markTaskDirty: (id) =>
      updateMeta((m) => {
        m.dirtyTaskIds = withId(m.dirtyTaskIds, id)
        m.deletedTaskIds = without(m.deletedTaskIds, id)
      }),
    markTaskDeleted: (id) =>
      updateMeta((m) => {
        m.dirtyTaskIds = without(m.dirtyTaskIds, id)
        m.deletedTaskIds = withId(m.deletedTaskIds, id)
      }),
    markListsDirty: () => updateMeta((m) => (m.listsDirty = true)),
    markFoldersDirty: () => updateMeta((m) => (m.foldersDirty = true)),
    markSettingsDirty: () => updateMeta((m) => (m.settingsDirty = true)),

    getConflictRemote: (id) => read<Task>(CONFLICTS + id),
    markTaskConflict: (id, remoteVersion) => {
      write(CONFLICTS + id, remoteVersion)
      updateMeta((m) => (m.conflictTaskIds = withId(m.conflictTaskIds, id)))
    },
    clearTaskConflict: (id) => {
      remove(CONFLICTS + id)
      updateMeta((m) => (m.conflictTaskIds = without(m.conflictTaskIds, id)))
    },
    acceptRemoteTask: (task) => {
      write(TASKS + task.id, task)
      write(SYNCED_TASKS + task.id, task)
      updateMeta((m) => (m.dirtyTaskIds = without(m.dirtyTaskIds, task.id)))
    }
  }
}
