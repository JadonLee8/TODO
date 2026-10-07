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
