import type { Priority } from '@shared/types'
import { MAIN_LIST_ID } from '@shared/types'
import { addTask, fetchListGroups, loadConfig, type Prefill } from './todo'

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

const titleInput = $<HTMLInputElement>('title')
const notesInput = $<HTMLTextAreaElement>('notes')
const listSelect = $<HTMLSelectElement>('list')
const starButton = $<HTMLButtonElement>('star')
const addButton = $<HTMLButtonElement>('add')
const status = $<HTMLDivElement>('status')

let priority: Priority = 3
let starred = false

function setStatus(message: string, kind: 'ok' | 'error' | '' = '') {
  status.textContent = message
  status.className = `status ${kind}`
}

function renderPriority() {
  const picker = $<HTMLDivElement>('priority')
  picker.replaceChildren(
    ...([1, 2, 3, 4, 5] as Priority[]).map((p) => {
      const chip = document.createElement('button')
      chip.type = 'button'
      chip.textContent = `P${p}`
      chip.className = `priority-chip${p === priority ? ' selected' : ''}`
      if (p === priority) chip.style.background = `var(--p${p})`
      chip.onclick = () => {
        priority = p
        renderPriority()
      }
      return chip
    })
  )
}

function renderStar() {
  starButton.textContent = starred ? '★' : '☆'
  starButton.classList.toggle('starred', starred)
  starButton.setAttribute('aria-pressed', String(starred))
  starButton.title = starred ? 'Unmark important' : 'Mark important'
}

async function prefill() {
  // Set by the "Add to TODO" context menu just before it opened this popup.
  const { prefill: fromMenu } = (await chrome.storage.session.get('prefill')) as { prefill?: Prefill }
  if (fromMenu) {
    await chrome.storage.session.remove('prefill')
    titleInput.value = fromMenu.title
    notesInput.value = fromMenu.notes
    return
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (tab?.url && /^https?:/.test(tab.url)) {
    titleInput.value = tab.title ?? ''
    notesInput.value = tab.url
  }
}

async function init() {
  const openOptions = () => void chrome.runtime.openOptionsPage()
  $('options-link').onclick = (e) => {
    e.preventDefault()
    openOptions()
  }
  $('open-options').onclick = openOptions

  const config = await loadConfig()
  if (!config) {
    $('setup').hidden = false
    $('fields').hidden = true
    return
  }

  renderPriority()
  renderStar()
  starButton.onclick = () => {
    starred = !starred
    renderStar()
  }
  await prefill()
  titleInput.select()

  try {
    const [groups, stored] = await Promise.all([fetchListGroups(config), chrome.storage.local.get('lastListId')])
    for (const group of groups) {
      const parent = group.label ? Object.assign(document.createElement('optgroup'), { label: group.label }) : listSelect
      for (const list of group.lists) parent.append(new Option(list.name, list.id))
      if (parent !== listSelect) listSelect.append(parent)
    }
    const lastListId = (stored as { lastListId?: string }).lastListId
    listSelect.value = groups.some((g) => g.lists.some((l) => l.id === lastListId)) ? lastListId! : MAIN_LIST_ID
  } catch (err) {
    listSelect.append(new Option('Tasks', MAIN_LIST_ID))
    setStatus(`Couldn't load your lists: ${err instanceof Error ? err.message : err}`, 'error')
  }

  $<HTMLFormElement>('form').onsubmit = async (e) => {
    e.preventDefault()
    if (!titleInput.value.trim()) return
    addButton.disabled = true
    setStatus('Adding…')
    try {
      await addTask(config, { title: titleInput.value, notes: notesInput.value, listId: listSelect.value, priority, starred })
      await chrome.storage.local.set({ lastListId: listSelect.value })
      setStatus('Added. It will show up in the app on its next Sync.', 'ok')
      setTimeout(() => window.close(), 1200)
    } catch (err) {
      addButton.disabled = false
      setStatus(`Couldn't add the task: ${err instanceof Error ? err.message : err}`, 'error')
    }
  }
}

void init()
