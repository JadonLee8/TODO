import { ipcMain } from 'electron'
import type { LocalSettings, SyncedSettings, SyncConflict, Task, TaskFolder, TaskList } from '@shared/types'
import { CHANNELS, type TokenCheckResult } from '@shared/ipc'
import * as cache from './localCache'
import * as secureStore from './secureStore'
import { verifyRepoAccess, verifyToken as verifyGithubToken } from './github'
import { syncNow } from './sync'

export function registerIpcHandlers(): void {
  ipcMain.handle(CHANNELS.tasksGetAll, () => cache.getAllTasks())
  ipcMain.handle(CHANNELS.tasksUpsert, (_e, task: Task) => {
    cache.writeTaskLocal(task)
    cache.markTaskDirty(task.id)
  })
  ipcMain.handle(CHANNELS.tasksRemove, (_e, id: string) => {
    cache.removeTaskLocal(id)
    cache.markTaskDeleted(id)
  })

  ipcMain.handle(CHANNELS.listsGetAll, () => cache.getLists())
  ipcMain.handle(CHANNELS.listsSave, (_e, lists: TaskList[]) => {
    cache.writeListsLocal(lists)
    cache.markListsDirty()
  })

  ipcMain.handle(CHANNELS.foldersGetAll, () => cache.getFolders())
  ipcMain.handle(CHANNELS.foldersSave, (_e, folders: TaskFolder[]) => {
    cache.writeFoldersLocal(folders)
    cache.markFoldersDirty()
  })

  ipcMain.handle(CHANNELS.settingsGetSynced, () => cache.getSettings())
  ipcMain.handle(CHANNELS.settingsSaveSynced, (_e, settings: SyncedSettings) => {
    cache.writeSettingsLocal(settings)
    cache.markSettingsDirty()
  })
  ipcMain.handle(CHANNELS.settingsGetLocal, () => secureStore.loadLocalSettings())
  ipcMain.handle(CHANNELS.settingsSaveLocal, (_e, settings: Omit<LocalSettings, 'hasToken'>) => {
    secureStore.saveLocalSettings(settings)
  })
  ipcMain.handle(CHANNELS.settingsSaveToken, (_e, token: string) => {
    secureStore.saveToken(token)
  })
  ipcMain.handle(CHANNELS.settingsClearToken, () => {
    secureStore.clearToken()
  })
  ipcMain.handle(CHANNELS.settingsVerifyToken, async (): Promise<TokenCheckResult> => {
    const token = secureStore.loadToken()
    if (!token) return { ok: false, error: 'No token saved yet' }
    try {
      const { login } = await verifyGithubToken(token)
      const local = secureStore.loadLocalSettings()
      if (local.githubOwner && local.githubRepo) {
        await verifyRepoAccess(token, local.githubOwner, local.githubRepo)
      }
      return { ok: true, login }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(CHANNELS.syncRun, async () => {
    const token = secureStore.loadToken()
    const local = secureStore.loadLocalSettings()
    if (!token) return { pushed: 0, pulled: 0, conflicts: [], error: 'No GitHub token saved. Add one in Settings.' }
    if (!local.githubOwner || !local.githubRepo) {
      return { pushed: 0, pulled: 0, conflicts: [], error: 'No GitHub repo configured. Set one in Settings.' }
    }
    return syncNow(token, local.githubOwner, local.githubRepo, local.githubBranch || 'main')
  })

  ipcMain.handle(CHANNELS.syncGetPendingConflicts, (): SyncConflict[] => {
    const meta = cache.getSyncMeta()
    return meta.conflictTaskIds
      .map((id) => {
        const local = cache.getTask(id)
        const remote = cache.getConflictRemote(id)
        if (!local || !remote) return null
        return { taskId: id, local, remote, base: cache.getSyncedTask(id) }
      })
      .filter((c): c is SyncConflict => c !== null)
  })

  ipcMain.handle(CHANNELS.syncResolveKeepLocal, (_e, taskId: string) => {
    cache.markTaskDirty(taskId)
    cache.clearTaskConflict(taskId)
  })
  ipcMain.handle(CHANNELS.syncResolveKeepRemote, (_e, taskId: string) => {
    const remote = cache.getConflictRemote(taskId)
    if (remote) cache.acceptRemoteTask(remote)
    cache.clearTaskConflict(taskId)
  })
}
