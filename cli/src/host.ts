import type { CacheStore } from '@shared/cacheStore'
import type { SyncConflict, SyncResult, Task, TaskList } from '@shared/types'
import { MAIN_LIST_ID } from '@shared/types'
import { createTask } from '@shared/newTask'
import { newId } from '@shared/id'
import { nextTopLevelOrder } from '@shared/sidebarTree'
import type { Line, ShellData, ShellHost } from '@shared/shell'

/**
 * The CLI's ShellHost: commands read and write the local cache, marking what changed so the next sync pushes it,
 * exactly as the Android app's `window.api` does. `cache` is a getter because the interactive shell can reload it.
 */
export function cacheHost(
  cache: () => CacheStore,
  options: {
    sync(): Promise<SyncResult>
    confirm(question: string): Promise<boolean>
    status(): Line[]
    clear?(): void
    exit?(): Promise<void>
  }
): ShellHost {
  const now = () => new Date().toISOString()

  const conflicts = (): SyncConflict[] => {
    const c = cache()
    return c.getSyncMeta().conflictTaskIds.flatMap((id) => {
      const local = c.getTask(id)
      const remote = c.getConflictRemote(id)
      return local && remote ? [{ taskId: id, local, remote, base: c.getSyncedTask(id) }] : []
    })
  }

  /** The stored lists, with the main Tasks list even before the app has written it (a brand-new repo). */
  const lists = (): TaskList[] => {
    const stored = cache().getLists()
    return stored.some((l) => l.id === MAIN_LIST_ID) ? stored : [{ id: MAIN_LIST_ID, name: 'Tasks', order: -1 }, ...stored]
  }

  const writeTask = (task: Task) => {
    cache().writeTaskLocal(task)
    cache().markTaskDirty(task.id)
  }

  const writeLists = (next: TaskList[]) => {
    cache().writeListsLocal(next)
    cache().markListsDirty()
  }

  return {
    data: (): ShellData => ({
      tasks: cache().getAllTasks(),
      lists: lists(),
      folders: cache().getFolders(),
      settings: cache().getSettings(),
      conflicts: conflicts()
    }),
    addTask: async (input) => {
      const task = createTask(input, newId())
      writeTask(task)
      return task
    },
    updateTask: async (task) => writeTask({ ...task, updatedAt: now() }),
    deleteTask: async (id) => {
      cache().removeTaskLocal(id)
      cache().markTaskDeleted(id)
    },
    addList: async (name) => {
      const current = lists()
      writeLists([...current, { id: newId(), name, order: nextTopLevelOrder(current, cache().getFolders()), folderId: null }])
    },
    deleteList: async (id) => {
      // Like the app: its tasks move to the main Tasks list rather than being lost.
      for (const task of cache().getAllTasks().filter((t) => t.listId === id)) writeTask({ ...task, listId: MAIN_LIST_ID, updatedAt: now() })
      writeLists(lists().filter((l) => l.id !== id))
    },
    saveSettings: async (settings) => {
      cache().writeSettingsLocal(settings)
      cache().markSettingsDirty()
    },
    sync: () => options.sync(),
    resolveConflict: async (taskId, keep) => {
      const c = cache()
      if (keep === 'local') {
        c.markTaskDirty(taskId)
      } else {
        const remote = c.getConflictRemote(taskId)
        if (remote) c.acceptRemoteTask(remote)
      }
      c.clearTaskConflict(taskId)
    },
    confirm: options.confirm,
    status: options.status,
    clear: options.clear,
    exit: options.exit
  }
}

/** Whether the cache holds changes that haven't reached GitHub yet. */
export function pendingChanges(cache: CacheStore): number {
  const meta = cache.getSyncMeta()
  return meta.dirtyTaskIds.length + meta.deletedTaskIds.length + Number(meta.listsDirty) + Number(meta.foldersDirty) + Number(meta.settingsDirty)
}
