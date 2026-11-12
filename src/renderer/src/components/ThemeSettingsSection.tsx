import { useEffect, useState } from 'react'
import type { Theme, ThemeBase, ThemeColors } from '@shared/types'
import {
  BASE_COLOR_FIELDS,
  DEFAULT_THEME_ID,
  DERIVED_COLOR_FIELDS,
  allThemes,
  contrastRatio,
  duplicateTheme,
  isBuiltInTheme,
  normalizeHex,
  resolveTheme,
  themeColors,
  type DerivedColorKey
} from '@shared/themes'
import { newId } from '@shared/id'
import { useAppState } from '../state/AppStateContext'
import { useConfirm } from './ConfirmDialog'

/** The colors shown as a theme's swatch strip, chosen to make themes easy to tell apart. */
const SWATCH_KEYS: (keyof ThemeColors)[] = ['paper', 'sidebar', 'ink', 'highlighter', 'danger']

export function ThemeSettingsSection({ style }: { style?: React.CSSProperties }) {
  const { syncedSettings, saveSyncedSettings, setPreviewTheme } = useAppState()
  const appearance = syncedSettings.appearance
  const themes = allThemes(appearance)
  const active = resolveTheme(appearance)
  // The theme being created or edited. Nothing is saved until "Save theme".
  const [draft, setDraft] = useState<{ theme: Theme; isNew: boolean } | null>(null)
  const confirm = useConfirm()

  // Closing Settings mid-edit drops the preview.
  useEffect(() => () => setPreviewTheme(null), [setPreviewTheme])

  async function saveAppearance(customThemes: Theme[], themeId: string) {
    await saveSyncedSettings({ ...syncedSettings, appearance: { ...appearance, themeId, customThemes } })
  }

  function startEditing(theme: Theme, isNew: boolean) {
    setDraft({ theme, isNew })
    setPreviewTheme(theme)
  }

  function updateDraft(changes: Partial<Theme>) {
    if (!draft) return
    const theme = { ...draft.theme, ...changes }
    setDraft({ ...draft, theme })
    setPreviewTheme(theme)
  }

  function stopEditing() {
    setDraft(null)
    setPreviewTheme(null)
  }

  async function saveDraft() {
    if (!draft) return
    const theme = { ...draft.theme, name: draft.theme.name.trim() || 'Untitled theme', description: draft.theme.description.trim() }
    const others = appearance.customThemes.filter((t) => t.id !== theme.id)
    stopEditing()
    await saveAppearance([...others, theme], theme.id)
  }

  async function deleteTheme(theme: Theme) {
    const ok = await confirm({
      title: `Delete the theme “${theme.name}”?`,
      message: 'Its colors can’t be brought back. The app switches to Paper and ink if it’s in use.',
      confirmLabel: 'Delete theme',
      tone: 'danger'
    })
    if (!ok) return
    const remaining = appearance.customThemes.filter((t) => t.id !== theme.id)
    await saveAppearance(remaining, appearance.themeId === theme.id ? DEFAULT_THEME_ID : appearance.themeId)
  }

  return (
    <div className="settings-section" style={style}>
      <h3>Colors</h3>
      <p className="hint">
        The theme you pick is saved and used every time the app opens, on every device that syncs. To make your own, duplicate a theme and pick
        its colors.
      </p>

      <div className="option-list" role="radiogroup" aria-label="Theme">
        {themes.map((theme) => {
          const colors = themeColors(theme)
          return (
            <button
              key={theme.id}
              role="radio"
              aria-checked={theme.id === active.id}
              className={`option${theme.id === active.id ? ' selected' : ''}`}
              disabled={!!draft}
              onClick={() => void saveAppearance(appearance.customThemes, theme.id)}
            >
              <span className="theme-swatches" aria-hidden>
                {SWATCH_KEYS.map((key) => (
                  <span key={key} style={{ background: colors[key] }} />
                ))}
              </span>
              <span className="option-text">
                <span className="option-name">
                  {theme.name}
                  {theme.id === DEFAULT_THEME_ID && <span className="option-default"> (default)</span>}
                </span>
                {theme.description && <span className="option-description">{theme.description}</span>}
              </span>
            </button>
          )
        })}
      </div>

      {!draft && (
        <div className="button-row">
          <button className="btn" onClick={() => startEditing(duplicateTheme(active, themes, newId()), true)}>
            Duplicate “{active.name}”
          </button>
          {!isBuiltInTheme(active.id) && (
            <>
              <button className="btn" onClick={() => startEditing(active, false)}>
                Edit
              </button>
              <button className="btn danger" onClick={() => void deleteTheme(active)}>
                Delete
              </button>
            </>
          )}
        </div>
      )}

      {draft && <ThemeEditor draft={draft} onChange={updateDraft} onSave={() => void saveDraft()} onCancel={stopEditing} />}
    </div>
  )
}

function ThemeEditor({
  draft,
  onChange,
  onSave,
  onCancel
}: {
  draft: { theme: Theme; isNew: boolean }
  onChange: (changes: Partial<Theme>) => void
  onSave: () => void
  onCancel: () => void
}) {
  const { theme } = draft
  const colors = themeColors(theme)
  const setBase = (key: keyof ThemeBase, value: string) => onChange({ base: { ...theme.base, [key]: value } })
  const setOverride = (key: DerivedColorKey, value: string | null) => {
    const overrides = { ...theme.overrides }
    if (value === null) delete overrides[key]
    else overrides[key] = value
    onChange({ overrides })
  }
  const overrideCount = Object.keys(theme.overrides).length

  const warnings = [
    contrastRatio(colors.ink, colors.paper) < 4.5 && 'Text will be hard to read on this background. Pick a primary color with more contrast.',
    contrastRatio(colors.ink, colors.highlighter) < 3 && 'Highlighted text will be hard to read. Pick a lighter or darker secondary color.'
  ].filter(Boolean)

  return (
    <div className="theme-editor">
      <div className="field">
        <label htmlFor="theme-name">Name</label>
        <input id="theme-name" type="text" autoFocus value={theme.name} onChange={(e) => onChange({ name: e.target.value })} />
      </div>
      <div className="field">
        <label htmlFor="theme-description">Description</label>
        <textarea
          id="theme-description"
          rows={2}
          placeholder="What this theme is for, e.g. “Dim colors for evenings”"
          value={theme.description}
          onChange={(e) => onChange({ description: e.target.value })}
        />
      </div>

      <div className="base-colors">
        {BASE_COLOR_FIELDS.map(({ key, label, hint, presets }) => (
          <div key={key} className="base-color">
            <ColorField label={label} hint={hint} value={theme.base[key]} onChange={(v) => setBase(key, v)} />
            <div className="presets" role="group" aria-label={`${label} presets`}>
              {presets.map((p) => (
                <button
                  key={p}
                  type="button"
                  className={`preset${theme.base[key] === p ? ' selected' : ''}`}
                  style={{ background: p }}
                  data-tooltip={p}
                  aria-label={`${label} ${p}`}
                  onClick={() => setBase(key, p)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
      {warnings.map((w) => (
        <p key={w as string} className="status-line error">
          {w}
        </p>
      ))}

      <details className="fine-tune">
        <summary>
          Fine-tune other colors{overrideCount > 0 && ` (${overrideCount} changed)`}
        </summary>
        <p className="hint">These follow your main colors automatically. Change one to set it by hand.</p>
        <div className="theme-colors">
          {DERIVED_COLOR_FIELDS.map(({ key, label }) => (
            <div key={key} className="derived-color">
              <ColorField label={label} value={colors[key]} onChange={(v) => setOverride(key, v)} />
              {key in theme.overrides ? (
                <button type="button" className="link-button" onClick={() => setOverride(key, null)} data-tooltip="Go back to the automatic color">
                  Reset
                </button>
              ) : (
                <span className="link-button placeholder" aria-hidden>
                  Reset
                </span>
              )}
            </div>
          ))}
        </div>
      </details>

      <p className="hint">Changes show in the app as you make them.</p>
      <div className="button-row">
        <button className="btn primary" onClick={onSave}>
          Save theme
        </button>
        <button className="btn" onClick={onCancel}>
          {draft.isNew ? 'Discard' : 'Cancel'}
        </button>
      </div>
    </div>
  )
}

/** A color picker plus a hex field. Typing only updates the theme once the hex is complete and valid. */
function ColorField({ label, hint, value, onChange }: { label: string; hint?: string; value: string; onChange: (value: string) => void }) {
  const [text, setText] = useState(value)
  useEffect(() => setText(value), [value])

  return (
    <label className="color-field">
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} aria-label={`${label} color`} />
      <span className="color-label">
        {label}
        {hint && <span className="color-hint">{hint}</span>}
      </span>
      <input
        type="text"
        className="color-hex"
        value={text}
        spellCheck={false}
        onChange={(e) => {
          setText(e.target.value)
          const hex = normalizeHex(e.target.value)
          if (hex) onChange(hex)
        }}
        onBlur={() => setText(value)}
        aria-label={`${label} hex value`}
      />
    </label>
  )
}
