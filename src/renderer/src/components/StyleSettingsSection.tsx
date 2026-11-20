import { DEFAULT_STYLE_ID, STYLES, resolveStyle } from '@shared/styles'
import { useAppState } from '../state/AppStateContext'

export function StyleSettingsSection({ style }: { style?: React.CSSProperties }) {
  const { syncedSettings, saveSyncedSettings } = useAppState()
  const appearance = syncedSettings.appearance
  const active = resolveStyle(appearance.styleId)

  return (
    <div className="settings-section" style={style}>
      <h3>Style</h3>
      <p className="hint">How the app is laid out. Every style works with every theme and font, here, on your phone and in its widget.</p>
      <div className="option-list" role="radiogroup" aria-label="Style">
        {STYLES.map((option) => (
          <button
            key={option.id}
            role="radio"
            aria-checked={option.id === active.id}
            className={`option style-${option.id}${option.id === active.id ? ' selected' : ''}`}
            onClick={() => void saveSyncedSettings({ ...syncedSettings, appearance: { ...appearance, styleId: option.id } })}
          >
            <span className="style-sample" aria-hidden>
              {option.id === 'terminal' ? '$_' : '☰'}
            </span>
            <span className="option-text">
              <span className="option-name">
                {option.name}
                {option.id === DEFAULT_STYLE_ID && <span className="option-default"> (default)</span>}
              </span>
              <span className="option-description">{option.description}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
