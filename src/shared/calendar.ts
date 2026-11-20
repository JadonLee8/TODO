import type { CalendarSettings, Task } from './types'

/** The subset of a Google Calendar API event resource that the import uses. */
export interface GoogleCalendarEvent {
  id: string
  status?: string
  summary?: string
  description?: string
  htmlLink?: string
  start?: { date?: string; dateTime?: string }
}

/**
 * The event's date as a task due date. All-day events have `start.date` (YYYY-MM-DD); timed events have
 * `start.dateTime` with the event's own UTC offset, whose first 10 characters are the event's local date.
 * Stored as midnight UTC of that date, the same convention the task detail panel's date picker uses.
 */
export function eventDueDate(event: GoogleCalendarEvent): string | null {
  const day = event.start?.date ?? event.start?.dateTime?.slice(0, 10)
  return day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? `${day}T00:00:00.000Z` : null
}

/** Builds the task for a newly imported event. `id` is the deterministic id for (calendarId, eventId). */
export function eventToTask(
  event: GoogleCalendarEvent,
  calendarId: string,
  id: string,
  settings: Pick<CalendarSettings, 'targetListId' | 'defaultPriority'>,
  now: Date
): Task {
  const iso = now.toISOString()
  return {
    id,
    listId: settings.targetListId,
    title: event.summary?.trim() || '(No title)',
    notes: event.description ?? '',
    priority: settings.defaultPriority,
    starred: false,
    completed: false,
    createdAt: iso,
    updatedAt: iso,
    completedAt: null,
    archived: false,
    dueDate: eventDueDate(event),
    source: { type: 'google_calendar', calendarId, eventId: event.id, htmlLink: event.htmlLink }
  }
}

/** Today's date (YYYY-MM-DD) in the device's local time zone. */
export function localDateString(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/**
 * A due date for display: "Nov 20", with the year only when it isn't this year. Due dates are stored as midnight UTC
 * of the due day, so this formats the UTC date.
 */
export function shortDueDate(iso: string, now: Date): string {
  const date = new Date(iso)
  const thisYear = date.getUTCFullYear() === now.getFullYear()
  return date.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', ...(thisYear ? {} : { year: 'numeric' }) })
}

/**
 * Imported, incomplete tasks whose due date is before today and that should be bumped to P1.
 * `alreadyPromoted` holds ids promoted before, so lowering one by hand afterwards sticks.
 */
export function tasksToPromote(tasks: Task[], today: string, alreadyPromoted: Set<string>): Task[] {
  return tasks.filter(
    (t) =>
      t.source?.type === 'google_calendar' &&
      !t.completed &&
      !t.archived &&
      t.priority !== 1 &&
      !alreadyPromoted.has(t.id) &&
      t.dueDate !== null &&
      t.dueDate.slice(0, 10) < today
  )
}
