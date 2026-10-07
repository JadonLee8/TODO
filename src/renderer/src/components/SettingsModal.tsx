import { useState } from 'react'
import { useAppState } from '../state/AppStateContext'

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const { localSettings, saveLocalSettings, saveToken, clearToken, verifyToken, syncedSettings, saveSyncedSettings } = useAppState()

  const [owner, setOwner] = useState(localSettings.githubOwner)
  const [repo, setRepo] = useState(localSettings.githubRepo)
  const [branch, setBranch] = useState(localSettings.githubBranch)
  const [tokenInput, setTokenInput] = useState('')
  const [testStatus, setTestStatus] = useState<{ ok: boolean; message: string } | null>(null)
  const [testing, setTesting] = useState(false)

  const [midPriorityWeight, setMidPriorityWeight] = useState(syncedSettings.ranking.midPriorityWeight)
  const [ageNormalizationDays, setAgeNormalizationDays] = useState(syncedSettings.ranking.ageNormalizationDays)
  const [archiveAfterDays, setArchiveAfterDays] = useState(syncedSettings.archive.archiveAfterDays)
  const [starredFirst, setStarredFirst] = useState(syncedSettings.ranking.starredFirst ?? false)

  async function commitRepoField(field: 'githubOwner' | 'githubRepo' | 'githubBranch', value: string) {
    await saveLocalSettings({
      githubOwner: field === 'githubOwner' ? value : owner,
      githubRepo: field === 'githubRepo' ? value : repo,
      githubBranch: field === 'githubBranch' ? value : branch
    })
  }

  async function handleSaveToken() {
    if (!tokenInput.trim()) return
    await saveToken(tokenInput.trim())
    setTokenInput('')
    setTestStatus(null)
  }

  async function handleTest() {
    setTesting(true)
    setTestStatus(null)
    const result = await verifyToken()
    setTestStatus(result.ok ? { ok: true, message: `Connected as ${result.login}` } : { ok: false, message: result.error ?? 'Connection failed' })
    setTesting(false)
  }

  async function commitRanking(overrides: { starredFirst?: boolean } = {}) {
    await saveSyncedSettings({
      ...syncedSettings,
      ranking: { midPriorityWeight, ageNormalizationDays, starredFirst: overrides.starredFirst ?? starredFirst },
      archive: { archiveAfterDays }
    })
  }

  return (
    <div className="overlay centered" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button className="close-x" onClick={onClose}>
          &#10005;
        </button>
        <h2>Settings</h2>

        <div className="settings-section" style={{ borderTop: 'none', marginTop: 0 }}>
          <h3>GitHub sync</h3>
          <p className="hint">Tasks are stored as JSON files in this repo. Use a fine-grained personal access token scoped to just this repo (Contents: read and write).</p>

          <div className="field">
            <label>Repo owner</label>
            <input
              type="text"
              placeholder="e.g. jadonlee888"
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
              onBlur={(e) => void commitRepoField('githubOwner', e.target.value)}
            />
          </div>
          <div className="field">
            <label>Repo name</label>
            <input
              type="text"
              placeholder="e.g. todo-data"
              value={repo}
              onChange={(e) => setRepo(e.target.value)}
              onBlur={(e) => void commitRepoField('githubRepo', e.target.value)}
            />
          </div>
          <div className="field">
            <label>Branch</label>
            <input
              type="text"
              placeholder="main"
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              onBlur={(e) => void commitRepoField('githubBranch', e.target.value)}
            />
          </div>

          <div className="field">
            <label>Personal access token {localSettings.hasToken ? '(saved — encrypted on this device)' : '(not set)'}</label>
            <input type="password" placeholder="github_pat_..." value={tokenInput} onChange={(e) => setTokenInput(e.target.value)} />
          </div>

          <div className="button-row">
            <button className="btn primary" onClick={() => void handleSaveToken()} disabled={!tokenInput.trim()}>
              Save token
            </button>
            <button className="btn" onClick={() => void handleTest()} disabled={testing || !localSettings.hasToken}>
              {testing ? 'Testing…' : 'Test connection'}
            </button>
            <button className="btn danger" onClick={() => void clearToken()} disabled={!localSettings.hasToken}>
              Clear token
            </button>
          </div>
          {testStatus && <div className={`status-line ${testStatus.ok ? 'ok' : 'error'}`}>{testStatus.message}</div>}
        </div>

        <div className="settings-section">
          <h3>Priority ranking</h3>
          <p className="hint">
            How P2/P3 tasks are blended in the main Tasks list. P1 always sits on top by age; P4 always sits above P5.
          </p>
          <div className="field">
            <label>
              Age vs. priority weight: {Math.round(midPriorityWeight * 100)}% priority / {Math.round((1 - midPriorityWeight) * 100)}% age
            </label>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={midPriorityWeight}
              onChange={(e) => setMidPriorityWeight(Number(e.target.value))}
              onMouseUp={() => void commitRanking()}
              onTouchEnd={() => void commitRanking()}
            />
          </div>
          <div className="field">
            <label>Days until age factor maxes out</label>
            <input
              type="text"
              inputMode="numeric"
              value={ageNormalizationDays}
              onChange={(e) => setAgeNormalizationDays(Number(e.target.value) || 0)}
              onBlur={() => void commitRanking()}
            />
          </div>
          <label className="checkbox-field">
            <input
              type="checkbox"
              checked={starredFirst}
              onChange={(e) => {
                setStarredFirst(e.target.checked)
                void commitRanking({ starredFirst: e.target.checked })
              }}
            />
            Sort important (★) tasks to the top of their priority level, and of other lists
          </label>
        </div>

        <div className="settings-section">
          <h3>Completed tasks</h3>
          <div className="field">
            <label>Auto-archive completed tasks after (days)</label>
            <input
              type="text"
              inputMode="numeric"
              value={archiveAfterDays}
              onChange={(e) => setArchiveAfterDays(Number(e.target.value) || 0)}
              onBlur={() => void commitRanking()}
            />
          </div>
        </div>

        <div className="settings-section">
          <h3>
            Import from Microsoft To Do <span className="badge-coming-soon">Coming soon</span>
          </h3>
          <p className="hint">Requires registering an Azure AD app for Microsoft Graph access. Not yet configured.</p>
        </div>

        <div className="settings-section">
          <h3>
            Google Calendar integration <span className="badge-coming-soon">Coming soon</span>
          </h3>
          <p className="hint">
            Requires a Google Cloud OAuth client (Desktop app type). Once you provide a client ID and secret, this will let you pick
            specific calendars and auto-import events as tasks within a date range, promoting overdue ones to P1.
          </p>
        </div>
      </div>
    </div>
  )
}
