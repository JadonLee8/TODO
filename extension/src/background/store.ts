import type { CacheStore } from '@shared/cacheStore'
import { createMemoryCacheStore } from '@shared/memoryCacheStore'
import { syncNow } from '@shared/sync'
import { createTask, type NewTaskInput } from '@shared/newTask'
import { newId } from '@shared/id'
import type { SyncResult, Task } from '@shared/types'
import { MAIN_LIST_ID } from '@shared/types'
import { loadConfig } from '../config'
import { CHANGED, type Snapshot, type SyncState } from '../messages'

/**
 * The extension's own copy of the tasks, like the Android app's: the shared in-memory cache, loaded from
 * chrome.storage.local when the service worker starts and written back behind every change. Writes mark what
 * changed, and a sync a moment later pushes them. Chrome stops the service worker when it's idle, so nothing here
 * may rely on staying in memory: everything that matters is in storage.
 */

const CACHE = 'cache:'
const SYNC_STATE = 'syncState'
/** A burst of changes goes up as one sync. */
const SYNC_DELAY_MS = 2000

let loading: Promise<CacheStore> | null = null
const pending = new Map<string, unknown>()
let flushing: Promise<void> = Promise.resolve()
let flushQueued = false

export function cache(): Promise<CacheStore> {
  loading ??= chrome.storage.local.get(null).then((all) =>
    createMemoryCacheStore({
      initial: Object.entries(all)
        .filter(([key]) => key.startsWith(CACHE))
        .map(([key, value]) => [key.slice(CACHE.length), value] as const),
      onChange: (key, value) => {
        pending.set(CACHE + key, value)
        if (!flushQueued) {
          flushQueued = true
          queueMicrotask(() => void flush())
        }
      }
    })
  )
  return loading
}

/** Writes every queued change to chrome.storage.local; resolves once they're stored. */
export function flush(): Promise<void> {
  flushQueued = false
  if (!pending.size) return flushing
  const batch = new Map(pending)
  pending.clear()
  const set: Record<string, unknown> = {}
  const remove: string[] = []
  for (const [key, value] of batch) {
    if (value === undefined) remove.push(key)
    else set[key] = value
  }
  flushing = flushing.then(async () => {
    if (Object.keys(set).length) await chrome.storage.local.set(set)
    if (remove.length) await chrome.storage.local.remove(remove)
  })
  return flushing
}

/** Tells open pages to redraw. Nobody listening (no page open) is fine. */
export function broadcast(): void {
  chrome.runtime.sendMessage({ type: CHANGED }).catch(() => undefined)
}

// ---- Sync ----

let syncState: SyncState = { syncing: false, lastAt: null, lastResult: null }
let syncStateLoaded = false
let running: Promise<SyncResult> | null = null
let again = false
let timer: ReturnType<typeof setTimeout> | null = null

async function loadSyncState(): Promise<SyncState> {
  if (!syncStateLoaded) {
    const stored = (await chrome.storage.local.get(SYNC_STATE))[SYNC_STATE] as SyncState | undefined
    syncState = { ...syncState, ...stored, syncing: running !== null }
    syncStateLoaded = true
  }
  return syncState
}

/** Runs a sync, or joins the one running (and runs another after it, for changes made meanwhile). */
export function runSync(): Promise<SyncResult> {
  if (running) {
    again = true
    return running
  }
  running = doSync().finally(() => {
    running = null
    if (again) {
      again = false
      void runSync()
    }
  })
  return running
}

/** A sync shortly after a change. If the worker is stopped first, the periodic alarm pushes it instead. */
export function syncSoon(): void {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    void runSync()
  }, SYNC_DELAY_MS)
}

async function doSync(): Promise<SyncResult> {
  await loadSyncState()
  const config = await loadConfig()
  if (!config) return { pushed: 0, pulled: 0, conflicts: [], error: 'Not set up: add your repo and token in the settings.', extensions: [] }
  syncState = { ...syncState, syncing: true }
  broadcast()
  let result: SyncResult
  try {
    result = await syncNow(await cache(), config.token, config.owner, config.repo, config.branch)
  } catch (err) {
    result = { pushed: 0, pulled: 0, conflicts: [], error: err instanceof Error ? err.message : String(err), extensions: [] }
  }
  await flush()
  syncState = { syncing: false, lastAt: new Date().toISOString(), lastResult: result }
  await chrome.storage.local.set({ [SYNC_STATE]: { lastAt: syncState.lastAt, lastResult: result } })
  await chrome.action.setBadgeBackgroundColor({ color: '#b42318' })
  await chrome.action.setBadgeText({ text: result.error ? '!' : '' })
  broadcast()
  return result
}

// ---- Reads and writes ----

export async function snapshot(): Promise<Snapshot> {
  const [c, config, sync] = await Promise.all([cache(), loadConfig(), loadSyncState()])
  const lists = c.getLists()
  return {
    configured: config !== null,
    tasks: c.getAllTasks(),
    // A brand-new repo has no lists.json until the app writes one; the main list always exists.
    lists: lists.some((l) => l.id === MAIN_LIST_ID) ? lists : [{ id: MAIN_LIST_ID, name: 'Tasks', order: -1 }, ...lists],
    folders: c.getFolders(),
    settings: c.getSettings(),
    conflicts: c.getSyncMeta().conflictTaskIds.flatMap((id) => {
      const local = c.getTask(id)
      const remote = c.getConflictRemote(id)
      return local && remote ? [{ taskId: id, local, remote, base: c.getSyncedTask(id) }] : []
    }),
    sync
  }
}

async function written(): Promise<void> {
  await flush()
  broadcast()
  syncSoon()
}

export async function addTask(input: NewTaskInput): Promise<Task> {
  const c = await cache()
  const task = createTask(input, newId())
  c.writeTaskLocal(task)
  c.markTaskDirty(task.id)
  await written()
  return task
}

export async function updateTask(task: Task): Promise<void> {
  const c = await cache()
  c.writeTaskLocal({ ...task, updatedAt: new Date().toISOString() })
  c.markTaskDirty(task.id)
  await written()
}
