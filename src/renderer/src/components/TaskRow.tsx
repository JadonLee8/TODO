import type { Task } from '@shared/types'
import { PRIORITY_COLORS } from '../priorityUi'

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
    <div className={`task-row${conflicted ? ' conflicted' : ''}${task.completed ? ' completed' : ''}`} onClick={onClick}>
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
      {task.dueDate && !conflicted && <span className="task-meta">{new Date(task.dueDate).toLocaleDateString()}</span>}

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
