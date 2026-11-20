import { MAIN_LIST_ID } from '@shared/types'
import type { Integration } from './types'

/** What the popup is prefilled with when it's opened from the right-click menu. */
export interface Prefill {
  title: string
  notes: string
}

export const PREFILL_KEY = 'prefill'

/** "Add to TODO" on any page, link or selection: opens the popup prefilled, so the list and priority can be picked. */
export const quickAdd: Integration = {
  id: 'quick-add',
  name: 'Quick add',
  description: 'Add the page you’re on, a link or selected text as a task, from the toolbar or the right-click menu.',
  status: 'available',
  detail: 'Reads the title and address of the tab you add from, only when you add it.',
  enabledByDefault: true,
  hosts: [],
  menus: [{ id: 'quick-add', title: 'Add to TODO', contexts: ['page', 'link', 'selection'] }],
  onMenuClick(_itemId, info, tab, ctx) {
    const prefill: Prefill = {
      // Chrome doesn't give a link's text, so a right-clicked link is titled by its address.
      title: info.selectionText?.trim() || info.linkUrl || tab?.title || '',
      notes: info.linkUrl ?? info.pageUrl ?? tab?.url ?? ''
    }
    // openPopup needs the click's user gesture, so it's called before anything is awaited; the popup reads the
    // prefill once it has loaded.
    void chrome.storage.session.set({ [PREFILL_KEY]: prefill })
    chrome.action.openPopup().catch(async () => {
      // No focused window to show the popup in: add it to Tasks with the defaults.
      await chrome.storage.session.remove(PREFILL_KEY)
      try {
        await ctx.addTask({ title: prefill.title, notes: prefill.notes, listId: MAIN_LIST_ID })
        await ctx.flash(true)
      } catch {
        await ctx.flash(false)
      }
    })
  }
}
