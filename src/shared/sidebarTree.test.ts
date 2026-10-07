import { describe, expect, it } from 'vitest'
import type { TaskFolder, TaskList } from './types'
import { buildSidebarTree, nextOrderInFolder, nextTopLevelOrder, reorderSidebar, type DropPosition, type SidebarItem } from './sidebarTree'

const lists: TaskList[] = [
  { id: 'main', name: 'Tasks', order: -1 },
  { id: 'a', name: 'A', order: 2 },
  { id: 'b', name: 'B', order: 0, folderId: 'f1' },
  { id: 'c', name: 'C', order: 1, folderId: 'f1' },
  { id: 'd', name: 'D', order: 0, folderId: null },
  { id: 'orphan', name: 'Orphan', order: 5, folderId: 'gone' }
]
const folders: TaskFolder[] = [{ id: 'f1', name: 'Projects', order: 1 }]

describe('buildSidebarTree', () => {
  const tree = buildSidebarTree(lists, folders)
  const summary = tree.map((e) => (e.kind === 'folder' ? `${e.folder.name}[${e.lists.map((l) => l.id).join(',')}]` : e.list.id))

  it('interleaves folders and folderless lists by order, excluding the main list', () => {
    expect(summary).toEqual(['d', 'Projects[b,c]', 'a', 'orphan'])
  })

  it('shows lists whose folder no longer exists at the top level', () => {
    expect(summary).toContain('orphan')
  })

  it('shows empty folders', () => {
    const withEmpty = buildSidebarTree(lists, [...folders, { id: 'f2', name: 'Empty', order: 3 }])
    expect(withEmpty.find((e) => e.kind === 'folder' && e.folder.id === 'f2')).toMatchObject({ lists: [] })
  })
})

describe('order helpers', () => {
  it('nextTopLevelOrder ignores lists inside existing folders and the main list', () => {
    expect(nextTopLevelOrder(lists, folders)).toBe(6)
    expect(nextTopLevelOrder([{ id: 'main', name: 'Tasks', order: -1 }], [])).toBe(0)
  })

  it('nextOrderInFolder counts only that folder', () => {
    expect(nextOrderInFolder(lists, 'f1')).toBe(2)
    expect(nextOrderInFolder(lists, 'new')).toBe(0)
  })
})

describe('reorderSidebar', () => {
  const list = (id: string): SidebarItem => ({ kind: 'list', id })
  const folder = (id: string): SidebarItem => ({ kind: 'folder', id })
  const summarize = (r: { lists: TaskList[]; folders: TaskFolder[] } | null) =>
    r && buildSidebarTree(r.lists, r.folders).map((e) => (e.kind === 'folder' ? `${e.folder.name}[${e.lists.map((l) => l.id).join(',')}]` : e.list.id))
  const move = (dragged: SidebarItem, target: SidebarItem | null, position: DropPosition) =>
    summarize(reorderSidebar(lists, folders, dragged, target, position))

  // Starting layout: d, Projects[b,c], a, orphan

  it('reorders top-level lists', () => {
    expect(move(list('a'), list('d'), 'before')).toEqual(['a', 'd', 'Projects[b,c]', 'orphan'])
    expect(move(list('d'), list('orphan'), 'after')).toEqual(['Projects[b,c]', 'a', 'orphan', 'd'])
  })

  it('reorders lists inside a folder', () => {
    expect(move(list('c'), list('b'), 'before')).toEqual(['d', 'Projects[c,b]', 'a', 'orphan'])
  })

  it('moves a list into a folder at a position, or appends it when dropped on the folder', () => {
    expect(move(list('a'), list('c'), 'before')).toEqual(['d', 'Projects[b,a,c]', 'orphan'])
    expect(move(list('d'), folder('f1'), 'inside')).toEqual(['Projects[b,c,d]', 'a', 'orphan'])
  })

  it('moves a list out of a folder next to a top-level entry', () => {
    expect(move(list('b'), folder('f1'), 'before')).toEqual(['d', 'b', 'Projects[c]', 'a', 'orphan'])
    expect(move(list('c'), list('orphan'), 'after')).toEqual(['d', 'Projects[b]', 'a', 'orphan', 'c'])
  })

  it('moves to the end of the top level with no target, adopting orphans', () => {
    const r = reorderSidebar(lists, folders, list('b'), null, 'after')
    expect(summarize(r)).toEqual(['d', 'Projects[c]', 'a', 'orphan', 'b'])
    expect(r!.lists.find((l) => l.id === 'orphan')!.folderId).toBeNull()
  })

  it('reorders folders, placing them beside the folder when dropped next to a nested list', () => {
    expect(move(folder('f1'), list('d'), 'before')).toEqual(['Projects[b,c]', 'd', 'a', 'orphan'])
    expect(move(folder('f1'), null, 'after')).toEqual(['d', 'a', 'orphan', 'Projects[b,c]'])
  })

  it('renumbers orders contiguously and leaves untouched entries as-is', () => {
    const r = reorderSidebar(lists, folders, list('c'), list('b'), 'before')!
    expect(r.lists.find((l) => l.id === 'c')).toMatchObject({ order: 0, folderId: 'f1' })
    expect(r.lists.find((l) => l.id === 'b')).toMatchObject({ order: 1, folderId: 'f1' })
    expect(r.lists[0]).toBe(lists[0]) // main list untouched
  })

  it('rejects no-op and invalid moves', () => {
    expect(reorderSidebar(lists, folders, list('a'), list('a'), 'before')).toBeNull()
    expect(reorderSidebar(lists, folders, list('main'), list('a'), 'before')).toBeNull()
    expect(reorderSidebar(lists, folders, folder('f1'), list('b'), 'before')).toBeNull()
  })
})
