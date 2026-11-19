import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { ExtensionId, ExtensionRunResult, LocalSettings, SyncedSettings } from '@shared/types'
import { EXTENSION_CATALOG, isInstalled, setInstalled, type CatalogEntry } from '@shared/extensions'
import { useAppState } from '../../state/AppStateContext'
import { useConfirm } from '../ConfirmDialog'
import { GoogleCalendarSettings } from './GoogleCalendarSettings'
import { ObsidianSettings } from './ObsidianSettings'
import { MicrosoftTodoSettings } from './MicrosoftTodoSettings'

/** Each built-in extension's options panel. */
const SETTINGS_PANELS: Record<ExtensionId, () => ReactNode> = {
  'google-calendar': () => <GoogleCalendarSettings />,
  obsidian: () => <ObsidianSettings />,
  'microsoft-todo': () => <MicrosoftTodoSettings />
}

/** Whether an installed extension is set up on this device, mirroring each MainExtension.isReady. */
function readyHere(id: ExtensionId, synced: SyncedSettings, local: LocalSettings): boolean {
  switch (id) {
    case 'google-calendar':
      return local.googleConnected && synced.extensions.googleCalendar.calendarIds.length > 0
    case 'obsidian':
      return !!local.obsidianVaultPath
    case 'microsoft-todo':
      return !!local.microsoftTodoAccountId
  }
}

type Filter = 'all' | 'installed'

/** The extension marketplace: browse the catalog, install, set up and run extensions. */
export function ExtensionsModal({ onClose, initial }: { onClose: () => void; initial?: string }) {
  const { syncedSettings, saveSyncedSettings, localSettings, reloadData } = useAppState()
  const confirm = useConfirm()
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState(initial ?? EXTENSION_CATALOG[0].id)
  const [runs, setRuns] = useState<Partial<Record<ExtensionId, ExtensionRunResult>>>({})
  const [running, setRunning] = useState(false)

  useEffect(() => {
    void window.api.extensions.getLastRuns().then(setRuns)
  }, [])

  const ext = syncedSettings.extensions
  const installed = (e: CatalogEntry) => e.kind === 'built-in' && isInstalled(ext, e.id)

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return EXTENSION_CATALOG.filter(
      (e) =>
        (filter === 'all' || (e.kind === 'built-in' && isInstalled(ext, e.id))) &&
        (!q || `${e.name} ${e.tagline} ${e.category}`.toLowerCase().includes(q))
    )
  }, [filter, query, ext])

  const selected = EXTENSION_CATALOG.find((e) => e.id === selectedId) ?? EXTENSION_CATALOG[0]

  async function toggleInstall(id: ExtensionId, on: boolean) {
    if (!on) {
      const ok = await confirm({
        title: `Uninstall ${selected.name}?`,
        message: 'It stops running on every device. Its options are kept, so installing it again picks up where you left off.',
        confirmLabel: 'Uninstall',
        tone: 'accent'
      })
      if (!ok) return
    }
    await saveSyncedSettings({ ...syncedSettings, extensions: setInstalled(ext, id, on) })
  }

  async function runNow(id: ExtensionId) {
    setRunning(true)
    try {
      const result = await window.api.extensions.runNow(id)
      setRuns((prev) => ({ ...prev, [id]: result }))
      await reloadData()
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="overlay centered" onClick={onClose}>
      <div className="modal extensions-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-labelledby="extensions-title">
        <button className="close-x" onClick={onClose} aria-label="Close">
          &#10005;
        </button>
        <h2 id="extensions-title">Extensions</h2>

        <div className="extensions-layout">
          <div className="extensions-catalog">
            <input type="search" className="catalog-search" placeholder="Search extensions" value={query} onChange={(e) => setQuery(e.target.value)} />
            <div className="segmented" role="tablist">
              {(['all', 'installed'] as const).map((f) => (
                <button key={f} role="tab" aria-selected={filter === f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>
                  {f === 'all' ? 'All' : `Installed (${ext.installed.length})`}
                </button>
              ))}
            </div>
            <ul className="catalog-list">
              {shown.map((e) => (
                <li key={e.id}>
                  <button className={`catalog-item${e.id === selected.id ? ' selected' : ''}`} onClick={() => setSelectedId(e.id)}>
                    <span className="ext-glyph" aria-hidden>
                      {e.glyph}
                    </span>
                    <span className="option-text">
                      <span className="option-name">
                        {e.name}
                        <EntryBadge entry={e} installed={installed(e)} />
                      </span>
                      <span className="option-description">{e.tagline}</span>
                    </span>
                  </button>
                </li>
              ))}
              {shown.length === 0 && <li className="hint catalog-empty">No extensions match.</li>}
            </ul>
          </div>

          <section className="extension-detail" aria-label={selected.name}>
            <div className="detail-head">
              <span className="ext-glyph large" aria-hidden>
                {selected.glyph}
              </span>
              <div className="detail-title">
                <h3>{selected.name}</h3>
                <span className="hint">{selected.category}</span>
              </div>
              {selected.kind === 'built-in' &&
                (installed(selected) ? (
                  <button className="btn small" onClick={() => void toggleInstall(selected.id, false)}>
                    Uninstall
                  </button>
                ) : (
                  <button className="btn primary small" onClick={() => void toggleInstall(selected.id, true)}>
                    Install
                  </button>
                ))}
            </div>

            <p className="detail-description">{selected.description}</p>

            <h4>Access</h4>
            <ul className="access-list">
              {selected.access.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>

            {selected.kind === 'built-in' && (
              <>
                <h4>On Sync</h4>
                <p className="detail-description">{selected.runs}</p>
              </>
            )}

            {selected.kind === 'companion' && (
              <>
                <h4>Set up</h4>
                <ol className="setup-steps">
                  {selected.setup.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ol>
              </>
            )}

            {selected.kind === 'planned' && <p className="hint">Not available yet.</p>}

            {selected.kind === 'built-in' && installed(selected) && (
              <>
                <h4>Settings</h4>
                {SETTINGS_PANELS[selected.id]()}
                <div className="run-row">
                  <button
                    className="btn small"
                    disabled={running || !readyHere(selected.id, syncedSettings, localSettings)}
                    onClick={() => void runNow(selected.id)}
                  >
                    {running ? 'Running…' : 'Run now'}
                  </button>
                  <RunStatus result={runs[selected.id]} ready={readyHere(selected.id, syncedSettings, localSettings)} />
                </div>
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}

function EntryBadge({ entry, installed }: { entry: CatalogEntry; installed: boolean }) {
  if (entry.kind === 'planned') return <span className="ext-badge">Planned</span>
  if (entry.kind === 'companion') return <span className="ext-badge">Companion</span>
  return installed ? <span className="ext-badge on">Installed</span> : null
}

function RunStatus({ result, ready }: { result?: ExtensionRunResult; ready: boolean }) {
  if (!ready) return <span className="hint run-status">Finish the setup above to run it on this device.</span>
  if (!result) return <span className="hint run-status">Runs on every Sync.</span>
  const when = new Date(result.at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  return (
    <span className={`run-status ${result.error ? 'error' : 'ok'}`}>
      {result.error ? `Failed: ${result.error}` : result.summary || 'Nothing to do'} · {when}
    </span>
  )
}
