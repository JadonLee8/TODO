import { INTEGRATIONS, describeIntegrations, enabledIds, setEnabled } from '../integrations'
import type { IntegrationContext } from '../integrations/types'
import type { Reply, Request, Responses } from '../messages'
import { addTask, broadcast, runSync, snapshot, updateTask } from './store'

/**
 * The extension's service worker: the one place that holds the tasks (./store.ts) and talks to GitHub. Pages send it
 * requests (../messages.ts); integrations plug into it (../integrations). Chrome stops it when idle and starts it for
 * the next event, so every listener is registered at the top level, synchronously.
 */

const SYNC_ALARM = 'sync'
/** Pull what other devices changed every so often, and push anything a stopped worker didn't get to. */
const SYNC_EVERY_MINUTES = 15

const ctx: IntegrationContext = {
  addTask,
  async flash(ok) {
    await chrome.action.setBadgeBackgroundColor({ color: ok ? '#1f7a4d' : '#b42318' })
    await chrome.action.setBadgeText({ text: ok ? '✓' : '!' })
    setTimeout(() => void chrome.action.setBadgeText({ text: '' }), 3000)
  },
  openOptions: () => void chrome.runtime.openOptionsPage()
}

/** Rebuilds the right-click menu from the integrations that are on. */
async function buildMenus(): Promise<void> {
  const on = await enabledIds()
  await chrome.contextMenus.removeAll()
  for (const integration of INTEGRATIONS) {
    if (!on.has(integration.id)) continue
    for (const item of integration.menus ?? []) {
      chrome.contextMenus.create({ id: item.id, title: item.title, contexts: item.contexts, documentUrlPatterns: item.documentUrlPatterns })
    }
  }
}

async function activateAll(): Promise<void> {
  const on = await enabledIds()
  for (const integration of INTEGRATIONS) if (on.has(integration.id)) await integration.activate?.(ctx)
}

chrome.runtime.onInstalled.addListener(() => {
  void buildMenus()
  void chrome.alarms.create(SYNC_ALARM, { periodInMinutes: SYNC_EVERY_MINUTES })
})

chrome.runtime.onStartup.addListener(() => {
  void chrome.alarms.create(SYNC_ALARM, { periodInMinutes: SYNC_EVERY_MINUTES })
  void runSync()
})

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === SYNC_ALARM) void runSync()
})

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const id = String(info.menuItemId)
  const integration = INTEGRATIONS.find((i) => i.menus?.some((m) => m.id === id))
  integration?.onMenuClick?.(id, info, tab, ctx)
})

async function handle(request: Request): Promise<Responses[Request['type']]> {
  switch (request.type) {
    case 'snapshot':
      return snapshot()
    case 'addTask':
      return addTask(request.input)
    case 'updateTask':
      await updateTask(request.task)
      return null
    case 'sync':
      return runSync()
    case 'configChanged':
      broadcast()
      void runSync()
      return null
    case 'integrations':
      return describeIntegrations()
    case 'setIntegration': {
      const integration = INTEGRATIONS.find((i) => i.id === request.id)
      if (!integration || integration.status !== 'available') throw new Error('That integration isn’t available yet')
      await setEnabled(request.id, request.enabled)
      if (request.enabled) await integration.activate?.(ctx)
      else await integration.deactivate?.()
      await buildMenus()
      return describeIntegrations()
    }
  }
}

chrome.runtime.onMessage.addListener((message: Request, _sender, sendResponse: (reply: Reply<unknown>) => void) => {
  if (!message || typeof message !== 'object' || !('type' in message)) return false
  handle(message).then(
    (value) => sendResponse({ ok: true, value }),
    (err: unknown) => sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) })
  )
  // Keeps the channel open for the async reply.
  return true
})

void activateAll()
