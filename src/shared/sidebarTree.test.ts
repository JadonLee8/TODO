import { describe, expect, it } from 'vitest'
import type { TaskFolder, TaskList } from './types'
import { buildSidebarTree, nextOrderInFolder, nextTopLevelOrder } from './sidebarTree'

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
