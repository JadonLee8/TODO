import type { Priority, Task } from './types'

export interface NewTaskInput {
  title: string
  listId: string
  notes?: string
  priority?: Priority
  starred?: boolean
  /** ISO 8601, midnight UTC of the due day. */
  dueDate?: string | null
}

/** A new, open task. The one place a task's defaults are set, for the app, the terminal style and the CLI. */
export function createTask(input: NewTaskInput, id: string, now: Date = new Date()): Task {
  const iso = now.toISOString()
  return {
    id,
    listId: input.listId,
    title: input.title.trim(),
    notes: input.notes ?? '',
    priority: input.priority ?? 3,
    starred: input.starred ?? false,
    completed: false,
    createdAt: iso,
    updatedAt: iso,
    completedAt: null,
    archived: false,
    dueDate: input.dueDate ?? null,
    source: null
  }
}
