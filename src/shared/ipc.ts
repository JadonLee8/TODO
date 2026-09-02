import type { LocalSettings, SyncConflict, SyncResult, SyncedSettings, Task, TaskList } from './types'

/** Channel names shared between preload (sender) and main (handler) to avoid typos. */
export const CHANNELS = {
  tasksGetAll: 'tasks:getAll',
  tasksUpsert: 'tasks:upsert',
  tasksRemove: 'tasks:remove',
  listsGetAll: 'lists:getAll',
  listsSave: 'lists:save',
  settingsGetSynced: 'settings:getSynced',
  settingsSaveSynced: 'settings:saveSynced',
  settingsGetLocal: 'settings:getLocal',
  settingsSaveLocal: 'settings:saveLocal',
  settingsSaveToken: 'settings:saveToken',
  settingsClearToken: 'settings:clearToken',
  settingsVerifyToken: 'settings:verifyToken',
  syncRun: 'sync:run',
  syncGetPendingConflicts: 'sync:getPendingConflicts',
  syncResolveKeepLocal: 'sync:resolveKeepLocal',
  syncResolveKeepRemote: 'sync:resolveKeepRemote'
} as const

export interface TokenCheckResult {
  ok: boolean
  login?: string
  error?: string
}

/** The full API surface exposed to the renderer via contextBridge. */
export interface Api {
  tasks: {
    getAll(): Promise<Task[]>
    upsert(task: Task): Promise<void>
    remove(id: string): Promise<void>
  }
  lists: {
    getAll(): Promise<TaskList[]>
    save(lists: TaskList[]): Promise<void>
  }
  settings: {
    getSynced(): Promise<SyncedSettings>
    saveSynced(settings: SyncedSettings): Promise<void>
    getLocal(): Promise<LocalSettings>
    saveLocal(settings: Omit<LocalSettings, 'hasToken'>): Promise<void>
    saveToken(token: string): Promise<void>
    clearToken(): Promise<void>
    verifyToken(): Promise<TokenCheckResult>
  }
  sync: {
    run(): Promise<SyncResult>
    getPendingConflicts(): Promise<SyncConflict[]>
    resolveKeepLocal(taskId: string): Promise<void>
    resolveKeepRemote(taskId: string): Promise<void>
  }
}
