import type { Task, TaskFolder, TaskList } from './types'

/**
 * The activity log: one entry per change made in the app on this device, holding each changed task, list or folder
 * as it was before and after. Undoing an entry writes the "before" states back as a new change (and a new entry),
 * which syncs to GitHub as new commits; history is never rewritten.
 */

export interface EntityChange<T> {
  id: string
  /** null = the entity didn't exist before (it was created). */
  before: T | null
  /** null = the entity doesn't exist after (it was deleted). */
  after: T | null
}

export interface ActivityChanges {
  tasks: EntityChange<Task>[]
  lists: EntityChange<TaskList>[]
  folders: EntityChange<TaskFolder>[]
}

export interface ActivityEntry {
  id: string
  /** ISO 8601 time of the change. */
  at: string
  summary: string
  changes: ActivityChanges
  /** Set when this entry has been undone: the id of the entry that undid it. */
  undoneBy?: string
  /** Set on entries that undo another entry: that entry's id. */
  undoes?: string
}

/** The log keeps this many entries; older ones drop off (they're still in the GitHub history once synced). */
export const MAX_ACTIVITY_ENTRIES = 300

export const NO_CHANGES: ActivityChanges = { tasks: [], lists: [], folders: [] }

export function hasChanges(c: ActivityChanges): boolean {
  return c.tasks.length + c.lists.length + c.folders.length > 0
}

/** Structural equality for JSON-shaped values (key order doesn't matter). */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return a === b
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const ka = Object.keys(a as object).filter((k) => (a as Record<string, unknown>)[k] !== undefined)
  const kb = Object.keys(b as object).filter((k) => (b as Record<string, unknown>)[k] !== undefined)
  if (ka.length !== kb.length) return false
  return ka.every((k) => sameValue((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
}

/** The entities that were added, removed or changed between two versions of a collection. */
export function diffById<T extends { id: string }>(before: T[], after: T[]): EntityChange<T>[] {
  const beforeById = new Map(before.map((x) => [x.id, x]))
  const afterById = new Map(after.map((x) => [x.id, x]))
  const ids = [...new Set([...beforeById.keys(), ...afterById.keys()])]
  return ids
    .map((id) => ({ id, before: beforeById.get(id) ?? null, after: afterById.get(id) ?? null }))
    .filter((c) => !sameValue(c.before, c.after))
}

/** Sets each changed entity in `current` to its `side` state: replacing, adding, or removing it. */
export function applyEntityChanges<T extends { id: string }>(current: T[], changes: EntityChange<T>[], side: 'before' | 'after'): T[] {
  const target = new Map(changes.map((c) => [c.id, c[side]]))
  const result = current.filter((x) => !target.has(x.id) || target.get(x.id) !== null).map((x) => (target.has(x.id) ? target.get(x.id)! : x))
  for (const [id, value] of target) if (value && !current.some((x) => x.id === id)) result.push(value)
  return result
}

export interface Snapshot {
  tasks: Task[]
  lists: TaskList[]
  folders: TaskFolder[]
}

/**
 * The changes that undo `entry`, given the current state: every entity the entry touched goes back to its
 * "before" state. Returns the undo's own changes (current -> restored), ready to log as a new entry.
 */
export function undoChanges(entry: ActivityEntry, current: Snapshot): ActivityChanges {
  const revert = <T extends { id: string }>(items: T[], changes: EntityChange<T>[]): EntityChange<T>[] =>
    diffById(
      items.filter((x) => changes.some((c) => c.id === x.id)),
      applyEntityChanges(items, changes, 'before').filter((x) => changes.some((c) => c.id === x.id))
    )
  return {
    tasks: revert(current.tasks, entry.changes.tasks),
    lists: revert(current.lists, entry.changes.lists),
    folders: revert(current.folders, entry.changes.folders)
  }
}

/** Names of the things the entry touched that have changed again since, which undoing would overwrite. */
export function changedSince(entry: ActivityEntry, current: Snapshot): string[] {
  const names: string[] = []
  const check = <T extends { id: string; name?: string; title?: string }>(items: T[], changes: EntityChange<T>[]) => {
    for (const c of changes) {
      const now = items.find((x) => x.id === c.id) ?? null
      if (!sameValue(withoutTimestamp(now), withoutTimestamp(c.after))) {
        const ref = now ?? c.after ?? c.before
        names.push(`“${ref?.title ?? ref?.name ?? 'Untitled'}”`)
      }
    }
  }
  check(current.tasks, entry.changes.tasks)
  check(current.lists, entry.changes.lists)
  check(current.folders, entry.changes.folders)
  return names
}

/** Ignores `updatedAt`, which changes on every save without the content changing. */
function withoutTimestamp<T>(x: T | null): unknown {
  if (!x || typeof x !== 'object' || !('updatedAt' in x)) return x
  const { updatedAt: _ignored, ...rest } = x as T & { updatedAt: string }
  return rest
}

// ---- Summaries ----

const q = (s: string) => `“${s}”`

/** A one-line description of an edit to a task, naming the most notable thing that changed. */
export function describeTaskEdit(before: Task, after: Task, listName: (id: string) => string): string {
  const t = q(after.title)
  if (before.completed !== after.completed) return after.completed ? `Completed ${t}` : `Marked ${t} as not done`
  if (before.listId !== after.listId) return `Moved ${t} to ${listName(after.listId)}`
  if (before.title !== after.title) return `Renamed task ${q(before.title)} to ${t}`
  if (before.priority !== after.priority) return `Changed ${t} from P${before.priority} to P${after.priority}`
  if (before.starred !== after.starred) return after.starred ? `Starred ${t}` : `Unstarred ${t}`
  if (before.dueDate !== after.dueDate) return after.dueDate ? `Set ${t} due ${formatDay(after.dueDate)}` : `Removed the due date from ${t}`
  if (before.notes !== after.notes) return `Edited the notes of ${t}`
  return `Edited ${t}`
}

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { timeZone: 'UTC', month: 'short', day: 'numeric' })
}

/** "Moved list “X” into “Folder”" and the like, for a drag in the sidebar. */
export function describeSidebarMove(changes: ActivityChanges, folders: TaskFolder[], item: { kind: 'list' | 'folder'; id: string }): string {
  if (item.kind === 'folder') {
    const f = changes.folders.find((c) => c.id === item.id)?.after
    return `Moved folder ${q(f?.name ?? 'Untitled')}`
  }
  const c = changes.lists.find((x) => x.id === item.id)
  const name = q(c?.after?.name ?? 'Untitled')
  const from = c?.before?.folderId ?? null
  const to = c?.after?.folderId ?? null
  const folderName = (id: string) => q(folders.find((f) => f.id === id)?.name ?? 'a folder')
  if (from !== to && to) return `Moved list ${name} into ${folderName(to)}`
  if (from !== to && from) return `Moved list ${name} out of ${folderName(from)}`
  return `Moved list ${name}`
}
