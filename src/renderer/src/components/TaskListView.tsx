import { useMemo, useState, type ReactNode } from 'react'
import type { Task } from '@shared/types'
import { MAIN_LIST_ID } from '@shared/types'
import { orderPlainList, rankTasks } from '@shared/ranking'
import { searchTasks } from '@shared/search'
import { useAppState, type View } from '../state/AppStateContext'
import { AddTaskBar } from './AddTaskBar'
import { TaskRow } from './TaskRow'
import { BoardView } from './BoardView'
import { ContentHeader } from './ContentHeader'

type Layout = 'list' | 'board'
/** List or board is a per-device preference, like collapsed folders. */
const LAYOUT_KEY = 'todo.layout'

function loadLayout(): Layout {
  try {
    return localStorage.getItem(LAYOUT_KEY) === 'board' ? 'board' : 'list'
  } catch {
    return 'list'
  }
}

export function TaskListView({
  view,
  title,
  status,
  actions,
  onOpenTask,
  onOpenConflict
}: {
  /** Every view but stats. */
  view: Exclude<View, { kind: 'stats' }>
  title: string
  /** A line under the summary, e.g. the last sync result. */
  status?: ReactNode
  actions?: ReactNode
  onOpenTask: (task: Task) => void
  onOpenConflict: (taskId: string) => void
}) {
  const { tasks, lists, syncedSettings, conflicts, toggleComplete, toggleStarred } = useAppState()
  const [showCompleted, setShowCompleted] = useState(false)
  const [layout, setLayoutState] = useState<Layout>(loadLayout)
  const setLayout = (next: Layout) => {
    setLayoutState(next)
    try {
      localStorage.setItem(LAYOUT_KEY, next)
    } catch {
      // Not remembering the layout is harmless.
    }
  }
  // Search results are always a list.
  // The board is drag-based, so the phone always shows a list.
  const board = layout === 'board' && view.kind !== 'search' && window.api.platform === 'desktop'

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

  const matches = ordered.length + completed.length
  const summary =
    view.kind === 'search'
      ? `${matches} ${matches === 1 ? 'match' : 'matches'} for “${view.query.trim()}”`
      : ordered.length
        ? `${ordered.length} left`
        : completed.length
          ? 'All done'
          : ''

  const layoutToggle = view.kind !== 'search' && (
    <div className="segmented desktop-only" role="tablist" aria-label="Layout">
      {(['list', 'board'] as const).map((l) => (
        <button key={l} role="tab" aria-selected={layout === l} className={layout === l ? 'on' : ''} onClick={() => setLayout(l)}>
          {l === 'list' ? 'List' : 'Board'}
        </button>
      ))}
    </div>
  )

  return (
    <>
      <ContentHeader
        title={title}
        summary={summary}
        status={status}
        actions={
          <>
            {layoutToggle}
            {actions}
          </>
        }
      />

      <div className={`task-scroll${board ? ' board-scroll' : ''}`}>
        {view.kind === 'list' && <AddTaskBar listId={view.listId} />}
        {/* Tasks added from Important go into the main Tasks list, already starred. */}
        {view.kind === 'important' && <AddTaskBar listId={MAIN_LIST_ID} starred />}

        {board && (
          <BoardView
            active={ordered}
            completed={completed}
            conflictById={conflictById}
            listNameById={listNameById}
            showListNames={mixesLists}
            onOpen={handleClick}
          />
        )}

        {!board && ordered.length === 0 && completed.length === 0 && (
          <div className="empty-state">
            {view.kind === 'search'
              ? 'Nothing matches. Search looks in task titles and notes.'
              : view.kind === 'important'
                ? 'Star a task with ☆ to keep it here.'
                : 'Type a task above and press Enter.'}
          </div>
        )}

        {!board && ordered.map(renderRow)}

        {!board && completed.length > 0 && (
          <>
            <button className="section-heading" onClick={() => setShowCompleted((v) => !v)} aria-expanded={showCompleted}>
              <svg className={`folder-chevron${showCompleted ? ' open' : ''}`} width="10" height="10" viewBox="0 0 10 10" aria-hidden>
                <path d="M3.5 1.5 7 5l-3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Completed ({completed.length})
            </button>
            {showCompleted && completed.map(renderRow)}
          </>
        )}
      </div>
    </>
  )
}
