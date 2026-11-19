import { app } from 'electron'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js'
import type { MicrosoftTodoAccount } from '@shared/types'
import {
  EMPTY_LEDGER,
  applyWal,
  isImportableList,
  planImport,
  type ImportLedger,
  type MsTodoSnapshot,
  type MsTodoStep
} from '@shared/microsoftTodo'
import * as cache from '../localCache'
import * as secureStore from '../secureStore'
import { stableUuid } from './stableId'
import type { MainExtension, StepResult } from './types'

/**
 * Imports lists and tasks from the Microsoft To Do Windows app by reading its local database (read-only, from a copy
 * in memory). No Microsoft sign-in or API permissions are involved. Each task is imported once: a per-device ledger
 * remembers what was imported, so later Syncs only bring in tasks added in Microsoft To Do since, and editing or
 * deleting an imported task never brings it back. Changes made in Microsoft To Do after a task was imported aren't
 * carried over.
 */

const PACKAGE_DIR = 'Microsoft.Todos_8wekyb3d8bbwe'

function accountsRoot(): string {
  const localAppData = process.env.LOCALAPPDATA ?? join(app.getPath('home'), 'AppData', 'Local')
  return join(localAppData, 'Packages', PACKAGE_DIR, 'LocalState', 'AccountsRoot')
}

function databasePath(accountId: string): string {
  return join(accountsRoot(), accountId, 'todosqlite.db')
}

let sqlJs: Promise<SqlJsStatic> | null = null
const loadSqlJs = () => (sqlJs ??= initSqlJs())

function readIfExists(path: string): Buffer | null {
  try {
    return readFileSync(path)
  } catch {
    return null
  }
}

/**
 * The database as one self-contained image. Microsoft To Do may be running and checkpointing its WAL while we read,
 * so the WAL is read before and after the database; if it changed in between, read again.
 */
function readDatabaseImage(accountId: string): Uint8Array {
  const path = databasePath(accountId)
  if (!existsSync(path)) throw new Error('That Microsoft To Do account is no longer on this computer. Pick an account again.')
  for (let attempt = 0; attempt < 5; attempt++) {
    const walBefore = readIfExists(`${path}-wal`)
    const db = readFileSync(path)
    const walAfter = readIfExists(`${path}-wal`)
    if (walBefore === walAfter || (walBefore && walAfter && walBefore.equals(walAfter))) return applyWal(db, walAfter)
  }
  throw new Error('Microsoft To Do kept changing its database while it was being read. Close Microsoft To Do and try again.')
}

function rows<T>(db: Database, sql: string): T[] {
  const stmt = db.prepare(sql)
  const out: T[] = []
  try {
    while (stmt.step()) out.push(stmt.getAsObject() as T)
  } finally {
    stmt.free()
  }
  return out
}

/** A row's id that is the same on every device: the server id once the item has synced, else the local one. */
const STABLE_ID = "COALESCE(NULLIF(online_id, ''), local_id)"
const LIVE = 'deleted = 0 AND delete_after_sync = 0'

async function readSnapshot(accountId: string): Promise<MsTodoSnapshot> {
  const SQL = await loadSqlJs()
  let db: Database
  try {
    db = new SQL.Database(readDatabaseImage(accountId))
  } catch (err) {
    throw new Error(`Couldn't open Microsoft To Do's database: ${err instanceof Error ? err.message : String(err)}`)
  }
  try {
    const groups = rows<{ local_id: string; id: string; name: string | null; position: string | null }>(
      db,
      `SELECT local_id, ${STABLE_ID} AS id, name, position FROM groups WHERE ${LIVE}`
    )
    const lists = rows<{
      local_id: string
      id: string
      name: string | null
      position: string | null
      is_default: number
      group_local_id: string | null
      folder_type: string | null
    }>(db, `SELECT local_id, ${STABLE_ID} AS id, name, position, is_default, group_local_id, folder_type FROM task_folders WHERE ${LIVE}`)
    const tasks = rows<{
      local_id: string
      id: string
      task_folder_local_id: string
      subject: string | null
      body: string | null
      status: string | null
      importance: number | null
      due_date: string | null
      created_datetime: string | null
      completed_datetime: string | null
    }>(
      db,
      // The app keeps the note's text in original_body_content; body_content is usually empty.
      `SELECT local_id, ${STABLE_ID} AS id, task_folder_local_id, subject,
              COALESCE(NULLIF(original_body_content, ''), body_content, '') AS body,
              status, importance, due_date, created_datetime, completed_datetime
       FROM tasks WHERE ${LIVE}`
    )
    const steps = rows<{ task_local_id: string; subject: string | null; completed: number; position: string | null }>(
      db,
      `SELECT task_local_id, subject, completed, position FROM steps WHERE ${LIVE}`
    )

    const groupId = new Map(groups.map((g) => [g.local_id, g.id]))
    const listId = new Map(lists.map((l) => [l.local_id, l.id]))
    const stepsByTask = new Map<string, MsTodoStep[]>()
    for (const s of steps) {
      if (!s.subject?.trim()) continue
      const list = stepsByTask.get(s.task_local_id) ?? []
      list.push({ title: s.subject, completed: !!s.completed, position: s.position ?? '' })
      stepsByTask.set(s.task_local_id, list)
    }

    return {
      groups: groups.map((g) => ({ id: g.id, name: g.name ?? '', position: g.position ?? '' })),
      lists: lists.map((l) => ({
        id: l.id,
        name: l.name ?? '',
        position: l.is_default ? '' : (l.position ?? ''),
        isDefault: !!l.is_default,
        groupId: (l.group_local_id && groupId.get(l.group_local_id)) || null,
        listType: l.folder_type || null
      })),
      tasks: tasks
        .filter((t) => listId.has(t.task_folder_local_id))
        .map((t) => ({
          id: t.id,
          listId: listId.get(t.task_folder_local_id)!,
          title: t.subject ?? '',
          notes: t.body ?? '',
          completed: t.status === 'Completed',
          // Importance is stored as 0 (normal) or 100 (high, shown as a star).
          important: (t.importance ?? 0) > 0,
          dueDate: t.due_date || null,
          createdAt: t.created_datetime || null,
          completedAt: t.completed_datetime || null,
          steps: stepsByTask.get(t.local_id) ?? []
        }))
    }
  } catch (err) {
    throw new Error(`Couldn't read Microsoft To Do's database (the app may have changed its format): ${err instanceof Error ? err.message : String(err)}`)
  } finally {
    db.close()
  }
}

/** Every Microsoft To Do account signed in on this computer, with enough detail to tell them apart. */
export async function listAccounts(): Promise<MicrosoftTodoAccount[]> {
  const root = accountsRoot()
  if (!existsSync(root)) throw new Error('Microsoft To Do isn’t installed for this Windows user, or no account has signed in to it yet.')
  const accounts: MicrosoftTodoAccount[] = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !existsSync(databasePath(entry.name))) continue
    const snapshot = await readSnapshot(entry.name)
    const lists = snapshot.lists.filter(isImportableList)
    const listIds = new Set(lists.map((l) => l.id))
    const tasks = snapshot.tasks.filter((t) => listIds.has(t.listId))
    accounts.push({
      id: entry.name,
      lists: lists.filter((l) => !l.isDefault).length,
      openTasks: tasks.filter((t) => !t.completed).length,
      completedTasks: tasks.filter((t) => t.completed).length,
      listNames: lists
        .filter((l) => !l.isDefault)
        .sort((a, b) => (a.position < b.position ? -1 : a.position > b.position ? 1 : 0))
        .slice(0, 5)
        .map((l) => l.name)
    })
  }
  // The account with the most tasks first: usually the one in use.
  return accounts.sort((a, b) => b.openTasks + b.completedTasks - (a.openTasks + a.completedTasks))
}

// ---- Ledger: what this device imported ----

function ledgerPath(): string {
  return join(app.getPath('userData'), 'microsoft-todo-ledger.json')
}

function loadLedger(): ImportLedger {
  try {
    return existsSync(ledgerPath()) ? { ...EMPTY_LEDGER, ...(JSON.parse(readFileSync(ledgerPath(), 'utf8')) as Partial<ImportLedger>) } : EMPTY_LEDGER
  } catch {
    return EMPTY_LEDGER
  }
}

function saveLedger(ledger: ImportLedger): void {
  writeFileSync(ledgerPath(), JSON.stringify(ledger, null, 2))
}

// ---- Import ----

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

async function importFromMicrosoftTodo(now: Date): Promise<StepResult> {
  const accountId = secureStore.loadLocalSettings().microsoftTodoAccountId
  const settings = cache.getSettings()
  const snapshot = await readSnapshot(accountId)
  const plan = planImport(
    snapshot,
    { lists: cache.getLists(), folders: cache.getFolders(), hasTask: (id) => cache.getTask(id) !== null, ledger: loadLedger() },
    { ...settings.extensions.microsoftTodo, archiveAfterDays: settings.archive.archiveAfterDays },
    (kind, msId) => stableUuid('microsoft-todo', kind, msId),
    now
  )

  // Folders before lists before tasks, so nothing ever points at something that isn't written yet.
  if (plan.foldersChanged) {
    cache.writeFoldersLocal(plan.folders)
    cache.markFoldersDirty()
  }
  if (plan.listsChanged) {
    cache.writeListsLocal(plan.lists)
    cache.markListsDirty()
  }
  for (const task of plan.tasks) cache.writeTaskLocal(task)
  // One sync-meta write for the whole batch (markTaskDirty rewrites it per task).
  const meta = cache.getSyncMeta()
  const newIds = new Set(plan.tasks.map((t) => t.id))
  meta.dirtyTaskIds = [...new Set([...meta.dirtyTaskIds, ...newIds])]
  meta.deletedTaskIds = meta.deletedTaskIds.filter((id) => !newIds.has(id))
  cache.writeSyncMeta(meta)
  saveLedger(plan.ledger)

  if (!plan.tasks.length && !plan.createdLists) return { summary: 'No new tasks', changedTasks: 0 }
  const made = [plan.createdLists && plural(plan.createdLists, 'new list'), plan.createdFolders && plural(plan.createdFolders, 'folder')].filter(Boolean)
  return {
    summary: `Imported ${plural(plan.tasks.length, 'task')}${made.length ? `, with ${made.join(' and ')}` : ''}`,
    // Lists and folders are pushed by the same Sync as long as a task changed; count them so an import of only
    // empty lists is pushed too.
    changedTasks: plan.tasks.length + plan.createdLists + plan.createdFolders
  }
}

export const microsoftTodoExtension: MainExtension = {
  id: 'microsoft-todo',
  isReady: () => {
    const accountId = secureStore.loadLocalSettings().microsoftTodoAccountId
    return !!accountId && existsSync(databasePath(accountId))
  },
  importTasks: importFromMicrosoftTodo
}
