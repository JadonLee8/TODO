import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { CacheStore } from '@shared/cacheStore'
import { createMemoryCacheStore } from '@shared/memoryCacheStore'
import { initialShellState, type ShellState } from '@shared/shell'

/**
 * Everything the CLI keeps on disk, in its own folder (it is its own "device", like the phone):
 *  - config.json  the repo to sync with, and whether to sync on every command
 *  - token        the GitHub token (or set TODO_GITHUB_TOKEN instead and nothing is stored)
 *  - cache.json   the local-first cache: the same records as the Android app's IndexedDB
 *  - state.json   the ids the last listing numbered, so `todo done 2` means what `todo ls` showed
 */

export interface CliConfig {
  owner: string
  repo: string
  branch: string
  /** Pull before and push after every command. Off: only `todo sync` talks to GitHub. */
  autoSync: boolean
}

const DEFAULT_CONFIG: CliConfig = { owner: '', repo: '', branch: 'main', autoSync: true }

/** TODO_CLI_HOME, else %APPDATA%\TODO\cli on Windows (next to the desktop app's data), else ~/.config/todo/cli. */
export function cliHome(): string {
  if (process.env.TODO_CLI_HOME) return process.env.TODO_CLI_HOME
  if (process.platform === 'win32' && process.env.APPDATA) return join(process.env.APPDATA, 'TODO', 'cli')
  return join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'todo', 'cli')
}

const path = (name: string) => join(cliHome(), name)

function readJson<T>(file: string, fallback: T): T {
  try {
    return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as T) : fallback
  } catch {
    return fallback
  }
}

/** Writes through a temporary file, so a crash mid-write never leaves half a file. */
function writeFileAtomic(file: string, content: string, mode?: number): void {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  writeFileSync(tmp, content, { encoding: 'utf8', mode })
  renameSync(tmp, file)
}

export function loadConfig(): CliConfig {
  return { ...DEFAULT_CONFIG, ...readJson<Partial<CliConfig>>(path('config.json'), {}) }
}

export function saveConfig(config: CliConfig): void {
  writeFileAtomic(path('config.json'), JSON.stringify(config, null, 2) + '\n')
}

/** The desktop app's repo settings, to suggest at `todo login`. Read only; the app's token is encrypted and stays put. */
export function desktopRepoSettings(): Partial<CliConfig> {
  const userData = process.env.TODO_USER_DATA_DIR || (process.env.APPDATA ? join(process.env.APPDATA, 'TODO') : null)
  if (!userData) return {}
  const local = readJson<{ githubOwner?: string; githubRepo?: string; githubBranch?: string }>(join(userData, 'local-settings.json'), {})
  return { owner: local.githubOwner || '', repo: local.githubRepo || '', branch: local.githubBranch || '' }
}

export function loadToken(): string | null {
  if (process.env.TODO_GITHUB_TOKEN) return process.env.TODO_GITHUB_TOKEN.trim()
  try {
    return readFileSync(path('token'), 'utf8').trim() || null
  } catch {
    return null
  }
}

/** Stored readable only by this user where the OS supports it (on Windows the folder is already per user). */
export function saveToken(token: string): void {
  writeFileAtomic(path('token'), token + '\n', 0o600)
}

export function clearToken(): void {
  rmSync(path('token'), { force: true })
}

export function loadState(): Pick<ShellState, 'shown'> {
  const stored = readJson<Partial<ShellState>>(path('state.json'), {})
  return { shown: Array.isArray(stored.shown) ? stored.shown.filter((x): x is string => typeof x === 'string') : initialShellState().shown }
}

export function saveState(state: Pick<ShellState, 'shown'>): void {
  writeFileAtomic(path('state.json'), JSON.stringify({ shown: state.shown }) + '\n')
}

export interface FileCache {
  cache: CacheStore
  /** Writes the cache to disk if anything changed since it was loaded or last saved. */
  save(): void
  /** Re-reads the file if another `todo` process changed it (the interactive shell calls this before each command). */
  reloadIfChanged(): void
}

/** The local cache: the shared in-memory store, loaded from and saved to cache.json. */
export function openFileCache(): FileCache {
  const file = path('cache.json')
  let records = new Map<string, unknown>()
  let dirty = false
  let loadedAt = 0

  const open = (): CacheStore => {
    const stored = readJson<{ records?: Record<string, unknown> }>(file, {})
    records = new Map(Object.entries(stored.records ?? {}))
    loadedAt = existsSync(file) ? statSync(file).mtimeMs : 0
    dirty = false
    return createMemoryCacheStore({
      initial: records,
      onChange: (key, value) => {
        if (value === undefined) records.delete(key)
        else records.set(key, value)
        dirty = true
      }
    })
  }

  const handle: FileCache = {
    cache: open(),
    save() {
      if (!dirty) return
      writeFileAtomic(file, JSON.stringify({ version: 1, records: Object.fromEntries(records) }))
      loadedAt = statSync(file).mtimeMs
      dirty = false
    },
    reloadIfChanged() {
      const mtime = existsSync(file) ? statSync(file).mtimeMs : 0
      if (mtime === loadedAt || dirty) return
      handle.cache = open()
    }
  }
  return handle
}
