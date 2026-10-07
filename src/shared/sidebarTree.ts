import type { TaskFolder, TaskList } from './types'
import { MAIN_LIST_ID } from './types'

export type SidebarEntry = { kind: 'folder'; folder: TaskFolder; lists: TaskList[] } | { kind: 'list'; list: TaskList }

/**
 * Arranges the custom lists (everything except the main Tasks list) and folders for the sidebar.
 * Folders and folderless lists share one order space at the top level; a folder's lists are sorted by
 * their own order. A list whose folder no longer exists is shown at the top level: lists.json and
 * folders.json sync separately, so that state can happen.
 */
export function buildSidebarTree(lists: TaskList[], folders: TaskFolder[]): SidebarEntry[] {
  const folderIds = new Set(folders.map((f) => f.id))
  const custom = lists.filter((l) => l.id !== MAIN_LIST_ID)
  const inFolder = (l: TaskList) => !!l.folderId && folderIds.has(l.folderId)

  const entries: { order: number; entry: SidebarEntry }[] = [
    ...folders.map((folder) => ({
      order: folder.order,
      entry: {
        kind: 'folder' as const,
        folder,
        lists: custom.filter((l) => l.folderId === folder.id).sort((a, b) => a.order - b.order)
      }
    })),
    ...custom.filter((l) => !inFolder(l)).map((list) => ({ order: list.order, entry: { kind: 'list' as const, list } }))
  ]
  return entries.sort((a, b) => a.order - b.order).map((e) => e.entry)
}

/** The next free order value at the top level (shared by folders and folderless lists). */
export function nextTopLevelOrder(lists: TaskList[], folders: TaskFolder[]): number {
  const folderIds = new Set(folders.map((f) => f.id))
  const orders = [
    ...folders.map((f) => f.order),
    ...lists.filter((l) => l.id !== MAIN_LIST_ID && !(l.folderId && folderIds.has(l.folderId))).map((l) => l.order)
  ]
  return orders.length ? Math.max(...orders) + 1 : 0
}

/** The next free order value inside a folder. */
export function nextOrderInFolder(lists: TaskList[], folderId: string): number {
  const orders = lists.filter((l) => l.folderId === folderId).map((l) => l.order)
  return orders.length ? Math.max(...orders) + 1 : 0
}

/** A draggable sidebar entry. */
export interface SidebarItem {
  kind: 'list' | 'folder'
  id: string
}

/** Where a drop lands relative to its target: above it, below it, or into it (folders only). */
export type DropPosition = 'before' | 'after' | 'inside'

/**
 * Moves a list or folder next to (or, for a list, into) another sidebar entry and renumbers `order` so
 * the result is contiguous. A null target means the end of the top level.
 *  - A list dropped before/after a list joins that list's container (its folder, or the top level).
 *  - A list dropped before/after a folder goes to the top level, beside the folder; `inside` appends it.
 *  - Folders only live at the top level, so a folder dropped next to a list inside a folder lands
 *    beside that folder instead.
 * Returns null when the move is invalid. Unchanged entries keep their identity, so callers can skip saving
 * whichever of lists.json/folders.json didn't change.
 */
export function reorderSidebar(
  lists: TaskList[],
  folders: TaskFolder[],
  dragged: SidebarItem,
  target: SidebarItem | null,
  position: DropPosition
): { lists: TaskList[]; folders: TaskFolder[] } | null {
  const same = (a: SidebarItem, b: SidebarItem) => a.kind === b.kind && a.id === b.id
  if (target && same(dragged, target)) return null

  const tree = buildSidebarTree(lists, folders)
  let top: SidebarItem[] = tree.map((e) => (e.kind === 'folder' ? { kind: 'folder', id: e.folder.id } : { kind: 'list', id: e.list.id }))
  const contents = new Map<string, SidebarItem[]>()
  for (const e of tree) if (e.kind === 'folder') contents.set(e.folder.id, e.lists.map((l) => ({ kind: 'list', id: l.id })))
  const parentOf = (listId: string) => [...contents].find(([, items]) => items.some((i) => i.id === listId))?.[0] ?? null

  const exists = top.some((i) => same(i, dragged)) || (dragged.kind === 'list' && parentOf(dragged.id) !== null)
  if (!exists) return null // includes the main list, which isn't part of the tree
  if (dragged.kind === 'folder' && target?.kind === 'list' && parentOf(target.id) === dragged.id) return null

  top = top.filter((i) => !same(i, dragged))
  for (const [id, items] of contents) contents.set(id, items.filter((i) => !same(i, dragged)))

  let dest = top
  let index = top.length
  if (target) {
    const parent = target.kind === 'list' ? parentOf(target.id) : null
    let anchor = target
    if (target.kind === 'folder' && position === 'inside' && dragged.kind === 'list') {
      const items = contents.get(target.id)
      if (!items) return null
      dest = items
      index = items.length
    } else {
      if (parent && dragged.kind === 'folder') anchor = { kind: 'folder', id: parent }
      else if (parent) dest = contents.get(parent)!
      const at = dest.findIndex((i) => same(i, anchor))
      if (at === -1) return null
      index = at + (position === 'before' ? 0 : 1)
    }
  }
  dest.splice(index, 0, dragged)

  const listPlacement = new Map<string, { order: number; folderId: string | null }>()
  const folderOrder = new Map<string, number>()
  top.forEach((item, i) => (item.kind === 'folder' ? folderOrder.set(item.id, i) : listPlacement.set(item.id, { order: i, folderId: null })))
  for (const [folderId, items] of contents) items.forEach((item, i) => listPlacement.set(item.id, { order: i, folderId }))

  return {
    lists: lists.map((l) => {
      const p = listPlacement.get(l.id)
      return p && (p.order !== l.order || p.folderId !== (l.folderId ?? null)) ? { ...l, ...p } : l
    }),
    folders: folders.map((f) => {
      const order = folderOrder.get(f.id)
      return order !== undefined && order !== f.order ? { ...f, order } : f
    })
  }
}
