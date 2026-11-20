import type { Priority, SyncConflict, SyncResult, SyncedSettings, Task, TaskFolder, TaskList } from './types'
import { MAIN_LIST_ID } from './types'
import type { NewTaskInput } from './newTask'
import { orderPlainList, rankTasks } from './ranking'
import { searchTasks } from './search'
import { localDateString, shortDueDate } from './calendar'
import { buildSidebarTree } from './sidebarTree'
import { allThemes, resolveTheme } from './themes'
import { FONTS, resolveFont } from './fonts'
import { STYLES, resolveStyle } from './styles'
import { catalogEntry } from './extensions'

/**
 * The command language shared by the terminal style (renderer/components/terminal) and the `todo` CLI (cli/).
 * Both front ends hand `runCommand` a `ShellHost` that reads and writes their own store; the commands, their
 * parsing and their output are the same everywhere. Output is lines of toned segments, which the terminal style
 * draws as spans and the CLI as ANSI colors.
 *
 * Tasks are referred to by their number in the last listing (`done 2`, `rm 1-3`, `pri 1,4 p2`) or by the start of
 * their id. Lists are paths: `~` is the main Tasks list, `~/Work` a list, `~/Folder/List` a list in a folder.
 */

// ---- Output ----

export type Tone = 'dim' | 'error' | 'ok' | 'mark' | 'bold'
/** Parts of a listing row that the terminal style makes clickable: the number (types it at the prompt), the box, the title. */
export type Part = 'n' | 'check' | 'title'
export interface Segment {
  text: string
  tone?: Tone
  part?: Part
  taskId?: string
}
export type Line = Segment[]

const text = (value: string, tone?: Tone): Line => [{ text: value, tone }]

export function lineText(line: Line): string {
  return line.map((s) => s.text).join('')
}

// ---- State ----

export type Listing = { kind: 'list'; listId: string; all: boolean } | { kind: 'starred' } | { kind: 'search'; query: string }

export interface ShellState {
  /** The current list: where `add` puts tasks, and what the prompt shows. */
  cwd: string
  /** What the listing shows; `ls <list>` and `find` change it without changing `cwd`. */
  listing: Listing
  /** Ids of the tasks the last listing numbered, so `done 2` means the second task shown. */
  shown: string[]
}

export function initialShellState(): ShellState {
  return { cwd: MAIN_LIST_ID, listing: { kind: 'list', listId: MAIN_LIST_ID, all: false }, shown: [] }
}

export interface ShellData {
  tasks: Task[]
  lists: TaskList[]
  folders: TaskFolder[]
  settings: SyncedSettings
  conflicts: SyncConflict[]
}

/** What a front end provides: its data, and the writes behind each command. */
export interface ShellHost {
  data(): ShellData
  addTask(input: NewTaskInput): Promise<Task>
  updateTask(task: Task): Promise<void>
  deleteTask(id: string): Promise<void>
  addList(name: string): Promise<void>
  /** Deletes a list; its tasks move to the main Tasks list. */
  deleteList(id: string): Promise<void>
  saveSettings(settings: SyncedSettings): Promise<void>
  /** Null when a sync was already running (it runs again when that one ends). */
  sync(): Promise<SyncResult | null>
  resolveConflict(taskId: string, keep: 'local' | 'remote'): Promise<void>
  /** A yes/no question; the terminal style asks it at the prompt, the CLI on stdin. */
  confirm(question: string): Promise<boolean>
  // Front-end specific; a command whose method is missing isn't offered.
  undo?(): Promise<Line[]>
  log?(): Line[]
  status?(): Line[]
  open?(taskId: string): void
  openSettings?(): void
  clear?(): void
  exit?(): Promise<void>
}

// ---- Paths ----

/** `~` for the main list, `~/Name` for a list, `~/Folder/Name` for a list in a folder. */
export function listPath(listId: string, data: Pick<ShellData, 'lists' | 'folders'>): string {
  if (listId === MAIN_LIST_ID) return '~'
  const list = data.lists.find((l) => l.id === listId)
  if (!list) return '~/?'
  const folder = list.folderId ? data.folders.find((f) => f.id === list.folderId) : undefined
  return folder ? `~/${folder.name}/${list.name}` : `~/${list.name}`
}

/** Quotes an argument that has spaces or quotes in it, so it can be typed back. */
export function quoteArg(value: string): string {
  return /[\s"'\\]/.test(value) || value === '' ? `"${value.replace(/["\\]/g, '\\$&')}"` : value
}

/** Finds a list by path (`~`, `~/Work`, `Folder/List`), name, or unique start of its name; case doesn't matter. */
export function findList(arg: string, data: Pick<ShellData, 'lists' | 'folders'>): { list: TaskList } | { error: string } {
  const main = data.lists.find((l) => l.id === MAIN_LIST_ID) ?? { id: MAIN_LIST_ID, name: 'Tasks', order: -1 }
  const raw = arg.trim()
  if (['~', '~/', '/', '..', ''].includes(raw)) return { list: main }
  const wanted = raw.replace(/^~\//, '').replace(/\/+$/, '').toLowerCase()
  const candidates = data.lists.map((list) => ({ list, path: list.id === MAIN_LIST_ID ? list.name : listPath(list.id, data).slice(2) }))

  const exact = candidates.filter((c) => c.path.toLowerCase() === wanted || c.list.name.toLowerCase() === wanted)
  if (exact.length === 1) return { list: exact[0].list }
  if (exact.length > 1) return { error: `${raw}: more than one list has that name; use ${exact.map((c) => quoteArg(c.path)).join(' or ')}` }

  const folder = data.folders.find((f) => f.name.toLowerCase() === wanted)
  if (folder) {
    const inside = data.lists.filter((l) => l.folderId === folder.id).map((l) => quoteArg(`${folder.name}/${l.name}`))
    return { error: `${raw}: is a folder${inside.length ? `; its lists: ${inside.join(', ')}` : ''}` }
  }

  const prefix = candidates.filter((c) => c.path.toLowerCase().startsWith(wanted) || c.list.name.toLowerCase().startsWith(wanted))
  if (prefix.length === 1) return { list: prefix[0].list }
  if (prefix.length > 1) return { error: `${raw}: could be ${prefix.map((c) => quoteArg(c.path)).join(', ')}` }
  return { error: `${raw}: no such list (tree shows them)` }
}

// ---- Listing ----

export interface ListingRow {
  n: number
  task: Task
  /** Short due date, or null. */
  due: string | null
  overdue: boolean
  /** The task's list, in listings that mix lists (starred, search). */
  path: string | null
  conflict: boolean
}

export interface ListingView {
  rows: ListingRow[]
  /** Done tasks left out (`ls -a` shows them). */
  hiddenDone: number
  empty: string
}

/** The tasks a listing shows, in the same order as the standard style's list. */
export function buildListing(listing: Listing, data: ShellData, now: Date = new Date()): ListingView {
  const { settings } = data
  const live = data.tasks.filter((t) => !t.archived)
  let open: Task[]
  let done: Task[] = []
  let showDone = true
  let mixes = true
  let empty: string

  if (listing.kind === 'list') {
    const inList = live.filter((t) => t.listId === listing.listId)
    const active = inList.filter((t) => !t.completed)
    open = listing.listId === MAIN_LIST_ID ? rankTasks(active, settings.ranking, now) : orderPlainList(active, settings.ranking)
    done = inList.filter((t) => t.completed)
    showDone = listing.all
    mixes = false
    empty = inList.length ? 'nothing to do' : 'empty. add <title> to add a task'
  } else if (listing.kind === 'starred') {
    open = rankTasks(
      live.filter((t) => t.starred && !t.completed),
      settings.ranking,
      now
    )
    empty = 'no starred tasks. star <n> stars one'
  } else {
    const matches = searchTasks(data.tasks, listing.query)
    open = rankTasks(
      matches.filter((t) => !t.completed),
      settings.ranking,
      now
    )
    done = matches.filter((t) => t.completed)
    empty = `no tasks match ${quoteArg(listing.query)}`
  }
  done.sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''))

  const today = localDateString(now)
  const conflictIds = new Set(data.conflicts.map((c) => c.taskId))
  const tasks = showDone ? [...open, ...done] : open
  return {
    rows: tasks.map((task, i) => ({
      n: i + 1,
      task,
      due: task.dueDate ? shortDueDate(task.dueDate, now) : null,
      overdue: !task.completed && !!task.dueDate && task.dueDate.slice(0, 10) < today,
      path: mixes ? listPath(task.listId, data) : null,
      conflict: conflictIds.has(task.id)
    })),
    hiddenDone: showDone ? 0 : done.length,
    empty
  }
}

/** One row: ` 2 [ ] p1 * Title  due Nov 20  ~/Work`. Columns line up in a monospace font. */
export function formatRow(row: ListingRow, numberWidth: number): Line {
  const t = row.task
  const id = t.id
  const quiet = t.completed || t.priority >= 4
  const line: Line = [
    { text: String(row.n).padStart(numberWidth), tone: 'dim', part: 'n', taskId: id },
    { text: ' ' },
    { text: t.completed ? '[x]' : '[ ]', tone: t.completed ? 'dim' : undefined, part: 'check', taskId: id },
    { text: ' ' },
    { text: `p${t.priority}`, tone: t.priority === 1 && !t.completed ? 'error' : 'dim' },
    { text: ' ' },
    t.starred ? { text: '*', tone: 'mark' } : { text: ' ' },
    { text: ' ' },
    { text: t.title || '(untitled)', tone: t.completed ? 'dim' : t.priority === 1 ? 'bold' : quiet ? 'dim' : undefined, part: 'title', taskId: id }
  ]
  if (row.due) line.push({ text: '  ' }, { text: `due ${row.due}`, tone: row.overdue ? 'error' : 'dim' })
  if (row.path) line.push({ text: '  ' }, { text: row.path, tone: 'dim' })
  if (row.conflict) line.push({ text: '  ' }, { text: '!conflict', tone: 'error' })
  return line
}

export function formatListing(view: ListingView): Line[] {
  const width = String(view.rows.length).length
  const lines = view.rows.map((row) => formatRow(row, width))
  if (!view.rows.length) lines.push(text(view.empty, 'dim'))
  if (view.hiddenDone) lines.push(text(`-- ${view.hiddenDone} done (ls -a shows them)`, 'dim'))
  return lines
}

/** The command that shows `listing`, as typed from `cwd`: what the terminal style prints above its listing. */
export function listingCommand(listing: Listing, cwd: string, data: ShellData): string {
  if (listing.kind === 'starred') return 'ls -s'
  if (listing.kind === 'search') return `find ${listing.query}`
  const flags = listing.all ? ' -a' : ''
  return listing.listId === cwd ? `ls${flags}` : `ls${flags} ${quoteArg(listPath(listing.listId, data))}`
}

// ---- Parsing ----

export interface Token {
  text: string
  /** Typed in quotes, so it's never read as an option (`add "p1"` adds a task called p1). */
  quoted: boolean
}

/** Splits a command line like a shell: whitespace separates, quotes group, backslash escapes. */
export function tokenize(input: string): Token[] {
  const tokens: Token[] = []
  let current = ''
  let quoted = false
  let inToken = false
  let quote: string | null = null
  for (let i = 0; i < input.length; i++) {
    const c = input[i]
    if (quote) {
      if (c === quote) quote = null
      else if (c === '\\' && quote === '"' && i + 1 < input.length) current += input[++i]
      else current += c
      continue
    }
    if (c === '"' || c === "'") {
      quote = c
      quoted = true
      inToken = true
    } else if (/\s/.test(c)) {
      if (inToken) tokens.push({ text: current, quoted })
      current = ''
      quoted = false
      inToken = false
    } else if (c === '\\' && i + 1 < input.length) {
      current += input[++i]
      inToken = true
    } else {
      current += c
      inToken = true
    }
  }
  if (inToken) tokens.push({ text: current, quoted })
  return tokens
}

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

/**
 * A due date as typed: today, tomorrow, yesterday, a weekday (the next one, never today), +3d, +2w, 12-24 (the next Dec 24),
 * 2026-12-24, or none. Returns the stored form (midnight UTC of the day), null for "no due date", or undefined when
 * `value` isn't a date.
 */
export function parseDueDate(value: string, now: Date = new Date()): string | null | undefined {
  const v = value.trim().toLowerCase()
  const stored = (y: number, m: number, d: number): string | undefined => {
    const date = new Date(Date.UTC(y, m - 1, d))
    if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return undefined
    return date.toISOString()
  }
  const inDays = (n: number): string => {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + n)
    return stored(d.getFullYear(), d.getMonth() + 1, d.getDate())!
  }

  if (['none', 'never', 'clear', '-'].includes(v)) return null
  if (v === 'today' || v === 'tod') return inDays(0)
  if (v === 'tomorrow' || v === 'tom' || v === 'tmr') return inDays(1)
  if (v === 'yesterday') return inDays(-1)
  if (v.length >= 3) {
    const weekday = WEEKDAYS.findIndex((w) => w.startsWith(v))
    if (weekday >= 0) return inDays((weekday - now.getDay() + 7) % 7 || 7)
  }
  let m = /^\+?(\d{1,3})([dw])$/.exec(v)
  if (m) return inDays(Number(m[1]) * (m[2] === 'w' ? 7 : 1))
  m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(v)
  if (m) return stored(Number(m[1]), Number(m[2]), Number(m[3]))
  m = /^(\d{1,2})[-/](\d{1,2})$/.exec(v)
  if (m) {
    const [month, day] = [Number(m[1]), Number(m[2])]
    const thisYear = stored(now.getFullYear(), month, day)
    if (!thisYear) return undefined
    return thisYear.slice(0, 10) < localDateString(now) ? stored(now.getFullYear() + 1, month, day) : thisYear
  }
  return undefined
}

const DATE_HINT = 'try today, tomorrow, fri, +3d, +2w, 12-24, 2026-12-24 or none'

interface TaskOptions {
  words: string[]
  priority?: Priority
  starred?: boolean
  /** Set when a due date was given; null clears it. */
  due?: string | null
  list?: string
  errors: string[]
}

/** Pulls `p1`–`p5`, `*` (or `-s`), `due:<date>` and `-l <list>` out of a task's words. Quoted words and words after `--` are kept as text. */
export function parseTaskOptions(tokens: Token[], now: Date = new Date()): TaskOptions {
  const out: TaskOptions = { words: [], errors: [] }
  let literal = false
  for (let i = 0; i < tokens.length; i++) {
    const { text: t, quoted } = tokens[i]
    if (literal || quoted) {
      out.words.push(t)
    } else if (t === '--') {
      literal = true
    } else if (/^p[1-5]$/i.test(t)) {
      out.priority = Number(t[1]) as Priority
    } else if (t === '*' || t === '-s' || t === '--star') {
      // -s for shells that would expand a bare * into file names.
      out.starred = true
    } else if (/^due:/i.test(t)) {
      const value = t.slice(4) || tokens[++i]?.text || ''
      const due = parseDueDate(value, now)
      if (due === undefined) out.errors.push(`not a date: ${quoteArg(value)} (${DATE_HINT})`)
      else out.due = due
    } else if (t === '-l' || t === '--list') {
      const value = tokens[++i]?.text
      if (value === undefined) out.errors.push(`${t} needs a list`)
      else out.list = value
    } else {
      out.words.push(t)
    }
  }
  return out
}

/** Resolves `2`, `1-3`, `1,4` and id prefixes to tasks. */
export function resolveRefs(args: string[], state: ShellState, data: ShellData): { tasks: Task[]; errors: string[] } {
  const byId = new Map(data.tasks.map((t) => [t.id, t]))
  const ids: string[] = []
  const errors: string[] = []
  const byNumber = (n: number) => {
    const id = state.shown[n - 1]
    if (id && byId.has(id)) ids.push(id)
    else errors.push(state.shown.length ? `${n}: no such task in the last listing` : `${n}: no listing yet; run ls first`)
  }
  for (const arg of args) {
    for (const part of arg.split(',').filter(Boolean)) {
      const range = /^(\d+)-(\d+)$/.exec(part)
      if (range) {
        const [from, to] = [Number(range[1]), Number(range[2])]
        if (to < from || to - from > 500) errors.push(`${part}: not a range`)
        else for (let n = from; n <= to; n++) byNumber(n)
      } else if (/^\d+$/.test(part)) {
        byNumber(Number(part))
      } else if (/^[0-9a-f-]{4,}$/i.test(part)) {
        const matches = data.tasks.filter((t) => t.id.startsWith(part.toLowerCase()))
        if (matches.length === 1) ids.push(matches[0].id)
        else errors.push(`${part}: ${matches.length ? 'more than one task has an id starting with that' : 'no task has that id'}`)
      } else {
        errors.push(`${part}: not a task number or id`)
      }
    }
  }
  return { tasks: [...new Set(ids)].map((id) => byId.get(id)!), errors }
}

// ---- Commands ----

interface Ctx {
  host: ShellHost
  state: ShellState
  data: ShellData
  now: Date
  out: Line[]
  listed: boolean
  print(value: string, tone?: Tone): void
  /** Prints a command's errors; true when there were any. */
  failed(command: string, errors: string[]): boolean
}

interface Command {
  name: string
  aliases?: string[]
  usage: string
  summary: string
  available?: (host: ShellHost) => boolean
  run(args: Token[], ctx: Ctx): Promise<void> | void
}

const words = (args: Token[]) => args.map((a) => a.text)
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/** Splits `<refs...> <last>`, for commands like `pri 1 2 p1` and `mv 3 Work`. */
function refsAndLast(args: Token[]): { refs: string[]; last: string | undefined } {
  const all = words(args)
  return all.length < 2 ? { refs: [], last: undefined } : { refs: all.slice(0, -1), last: all[all.length - 1] }
}

async function editTasks(ctx: Ctx, command: string, refs: string[], change: (t: Task) => Task | null, describe: (t: Task) => string): Promise<void> {
  const { tasks, errors } = resolveRefs(refs, ctx.state, ctx.data)
  if (ctx.failed(command, errors)) return
  for (const task of tasks) {
    const next = change(task)
    if (!next) {
      ctx.print(`${command}: ${task.title}: nothing to change`, 'dim')
      continue
    }
    await ctx.host.updateTask(next)
    ctx.print(describe(next))
  }
}

function needsUsage(ctx: Ctx, command: Command, ok: boolean): boolean {
  if (!ok) ctx.print(`usage: ${command.usage}`, 'error')
  return !ok
}

function selectSetting<T extends { id: string; name: string }>(
  ctx: Ctx,
  kind: string,
  options: T[],
  currentId: string,
  query: string,
  save: (option: T) => Promise<void>
): Promise<void> | void {
  if (!query) {
    for (const o of options) ctx.out.push([{ text: o.id === currentId ? '* ' : '  ', tone: 'ok' }, { text: o.name, tone: o.id === currentId ? 'bold' : undefined }])
    return
  }
  const q = query.toLowerCase()
  const exact = options.filter((o) => o.id.toLowerCase() === q || o.name.toLowerCase() === q)
  const matches = exact.length ? exact : options.filter((o) => o.id.toLowerCase().startsWith(q) || o.name.toLowerCase().startsWith(q))
  if (matches.length !== 1) {
    ctx.print(`${kind}: ${matches.length ? `could be ${matches.map((o) => o.name).join(', ')}` : `no ${kind} called ${quoteArg(query)}`}`, 'error')
    return
  }
  return save(matches[0]).then(() => ctx.print(`${kind}: ${matches[0].name}`))
}

const COMMANDS: Command[] = [
  {
    name: 'help',
    aliases: ['?', 'man'],
    usage: 'help [command]',
    summary: 'this list, or one command',
    run(args, ctx) {
      const shown = COMMANDS.filter((c) => !c.available || c.available(ctx.host))
      const wanted = args[0]?.text.toLowerCase()
      if (wanted) {
        const c = shown.find((x) => x.name === wanted || x.aliases?.includes(wanted))
        if (!c) return ctx.print(`help: no command ${quoteArg(wanted)}`, 'error')
        ctx.print(c.usage, 'bold')
        ctx.print(`  ${c.summary}${c.aliases?.length ? ` (also: ${c.aliases.join(', ')})` : ''}`)
        return
      }
      // Long usages (add's) don't push every summary far right; they just get less room.
      const width = Math.min(26, Math.max(...shown.map((c) => c.usage.length)))
      for (const c of shown) ctx.out.push([{ text: `${c.usage.padEnd(width)}  ` }, { text: c.summary, tone: 'dim' }])
      ctx.print('')
      ctx.print('n: a number from the listing, a range (1-3), a list (1,4) or the start of an id', 'dim')
      ctx.print(`dates: ${DATE_HINT.replace('try ', '')}`, 'dim')
    }
  },
  {
    name: 'ls',
    aliases: ['ll', 'dir'],
    usage: 'ls [-a] [-s] [list]',
    summary: 'list tasks (-a: done ones too, -s: starred in every list)',
    run(args, ctx) {
      let all = false
      let starred = false
      const rest: string[] = []
      for (const a of words(args)) {
        if (/^-[as]+$/.test(a)) {
          all ||= a.includes('a')
          starred ||= a.includes('s')
        } else if (a === '--all') all = true
        else if (a === '--starred') starred = true
        else rest.push(a)
      }
      if (starred) {
        ctx.state.listing = { kind: 'starred' }
      } else {
        let listId = ctx.state.cwd
        if (rest.length) {
          const found = findList(rest.join(' '), ctx.data)
          if ('error' in found) return ctx.print(`ls: ${found.error}`, 'error')
          listId = found.list.id
        }
        ctx.state.listing = { kind: 'list', listId, all }
      }
      ctx.listed = true
    }
  },
  {
    name: 'cd',
    usage: 'cd [list]',
    summary: 'go to a list (no list: ~, the main Tasks list)',
    run(args, ctx) {
      const found = findList(words(args).join(' '), ctx.data)
      if ('error' in found) return ctx.print(`cd: ${found.error}`, 'error')
      ctx.state.cwd = found.list.id
      ctx.state.listing = { kind: 'list', listId: found.list.id, all: false }
      ctx.listed = true
    }
  },
  {
    name: 'pwd',
    usage: 'pwd',
    summary: 'the current list',
    run: (_args, ctx) => ctx.print(listPath(ctx.state.cwd, ctx.data))
  },
  {
    name: 'tree',
    aliases: ['lists'],
    usage: 'tree',
    summary: 'every list and folder, with open task counts',
    run(_args, ctx) {
      const open = (listId: string) => ctx.data.tasks.filter((t) => t.listId === listId && !t.completed && !t.archived).length
      const count = (listId: string): Segment => ({ text: `  ${open(listId)}`, tone: 'dim' })
      ctx.out.push([{ text: '~', tone: 'bold' }, count(MAIN_LIST_ID)])
      const entries = buildSidebarTree(ctx.data.lists, ctx.data.folders)
      entries.forEach((entry, i) => {
        const last = i === entries.length - 1
        const branch = last ? '└── ' : '├── '
        if (entry.kind === 'list') {
          ctx.out.push([{ text: branch, tone: 'dim' }, { text: entry.list.name }, count(entry.list.id)])
          return
        }
        ctx.out.push([{ text: branch, tone: 'dim' }, { text: `${entry.folder.name}/`, tone: 'bold' }])
        entry.lists.forEach((list, j) => {
          const inner = (last ? '    ' : '│   ') + (j === entry.lists.length - 1 ? '└── ' : '├── ')
          ctx.out.push([{ text: inner, tone: 'dim' }, { text: list.name }, count(list.id)])
        })
      })
    }
  },
  {
    name: 'find',
    aliases: ['grep', 'search'],
    usage: 'find <words>',
    summary: 'search titles and notes in every list',
    run(args, ctx) {
      const query = words(args).join(' ').trim()
      if (needsUsage(ctx, COMMANDS_BY_NAME.find, !!query)) return
      ctx.state.listing = { kind: 'search', query }
      ctx.listed = true
    }
  },
  {
    name: 'add',
    aliases: ['a', 'touch'],
    usage: 'add <title> [p1-p5] [*] [due:<date>] [-l <list>]',
    summary: 'add a task here (* or -s stars it)',
    async run(args, ctx) {
      const opts = parseTaskOptions(args, ctx.now)
      if (ctx.failed('add', opts.errors)) return
      const title = opts.words.join(' ').trim()
      if (needsUsage(ctx, COMMANDS_BY_NAME.add, !!title)) return
      let listId = ctx.data.lists.some((l) => l.id === ctx.state.cwd) ? ctx.state.cwd : MAIN_LIST_ID
      if (opts.list !== undefined) {
        const found = findList(opts.list, ctx.data)
        if ('error' in found) return ctx.print(`add: ${found.error}`, 'error')
        listId = found.list.id
      }
      const task = await ctx.host.addTask({ title, listId, priority: opts.priority, starred: opts.starred, dueDate: opts.due ?? null })
      const details = [`p${task.priority}`, task.starred ? '*' : '', task.dueDate ? `due ${shortDueDate(task.dueDate, ctx.now)}` : '', listId !== ctx.state.cwd ? listPath(listId, ctx.data) : '']
      ctx.out.push([{ text: '+ ', tone: 'ok' }, { text: task.title }, { text: `  ${details.filter(Boolean).join(' ')}`, tone: 'dim' }])
    }
  },
  {
    name: 'done',
    aliases: ['x', 'check'],
    usage: 'done <n...>',
    summary: 'mark tasks done',
    async run(args, ctx) {
      if (needsUsage(ctx, COMMANDS_BY_NAME.done, args.length > 0)) return
      const at = ctx.now.toISOString()
      await editTasks(ctx, 'done', words(args), (t) => (t.completed ? null : { ...t, completed: true, completedAt: at }), (t) => `[x] ${t.title}`)
    }
  },
  {
    name: 'undone',
    aliases: ['reopen', 'uncheck'],
    usage: 'undone <n...>',
    summary: 'mark done tasks as not done',
    async run(args, ctx) {
      if (needsUsage(ctx, COMMANDS_BY_NAME.undone, args.length > 0)) return
      await editTasks(ctx, 'undone', words(args), (t) => (t.completed ? { ...t, completed: false, completedAt: null } : null), (t) => `[ ] ${t.title}`)
    }
  },
  {
    name: 'rm',
    aliases: ['del'],
    usage: 'rm [-f] <n...>',
    summary: 'delete tasks',
    async run(args, ctx) {
      const force = args.some((a) => a.text === '-f')
      const refs = words(args).filter((a) => a !== '-f')
      if (needsUsage(ctx, COMMANDS_BY_NAME.rm, refs.length > 0)) return
      const { tasks, errors } = resolveRefs(refs, ctx.state, ctx.data)
      if (ctx.failed('rm', errors)) return
      // Where there's no undo (the CLI), deleting asks first.
      if (!force && !ctx.host.undo) {
        const names = tasks.map((t) => `"${t.title}"`).join(', ')
        if (!(await ctx.host.confirm(`rm: delete ${tasks.length === 1 ? names : `${tasks.length} tasks (${names})`}?`))) return ctx.print('rm: kept', 'dim')
      }
      for (const task of tasks) {
        await ctx.host.deleteTask(task.id)
        ctx.out.push([{ text: '- ', tone: 'error' }, { text: task.title }])
      }
    }
  },
  {
    name: 'pri',
    aliases: ['p'],
    usage: 'pri <n...> <1-5>',
    summary: 'set the priority (p1 is the most urgent)',
    async run(args, ctx) {
      const { refs, last } = refsAndLast(args)
      const m = last ? /^p?([1-5])$/i.exec(last) : null
      if (needsUsage(ctx, COMMANDS_BY_NAME.pri, !!m && refs.length > 0)) return
      const priority = Number(m![1]) as Priority
      await editTasks(ctx, 'pri', refs, (t) => (t.priority === priority ? null : { ...t, priority }), (t) => `p${t.priority} ${t.title}`)
    }
  },
  {
    name: 'star',
    usage: 'star <n...>',
    summary: 'star tasks (ls -s shows them all)',
    async run(args, ctx) {
      if (needsUsage(ctx, COMMANDS_BY_NAME.star, args.length > 0)) return
      await editTasks(ctx, 'star', words(args), (t) => (t.starred ? null : { ...t, starred: true }), (t) => `* ${t.title}`)
    }
  },
  {
    name: 'unstar',
    usage: 'unstar <n...>',
    summary: 'unstar tasks',
    async run(args, ctx) {
      if (needsUsage(ctx, COMMANDS_BY_NAME.unstar, args.length > 0)) return
      await editTasks(ctx, 'unstar', words(args), (t) => (t.starred ? { ...t, starred: false } : null), (t) => `  ${t.title}`)
    }
  },
  {
    name: 'due',
    usage: 'due <n...> <date|none>',
    summary: 'set or clear the due date',
    async run(args, ctx) {
      const { refs, last } = refsAndLast(args)
      if (needsUsage(ctx, COMMANDS_BY_NAME.due, refs.length > 0)) return
      const due = parseDueDate(last!, ctx.now)
      if (due === undefined) return ctx.print(`due: not a date: ${quoteArg(last!)} (${DATE_HINT})`, 'error')
      await editTasks(
        ctx,
        'due',
        refs,
        (t) => (t.dueDate === due ? null : { ...t, dueDate: due }),
        (t) => `${t.dueDate ? `due ${shortDueDate(t.dueDate, ctx.now)}` : 'no due date'}  ${t.title}`
      )
    }
  },
  {
    name: 'mv',
    aliases: ['move'],
    usage: 'mv <n...> <list>',
    summary: 'move tasks to another list',
    async run(args, ctx) {
      const { refs, last } = refsAndLast(args)
      if (needsUsage(ctx, COMMANDS_BY_NAME.mv, refs.length > 0)) return
      const found = findList(last!, ctx.data)
      if ('error' in found) return ctx.print(`mv: ${found.error}`, 'error')
      const listId = found.list.id
      await editTasks(ctx, 'mv', refs, (t) => (t.listId === listId ? null : { ...t, listId }), (t) => `${t.title} -> ${listPath(listId, ctx.data)}`)
    }
  },
  {
    name: 'rename',
    aliases: ['ren'],
    usage: 'rename <n> <title>',
    summary: 'change a task’s title',
    async run(args, ctx) {
      const title = words(args.slice(1)).join(' ').trim()
      if (needsUsage(ctx, COMMANDS_BY_NAME.rename, args.length > 0 && !!title)) return
      await editTasks(ctx, 'rename', [args[0].text], (t) => (t.title === title ? null : { ...t, title }), (t) => `renamed: ${t.title}`)
    }
  },
  {
    name: 'note',
    aliases: ['notes'],
    usage: 'note <n> [text]',
    summary: 'add a line to a task’s notes, or show them',
    async run(args, ctx) {
      if (needsUsage(ctx, COMMANDS_BY_NAME.note, args.length > 0)) return
      const line = words(args.slice(1)).join(' ').trim()
      if (!line) {
        const { tasks, errors } = resolveRefs([args[0].text], ctx.state, ctx.data)
        if (ctx.failed('note', errors)) return
        for (const t of tasks) for (const l of (t.notes || '(no notes)').split('\n')) ctx.print(l, t.notes ? undefined : 'dim')
        return
      }
      await editTasks(ctx, 'note', [args[0].text], (t) => ({ ...t, notes: t.notes ? `${t.notes.replace(/\n+$/, '')}\n${line}` : line }), (t) => `noted: ${t.title}`)
    }
  },
  {
    name: 'cat',
    aliases: ['show', 'info'],
    usage: 'cat <n...>',
    summary: 'everything about a task',
    run(args, ctx) {
      if (needsUsage(ctx, COMMANDS_BY_NAME.cat, args.length > 0)) return
      const { tasks, errors } = resolveRefs(words(args), ctx.state, ctx.data)
      if (ctx.failed('cat', errors)) return
      tasks.forEach((t, i) => {
        if (i) ctx.print('')
        const field = (label: string, value: string, tone?: Tone) => ctx.out.push([{ text: `  ${label.padEnd(9)}`, tone: 'dim' }, { text: value, tone }])
        ctx.print(t.title, 'bold')
        field('id', t.id)
        field('list', listPath(t.listId, ctx.data))
        field('priority', `p${t.priority}${t.starred ? '  *starred' : ''}`)
        const day = (iso: string) => localDateString(new Date(iso))
        field('status', t.completed ? `done ${t.completedAt ? day(t.completedAt) : ''}` : t.archived ? 'archived' : 'open')
        if (t.dueDate) {
          const overdue = !t.completed && t.dueDate.slice(0, 10) < localDateString(ctx.now)
          field('due', `${shortDueDate(t.dueDate, ctx.now)}${overdue ? ' (overdue)' : ''}`, overdue ? 'error' : undefined)
        }
        field('created', day(t.createdAt))
        if (t.source) field('from', t.source.type.replace(/_/g, ' '))
        const conflict = ctx.data.conflicts.find((c) => c.taskId === t.id)
        if (conflict) field('conflict', `changed here and elsewhere; resolve ${t.id.slice(0, 8)} local|remote`, 'error')
        if (t.notes) {
          ctx.print('  notes', 'dim')
          for (const l of t.notes.split('\n')) ctx.print(`    ${l}`)
        }
      })
    }
  },
  {
    name: 'open',
    aliases: ['edit', 'vi', 'vim', 'nano'],
    usage: 'open <n>',
    summary: 'edit a task in a panel',
    available: (host) => !!host.open,
    run(args, ctx) {
      if (needsUsage(ctx, COMMANDS_BY_NAME.open, args.length === 1)) return
      const { tasks, errors } = resolveRefs([args[0].text], ctx.state, ctx.data)
      if (ctx.failed('open', errors)) return
      ctx.host.open!(tasks[0].id)
    }
  },
  {
    name: 'resolve',
    usage: 'resolve <n> [local|remote]',
    summary: 'pick a version of a task changed here and elsewhere',
    async run(args, ctx) {
      if (needsUsage(ctx, COMMANDS_BY_NAME.resolve, args.length === 1 || args.length === 2)) return
      const { tasks, errors } = resolveRefs([args[0].text], ctx.state, ctx.data)
      if (ctx.failed('resolve', errors)) return
      const conflict = ctx.data.conflicts.find((c) => c.taskId === tasks[0].id)
      if (!conflict) return ctx.print(`resolve: ${tasks[0].title}: no conflict`, 'dim')
      const keep = args[1]?.text.toLowerCase()
      if (keep !== 'local' && keep !== 'remote') {
        const describe = (t: Task) => `p${t.priority}${t.starred ? ' *' : ''} ${t.completed ? '[x]' : '[ ]'} ${t.title}  ${listPath(t.listId, ctx.data)}`
        ctx.out.push([{ text: '  local   ', tone: 'dim' }, { text: describe(conflict.local) }])
        ctx.out.push([{ text: '  remote  ', tone: 'dim' }, { text: describe(conflict.remote) }])
        if (conflict.local.notes !== conflict.remote.notes) ctx.print('  (the notes differ too)', 'dim')
        ctx.print(`resolve ${args[0].text} local   keeps this device’s version; remote takes the other`, 'dim')
        return
      }
      await ctx.host.resolveConflict(conflict.taskId, keep)
      ctx.print(`resolve: kept the ${keep} version of ${conflict.local.title}`)
    }
  },
  {
    name: 'mkdir',
    usage: 'mkdir <name>',
    summary: 'make a list',
    async run(args, ctx) {
      const name = words(args).join(' ').trim()
      if (needsUsage(ctx, COMMANDS_BY_NAME.mkdir, !!name)) return
      if (ctx.data.lists.some((l) => l.name.toLowerCase() === name.toLowerCase())) return ctx.print(`mkdir: ${name}: a list has that name already`, 'error')
      await ctx.host.addList(name)
      ctx.print(`made ~/${name}`)
    }
  },
  {
    name: 'rmdir',
    usage: 'rmdir [-f] <list>',
    summary: 'delete a list (its tasks move to ~)',
    async run(args, ctx) {
      const force = args.some((a) => a.text === '-f')
      const name = words(args.filter((a) => a.text !== '-f')).join(' ')
      if (needsUsage(ctx, COMMANDS_BY_NAME.rmdir, !!name)) return
      const found = findList(name, ctx.data)
      if ('error' in found) return ctx.print(`rmdir: ${found.error}`, 'error')
      const list = found.list
      if (list.id === MAIN_LIST_ID) return ctx.print('rmdir: ~ is the main list and can’t be deleted', 'error')
      const n = ctx.data.tasks.filter((t) => t.listId === list.id).length
      if (!force && !(await ctx.host.confirm(`rmdir: delete the list ${list.name}${n ? ` and move its ${plural(n, 'task')} to ~` : ''}?`)))
        return ctx.print('rmdir: kept', 'dim')
      await ctx.host.deleteList(list.id)
      if (ctx.state.cwd === list.id) ctx.state.cwd = MAIN_LIST_ID
      if (ctx.state.listing.kind === 'list' && ctx.state.listing.listId === list.id) ctx.state.listing = { kind: 'list', listId: ctx.state.cwd, all: false }
      ctx.print(`deleted ${list.name}${n ? `; ${plural(n, 'task')} moved to ~` : ''}`)
    }
  },
  {
    name: 'sync',
    aliases: ['push', 'pull'],
    usage: 'sync',
    summary: 'push your changes to GitHub and pull everyone else’s',
    async run(_args, ctx) {
      const result = await ctx.host.sync()
      if (!result) return ctx.print('sync: already running; it will run again when it finishes', 'dim')
      ctx.out.push(...syncLines(result))
    }
  },
  {
    name: 'status',
    aliases: ['st'],
    usage: 'status',
    summary: 'open tasks, conflicts and sync state',
    run(_args, ctx) {
      const open = ctx.data.tasks.filter((t) => !t.completed && !t.archived)
      const overdue = open.filter((t) => t.dueDate && t.dueDate.slice(0, 10) < localDateString(ctx.now)).length
      ctx.out.push([
        { text: `${plural(open.length, 'open task')}` },
        { text: `, ${open.filter((t) => t.priority === 1).length} p1`, tone: 'dim' },
        { text: overdue ? `, ${overdue} overdue` : '', tone: 'error' }
      ])
      if (ctx.data.conflicts.length) ctx.print(`${plural(ctx.data.conflicts.length, 'conflict')} (ls marks them !conflict; resolve <n>)`, 'error')
      if (ctx.host.status) ctx.out.push(...ctx.host.status())
    }
  },
  {
    name: 'undo',
    usage: 'undo',
    summary: 'undo the last change made on this device',
    available: (host) => !!host.undo,
    async run(_args, ctx) {
      ctx.out.push(...(await ctx.host.undo!()))
    }
  },
  {
    name: 'log',
    aliases: ['history'],
    usage: 'log',
    summary: 'recent changes made on this device',
    available: (host) => !!host.log,
    run: (_args, ctx) => void ctx.out.push(...ctx.host.log!())
  },
  {
    name: 'style',
    usage: 'style [name]',
    summary: 'show or switch the style (standard, terminal)',
    run(args, ctx) {
      const appearance = ctx.data.settings.appearance
      return selectSetting(ctx, 'style', STYLES, resolveStyle(appearance.styleId).id, words(args).join(' '), (s) =>
        ctx.host.saveSettings({ ...ctx.data.settings, appearance: { ...appearance, styleId: s.id } })
      )
    }
  },
  {
    name: 'theme',
    aliases: ['colors'],
    usage: 'theme [name]',
    summary: 'show or switch the color theme',
    run(args, ctx) {
      const appearance = ctx.data.settings.appearance
      return selectSetting(ctx, 'theme', allThemes(appearance), resolveTheme(appearance).id, words(args).join(' '), (t) =>
        ctx.host.saveSettings({ ...ctx.data.settings, appearance: { ...appearance, themeId: t.id } })
      )
    }
  },
  {
    name: 'font',
    usage: 'font [name]',
    summary: 'show or switch the font',
    run(args, ctx) {
      const appearance = ctx.data.settings.appearance
      return selectSetting(ctx, 'font', FONTS, resolveFont(appearance.fontId).id, words(args).join(' '), (f) =>
        ctx.host.saveSettings({ ...ctx.data.settings, appearance: { ...appearance, fontId: f.id } })
      )
    }
  },
  {
    name: 'settings',
    aliases: ['config', 'prefs'],
    usage: 'settings',
    summary: 'open the settings',
    available: (host) => !!host.openSettings,
    run: (_args, ctx) => ctx.host.openSettings!()
  },
  {
    name: 'clear',
    aliases: ['cls'],
    usage: 'clear',
    summary: 'clear the screen',
    available: (host) => !!host.clear,
    run: (_args, ctx) => ctx.host.clear!()
  },
  {
    name: 'exit',
    aliases: ['quit', 'logout'],
    usage: 'exit',
    summary: 'leave the shell (in the app: back to the standard style)',
    available: (host) => !!host.exit,
    run: (_args, ctx) => ctx.host.exit!()
  }
]

const COMMANDS_BY_NAME = Object.fromEntries(COMMANDS.map((c) => [c.name, c])) as Record<string, Command>

/** Command names the host supports, for help and completion. */
export function commandNames(host: ShellHost): string[] {
  return COMMANDS.filter((c) => !c.available || c.available(host)).map((c) => c.name)
}

/** One line per command: `usage  summary`, for front ends that print their own help. */
export function commandHelp(host: ShellHost): { usage: string; summary: string }[] {
  return COMMANDS.filter((c) => !c.available || c.available(host)).map(({ usage, summary }) => ({ usage, summary }))
}

export interface CommandResult {
  lines: Line[]
  state: ShellState
  /** The command chose what to list (`ls`, `cd`, `find`), so a front end that prints listings should print it now. */
  listed: boolean
}

export async function runCommand(input: string, state: ShellState, host: ShellHost, now: Date = new Date()): Promise<CommandResult> {
  const tokens = tokenize(input)
  const ctx: Ctx = {
    host,
    state: { ...state },
    data: host.data(),
    now,
    out: [],
    listed: false,
    print(value, tone) {
      ctx.out.push(text(value, tone))
    },
    failed(command, errors) {
      for (const e of errors) ctx.print(`${command}: ${e}`, 'error')
      return errors.length > 0
    }
  }
  if (!tokens.length) return { lines: [], state, listed: false }

  const name = tokens[0].text.toLowerCase()
  const command = COMMANDS.find((c) => (c.name === name || c.aliases?.includes(name)) && (!c.available || c.available(host)))
  if (!command) {
    ctx.print(`todo: command not found: ${tokens[0].text}`, 'error')
    ctx.print(`to add a task: add ${input.trim()}   (help lists the commands)`, 'dim')
    return { lines: ctx.out, state, listed: false }
  }
  const args = tokens.slice(1)
  if (args.some((a) => !a.quoted && (a.text === '--help' || a.text === '-h'))) {
    ctx.print(`usage: ${command.usage}`)
    ctx.print(`  ${command.summary}`, 'dim')
    return { lines: ctx.out, state, listed: false }
  }
  try {
    await command.run(args, ctx)
  } catch (err) {
    ctx.print(`${command.name}: ${err instanceof Error ? err.message : String(err)}`, 'error')
  }
  return { lines: ctx.out, state: ctx.state, listed: ctx.listed }
}

/** What a sync did, as shell output. */
export function syncLines(result: SyncResult): Line[] {
  if (result.error) return [text(`sync: ${result.error}`, 'error')]
  const lines: Line[] = [text(`sync: ${result.pushed} pushed, ${result.pulled} pulled`, 'ok')]
  const n = result.conflicts.length
  if (n) lines.push(text(`sync: ${plural(n, 'task')} changed here and elsewhere; ls marks ${n === 1 ? 'it' : 'them'} !conflict, resolve <n> picks a version`, 'error'))
  for (const r of result.extensions) {
    const name = catalogEntry(r.extensionId)?.name ?? r.extensionId
    if (r.error) lines.push(text(`${name}: ${r.error}`, 'error'))
    else if (r.changedTasks && r.summary) lines.push(text(`${name}: ${r.summary}`, 'dim'))
  }
  return lines
}

// ---- Completion ----

/** Completes the word being typed: a command, a list, or a theme, font or style name. */
export function complete(input: string, host: ShellHost): { line: string; options: string[] } {
  const tokens = tokenize(input)
  const typingNew = input === '' || /\s$/.test(input)
  const word = typingNew ? '' : (tokens[tokens.length - 1]?.text ?? '')
  const index = typingNew ? tokens.length : tokens.length - 1
  const command = tokens[0]?.text.toLowerCase() ?? ''
  const data = host.data()
  const listPaths = () => data.lists.map((l) => (l.id === MAIN_LIST_ID ? '~' : listPath(l.id, data).slice(2)))

  let candidates: string[] = []
  if (index === 0) candidates = commandNames(host)
  else if (['cd', 'ls', 'rmdir'].includes(command) || tokens[index - 1]?.text === '-l' || (command === 'mv' && index > 1)) candidates = listPaths()
  else if (command === 'theme') candidates = allThemes(data.settings.appearance).map((t) => t.name)
  else if (command === 'font') candidates = FONTS.map((f) => f.name)
  else if (command === 'style') candidates = STYLES.map((s) => s.id)
  else if (command === 'help') candidates = commandNames(host)
  else if (command === 'resolve' && index === 2) candidates = ['local', 'remote']

  // A list in a folder also matches by its own name (`gro` finds Home/Groceries).
  const w = word.replace(/^~\//, '').toLowerCase()
  const options = candidates.filter((c) => c.toLowerCase().startsWith(w) || (c.includes('/') && c.split('/').pop()!.toLowerCase().startsWith(w)))
  if (!options.length) return { line: input, options: [] }
  const head = typingNew ? input : input.slice(0, input.length - rawLastWordLength(input))
  if (options.length === 1) return { line: `${head}${quoteArg(options[0])} `, options }
  // Extend to what every option shares.
  let shared = options[0]
  for (const o of options) while (!o.toLowerCase().startsWith(shared.toLowerCase())) shared = shared.slice(0, -1)
  return { line: shared.length > w.length && !/[\s"']/.test(shared) ? `${head}${shared}` : input, options }
}

/** How many characters the last word takes up as typed, quotes included. */
function rawLastWordLength(input: string): number {
  let i = input.length
  let quote: string | null = null
  while (i > 0) {
    const c = input[i - 1]
    if (quote) {
      if (c === quote) quote = null
    } else if (c === '"' || c === "'") quote = c
    else if (/\s/.test(c)) break
    i--
  }
  return input.length - i
}
