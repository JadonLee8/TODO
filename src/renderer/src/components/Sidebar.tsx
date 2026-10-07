import { useMemo, useState, type FormEvent, type RefObject } from 'react'
import { MAIN_LIST_ID } from '@shared/types'
import { useAppState } from '../state/AppStateContext'
import { TASK_MIME, dropTargetProps } from '../dnd'

export function Sidebar({
  onOpenSettings,
  searchInputRef
}: {
  onOpenSettings: () => void
  searchInputRef: RefObject<HTMLInputElement>
}) {
  const { lists, tasks, view, selectList, setView, setSearchQuery, addList, deleteList, moveTask, starTask } = useAppState()
  const selectedListId = view.kind === 'list' ? view.listId : null
  const [newListName, setNewListName] = useState('')

  const counts = useMemo(() => {
    const map = new Map<string, number>()
    for (const t of tasks) {
      if (t.completed) continue
      map.set(t.listId, (map.get(t.listId) ?? 0) + 1)
    }
    return map
  }, [tasks])
  const importantCount = useMemo(() => tasks.filter((t) => t.starred && !t.completed && !t.archived).length, [tasks])

  const customLists = lists.filter((l) => l.id !== MAIN_LIST_ID).sort((a, b) => a.order - b.order)

  // Which sidebar entry a task is currently being dragged over (list id, or 'important').
  const [dropKey, setDropKey] = useState<string | null>(null)
  const dropClass = (key: string) => (dropKey === key ? ' drop-target' : '')
  const taskDrop = (key: string, onDropId: (id: string) => void) =>
    dropTargetProps(TASK_MIME, (active) => setDropKey((prev) => (active ? key : prev === key ? null : prev)), onDropId)

  async function handleAddList(e: FormEvent) {
    e.preventDefault()
    if (!newListName.trim()) return
    await addList(newListName)
    setNewListName('')
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-title">
        <span className="dot" />
        TODO
      </div>

      <div className="sidebar-search">
        <span className="nav-icon">&#8981;</span>
        <input
          ref={searchInputRef}
          type="search"
          placeholder="Search (Ctrl+F)"
          value={view.kind === 'search' ? view.query : ''}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setSearchQuery('')
              e.currentTarget.blur()
            }
          }}
        />
      </div>

      <button
        className={`nav-item${selectedListId === MAIN_LIST_ID ? ' active' : ''}${dropClass(MAIN_LIST_ID)}`}
        onClick={() => selectList(MAIN_LIST_ID)}
        {...taskDrop(MAIN_LIST_ID, (id) => void moveTask(id, MAIN_LIST_ID))}
      >
        <span className="label">
          <span className="nav-icon">&#9679;</span>
          Tasks
        </span>
        <span className="count">{counts.get(MAIN_LIST_ID) ?? 0}</span>
      </button>

      {/* Dropping a task on Important stars it instead of moving it. */}
      <button
        className={`nav-item${view.kind === 'important' ? ' active' : ''}${dropClass('important')}`}
        onClick={() => setView({ kind: 'important' })}
        {...taskDrop('important', (id) => void starTask(id))}
      >
        <span className="label">
          <span className="nav-icon important-icon">&#9733;</span>
          Important
        </span>
        <span className="count">{importantCount}</span>
      </button>

      <div className="sidebar-divider" />

      <div className="sidebar-section">
        {customLists.map((list) => (
          <div key={list.id} className="list-row">
            <button
              className={`nav-item${selectedListId === list.id ? ' active' : ''}${dropClass(list.id)}`}
              onClick={() => selectList(list.id)}
              {...taskDrop(list.id, (id) => void moveTask(id, list.id))}
            >
              <span className="label">
                <span className="nav-icon">&#9776;</span>
                <span className="label-text">{list.name}</span>
              </span>
              <span className="count">{counts.get(list.id) ?? 0}</span>
            </button>
            <button
              className="list-delete"
              title={`Delete "${list.name}"`}
              onClick={(e) => {
                e.stopPropagation()
                if (confirm(`Delete "${list.name}"? Its tasks will move to Tasks.`)) void deleteList(list.id)
              }}
            >
              &#10005;
            </button>
          </div>
        ))}
      </div>

      <form className="new-list-row" onSubmit={handleAddList}>
        <span className="nav-icon">+</span>
        <input
          type="text"
          placeholder="New list"
          value={newListName}
          onChange={(e) => setNewListName(e.target.value)}
        />
      </form>

      <div className="sidebar-footer">
        <button className="nav-item" onClick={onOpenSettings}>
          <span className="label">
            <span className="nav-icon">&#9881;</span>
            Settings
          </span>
        </button>
      </div>
    </aside>
  )
}
