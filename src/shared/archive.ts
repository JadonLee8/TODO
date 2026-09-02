import type { ArchiveSettings, Task } from './types'

/** Returns the ids of completed tasks that are old enough to be auto-archived. */
export function taskIdsToArchive(tasks: Task[], settings: ArchiveSettings, now: Date = new Date()): string[] {
  const cutoffMs = settings.archiveAfterDays * 24 * 60 * 60 * 1000
  return tasks
    .filter((t) => t.completed && !t.archived && t.completedAt)
    .filter((t) => now.getTime() - new Date(t.completedAt as string).getTime() >= cutoffMs)
    .map((t) => t.id)
}
