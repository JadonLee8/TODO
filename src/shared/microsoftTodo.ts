import type { Priority, Task, TaskFolder, TaskList } from './types'
import { MAIN_LIST_ID } from './types'

/**
 * Importing from the Microsoft To Do Windows app. The app keeps a full offline copy of each signed-in account in a
 * SQLite database (`AccountsRoot/<account>/todosqlite.db` under its package folder), so importing needs no Microsoft
 * sign-in or Graph permissions. The main process reads that database into a `MsTodoSnapshot`; everything here is pure.
 */

// ---- Snapshot read from the database ----

export interface MsTodoGroup {
  id: string
  name: string
  /** Sort key: Microsoft To Do orders the sidebar by these strings (ISO timestamps). */
  position: string
}

export interface MsTodoList {
  id: string
  name: string
  position: string
  /** The built-in "Tasks" list. */
  isDefault: boolean
  groupId: string | null
  /** Set on special lists, e.g. `com.microsoft.outlook.email.flagged` for Flagged Emails. */
  listType: string | null
}

export interface MsTodoStep {
  title: string
  completed: boolean
  position: string
}

export interface MsTodoTask {
  id: string
  listId: string
  title: string
  notes: string
  completed: boolean
  /** Marked important (the star). */
  important: boolean
  /** YYYY-MM-DD. */
  dueDate: string | null
  createdAt: string | null
  completedAt: string | null
  steps: MsTodoStep[]
}

export interface MsTodoSnapshot {
  groups: MsTodoGroup[]
  lists: MsTodoList[]
  tasks: MsTodoTask[]
}

/** Lists that mirror something else (flagged Outlook emails) rather than holding the user's own tasks. */
const SKIPPED_LIST_TYPES = new Set(['com.microsoft.outlook.email.flagged'])

export function isImportableList(list: MsTodoList): boolean {
  return !SKIPPED_LIST_TYPES.has(list.listType ?? '')
}

const byPosition = <T extends { position: string }>(a: T, b: T) => (a.position < b.position ? -1 : a.position > b.position ? 1 : 0)

// ---- Planning an import ----

/** What this device imported before (our ids), so each task is imported once and deleted lists stay deleted. */
export interface ImportLedger {
  taskIds: string[]
  listIds: string[]
  folderIds: string[]
}

export const EMPTY_LEDGER: ImportLedger = { taskIds: [], listIds: [], folderIds: [] }

export interface ImportContext {
  lists: TaskList[]
  folders: TaskFolder[]
  /** Whether a task with this id is already in the local cache (e.g. another device imported it). */
  hasTask: (id: string) => boolean
  ledger: ImportLedger
}

export interface ImportOptions {
  includeCompleted: boolean
  defaultPriority: Priority
  /** Completed tasks finished at least this many days ago are imported already archived. */
  archiveAfterDays: number
}

/** Our id for a Microsoft To Do entity. Deterministic, so two devices importing the same account write the same files. */
export type IdFor = (kind: 'task' | 'list' | 'folder', msId: string) => string

export interface ImportPlan {
  /** The full lists and folders after the import (unchanged arrays when nothing was added). */
  lists: TaskList[]
  folders: TaskFolder[]
  listsChanged: boolean
  foldersChanged: boolean
  createdLists: number
  createdFolders: number
  /** New tasks to write. */
  tasks: Task[]
  ledger: ImportLedger
}

const sameName = (a: string, b: string) => a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase()

/**
 * Works out which lists, folders and tasks to create. Microsoft To Do's built-in Tasks list maps to the main list,
 * groups become folders, and a list or folder whose name matches an existing one (ignoring case) is merged into it.
 * A list or folder this device imported before and the user since deleted is not recreated: its new tasks go to the
 * main list (or its lists to the top level).
 */
export function planImport(snapshot: MsTodoSnapshot, ctx: ImportContext, options: ImportOptions, idFor: IdFor, now: Date): ImportPlan {
  const lists = [...ctx.lists]
  const folders = [...ctx.folders]
  const ledger: ImportLedger = { taskIds: [...ctx.ledger.taskIds], listIds: [...ctx.ledger.listIds], folderIds: [...ctx.ledger.folderIds] }
  const importedTasks = new Set(ledger.taskIds)
  let createdLists = 0
  let createdFolders = 0

  let nextTopOrder = Math.max(-1, ...lists.filter((l) => !l.folderId).map((l) => l.order), ...folders.map((f) => f.order)) + 1
  const nextOrderIn = (folderId: string) => Math.max(-1, ...lists.filter((l) => l.folderId === folderId).map((l) => l.order)) + 1

  // Groups -> folders, created only when one of their lists is created.
  const groupsById = new Map(snapshot.groups.map((g) => [g.id, g]))
  const folderForGroup = new Map<string, string | null>()
  function resolveFolder(groupId: string | null): string | null {
    if (!groupId) return null
    const group = groupsById.get(groupId)
    if (!group) return null
    if (folderForGroup.has(groupId)) return folderForGroup.get(groupId)!
    const id = idFor('folder', group.id)
    let folderId: string | null
    if (folders.some((f) => f.id === id)) folderId = id
    else if (ledger.folderIds.includes(id)) folderId = null // imported before, then deleted
    else {
      const named = folders.find((f) => sameName(f.name, group.name))
      if (named) folderId = named.id
      else {
        folders.push({ id, name: group.name.trim() || 'Untitled folder', order: nextTopOrder++ })
        ledger.folderIds.push(id)
        createdFolders++
        folderId = id
      }
    }
    folderForGroup.set(groupId, folderId)
    return folderId
  }

  // Lists, in Microsoft To Do's sidebar order (groups and lists share one order).
  const groupPosition = (l: MsTodoList) => (l.groupId ? groupsById.get(l.groupId)?.position : undefined) ?? l.position
  const sortedLists = snapshot.lists
    .filter(isImportableList)
    .sort((a, b) => byPosition({ position: groupPosition(a) }, { position: groupPosition(b) }) || byPosition(a, b))
  const listFor = new Map<string, { id: string; name: string }>()
  for (const msList of sortedLists) {
    if (msList.isDefault) {
      listFor.set(msList.id, { id: MAIN_LIST_ID, name: msList.name })
      continue
    }
    const id = idFor('list', msList.id)
    let target: string
    if (lists.some((l) => l.id === id)) target = id
    else if (ledger.listIds.includes(id)) target = MAIN_LIST_ID // imported before, then deleted
    else {
      const named = lists.find((l) => sameName(l.name, msList.name))
      if (named) target = named.id
      else {
        const folderId = resolveFolder(msList.groupId)
        lists.push({ id, name: msList.name.trim() || 'Untitled list', order: folderId ? nextOrderIn(folderId) : nextTopOrder++, folderId })
        ledger.listIds.push(id)
        createdLists++
        target = id
      }
    }
    listFor.set(msList.id, { id: target, name: msList.name })
  }

  const tasks: Task[] = []
  const nowIso = now.toISOString()
  const archiveCutoff = now.getTime() - options.archiveAfterDays * 24 * 60 * 60 * 1000
  for (const ms of snapshot.tasks) {
    const list = listFor.get(ms.listId)
    if (!list) continue // a skipped list (flagged emails) or one that no longer exists
    if (ms.completed && !options.includeCompleted) continue // not ledgered, so turning the option on imports it later
    const id = idFor('task', ms.id)
    if (importedTasks.has(id)) continue
    importedTasks.add(id)
    ledger.taskIds.push(id)
    if (ctx.hasTask(id)) continue

    const createdAt = toIso(ms.createdAt) ?? nowIso
    const completedAt = ms.completed ? (toIso(ms.completedAt) ?? createdAt) : null
    tasks.push({
      id,
      listId: list.id,
      title: ms.title.trim() || '(No title)',
      notes: taskNotes(ms),
      priority: options.defaultPriority,
      starred: ms.important,
      completed: ms.completed,
      createdAt,
      updatedAt: nowIso,
      completedAt,
      archived: completedAt !== null && new Date(completedAt).getTime() <= archiveCutoff,
      dueDate: ms.dueDate && /^\d{4}-\d{2}-\d{2}$/.test(ms.dueDate) ? `${ms.dueDate}T00:00:00.000Z` : null,
      source: { type: 'microsoft_todo', taskId: ms.id, listName: list.name }
    })
  }

  return {
    lists: createdLists ? lists : ctx.lists,
    folders: createdFolders ? folders : ctx.folders,
    listsChanged: createdLists > 0,
    foldersChanged: createdFolders > 0,
    createdLists,
    createdFolders,
    tasks,
    ledger
  }
}

/** The task's note, followed by its steps as a Markdown checklist. */
export function taskNotes(task: Pick<MsTodoTask, 'notes' | 'steps'>): string {
  const steps = [...task.steps].sort(byPosition).map((s) => `- [${s.completed ? 'x' : ' '}] ${s.title.trim()}`)
  return [task.notes.trim(), steps.join('\n')].filter(Boolean).join('\n\n')
}

/** Normalises Microsoft To Do's timestamps (`2026-11-13T17:35:27.5437111Z`, or a bare `2025-08-19`) to ISO 8601. */
export function toIso(value: string | null): string | null {
  if (!value) return null
  const text = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : value.replace(/(\.\d{3})\d+/, '$1')
  const date = new Date(text)
  return isNaN(date.getTime()) ? null : date.toISOString()
}

// ---- Reading a database that is open in Microsoft To Do ----

const WAL_MAGIC_LE = 0x377f0682
const WAL_MAGIC_BE = 0x377f0683

/** SQLite's WAL checksum over `data` (a multiple of 8 bytes), continuing from (s0, s1). */
export function walChecksum(data: Uint8Array, bigEndian: boolean, s0 = 0, s1 = 0): [number, number] {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  for (let i = 0; i + 8 <= data.length; i += 8) {
    s0 = (s0 + view.getUint32(i, !bigEndian) + s1) >>> 0
    s1 = (s1 + view.getUint32(i + 4, !bigEndian) + s0) >>> 0
  }
  return [s0, s1]
}

/**
 * Microsoft To Do keeps its database in WAL mode, so while it runs, recent changes sit in `todosqlite.db-wal`.
 * This copies every committed WAL frame into the database image and marks the image as a rollback-journal database,
 * giving one self-contained file that an in-memory SQLite (sql.js) can open. Frames after the last commit, or after
 * a frame whose salt or checksum doesn't match (left over from an earlier WAL generation), are ignored, as SQLite does.
 */
export function applyWal(db: Uint8Array, wal: Uint8Array | null): Uint8Array {
  let out = db
  if (wal && wal.length >= 32) {
    const view = new DataView(wal.buffer, wal.byteOffset, wal.byteLength)
    const magic = view.getUint32(0)
    const pageSize = view.getUint32(8)
    if ((magic === WAL_MAGIC_LE || magic === WAL_MAGIC_BE) && pageSize >= 512) {
      const bigEndian = magic === WAL_MAGIC_BE
      const salt1 = view.getUint32(16)
      const salt2 = view.getUint32(20)
      let [s0, s1] = walChecksum(wal.subarray(0, 24), bigEndian)
      if (s0 === view.getUint32(24) && s1 === view.getUint32(28)) {
        const committed = new Map<number, Uint8Array>()
        const pending = new Map<number, Uint8Array>()
        let pageCount = 0
        for (let off = 32; off + 24 + pageSize <= wal.length; off += 24 + pageSize) {
          if (view.getUint32(off + 8) !== salt1 || view.getUint32(off + 12) !== salt2) break
          ;[s0, s1] = walChecksum(wal.subarray(off, off + 8), bigEndian, s0, s1)
          ;[s0, s1] = walChecksum(wal.subarray(off + 24, off + 24 + pageSize), bigEndian, s0, s1)
          if (s0 !== view.getUint32(off + 16) || s1 !== view.getUint32(off + 20)) break
          pending.set(view.getUint32(off), wal.subarray(off + 24, off + 24 + pageSize))
          const commitSize = view.getUint32(off + 4)
          if (commitSize) {
            for (const [page, data] of pending) committed.set(page, data)
            pending.clear()
            pageCount = commitSize
          }
        }
        if (pageCount) {
          out = new Uint8Array(pageCount * pageSize)
          out.set(db.subarray(0, Math.min(db.length, out.length)))
          for (const [page, data] of committed) if (page <= pageCount) out.set(data, (page - 1) * pageSize)
        }
      }
    }
  }
  // Bytes 18-19 are the file format versions: 2 = WAL. Make it 1 (rollback journal) so no WAL file is looked for.
  if (out.length >= 100 && (out[18] === 2 || out[19] === 2)) {
    if (out === db) out = db.slice()
    out[18] = 1
    out[19] = 1
  }
  return out
}
