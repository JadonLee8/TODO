import { app, dialog, shell } from 'electron'
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'
import type { Task } from '@shared/types'
import { MAIN_LIST_ID } from '@shared/types'
import {
  BASE_FILE,
  INBOX_FILE,
  INBOX_TEMPLATE,
  TASKS_SUBFOLDER,
  extractVaultNotes,
  noteTaskId,
  obsidianOpenUri,
  parseInbox,
  renderTaskNote,
  renderTasksBase,
  taskNoteFileNames
} from '@shared/obsidian'
import { newId } from '@shared/id'
import * as cache from '../localCache'
import * as secureStore from '../secureStore'
import type { MainExtension, StepResult } from './types'

/**
 * Mirrors tasks into an Obsidian vault as Markdown notes and turns inbox items into tasks. It writes plain files
 * (no Obsidian plugin needed, and it works while Obsidian is closed); Obsidian notices changed files on its own.
 * It only ever writes inside <vault>/<folder>, and only deletes notes whose `todo_id` property names a task.
 */

/** Which note this device last wrote for each task, so renamed tasks move their note instead of leaving a copy. */
interface Ledger {
  /** Absolute path of the folder the notes were written to; a different folder starts a fresh ledger. */
  root: string
  /** Task id → file name inside Tasks/. */
  files: Record<string, string>
}

function ledgerPath(): string {
  return join(app.getPath('userData'), 'obsidian-ledger.json')
}

function loadLedger(root: string): Ledger {
  try {
    const stored = JSON.parse(readFileSync(ledgerPath(), 'utf8')) as Ledger
    if (resolve(stored.root) === resolve(root)) return stored
  } catch {
    // Missing or unreadable: start over. Worst case, notes for renamed tasks are rewritten under the new name.
  }
  return { root, files: {} }
}

function saveLedger(ledger: Ledger): void {
  writeFileSync(ledgerPath(), JSON.stringify(ledger, null, 2))
}

/** <vault>/<folder>, or null when this device has no vault set. */
function exportRoot(): string | null {
  const vault = secureStore.loadLocalSettings().obsidianVaultPath
  if (!vault) return null
  const folder = cache.getSettings().extensions.obsidian.folder.trim().replace(/^[\\/]+|[\\/]+$/g, '')
  const root = resolve(vault, folder)
  // A folder setting like "../x" must not escape the vault.
  if (!root.startsWith(resolve(vault))) throw new Error(`The folder “${folder}” is outside the vault`)
  return root
}

function requireVault(): string {
  const vault = secureStore.loadLocalSettings().obsidianVaultPath
  if (!vault || !existsSync(vault)) throw new Error(`Vault folder not found: ${vault || '(none set)'}`)
  return vault
}

function readIfExists(path: string): string | null {
  return existsSync(path) ? readFileSync(path, 'utf8') : null
}

/** Writes only when the content changed, so file-syncing tools (Google Drive, Obsidian Sync) don't churn. */
function writeIfChanged(path: string, content: string): boolean {
  if (readIfExists(path) === content) return false
  writeFileSync(path, content)
  return true
}

async function exportTasks(): Promise<StepResult> {
  requireVault()
  const root = exportRoot()!
  const settings = cache.getSettings().extensions.obsidian
  const tasksDir = join(root, TASKS_SUBFOLDER)
  mkdirSync(tasksDir, { recursive: true })

  const lists = cache.getLists()
  const tasks = cache.getAllTasks().filter((t) => settings.includeCompleted || (!t.completed && !t.archived))
  const names = taskNoteFileNames(tasks)
  const ledger = loadLedger(root)
  const nextFiles: Record<string, string> = {}
  let written = 0
  let removed = 0

  // Pass 1: read each task's "Vault notes" from wherever its note was last written, before anything moves.
  const vaultNotes = new Map<string, string | null>()
  for (const task of tasks) {
    for (const name of [ledger.files[task.id], names.get(task.id)!]) {
      const content = name ? readIfExists(join(tasksDir, name)) : null
      if (content !== null && noteTaskId(content) === task.id) {
        vaultNotes.set(task.id, extractVaultNotes(content))
        break
      }
    }
  }

  // Pass 2: write every note under its current name.
  let skipped = 0
  for (const task of tasks) {
    const name = names.get(task.id)!
    const path = join(tasksDir, name)
    const existing = readIfExists(path)
    if (existing !== null && noteTaskId(existing) === null) {
      // A note the app didn't write has this name. Never overwrite the user's own file.
      skipped++
      continue
    }
    if (writeIfChanged(path, renderTaskNote(task, lists, vaultNotes.get(task.id) ?? null))) written++
    nextFiles[task.id] = name
  }

  // Pass 3: remove notes left behind by renamed, deleted or now-hidden tasks (only ones the app wrote for them).
  const inUse = new Set(Object.values(nextFiles).map((n) => n.toLowerCase()))
  for (const [id, name] of Object.entries(ledger.files)) {
    if (inUse.has(name.toLowerCase())) continue
    if (removeOwnNote(join(tasksDir, name), id)) removed++
  }
  saveLedger({ root, files: nextFiles })

  // The Base is written once; after that it's the user's to customise.
  const basePath = join(root, BASE_FILE)
  if (!existsSync(basePath)) writeFileSync(basePath, renderTasksBase(relativeFolder()))

  const parts = []
  if (written) parts.push(`updated ${written} note${written === 1 ? '' : 's'}`)
  if (removed) parts.push(`removed ${removed}`)
  if (skipped) parts.push(`skipped ${skipped} whose name is taken by a note of yours`)
  return { summary: parts.length ? capitalize(parts.join(', ')) : 'Vault notes up to date', changedTasks: 0 }
}

/** Deletes a note only if the app wrote it for this task. */
function removeOwnNote(path: string, taskId: string): boolean {
  const content = readIfExists(path)
  if (content === null || noteTaskId(content) !== taskId) return false
  rmSync(path)
  return true
}

function relativeFolder(): string {
  return cache.getSettings().extensions.obsidian.folder.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
}

async function captureInbox(now: Date): Promise<StepResult> {
  const settings = cache.getSettings().extensions.obsidian
  if (!settings.inboxCapture) return { summary: '', changedTasks: 0 }
  requireVault()
  const root = exportRoot()!
  mkdirSync(root, { recursive: true })
  const inboxPath = join(root, INBOX_FILE)
  const content = readIfExists(inboxPath)
  if (content === null) {
    writeFileSync(inboxPath, INBOX_TEMPLATE)
    return { summary: '', changedTasks: 0 }
  }

  const { items, remaining } = parseInbox(content)
  if (!items.length) return { summary: '', changedTasks: 0 }
  const listId = cache.getLists().some((l) => l.id === settings.inboxListId) ? settings.inboxListId : MAIN_LIST_ID
  const notePath = [relativeFolder(), INBOX_FILE].filter(Boolean).join('/')
  const iso = now.toISOString()
  for (const item of items) {
    const task: Task = {
      id: newId(),
      listId,
      title: item.title,
      notes: '',
      priority: item.priority ?? 3,
      starred: false,
      completed: false,
      createdAt: iso,
      updatedAt: iso,
      completedAt: null,
      archived: false,
      dueDate: item.dueDate ? `${item.dueDate}T00:00:00.000Z` : null,
      source: { type: 'obsidian_inbox', notePath }
    }
    cache.writeTaskLocal(task)
    cache.markTaskDirty(task.id)
  }
  // Remove the items only after their tasks are safely in the cache.
  writeFileSync(inboxPath, remaining)
  return { summary: `Captured ${items.length} task${items.length === 1 ? '' : 's'} from the inbox`, changedTasks: items.length }
}

export const obsidianExtension: MainExtension = {
  id: 'obsidian',
  isReady: () => !!secureStore.loadLocalSettings().obsidianVaultPath,
  importTasks: captureInbox,
  exportTasks
}

// ---- Called from IPC ----

/** Asks for the vault folder. Returns null if cancelled. */
export async function pickVault(): Promise<string | null> {
  const res = await dialog.showOpenDialog({ title: 'Choose your Obsidian vault folder', properties: ['openDirectory'] })
  if (res.canceled || !res.filePaths[0]) return null
  const path = res.filePaths[0]
  if (!existsSync(join(path, '.obsidian')) || !statSync(join(path, '.obsidian')).isDirectory()) {
    throw new Error('That folder isn’t an Obsidian vault (it has no .obsidian folder). Pick the top folder of your vault.')
  }
  secureStore.saveLocalSettings({ obsidianVaultPath: path })
  return path
}

/** Opens a task's note, or the inbox / Base when given those names, in Obsidian. */
export async function openInObsidian(target: { taskId: string } | { file: 'inbox' | 'base' }): Promise<void> {
  requireVault()
  const root = exportRoot()!
  let path: string
  if ('taskId' in target) {
    const name = loadLedger(root).files[target.taskId]
    if (!name) throw new Error('This task has no note in the vault yet. Sync first.')
    path = join(root, TASKS_SUBFOLDER, name)
  } else {
    path = join(root, target.file === 'inbox' ? INBOX_FILE : BASE_FILE)
  }
  if (!existsSync(path)) throw new Error('Not in the vault yet. Sync first.')
  await shell.openExternal(obsidianOpenUri(path))
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
