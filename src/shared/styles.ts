import type { FontOption } from './fonts'
import { FONTS } from './fonts'

/**
 * A style is how the app is laid out, independent of its colors (the theme) and its font. Every style works with
 * every theme and font, on desktop, on Android and in the Android widget.
 *  - standard: the sidebar, task rows and panels.
 *  - terminal: a shell. The tasks are an `ls` listing above a prompt, and everything is a command (shared/shell.ts,
 *    the same commands as the `todo` CLI). Always set in a monospace font.
 */
export type StyleId = 'standard' | 'terminal'

export interface StyleOption {
  id: StyleId
  name: string
  description: string
}

export const DEFAULT_STYLE_ID: StyleId = 'standard'

export const STYLES: StyleOption[] = [
  {
    id: 'standard',
    name: 'Standard',
    description: 'Lists in a sidebar, tasks as rows, and panels for editing.'
  },
  {
    id: 'terminal',
    name: 'Terminal',
    description: 'A shell: your tasks as an ls listing and a prompt to type commands. Type help to start, exit to come back.'
  }
]

/** The style in use, falling back to the default for an unknown id (e.g. one added by a newer version). */
export function resolveStyle(id: string | undefined): StyleOption {
  return STYLES.find((s) => s.id === id) ?? STYLES[0]
}

/** The font a style is drawn in: the chosen one, except that the terminal style swaps a proportional font for a monospace one. */
export function fontForStyle(style: StyleOption, font: FontOption): FontOption {
  if (style.id !== 'terminal' || font.monospace) return font
  return FONTS.find((f) => f.id === 'mono') ?? font
}
