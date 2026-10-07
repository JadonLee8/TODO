import { app, BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { ensureCacheDirs } from './localCache'
import { registerIpcHandlers } from './ipc'

// Lets a second copy of the app run against its own cache (e.g. to test sync between two "devices").
if (process.env['TODO_USER_DATA_DIR']) app.setPath('userData', process.env['TODO_USER_DATA_DIR'])
// Chromium keeps its HTTP cache in <sessionData>/Cache, which on Windows' case-insensitive filesystem is the
// same folder as our own <userData>/cache, and Chromium wipes it when it resets its cache. Keep them apart.
app.setPath('sessionData', join(app.getPath('userData'), 'chromium'))

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 700,
    minHeight: 500,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  win.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  const devServerUrl = process.env['ELECTRON_RENDERER_URL']
  if (devServerUrl) {
    win.loadURL(devServerUrl)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  ensureCacheDirs()
  registerIpcHandlers()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
