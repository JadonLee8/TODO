import type { NewTaskInput } from '@shared/newTask'
import type { Task } from '@shared/types'

/**
 * An integration is a feature that connects the extension to a site or service: quick add from any page now, Gmail
 * and GitHub later. Each one lives in its own file in this folder and is listed in `INTEGRATIONS` (./index.ts). The
 * background turns them on and off, builds the right-click menu from them, and hands them an `IntegrationContext`,
 * so an integration never touches the cache or the sync itself.
 *
 * Adding one:
 *  1. Write `<name>.ts` exporting an `Integration` (status 'available' once it works).
 *  2. Add it to `INTEGRATIONS`.
 *  3. Sites it reads go in `hosts` and in the manifest's `optional_host_permissions`; the options page asks for them
 *     when the user turns it on. Content scripts are registered from `activate` with chrome.scripting, so a turned-off
 *     integration injects nothing.
 *  4. If it creates tasks, give them a `source` type in shared/types.ts so the app can show where they came from.
 */

export interface IntegrationContext {
  /** Adds a task to the extension's cache; the next sync takes it to GitHub. */
  addTask(input: NewTaskInput): Promise<Task>
  /** A short mark on the toolbar icon for a moment, for actions that happen without a page open. */
  flash(ok: boolean): Promise<void>
  /** Opens the options page (e.g. when something needs setting up). */
  openOptions(): void
}

export interface MenuItem {
  /** Unique across integrations; prefix it with the integration's id. */
  id: string
  title: string
  contexts: NonNullable<chrome.contextMenus.CreateProperties['contexts']>
  /** Limit the item to some pages, e.g. ['https://mail.google.com/*']. */
  documentUrlPatterns?: string[]
}

export interface Integration {
  id: string
  name: string
  /** One sentence: what it does for the user. */
  description: string
  /** 'planned' integrations are listed in the options page but can't be turned on yet. */
  status: 'available' | 'planned'
  /** What it needs or how it works, shown under the description. */
  detail: string
  enabledByDefault: boolean
  /** Sites it needs access to, as match patterns. */
  hosts: string[]
  /** Right-click menu items, shown while it's on. */
  menus?: MenuItem[]
  /**
   * A click on one of its menu items. Runs inside the click, so it can still call things that need a user gesture
   * (chrome.action.openPopup) as long as it does so before its first `await`.
   */
  onMenuClick?(itemId: string, info: chrome.contextMenus.OnClickData, tab: chrome.tabs.Tab | undefined, ctx: IntegrationContext): void
  /** Runs each time the service worker starts with the integration on, and when it's turned on. */
  activate?(ctx: IntegrationContext): void | Promise<void>
  /** Runs when it's turned off: undo what `activate` registered. */
  deactivate?(): void | Promise<void>
}
