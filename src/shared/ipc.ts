import type {
  EditableLocalSettings,
  ExtensionId,
  ExtensionRunResult,
  GoogleCalendarInfo,
  LocalSettings,
  MicrosoftTodoAccount,
  SyncConflict,
  SyncResult,
  SyncedSettings,
  Task,
  TaskFolder,
  TaskList
} from './types'
import type { ActivityEntry } from './activity'
import type { SharedText } from './share'
import type { WidgetAction, WidgetSnapshot } from './widget'

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
  extensionsRunNow: 'extensions:runNow',
  extensionsGetLastRuns: 'extensions:getLastRuns',
  obsidianPickVault: 'obsidian:pickVault',
  obsidianOpen: 'obsidian:open',
  microsoftTodoListAccounts: 'microsoftTodo:listAccounts',
  activityGetAll: 'activity:getAll',
  activitySave: 'activity:save',
  updatesGetState: 'updates:getState',
  updatesCheck: 'updates:check',
  updatesInstall: 'updates:install',
  /** Main -> renderer: the update state changed. */
  updatesChanged: 'updates:changed'
} as const

/** Result of an operation that can fail with a message for the user (errors don't cross IPC cleanly). */
export type Outcome<T = undefined> = { ok: true; value: T } | { ok: false; error: string }

/** Where the desktop app's self-update is. Updates come from the repo's GitHub releases (electron-updater). */
export type UpdateStatus =
  /** `npm run dev` or the portable .exe: they can't replace themselves. */
  | { state: 'unsupported'; reason: string }
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'upToDate' }
  /** Found and downloading in the background. */
  | { state: 'downloading'; version: string; percent: number }
  /** Downloaded: installs when the app quits, or now with `install()`. */
  | { state: 'ready'; version: string }
  | { state: 'error'; message: string }

export interface UpdateState {
  currentVersion: string
  status: UpdateStatus
  /** The releases page, for the release notes and the other downloads. */
  releasesUrl: string
}

export interface TokenCheckResult {
  ok: boolean
  login?: string
  error?: string
}

/** The full API surface exposed to the renderer via contextBridge. */
export interface Api {
  /** Where the UI is running. The Android app has no extensions and a touch layout. */
  platform: 'desktop' | 'android'
  /** Text shared to the app from other apps (Android's share sheet). Absent on desktop. */
  shareTarget?: {
    /** Calls `handler` for a share that opened the app and for each one after. Returns an unsubscribe. */
    onShare(handler: (shared: SharedText) => void): () => void
  }
  /** The Android home-screen widget. Absent on desktop. */
  widget?: {
    /** Hands the widget what to show. Cheap to call often: an unchanged snapshot is not sent again. */
    update(snapshot: WidgetSnapshot): void
    /** Calls `handler` when a tap on the widget opened the app (now or earlier). Returns an unsubscribe. */
    onOpen(handler: (action: WidgetAction) => void): () => void
  }
  /** The desktop app's self-update. Absent on Android, where the APK is updated by hand. */
  updates?: {
    getState(): Promise<UpdateState>
    /** Checks GitHub for a newer release and, if there is one, downloads it. Progress arrives through `onChange`. */
    check(): Promise<void>
    /** Quits, installs the downloaded update and starts the new version. */
    install(): Promise<void>
    /** Calls `handler` on every change of state. Returns an unsubscribe. */
    onChange(handler: (state: UpdateState) => void): () => void
  }
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
  }
  extensions: {
    /** Runs one installed extension now, without syncing. Tasks it creates are pushed on the next Sync. */
    runNow(id: ExtensionId): Promise<ExtensionRunResult>
    /** The last result of each extension on this device. */
    getLastRuns(): Promise<Partial<Record<ExtensionId, ExtensionRunResult>>>
  }
  obsidian: {
    /** Asks for the vault folder and saves it for this device; null if cancelled. */
    pickVault(): Promise<Outcome<string | null>>
    /** Opens a task's note, or the inbox or Base, in Obsidian. */
    open(target: { taskId: string } | { file: 'inbox' | 'base' }): Promise<Outcome>
  }
  microsoftTodo: {
    /** The Microsoft To Do accounts signed in to the Windows app on this computer. */
    listAccounts(): Promise<Outcome<MicrosoftTodoAccount[]>>
  }
  activity: {
    getAll(): Promise<ActivityEntry[]>
    save(entries: ActivityEntry[]): Promise<void>
  }
}
