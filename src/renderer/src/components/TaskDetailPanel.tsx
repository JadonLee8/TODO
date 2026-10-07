import { useState } from 'react'
import type { Priority, Task } from '@shared/types'
import { MAIN_LIST_ID } from '@shared/types'
import { useAppState } from '../state/AppStateContext'
import { PriorityPicker } from './PriorityPicker'

export function TaskDetailPanel({ task, onClose }: { task: Task; onClose: () => void }) {
  const { lists, updateTask, deleteTask, toggleComplete, toggleStarred } = useAppState()
  const [title, setTitle] = useState(task.title)
  const [notes, setNotes] = useState(task.notes)

  function commitTitle() {
    if (title.trim() && title !== task.title) void updateTask({ ...task, title: title.trim() })
  }
  function commitNotes() {
    if (notes !== task.notes) void updateTask({ ...task, notes })
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="panel" onClick={(e) => e.stopPropagation()}>
        <button className="close-x" onClick={onClose}>
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
          <select value={task.listId} onChange={(e) => void updateTask({ ...task, listId: e.target.value })}>
            <option value={MAIN_LIST_ID}>Tasks</option>
            {lists
              .filter((l) => l.id !== MAIN_LIST_ID)
              .map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
          </select>
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
            onClick={() => {
              if (confirm('Delete this task?')) {
                void deleteTask(task.id)
                onClose()
              }
            }}
          >
            Delete task
          </button>
        </div>
      </div>
    </div>
  )
}
