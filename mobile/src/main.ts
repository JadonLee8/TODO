import { createAndroidApi } from './api'
import { handleBackButton } from './native'

// The React UI is the desktop renderer, unchanged: it only needs `window.api` to exist before it starts.
try {
  window.api = await createAndroidApi()
  await import('@renderer/main')
  handleBackButton()
} catch (err) {
  // Without this a startup failure is a blank screen with nothing to report.
  console.error('Startup failed', err)
  const message = document.createElement('pre')
  message.style.cssText = 'padding:24px;white-space:pre-wrap;font:14px monospace'
  message.textContent = `TODO couldn't start.\n\n${err instanceof Error ? (err.stack ?? err.message) : String(err)}`
  document.body.replaceChildren(message)
}
