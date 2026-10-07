import { describe, expect, it } from 'vitest'
import type { Task } from './types'
import { searchTasks } from './search'

function task(overrides: Partial<Task>): Task {
  return {
    id: overrides.id ?? 'id',
    listId: 'main',
    title: '',
    notes: '',
    priority: 3,
    starred: false,
    completed: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    completedAt: null,
    archived: false,
    dueDate: null,
    source: null,
    ...overrides
  }
}

const ids = (tasks: Task[]) => tasks.map((t) => t.id)

describe('searchTasks', () => {
  const tasks = [
    task({ id: 'a', title: 'Buy groceries', notes: 'milk, eggs' }),
    task({ id: 'b', title: 'Call dentist', listId: 'other' }),
    task({ id: 'c', title: 'Write report', notes: 'Include grocery budget' }),
    task({ id: 'd', title: 'Old grocery run', archived: true }),
    task({ id: 'e', title: 'Grocery list', completed: true })
  ]

  it('matches title case-insensitively', () => {
    expect(ids(searchTasks(tasks, 'DENTIST'))).toEqual(['b'])
  })

  it('matches notes', () => {
    expect(ids(searchTasks(tasks, 'eggs'))).toEqual(['a'])
  })

  it('matches across lists and includes completed tasks', () => {
    expect(ids(searchTasks(tasks, 'grocer'))).toEqual(['a', 'c', 'e'])
  })

  it('skips archived tasks', () => {
    expect(ids(searchTasks(tasks, 'old grocery'))).toEqual([])
  })

  it('requires every word to match, in title or notes', () => {
    expect(ids(searchTasks(tasks, 'report budget'))).toEqual(['c'])
    expect(ids(searchTasks(tasks, 'report milk'))).toEqual([])
  })

  it('returns nothing for a blank query', () => {
    expect(searchTasks(tasks, '')).toEqual([])
    expect(searchTasks(tasks, '   ')).toEqual([])
  })
})
