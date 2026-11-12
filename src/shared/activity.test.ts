import { describe, expect, it } from 'vitest'
import type { Task, TaskList } from './types'
import { applyEntityChanges, changedSince, describeTaskEdit, diffById, sameValue, undoChanges, type ActivityEntry } from './activity'

const task = (id: string, extra: Partial<Task> = {}): Task => ({
  id,
  listId: 'main',
  title: id.toUpperCase(),
  notes: '',
  priority: 3,
  starred: false,
  completed: false,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  completedAt: null,
  archived: false,
  dueDate: null,
  source: null,
  ...extra
})
const list = (id: string, extra: Partial<TaskList> = {}): TaskList => ({ id, name: id, order: 0, folderId: null, ...extra })

describe('diffById and applyEntityChanges', () => {
  const before = [list('a'), list('b')]
  const after = [list('a', { name: 'A2' }), list('c')]
  const changes = diffById(before, after)

  it('finds added, removed and changed entities', () => {
    expect(changes.map((c) => [c.id, !!c.before, !!c.after])).toEqual([
      ['a', true, true],
      ['b', true, false],
      ['c', false, true]
    ])
  })

  it('round-trips in both directions', () => {
    expect(sameValue(applyEntityChanges(before, changes, 'after'), after)).toBe(true)
    expect(applyEntityChanges(after, changes, 'before').map((l) => l.id).sort()).toEqual(['a', 'b'])
  })

  it('treats a missing optional field like undefined', () => {
    expect(sameValue({ id: 'x', folderId: undefined }, { id: 'x' })).toBe(true)
  })
})

describe('undo', () => {
  // Deleting list "groceries" moved its task "milk" to the main list.
  const entry: ActivityEntry = {
    id: 'e1',
    at: '2026-10-07T10:00:00.000Z',
    summary: 'Deleted list “groceries”',
    changes: {
      tasks: [{ id: 'milk', before: task('milk', { listId: 'groceries' }), after: task('milk') }],
      lists: [{ id: 'groceries', before: list('groceries'), after: null }],
      folders: []
    }
  }
  const current = { tasks: [task('milk'), task('other')], lists: [list('main')], folders: [] }

  it('restores every touched entity to its earlier state', () => {
    const changes = undoChanges(entry, current)
    expect(applyEntityChanges(current.lists, changes.lists, 'after').map((l) => l.id)).toEqual(['main', 'groceries'])
    expect(applyEntityChanges(current.tasks, changes.tasks, 'after').find((t) => t.id === 'milk')!.listId).toBe('groceries')
    expect(changes.tasks).toHaveLength(1) // "other" isn't touched
  })

  it('reports things that changed again since, ignoring updatedAt', () => {
    expect(changedSince(entry, { ...current, tasks: [task('milk', { updatedAt: '2026-10-08T00:00:00.000Z' })] })).toEqual([])
    expect(changedSince(entry, { ...current, tasks: [task('milk', { completed: true })] })).toEqual(['“MILK”'])
  })

  it('restores a deleted task', () => {
    const del: ActivityEntry = { ...entry, changes: { tasks: [{ id: 'x', before: task('x'), after: null }], lists: [], folders: [] } }
    const changes = undoChanges(del, current)
    expect(changes.tasks).toEqual([{ id: 'x', before: null, after: task('x') }])
  })
})

describe('describeTaskEdit', () => {
  const name = (id: string) => (id === 'main' ? 'Tasks' : 'Groceries')
  it('names the most notable change', () => {
    expect(describeTaskEdit(task('a'), task('a', { completed: true }), name)).toBe('Completed “A”')
    expect(describeTaskEdit(task('a'), task('a', { listId: 'g' }), name)).toBe('Moved “A” to Groceries')
    expect(describeTaskEdit(task('a'), task('a', { priority: 1 }), name)).toBe('Changed “A” from P3 to P1')
    expect(describeTaskEdit(task('a'), task('a', { title: 'B' }), name)).toBe('Renamed task “A” to “B”')
    expect(describeTaskEdit(task('a'), task('a', { notes: 'x' }), name)).toBe('Edited the notes of “A”')
  })
})
