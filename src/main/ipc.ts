import { ipcMain } from 'electron'
import type { EditableLocalSettings, SyncedSettings, SyncConflict, SyncResult, Task, TaskFolder, TaskList } from '@shared/types'
import { CHANNELS, type Outcome, type TokenCheckResult } from '@shared/ipc'
import * as cache from './localCache'
import * as secureStore from './secureStore'
import * as googleAuth from './googleAuth'
import { calendarImportEnabled, getLastImport, listCalendars, runCalendarImport } from './calendarImport'
import { verifyRepoAccess, verifyToken as verifyGithubToken } from '@shared/github'
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
  ipcMain.handle(CHANNELS.settingsSaveLocal, (_e, settings: Partial<EditableLocalSettings>) => {
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

  // Sync = pull/push, then (on a device connected to Google) import calendar events, then push again if the import
  // changed anything. Pulling first means an event another device already imported is in the cache, not duplicated.
  ipcMain.handle(CHANNELS.syncRun, async (): Promise<SyncResult> => {
    const token = secureStore.loadToken()
    const local = secureStore.loadLocalSettings()
    const githubError = !token
      ? 'No GitHub token saved. Add one in Settings.'
      : !local.githubOwner || !local.githubRepo
        ? 'No GitHub repo configured. Set one in Settings.'
        : null
    const importEnabled = calendarImportEnabled()

    if (githubError || !token) {
      // Without GitHub the calendar import can still fill the local task list.
      const calendarImport = importEnabled ? await runCalendarImport() : undefined
      return { pushed: 0, pulled: 0, conflicts: [], error: githubError, calendarImport }
    }

    const sync = () => syncNow(token, local.githubOwner, local.githubRepo, local.githubBranch || 'main')
    const first = await sync()
    if (first.error || !importEnabled) return first
    const calendarImport = await runCalendarImport()
    if (calendarImport.imported + calendarImport.promoted === 0) return { ...first, calendarImport }
    const second = await sync()
    return {
      pushed: first.pushed + second.pushed,
      pulled: first.pulled + second.pulled,
      conflicts: [...first.conflicts, ...second.conflicts],
      error: second.error,
      calendarImport
    }
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

  ipcMain.handle(CHANNELS.calendarSaveClientSecret, (_e, secret: string) => {
    secureStore.saveSecret('google-client-secret', secret)
  })
  ipcMain.handle(CHANNELS.calendarConnect, () => outcome(googleAuth.connect()))
  ipcMain.handle(CHANNELS.calendarDisconnect, () => googleAuth.disconnect())
  ipcMain.handle(CHANNELS.calendarListCalendars, () => outcome(listCalendars()))
  ipcMain.handle(CHANNELS.calendarImportNow, () => runCalendarImport())
  ipcMain.handle(CHANNELS.calendarGetLastImport, () => getLastImport())
}

async function outcome<T>(promise: Promise<T>): Promise<Outcome<T>> {
  try {
    return { ok: true, value: await promise }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
