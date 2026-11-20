import { describe, expect, it } from 'vitest'
import {
  buildListing,
  complete,
  findList,
  formatListing,
  initialShellState,
  lineText,
  listPath,
  parseDueDate,
  parseTaskOptions,
  runCommand,
  tokenize,
  type ShellData,
  type ShellHost,
  type ShellState
} from './shell'
import { createTask } from './newTask'
import { DEFAULT_SYNCED_SETTINGS, MAIN_LIST_ID, type Task } from './types'

const NOW = new Date(2026, 10, 18, 12) // Wed Nov 18 2026, local noon

function task(id: string, over: Partial<Task> = {}): Task {
  return { ...createTask({ title: `Task ${id}`, listId: MAIN_LIST_ID }, id, new Date('2026-11-01T00:00:00.000Z')), ...over }
}

/** A host over plain arrays, recording what it was asked to do. */
function memoryHost(initial: Partial<ShellData> = {}, answers: boolean[] = []) {
  const data: ShellData = {
    tasks: [],
    lists: [
      { id: MAIN_LIST_ID, name: 'Tasks', order: -1 },
      { id: 'work', name: 'Work', order: 0, folderId: null },
      { id: 'groceries', name: 'Groceries', order: 2, folderId: 'home' }
    ],
    folders: [{ id: 'home', name: 'Home', order: 1 }],
    settings: DEFAULT_SYNCED_SETTINGS,
    conflicts: [],
    ...initial
  }
  let nextId = 0
  const questions: string[] = []
  const host: ShellHost = {
    data: () => ({ ...data }),
    addTask: async (input) => {
      const t = createTask(input, `new-${nextId++}`, NOW)
      data.tasks = [...data.tasks, t]
      return t
    },
    updateTask: async (t) => void (data.tasks = data.tasks.map((x) => (x.id === t.id ? t : x))),
    deleteTask: async (id) => void (data.tasks = data.tasks.filter((x) => x.id !== id)),
    addList: async (name) => void (data.lists = [...data.lists, { id: `list-${name}`, name, order: 9 }]),
    deleteList: async (id) => {
      data.tasks = data.tasks.map((t) => (t.listId === id ? { ...t, listId: MAIN_LIST_ID } : t))
      data.lists = data.lists.filter((l) => l.id !== id)
    },
    saveSettings: async (s) => void (data.settings = s),
    sync: async () => ({ pushed: 1, pulled: 2, conflicts: [], error: null, extensions: [] }),
    resolveConflict: async (taskId) => void (data.conflicts = data.conflicts.filter((c) => c.taskId !== taskId)),
    confirm: async (q) => {
      questions.push(q)
      return answers.shift() ?? false
    }
  }
  return { host, data, questions }
}

/** Runs commands in order, as typed at the prompt, re-numbering after each listing like the terminal style does. */
async function run(host: ShellHost, ...inputs: string[]): Promise<{ out: string[]; state: ShellState }> {
  let state = initialShellState()
  const out: string[] = []
  for (const input of inputs) {
    const result = await runCommand(input, state, host, NOW)
    state = result.state
    const view = buildListing(state.listing, host.data(), NOW)
    state = { ...state, shown: view.rows.map((r) => r.task.id) }
    out.push(...result.lines.map(lineText))
  }
  return { out, state }
}

describe('tokenize', () => {
  it('splits like a shell', () => {
    expect(tokenize(`add "buy milk" p1  'it''s' a\\ b`)).toEqual([
      { text: 'add', quoted: false },
      { text: 'buy milk', quoted: true },
      { text: 'p1', quoted: false },
      { text: 'its', quoted: true },
      { text: 'a b', quoted: false }
    ])
    expect(tokenize('   ')).toEqual([])
  })
})

describe('parseDueDate', () => {
  const day = (iso: string | null | undefined) => iso?.slice(0, 10)
  it('reads relative and absolute dates', () => {
    expect(day(parseDueDate('today', NOW))).toBe('2026-11-18')
    expect(day(parseDueDate('tomorrow', NOW))).toBe('2026-11-19')
    expect(day(parseDueDate('fri', NOW))).toBe('2026-11-20')
    // A weekday is the next one, never today.
    expect(day(parseDueDate('wednesday', NOW))).toBe('2026-11-25')
    expect(day(parseDueDate('+3d', NOW))).toBe('2026-11-21')
    expect(day(parseDueDate('2w', NOW))).toBe('2026-12-02')
    expect(day(parseDueDate('12-24', NOW))).toBe('2026-12-24')
    // A month-day that has passed is next year's.
    expect(day(parseDueDate('1/5', NOW))).toBe('2027-01-05')
    expect(parseDueDate('2026-12-24', NOW)).toBe('2026-12-24T00:00:00.000Z')
  })

  it('clears with none and rejects nonsense', () => {
    expect(parseDueDate('none', NOW)).toBeNull()
    expect(parseDueDate('2026-02-30', NOW)).toBeUndefined()
    expect(parseDueDate('soon', NOW)).toBeUndefined()
    expect(parseDueDate('fr', NOW)).toBeUndefined()
  })
})

describe('parseTaskOptions', () => {
  it('pulls out priority, star, due date and list', () => {
    const opts = parseTaskOptions(tokenize('call mom p1 * due:fri -l Work'), NOW)
    expect(opts).toMatchObject({ words: ['call', 'mom'], priority: 1, starred: true, list: 'Work', errors: [] })
    expect(opts.due?.slice(0, 10)).toBe('2026-11-20')
  })

  it('keeps quoted words and words after -- as text', () => {
    const opts = parseTaskOptions(tokenize('"p1" review -- * p2'), NOW)
    expect(opts.words).toEqual(['p1', 'review', '*', 'p2'])
    expect(opts.priority).toBeUndefined()
    expect(opts.starred).toBeUndefined()
  })

  it('reports a bad date', () => {
    expect(parseTaskOptions(tokenize('x due:someday'), NOW).errors[0]).toMatch(/not a date: someday/)
  })
})

describe('lists', () => {
  const { data } = memoryHost()
  it('names lists by path', () => {
    expect(listPath(MAIN_LIST_ID, data)).toBe('~')
    expect(listPath('work', data)).toBe('~/Work')
    expect(listPath('groceries', data)).toBe('~/Home/Groceries')
  })

  it('finds lists by path, name or prefix', () => {
    const id = (arg: string) => {
      const r = findList(arg, data)
      return 'list' in r ? r.list.id : r.error
    }
    expect(id('~')).toBe(MAIN_LIST_ID)
    expect(id('tasks')).toBe(MAIN_LIST_ID)
    expect(id('~/work')).toBe('work')
    expect(id('Home/Groceries')).toBe('groceries')
    expect(id('groc')).toBe('groceries')
    expect(id('home')).toMatch(/is a folder; its lists: Home\/Groceries/)
    expect(id('nope')).toMatch(/no such list/)
  })
})

describe('buildListing', () => {
  it('ranks the main list and hides done tasks unless asked', () => {
    const data = memoryHost({
      tasks: [task('low', { priority: 5 }), task('urgent', { priority: 1, dueDate: '2026-11-10T00:00:00.000Z' }), task('done', { completed: true, completedAt: '2026-11-17T00:00:00.000Z' })]
    }).data
    const view = buildListing({ kind: 'list', listId: MAIN_LIST_ID, all: false }, data, NOW)
    expect(view.rows.map((r) => r.task.id)).toEqual(['urgent', 'low'])
    expect(view.hiddenDone).toBe(1)
    expect(formatListing(view).map(lineText)).toEqual(['1 [ ] p1   Task urgent  due Nov 10', '2 [ ] p5   Task low', '-- 1 done (ls -a shows them)'])
    expect(view.rows[0].overdue).toBe(true)

    const all = buildListing({ kind: 'list', listId: MAIN_LIST_ID, all: true }, data, NOW)
    expect(all.rows.map((r) => r.task.id)).toEqual(['urgent', 'low', 'done'])
  })

  it('shows each task’s list where lists mix', () => {
    const data = memoryHost({ tasks: [task('a', { starred: true, listId: 'groceries' }), task('b')] }).data
    const view = buildListing({ kind: 'starred' }, data, NOW)
    expect(formatListing(view).map(lineText)).toEqual(['1 [ ] p3 * Task a  ~/Home/Groceries'])
  })
})

describe('runCommand', () => {
  it('adds a task to the current list with its options', async () => {
    const { host, data } = memoryHost()
    const { out } = await run(host, 'cd work', 'add Write report p2 * due:tomorrow')
    expect(data.tasks).toHaveLength(1)
    expect(data.tasks[0]).toMatchObject({ title: 'Write report', listId: 'work', priority: 2, starred: true, dueDate: '2026-11-19T00:00:00.000Z' })
    expect(out).toEqual(['+ Write report  p2 * due Nov 19'])
  })

  it('adds to another list with -l and says where', async () => {
    const { host, data } = memoryHost()
    const { out } = await run(host, 'add milk -l groc')
    expect(data.tasks[0].listId).toBe('groceries')
    expect(out[0]).toBe('+ milk  p3 ~/Home/Groceries')
  })

  it('edits tasks by their number in the listing', async () => {
    const { host, data } = memoryHost({ tasks: [task('a', { priority: 1 }), task('b', { priority: 2 }), task('c', { priority: 4 })] })
    await run(host, 'ls', 'done 1', 'ls', 'pri 1-2 p5')
    const byId = Object.fromEntries(data.tasks.map((t) => [t.id, t]))
    expect(byId.a.completed).toBe(true)
    expect(byId.a.completedAt).toBe(NOW.toISOString())
    expect(byId.b.priority).toBe(5)
    expect(byId.c.priority).toBe(5)
  })

  it('accepts ids, and explains a bad reference', async () => {
    const { host, data } = memoryHost({ tasks: [task('abcd-1234')] })
    await run(host, 'star abcd')
    expect(data.tasks[0].starred).toBe(true)
    const { out } = await run(host, 'ls', 'done 7')
    expect(out).toEqual(['done: 7: no such task in the last listing'])
  })

  it('moves, renames, notes and sets due dates', async () => {
    const { host, data } = memoryHost({ tasks: [task('a')] })
    await run(host, 'ls', 'mv 1 Work', 'ls work', 'rename 1 Ship it', 'note 1 first', 'note 1 second', 'due 1 2026-12-01')
    expect(data.tasks[0]).toMatchObject({ listId: 'work', title: 'Ship it', notes: 'first\nsecond', dueDate: '2026-12-01T00:00:00.000Z' })
    await run(host, 'ls work', 'due 1 none')
    expect(data.tasks[0].dueDate).toBeNull()
  })

  it('asks before deleting when the host has no undo', async () => {
    const declined = memoryHost({ tasks: [task('a')] })
    const { out } = await run(declined.host, 'ls', 'rm 1')
    expect(declined.questions).toEqual(['rm: delete "Task a"?'])
    expect(declined.data.tasks).toHaveLength(1)
    expect(out).toEqual(['rm: kept'])

    const forced = memoryHost({ tasks: [task('a')] })
    await run(forced.host, 'ls', 'rm -f 1')
    expect(forced.questions).toEqual([])
    expect(forced.data.tasks).toHaveLength(0)

    const undoable = memoryHost({ tasks: [task('a')] })
    undoable.host.undo = async () => []
    await run(undoable.host, 'ls', 'rm 1')
    expect(undoable.data.tasks).toHaveLength(0)
  })

  it('makes and removes lists, moving tasks to ~', async () => {
    const { host, data } = memoryHost({ tasks: [task('a', { listId: 'work' })] }, [true])
    const { state } = await run(host, 'mkdir Ideas', 'cd work', 'rmdir work')
    expect(data.lists.map((l) => l.name)).toEqual(['Tasks', 'Groceries', 'Ideas'])
    expect(data.tasks[0].listId).toBe(MAIN_LIST_ID)
    expect(state.cwd).toBe(MAIN_LIST_ID)
    const { out } = await run(host, 'rmdir ~')
    expect(out[0]).toMatch(/can’t be deleted/)
  })

  it('switches style, theme and font', async () => {
    const { host, data } = memoryHost()
    const { out } = await run(host, 'style term', 'theme night', 'font jetbrains')
    expect(data.settings.appearance).toMatchObject({ styleId: 'terminal', themeId: 'night', fontId: 'mono' })
    expect(out).toEqual(['style: Terminal', 'theme: Night', 'font: JetBrains Mono'])
  })

  it('searches every list', async () => {
    const { host } = memoryHost({ tasks: [task('a', { title: 'Buy milk', listId: 'groceries' }), task('b', { title: 'Call Bob' })] })
    const { state } = await run(host, 'find milk')
    expect(state.listing).toEqual({ kind: 'search', query: 'milk' })
    expect(state.shown).toEqual(['a'])
  })

  it('reports sync results and unknown commands', async () => {
    const { host } = memoryHost()
    expect((await run(host, 'sync')).out).toEqual(['sync: 1 pushed, 2 pulled'])
    expect((await run(host, 'frobnicate now')).out).toEqual([
      'todo: command not found: frobnicate',
      'to add a task: add frobnicate now   (help lists the commands)'
    ])
  })

  it('leaves out commands the host can’t do', async () => {
    const { host } = memoryHost()
    expect((await run(host, 'undo')).out[0]).toBe('todo: command not found: undo')
    const help = (await run(host, 'help')).out.join('\n')
    expect(help).not.toMatch(/^undo\s/m)
    expect(help).toMatch(/^add <title>/m)
  })
})

describe('complete', () => {
  const { host } = memoryHost()
  it('completes commands and lists', () => {
    expect(complete('sy', host)).toEqual({ line: 'sync ', options: ['sync'] })
    expect(complete('cd gr', host).line).toBe('cd Home/Groceries ')
    expect(complete('cd ', host).options).toEqual(['~', 'Work', 'Home/Groceries'])
    expect(complete('st', host).options).toEqual(['star', 'status', 'style'])
    expect(complete('theme ph', host).line).toBe('theme Phosphor ')
  })
})
