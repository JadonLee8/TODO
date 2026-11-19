import { useEffect, useState } from 'react'
import type { MicrosoftTodoAccount, MicrosoftTodoSettings as Options, Priority } from '@shared/types'
import { useAppState } from '../../state/AppStateContext'
import { PriorityPicker } from '../PriorityPicker'

/** Microsoft To Do's setup (which signed-in account, per device) and options (synced), shown once it's installed. */
export function MicrosoftTodoSettings() {
  const { localSettings, saveLocalSettings, syncedSettings, saveSyncedSettings } = useAppState()
  const options = syncedSettings.extensions.microsoftTodo
  const [accounts, setAccounts] = useState<MicrosoftTodoAccount[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void window.api.microsoftTodo.listAccounts().then((res) => {
      if (res.ok) setAccounts(res.value)
      else setError(res.error)
    })
  }, [])

  const save = (patch: Partial<Options>) =>
    saveSyncedSettings({ ...syncedSettings, extensions: { ...syncedSettings.extensions, microsoftTodo: { ...options, ...patch } } })

  const selected = localSettings.microsoftTodoAccountId

  return (
    <div className="extension-settings">
      <p className="hint">
        Reads the Microsoft To Do app installed on this PC. Sync it in Microsoft To Do first so it has your latest tasks; it doesn’t need to be
        closed.
      </p>

      <div className="field">
        <label>Account to import</label>
        {error ? (
          <div className="status-line error">{error}</div>
        ) : accounts === null ? (
          <div className="hint">Looking for Microsoft To Do…</div>
        ) : accounts.length === 0 ? (
          <div className="hint">No signed-in accounts found. Sign in to Microsoft To Do, let it sync, then reopen this page.</div>
        ) : (
          <div className="option-list" role="radiogroup" aria-label="Microsoft To Do account">
            {accounts.map((a) => (
              <button
                key={a.id}
                role="radio"
                aria-checked={a.id === selected}
                className={`option${a.id === selected ? ' selected' : ''}`}
                onClick={() => void saveLocalSettings({ microsoftTodoAccountId: a.id })}
              >
                <span className="option-text">
                  <span className="option-name">
                    {a.lists} list{a.lists === 1 ? '' : 's'} · {a.openTasks} open · {a.completedTasks} completed
                  </span>
                  <span className="option-description">{a.listNames.length ? a.listNames.join(', ') : 'Only the Tasks list'}</span>
                </span>
              </button>
            ))}
          </div>
        )}
        <p className="hint field-hint">Each account signed in to Microsoft To Do appears here, described by what it holds.</p>
      </div>

      <label className="checkbox-field">
        <input type="checkbox" checked={options.includeCompleted} onChange={(e) => void save({ includeCompleted: e.target.checked })} />
        Import completed tasks too (ones finished more than {syncedSettings.archive.archiveAfterDays} days ago go straight to the archive)
      </label>

      <div className="field">
        <label>Priority for imported tasks</label>
        <PriorityPicker value={options.defaultPriority} onChange={(p: Priority) => void save({ defaultPriority: p })} />
      </div>

      <p className="hint">
        Your Tasks list goes into Tasks; groups become folders; a list with the same name as one you have is merged into it. Important tasks
        are starred and steps become a checklist in the notes. Flagged emails are skipped. Each task is imported once, so editing or deleting
        it here never brings it back.
      </p>
    </div>
  )
}
