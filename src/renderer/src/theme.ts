import type { Theme } from '@shared/types'
import type { FontOption } from '@shared/fonts'
import { resolveFont } from '@shared/fonts'
import { isDarkTheme, normalizeTheme, themeCssVars } from '@shared/themes'

/** The last applied theme and font, so the next launch starts in them instead of flashing the defaults while settings load. */
const CACHE_KEY = 'todo.appearance'

/** Sets the theme's colors and the font on <html>. Previews pass `remember: false` so an unsaved edit isn't cached. */
export function applyAppearance(theme: Theme, font: FontOption, { remember = true } = {}): void {
  const root = document.documentElement
  for (const [name, value] of Object.entries(themeCssVars(theme))) root.style.setProperty(name, value)
  root.style.setProperty('--font', font.family)
  root.dataset.font = font.id
  root.style.colorScheme = isDarkTheme(theme) ? 'dark' : 'light'
  if (!remember) return
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ theme, fontId: font.id }))
  } catch {
    // Without the cache the app just starts in the default look until settings load.
  }
}

export function applyCachedAppearance(): void {
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null') as { theme: Theme; fontId: string } | null
    if (cached) applyAppearance(normalizeTheme(cached.theme), resolveFont(cached.fontId), { remember: false })
  } catch {
    // A missing or corrupt cache is harmless.
  }
}
