import { app, BrowserWindow, ipcMain } from 'electron'
import { autoUpdater } from 'electron-updater'
import { CHANNELS, type UpdateState, type UpdateStatus } from '@shared/ipc'

/**
 * Self-update from the repo's GitHub releases. electron-builder's `publish` setting (package.json) bakes the repo into
 * the installed app, and each release carries the `latest.yml` that says which installer is newest (release.yml
 * uploads it). A newer release downloads in the background and installs when the app quits, or at once from Settings.
 */
const RELEASES_URL = 'https://github.com/JadonLee8/TODO/releases'
/** Startup check: late enough not to slow the first paint, and then every few hours for a long-running window. */
const FIRST_CHECK_DELAY_MS = 10_000
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000

let status: UpdateStatus = { state: 'idle' }

function state(): UpdateState {
  return { currentVersion: app.getVersion(), status, releasesUrl: RELEASES_URL }
}

function setStatus(next: UpdateStatus): void {
  status = next
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send(CHANNELS.updatesChanged, state())
}

/** Why this copy can't update itself, or null when it can. */
function unsupportedReason(): string | null {
  if (!app.isPackaged) return 'Updates work in the installed app, not in `npm run dev`.'
  // electron-builder's portable .exe unpacks to a temp folder on every launch, so there's nothing to replace.
  if (process.env['PORTABLE_EXECUTABLE_DIR']) return 'The portable .exe can’t update itself: download the new one from the releases page.'
  return null
}

/** electron-updater's errors include the whole HTTP response; keep the part a person can act on. */
function describe(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err)
  if (/latest\.yml/.test(message) && /404|Cannot find/i.test(message)) return 'The newest release has no update file (latest.yml), so it can’t be installed from here.'
  if (/ENOTFOUND|ETIMEDOUT|ECONNRESET|net::ERR_/.test(message)) return 'Couldn’t reach GitHub. Check your connection.'
  return message.split('\n')[0]
}

async function check(): Promise<void> {
  if (status.state === 'unsupported' || status.state === 'checking' || status.state === 'downloading' || status.state === 'ready') return
  setStatus({ state: 'checking' })
  try {
    await autoUpdater.checkForUpdates()
  } catch (err) {
    setStatus({ state: 'error', message: describe(err) })
  }
}

export function registerUpdater(): void {
  ipcMain.handle(CHANNELS.updatesGetState, () => state())
  ipcMain.handle(CHANNELS.updatesCheck, () => check())
  ipcMain.handle(CHANNELS.updatesInstall, () => {
    if (status.state !== 'ready') return
    // isSilent: no installer window; isForceRunAfter: start the new version once it's installed.
    setImmediate(() => autoUpdater.quitAndInstall(true, true))
  })

  const reason = unsupportedReason()
  if (reason) {
    status = { state: 'unsupported', reason }
    return
  }

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('update-available', (info) => setStatus({ state: 'downloading', version: info.version, percent: 0 }))
  autoUpdater.on('update-not-available', () => setStatus({ state: 'upToDate' }))
  autoUpdater.on('download-progress', (progress) => {
    if (status.state === 'downloading') setStatus({ ...status, percent: Math.round(progress.percent) })
  })
  autoUpdater.on('update-downloaded', (info) => setStatus({ state: 'ready', version: info.version }))
  autoUpdater.on('error', (err) => setStatus({ state: 'error', message: describe(err) }))

  setTimeout(() => void check(), FIRST_CHECK_DELAY_MS)
  setInterval(() => void check(), CHECK_INTERVAL_MS)
}
