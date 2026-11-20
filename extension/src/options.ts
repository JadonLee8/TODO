import { verifyRepoAccess } from '@shared/github'
import { loadConfig, saveConfig, type ExtensionConfig } from './config'
import { applyCachedLook, applyLook } from './look'
import { onChanged, send, type IntegrationInfo, type Snapshot } from './messages'

/** The options page: the repo and token, sync status, and which integrations are on. */

applyCachedLook()

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

const owner = $<HTMLInputElement>('owner')
const repo = $<HTMLInputElement>('repo')
const branch = $<HTMLInputElement>('branch')
const token = $<HTMLInputElement>('token')
const status = $<HTMLDivElement>('status')

function setStatus(message: string, kind: 'ok' | 'error' | '' = '') {
  status.textContent = message
  status.className = `status ${kind}`
}

let saved: ExtensionConfig | null = null

function current(): ExtensionConfig {
  // An empty token field keeps the saved token (it's never shown again once saved).
  return { owner: owner.value.trim(), repo: repo.value.trim(), branch: branch.value.trim() || 'main', token: token.value.trim() || saved?.token || '' }
}

function renderSync(state: Snapshot) {
  applyLook(state.settings)
  const el = $<HTMLSpanElement>('sync-status')
  const { syncing, lastAt, lastResult } = state.sync
  el.className = `hint small${lastResult?.error ? ' error' : ''}`
  if (syncing) el.textContent = 'Syncing…'
  else if (lastResult?.error) el.textContent = `Last sync failed: ${lastResult.error}`
  else if (lastAt) el.textContent = `Last synced ${new Date(lastAt).toLocaleString()}: ${lastResult?.pushed ?? 0} pushed, ${lastResult?.pulled ?? 0} pulled.`
  else el.textContent = state.configured ? 'Not synced yet.' : 'Save a repo and token first.'
}

function renderIntegrations(list: IntegrationInfo[]) {
  $<HTMLUListElement>('integrations').replaceChildren(
    ...list.map((integration) => {
      const li = document.createElement('li')
      li.className = `integration${integration.status === 'planned' ? ' planned' : ''}`
      const text = document.createElement('div')
      text.className = 'integration-text'
      const name = document.createElement('strong')
      name.textContent = integration.name
      const description = document.createElement('span')
      description.textContent = integration.description
      const detail = document.createElement('span')
      detail.className = 'hint small'
      detail.textContent = integration.detail
      text.append(name, description, detail)

      const control = document.createElement('label')
      control.className = 'switch'
      if (integration.status === 'planned') {
        control.textContent = 'Planned'
        control.className = 'badge'
      } else {
        const box = document.createElement('input')
        box.type = 'checkbox'
        box.checked = integration.enabled
        box.setAttribute('aria-label', `Turn ${integration.name} on`)
        box.onchange = async () => {
          // Sites it reads are asked for at the moment it's turned on (this click is the user gesture Chrome needs).
          if (box.checked && integration.hosts.length && !(await chrome.permissions.request({ origins: integration.hosts }))) {
            box.checked = false
            return
          }
          renderIntegrations(await send({ type: 'setIntegration', id: integration.id, enabled: box.checked }))
        }
        control.append(box, document.createTextNode(integration.enabled ? 'On' : 'Off'))
      }
      li.append(text, control)
      return li
    })
  )
}

async function init() {
  saved = await loadConfig()
  if (saved) {
    owner.value = saved.owner
    repo.value = saved.repo
    branch.value = saved.branch
    token.placeholder = 'Saved. Paste a new token to replace it.'
  }

  $<HTMLFormElement>('form').onsubmit = async (e) => {
    e.preventDefault()
    const config = current()
    if (!config.token) return setStatus('Paste a personal access token.', 'error')
    await saveConfig(config)
    saved = config
    token.value = ''
    token.placeholder = 'Saved. Paste a new token to replace it.'
    setStatus('Saved. Syncing…', 'ok')
    await send({ type: 'configChanged' })
  }

  $('test').onclick = async () => {
    const config = current()
    if (!config.owner || !config.repo || !config.token) return setStatus('Fill in the repo and token first.', 'error')
    setStatus('Testing…')
    try {
      await verifyRepoAccess(config.token, config.owner, config.repo)
      setStatus(`Can access ${config.owner}/${config.repo}.`, 'ok')
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err), 'error')
    }
  }

  $('sync').onclick = () => void send({ type: 'sync' })

  onChanged(() => void send({ type: 'snapshot' }).then(renderSync))
  renderSync(await send({ type: 'snapshot' }))
  renderIntegrations(await send({ type: 'integrations' }))
}

init().catch((err: unknown) => setStatus(err instanceof Error ? err.message : String(err), 'error'))
