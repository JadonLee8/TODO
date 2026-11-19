import { describe, expect, it } from 'vitest'
import { EMPTY_LEDGER, applyWal, planImport, taskNotes, toIso, walChecksum, type ImportContext, type MsTodoSnapshot, type MsTodoTask } from './microsoftTodo'
import { MAIN_LIST_ID, type TaskList } from './types'

const NOW = new Date('2026-11-13T12:00:00.000Z')
const idFor = (kind: string, msId: string) => `${kind}:${msId}`
const options = { includeCompleted: true, defaultPriority: 3 as const, archiveAfterDays: 31 }

function msTask(over: Partial<MsTodoTask>): MsTodoTask {
  return {
    id: 't1',
    listId: 'default',
    title: 'Task',
    notes: '',
    completed: false,
    important: false,
    dueDate: null,
    createdAt: '2026-01-02T03:04:05.1234567Z',
    completedAt: null,
    steps: [],
    ...over
  }
}

const snapshot: MsTodoSnapshot = {
  groups: [{ id: 'g-classes', name: 'Classes', position: '2024-08-26T02:35:42Z' }],
  lists: [
    { id: 'default', name: 'Tasks', position: '', isDefault: true, groupId: null, listType: null },
    { id: 'l-buy', name: 'to buy', position: '2024-08-25T03:39:18Z', isDefault: false, groupId: null, listType: null },
    { id: 'l-217', name: '217', position: '2024-08-26T02:35:40Z', isDefault: false, groupId: 'g-classes', listType: null },
    { id: 'l-flag', name: 'Flagged Emails', position: '2024-08-26T13:58:18Z', isDefault: false, groupId: null, listType: 'com.microsoft.outlook.email.flagged' }
  ],
  tasks: [
    msTask({ id: 'a', listId: 'default', title: '  fred meeting ', important: true, dueDate: '2026-02-17' }),
    msTask({ id: 'b', listId: 'l-buy', title: 'soap', completed: true, completedAt: '2025-08-19' }),
    msTask({ id: 'c', listId: 'l-217', title: 'homework', completed: true, completedAt: '2026-11-10' }),
    msTask({ id: 'd', listId: 'l-flag', title: 'an email' })
  ]
}

const base: ImportContext = {
  lists: [{ id: MAIN_LIST_ID, name: 'Tasks', order: -1 }],
  folders: [],
  hasTask: () => false,
  ledger: EMPTY_LEDGER
}

describe('planImport', () => {
  it('maps lists, groups and tasks', () => {
    const plan = planImport(snapshot, base, options, idFor, NOW)
    expect(plan.folders).toEqual([{ id: 'folder:g-classes', name: 'Classes', order: 1 }])
    expect(plan.lists).toEqual([
      { id: MAIN_LIST_ID, name: 'Tasks', order: -1 },
      { id: 'list:l-buy', name: 'to buy', order: 0, folderId: null },
      { id: 'list:l-217', name: '217', order: 0, folderId: 'folder:g-classes' }
    ])
    expect(plan.createdLists).toBe(2)
    expect(plan.tasks.map((t) => [t.id, t.listId])).toEqual([
      ['task:a', MAIN_LIST_ID],
      ['task:b', 'list:l-buy'],
      ['task:c', 'list:l-217']
    ])
    const [a, b, c] = plan.tasks
    expect(a).toMatchObject({
      title: 'fred meeting',
      starred: true,
      priority: 3,
      completed: false,
      createdAt: '2026-01-02T03:04:05.123Z',
      dueDate: '2026-02-17T00:00:00.000Z',
      source: { type: 'microsoft_todo', taskId: 'a', listName: 'Tasks' }
    })
    // Completed long ago: archived on import. Completed recently: left in Completed.
    expect(b).toMatchObject({ completed: true, completedAt: '2025-08-19T00:00:00.000Z', archived: true })
    expect(c).toMatchObject({ completed: true, archived: false })
  })

  it('merges into lists and folders with the same name', () => {
    const lists: TaskList[] = [...base.lists, { id: 'mine', name: 'To Buy', order: 0 }]
    const plan = planImport(snapshot, { ...base, lists, folders: [{ id: 'f', name: 'classes', order: 1 }] }, options, idFor, NOW)
    expect(plan.folders).toEqual([{ id: 'f', name: 'classes', order: 1 }])
    expect(plan.foldersChanged).toBe(false)
    expect(plan.lists.find((l) => l.name === '217')).toMatchObject({ folderId: 'f' })
    expect(plan.tasks.find((t) => t.title === 'soap')?.listId).toBe('mine')
  })

  it('imports each task once, and skips tasks another device already imported', () => {
    const first = planImport(snapshot, base, options, idFor, NOW)
    const again = planImport(snapshot, { ...base, lists: first.lists, folders: first.folders, ledger: first.ledger }, options, idFor, NOW)
    expect(again.tasks).toEqual([])
    expect(again.listsChanged).toBe(false)

    const elsewhere = planImport(snapshot, { ...base, hasTask: (id) => id === 'task:a' }, options, idFor, NOW)
    expect(elsewhere.tasks.map((t) => t.id)).toEqual(['task:b', 'task:c'])
    expect(elsewhere.ledger.taskIds).toContain('task:a')
  })

  it("doesn't recreate a list the user deleted; its new tasks go to the main list", () => {
    const first = planImport(snapshot, base, options, idFor, NOW)
    const withNew = { ...snapshot, tasks: [...snapshot.tasks, msTask({ id: 'e', listId: 'l-buy', title: 'milk' })] }
    const lists = first.lists.filter((l) => l.id !== 'list:l-buy')
    const plan = planImport(withNew, { ...base, lists, folders: first.folders, ledger: first.ledger }, options, idFor, NOW)
    expect(plan.lists.some((l) => l.id === 'list:l-buy')).toBe(false)
    expect(plan.tasks).toMatchObject([{ id: 'task:e', listId: MAIN_LIST_ID }])
  })

  it('leaves completed tasks out when asked, without ledgering them', () => {
    const plan = planImport(snapshot, base, { ...options, includeCompleted: false }, idFor, NOW)
    expect(plan.tasks.map((t) => t.id)).toEqual(['task:a'])
    expect(plan.ledger.taskIds).toEqual(['task:a'])
  })
})

describe('taskNotes and toIso', () => {
  it('appends steps as a checklist in order', () => {
    const notes = taskNotes({
      notes: 'Body\n',
      steps: [
        { title: 'second', completed: true, position: '2' },
        { title: 'first', completed: false, position: '1' }
      ]
    })
    expect(notes).toBe('Body\n\n- [ ] first\n- [x] second')
    expect(taskNotes({ notes: '', steps: [] })).toBe('')
  })

  it('normalises timestamps', () => {
    expect(toIso('2026-11-13T17:35:27.5437111Z')).toBe('2026-11-13T17:35:27.543Z')
    expect(toIso('2025-08-19')).toBe('2025-08-19T00:00:00.000Z')
    expect(toIso('')).toBeNull()
    expect(toIso('nonsense')).toBeNull()
  })
})

// ---- WAL ----

const PAGE = 512

/** Builds a WAL file the way SQLite writes one (little-endian checksums, as on Windows). */
function buildWal(frames: Array<{ page: number; fill: number; commit: number; badSalt?: boolean }>): Uint8Array {
  const wal = new Uint8Array(32 + frames.length * (24 + PAGE))
  const view = new DataView(wal.buffer)
  view.setUint32(0, 0x377f0682)
  view.setUint32(4, 3007000)
  view.setUint32(8, PAGE)
  view.setUint32(16, 0x11111111)
  view.setUint32(20, 0x22222222)
  let [s0, s1] = walChecksum(wal.subarray(0, 24), false)
  view.setUint32(24, s0)
  view.setUint32(28, s1)
  frames.forEach((f, i) => {
    const off = 32 + i * (24 + PAGE)
    view.setUint32(off, f.page)
    view.setUint32(off + 4, f.commit)
    view.setUint32(off + 8, f.badSalt ? 0 : 0x11111111)
    view.setUint32(off + 12, 0x22222222)
    wal.fill(f.fill, off + 24, off + 24 + PAGE)
    ;[s0, s1] = walChecksum(wal.subarray(off, off + 8), false, s0, s1)
    ;[s0, s1] = walChecksum(wal.subarray(off + 24, off + 24 + PAGE), false, s0, s1)
    view.setUint32(off + 16, s0)
    view.setUint32(off + 20, s1)
  })
  return wal
}

function walDb(pages: number): Uint8Array {
  const db = new Uint8Array(pages * PAGE).fill(0xaa)
  db[18] = 2
  db[19] = 2
  return db
}

describe('applyWal', () => {
  it('applies committed frames, grows the file, and ignores frames after the last commit', () => {
    const wal = buildWal([
      { page: 2, fill: 1, commit: 0 },
      { page: 3, fill: 2, commit: 3 },
      { page: 2, fill: 9, commit: 0 } // never committed
    ])
    const out = applyWal(walDb(2), wal)
    expect(out.length).toBe(3 * PAGE)
    expect(out[PAGE]).toBe(1)
    expect(out[2 * PAGE]).toBe(2)
    expect(out[0]).toBe(0xaa)
    expect([out[18], out[19]]).toEqual([1, 1])
  })

  it('stops at a frame from an older WAL generation', () => {
    const wal = buildWal([
      { page: 1, fill: 5, commit: 2 },
      { page: 2, fill: 6, commit: 2, badSalt: true }
    ])
    const out = applyWal(walDb(2), wal)
    expect(out[0]).toBe(5)
    expect(out[PAGE]).toBe(0xaa)
  })

  it('ignores a corrupted WAL and still clears the WAL flag, without touching the input', () => {
    const wal = buildWal([{ page: 1, fill: 5, commit: 1 }])
    wal[32 + 24] ^= 0xff // corrupt the page so the checksum fails
    const db = walDb(1)
    const out = applyWal(db, wal)
    expect(out[0]).toBe(0xaa)
    expect([out[18], out[19]]).toEqual([1, 1])
    expect(db[18]).toBe(2)
    expect(applyWal(db, null)[18]).toBe(1)
  })
})
