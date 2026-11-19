import { useState } from 'react'
import type { ObsidianSettings as Options } from '@shared/types'
import { useAppState } from '../../state/AppStateContext'
import { ListSelect } from '../ListSelect'

/** Obsidian's setup (vault folder, per device) and options (synced), shown in the marketplace once installed. */
export function ObsidianSettings() {
  const { localSettings, refreshLocalSettings, syncedSettings, saveSyncedSettings } = useAppState()
  const options = syncedSettings.extensions.obsidian
  const [folder, setFolder] = useState(options.folder)
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null)

  const save = (patch: Partial<Options>) =>
    saveSyncedSettings({ ...syncedSettings, extensions: { ...syncedSettings.extensions, obsidian: { ...options, ...patch } } })

  async function pickVault() {
    const res = await window.api.obsidian.pickVault()
    if (!res.ok) setStatus({ ok: false, message: res.error })
    else if (res.value) setStatus({ ok: true, message: 'Vault set. The next Sync writes your tasks into it.' })
    await refreshLocalSettings()
  }

  async function open(file: 'inbox' | 'base') {
    const res = await window.api.obsidian.open({ file })
    if (!res.ok) setStatus({ ok: false, message: res.error })
  }

  const vault = localSettings.obsidianVaultPath
  const shownFolder = options.folder.trim() || '(vault root)'

  return (
    <div className="extension-settings">
      <div className="field">
        <label>Vault on this device</label>
        <div className="path-row">
          <code className="path">{vault || 'Not set'}</code>
          <button className="btn small" onClick={() => void pickVault()}>
            {vault ? 'Change…' : 'Choose vault…'}
          </button>
        </div>
        <p className="hint field-hint">
          If the vault itself syncs between computers (Google Drive, Obsidian Sync), set it on one computer only, so one app writes the notes.
        </p>
      </div>

      <div className="field">
        <label>Folder in the vault</label>
        <input
          type="text"
          placeholder="TODO"
          value={folder}
          onChange={(e) => setFolder(e.target.value)}
          onBlur={() => folder !== options.folder && void save({ folder: folder.trim() })}
        />
        <p className="hint field-hint">
          Notes go in <code>{shownFolder}/Tasks/</code>, with a <code>Tasks.base</code> table view and an <code>Inbox.md</code>. Text you add
          under “Vault notes” in a task’s note is kept.
        </p>
      </div>

      <label className="checkbox-field">
        <input type="checkbox" checked={options.includeCompleted} onChange={(e) => void save({ includeCompleted: e.target.checked })} />
        Keep notes for completed and archived tasks (a history of finished work)
      </label>

      <label className="checkbox-field">
        <input type="checkbox" checked={options.inboxCapture} onChange={(e) => void save({ inboxCapture: e.target.checked })} />
        Turn unchecked items in Inbox.md into tasks on Sync
      </label>
      {options.inboxCapture && (
        <div className="field">
          <label>Add inbox tasks to</label>
          <ListSelect value={options.inboxListId} onChange={(id) => void save({ inboxListId: id })} />
          <p className="hint field-hint">
            Write <code>- [ ] Call the bank #p1 📅 2026-12-01</code>. #p1 to #p5 set the priority; the 📅 date is the due date.
          </p>
        </div>
      )}

      {vault && (
        <div className="button-row">
          <button className="btn small" onClick={() => void open('inbox')}>
            Open Inbox in Obsidian
          </button>
          <button className="btn small" onClick={() => void open('base')}>
            Open Tasks base
          </button>
        </div>
      )}
      {status && <div className={`status-line ${status.ok ? 'ok' : 'error'}`}>{status.message}</div>}
    </div>
  )
}
