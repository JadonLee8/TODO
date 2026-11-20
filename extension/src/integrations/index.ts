import type { IntegrationInfo } from '../messages'
import { quickAdd } from './quickAdd'
import type { Integration } from './types'

/** Every integration, in the order the options page lists them. */
export const INTEGRATIONS: Integration[] = [
  quickAdd,
  {
    id: 'gmail',
    name: 'Gmail',
    description: 'Turn an email into a task: the subject becomes the title and a link back to the thread goes in the notes.',
    status: 'planned',
    detail: 'Will read the email you’re looking at in Gmail, only when you add it. Later, maybe tasks from starred or labelled mail.',
    enabledByDefault: false,
    hosts: ['https://mail.google.com/*']
  },
  {
    id: 'github',
    name: 'GitHub',
    description: 'Add an issue or pull request from its page, and bring in the issues and review requests assigned to you.',
    status: 'planned',
    detail: 'Will read the GitHub page you add from, and use the GitHub API with a token of its own for assigned work.',
    enabledByDefault: false,
    hosts: ['https://github.com/*']
  }
]

const ENABLED_KEY = 'integrations'

/** Which integrations are on: the user's choices over each one's default. Planned ones are always off. */
export async function enabledIds(): Promise<Set<string>> {
  const stored = ((await chrome.storage.local.get(ENABLED_KEY))[ENABLED_KEY] ?? {}) as Record<string, boolean>
  return new Set(INTEGRATIONS.filter((i) => i.status === 'available' && (stored[i.id] ?? i.enabledByDefault)).map((i) => i.id))
}

export async function setEnabled(id: string, enabled: boolean): Promise<void> {
  const stored = ((await chrome.storage.local.get(ENABLED_KEY))[ENABLED_KEY] ?? {}) as Record<string, boolean>
  await chrome.storage.local.set({ [ENABLED_KEY]: { ...stored, [id]: enabled } })
}

export async function describeIntegrations(): Promise<IntegrationInfo[]> {
  const on = await enabledIds()
  return INTEGRATIONS.map(({ id, name, description, status, detail, hosts }) => ({ id, name, description, status, detail, hosts, enabled: on.has(id) }))
}
