import { useState } from 'react'
import type { Priority, Task } from '@shared/types'
import { isInstalled } from '@shared/extensions'
import { useAppState } from '../state/AppStateContext'
import { PriorityPicker } from './PriorityPicker'
import { ListSelect } from './ListSelect'
import { useConfirm } from './ConfirmDialog'

export function TaskDetailPanel({ task, onClose }: { task: Task; onClose: () => void }) {
  const { updateTask, deleteTask, toggleComplete, toggleStarred, syncedSettings, localSettings } = useAppState()
  const [title, setTitle] = useState(task.title)
  const [notes, setNotes] = useState(task.notes)
  const [obsidianError, setObsidianError] = useState<string | null>(null)
  const confirm = useConfirm()
  const inVault = isInstalled(syncedSettings.extensions, 'obsidian') && !!localSettings.obsidianVaultPath

  async function openInObsidian() {
    const res = await window.api.obsidian.open({ taskId: task.id })
    setObsidianError(res.ok ? null : res.error)
  }

  function commitTitle() {
    if (title.trim() && title !== task.title) void updateTask({ ...task, title: title.trim() })
  }
  function commitNotes() {
    if (notes !== task.notes) void updateTask({ ...task, notes })
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="panel" onClick={(e) => e.stopPropagation()}>
        <button className="close-x" onClick={onClose} aria-label="Close">
          &#10005;
        </button>

        <div className="field">
          <label>Title</label>
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} onBlur={commitTitle} />
        </div>

        <div className="field">
          <label>Priority</label>
          <PriorityPicker value={task.priority} onChange={(p: Priority) => void updateTask({ ...task, priority: p })} />
        </div>

        <div className="field">
          <label>List</label>
          <ListSelect value={task.listId} onChange={(listId) => void updateTask({ ...task, listId })} />
        </div>

        <div className="field">
          <label>Due date</label>
          <input
            type="date"
            value={task.dueDate ? task.dueDate.slice(0, 10) : ''}
            onChange={(e) => void updateTask({ ...task, dueDate: e.target.value ? new Date(e.target.value).toISOString() : null })}
          />
        </div>

        <div className="field">
          <label>Notes</label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={commitNotes} />
        </div>

        {task.source?.type === 'google_calendar' && (
          <div className="source-line">
            📅 Imported from Google Calendar
            {/* Opened in the system browser by the main window's open handler. */}
            {task.source.htmlLink && (
              <a href={task.source.htmlLink} target="_blank" rel="noreferrer">
                Open in Google Calendar
              </a>
            )}
          </div>
        )}
        {task.source?.type === 'obsidian_inbox' && <div className="source-line">Captured from {task.source.notePath} in Obsidian</div>}
        {task.source?.type === 'microsoft_todo' && <div className="source-line">Imported from “{task.source.listName}” in Microsoft To Do</div>}
        {inVault && (
          <div className="source-line">
            <button className="link-button" onClick={() => void openInObsidian()}>
              Open note in Obsidian
            </button>
            {obsidianError && <span className="status-line error">{obsidianError}</span>}
          </div>
        )}

        <div className="button-row">
          <button className="btn" onClick={() => void toggleComplete(task)}>
            {task.completed ? 'Mark not complete' : 'Mark complete'}
          </button>
          <button className="btn" onClick={() => void toggleStarred(task)}>
            {task.starred ? 'Unmark important' : 'Mark important'}
          </button>
        </div>
        <div className="button-row">
          <button
            className="btn danger"
            onClick={async () => {
              const ok = await confirm({
                title: `Delete “${task.title}”?`,
                message: 'You can undo this from Settings › Activity.',
                confirmLabel: 'Delete task',
                tone: 'danger'
              })
              if (!ok) return
              void deleteTask(task.id)
              onClose()
            }}
          >
            Delete task
          </button>
        </div>
      </div>
    </div>
  )
}
