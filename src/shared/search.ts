import type { Task } from './types'

/**
 * Returns the non-archived tasks matching `query`, across all lists.
 * Matching is case-insensitive; every whitespace-separated word in the query must appear
 * in the task's title or notes. An empty or blank query matches nothing.
 */
export function searchTasks(tasks: Task[], query: string): Task[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return []
  return tasks.filter((t) => {
    if (t.archived) return false
    const haystack = `${t.title}\n${t.notes}`.toLowerCase()
    return terms.every((term) => haystack.includes(term))
  })
}
