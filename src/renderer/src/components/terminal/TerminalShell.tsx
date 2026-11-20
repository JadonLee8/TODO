import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { MAIN_LIST_ID } from '@shared/types'
import { DEFAULT_STYLE_ID } from '@shared/styles'
import {
  buildListing,
  complete,
  formatRow,
  initialShellState,
  listPath,
  listingCommand,
  runCommand,
  type Line,
  type Part,
  type Segment,
  type ShellHost,
  type ShellState
} from '@shared/shell'
import { useAppState } from '../../state/AppStateContext'

/**
 * The terminal style: the app as a shell. The top pane is a live `ls` of the current listing (it redraws as tasks
 * change, like `watch`), the bottom pane is the scrollback of commands and their output, and the prompt is last.
 * Every command comes from shared/shell.ts, the same as the `todo` CLI. Overlays (a task's panel, Settings,
 * conflicts) are the standard ones, restyled by terminal.css.
 */

interface Entry {
  id: number
  /** The current list's path when the command ran, for its prompt. */
  path: string
  input: string
  lines: Line[]
}

/** Commands typed on this device, so ↑ works across launches. */
const HISTORY_KEY = 'todo.terminal.history'
const HISTORY_LIMIT = 100
const SCROLLBACK_LIMIT = 200

/** The phone's extra-keys row, like a terminal app's: words to start a command with, or whole commands to run. */
const PHONE_KEYS: { label: string; insert?: string; run?: string; aria?: string }[] = [
  { label: 'add', insert: 'add ' },
  { label: 'done', insert: 'done ' },
  { label: 'rm', insert: 'rm ' },
  { label: 'pri', insert: 'pri ' },
  { label: 'cd', insert: 'cd ' },
  { label: 'ls -a', run: 'ls -a' },
  { label: 'sync', run: 'sync' },
  { label: 'tab', aria: 'Complete' },
  { label: '↑', aria: 'Previous command' }
]

function loadHistory(): string[] {
  try {
    const stored = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]')
    return Array.isArray(stored) ? stored.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

function saveHistory(history: string[]): void {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(-HISTORY_LIMIT)))
  } catch {
    // Forgetting the history is harmless.
  }
}

export function TerminalShell({
  onOpenTask,
  onOpenConflict,
  onOpenSettings,
  addRequest
}: {
  onOpenTask: (taskId: string) => void
  onOpenConflict: (taskId: string) => void
  onOpenSettings: () => void
  /** Bumped when the widget's "+" was tapped: start an `add` at the prompt. */
  addRequest: number
}) {
  const app = useAppState()
  const { tasks, lists, folders, syncedSettings, conflicts, syncing, view, setView, toggleComplete } = app
  const appRef = useRef(app)
  appRef.current = app

  const [state, setState] = useState<ShellState>(() => {
    const cwd = view.kind === 'list' ? view.listId : MAIN_LIST_ID
    return { ...initialShellState(), cwd, listing: { kind: 'list', listId: cwd, all: false } }
  })
  const [entries, setEntries] = useState<Entry[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null)
  const answerRef = useRef<((yes: boolean) => void) | null>(null)
  const history = useRef<string[]>(loadHistory())
  const historyIndex = useRef<number | null>(null)
  const nextId = useRef(1)
  const inputRef = useRef<HTMLInputElement>(null)
  const scrollbackRef = useRef<HTMLDivElement>(null)

  const data = useMemo(() => ({ tasks, lists, folders, settings: syncedSettings, conflicts }), [tasks, lists, folders, syncedSettings, conflicts])
  const dataRef = useRef(data)
  dataRef.current = data

  // A list deleted elsewhere (or by undo) sends the shell back to ~.
  const cwd = lists.some((l) => l.id === state.cwd) ? state.cwd : MAIN_LIST_ID
  const listing = state.listing.kind === 'list' && !lists.some((l) => l.id === (state.listing as { listId: string }).listId)
    ? { kind: 'list' as const, listId: cwd, all: false }
    : state.listing
  const listingView = useMemo(() => buildListing(listing, data), [listing, data])
  const shown = useMemo(() => listingView.rows.map((r) => r.task.id), [listingView])
  const numberWidth = String(listingView.rows.length).length
  const path = listPath(cwd, data)

  const latestState = useRef<ShellState>(state)
  latestState.current = { ...state, cwd, listing, shown }

  // Keep the standard style on the same list, for when the user switches back.
  useEffect(() => {
    if (view.kind !== 'list' || view.listId !== cwd) setView({ kind: 'list', listId: cwd })
    // Only when the shell changes directory, not when the standard style's view changes.
  }, [cwd])

  const appendLines = (id: number, lines: Line[]) =>
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, lines: [...e.lines, ...lines] } : e)))
  const runningId = useRef<number | null>(null)

  const host = useMemo<ShellHost>(
    () => ({
      data: () => dataRef.current,
      addTask: (input) => appRef.current.addTask(input),
      updateTask: (task) => appRef.current.updateTask(task),
      deleteTask: (id) => appRef.current.deleteTask(id),
      addList: (name) => appRef.current.addList(name),
      deleteList: (id) => appRef.current.deleteList(id),
      saveSettings: (settings) => appRef.current.saveSyncedSettings(settings),
      sync: () => appRef.current.runSync(),
      resolveConflict: (taskId, keep) =>
        keep === 'local' ? appRef.current.resolveConflictKeepLocal(taskId) : appRef.current.resolveConflictKeepRemote(taskId),
      confirm: (question) =>
        new Promise<boolean>((resolve) => {
          answerRef.current = (yes) => {
            if (runningId.current !== null) appendLines(runningId.current, [[{ text: `${question} [y/N] ` }, { text: yes ? 'y' : 'n', tone: 'dim' }]])
            answerRef.current = null
            setPendingQuestion(null)
            resolve(yes)
          }
          setPendingQuestion(question)
        }),
      async undo() {
        const { activity, activityConflicts, undoActivity } = appRef.current
        const entry = activity[0]
        if (!entry || entry.undoneBy) return [[{ text: 'undo: nothing to undo here', tone: 'dim' }]]
        const changed = activityConflicts(entry)
        if (changed.length && !(await host.confirm(`undo: ${changed.join(', ')} changed since; undo anyway?`)))
          return [[{ text: 'undo: kept', tone: 'dim' }]]
        await undoActivity(entry.id)
        return [[{ text: 'undid: ', tone: 'ok' }, { text: entry.summary }]]
      },
      log() {
        const recent = appRef.current.activity.slice(0, 15).reverse()
        if (!recent.length) return [[{ text: 'log: no changes on this device yet', tone: 'dim' }]]
        const today = new Date().toDateString()
        return recent.map((e) => {
          const at = new Date(e.at)
          const when = at.toDateString() === today
            ? at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
            : at.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
          return [
            { text: `${when.padStart(6)}  `, tone: 'dim' },
            { text: e.summary, tone: e.undoneBy ? 'dim' : undefined },
            { text: e.undoneBy ? '  (undone)' : '', tone: 'dim' }
          ]
        })
      },
      status() {
        const { localSettings, lastSyncResult, syncing } = appRef.current
        const repo = localSettings.githubOwner && localSettings.githubRepo ? `${localSettings.githubOwner}/${localSettings.githubRepo}` : null
        const lines: Line[] = [
          [
            { text: 'repo  ', tone: 'dim' },
            repo ? { text: `${repo} (${localSettings.githubBranch || 'main'})` } : { text: 'not set up; settings connects one', tone: 'error' }
          ],
          [{ text: 'sync  ', tone: 'dim' }, { text: `${syncing ? 'running' : lastSyncResult?.error ? `failed: ${lastSyncResult.error}` : lastSyncResult ? 'ok' : 'not run yet'}; auto-sync ${localSettings.autoSync ? 'on' : 'off'}` }]
        ]
        return lines
      },
      open: (taskId) => (dataRef.current.conflicts.some((c) => c.taskId === taskId) ? onOpenConflict(taskId) : onOpenTask(taskId)),
      openSettings: onOpenSettings,
      clear: () => setEntries([]),
      exit: async () => {
        const settings = dataRef.current.settings
        await appRef.current.saveSyncedSettings({ ...settings, appearance: { ...settings.appearance, styleId: DEFAULT_STYLE_ID } })
      }
    }),
    [onOpenTask, onOpenConflict, onOpenSettings]
  )

  function addEntry(entry: Omit<Entry, 'id'>): number {
    const id = nextId.current++
    setEntries((prev) => [...prev, { ...entry, id }].slice(-SCROLLBACK_LIMIT))
    return id
  }

  async function submit(line: string) {
    // An answer to a question a command is waiting on.
    if (answerRef.current) {
      answerRef.current(/^\s*y(es)?\s*$/i.test(line))
      setInput('')
      return
    }
    if (busy) return
    setInput('')
    historyIndex.current = null
    if (!line.trim()) {
      addEntry({ path, input: '', lines: [] })
      return
    }
    if (history.current[history.current.length - 1] !== line) {
      history.current = [...history.current, line].slice(-HISTORY_LIMIT)
      saveHistory(history.current)
    }
    const id = addEntry({ path, input: line, lines: [] })
    runningId.current = id
    setBusy(true)
    try {
      const result = await runCommand(line, latestState.current, host)
      appendLines(id, result.lines)
      setState(result.state)
    } finally {
      runningId.current = null
      setBusy(false)
    }
  }

  function completeInput() {
    const result = complete(input, host)
    setInput(result.line)
    if (result.options.length > 1 && result.line === input) {
      addEntry({ path, input, lines: [[{ text: result.options.join('  '), tone: 'dim' }]] })
    }
  }

  function recall(direction: -1 | 1) {
    const all = history.current
    if (!all.length) return
    const current = historyIndex.current ?? all.length
    const next = Math.min(all.length, Math.max(0, current + direction))
    historyIndex.current = next === all.length ? null : next
    setInput(next === all.length ? '' : all[next])
  }

  function onKeyDown(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      void submit(input)
    } else if (e.key === 'Tab') {
      e.preventDefault()
      completeInput()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      recall(-1)
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      recall(1)
    } else if (e.key === 'Escape') {
      setInput('')
    } else if (e.ctrlKey && e.key === 'l') {
      e.preventDefault()
      setEntries([])
    } else if (e.ctrlKey && e.key === 'c' && e.currentTarget.selectionStart === e.currentTarget.selectionEnd && !window.getSelection()?.toString()) {
      // ^C abandons the line (or says no to a question), like a shell.
      e.preventDefault()
      if (answerRef.current) answerRef.current(false)
      else addEntry({ path, input: `${input}^C`, lines: [] })
      setInput('')
    }
  }

  function onPart(part: Part, taskId: string, segment: Segment) {
    if (part === 'check') {
      const task = dataRef.current.tasks.find((t) => t.id === taskId)
      if (task) void toggleComplete(task)
    } else if (part === 'title') {
      host.open!(taskId)
    } else {
      // A number goes into the command being typed: `done ` then tap 2 and 4.
      setInput((prev) => `${prev}${prev && !/\s$/.test(prev) ? ' ' : ''}${segment.text.trim()} `)
      inputRef.current?.focus()
    }
  }

  function onPhoneKey(key: (typeof PHONE_KEYS)[number]) {
    if (key.run) void submit(key.run)
    else if (key.insert) setInput(key.insert)
    else if (key.label === 'tab') completeInput()
    else recall(-1)
    inputRef.current?.focus()
  }

  // Follow the newest output.
  useEffect(() => {
    const el = scrollbackRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [entries])

  // The widget's "+": start typing a task.
  useEffect(() => {
    if (!addRequest) return
    setInput('add ')
    inputRef.current?.focus()
  }, [addRequest])

  // Clicking empty space puts the cursor back at the prompt, unless text is being selected to copy.
  function focusPrompt() {
    if (!window.getSelection()?.toString()) inputRef.current?.focus()
  }

  const phone = window.api.platform !== 'desktop'
  const command = listingCommand(listing, cwd, data)
  const promptLabel = pendingQuestion ? `${pendingQuestion} [y/N]` : null

  return (
    <div className="term" onClick={focusPrompt}>
      <div className="term-listing" aria-live="polite">
        <div className="term-line">
          <PromptText path={path} /> <span>{command}</span>
        </div>
        {listingView.rows.map((row) => (
          <div className="term-line term-row" key={row.task.id}>
            {formatRow(row, numberWidth).map((seg, i) => (
              <SegmentView key={i} seg={seg} onPart={onPart} />
            ))}
          </div>
        ))}
        {!listingView.rows.length && <div className="term-line tone-dim">{listingView.empty}</div>}
        {listingView.hiddenDone > 0 && <div className="term-line tone-dim">-- {listingView.hiddenDone} done (ls -a shows them)</div>}
      </div>

      <div className="term-scrollback" ref={scrollbackRef}>
        {entries.length === 0 && (
          <div className="term-line tone-dim">{phone ? 'tap a number to type it. ' : ''}help lists the commands; exit goes back to the standard style.</div>
        )}
        {entries.map((entry) => (
          <div key={entry.id}>
            <div className="term-line">
              <PromptText path={entry.path} /> <span>{entry.input}</span>
            </div>
            {entry.lines.map((line, i) => (
              <div className="term-line" key={i}>
                {line.map((seg, j) => (
                  <SegmentView key={j} seg={seg} />
                ))}
              </div>
            ))}
          </div>
        ))}
      </div>

      <form
        className="term-prompt"
        onSubmit={(e) => {
          e.preventDefault()
          void submit(input)
        }}
      >
        {promptLabel ? <span className="term-question">{promptLabel}&nbsp;</span> : <><PromptText path={path} />&nbsp;</>}
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => {
            setInput(e.target.value)
            historyIndex.current = null
          }}
          onKeyDown={onKeyDown}
          autoFocus={!phone}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="send"
          aria-label={promptLabel ?? `Command, in ${path}`}
        />
        <span className={`term-status${conflicts.length ? ' tone-error' : ''}`}>
          {busy && !pendingQuestion ? '…' : syncing ? 'syncing' : conflicts.length ? `${conflicts.length} conflict${conflicts.length === 1 ? '' : 's'}` : ''}
        </span>
      </form>

      {phone && (
        <div className="term-keys" onClick={(e) => e.stopPropagation()}>
          {PHONE_KEYS.map((key) => (
            <button
              key={key.label}
              type="button"
              aria-label={key.aria}
              // Keep the keyboard up: don't take focus from the prompt.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onPhoneKey(key)}
            >
              {key.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function PromptText({ path }: { path: string }) {
  return (
    <span className="term-ps1">
      <span className="tone-ok">todo</span>:<span className="term-path">{path}</span>$
    </span>
  )
}

function SegmentView({ seg, onPart }: { seg: Segment; onPart?: (part: Part, taskId: string, seg: Segment) => void }) {
  const tone = seg.tone ? `tone-${seg.tone}` : ''
  if (!onPart || !seg.part || !seg.taskId) return <span className={tone || undefined}>{seg.text}</span>
  const { part, taskId } = seg
  const label = part === 'check' ? (seg.text === '[x]' ? 'Mark not done' : 'Mark done') : part === 'title' ? `Open ${seg.text}` : `Type ${seg.text.trim()}`
  return (
    <span
      className={`${tone} term-click term-${part}`}
      role="button"
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation()
        onPart(part, taskId, seg)
      }}
    >
      {seg.text}
    </span>
  )
}
