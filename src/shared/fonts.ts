/** The fonts the app can be set in. Each is bundled with the renderer, so they all work offline. */
export interface FontOption {
  id: string
  name: string
  description: string
  /** CSS font-family stack, starting with the bundled font. */
  family: string
  /** Every letter the same width. The terminal style needs one, and swaps in JetBrains Mono for any other font. */
  monospace: boolean
  /** The closest Android system font family, for the home-screen widget (which can't use the bundled fonts). */
  androidFamily: string
}

export const DEFAULT_FONT_ID = 'grotesque'

export const FONTS: FontOption[] = [
  {
    id: DEFAULT_FONT_ID,
    name: 'Bricolage Grotesque',
    description: 'Lively and slightly condensed. Its weight and width carry the priority levels.',
    family: "'Bricolage Grotesque Variable', 'Segoe UI', system-ui, sans-serif",
    monospace: false,
    androidFamily: 'sans-serif-condensed'
  },
  {
    id: 'dot-matrix',
    name: 'Doto',
    description: 'Dot-matrix letters, like a receipt printer or an LED sign.',
    family: "'Doto Variable', 'Consolas', ui-monospace, monospace",
    monospace: true,
    androidFamily: 'monospace'
  },
  {
    id: 'mono',
    name: 'JetBrains Mono',
    description: 'A coding font with every letter the same width.',
    family: "'JetBrains Mono Variable', 'Consolas', ui-monospace, monospace",
    monospace: true,
    androidFamily: 'monospace'
  }
]

/** The font in use, falling back to the default for an unknown id. */
export function resolveFont(id: string | undefined): FontOption {
  return FONTS.find((f) => f.id === id) ?? FONTS[0]
}
