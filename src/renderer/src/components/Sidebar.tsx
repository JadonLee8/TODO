import { useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent, type ReactNode, type RefObject } from 'react'
import type { TaskFolder, TaskList } from '@shared/types'
import { MAIN_LIST_ID } from '@shared/types'
import { buildSidebarTree, type DropPosition, type SidebarItem } from '@shared/sidebarTree'
import { useAppState } from '../state/AppStateContext'
import { useConfirm } from './ConfirmDialog'
import { TASK_MIME, dropTargetProps, mergeDropProps, sortDropProps, startSortDrag, type SortKind } from '../dnd'

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
  onOpenExtensions,
  onSearchSubmit,
  searchInputRef
}: {
  onOpenSettings: () => void
  onOpenExtensions: () => void
  /** Enter in the search box: the phone closes its drawer to show the results. */
  onSearchSubmit?: () => void
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
    moveSidebarItem,
    moveTask,
    starTask
  } = useAppState()
  const selectedListId = view.kind === 'list' ? view.listId : null
  const confirm = useConfirm()
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

  // The sidebar entry something is being dragged over (a list id, 'important', 'folder:<id>' or 'top-level')
  // and where the drop would land relative to it.
  const [drop, setDrop] = useState<{ key: string; position: DropPosition } | null>(null)
  // The list or folder being dragged, so it doesn't show an insertion line next to itself.
  const [dragging, setDragging] = useState<SidebarItem | null>(null)
  const indicate = (key: string) => (position: DropPosition | null) =>
    setDrop((prev) => {
      if (!position) return prev?.key === key ? null : prev
      return prev?.key === key && prev.position === position ? prev : { key, position }
    })
  const dropClass = (key: string) => (drop?.key === key && drop.position === 'inside' ? ' drop-target' : '')
  const lineClass = (key: string, self: SidebarItem) => {
    if (drop?.key !== key || drop.position === 'inside' || (dragging?.kind === self.kind && dragging.id === self.id)) return ''
    return drop.position === 'before' ? ' drop-before' : ' drop-after'
  }
  const taskDrop = (key: string, onDropId: (id: string) => void) =>
    dropTargetProps(TASK_MIME, (active) => indicate(key)(active ? 'inside' : null), onDropId)
  const sortDrop = (key: string, target: SidebarItem | null, resolve: (kind: SortKind, y: number) => DropPosition | null) =>
    sortDropProps(resolve, indicate(key), (kind, id, position) => void moveSidebarItem({ kind, id }, target, position))
  const dragProps = (item: SidebarItem) => ({
    draggable: true,
    onDragStart: (e: DragEvent) => {
      startSortDrag(e, item.kind, item.id)
      setDragging(item)
    },
    onDragEnd: () => {
      setDragging(null)
      setDrop(null)
    }
  })

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
    const id = await addFolder('New folder')
    if (id) setRenaming(id)
  }

  function renderList(list: TaskList, nested: boolean) {
    const self: SidebarItem = { kind: 'list', id: list.id }
    // Lists can be dropped above or below any list; folders only beside top-level lists (they can't nest).
    const resolve = (kind: SortKind, y: number): DropPosition | null =>
      kind === 'folder' && nested ? null : y < 0.5 ? 'before' : 'after'
    return (
      <div key={list.id} className={`list-row${nested ? ' nested' : ''}${lineClass(list.id, self)}`}>
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
              {...dragProps(self)}
              {...mergeDropProps(
                taskDrop(list.id, (id) => void moveTask(id, list.id)),
                sortDrop(list.id, self, resolve)
              )}
            >
              <span className="label">
                <span className="nav-icon">&#9776;</span>
                <span className="label-text">{list.name}</span>
              </span>
              <span className="count">{counts.get(list.id) ?? 0}</span>
            </button>
            <button
              className="list-delete"
              data-tooltip="Delete list"
              aria-label={`Delete list “${list.name}”`}
              onClick={async (e) => {
                e.stopPropagation()
                const n = tasks.filter((t) => t.listId === list.id && !t.archived).length
                const ok = await confirm({
                  title: `Delete list “${list.name}”?`,
                  message: (
                    <>
                      {n > 0 && `Its ${n} task${n === 1 ? '' : 's'} will move to Tasks. `}You can undo this from Settings › Activity.
                    </>
                  ),
                  confirmLabel: 'Delete list',
                  tone: 'danger'
                })
                if (ok) void deleteList(list.id)
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
    const self: SidebarItem = { kind: 'folder', id: folder.id }
    // A list over the header goes into the folder, except near the top edge (above the folder) or, when there
    // are no visible lists under it, near the bottom edge (below the folder).
    const resolveHeader = (kind: SortKind, y: number): DropPosition | null => {
      if (kind !== 'list') return null
      if (y < 0.3) return 'before'
      if ((isCollapsed || folderLists.length === 0) && y > 0.7) return 'after'
      return 'inside'
    }
    // A folder dragged anywhere over this folder's block (header or lists) lands above or below the whole block.
    const resolveBlock = (kind: SortKind, y: number): DropPosition | null => (kind === 'folder' ? (y < 0.5 ? 'before' : 'after') : null)
    return (
      <div key={folder.id} className={`folder${lineClass(key, self)}`} {...sortDrop(key, self, resolveBlock)}>
        <div className="list-row">
          {renaming === folder.id ? (
            <RenameInput
              icon={<FolderIcon />}
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
                {...dragProps(self)}
                {...sortDrop(key, self, resolveHeader)}
              >
                <span className="label">
                  <svg className={`folder-chevron${isCollapsed ? '' : ' open'}`} width="10" height="10" viewBox="0 0 10 10" aria-hidden>
                    <path d="M3.5 1.5 7 5l-3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <span className="nav-icon">
                    <FolderIcon />
                  </span>
                  <span className="label-text">{folder.name}</span>
                </span>
                <span className="count">{total}</span>
              </button>
              <button
                className="list-delete"
                data-tooltip="Delete folder"
                aria-label={`Delete folder “${folder.name}”`}
                onClick={async (e) => {
                  e.stopPropagation()
                  // Nothing is lost (its lists stay), so this asks with the milder accent button.
                  const ok = await confirm({
                    title: `Delete folder “${folder.name}”?`,
                    message:
                      folderLists.length > 0
                        ? `Its ${folderLists.length} list${folderLists.length === 1 ? '' : 's'} will move out of the folder. No lists or tasks are deleted.`
                        : 'The folder is empty, so nothing else changes.',
                    confirmLabel: 'Delete folder',
                    tone: 'accent'
                  })
                  if (ok) void deleteFolder(folder.id)
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
      <div className="sidebar-title">TODO</div>

      <div className="sidebar-search">
        <span className="nav-icon">&#8981;</span>
        <input
          ref={searchInputRef}
          type="search"
          placeholder={window.api.platform === 'desktop' ? 'Search (Ctrl+F)' : 'Search'}
          value={view.kind === 'search' ? view.query : ''}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.currentTarget.blur()
              onSearchSubmit?.()
            }
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
          <span className="label-text">Tasks</span>
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
          <span className="nav-icon">&#9733;</span>
          <span className="label-text">Important</span>
        </span>
        <span className="count">{importantCount}</span>
      </button>

      <button className={`nav-item${view.kind === 'stats' ? ' active' : ''}`} onClick={() => setView({ kind: 'stats' })}>
        <span className="label">
          <span className="nav-icon">&#8600;</span>
          <span className="label-text">Stats</span>
        </span>
      </button>

      <div className="sidebar-divider" />

      {/* Dropping a list or folder on empty space here moves it to the bottom, outside any folder. */}
      <div className={`sidebar-section${dropClass('top-level')}`} {...sortDrop('top-level', null, () => 'inside')}>
        {tree.map((entry) => (entry.kind === 'folder' ? renderFolder(entry.folder, entry.lists) : renderList(entry.list, false)))}
      </div>

      <form className="new-list-row" onSubmit={handleAddList}>
        <span className="nav-icon">+</span>
        <input type="text" placeholder="New list" value={newListName} onChange={(e) => setNewListName(e.target.value)} />
      </form>
      <button className="nav-item new-folder-row" onClick={() => void handleAddFolder()}>
        <span className="label">
          <span className="nav-icon">
            <FolderIcon />
          </span>
          <span className="label-text">New folder</span>
        </span>
      </button>

      <div className="sidebar-footer">
        <button className="nav-item desktop-only" onClick={onOpenExtensions}>
          <span className="label">
            <span className="nav-icon">&#10697;</span>
            <span className="label-text">Extensions</span>
          </span>
        </button>
        <button className="nav-item" onClick={onOpenSettings}>
          <span className="label">
            <span className="nav-icon">&#9881;</span>
            <span className="label-text">Settings</span>
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
                <FolderIcon /> {f.name}
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
function RenameInput({ icon, initial, onDone }: { icon: ReactNode; initial: string; onDone: (name: string | null) => void }) {
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

/** Outline folder in the sidebar's ink, instead of the colored emoji. */
function FolderIcon() {
  return (
    <svg className="folder-icon" width="15" height="13" viewBox="0 0 15 13" aria-hidden>
      <path
        d="M1.5 2.5a1 1 0 0 1 1-1h3.2l1.5 1.6h5.3a1 1 0 0 1 1 1v6.9a1 1 0 0 1-1 1h-10a1 1 0 0 1-1-1z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  )
}
