import { describe, expect, it } from 'vitest'
import type { Task } from './types'
import { burndown, totals } from './stats'

function task(overrides: Partial<Task>): Task {
  return {
    id: 'id',
    listId: 'main',
    title: '',
    notes: '',
    priority: 3,
    starred: false,
    completed: false,
    createdAt: '2026-01-01T12:00:00',
    updatedAt: '2026-01-01T12:00:00',
    completedAt: null,
    archived: false,
    dueDate: null,
    source: null,
    ...overrides
  }
}

// Local-time ISO strings (no Z) keep the tests independent of the machine's time zone.
const now = new Date('2026-01-10T18:00:00')

describe('burndown', () => {
  it('counts a task open from its creation day until the day it is completed', () => {
    const points = burndown(
      [task({ createdAt: '2026-01-08T09:00:00', completed: true, completedAt: '2026-01-09T20:00:00' })],
      4,
      now
    )
    expect(points.map((p) => p.day)).toEqual(['2026-01-07', '2026-01-08', '2026-01-09', '2026-01-10'])
    expect(points.map((p) => p.open)).toEqual([0, 1, 0, 0])
    expect(points.map((p) => p.created)).toEqual([0, 1, 0, 0])
    expect(points.map((p) => p.completed)).toEqual([0, 0, 1, 0])
  })

  it('counts older tasks from the start of the window, and open tasks to the end', () => {
    const points = burndown([task({ createdAt: '2025-12-01T09:00:00' })], 3, now)
    expect(points.map((p) => p.open)).toEqual([1, 1, 1])
    expect(points.every((p) => p.created === 0)).toBe(true)
  })

  it('ignores tasks created after the window', () => {
    expect(burndown([task({ createdAt: '2026-01-11T09:00:00' })], 2, now).map((p) => p.open)).toEqual([0, 0])
  })
})

describe('totals', () => {
  it('counts open, overdue and the last 7 days', () => {
    const t = totals(
      [
        task({ createdAt: '2026-01-09T09:00:00', dueDate: '2026-01-05T00:00:00.000Z' }),
        task({ createdAt: '2025-12-01T09:00:00', completed: true, completedAt: '2026-01-04T10:00:00' }),
        task({ createdAt: '2025-12-01T09:00:00', completed: true, completedAt: '2026-01-02T10:00:00' })
      ],
      now
    )
    expect(t).toEqual({ open: 1, overdue: 1, createdLast7: 1, completedLast7: 1 })
  })
})
