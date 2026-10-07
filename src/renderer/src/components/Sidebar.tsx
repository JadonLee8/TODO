import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode, type RefObject } from 'react'
import type { TaskFolder, TaskList } from '@shared/types'
import { MAIN_LIST_ID } from '@shared/types'
import { buildSidebarTree } from '@shared/sidebarTree'
import { useAppState } from '../state/AppStateContext'
import { LIST_MIME, TASK_MIME, dropTargetProps } from '../dnd'

/** Which folders are collapsed is a per-device preference, so it lives in localStorage rather than the repo. */
const COLLAPSED_KEY = 'todo.collapsedFolders'

function loadCollapsed(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? '[]') as string[])
  } catch {
    return new Set()
  }
}

function saveCollapsed(ids: Set<string>): void {
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...ids]))
  } catch {
    // Not being able to remember collapsed folders is harmless.
  }
}

export function Sidebar({
  onOpenSettings,
  searchInputRef
}: {
  onOpenSettings: () => void
  searchInputRef: RefObject<HTMLInputElement>
}) {
  const {
    lists,
    folders,
    tasks,
    view,
    selectList,
    setView,
    setSearchQuery,
    addList,
    renameList,
    deleteList,
    addFolder,
    renameFolder,
    deleteFolder,
    moveListToFolder,
    moveTask,
    starTask
  } = useAppState()
  const selectedListId = view.kind === 'list' ? view.listId : null
  const [newListName, setNewListName] = useState('')
  const [collapsed, setCollapsed] = useState(loadCollapsed)
  // The list or folder currently being renamed inline.
  const [renaming, setRenaming] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; list: TaskList } | null>(null)

  const counts = useMemo(() => {
    const map = new Map<string, number>()
    for (const t of tasks) {
      if (t.completed) continue
      map.set(t.listId, (map.get(t.listId) ?? 0) + 1)
    }
    return map
  }, [tasks])
  const importantCount = useMemo(() => tasks.filter((t) => t.starred && !t.completed && !t.archived).length, [tasks])

  const tree = useMemo(() => buildSidebarTree(lists, folders), [lists, folders])

  // Which sidebar entry something is currently being dragged over: a list id, 'important', or 'folder:<id>'.
  const [dropKey, setDropKey] = useState<string | null>(null)
  const dropClass = (key: string) => (dropKey === key ? ' drop-target' : '')
  const setActive = (key: string) => (active: boolean) => setDropKey((prev) => (active ? key : prev === key ? null : prev))
  const taskDrop = (key: string, onDropId: (id: string) => void) => dropTargetProps(TASK_MIME, setActive(key), onDropId)

  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('click', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [menu])

  function toggleFolder(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      saveCollapsed(next)
      return next
    })
  }

  async function handleAddList(e: FormEvent) {
    e.preventDefault()
    if (!newListName.trim()) return
    await addList(newListName)
    setNewListName('')
  }

  async function handleAddFolder() {
    const id = await addFolder(newListName.trim() || 'New folder')
    setNewListName('')
    if (id) setRenaming(id)
  }

  function renderList(list: TaskList, nested: boolean) {
    return (
      <div key={list.id} className={`list-row${nested ? ' nested' : ''}`}>
        {renaming === list.id ? (
          <RenameInput
            icon="☰"
            initial={list.name}
            onDone={(name) => {
              setRenaming(null)
              if (name !== null) void renameList(list.id, name)
            }}
          />
        ) : (
          <>
            <button
              className={`nav-item${selectedListId === list.id ? ' active' : ''}${dropClass(list.id)}`}
              onClick={() => selectList(list.id)}
              onDoubleClick={() => setRenaming(list.id)}
              onContextMenu={(e) => {
                e.preventDefault()
                setMenu({ x: e.clientX, y: e.clientY, list })
              }}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(LIST_MIME, list.id)
                e.dataTransfer.effectAllowed = 'move'
              }}
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
          </>
        )}
      </div>
    )
  }

  function renderFolder(folder: TaskFolder, folderLists: TaskList[]) {
    const isCollapsed = collapsed.has(folder.id)
    const total = folderLists.reduce((sum, l) => sum + (counts.get(l.id) ?? 0), 0)
    const key = `folder:${folder.id}`
    return (
      <div key={folder.id} className="folder">
        <div className="list-row">
          {renaming === folder.id ? (
            <RenameInput
              icon="📁"
              initial={folder.name}
              onDone={(name) => {
                setRenaming(null)
                if (name !== null) void renameFolder(folder.id, name)
              }}
            />
          ) : (
            <>
              <button
                className={`nav-item folder-row${dropClass(key)}`}
                onClick={() => toggleFolder(folder.id)}
                onDoubleClick={() => setRenaming(folder.id)}
                aria-expanded={!isCollapsed}
                {...dropTargetProps(LIST_MIME, setActive(key), (id) => void moveListToFolder(id, folder.id))}
              >
                <span className="label">
                  <svg className={`folder-chevron${isCollapsed ? '' : ' open'}`} width="10" height="10" viewBox="0 0 10 10" aria-hidden>
                    <path d="M3.5 1.5 7 5l-3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <span className="nav-icon">&#128193;</span>
                  <span className="label-text">{folder.name}</span>
                </span>
                <span className="count">{total}</span>
              </button>
              <button
                className="list-delete"
                title={`Delete folder "${folder.name}"`}
                onClick={(e) => {
                  e.stopPropagation()
                  if (confirm(`Delete folder "${folder.name}"? Its lists will move out of it; nothing else is deleted.`)) {
                    void deleteFolder(folder.id)
                  }
                }}
              >
                &#10005;
              </button>
            </>
          )}
        </div>
        {!isCollapsed && folderLists.map((l) => renderList(l, true))}
      </div>
    )
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

      {/* Dropping a list on empty space here (not on a folder) moves it out of its folder. */}
      <div
        className={`sidebar-section${dropClass('top-level')}`}
        {...dropTargetProps(LIST_MIME, setActive('top-level'), (id) => void moveListToFolder(id, null))}
      >
        {tree.map((entry) => (entry.kind === 'folder' ? renderFolder(entry.folder, entry.lists) : renderList(entry.list, false)))}
      </div>

      <form className="new-list-row" onSubmit={handleAddList}>
        <span className="nav-icon">+</span>
        <input type="text" placeholder="New list" value={newListName} onChange={(e) => setNewListName(e.target.value)} />
        <button type="button" className="new-folder-button" title="New folder" onClick={() => void handleAddFolder()}>
          &#128193;+
        </button>
      </form>

      <div className="sidebar-footer">
        <button className="nav-item" onClick={onOpenSettings}>
          <span className="label">
            <span className="nav-icon">&#9881;</span>
            Settings
          </span>
        </button>
      </div>

      {menu && (
        <ContextMenu x={menu.x} y={menu.y}>
          <div className="context-menu-title">Move "{menu.list.name}" to folder</div>
          {folders
            .slice()
            .sort((a, b) => a.order - b.order)
            .map((f) => (
              <button key={f.id} disabled={menu.list.folderId === f.id} onClick={() => void moveListToFolder(menu.list.id, f.id)}>
                &#128193; {f.name}
              </button>
            ))}
          <button disabled={!menu.list.folderId || !folders.some((f) => f.id === menu.list.folderId)} onClick={() => void moveListToFolder(menu.list.id, null)}>
            No folder
          </button>
          <div className="context-menu-divider" />
          <button onClick={() => setRenaming(menu.list.id)}>Rename</button>
        </ContextMenu>
      )}
    </aside>
  )
}

/** Inline name editor: Enter or blur saves, Escape cancels (onDone(null)). */
function RenameInput({ icon, initial, onDone }: { icon: string; initial: string; onDone: (name: string | null) => void }) {
  const [value, setValue] = useState(initial)
  const finished = useRef(false)
  const finish = (name: string | null) => {
    if (finished.current) return
    finished.current = true
    onDone(name)
  }
  return (
    <div className="nav-item rename-row">
      <span className="nav-icon">{icon}</span>
      <input
        autoFocus
        value={value}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => finish(value.trim() ? value : null)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') finish(value.trim() ? value : null)
          if (e.key === 'Escape') finish(null)
        }}
      />
    </div>
  )
}

/** Any click, inside (after the item's own handler runs) or outside, closes the menu via the window listener. */
function ContextMenu({ x, y, children }: { x: number; y: number; children: ReactNode }) {
  return (
    <div className="context-menu" style={{ left: x, top: y }}>
      {children}
    </div>
  )
}
