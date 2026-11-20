import { DEFAULT_FONT_ID, FONTS, resolveFont } from '@shared/fonts'
import { useAppState } from '../state/AppStateContext'

export function FontSettingsSection() {
  const { syncedSettings, saveSyncedSettings } = useAppState()
  const appearance = syncedSettings.appearance
  const active = resolveFont(appearance.fontId)

  return (
    <div className="settings-section">
      <h3>Font</h3>
      {appearance.styleId === 'terminal' && !active.monospace && (
        <p className="hint">The terminal style needs letters of one width, so it uses JetBrains Mono instead.</p>
      )}
      <div className="option-list" role="radiogroup" aria-label="Font">
        {FONTS.map((font) => (
          <button
            key={font.id}
            role="radio"
            aria-checked={font.id === active.id}
            className={`option font-${font.id}${font.id === active.id ? ' selected' : ''}`}
            onClick={() => void saveSyncedSettings({ ...syncedSettings, appearance: { ...appearance, fontId: font.id } })}
          >
            {/* Each option is shown in its own font. */}
            <span className="font-sample" style={{ fontFamily: font.family }} aria-hidden>
              Aa
            </span>
            <span className="option-text">
              <span className="option-name" style={{ fontFamily: font.family }}>
                {font.name}
                {font.id === DEFAULT_FONT_ID && <span className="option-default"> (default)</span>}
              </span>
              <span className="option-description">{font.description}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
