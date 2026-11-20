import { createInterface, type Interface } from 'node:readline'
import { homedir } from 'node:os'
import { syncNow } from '@shared/sync'
import { verifyRepoAccess, verifyToken } from '@shared/github'
import type { SyncResult } from '@shared/types'
import {
  buildListing,
  commandHelp,
  complete,
  formatListing,
  initialShellState,
  listPath,
  quoteArg,
  runCommand,
  syncLines,
  tokenize,
  type Line,
  type ShellHost,
  type ShellState,
  type Tone
} from '@shared/shell'
import { cacheHost, pendingChanges } from './host'
import { clearToken, cliHome, desktopRepoSettings, loadConfig, loadState, loadToken, openFileCache, saveConfig, saveState, saveToken } from './store'

/**
 * `todo`: the app's tasks from a terminal. `todo <command>` runs one command (`todo ls`, `todo add Buy milk p2`);
 * `todo` alone opens an interactive shell with a prompt, like the app's terminal style. The commands are the app's
 * (shared/shell.ts); this file adds login, syncing around each command, and printing.
 */

/** package.json's version, set by cli/vite.config.ts. */
declare const __TODO_VERSION__: string

// ---- Output ----

const color = !process.env.NO_COLOR && (!!process.env.FORCE_COLOR || !!process.stdout.isTTY)
const ANSI: Record<Tone, [string, string]> = {
  dim: ['\x1b[2m', '\x1b[22m'],
  error: ['\x1b[31m', '\x1b[39m'],
  ok: ['\x1b[32m', '\x1b[39m'],
  // Reverse video stands in for the app's highlighter.
  mark: ['\x1b[7m', '\x1b[27m'],
  bold: ['\x1b[1m', '\x1b[22m']
}

function render(line: Line): string {
  return line.map((s) => (color && s.tone && s.text ? ANSI[s.tone][0] + s.text + ANSI[s.tone][1] : s.text)).join('')
}

/** Error lines go to stderr and make the exit code 1, so scripts can tell. */
function print(lines: Line[]): void {
  for (const line of lines) {
    if (line[0]?.tone === 'error') {
      process.exitCode = 1
      process.stderr.write(render(line) + '\n')
    } else {
      process.stdout.write(render(line) + '\n')
    }
  }
}

const note = (text: string, tone: Tone = 'dim') => print([[{ text, tone }]])

// ---- Prompts ----

let rl: Interface | null = null

function ask(question: string): Promise<string> {
  if (rl) return new Promise((resolve) => rl!.question(question, resolve))
  const once = createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((resolve) =>
    once.question(question, (answer) => {
      once.close()
      resolve(answer)
    })
  )
}

/** Asks without echoing what's typed (for the token). */
function askHidden(question: string): Promise<string> {
  const hidden = createInterface({ input: process.stdin, output: process.stdout, terminal: true })
  const internal = hidden as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WritableStream }
  let asked = false
  internal._writeToOutput = (s: string) => {
    if (!asked) {
      internal.output.write(s)
      asked = true
    }
  }
  return new Promise((resolve) =>
    hidden.question(question, (answer) => {
      hidden.close()
      process.stdout.write('\n')
      resolve(answer.trim())
    })
  )
}

async function confirm(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) {
    note(`${question} (not asked: no terminal to answer in; add -f to go ahead)`, 'error')
    return false
  }
  return /^\s*y(es)?\s*$/i.test(await ask(`${question} [y/N] `))
}

// ---- Sync ----

const files = openFileCache()
async function sync(): Promise<SyncResult> {
  const config = loadConfig()
  const token = loadToken()
  const error = !token || !config.owner || !config.repo ? 'not set up; run todo login' : null
  if (error || !token) return { pushed: 0, pulled: 0, conflicts: [], error, extensions: [] }
  try {
    return await syncNow(files.cache, token, config.owner, config.repo, config.branch || 'main')
  } finally {
    files.save()
  }
}

/** The automatic syncs around a command: quiet unless something needs saying. */
async function autoSync(when: 'before' | 'after'): Promise<void> {
  if (!syncEnabled()) return
  const result = await sync()
  if (result.error) {
    note(`sync: ${result.error}${when === 'after' ? '; your change is saved here and goes up on the next sync' : '; showing what this computer has'}`, 'dim')
  } else if (result.conflicts.length) {
    print(syncLines(result).slice(1))
  }
}

let offline = false
const syncEnabled = () => !offline && loadConfig().autoSync && !!loadToken() && !!loadConfig().owner

function status(): Line[] {
  const config = loadConfig()
  const pending = pendingChanges(files.cache)
  const synced = files.cache.getSyncMeta().lastSyncedAt
  return [
    [
      { text: 'repo  ', tone: 'dim' },
      config.owner && config.repo ? { text: `${config.owner}/${config.repo} (${config.branch || 'main'})` } : { text: 'not set up; todo login connects one', tone: 'error' }
    ],
    [
      { text: 'sync  ', tone: 'dim' },
      {
        text: `${synced ? `last ${new Date(synced).toLocaleString()}` : 'never'}${pending ? `, ${pending} change${pending === 1 ? '' : 's'} waiting to go up` : ''}; ${
          config.autoSync ? 'runs with every command' : 'only with todo sync'
        }${offline ? ' (offline now)' : ''}`
      }
    ],
    [{ text: 'data  ', tone: 'dim' }, { text: cliHome() }]
  ]
}

// ---- CLI-only commands ----

async function login(): Promise<void> {
  if (!process.stdin.isTTY) return note('login: needs a terminal to type in', 'error')
  const current = loadConfig()
  const desktop = desktopRepoSettings()
  const suggest = (value: string | undefined, fallback: string | undefined) => value || fallback || ''
  const ownerDefault = suggest(current.owner, desktop.owner)
  const repoDefault = suggest(current.repo, desktop.repo)
  const branchDefault = suggest(current.branch, desktop.branch) || 'main'

  note('The repo your tasks are in, and a fine-grained token for just that repo (Contents: read and write).')
  if (!current.owner && desktop.owner) note('Suggestions come from the desktop app. Press Enter to keep one.')
  const owner = (await ask(`repo owner${ownerDefault ? ` [${ownerDefault}]` : ''}: `)).trim() || ownerDefault
  const repo = (await ask(`repo name${repoDefault ? ` [${repoDefault}]` : ''}: `)).trim() || repoDefault
  const branch = (await ask(`branch [${branchDefault}]: `)).trim() || branchDefault
  if (!owner || !repo) return note('login: a repo owner and name are needed', 'error')

  const existing = loadToken()
  const typed = await askHidden(existing ? 'token [keep the saved one]: ' : 'token (github_pat_...): ')
  const token = typed || existing
  if (!token) return note('login: a token is needed', 'error')

  try {
    const { login: user } = await verifyToken(token)
    await verifyRepoAccess(token, owner, repo)
    saveConfig({ ...current, owner, repo, branch })
    if (typed && !process.env.TODO_GITHUB_TOKEN) saveToken(token)
    note(`logged in as ${user}; syncing with ${owner}/${repo}`, 'ok')
    if (process.env.TODO_GITHUB_TOKEN) note('TODO_GITHUB_TOKEN is set, so the token wasn’t stored; the CLI uses the variable.')
  } catch (err) {
    return note(`login: ${err instanceof Error ? err.message : String(err)}`, 'error')
  }
  print(syncLines(await sync()))
}

function logout(): void {
  clearToken()
  note('logged out: the token is deleted. Your tasks stay in the cache until the next login.')
}

/** `todo config [autosync on|off]`. */
function configure(args: string[]): void {
  const config = loadConfig()
  if (args[0]?.toLowerCase() === 'autosync' && /^(on|off)$/i.test(args[1] ?? '')) {
    saveConfig({ ...config, autoSync: args[1].toLowerCase() === 'on' })
    return note(`autosync ${args[1].toLowerCase()}`, 'ok')
  }
  if (args.length) return note('usage: todo config [autosync on|off]', 'error')
  print([
    [{ text: 'owner     ', tone: 'dim' }, { text: config.owner || '(not set)' }],
    [{ text: 'repo      ', tone: 'dim' }, { text: config.repo || '(not set)' }],
    [{ text: 'branch    ', tone: 'dim' }, { text: config.branch }],
    [{ text: 'autosync  ', tone: 'dim' }, { text: config.autoSync ? 'on' : 'off' }],
    [{ text: 'token     ', tone: 'dim' }, { text: process.env.TODO_GITHUB_TOKEN ? 'from TODO_GITHUB_TOKEN' : loadToken() ? 'saved' : '(not set)' }],
    [{ text: 'data      ', tone: 'dim' }, { text: cliHome() }]
  ])
}

function help(host: ShellHost): void {
  print([[{ text: 'todo', tone: 'bold' }, { text: ' — your tasks from the command line. The same commands as the app’s terminal style.' }], []])
  print([[{ text: 'usage: ', tone: 'dim' }, { text: 'todo <command> [args]   or   todo   (an interactive shell)' }], []])
  const rows = [
    ...commandHelp(host),
    { usage: 'login', summary: 'connect to your tasks repo' },
    { usage: 'logout', summary: 'delete the saved token' },
    { usage: 'config [autosync on|off]', summary: 'show settings, or sync only with todo sync' }
  ]
  const width = Math.max(...rows.map((r) => r.usage.length))
  print(rows.map((r) => [{ text: '  ' + r.usage.padEnd(width + 2) }, { text: r.summary, tone: 'dim' }]))
  print([
    [],
    [{ text: 'n: a number from the last listing, a range (1-3), a list (1,4) or the start of an id', tone: 'dim' }],
    [{ text: 'dates: today, tomorrow, fri, +3d, +2w, 12-24, 2026-12-24, none', tone: 'dim' }],
    [{ text: 'flags: --offline (no syncing this time), --no-color, --version', tone: 'dim' }],
    [{ text: 'in bash, quote a * or use -s to star: todo add "Call mom" -s p1', tone: 'dim' }]
  ])
}

// ---- Running commands ----

/** Turns argv back into a command line for the shared parser. Words with spaces were quoted in the user's shell. */
function argvToLine(args: string[]): string {
  const home = homedir()
  return args
    .map((a) => (a === home ? '~' : a.startsWith(home + '/') || a.startsWith(home + '\\') ? '~/' + a.slice(home.length + 1) : a))
    .map((a) => quoteArg(a))
    .join(' ')
}

function printListing(state: ShellState, host: ShellHost): ShellState {
  const view = buildListing(state.listing, host.data())
  print(formatListing(view))
  return { ...state, shown: view.rows.map((r) => r.task.id) }
}

/** One command, then exit. */
async function runOnce(line: string, host: ShellHost): Promise<void> {
  const name = tokenize(line)[0]?.text.toLowerCase()
  const quiet = ['help', 'sync', 'push', 'pull', 'pwd'].includes(name ?? '')
  if (!quiet) await autoSync('before')

  let state: ShellState = { ...initialShellState(), ...loadState() }
  const result = await runCommand(line, state, host)
  print(result.lines)
  state = result.state
  if (result.listed) {
    state = printListing(state, host)
    saveState(state)
  }
  files.save()
  if (pendingChanges(files.cache)) await autoSync('after')
}

/** `todo` with no command: a prompt, like the app's terminal style. */
async function repl(): Promise<void> {
  let state: ShellState = initialShellState()
  let closed = false
  await autoSync('before')

  const host = makeHost({
    clear: () => console.clear(),
    exit: async () => {
      closed = true
      rl?.close()
    }
  })
  rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    historySize: 200,
    completer: (line: string) => {
      const result = complete(line, host)
      if (result.line !== line) return [[result.line], line]
      return [result.options.map(quoteArg), line.split(/\s+/).pop() ?? '']
    }
  })
  rl.on('close', () => (closed = true))
  rl.on('SIGINT', () => {
    // ^C clears the line, like a shell; ^D (or exit) leaves.
    process.stdout.write('^C\n')
    rl!.write(null, { ctrl: true, name: 'u' })
    rl!.prompt()
  })

  note('todo shell. help lists the commands; exit or ^D leaves.')
  state = printListing(state, host)

  const prompt = () => {
    const path = listPath(state.cwd, host.data())
    rl!.setPrompt(color ? `\x1b[32mtodo\x1b[39m:\x1b[1m${path}\x1b[22m$ ` : `todo:${path}$ `)
    rl!.prompt()
  }

  prompt()
  for await (const line of rl) {
    files.reloadIfChanged()
    const result = await runCommand(line, { ...state }, host)
    print(result.lines)
    state = result.state
    if (result.listed) state = printListing(state, host)
    files.save()
    if (pendingChanges(files.cache)) await autoSync('after')
    if (closed) break
    prompt()
  }
}

function makeHost(extra: { clear?: () => void; exit?: () => Promise<void> } = {}): ShellHost {
  return cacheHost(() => files.cache, {
    sync,
    confirm,
    status,
    ...extra
  })
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const flags = new Set(args.filter((a) => /^--(offline|no-color|version)$/.test(a) || a === '-v'))
  const rest = args.filter((a) => !flags.has(a))
  offline = flags.has('--offline')
  if (flags.has('--version') || flags.has('-v')) return note(`todo ${__TODO_VERSION__}`, 'bold')

  const command = rest[0]?.toLowerCase()
  if (command === 'login') return login()
  if (command === 'logout') return logout()
  if (command === 'config') return configure(rest.slice(1))
  if (command === 'help' || command === '--help' || command === '-h') {
    if (rest.length > 1) return runOnce(argvToLine(rest), makeHost())
    return help(makeHost())
  }
  if (!rest.length) {
    if (!process.stdin.isTTY) return help(makeHost())
    if (!loadToken() && !loadConfig().owner) note('not set up yet: run todo login to connect your tasks repo. Until then this shell works offline.')
    return repl()
  }
  return runOnce(argvToLine(rest), makeHost())
}

main().catch((err: unknown) => {
  files.save()
  process.stderr.write(`todo: ${err instanceof Error ? err.message : String(err)}\n`)
  process.exitCode = 1
})
