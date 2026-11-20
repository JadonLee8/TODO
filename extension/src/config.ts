import type { TaskFolder, TaskList } from '@shared/types'
import { MAIN_LIST_ID } from '@shared/types'

/** The repo and token, saved by the options page in chrome.storage.local (not encrypted by the OS; see options.html). */
export interface ExtensionConfig {
  owner: string
  repo: string
  branch: string
  token: string
}

export async function loadConfig(): Promise<ExtensionConfig | null> {
  const { config } = (await chrome.storage.local.get('config')) as { config?: ExtensionConfig }
  return config?.owner && config.repo && config.token ? { ...config, branch: config.branch || 'main' } : null
}

export async function saveConfig(config: ExtensionConfig): Promise<void> {
  await chrome.storage.local.set({ config })
}

/** Lists for a dropdown, in sidebar order: Tasks first, then each folder's lists under the folder's name. */
export interface ListGroup {
  label: string | null
  lists: TaskList[]
}

export function listGroups(lists: TaskList[], folders: TaskFolder[]): ListGroup[] {
  const main: TaskList = lists.find((l) => l.id === MAIN_LIST_ID) ?? { id: MAIN_LIST_ID, name: 'Tasks', order: -1 }
  const byOrder = (a: { order: number }, b: { order: number }) => a.order - b.order
  const folderIds = new Set(folders.map((f) => f.id))
  const custom = lists.filter((l) => l.id !== MAIN_LIST_ID)
  return [
    { label: null, lists: [main, ...custom.filter((l) => !l.folderId || !folderIds.has(l.folderId)).sort(byOrder)] },
    ...[...folders].sort(byOrder).map((f) => ({ label: f.name, lists: custom.filter((l) => l.folderId === f.id).sort(byOrder) }))
  ].filter((g) => g.lists.length > 0)
}

/** Fills a <select> with the list groups, picking `selected` when it's still there. */
export function fillListSelect(select: HTMLSelectElement, groups: ListGroup[], selected: string | undefined): void {
  select.replaceChildren()
  for (const group of groups) {
    const parent = group.label ? Object.assign(document.createElement('optgroup'), { label: group.label }) : select
    for (const list of group.lists) parent.append(new Option(list.name, list.id))
    if (parent !== select) select.append(parent)
  }
  select.value = groups.some((g) => g.lists.some((l) => l.id === selected)) ? selected! : MAIN_LIST_ID
}
