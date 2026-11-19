/** The id of the built-in "Tasks" list — the main, priority-ranked view. Always present, not deletable. */
export const MAIN_LIST_ID = 'main'

/** Priority is an attribute of a task, not a task type. 1 = highest urgency, 5 = lowest. */
export type Priority = 1 | 2 | 3 | 4 | 5

export interface Task {
  id: string
  listId: string
  title: string
  notes: string
  priority: Priority
  starred: boolean
  completed: boolean
  createdAt: string // ISO 8601
  updatedAt: string // ISO 8601
  completedAt: string | null // ISO 8601
  archived: boolean
  dueDate: string | null // ISO 8601 date
  /** Set when a task originated from an external integration (e.g. Google Calendar). */
  source: TaskSource | null
}

/** Where a task came from, when an extension created it. */
export type TaskSource =
  | {
      type: 'google_calendar'
      calendarId: string
      eventId: string
      /** Link to the event in Google Calendar's web UI. */
      htmlLink?: string
    }
  | {
      type: 'obsidian_inbox'
      /** Vault-relative path of the note the task was captured from. */
      notePath: string
    }
  | {
      type: 'microsoft_todo'
      /** The task's id in Microsoft To Do (its server id when it has one). */
      taskId: string
      /** The Microsoft To Do list it was in. */
      listName: string
    }

export interface TaskList {
  id: string
  name: string
  /** Position among its siblings: inside its folder, or at the top level alongside folders. */
  order: number
  /** The folder this list sits in; null/absent = top level. */
  folderId?: string | null
}

/** A sidebar folder grouping lists. One level deep only. Stored in data/folders.json. */
export interface TaskFolder {
  id: string
  name: string
  /** Shares one order space with the top-level lists. */
  order: number
}

export interface RankingSettings {
  /** 0 = pure age ordering within P2/P3, 1 = pure priority ordering. */
  midPriorityWeight: number
  /** Age (in days) at which the age factor saturates to its maximum, for ranking purposes. */
  ageNormalizationDays: number
  /** When on, starred tasks sort to the top of their own priority tier (main list) or of the list (other lists). */
  starredFirst: boolean
}

export interface ArchiveSettings {
  /** Days after completion before a task is auto-archived (removed from the Completed section). */
  archiveAfterDays: number
}

/** What to import from Google Calendar. Synced, so every connected device imports the same way. */
export interface CalendarSettings {
  /** Calendars to import events from. Empty = import nothing. */
  calendarIds: string[]
  /** List that imported tasks are created in. */
  targetListId: string
  /** How many days ahead (from the start of today) to import events. */
  daysAhead: number
  defaultPriority: Priority
  /** Bump an imported task to P1 once its due date has passed (once per task). */
  promoteOverdue: boolean
}

/** Where and how tasks are mirrored into an Obsidian vault. Synced; the vault's location on disk is per device. */
export interface ObsidianSettings {
  /** Vault-relative folder that holds everything the app writes (task notes, the Base, the inbox). */
  folder: string
  /** Also mirror completed and archived tasks, so the vault keeps a history of finished work. */
  includeCompleted: boolean
  /** Turn unchecked `- [ ]` items in `<folder>/Inbox.md` into tasks on every Sync. */
  inboxCapture: boolean
  /** List that tasks captured from the inbox are created in. */
  inboxListId: string
}

/** How Microsoft To Do tasks are imported. Synced; which signed-in account to read is per device. */
export interface MicrosoftTodoSettings {
  /** Also import completed tasks. Ones completed longer ago than the archive setting go straight to the archive. */
  includeCompleted: boolean
  defaultPriority: Priority
}

/** Every color the UI uses (see shared/themes.ts). Hover, overlay and tint shades are derived from these in the stylesheet. */
export interface ThemeColors {
  paper: string
  paperRaised: string
  sidebar: string
  field: string
  ink: string
  slate: string
  faint: string
  hairline: string
  highlighter: string
  danger: string
  ok: string
}

/** The three colors a theme is built from; the rest of `ThemeColors` is derived from them. */
export interface ThemeBase {
  background: string
  primary: string
  secondary: string
}

export interface Theme {
  id: string
  name: string
  description: string
  base: ThemeBase
  /** Derived colors the user set by hand. */
  overrides: Partial<ThemeColors>
}

export interface AppearanceSettings {
  /** The theme in use: a built-in theme id (see shared/themes.ts) or one of `customThemes`. */
  themeId: string
  /** Themes the user made. Built-in themes aren't stored. */
  customThemes: Theme[]
  /** The font in use (see shared/fonts.ts). */
  fontId: string
}

/** Built-in extensions (see shared/extensions.ts for the catalog). */
export type ExtensionId = 'google-calendar' | 'obsidian' | 'microsoft-todo'

/** Which extensions are installed, and their synced options. Device-specific setup lives in LocalSettings. */
export interface ExtensionSettings {
  installed: ExtensionId[]
  googleCalendar: CalendarSettings
  obsidian: ObsidianSettings
  microsoftTodo: MicrosoftTodoSettings
}

/** Synced settings — not secret, stored in the GitHub repo alongside tasks. */
export interface SyncedSettings {
  ranking: RankingSettings
  archive: ArchiveSettings
  appearance: AppearanceSettings
  extensions: ExtensionSettings
}

export const DEFAULT_SYNCED_SETTINGS: SyncedSettings = {
  ranking: {
    midPriorityWeight: 0.5,
    ageNormalizationDays: 30,
    starredFirst: false
  },
  archive: {
    archiveAfterDays: 31
  },
  appearance: {
    themeId: 'paper',
    customThemes: [],
    fontId: 'grotesque'
  },
  extensions: {
    installed: [],
    googleCalendar: {
      calendarIds: [],
      targetListId: MAIN_LIST_ID,
      daysAhead: 7,
      defaultPriority: 3,
      promoteOverdue: true
    },
    obsidian: {
      folder: 'TODO',
      includeCompleted: true,
      inboxCapture: true,
      inboxListId: MAIN_LIST_ID
    },
    microsoftTodo: {
      includeCompleted: true,
      defaultPriority: 3
    }
  }
}

/** Local-only settings — never leave this device, never committed to the repo. */
export interface LocalSettings {
  githubOwner: string
  githubRepo: string
  githubBranch: string
  /** Whether a GitHub PAT has been saved (the PAT value itself is never exposed to the renderer). */
  hasToken: boolean
  /** OAuth client ID of the user's own Google Cloud "Desktop app" client. */
  googleClientId: string
  /** Whether the Google client secret has been saved (encrypted; never exposed to the renderer). */
  hasGoogleClientSecret: boolean
  /** Whether this device holds a Google refresh token, i.e. is connected and runs calendar imports. */
  googleConnected: boolean
  /** Absolute path of this device's Obsidian vault; empty = the Obsidian extension doesn't run here. */
  obsidianVaultPath: string
  /** The Microsoft To Do account (folder under the app's AccountsRoot) to import from; empty = not set up here. */
  microsoftTodoAccountId: string
  /** Sync on its own: when the app opens or comes back to the front, and a few seconds after a change. */
  autoSync: boolean
}

/** The local settings the renderer can write; the rest are derived from what's stored securely. */
export type EditableLocalSettings = Omit<LocalSettings, 'hasToken' | 'hasGoogleClientSecret' | 'googleConnected'>

export const DEFAULT_LOCAL_SETTINGS: LocalSettings = {
  githubOwner: '',
  githubRepo: '',
  githubBranch: 'main',
  hasToken: false,
  googleClientId: '',
  hasGoogleClientSecret: false,
  googleConnected: false,
  obsidianVaultPath: '',
  microsoftTodoAccountId: '',
  autoSync: false
}

export interface GoogleCalendarInfo {
  id: string
  summary: string
  primary: boolean
  backgroundColor?: string
}

/** A Microsoft To Do account signed in on this computer, summarised so the user can tell accounts apart. */
export interface MicrosoftTodoAccount {
  id: string
  /** Lists, not counting the built-in Tasks list. */
  lists: number
  openTasks: number
  completedTasks: number
  /** The first few list names, in Microsoft To Do's sidebar order. */
  listNames: string[]
}

/** What one extension did during a Sync (or a manual "run now"). */
export interface ExtensionRunResult {
  extensionId: ExtensionId
  /** When it ran (ISO 8601). */
  at: string
  /** One line for the user, e.g. "Imported 3 events". Empty when there was nothing to report. */
  summary: string
  /** Tasks the extension created or changed in the local cache; non-zero means Sync pushes again. */
  changedTasks: number
  error: string | null
}

export type SyncStatus = 'idle' | 'syncing' | 'error'

export interface SyncConflict {
  taskId: string
  /** The version currently on this device, with local edits. */
  local: Task
  /** The version currently on GitHub, as of the last pull. */
  remote: Task
  /** The last version both sides agreed on, if known (used to explain what changed). */
  base: Task | null
}

export interface SyncResult {
  pushed: number
  pulled: number
  conflicts: SyncConflict[]
  error: string | null
  /** What each extension that is active on this device did as part of this sync. */
  extensions: ExtensionRunResult[]
}
