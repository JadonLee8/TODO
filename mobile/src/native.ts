import { App } from '@capacitor/app'
import { registerPlugin, type PluginListenerHandle } from '@capacitor/core'
import type { Api } from '@shared/ipc'
import type { SharedText } from '@shared/share'
import type { WidgetAction } from '@shared/widget'

/**
 * Android's back button (or gesture) closes whatever is on top: a confirmation, a sheet, then the drawer.
 * With nothing open it leaves the app, like any Android app. Works on the DOM so the shared UI needs no changes:
 * every overlay already closes when its backdrop is pressed.
 */
export function handleBackButton(): void {
  void App.addListener('backButton', () => {
    const overlays = document.querySelectorAll<HTMLElement>('.overlay')
    const top = overlays[overlays.length - 1]
    if (top) {
      // Confirmations close on mousedown, sheets on click.
      top.dispatchEvent(new MouseEvent(top.classList.contains('dialog-overlay') ? 'mousedown' : 'click', { bubbles: true }))
      return
    }
    const scrim = document.querySelector<HTMLElement>('.drawer-open .drawer-scrim')
    if (scrim) scrim.click()
    else void App.minimizeApp()
  })
}

/** The app's own plugin (mobile/android/.../ShareTargetPlugin.java). */
interface ShareTargetPlugin {
  takePending(): Promise<{ share?: SharedText }>
  addListener(event: 'shareReceived', handler: () => void): Promise<PluginListenerHandle>
}

const ShareTarget = registerPlugin<ShareTargetPlugin>('ShareTarget')

/** The app's widget plugin (WidgetBridgePlugin.java, with TasksWidgetProvider and TasksWidgetService). */
interface WidgetBridgePlugin {
  update(options: { snapshot: string }): Promise<void>
  takePending(): Promise<{ action?: WidgetAction }>
  addListener(event: 'widgetAction', handler: () => void): Promise<PluginListenerHandle>
}

const WidgetBridge = registerPlugin<WidgetBridgePlugin>('WidgetBridge')

/**
 * Hands each item an intent carried to the app exactly once, whether it opened the app or arrived while it was
 * running: take what's pending now and again every time the plugin says something new arrived.
 */
function onPending<T>(take: () => Promise<T | undefined>, listen: (cb: () => void) => Promise<PluginListenerHandle>, handler: (item: T) => void): () => void {
  let active = true
  const deliver = async () => {
    const item = await take()
    if (active && item) handler(item)
  }
  // Listen first, then take what's waiting, so an item arriving in between isn't missed.
  const listening = listen(() => void deliver())
  void listening.then(deliver)
  return () => {
    active = false
    void listening.then((h) => h.remove())
  }
}

export const shareTarget: NonNullable<Api['shareTarget']> = {
  onShare: (handler) =>
    onPending(
      () => ShareTarget.takePending().then((r) => r.share),
      (cb) => ShareTarget.addListener('shareReceived', cb),
      handler
    )
}

let lastSnapshot = ''

export const widget: NonNullable<Api['widget']> = {
  update(snapshot) {
    const json = JSON.stringify(snapshot)
    if (json === lastSnapshot) return
    lastSnapshot = json
    WidgetBridge.update({ snapshot: json }).catch((err: unknown) => {
      lastSnapshot = ''
      console.error('Widget update failed', err)
    })
  },
  onOpen: (handler) =>
    onPending(
      () => WidgetBridge.takePending().then((r) => r.action),
      (cb) => WidgetBridge.addListener('widgetAction', cb),
      handler
    )
}
