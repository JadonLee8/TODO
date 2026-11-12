import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { MAX_ACTIVITY_ENTRIES, type ActivityEntry } from '@shared/activity'

/**
 * The activity log is per device and never synced: it records changes made here, with the before/after states
 * needed to undo them. The synced record of every change is the GitHub repo's commit history.
 */
function logPath(): string {
  return join(app.getPath('userData'), 'activity-log.json')
}

export function getActivity(): ActivityEntry[] {
  if (!existsSync(logPath())) return []
  try {
    return JSON.parse(readFileSync(logPath(), 'utf8')) as ActivityEntry[]
  } catch {
    return [] // a corrupt log only loses undo history, never tasks
  }
}

export function saveActivity(entries: ActivityEntry[]): void {
  writeFileSync(logPath(), JSON.stringify(entries.slice(0, MAX_ACTIVITY_ENTRIES)))
}
