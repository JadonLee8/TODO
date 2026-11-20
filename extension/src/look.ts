import type { SyncedSettings } from '@shared/types'
import { resolveTheme, isDarkTheme, themeCssVars } from '@shared/themes'
import { resolveFont } from '@shared/fonts'
import { fontForStyle, resolveStyle } from '@shared/styles'
import '@fontsource-variable/bricolage-grotesque/standard.css'
import '@fontsource-variable/doto/index.css'
import '@fontsource-variable/jetbrains-mono/index.css'

/**
 * The extension's pages wear the app's look: the synced theme's colors, font and style (styles.css derives every
 * shade from the same variables as the app's global.css). Remembered in localStorage so a page opens in the right
 * colors before the background has answered.
 */
const CACHE_KEY = 'todo.look'

export function applyLook(settings: SyncedSettings): void {
  const theme = resolveTheme(settings.appearance)
  const style = resolveStyle(settings.appearance.styleId)
  const font = fontForStyle(style, resolveFont(settings.appearance.fontId))
  const root = document.documentElement
  for (const [name, value] of Object.entries(themeCssVars(theme))) root.style.setProperty(name, value)
  root.style.setProperty('--font', font.family)
  root.dataset.font = font.id
  root.dataset.style = style.id
  root.style.colorScheme = isDarkTheme(theme) ? 'dark' : 'light'
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(settings.appearance))
  } catch {
    // Only costs a flash of the default colors next time.
  }
}

export function applyCachedLook(): void {
  try {
    const appearance = JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null')
    if (appearance) applyLook({ appearance } as SyncedSettings)
  } catch {
    // A missing or corrupt cache is harmless.
  }
}
