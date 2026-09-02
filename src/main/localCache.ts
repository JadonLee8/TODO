import { app } from 'electron'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import type { SyncedSettings, Task, TaskList } from '@shared/types'
import { DEFAULT_SYNCED_SETTINGS } from '@shared/types'

/**
 * Local-first cache mirroring the shape of the GitHub repo's `data/` directory:
 *   cache/tasks/<id>.json, cache/lists.json, cache/settings.json
 * `cache/synced/...` holds the last content known to match GitHub exactly — used as the
 * "base" for conflict comparisons and to know each file's last-known blob sha.
 * `sync-meta.json` tracks which files have local edits pending push.
 */

export interface SyncMeta {
  fileShas: Record<string, string>
  dirtyTaskIds: string[]
  deletedTaskIds: string[]
  /** Tasks with an unresolved edit-vs-edit conflict (persisted so a restart doesn't lose them). */
  conflictTaskIds: string[]
  listsDirty: boolean
  settingsDirty: boolean
  lastSyncedAt: string | null
}

const EMPTY_META: SyncMeta = {
  fileShas: {},
  dirtyTaskIds: [],
  deletedTaskIds: [],
  conflictTaskIds: [],
  listsDirty: false,
  settingsDirty: false,
  lastSyncedAt: null
}

function root(): string {
  return join(app.getPath('userData'), 'cache')
}
function tasksDir(): string {
  return join(root(), 'tasks')
}
function syncedTasksDir(): string {
  return join(root(), 'synced', 'tasks')
}
function conflictsDir(): string {
  return join(root(), 'conflicts')
}
function listsPath(): string {
  return join(root(), 'lists.json')
}
function syncedListsPath(): string {
  return join(root(), 'synced', 'lists.json')
}
function settingsPath(): string {
  return join(root(), 'settings.json')
}
function syncedSettingsPath(): string {
  return join(root(), 'synced', 'settings.json')
}
function syncMetaPath(): string {
  return join(root(), 'sync-meta.json')
}

export function ensureCacheDirs(): void {
  mkdirSync(tasksDir(), { recursive: true })
  mkdirSync(syncedTasksDir(), { recursive: true })
  mkdirSync(conflictsDir(), { recursive: true })
}

function readJson<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback
  return JSON.parse(readFileSync(path, 'utf8')) as T
}
function writeJson(path: string, value: unknown): void {
  writeFileSync(path, JSON.stringify(value, null, 2))
}

// ---- Tasks ----

export function getAllTasks(): Task[] {
  if (!existsSync(tasksDir())) return []
  return readdirSync(tasksDir())
    .filter((f) => f.endsWith('.json'))
    .map((f) => readJson<Task>(join(tasksDir(), f), null as unknown as Task))
    .filter(Boolean)
}

export function getTask(id: string): Task | null {
  const path = join(tasksDir(), `${id}.json`)
  return existsSync(path) ? readJson<Task>(path, null as unknown as Task) : null
}

export function writeTaskLocal(task: Task): void {
  writeJson(join(tasksDir(), `${task.id}.json`), task)
}

export function removeTaskLocal(id: string): void {
  const path = join(tasksDir(), `${id}.json`)
  if (existsSync(path)) rmSync(path)
}

export function getSyncedTask(id: string): Task | null {
  const path = join(syncedTasksDir(), `${id}.json`)
  return existsSync(path) ? readJson<Task>(path, null as unknown as Task) : null
}

export function setSyncedTask(task: Task): void {
  writeJson(join(syncedTasksDir(), `${task.id}.json`), task)
}

export function removeSyncedTask(id: string): void {
  const path = join(syncedTasksDir(), `${id}.json`)
  if (existsSync(path)) rmSync(path)
}

// ---- Lists ----

export function getLists(): TaskList[] {
  return readJson<TaskList[]>(listsPath(), [])
}
export function writeListsLocal(lists: TaskList[]): void {
  writeJson(listsPath(), lists)
}
export function getSyncedLists(): TaskList[] | null {
  return existsSync(syncedListsPath()) ? readJson<TaskList[]>(syncedListsPath(), []) : null
}
export function setSyncedLists(lists: TaskList[]): void {
  writeJson(syncedListsPath(), lists)
}

// ---- Settings ----

export function getSettings(): SyncedSettings {
  return readJson<SyncedSettings>(settingsPath(), DEFAULT_SYNCED_SETTINGS)
}
export function writeSettingsLocal(settings: SyncedSettings): void {
  writeJson(settingsPath(), settings)
}
export function getSyncedSettings(): SyncedSettings | null {
  return existsSync(syncedSettingsPath()) ? readJson<SyncedSettings>(syncedSettingsPath(), DEFAULT_SYNCED_SETTINGS) : null
}
export function setSyncedSettings(settings: SyncedSettings): void {
  writeJson(syncedSettingsPath(), settings)
}

// ---- Sync metadata ----

export function getSyncMeta(): SyncMeta {
  return readJson<SyncMeta>(syncMetaPath(), EMPTY_META)
}
export function writeSyncMeta(meta: SyncMeta): void {
  writeJson(syncMetaPath(), meta)
}

export function markTaskDirty(id: string): void {
  const meta = getSyncMeta()
  if (!meta.dirtyTaskIds.includes(id)) meta.dirtyTaskIds.push(id)
  meta.deletedTaskIds = meta.deletedTaskIds.filter((x) => x !== id)
  writeSyncMeta(meta)
}

export function markTaskDeleted(id: string): void {
  const meta = getSyncMeta()
  meta.dirtyTaskIds = meta.dirtyTaskIds.filter((x) => x !== id)
  if (!meta.deletedTaskIds.includes(id)) meta.deletedTaskIds.push(id)
  writeSyncMeta(meta)
}

// ---- Conflicts ----

export function getConflictRemote(id: string): Task | null {
  const path = join(conflictsDir(), `${id}.json`)
  return existsSync(path) ? readJson<Task>(path, null as unknown as Task) : null
}

export function markTaskConflict(id: string, remoteVersion: Task): void {
  writeJson(join(conflictsDir(), `${id}.json`), remoteVersion)
  const meta = getSyncMeta()
  if (!meta.conflictTaskIds.includes(id)) meta.conflictTaskIds.push(id)
  writeSyncMeta(meta)
}

export function clearTaskConflict(id: string): void {
  const path = join(conflictsDir(), `${id}.json`)
  if (existsSync(path)) rmSync(path)
  const meta = getSyncMeta()
  meta.conflictTaskIds = meta.conflictTaskIds.filter((x) => x !== id)
  writeSyncMeta(meta)
}

/** Marks a conflicted task's local copy as accepted-remote: local now matches remote, nothing left to push. */
export function acceptRemoteTask(task: Task): void {
  writeTaskLocal(task)
  setSyncedTask(task)
  const meta = getSyncMeta()
  meta.dirtyTaskIds = meta.dirtyTaskIds.filter((x) => x !== task.id)
  writeSyncMeta(meta)
}

export function markListsDirty(): void {
  const meta = getSyncMeta()
  meta.listsDirty = true
  writeSyncMeta(meta)
}

export function markSettingsDirty(): void {
  const meta = getSyncMeta()
  meta.settingsDirty = true
  writeSyncMeta(meta)
}
