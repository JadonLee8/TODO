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

export interface TaskSource {
  type: 'google_calendar'
  calendarId: string
  eventId: string
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

/** Synced settings — not secret, stored in the GitHub repo alongside tasks. */
export interface SyncedSettings {
  ranking: RankingSettings
  archive: ArchiveSettings
}

export const DEFAULT_SYNCED_SETTINGS: SyncedSettings = {
  ranking: {
    midPriorityWeight: 0.5,
    ageNormalizationDays: 30,
    starredFirst: false
  },
  archive: {
    archiveAfterDays: 31
  }
}

/** Local-only settings — never leave this device, never committed to the repo. */
export interface LocalSettings {
  githubOwner: string
  githubRepo: string
  githubBranch: string
  /** Whether a GitHub PAT has been saved (the PAT value itself is never exposed to the renderer). */
  hasToken: boolean
}

export const DEFAULT_LOCAL_SETTINGS: LocalSettings = {
  githubOwner: '',
  githubRepo: '',
  githubBranch: 'main',
  hasToken: false
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
}
