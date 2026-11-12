import { useMemo, useState } from 'react'
import type { ActivityEntry } from '@shared/activity'
import { useAppState } from '../state/AppStateContext'
import { useConfirm } from './ConfirmDialog'

/** Changes made on this device, newest first, each with an Undo button. */
export function ActivityModal({ onClose }: { onClose: () => void }) {
  const { activity, undoActivity, activityConflicts, localSettings } = useAppState()
  const confirm = useConfirm()
  const [busy, setBusy] = useState<string | null>(null)

  const days = useMemo(() => groupByDay(activity), [activity])
  const { githubOwner: owner, githubRepo: repo, githubBranch: branch } = localSettings
  const historyUrl = owner && repo ? `https://github.com/${owner}/${repo}/commits/${branch || 'main'}` : null

  async function handleUndo(entry: ActivityEntry) {
    const changed = activityConflicts(entry)
    const redo = isRedo(entry)
    if (changed.length) {
      const ok = await confirm({
        title: redo ? 'Redo this change?' : 'Undo this change?',
        message: (
          <>
            {changed.join(', ')} {changed.length === 1 ? 'has' : 'have'} changed since. {redo ? 'Redoing' : 'Undoing'} will also discard those
            later changes.
          </>
        ),
        confirmLabel: redo ? 'Redo anyway' : 'Undo anyway',
        tone: 'danger'
      })
      if (!ok) return
    }
    setBusy(entry.id)
    try {
      await undoActivity(entry.id)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="overlay centered" onClick={onClose}>
      <div className="modal activity-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-labelledby="activity-title">
        <button className="close-x" onClick={onClose} aria-label="Close">
          &#10005;
        </button>
        <h2 id="activity-title">Activity</h2>
        <p className="hint">
          Changes made in the app on this device. Undoing a change saves it as a new change, which goes to GitHub as its own commit on the next
          sync. Nothing in your history is rewritten.
        </p>

        {activity.length === 0 && <p className="activity-empty">Nothing yet. Changes you make show up here.</p>}

        {days.map(({ label, entries }) => (
          <section key={label} className="activity-day">
            <h3>{label}</h3>
            <ul>
              {entries.map((entry) => (
                <li key={entry.id} className={`activity-entry${entry.undoneBy ? ' undone' : ''}`}>
                  <time dateTime={entry.at}>{new Date(entry.at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</time>
                  <span className="activity-summary">{entry.summary}</span>
                  {entry.undoneBy ? (
                    <span className="activity-status">Undone</span>
                  ) : (
                    <button className="btn small" disabled={busy !== null} onClick={() => void handleUndo(entry)}>
                      {busy === entry.id ? 'Working…' : isRedo(entry) ? 'Redo' : 'Undo'}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}

        <p className="hint activity-footer">
          The log keeps your last 300 changes on this device. Every synced change, from any device, is also a commit in your tasks repo
          {historyUrl ? (
            <>
              :{' '}
              <a href={historyUrl} target="_blank" rel="noreferrer">
                open the commit history on GitHub
              </a>
              .
            </>
          ) : (
            '.'
          )}
        </p>
      </div>
    </div>
  )
}

/** Undoing an "Undid: …" entry puts the original change back. */
function isRedo(entry: ActivityEntry): boolean {
  return entry.summary.startsWith('Undid: ')
}

function groupByDay(entries: ActivityEntry[]): { label: string; entries: ActivityEntry[] }[] {
  const groups: { label: string; entries: ActivityEntry[] }[] = []
  const today = new Date()
  const yesterday = new Date(today.getTime() - 86400000)
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString()
  for (const entry of entries) {
    const d = new Date(entry.at)
    const label = sameDay(d, today)
      ? 'Today'
      : sameDay(d, yesterday)
        ? 'Yesterday'
        : d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })
    const last = groups[groups.length - 1]
    if (last?.label === label) last.entries.push(entry)
    else groups.push({ label, entries: [entry] })
  }
  return groups
}
