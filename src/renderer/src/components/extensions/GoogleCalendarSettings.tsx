import { useEffect, useState } from 'react'
import type { CalendarSettings, GoogleCalendarInfo, Priority } from '@shared/types'
import { useAppState } from '../../state/AppStateContext'
import { PriorityPicker } from '../PriorityPicker'
import { ListSelect } from '../ListSelect'

/** Google Calendar's setup and options, shown in the marketplace once it's installed. */
export function GoogleCalendarSettings() {
  const { localSettings, saveLocalSettings, refreshLocalSettings, syncedSettings, saveSyncedSettings } = useAppState()
  const calendar = syncedSettings.extensions.googleCalendar

  const [clientId, setClientId] = useState(localSettings.googleClientId)
  const [secretInput, setSecretInput] = useState('')
  const [connecting, setConnecting] = useState(false)
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null)
  const [calendars, setCalendars] = useState<GoogleCalendarInfo[] | null>(null)
  const [daysAhead, setDaysAhead] = useState(calendar.daysAhead)

  useEffect(() => {
    if (!localSettings.googleConnected) {
      setCalendars(null)
      return
    }
    void window.api.calendar.listCalendars().then((res) => {
      if (res.ok) setCalendars(res.value)
      else setStatus({ ok: false, message: res.error })
      // A failed refresh can clear the connection (e.g. revoked access), so re-read it.
      if (!res.ok) void refreshLocalSettings()
    })
  }, [localSettings.googleConnected, refreshLocalSettings])

  const saveCalendar = (patch: Partial<CalendarSettings>) =>
    saveSyncedSettings({ ...syncedSettings, extensions: { ...syncedSettings.extensions, googleCalendar: { ...calendar, ...patch } } })

  async function handleSaveSecret() {
    if (!secretInput.trim()) return
    await window.api.calendar.saveClientSecret(secretInput.trim())
    setSecretInput('')
    await refreshLocalSettings()
  }

  async function handleConnect() {
    setConnecting(true)
    setStatus({ ok: true, message: 'Finish signing in in your browser…' })
    const res = await window.api.calendar.connect()
    setConnecting(false)
    setStatus(res.ok ? { ok: true, message: 'Connected to Google Calendar.' } : { ok: false, message: res.error })
    await refreshLocalSettings()
  }

  async function handleDisconnect() {
    await window.api.calendar.disconnect()
    setStatus(null)
    await refreshLocalSettings()
  }

  function toggleCalendar(id: string, on: boolean) {
    const ids = on ? [...calendar.calendarIds, id] : calendar.calendarIds.filter((c) => c !== id)
    void saveCalendar({ calendarIds: ids })
  }

  const canConnect = !!localSettings.googleClientId && localSettings.hasGoogleClientSecret

  return (
    <div className="extension-settings">
      <p className="hint">
        Uses your own Google Cloud OAuth client (type “Desktop app”); the README has the setup steps. Only devices you connect here run the
        import.
      </p>

      <div className="field">
        <label>OAuth client ID</label>
        <input
          type="text"
          placeholder="1234-abc.apps.googleusercontent.com"
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          onBlur={(e) => void saveLocalSettings({ googleClientId: e.target.value.trim() })}
        />
      </div>
      <div className="field">
        <label>OAuth client secret {localSettings.hasGoogleClientSecret ? '(saved — encrypted on this device)' : '(not set)'}</label>
        <input type="password" placeholder="GOCSPX-..." value={secretInput} onChange={(e) => setSecretInput(e.target.value)} />
      </div>

      <div className="button-row">
        <button className="btn" onClick={() => void handleSaveSecret()} disabled={!secretInput.trim()}>
          Save secret
        </button>
        {localSettings.googleConnected ? (
          <button className="btn danger" onClick={() => void handleDisconnect()}>
            Disconnect
          </button>
        ) : (
          <button className="btn primary" onClick={() => void handleConnect()} disabled={!canConnect || connecting}>
            {connecting ? 'Connecting…' : 'Connect'}
          </button>
        )}
      </div>
      {status && <div className={`status-line ${status.ok ? 'ok' : 'error'}`}>{status.message}</div>}

      {localSettings.googleConnected && (
        <div className="calendar-options">
          <div className="field">
            <label>Calendars to import</label>
            {calendars === null ? (
              <div className="hint">Loading calendars…</div>
            ) : (
              <div className="calendar-list">
                {calendars.map((c) => (
                  <label key={c.id} className="checkbox-field">
                    <input type="checkbox" checked={calendar.calendarIds.includes(c.id)} onChange={(e) => toggleCalendar(c.id, e.target.checked)} />
                    <span className="calendar-swatch" style={{ background: c.backgroundColor ?? '#999' }} />
                    {c.summary}
                    {c.primary && <span className="hint"> (primary)</span>}
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="field">
            <label>Add imported tasks to</label>
            <ListSelect value={calendar.targetListId} onChange={(id) => void saveCalendar({ targetListId: id })} />
          </div>

          <div className="field">
            <label>Import events this many days ahead</label>
            <input
              type="text"
              inputMode="numeric"
              value={daysAhead}
              onChange={(e) => setDaysAhead(Number(e.target.value) || 0)}
              onBlur={() => void saveCalendar({ daysAhead: Math.max(0, daysAhead) })}
            />
          </div>

          <div className="field">
            <label>Priority for imported tasks</label>
            <PriorityPicker value={calendar.defaultPriority} onChange={(p: Priority) => void saveCalendar({ defaultPriority: p })} />
          </div>

          <label className="checkbox-field">
            <input type="checkbox" checked={calendar.promoteOverdue} onChange={(e) => void saveCalendar({ promoteOverdue: e.target.checked })} />
            Move imported tasks to P1 once they're overdue
          </label>
        </div>
      )}
    </div>
  )
}
