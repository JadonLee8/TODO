import type { Task } from '@shared/types'
import { PRIORITY_COLORS } from '../priorityUi'
import { TASK_MIME } from '../dnd'

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
  /** Shown as a small tag, for views that mix tasks from several lists. */
  listName?: string
  onClick: () => void
  onToggleComplete: () => void
  onToggleStar: () => void
}) {
  return (
    <div
      className={`task-row${conflicted ? ' conflicted' : ''}${task.completed ? ' completed' : ''}`}
      onClick={onClick}
      // Conflicted tasks can't be dragged: moving one would stack another edit on an unresolved conflict.
      draggable={!conflicted}
      onDragStart={(e) => {
        e.dataTransfer.setData(TASK_MIME, task.id)
        e.dataTransfer.effectAllowed = 'move'
      }}
    >
      <button
        className={`checkbox${task.completed ? ' checked' : ''}`}
        onClick={(e) => {
          e.stopPropagation()
          onToggleComplete()
        }}
        title={task.completed ? 'Mark as not complete' : 'Mark as complete'}
      >
        {task.completed ? '✓' : ''}
      </button>

      {!task.completed && <span className="priority-dot" style={{ background: PRIORITY_COLORS[task.priority] }} title={`P${task.priority}`} />}

      <span className="task-title">{task.title}</span>

      {listName && <span className="list-tag">{listName}</span>}

      {conflicted && <span className="conflict-badge">SYNC CONFLICT</span>}
      {task.source?.type === 'google_calendar' && (
        <span className="task-meta" title="Imported from Google Calendar">
          📅
        </span>
      )}
      {/* Due dates are stored as midnight UTC of the due day, so format in UTC to show that day everywhere. */}
      {task.dueDate && !conflicted && <span className="task-meta">{new Date(task.dueDate).toLocaleDateString(undefined, { timeZone: 'UTC' })}</span>}

      <button
        className={`star-button${task.starred ? ' starred' : ''}`}
        onClick={(e) => {
          e.stopPropagation()
          onToggleStar()
        }}
        title={task.starred ? 'Unmark important' : 'Mark important'}
      >
        {task.starred ? '★' : '☆'}
      </button>
    </div>
  )
}
