import { describe, expect, it } from 'vitest'
import type { Priority, RankingSettings, Task } from './types'
import { orderPlainList, rankTasks } from './ranking'

const now = new Date('2026-06-01T00:00:00.000Z')
const daysAgo = (n: number) => new Date(now.getTime() - n * 86400000).toISOString()

function task(id: string, priority: Priority, ageDays: number, starred = false): Task {
  return {
    id,
    listId: 'main',
    title: id,
    notes: '',
    priority,
    starred,
    completed: false,
    createdAt: daysAgo(ageDays),
    updatedAt: daysAgo(ageDays),
    completedAt: null,
    archived: false,
    dueDate: null,
    source: null
  }
}

const settings: RankingSettings = { midPriorityWeight: 0.5, ageNormalizationDays: 30, starredFirst: false }
const ids = (tasks: Task[]) => tasks.map((t) => t.id)

describe('rankTasks', () => {
  const tasks = [
    task('p5', 5, 10),
    task('p4-new-star', 4, 1, true),
    task('p4-old', 4, 20),
    task('p1-new', 1, 1),
    task('p1-old', 1, 9),
    task('p3-star', 3, 0, true),
    task('p2', 2, 15)
  ]

  it('orders P1 (oldest first), then blended P2/P3, then P4, then P5', () => {
    expect(ids(rankTasks(tasks, settings, now))).toEqual(['p1-old', 'p1-new', 'p2', 'p3-star', 'p4-old', 'p4-new-star', 'p5'])
  })

  it('ignores stars unless starredFirst is on', () => {
    const withStar = [task('p1-old', 1, 9), task('p1-new-star', 1, 1, true)]
    expect(ids(rankTasks(withStar, settings, now))).toEqual(['p1-old', 'p1-new-star'])
  })

  it('with starredFirst, floats starred tasks to the top of their own tier only', () => {
    expect(ids(rankTasks(tasks, { ...settings, starredFirst: true }, now))).toEqual([
      'p1-old',
      'p1-new',
      'p3-star',
      'p2',
      'p4-new-star',
      'p4-old',
      'p5'
    ])
  })
})

describe('orderPlainList', () => {
  const tasks = [task('new', 3, 1), task('star', 3, 2, true), task('old', 3, 5)]

  it('sorts oldest first', () => {
    expect(ids(orderPlainList(tasks, { starredFirst: false }))).toEqual(['old', 'star', 'new'])
  })

  it('puts starred tasks on top with starredFirst', () => {
    expect(ids(orderPlainList(tasks, { starredFirst: true }))).toEqual(['star', 'old', 'new'])
  })
})
