import type { SyncConflict, Task } from '@shared/types'
import { PRIORITY_LABELS } from '../priorityUi'
import { useAppState } from '../state/AppStateContext'

const FIELD_LABELS: Record<string, string> = {
  title: 'Title',
  notes: 'Notes',
  priority: 'Priority',
  completed: 'Completed',
  starred: 'Important',
  dueDate: 'Due date',
  listId: 'List'
}

function fieldValue(task: Task, field: string): string {
  switch (field) {
    case 'priority':
      return PRIORITY_LABELS[task.priority]
    case 'completed':
      return task.completed ? 'Yes' : 'No'
    case 'starred':
      return task.starred ? 'Yes' : 'No'
    case 'dueDate':
      return task.dueDate ? new Date(task.dueDate).toLocaleDateString() : '—'
    case 'notes':
      return task.notes || '—'
    default:
      return String(task[field as keyof Task] ?? '—')
  }
}

export function ConflictModal({ conflict, onClose }: { conflict: SyncConflict; onClose: () => void }) {
  const { resolveConflictKeepLocal, resolveConflictKeepRemote } = useAppState()
  const { local, remote } = conflict
  const fields = ['title', 'notes', 'priority', 'completed', 'starred', 'dueDate'] as const
  const changedFields = fields.filter((f) => fieldValue(local, f) !== fieldValue(remote, f))

  async function keepLocal() {
    await resolveConflictKeepLocal(conflict.taskId)
    onClose()
  }
  async function keepRemote() {
    await resolveConflictKeepRemote(conflict.taskId)
    onClose()
  }

  return (
    <div className="overlay centered" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button className="close-x" onClick={onClose}>
          &#10005;
        </button>
        <h2>Sync conflict</h2>
        <p className="hint">
          This task was edited on two devices before they could sync. Pick which version to keep — the other will be discarded.
        </p>

        {changedFields.length === 0 ? (
          <p className="hint">The two versions differ only in fields not shown here.</p>
        ) : (
          changedFields.map((f) => (
            <div className="diff-row" key={f}>
              <div className="field-name">{FIELD_LABELS[f]}</div>
              <div className="diff-values">
                <div className="diff-value local">This device: {fieldValue(local, f)}</div>
                <div className="diff-value remote">GitHub: {fieldValue(remote, f)}</div>
              </div>
            </div>
          ))
        )}

        <div className="button-row">
          <button className="btn primary" onClick={() => void keepLocal()}>
            Keep this device&apos;s version
          </button>
          <button className="btn" onClick={() => void keepRemote()}>
            Keep GitHub&apos;s version
          </button>
        </div>
      </div>
    </div>
  )
}
