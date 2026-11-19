import { describe, expect, it } from 'vitest'
import type { Task, TaskList } from './types'
import {
  INBOX_TEMPLATE,
  VAULT_NOTES_HEADING,
  extractVaultNotes,
  noteTaskId,
  parseInbox,
  renderTaskNote,
  sanitizeFileName,
  taskNoteFileNames
} from './obsidian'

function task(overrides: Partial<Task>): Task {
  return {
    id: 'aaaaaaaa-0000-4000-8000-000000000000',
    listId: 'main',
    title: 'Task',
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

const lists: TaskList[] = [
  { id: 'main', name: 'Tasks', order: -1 },
  { id: 'l2', name: 'Errands', order: 0 }
]

describe('sanitizeFileName', () => {
  it('drops characters that break file names or Obsidian links', () => {
    expect(sanitizeFileName('a/b: c? [d] #e | f^')).toBe('a b c d e f')
  })
  it('never returns an empty or dot-led name', () => {
    expect(sanitizeFileName('???')).toBe('Untitled')
    expect(sanitizeFileName('...hidden.')).toBe('hidden')
  })
  it('caps the length', () => {
    expect(sanitizeFileName('x'.repeat(200)).length).toBe(80)
  })
})

describe('taskNoteFileNames', () => {
  it('suffixes clashing titles, ignoring case, and keeps the oldest task on the plain name', () => {
    const older = task({ id: '11111111-aaaa', title: 'Call Mom', createdAt: '2026-01-01T00:00:00.000Z' })
    const newer = task({ id: '22222222-bbbb', title: 'call mom', createdAt: '2026-02-01T00:00:00.000Z' })
    const names = taskNoteFileNames([newer, older])
    expect(names.get(older.id)).toBe('Call Mom.md')
    expect(names.get(newer.id)).toBe('call mom (22222222).md')
  })
})

describe('renderTaskNote', () => {
  it('writes properties, title, notes and an empty vault-notes section', () => {
    const note = renderTaskNote(task({ title: 'Buy "milk"', notes: '2%', listId: 'l2', priority: 1, dueDate: '2026-03-04T00:00:00.000Z' }), lists, null)
    expect(note).toContain('todo_id: "aaaaaaaa-0000-4000-8000-000000000000"')
    expect(note).toContain('list: "Errands"')
    expect(note).toContain('priority: 1')
    expect(note).toContain('status: open')
    expect(note).toContain('due: 2026-03-04')
    expect(note).toContain('# Buy "milk"\n\n2%\n')
    expect(note.trimEnd().endsWith(VAULT_NOTES_HEADING)).toBe(true)
  })

  it('keeps the existing vault-notes section', () => {
    const first = renderTaskNote(task({}), lists, null)
    const edited = first + '\nSee [[Project X]].\n'
    const again = renderTaskNote(task({ title: 'Renamed' }), lists, extractVaultNotes(edited))
    expect(again).toContain('# Renamed')
    expect(again).toContain(`${VAULT_NOTES_HEADING}\n\nSee [[Project X]].`)
  })

  it('is stable, so unchanged tasks are not rewritten', () => {
    const first = renderTaskNote(task({}), lists, null)
    expect(renderTaskNote(task({}), lists, extractVaultNotes(first))).toBe(first)
  })

  it('marks archived and done tasks', () => {
    expect(renderTaskNote(task({ completed: true, completedAt: '2026-01-02T00:00:00.000Z' }), lists, null)).toContain('status: done')
    expect(renderTaskNote(task({ completed: true, archived: true }), lists, null)).toContain('status: archived')
  })
})

describe('noteTaskId', () => {
  it('reads the id from a note the app wrote, and nothing else', () => {
    expect(noteTaskId(renderTaskNote(task({}), lists, null))).toBe('aaaaaaaa-0000-4000-8000-000000000000')
    expect(noteTaskId('# A note\n\ntodo_id: "x"')).toBeNull()
  })
})

describe('parseInbox', () => {
  it('takes unchecked items with priority and due date, and leaves the rest', () => {
    const input = ['# Inbox', '', '- [ ] Buy milk #p1', '- [x] Done already', '* [ ] Dentist 📅 2026-12-01', 'Some text', '- [ ] '].join('\n')
    const { items, remaining } = parseInbox(input)
    expect(items).toEqual([
      { title: 'Buy milk', priority: 1, dueDate: null },
      { title: 'Dentist', priority: null, dueDate: '2026-12-01' }
    ])
    expect(remaining).toBe(['# Inbox', '', '- [x] Done already', 'Some text', '- [ ] '].join('\n'))
  })

  it('leaves the template alone', () => {
    expect(parseInbox(INBOX_TEMPLATE)).toEqual({ items: [], remaining: INBOX_TEMPLATE })
  })

  it('does not treat #p12 or mid-word tags as a priority', () => {
    expect(parseInbox('- [ ] Fix #p12 issue').items[0]).toEqual({ title: 'Fix #p12 issue', priority: null, dueDate: null })
  })
})
