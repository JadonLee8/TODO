import type { AppearanceSettings, Theme, ThemeBase, ThemeColors } from './types'

/**
 * A theme is three main colors (background, primary, secondary). Every other color the UI uses is derived from
 * those, so changing one main color restyles the whole app consistently. Any derived color can still be
 * overridden on its own ("fine-tuning").
 */

export const BASE_COLOR_FIELDS: { key: keyof ThemeBase; label: string; hint: string; presets: string[] }[] = [
  {
    key: 'background',
    label: 'Background',
    hint: 'The page behind your tasks',
    presets: ['#eef1f5', '#ffffff', '#e8efe9', '#161b24', '#000000']
  },
  {
    key: 'primary',
    label: 'Primary',
    hint: 'Text, checkboxes and buttons',
    presets: ['#1c2534', '#000000', '#3d2a63', '#14532d', '#e6eaf0']
  },
  {
    key: 'secondary',
    label: 'Secondary',
    hint: 'The highlight on the selected list and overdue dates',
    presets: ['#f3e35a', '#a7f3d0', '#fbcfe8', '#bae6fd', '#fed7aa', '#7a6210']
  }
]

/** The colors worked out from the main three, in the order "Fine-tune" shows them. */
export const DERIVED_COLOR_FIELDS: { key: DerivedColorKey; label: string }[] = [
  { key: 'sidebar', label: 'Sidebar' },
  { key: 'paperRaised', label: 'Panels and menus' },
  { key: 'field', label: 'Text fields' },
  { key: 'slate', label: 'Secondary text' },
  { key: 'faint', label: 'Faint text (P5)' },
  { key: 'hairline', label: 'Lines and borders' },
  { key: 'danger', label: 'Delete and conflicts' },
  { key: 'ok', label: 'Success' }
]

export type DerivedColorKey = Exclude<keyof ThemeColors, 'paper' | 'ink' | 'highlighter'>

export const DEFAULT_THEME_ID = 'paper'

export const BUILT_IN_THEMES: Theme[] = [
  {
    id: DEFAULT_THEME_ID,
    name: 'Paper and ink',
    description: 'Cool paper, navy ink, and a yellow highlighter for what needs attention.',
    base: { background: '#eef1f5', primary: '#1c2534', secondary: '#f3e35a' },
    overrides: {}
  },
  {
    id: 'night',
    name: 'Night',
    description: 'Dark slate with pale ink and an amber highlight, for working late.',
    base: { background: '#161b24', primary: '#e6eaf0', secondary: '#7a6210' },
    overrides: {}
  },
  {
    id: 'contrast',
    name: 'High contrast',
    description: 'Black on white with a bold highlight, for the easiest reading.',
    base: { background: '#ffffff', primary: '#000000', secondary: '#ffe600' },
    // Darker secondary text and stronger lines than the derived ones.
    overrides: { sidebar: '#efefef', slate: '#333333', faint: '#555555', hairline: '#8a8a8a' }
  },
  {
    id: 'phosphor',
    name: 'Phosphor',
    description: 'Near-black with grey text and a green prompt, like a terminal. Made for the terminal style.',
    base: { background: '#0c0d0c', primary: '#c8ccc8', secondary: '#2d4a32' },
    overrides: { ok: '#6ad08a', danger: '#ff7b6b' }
  }
]

const DEFAULT_THEME = BUILT_IN_THEMES[0]

export function isBuiltInTheme(id: string): boolean {
  return BUILT_IN_THEMES.some((t) => t.id === id)
}

/** Built-in themes first, then the user's own, each made safe to use. */
export function allThemes(appearance: AppearanceSettings): Theme[] {
  return [...BUILT_IN_THEMES, ...appearance.customThemes.map(normalizeTheme)]
}

/** The theme in use, falling back to the default when its id is unknown (e.g. deleted on another device). */
export function resolveTheme(appearance: AppearanceSettings): Theme {
  return allThemes(appearance).find((t) => t.id === appearance.themeId) ?? DEFAULT_THEME
}

// ---- Color math ----

/** Expands `#rgb` to `#rrggbb` and lowercases; returns null for anything that isn't a hex color. */
export function normalizeHex(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const v = value.trim().toLowerCase()
  if (/^#[0-9a-f]{6}$/.test(v)) return v
  if (/^#[0-9a-f]{3}$/.test(v)) return '#' + [...v.slice(1)].map((c) => c + c).join('')
  return null
}

function channels(hex: string): number[] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
}

/** Mixes `t` (0–1) of color `b` into color `a`. */
export function mix(a: string, b: string, t: number): string {
  const [ca, cb] = [channels(a), channels(b)]
  return '#' + ca.map((v, i) => Math.round(v + (cb[i] - v) * t).toString(16).padStart(2, '0')).join('')
}

function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG contrast ratio between two colors, from 1 (none) to 21 (black on white). */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

// ---- Themes ----

/** Every color the UI uses, worked out from the theme's main colors and then its overrides. */
export function themeColors(theme: Theme): ThemeColors {
  return { ...deriveColors(theme.base), ...theme.overrides }
}

/** The colors derived from the main three, before overrides. */
export function deriveColors({ background, primary, secondary }: ThemeBase): ThemeColors {
  const dark = luminance(background) < 0.25
  return {
    paper: background,
    ink: primary,
    highlighter: secondary,
    sidebar: dark ? mix(background, '#000000', 0.25) : mix(background, primary, 0.05),
    paperRaised: dark ? mix(background, primary, 0.05) : mix(background, '#ffffff', 0.6),
    field: dark ? mix(background, primary, 0.08) : '#ffffff',
    slate: mix(primary, background, 0.32),
    faint: mix(primary, background, 0.46),
    hairline: mix(background, primary, 0.13),
    danger: dark ? '#f2836f' : '#b42318',
    ok: dark ? '#63c795' : '#1f7a4d'
  }
}

/**
 * Makes a stored theme safe: invalid colors fall back to the default theme's, unknown override keys are dropped,
 * and themes saved in the older format (a full `colors` object) are converted to main colors plus overrides.
 */
export function normalizeTheme(theme: Theme): Theme {
  const raw = theme as Theme & { colors?: Partial<ThemeColors> }
  const legacy = !raw.base && raw.colors
  const base = legacy ? { background: raw.colors!.paper, primary: raw.colors!.ink, secondary: raw.colors!.highlighter } : raw.base
  const overrideSource: Partial<ThemeColors> = (legacy ? raw.colors : raw.overrides) ?? {}

  const safeBase = { ...DEFAULT_THEME.base }
  for (const { key } of BASE_COLOR_FIELDS) safeBase[key] = normalizeHex(base?.[key]) ?? safeBase[key]
  const overrides: Partial<ThemeColors> = {}
  for (const { key } of DERIVED_COLOR_FIELDS) {
    const hex = normalizeHex(overrideSource[key])
    if (hex) overrides[key] = hex
  }
  return {
    id: String(raw.id),
    name: String(raw.name ?? '').trim() || 'Untitled theme',
    description: String(raw.description ?? ''),
    base: safeBase,
    overrides
  }
}

/** A copy of `theme` under a new id, named "<name> copy" (or "copy 2", …) so it doesn't clash. */
export function duplicateTheme(theme: Theme, existing: Theme[], id: string): Theme {
  const names = new Set(existing.map((t) => t.name))
  let name = `${theme.name} copy`
  for (let n = 2; names.has(name); n++) name = `${theme.name} copy ${n}`
  return { id, name, description: theme.description, base: { ...theme.base }, overrides: { ...theme.overrides } }
}

/** The CSS custom properties a theme sets, e.g. `paperRaised` -> `--paper-raised`. */
export function themeCssVars(theme: Theme): Record<string, string> {
  const vars: Record<string, string> = {}
  for (const [key, value] of Object.entries(themeColors(theme))) vars[`--${key.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())}`] = value
  return vars
}

/** Whether the theme's background is dark, so native controls and scrollbars should be drawn dark too. */
export function isDarkTheme(theme: Theme): boolean {
  return luminance(normalizeHex(theme.base.background) ?? DEFAULT_THEME.base.background) < 0.25
}
