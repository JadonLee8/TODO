import { MAIN_LIST_ID } from '@shared/types'
import { addTask, loadConfig, type Prefill } from './todo'

const MENU_ID = 'add-to-todo'

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: MENU_ID, title: 'Add to TODO', contexts: ['page', 'link', 'selection'] })
})

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_ID) return
  const prefill: Prefill = {
    // Chrome doesn't expose a link's text, so a right-clicked link is titled by its URL.
    title: info.selectionText?.trim() || info.linkUrl || tab?.title || '',
    notes: info.linkUrl ?? info.pageUrl ?? tab?.url ?? ''
  }
  // Open the popup prefilled so priority/list can still be picked. openPopup must be called synchronously within
  // the click (user gesture), so the prefill write isn't awaited first; the popup reads it once it loads.
  void chrome.storage.session.set({ prefill })
  chrome.action.openPopup().catch(() => addDirectly(prefill))
})

/** Fallback when the popup can't be opened (e.g. no focused browser window): add with default settings. */
async function addDirectly(prefill: Prefill) {
  await chrome.storage.session.remove('prefill')
  const config = await loadConfig()
  if (!config) {
    void chrome.runtime.openOptionsPage()
    return
  }
  try {
    await addTask(config, { ...prefill, listId: MAIN_LIST_ID, priority: 3, starred: false })
    await flashBadge('✓', '#1a7f37')
  } catch {
    await flashBadge('!', '#c4314b')
  }
}

async function flashBadge(text: string, color: string) {
  await chrome.action.setBadgeBackgroundColor({ color })
  await chrome.action.setBadgeText({ text })
  setTimeout(() => void chrome.action.setBadgeText({ text: '' }), 3000)
}
