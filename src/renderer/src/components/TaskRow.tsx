import { useEffect, useRef, useState } from 'react'
import type { Task } from '@shared/types'
import { localDateString } from '@shared/calendar'
import { PRIORITY_LABELS } from '../priorityUi'
import { TASK_MIME } from '../dnd'

/** How long the strike-through takes to draw before a completed task leaves the list. */
const COMPLETE_DELAY_MS = 320

export function TaskRow({
  task,
  conflicted,
  listName,
  onClick,
  onToggleComplete,
  onToggleStar
}: {
  task: Task
  conflicted: boolean
  /** Shown next to the title, for views that mix tasks from several lists. */
  listName?: string
  onClick: () => void
  onToggleComplete: () => void
  onToggleStar: () => void
}) {
  const [completing, setCompleting] = useState(false)
  const timer = useRef<number>()
  useEffect(() => () => window.clearTimeout(timer.current), [])

  function handleCheck() {
    if (completing) {
      // A second click while the strike-through is drawing cancels the completion.
      window.clearTimeout(timer.current)
      return setCompleting(false)
    }
    if (task.completed) return onToggleComplete()
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return onToggleComplete()
    setCompleting(true)
    timer.current = window.setTimeout(() => {
      setCompleting(false)
      onToggleComplete()
    }, COMPLETE_DELAY_MS)
  }

  // Due dates are stored as midnight UTC of the due day, so compare and format the UTC date.
  const dueDay = task.dueDate?.slice(0, 10)
  const overdue = !!dueDay && !task.completed && dueDay < localDateString(new Date())
  const done = task.completed || completing

  return (
    <div
      className={`task-row p${task.priority}${conflicted ? ' conflicted' : ''}${task.completed ? ' completed' : ''}${completing ? ' completing' : ''}`}
      onClick={onClick}
      // Conflicted tasks can't be dragged: moving one would stack another edit on an unresolved conflict.
      draggable={!conflicted}
      onDragStart={(e) => {
        e.dataTransfer.setData(TASK_MIME, task.id)
        e.dataTransfer.effectAllowed = 'move'
      }}
    >
      <span className="task-priority" data-tooltip={`Priority ${task.priority}`}>
        {PRIORITY_LABELS[task.priority]}
      </span>

      <button
        className={`checkbox${done ? ' checked' : ''}`}
        onClick={(e) => {
          e.stopPropagation()
          handleCheck()
        }}
        data-tooltip={task.completed ? 'Mark as not done' : 'Mark as done'}
        aria-label={task.completed ? `Mark “${task.title}” as not done` : `Mark “${task.title}” as done`}
        aria-pressed={done}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
          <path d="M1.5 5.2 4 7.6l4.5-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      <span className="task-title">
        <span className="task-title-text">{task.title}</span>
      </span>

      {listName && <span className="list-tag">{listName}</span>}
      {conflicted && <span className="conflict-badge">Sync conflict</span>}
      {task.source?.type === 'google_calendar' && (
        <span className="task-meta" data-tooltip="Imported from Google Calendar">
          📅
        </span>
      )}
      {dueDay && !conflicted && (
        <span className={`task-meta due${overdue ? ' overdue' : ''}`} data-tooltip={overdue ? 'Overdue' : 'Due date'}>
          {formatDueDate(task.dueDate!)}
        </span>
      )}

      <button
        className={`star-button${task.starred ? ' starred' : ''}`}
        onClick={(e) => {
          e.stopPropagation()
          onToggleStar()
        }}
        data-tooltip={task.starred ? 'Unmark important' : 'Mark important'}
        aria-label={task.starred ? `Unmark “${task.title}” as important` : `Mark “${task.title}” as important`}
        aria-pressed={task.starred}
      >
        {task.starred ? '★' : '☆'}
      </button>
    </div>
  )
}

/** "Oct 7", with the year only when it isn't this year. */
export function formatDueDate(iso: string): string {
  const date = new Date(iso)
  const thisYear = date.getUTCFullYear() === new Date().getFullYear()
  return date.toLocaleDateString(undefined, { timeZone: 'UTC', month: 'short', day: 'numeric', ...(thisYear ? {} : { year: 'numeric' }) })
}
