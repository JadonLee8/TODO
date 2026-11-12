import type {
  CalendarImportResult,
  EditableLocalSettings,
  GoogleCalendarInfo,
  LocalSettings,
  SyncConflict,
  SyncResult,
  SyncedSettings,
  Task,
  TaskFolder,
  TaskList
} from './types'
import type { ActivityEntry } from './activity'

/** Channel names shared between preload (sender) and main (handler) to avoid typos. */
export const CHANNELS = {
  tasksGetAll: 'tasks:getAll',
  tasksUpsert: 'tasks:upsert',
  tasksRemove: 'tasks:remove',
  listsGetAll: 'lists:getAll',
  listsSave: 'lists:save',
  foldersGetAll: 'folders:getAll',
  foldersSave: 'folders:save',
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
  syncResolveKeepRemote: 'sync:resolveKeepRemote',
  calendarSaveClientSecret: 'calendar:saveClientSecret',
  calendarConnect: 'calendar:connect',
  calendarDisconnect: 'calendar:disconnect',
  calendarListCalendars: 'calendar:listCalendars',
  calendarImportNow: 'calendar:importNow',
  calendarGetLastImport: 'calendar:getLastImport',
  activityGetAll: 'activity:getAll',
  activitySave: 'activity:save'
} as const

/** Result of an operation that can fail with a message for the user (errors don't cross IPC cleanly). */
export type Outcome<T = undefined> = { ok: true; value: T } | { ok: false; error: string }

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
  folders: {
    getAll(): Promise<TaskFolder[]>
    save(folders: TaskFolder[]): Promise<void>
  }
  settings: {
    getSynced(): Promise<SyncedSettings>
    saveSynced(settings: SyncedSettings): Promise<void>
    getLocal(): Promise<LocalSettings>
    saveLocal(settings: Partial<EditableLocalSettings>): Promise<void>
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
  calendar: {
    saveClientSecret(secret: string): Promise<void>
    /** Opens Google's consent page in the browser and waits for the redirect. */
    connect(): Promise<Outcome>
    disconnect(): Promise<void>
    listCalendars(): Promise<Outcome<GoogleCalendarInfo[]>>
    importNow(): Promise<CalendarImportResult>
    getLastImport(): Promise<CalendarImportResult | null>
  }
  activity: {
    getAll(): Promise<ActivityEntry[]>
    save(entries: ActivityEntry[]): Promise<void>
  }
}
