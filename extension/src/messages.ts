import type { SyncConflict, SyncResult, SyncedSettings, Task, TaskFolder, TaskList } from '@shared/types'
import type { NewTaskInput } from '@shared/newTask'

/**
 * How the extension's pages (popup, side panel, options) talk to its background service worker. The background owns
 * the task cache and the sync; pages only ask it for a snapshot and send it changes, so there is one writer.
 */

export interface SyncState {
  syncing: boolean
  /** When the last sync finished (ISO 8601). */
  lastAt: string | null
  lastResult: SyncResult | null
}

export interface Snapshot {
  /** A repo and token are saved. */
  configured: boolean
  tasks: Task[]
  lists: TaskList[]
  folders: TaskFolder[]
  settings: SyncedSettings
  /** Tasks changed here and elsewhere; they're resolved in the app. */
  conflicts: SyncConflict[]
  sync: SyncState
}

export interface IntegrationInfo {
  id: string
  name: string
  description: string
  status: 'available' | 'planned'
  detail: string
  enabled: boolean
  /** Sites it needs access to (asked for when it's turned on). */
  hosts: string[]
}

export type Request =
  | { type: 'snapshot' }
  | { type: 'addTask'; input: NewTaskInput }
  | { type: 'updateTask'; task: Task }
  | { type: 'sync' }
  | { type: 'configChanged' }
  | { type: 'integrations' }
  | { type: 'setIntegration'; id: string; enabled: boolean }

export interface Responses {
  snapshot: Snapshot
  addTask: Task
  updateTask: null
  sync: SyncResult
  configChanged: null
  integrations: IntegrationInfo[]
  setIntegration: IntegrationInfo[]
}

export type Reply<T> = { ok: true; value: T } | { ok: false; error: string }

/** Sends a request to the background and unwraps its reply; a failure there becomes a thrown Error here. */
export async function send<R extends Request>(request: R): Promise<Responses[R['type']]> {
  const reply = (await chrome.runtime.sendMessage(request)) as Reply<Responses[R['type']]> | undefined
  if (!reply) throw new Error('The extension’s background didn’t answer. Try reloading the extension.')
  if (!reply.ok) throw new Error(reply.error)
  return reply.value
}

/** Broadcast by the background after tasks, settings or the sync state change, so open pages redraw. */
export const CHANGED = 'todo:changed'

/** Calls `onChange` whenever the background reports a change. */
export function onChanged(onChange: () => void): void {
  chrome.runtime.onMessage.addListener((message: unknown) => {
    if ((message as { type?: string })?.type === CHANGED) onChange()
  })
}
