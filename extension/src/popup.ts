import type { Priority } from '@shared/types'
import { fillListSelect, listGroups } from './config'
import { applyCachedLook, applyLook } from './look'
import { send } from './messages'
import { PREFILL_KEY, type Prefill } from './integrations/quickAdd'

/** The toolbar popup: add a task, prefilled with the current tab (or what the right-click menu sent). */

applyCachedLook()

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
  $<HTMLDivElement>('priority').replaceChildren(
    ...([1, 2, 3, 4, 5] as Priority[]).map((p) => {
      const chip = document.createElement('button')
      chip.type = 'button'
      chip.textContent = `P${p}`
      chip.className = `priority-chip p${p}${p === priority ? ' selected' : ''}`
      chip.setAttribute('aria-pressed', String(p === priority))
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
}

async function prefill() {
  const fromMenu = (await chrome.storage.session.get(PREFILL_KEY))[PREFILL_KEY] as Prefill | undefined
  if (fromMenu) {
    await chrome.storage.session.remove(PREFILL_KEY)
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
  $('options-link').onclick = openOptions
  $('open-options').onclick = openOptions
  // Looked up now: opening the side panel needs the click's user gesture, so nothing may be awaited before it.
  const windowId = (await chrome.windows.getCurrent()).id!
  $('open-panel').onclick = () => {
    void chrome.sidePanel.open({ windowId }).then(() => window.close())
  }

  const state = await send({ type: 'snapshot' })
  applyLook(state.settings)
  if (!state.configured) {
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

  const { lastListId } = (await chrome.storage.local.get('lastListId')) as { lastListId?: string }
  fillListSelect(listSelect, listGroups(state.lists, state.folders), lastListId)

  $<HTMLFormElement>('form').onsubmit = async (e) => {
    e.preventDefault()
    if (!titleInput.value.trim()) return
    addButton.disabled = true
    try {
      await send({ type: 'addTask', input: { title: titleInput.value, notes: notesInput.value, listId: listSelect.value, priority, starred } })
      await chrome.storage.local.set({ lastListId: listSelect.value })
      setStatus('Added. It syncs in a moment.', 'ok')
      setTimeout(() => window.close(), 900)
    } catch (err) {
      addButton.disabled = false
      setStatus(`Couldn’t add the task: ${err instanceof Error ? err.message : err}`, 'error')
    }
  }
}

init().catch((err: unknown) => setStatus(err instanceof Error ? err.message : String(err), 'error'))
