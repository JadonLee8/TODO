import { useMemo, useState } from 'react'
import type { Task } from '@shared/types'
import { MAIN_LIST_ID } from '@shared/types'
import { rankTasks } from '@shared/ranking'
import { searchTasks } from '@shared/search'
import { useAppState, type View } from '../state/AppStateContext'
import { AddTaskBar } from './AddTaskBar'
import { TaskRow } from './TaskRow'

export function TaskListView({
  view,
  onOpenTask,
  onOpenConflict
}: {
  view: View
  onOpenTask: (task: Task) => void
  onOpenConflict: (taskId: string) => void
}) {
  const { tasks, lists, syncedSettings, conflicts, toggleComplete, toggleStarred } = useAppState()
  const [showCompleted, setShowCompleted] = useState(false)

  const viewTasks = useMemo(() => {
    if (view.kind === 'search') return searchTasks(tasks, view.query)
    return tasks.filter((t) => t.listId === view.listId && !t.archived)
  }, [tasks, view])
  const active = useMemo(() => viewTasks.filter((t) => !t.completed), [viewTasks])
  const completed = useMemo(() => viewTasks.filter((t) => t.completed), [viewTasks])

  // The main list and search results (which span lists) are priority-ranked; other lists sort by creation date.
  const ranked = view.kind === 'search' || view.listId === MAIN_LIST_ID
  const ordered = useMemo(() => {
    if (ranked) return rankTasks(active, syncedSettings.ranking)
    return [...active].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
  }, [active, ranked, syncedSettings.ranking])

  const conflictById = useMemo(() => new Map(conflicts.map((c) => [c.taskId, c])), [conflicts])
  const listNameById = useMemo(() => new Map(lists.map((l) => [l.id, l.name])), [lists])

  function handleClick(task: Task) {
    if (conflictById.has(task.id)) onOpenConflict(task.id)
    else onOpenTask(task)
  }

  function renderRow(task: Task) {
    return (
      <TaskRow
        key={task.id}
        task={task}
        conflicted={conflictById.has(task.id)}
        listName={view.kind === 'search' ? listNameById.get(task.listId) ?? 'Tasks' : undefined}
        onClick={() => handleClick(task)}
        onToggleComplete={() => void toggleComplete(task)}
        onToggleStar={() => void toggleStarred(task)}
      />
    )
  }

  return (
    <div className="task-scroll">
      {view.kind === 'list' && <AddTaskBar listId={view.listId} />}

      {ordered.length === 0 && completed.length === 0 && (
        <div className="empty-state">
          {view.kind === 'search' ? `No tasks match "${view.query}".` : 'Nothing here yet. Add a task above.'}
        </div>
      )}

      {ordered.map(renderRow)}

      {completed.length > 0 && (
        <>
          <div className="section-heading" onClick={() => setShowCompleted((v) => !v)}>
            <span>{showCompleted ? '▾' : '▸'}</span>
            Completed ({completed.length})
          </div>
          {showCompleted && completed.map(renderRow)}
        </>
      )}
    </div>
  )
}
