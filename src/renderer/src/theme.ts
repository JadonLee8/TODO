import type { Theme } from '@shared/types'
import type { FontOption } from '@shared/fonts'
import { resolveFont } from '@shared/fonts'
import { fontForStyle, resolveStyle, type StyleOption } from '@shared/styles'
import { isDarkTheme, normalizeTheme, themeCssVars } from '@shared/themes'

/** The last applied look, so the next launch starts in it instead of flashing the defaults while settings load. */
const CACHE_KEY = 'todo.appearance'

/**
 * Sets the theme's colors, the font and the style on <html> (`data-style` switches the terminal stylesheet on).
 * Previews pass `remember: false` so an unsaved edit isn't cached.
 */
export function applyAppearance(theme: Theme, chosenFont: FontOption, style: StyleOption, { remember = true } = {}): void {
  const root = document.documentElement
  const font = fontForStyle(style, chosenFont)
  for (const [name, value] of Object.entries(themeCssVars(theme))) root.style.setProperty(name, value)
  root.style.setProperty('--font', font.family)
  root.dataset.font = font.id
  root.dataset.style = style.id
  root.style.colorScheme = isDarkTheme(theme) ? 'dark' : 'light'
  if (!remember) return
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ theme, fontId: chosenFont.id, styleId: style.id }))
  } catch {
    // Without the cache the app just starts in the default look until settings load.
  }
}

export function applyCachedAppearance(): void {
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null') as { theme: Theme; fontId: string; styleId?: string } | null
    if (cached) applyAppearance(normalizeTheme(cached.theme), resolveFont(cached.fontId), resolveStyle(cached.styleId), { remember: false })
  } catch {
    // A missing or corrupt cache is harmless.
  }
}
