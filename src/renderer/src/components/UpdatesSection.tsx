import { useEffect, useState } from 'react'
import type { UpdateState } from '@shared/ipc'

/** The desktop app's update state, kept live; null on Android or until it's loaded. */
export function useUpdateState(): UpdateState | null {
  const [state, setState] = useState<UpdateState | null>(null)
  useEffect(() => {
    const updates = window.api.updates
    if (!updates) return
    let live = true
    void updates.getState().then((s) => live && setState(s))
    const unsubscribe = updates.onChange(setState)
    return () => {
      live = false
      unsubscribe()
    }
  }, [])
  return state
}

export function UpdatesSection() {
  const update = useUpdateState()
  if (!update) return null
  const { status } = update
  const busy = status.state === 'checking' || status.state === 'downloading'

  let line: { text: string; tone?: 'ok' | 'error' } | null = null
  if (status.state === 'unsupported') line = { text: status.reason }
  else if (status.state === 'checking') line = { text: 'Checking for updates…' }
  else if (status.state === 'upToDate') line = { text: 'You have the latest version.', tone: 'ok' }
  else if (status.state === 'downloading') line = { text: `Downloading ${status.version}… ${status.percent}%` }
  else if (status.state === 'ready') line = { text: `Version ${status.version} is ready. It installs when you quit, or now:`, tone: 'ok' }
  else if (status.state === 'error') line = { text: status.message, tone: 'error' }

  return (
    <div className="settings-section desktop-only">
      <h3>Updates</h3>
      <p className="hint">
        Version {update.currentVersion}. New versions come from the{' '}
        <a href={update.releasesUrl} target="_blank" rel="noreferrer">
          GitHub releases
        </a>
        ; the app checks when it starts and downloads them in the background.
      </p>
      <div className="button-row">
        {status.state === 'ready' ? (
          <button className="btn primary" onClick={() => void window.api.updates?.install()}>
            Restart and update
          </button>
        ) : (
          <button className="btn" onClick={() => void window.api.updates?.check()} disabled={busy || status.state === 'unsupported'}>
            {status.state === 'downloading' ? 'Downloading…' : busy ? 'Checking…' : 'Check for updates'}
          </button>
        )}
      </div>
      {line && <div className={`status-line${line.tone ? ` ${line.tone}` : ''}`}>{line.text}</div>}
    </div>
  )
}
