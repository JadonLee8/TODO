import { useMemo, useState } from 'react'
import type { Task } from '@shared/types'
import { MAIN_LIST_ID } from '@shared/types'
import { rankTasks } from '@shared/ranking'
import { useAppState } from '../state/AppStateContext'
import { AddTaskBar } from './AddTaskBar'
import { TaskRow } from './TaskRow'

export function TaskListView({
  listId,
  onOpenTask,
  onOpenConflict
}: {
  listId: string
  onOpenTask: (task: Task) => void
  onOpenConflict: (taskId: string) => void
}) {
  const { tasks, syncedSettings, conflicts, toggleComplete, toggleStarred } = useAppState()
  const [showCompleted, setShowCompleted] = useState(false)

  const listTasks = useMemo(() => tasks.filter((t) => t.listId === listId && !t.archived), [tasks, listId])
  const active = useMemo(() => listTasks.filter((t) => !t.completed), [listTasks])
  const completed = useMemo(() => listTasks.filter((t) => t.completed), [listTasks])

  const ordered = useMemo(() => {
    if (listId === MAIN_LIST_ID) return rankTasks(active, syncedSettings.ranking)
    return [...active].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
  }, [active, listId, syncedSettings.ranking])

  const conflictById = useMemo(() => new Map(conflicts.map((c) => [c.taskId, c])), [conflicts])

  function handleClick(task: Task) {
    if (conflictById.has(task.id)) onOpenConflict(task.id)
    else onOpenTask(task)
  }

  return (
    <div className="task-scroll">
      <AddTaskBar listId={listId} />

      {ordered.length === 0 && completed.length === 0 && <div className="empty-state">Nothing here yet. Add a task above.</div>}

      {ordered.map((task) => (
        <TaskRow
          key={task.id}
          task={task}
          conflicted={conflictById.has(task.id)}
          onClick={() => handleClick(task)}
          onToggleComplete={() => void toggleComplete(task)}
          onToggleStar={() => void toggleStarred(task)}
        />
      ))}

      {completed.length > 0 && (
        <>
          <div className="section-heading" onClick={() => setShowCompleted((v) => !v)}>
            <span>{showCompleted ? '▾' : '▸'}</span>
            Completed ({completed.length})
          </div>
          {showCompleted &&
            completed.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                conflicted={conflictById.has(task.id)}
                onClick={() => handleClick(task)}
                onToggleComplete={() => void toggleComplete(task)}
                onToggleStar={() => void toggleStarred(task)}
              />
            ))}
        </>
      )}
    </div>
  )
}
