import { describe, expect, it } from 'vitest'
import type { Task } from './types'
import { eventDueDate, eventToTask, localDateString, tasksToPromote } from './calendar'

describe('eventDueDate', () => {
  it('uses start.date for all-day events', () => {
    expect(eventDueDate({ id: 'e', start: { date: '2026-10-09' } })).toBe('2026-10-09T00:00:00.000Z')
  })

  it("uses the event's own local date for timed events, regardless of UTC offset", () => {
    // 11pm in UTC-5 is already the next day in UTC; the task should still be due on the 9th.
    expect(eventDueDate({ id: 'e', start: { dateTime: '2026-10-09T23:00:00-05:00' } })).toBe('2026-10-09T00:00:00.000Z')
  })

  it('returns null without a usable start', () => {
    expect(eventDueDate({ id: 'e' })).toBeNull()
    expect(eventDueDate({ id: 'e', start: { dateTime: 'garbage' } })).toBeNull()
  })
})

describe('eventToTask', () => {
  const now = new Date('2026-10-07T12:00:00.000Z')

  it('maps the event onto a new task in the target list', () => {
    const task = eventToTask(
      { id: 'ev1', summary: ' Dentist ', description: 'Bring forms', htmlLink: 'https://calendar.google.com/x', start: { date: '2026-10-09' } },
      'cal@example.com',
      'task-id',
      { targetListId: 'errands', defaultPriority: 2 },
      now
    )
    expect(task).toEqual({
      id: 'task-id',
      listId: 'errands',
      title: 'Dentist',
      notes: 'Bring forms',
      priority: 2,
      starred: false,
      completed: false,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      completedAt: null,
      archived: false,
      dueDate: '2026-10-09T00:00:00.000Z',
      source: { type: 'google_calendar', calendarId: 'cal@example.com', eventId: 'ev1', htmlLink: 'https://calendar.google.com/x' }
    })
  })

  it('gives untitled events a placeholder title', () => {
    expect(eventToTask({ id: 'e' }, 'c', 'id', { targetListId: 'main', defaultPriority: 3 }, now).title).toBe('(No title)')
  })
})

describe('tasksToPromote', () => {
  const base = eventToTask({ id: 'e', start: { date: '2026-10-06' } }, 'c', 'x', { targetListId: 'main', defaultPriority: 3 }, new Date())
  const task = (id: string, overrides: Partial<Task>): Task => ({ ...base, id, ...overrides })

  const tasks = [
    task('overdue', {}),
    task('today', { dueDate: '2026-10-07T00:00:00.000Z' }),
    task('done', { completed: true }),
    task('already-p1', { priority: 1 }),
    task('promoted-before', {}),
    task('no-date', { dueDate: null }),
    task('manual', { source: null })
  ]

  it('promotes only overdue, incomplete, imported tasks not promoted before', () => {
    expect(tasksToPromote(tasks, '2026-10-07', new Set(['promoted-before'])).map((t) => t.id)).toEqual(['overdue'])
  })
})

describe('localDateString', () => {
  it('formats the local date', () => {
    expect(localDateString(new Date(2026, 0, 5, 23, 30))).toBe('2026-01-05')
  })
})
