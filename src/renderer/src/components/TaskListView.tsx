import { useMemo, useState } from 'react'
import type { Task } from '@shared/types'
import { MAIN_LIST_ID } from '@shared/types'
import { orderPlainList, rankTasks } from '@shared/ranking'
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
    // Important shows only starred tasks that are still to do, so it has no Completed section.
    if (view.kind === 'important') return tasks.filter((t) => t.starred && !t.completed && !t.archived)
    return tasks.filter((t) => t.listId === view.listId && !t.archived)
  }, [tasks, view])
  const active = useMemo(() => viewTasks.filter((t) => !t.completed), [viewTasks])
  const completed = useMemo(() => viewTasks.filter((t) => t.completed), [viewTasks])

  // Views that span lists show each task's list name.
  const mixesLists = view.kind !== 'list'
  // The main list and the cross-list views are priority-ranked; other lists sort by creation date.
  const ranked = mixesLists || view.listId === MAIN_LIST_ID
  const ordered = useMemo(() => {
    if (ranked) return rankTasks(active, syncedSettings.ranking)
    return orderPlainList(active, syncedSettings.ranking)
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
        listName={mixesLists ? listNameById.get(task.listId) ?? 'Tasks' : undefined}
        onClick={() => handleClick(task)}
        onToggleComplete={() => void toggleComplete(task)}
        onToggleStar={() => void toggleStarred(task)}
      />
    )
  }

  return (
    <div className="task-scroll">
      {view.kind === 'list' && <AddTaskBar listId={view.listId} />}
      {/* Tasks added from Important go into the main Tasks list, already starred. */}
      {view.kind === 'important' && <AddTaskBar listId={MAIN_LIST_ID} starred />}

      {ordered.length === 0 && completed.length === 0 && (
        <div className="empty-state">
          {view.kind === 'search'
            ? `No tasks match "${view.query}".`
            : view.kind === 'important'
              ? 'No important tasks. Star a task to see it here.'
              : 'Nothing here yet. Add a task above.'}
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
