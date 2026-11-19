import type { Priority, Task, TaskList } from './types'

/**
 * Pure helpers for the Obsidian extension: how a task is written as a note, how note file names are chosen, and how
 * the inbox note is read. The main process (main/extensions/obsidian.ts) does the file I/O.
 *
 * Layout inside the vault, under the configured folder (TODO/ by default):
 *   Tasks/<title>.md   one note per task, owned by the app except for the "## Vault notes" section
 *   Tasks.base         an Obsidian Base showing the task notes as tables (written once, then yours to edit)
 *   Inbox.md           unchecked "- [ ] ..." items here become tasks on the next Sync
 */

export const TASKS_SUBFOLDER = 'Tasks'
export const BASE_FILE = 'Tasks.base'
export const INBOX_FILE = 'Inbox.md'
/** Everything from this heading down is the user's, and survives every rewrite of the note. */
export const VAULT_NOTES_HEADING = '## Vault notes'

const MAX_NAME_LENGTH = 80

/** A title made safe for a file name on Windows, macOS and Linux, and for Obsidian links (no # ^ [ ] |). */
export function sanitizeFileName(title: string): string {
  const cleaned = title
    .replace(/[\\/:*?"<>|#^[\]]/g, ' ')
    .replace(/[\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .replace(/[. ]+$/, '')
    .slice(0, MAX_NAME_LENGTH)
    .trim()
  return cleaned || 'Untitled'
}

/**
 * File names (without folder) for every task's note. Titles that clash, ignoring case as Windows and macOS do,
 * get the start of the task id appended. Oldest tasks keep the plain name, so the choice is stable between runs.
 */
export function taskNoteFileNames(tasks: Task[]): Map<string, string> {
  const byAge = [...tasks].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
  const taken = new Set<string>()
  const names = new Map<string, string>()
  for (const task of byAge) {
    const base = sanitizeFileName(task.title)
    let name = `${base}.md`
    if (taken.has(name.toLowerCase())) name = `${base} (${task.id.slice(0, 8)}).md`
    taken.add(name.toLowerCase())
    names.set(task.id, name)
  }
  return names
}

export type TaskNoteStatus = 'open' | 'done' | 'archived'

export function taskStatus(task: Task): TaskNoteStatus {
  if (task.archived) return 'archived'
  return task.completed ? 'done' : 'open'
}

/** A YAML scalar: JSON strings are valid double-quoted YAML. */
function yamlString(value: string): string {
  return JSON.stringify(value)
}

/** The note for a task. `vaultNotes` is the existing "## Vault notes" section (heading included), kept as is. */
export function renderTaskNote(task: Task, lists: TaskList[], vaultNotes: string | null): string {
  const listName = lists.find((l) => l.id === task.listId)?.name ?? 'Tasks'
  const props: string[] = [
    `todo_id: ${yamlString(task.id)}`,
    `list: ${yamlString(listName)}`,
    `priority: ${task.priority}`,
    `status: ${taskStatus(task)}`,
    `starred: ${task.starred}`
  ]
  if (task.dueDate) props.push(`due: ${task.dueDate.slice(0, 10)}`)
  props.push(`created: ${task.createdAt}`)
  if (task.completedAt) props.push(`completed_at: ${task.completedAt}`)
  if (task.source) props.push(`source: ${task.source.type}`)
  if (task.source?.type === 'google_calendar' && task.source.htmlLink) props.push(`event: ${yamlString(task.source.htmlLink)}`)
  props.push('tags:', '  - todo')

  const body = [
    '---',
    ...props,
    '---',
    '%% Written by the TODO app on every Sync. Edit the task in the app; anything under "Vault notes" is kept. %%',
    '',
    `# ${task.title}`,
    ''
  ]
  if (task.notes.trim()) body.push(task.notes.trimEnd(), '')
  body.push(vaultNotes?.trimEnd() || VAULT_NOTES_HEADING, '')
  return body.join('\n')
}

/** The "## Vault notes" section of an existing note, from the heading to the end, or null if it has none. */
export function extractVaultNotes(content: string): string | null {
  const lines = content.split(/\r?\n/)
  const start = lines.findIndex((l) => l.trimEnd() === VAULT_NOTES_HEADING)
  return start === -1 ? null : lines.slice(start).join('\n')
}

/** The `todo_id` property of a note the app wrote, or null. Used so the app only ever deletes its own notes. */
export function noteTaskId(content: string): string | null {
  const match = /^---\r?\n(?:.*\r?\n)*?todo_id:\s*"([^"]+)"/.exec(content)
  return match ? match[1] : null
}

/** An Obsidian Base over the task notes. Written once; after that it's the user's to change. */
export function renderTasksBase(folder: string): string {
  const tasksFolder = [folder, TASKS_SUBFOLDER].filter(Boolean).join('/')
  return `filters:
  and:
    - file.inFolder(${yamlString(tasksFolder)})
views:
  - type: table
    name: Open
    filters:
      and:
        - note.status == "open"
    order:
      - file.name
      - note.priority
      - note.list
      - note.due
      - note.starred
    sort:
      - property: note.priority
        direction: ASC
      - property: note.due
        direction: ASC
  - type: table
    name: Done
    filters:
      and:
        - note.status != "open"
    order:
      - file.name
      - note.list
      - note.completed_at
    sort:
      - property: note.completed_at
        direction: DESC
`
}

export const INBOX_TEMPLATE = `# Inbox

%% Unchecked items below become tasks in the TODO app on its next Sync, and are removed from this note.
Add #p1 to #p5 for a priority, and "📅 2026-12-31" for a due date. %%

- [ ]
`

export interface InboxItem {
  title: string
  priority: Priority | null
  /** YYYY-MM-DD */
  dueDate: string | null
}

/**
 * Reads the inbox note: every unchecked, non-empty "- [ ]" item becomes an InboxItem and is removed from the note.
 * Checked items, headings and other text stay. If nothing was taken, `remaining` is the input unchanged.
 */
export function parseInbox(content: string): { items: InboxItem[]; remaining: string } {
  const items: InboxItem[] = []
  const kept: string[] = []
  for (const line of content.split(/\r?\n/)) {
    const match = /^\s*[-*+] \[ \]\s+(.*\S)\s*$/.exec(line)
    if (!match) {
      kept.push(line)
      continue
    }
    let text = match[1]
    let priority: Priority | null = null
    let dueDate: string | null = null
    text = text.replace(/(^|\s)#p([1-5])(?=\s|$)/i, (_m, lead: string, p: string) => {
      priority = Number(p) as Priority
      return lead
    })
    text = text.replace(/(^|\s)📅\s*(\d{4}-\d{2}-\d{2})(?=\s|$)/u, (_m, lead: string, d: string) => {
      dueDate = d
      return lead
    })
    const title = text.replace(/\s+/g, ' ').trim()
    if (!title) {
      kept.push(line)
      continue
    }
    items.push({ title, priority, dueDate })
  }
  return { items, remaining: items.length ? kept.join('\n') : content }
}

/** Opens a file in Obsidian (the vault it belongs to must already be open in Obsidian once). */
export function obsidianOpenUri(absolutePath: string): string {
  return `obsidian://open?path=${encodeURIComponent(absolutePath)}`
}
