import type { ExtensionId, ExtensionSettings } from './types'

/**
 * The extension marketplace's catalog. Every entry ships with the app: extensions run in the main process next to
 * your GitHub token, so the app only runs code it was built with. "Installing" one turns it on (a synced setting);
 * each device then does its own setup (connecting an account, picking a folder) before it runs there.
 *
 * Companion entries are separate apps (a browser extension) that work with the same tasks repo. The marketplace
 * shows how to set them up, but the app can't install them itself.
 */

export type ExtensionCategory = 'Import' | 'Notes' | 'Capture' | 'Companion'

interface CatalogBase {
  name: string
  /** One line for the catalog list. */
  tagline: string
  /** A paragraph for the detail pane. */
  description: string
  category: ExtensionCategory
  /** What it can read or change, shown before installing. */
  access: string[]
  /** One or two characters drawn as the extension's icon. */
  glyph: string
}

/** Built into the app: install, then set up per device. */
export interface BuiltInExtension extends CatalogBase {
  kind: 'built-in'
  id: ExtensionId
  /** What it does on Sync, in the order Sync runs it. */
  runs: string
}

/** A separate app that works alongside this one. */
export interface CompanionExtension extends CatalogBase {
  kind: 'companion'
  id: string
  /** Setup steps, shown in place of an Install button. */
  setup: string[]
}

/** Listed so people know it's planned; can't be installed yet. */
export interface PlannedExtension extends CatalogBase {
  kind: 'planned'
  id: string
}

export type CatalogEntry = BuiltInExtension | CompanionExtension | PlannedExtension

export const EXTENSION_CATALOG: CatalogEntry[] = [
  {
    kind: 'built-in',
    id: 'obsidian',
    name: 'Obsidian',
    glyph: 'Ob',
    category: 'Notes',
    tagline: 'Mirror tasks into your vault and capture new ones from an inbox note.',
    description:
      'Writes every task as a Markdown note with properties into a folder of your Obsidian vault, plus a Base that shows them as a table. ' +
      'Your vault then holds your tasks next to your notes and watch log, so search, links, the graph and anything that reads the vault ' +
      '(an AI assistant, a backup) sees all of it. Unchecked items you add to the Inbox note become tasks on the next Sync.',
    access: [
      'Reads and writes files inside one folder of the vault you pick (TODO/ by default)',
      'Never touches the rest of the vault',
      'Nothing leaves this computer'
    ],
    runs: 'Before the final push it turns new inbox items into tasks. After syncing it updates the task notes.'
  },
  {
    kind: 'built-in',
    id: 'google-calendar',
    name: 'Google Calendar',
    glyph: '31',
    category: 'Import',
    tagline: 'Import upcoming events as tasks, once each.',
    description:
      'Every Sync imports new events from the calendars you pick (today through N days ahead) as tasks with a due date. ' +
      'Each event is imported once: editing or deleting the task never brings it back. Imported tasks can move to P1 when they become overdue.',
    access: [
      'Read-only access to your Google calendars (calendar.readonly)',
      'Uses your own Google Cloud OAuth client; the secret and refresh token are encrypted on this device'
    ],
    runs: 'After pulling, it imports new events, then Sync pushes them.'
  },
  {
    kind: 'companion',
    id: 'chrome-quick-add',
    name: 'Chrome quick add',
    glyph: '+',
    category: 'Capture',
    tagline: 'Add the page you are on as a task, from the toolbar or the right-click menu.',
    description:
      'A Chrome extension that writes tasks straight to your tasks repo, so it works while this app is closed. The app picks them up on its next Sync.',
    access: ['Its own GitHub token, scoped to the tasks repo', 'The title and URL of the tab you add from'],
    setup: [
      'Run npm run build:extension in the app’s source folder.',
      'Open chrome://extensions, turn on Developer mode, click Load unpacked and pick extension/dist.',
      'Create a separate fine-grained GitHub token for it (tasks repo only, Contents: read and write).',
      'Open the extension’s options and enter the repo and token.'
    ]
  },
  {
    kind: 'companion',
    id: 'watchwise',
    name: 'watchwise',
    glyph: '▶',
    category: 'Companion',
    tagline: 'Queue YouTube videos and log what you watch, with notes, to the same Obsidian vault.',
    description:
      'A Chrome extension that queues YouTube videos instead of opening them, and writes a watch log and one note per video into your vault. ' +
      'With the Obsidian extension pointed at the same vault, your tasks and your video notes live side by side.',
    access: ['YouTube pages', 'One folder of your Obsidian vault (YouTube/ by default)'],
    setup: [
      'Open chrome://extensions, turn on Developer mode, click Load unpacked and pick the watchwise folder.',
      'On its welcome page, choose the same vault folder you use here.'
    ]
  },
  {
    kind: 'built-in',
    id: 'microsoft-todo',
    name: 'Microsoft To Do',
    glyph: 'MS',
    category: 'Import',
    tagline: 'Import your lists and tasks from the Microsoft To Do app on this PC.',
    description:
      'Reads the offline copy the Microsoft To Do Windows app keeps of your account, so it works with school and work accounts ' +
      'without asking Microsoft for API access. Your Tasks list goes into Tasks, other lists become lists (merged into one you already ' +
      'have with the same name), groups become folders, important tasks are starred and steps become a checklist in the notes. ' +
      'Each task is imported once; while it stays installed, every Sync also brings in tasks you have added in Microsoft To Do since.',
    access: [
      'Reads Microsoft To Do’s local database on this computer (never changes it)',
      'No Microsoft sign-in or API permissions',
      'Imported tasks sync to your tasks repo like any others'
    ],
    runs: 'After pulling, it imports tasks added in Microsoft To Do since the last import, then Sync pushes them.'
  }
]

export function catalogEntry(id: string): CatalogEntry | undefined {
  return EXTENSION_CATALOG.find((e) => e.id === id)
}

export function isInstalled(settings: ExtensionSettings, id: ExtensionId): boolean {
  return settings.installed.includes(id)
}

/** Returns the settings with `id` installed or uninstalled. Options are kept either way, so reinstalling restores them. */
export function setInstalled(settings: ExtensionSettings, id: ExtensionId, installed: boolean): ExtensionSettings {
  const others = settings.installed.filter((x) => x !== id)
  return { ...settings, installed: installed ? [...others, id] : others }
}
