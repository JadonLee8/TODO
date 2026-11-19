import type { ExtensionId, SyncedSettings } from '@shared/types'

/** What one step of an extension did. Steps throw on failure; the host turns that into an error result. */
export interface StepResult {
  summary: string
  /** Tasks created or changed in the local cache. Non-zero makes Sync push again. */
  changedTasks: number
}

/**
 * A built-in extension's main-process half. Sync runs it like this:
 *   pull/push → every active extension's importTasks → push again if anything changed → every exportTasks
 * so imports see what other devices already pushed, and exports see the final, synced state.
 */
export interface MainExtension {
  id: ExtensionId
  /** Set up on this device (account connected, folder picked...). Installing is checked by the host. */
  isReady(settings: SyncedSettings): boolean
  /** May create or change tasks in the local cache. */
  importTasks?(now: Date): Promise<StepResult>
  /** Reads tasks and writes them somewhere else. Must not change tasks. */
  exportTasks?(now: Date): Promise<StepResult>
}
