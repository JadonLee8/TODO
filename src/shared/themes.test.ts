import { describe, expect, it } from 'vitest'
import type { Theme } from './types'
import {
  BUILT_IN_THEMES,
  DEFAULT_THEME_ID,
  contrastRatio,
  deriveColors,
  duplicateTheme,
  isDarkTheme,
  mix,
  normalizeHex,
  normalizeTheme,
  resolveTheme,
  themeColors,
  themeCssVars
} from './themes'
import { DEFAULT_FONT_ID, resolveFont } from './fonts'

const paper = BUILT_IN_THEMES[0]
const night = BUILT_IN_THEMES.find((t) => t.id === 'night')!
const custom: Theme = { ...paper, id: 'mine', name: 'Mine', base: { ...paper.base, primary: '#123456' }, overrides: {} }

describe('resolveTheme', () => {
  it('finds built-in and custom themes', () => {
    expect(resolveTheme({ themeId: 'night', customThemes: [], fontId: '', styleId: '' }).name).toBe('Night')
    expect(resolveTheme({ themeId: 'mine', customThemes: [custom], fontId: '', styleId: '' }).base.primary).toBe('#123456')
  })

  it('falls back to the default theme for an unknown id', () => {
    expect(resolveTheme({ themeId: 'deleted', customThemes: [], fontId: '', styleId: '' }).id).toBe(DEFAULT_THEME_ID)
  })
})

describe('themeColors', () => {
  it('uses the main colors directly and derives the rest from them', () => {
    const c = themeColors(paper)
    expect([c.paper, c.ink, c.highlighter]).toEqual([paper.base.background, paper.base.primary, paper.base.secondary])
    expect(c.slate).toBe(mix(paper.base.primary, paper.base.background, 0.32))
  })

  it('restyles derived colors when a main color changes', () => {
    expect(themeColors(custom).slate).not.toBe(themeColors(paper).slate)
  })

  it('applies overrides on top of derived colors', () => {
    expect(themeColors({ ...paper, overrides: { sidebar: '#ff0000' } }).sidebar).toBe('#ff0000')
  })

  it('derives darker surfaces for dark backgrounds', () => {
    const c = deriveColors(night.base)
    expect(contrastRatio(c.sidebar, '#000000')).toBeLessThan(contrastRatio(c.paper, '#000000'))
    expect(c.danger).toBe('#f2836f')
  })
})

describe('normalizeTheme', () => {
  it('replaces invalid colors and drops overrides of main colors', () => {
    const broken = { id: 'x', name: '  ', description: 'd', base: { primary: 'red', background: '#ABC' }, overrides: { ink: '#000000', slate: 'nope', faint: '#123' } } as unknown as Theme
    const t = normalizeTheme(broken)
    expect(t.base).toEqual({ background: '#aabbcc', primary: paper.base.primary, secondary: paper.base.secondary })
    expect(t.overrides).toEqual({ faint: '#112233' })
    expect(t.name).toBe('Untitled theme')
  })

  it('converts themes saved with a full colors object', () => {
    const legacy = { id: 'old', name: 'Old', description: '', colors: { ...themeColors(night), sidebar: '#010101' } } as unknown as Theme
    const t = normalizeTheme(legacy)
    expect(t.base).toEqual(night.base)
    expect(themeColors(t).sidebar).toBe('#010101')
  })

  it('normalizeHex rejects non-hex values', () => {
    expect(normalizeHex('#FFF')).toBe('#ffffff')
    expect(normalizeHex('rgb(0,0,0)')).toBeNull()
    expect(normalizeHex(undefined)).toBeNull()
  })
})

describe('duplicateTheme', () => {
  it('gives the copy a new id and a name that is not taken', () => {
    const first = duplicateTheme(night, BUILT_IN_THEMES, 'a')
    expect(first).toMatchObject({ id: 'a', name: 'Night copy' })
    expect(duplicateTheme(night, [...BUILT_IN_THEMES, first], 'b').name).toBe('Night copy 2')
    expect(first.base).not.toBe(night.base)
  })
})

describe('color helpers', () => {
  it('mix and contrastRatio', () => {
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080')
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21)
  })

  it('themeCssVars maps every color to a kebab-case custom property', () => {
    const vars = themeCssVars(paper)
    expect(vars['--paper-raised']).toBe(themeColors(paper).paperRaised)
    expect(Object.keys(vars)).toHaveLength(11)
  })

  it('isDarkTheme', () => {
    expect(isDarkTheme(night)).toBe(true)
    expect(isDarkTheme(paper)).toBe(false)
  })

  it('built-in themes keep readable text', () => {
    for (const t of BUILT_IN_THEMES) {
      const c = themeColors(t)
      expect(contrastRatio(c.ink, c.paper)).toBeGreaterThan(7)
      expect(contrastRatio(c.ink, c.highlighter)).toBeGreaterThan(4.5)
    }
  })
})

describe('resolveFont', () => {
  it('falls back to the default font', () => {
    expect(resolveFont('mono').name).toBe('JetBrains Mono')
    expect(resolveFont('gone').id).toBe(DEFAULT_FONT_ID)
    expect(resolveFont(undefined).id).toBe(DEFAULT_FONT_ID)
  })
})
