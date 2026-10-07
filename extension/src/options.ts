import { verifyRepoAccess } from '@shared/github'
import { loadConfig, saveConfig, type ExtensionConfig } from './todo'

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
    setStatus('Saved.', 'ok')
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
}

void init()
