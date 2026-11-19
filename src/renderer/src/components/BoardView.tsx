import { useState } from 'react'
import type { Priority, SyncConflict, Task } from '@shared/types'
import { localDateString } from '@shared/calendar'
import { useAppState } from '../state/AppStateContext'
import { PRIORITIES, PRIORITY_LABELS } from '../priorityUi'
import { TASK_MIME, dropTargetProps } from '../dnd'
import { formatDueDate } from './TaskRow'

/** Done shows only the most recent completions, so the column stays readable. */
const DONE_LIMIT = 30

/**
 * The board layout of a list: one column per priority plus Done. Dragging a card to another column changes its
 * priority, dragging it to Done completes it, and dragging it out of Done reopens it.
 */
export function BoardView({
  active,
  completed,
  conflictById,
  listNameById,
  showListNames,
  onOpen
}: {
  /** Already in display order. */
  active: Task[]
  completed: Task[]
  conflictById: Map<string, SyncConflict>
  listNameById: Map<string, string>
  showListNames: boolean
  onOpen: (task: Task) => void
}) {
  const { tasks, updateTask } = useAppState()
  const [over, setOver] = useState<string | null>(null)
  const done = [...completed].sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? '')).slice(0, DONE_LIMIT)

  function dropOn(column: Priority | 'done') {
    return dropTargetProps(
      TASK_MIME,
      (on) => setOver((prev) => (on ? String(column) : prev === String(column) ? null : prev)),
      (id) => {
        const task = tasks.find((t) => t.id === id)
        if (!task || conflictById.has(id)) return
        if (column === 'done') {
          if (!task.completed) void updateTask({ ...task, completed: true, completedAt: new Date().toISOString() })
        } else if (task.completed || task.priority !== column) {
          void updateTask({ ...task, priority: column, completed: false, completedAt: null })
        }
      }
    )
  }

  const card = (task: Task) => {
    const conflicted = conflictById.has(task.id)
    const due = task.dueDate?.slice(0, 10)
    const overdue = !!due && !task.completed && due < localDateString(new Date())
    return (
      <button
        key={task.id}
        className={`board-card p${task.priority}${task.completed ? ' completed' : ''}${conflicted ? ' conflicted' : ''}`}
        onClick={() => onOpen(task)}
        draggable={!conflicted}
        onDragStart={(e) => {
          e.dataTransfer.setData(TASK_MIME, task.id)
          e.dataTransfer.effectAllowed = 'move'
        }}
      >
        <span className="board-card-title">
          {task.starred && <span className="board-star" aria-label="Important">★ </span>}
          {task.title}
        </span>
        {(showListNames || due || conflicted) && (
          <span className="board-card-meta">
            {conflicted && <span className="conflict-badge">Sync conflict</span>}
            {showListNames && <span className="list-tag">{listNameById.get(task.listId) ?? 'Tasks'}</span>}
            {due && <span className={`task-meta due${overdue ? ' overdue' : ''}`}>{formatDueDate(task.dueDate!)}</span>}
          </span>
        )}
      </button>
    )
  }

  return (
    <div className="board">
      {PRIORITIES.map((p) => {
        const column = active.filter((t) => t.priority === p)
        return (
          <section key={p} className={`board-column${over === String(p) ? ' drop-target' : ''}`} {...dropOn(p)} aria-label={`Priority ${p}`}>
            <h2 className="board-heading">
              <span className={`board-priority p${p}`}>{PRIORITY_LABELS[p]}</span>
              <span className="count">{column.length}</span>
            </h2>
            <div className="board-cards">{column.map(card)}</div>
          </section>
        )
      })}
      <section className={`board-column done${over === 'done' ? ' drop-target' : ''}`} {...dropOn('done')} aria-label="Done">
        <h2 className="board-heading">
          <span className="board-priority">Done</span>
          <span className="count">{completed.length}</span>
        </h2>
        <div className="board-cards">{done.map(card)}</div>
      </section>
    </div>
  )
}
