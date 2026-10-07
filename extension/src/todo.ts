import type { Priority, Task, TaskFolder, TaskList } from '@shared/types'
import { MAIN_LIST_ID } from '@shared/types'
import { newId } from '@shared/id'
import { getFileContent, putFile } from '@shared/github'

/**
 * The extension writes tasks straight to the GitHub repo in the app's own format (data/tasks/<uuid>.json); the
 * desktop app picks them up on its next Sync like any other remote change.
 */

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

/** Lists for the dropdown, in sidebar order: Tasks first, then folders' lists grouped under the folder name. */
export interface ListGroup {
  label: string | null
  lists: TaskList[]
}

async function readJson<T>(config: ExtensionConfig, path: string, fallback: T): Promise<T> {
  const file = await getFileContent(config.token, config.owner, config.repo, path, config.branch)
  return file ? (JSON.parse(file.content) as T) : fallback
}

export async function fetchListGroups(config: ExtensionConfig): Promise<ListGroup[]> {
  const [lists, folders] = await Promise.all([
    readJson<TaskList[]>(config, 'data/lists.json', []),
    readJson<TaskFolder[]>(config, 'data/folders.json', [])
  ])
  const main: TaskList = lists.find((l) => l.id === MAIN_LIST_ID) ?? { id: MAIN_LIST_ID, name: 'Tasks', order: -1 }
  const byOrder = (a: { order: number }, b: { order: number }) => a.order - b.order
  const folderIds = new Set(folders.map((f) => f.id))
  const custom = lists.filter((l) => l.id !== MAIN_LIST_ID)
  return [
    { label: null, lists: [main, ...custom.filter((l) => !l.folderId || !folderIds.has(l.folderId)).sort(byOrder)] },
    ...[...folders].sort(byOrder).map((f) => ({ label: f.name, lists: custom.filter((l) => l.folderId === f.id).sort(byOrder) }))
  ].filter((g) => g.lists.length > 0)
}

export interface NewTask {
  title: string
  notes: string
  listId: string
  priority: Priority
  starred: boolean
}

export function buildTask(input: NewTask, now: Date = new Date()): Task {
  const iso = now.toISOString()
  return {
    id: newId(),
    listId: input.listId,
    title: input.title.trim(),
    notes: input.notes,
    priority: input.priority,
    starred: input.starred,
    completed: false,
    createdAt: iso,
    updatedAt: iso,
    completedAt: null,
    archived: false,
    dueDate: null,
    source: null
  }
}

export async function addTask(config: ExtensionConfig, input: NewTask): Promise<Task> {
  const task = buildTask(input)
  await putFile(
    config.token,
    config.owner,
    config.repo,
    `data/tasks/${task.id}.json`,
    config.branch,
    JSON.stringify(task, null, 2),
    `Add task (Chrome): ${task.title.slice(0, 60)}`
  )
  return task
}

/** What the popup should be prefilled with when opened from the context menu. */
export interface Prefill {
  title: string
  notes: string
}
