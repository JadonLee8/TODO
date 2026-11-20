import type { Task } from '@shared/types'
import { MAIN_LIST_ID } from '@shared/types'
import { buildListing, formatRow, parseTaskOptions, tokenize, findList, type ListingRow } from '@shared/shell'
import { fillListSelect, listGroups } from './config'
import { applyCachedLook, applyLook } from './look'
import { onChanged, send, type Snapshot } from './messages'

/**
 * The side panel: one list's tasks next to whatever page you're on, in the same order as the app, with a box to add
 * more. Tasks are ticked off here; editing the rest of a task stays in the app for now. In the terminal style the
 * rows are drawn as the app's shell listing.
 */

applyCachedLook()

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const listSelect = $<HTMLSelectElement>('list')
const addInput = $<HTMLInputElement>('add')
const tasksEl = $<HTMLUListElement>('tasks')
const emptyEl = $<HTMLParagraphElement>('empty')
const toggleDone = $<HTMLButtonElement>('toggle-done')
const statusEl = $<HTMLElement>('status')

const LIST_KEY = 'todo.panel.list'
/** Opening the panel pulls new changes, at most this often. */
const PULL_GAP_MS = 60_000

let state: Snapshot | null = null
let showDone = false
let listId = localStorage.getItem(LIST_KEY) ?? MAIN_LIST_ID

function setStatus(text: string, kind: 'ok' | 'error' | '' = '') {
  statusEl.textContent = text
  statusEl.className = `status panel-status ${kind}`
}

function syncStatus(s: Snapshot) {
  if (s.sync.syncing) return setStatus('Syncing…')
  const result = s.sync.lastResult
  if (result?.error) return setStatus(`Sync failed: ${result.error}`, 'error')
  if (s.conflicts.length) return setStatus(`${s.conflicts.length} task${s.conflicts.length === 1 ? '' : 's'} changed here and elsewhere. Open the app to choose.`, 'error')
  if (s.sync.lastAt) return setStatus(`Synced ${new Date(s.sync.lastAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`)
  setStatus('')
}

async function toggle(task: Task) {
  const completed = !task.completed
  await send({ type: 'updateTask', task: { ...task, completed, completedAt: completed ? new Date().toISOString() : null } })
}

function standardRow(row: ListingRow): HTMLLIElement {
  const t = row.task
  const li = document.createElement('li')
  li.className = `task p${t.priority}${t.completed ? ' done' : ''}${row.conflict ? ' conflict' : ''}`

  const box = document.createElement('input')
  box.type = 'checkbox'
  box.checked = t.completed
  box.disabled = row.conflict
  box.setAttribute('aria-label', `${t.completed ? 'Not done' : 'Done'}: ${t.title}`)
  box.onchange = () => void toggle(t)

  const title = document.createElement('span')
  title.className = 'task-title'
  title.textContent = t.title || '(untitled)'

  li.append(box, title)
  if (row.due) {
    const due = document.createElement('span')
    due.className = `task-due${row.overdue ? ' overdue' : ''}`
    due.textContent = row.due
    li.append(due)
  }
  const star = document.createElement('button')
  star.type = 'button'
  star.className = `star-toggle${t.starred ? ' starred' : ''}`
  star.textContent = t.starred ? '★' : '☆'
  star.setAttribute('aria-label', 'Important')
  star.setAttribute('aria-pressed', String(t.starred))
  star.disabled = row.conflict
  star.onclick = () => void send({ type: 'updateTask', task: { ...t, starred: !t.starred } })
  li.append(star)
  return li
}

/** The terminal style's row: the shell listing's text, with the box clickable. */
function terminalRow(row: ListingRow, width: number): HTMLLIElement {
  const li = document.createElement('li')
  li.className = 'term-row'
  for (const seg of formatRow(row, width)) {
    const el = document.createElement(seg.part === 'check' && !row.conflict ? 'button' : 'span')
    el.textContent = seg.text
    if (seg.tone) el.classList.add(`tone-${seg.tone}`)
    if (el instanceof HTMLButtonElement) {
      el.type = 'button'
      el.className += ' term-check'
      el.setAttribute('aria-label', `${row.task.completed ? 'Not done' : 'Done'}: ${row.task.title}`)
      el.onclick = () => void toggle(row.task)
    }
    li.append(el)
  }
  return li
}

function render() {
  if (!state) return
  applyLook(state.settings)
  $('setup').hidden = state.configured
  $('main').hidden = !state.configured
  syncStatus(state)
  if (!state.configured) return

  if (!state.lists.some((l) => l.id === listId)) listId = MAIN_LIST_ID
  fillListSelect(listSelect, listGroups(state.lists, state.folders), listId)

  const view = buildListing({ kind: 'list', listId, all: showDone }, state)
  const terminal = state.settings.appearance.styleId === 'terminal'
  const width = String(view.rows.length).length
  tasksEl.className = terminal ? 'tasks term' : 'tasks'
  tasksEl.replaceChildren(...view.rows.map((row) => (terminal ? terminalRow(row, width) : standardRow(row))))
  emptyEl.hidden = view.rows.length > 0
  const done = state.tasks.filter((t) => t.listId === listId && t.completed && !t.archived).length
  toggleDone.hidden = done === 0
  toggleDone.textContent = showDone ? 'Hide done tasks' : `Show ${done} done`
}

async function refresh() {
  state = await send({ type: 'snapshot' })
  render()
}

async function init() {
  const openOptions = () => void chrome.runtime.openOptionsPage()
  $('options-link').onclick = openOptions
  $('open-options').onclick = openOptions
  $('sync').onclick = () => void send({ type: 'sync' })
  listSelect.onchange = () => {
    listId = listSelect.value
    localStorage.setItem(LIST_KEY, listId)
    render()
  }
  toggleDone.onclick = () => {
    showDone = !showDone
    render()
  }

  // The same words as the app's terminal and the CLI: "Buy milk p2 * due:fri -l Groceries".
  $<HTMLFormElement>('add-form').onsubmit = async (e) => {
    e.preventDefault()
    if (!state) return
    const opts = parseTaskOptions(tokenize(addInput.value))
    const title = opts.words.join(' ').trim()
    if (opts.errors.length) return setStatus(opts.errors[0], 'error')
    if (!title) return
    let target = listId
    if (opts.list !== undefined) {
      const found = findList(opts.list, state)
      if ('error' in found) return setStatus(found.error, 'error')
      target = found.list.id
    }
    addInput.value = ''
    await send({ type: 'addTask', input: { title, listId: target, priority: opts.priority, starred: opts.starred, dueDate: opts.due ?? null } })
  }

  onChanged(() => void refresh())
  await refresh()
  if (state?.configured && (!state.sync.lastAt || Date.now() - Date.parse(state.sync.lastAt) > PULL_GAP_MS)) void send({ type: 'sync' })
}

init().catch((err: unknown) => setStatus(err instanceof Error ? err.message : String(err), 'error'))
