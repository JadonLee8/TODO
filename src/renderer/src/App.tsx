import { useEffect, useRef, useState } from 'react'
import type { Task } from '@shared/types'
import { MAIN_LIST_ID } from '@shared/types'
import { useAppState } from './state/AppStateContext'
import { Sidebar } from './components/Sidebar'
import { TaskListView } from './components/TaskListView'
import { TaskDetailPanel } from './components/TaskDetailPanel'
import { ConflictModal } from './components/ConflictModal'
import { SettingsModal } from './components/SettingsModal'

export default function App() {
  const { loading, tasks, lists, conflicts, view, syncing, lastSyncResult, runSync } = useAppState()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [openTaskId, setOpenTaskId] = useState<string | null>(null)
  const [openConflictTaskId, setOpenConflictTaskId] = useState<string | null>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  // Ctrl+F / Ctrl+K focus the sidebar search box.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.key === 'f' || e.key === 'k')) {
        e.preventDefault()
        searchInputRef.current?.focus()
        searchInputRef.current?.select()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  if (loading) {
    return <div className="empty-state">Loading…</div>
  }

  let title: string
  if (view.kind === 'search') title = `Search: "${view.query}"`
  else if (view.kind === 'important') title = 'Important'
  else if (view.listId === MAIN_LIST_ID) title = 'Tasks'
  else title = lists.find((l) => l.id === view.listId)?.name ?? 'Tasks'

  return (
    <div className="app-shell">
      <Sidebar onOpenSettings={() => setSettingsOpen(true)} searchInputRef={searchInputRef} />

      <div className="main-content">
        <div className="content-header">
          <div>
            <h1>{title}</h1>
            {lastSyncResult && (
              <div className="sync-meta">
                {lastSyncResult.error
                  ? `Sync failed: ${lastSyncResult.error}`
                  : `Synced — ${lastSyncResult.pushed} pushed, ${lastSyncResult.pulled} pulled${
                      lastSyncResult.conflicts.length ? `, ${lastSyncResult.conflicts.length} conflict(s)` : ''
                    }`}
              </div>
            )}
          </div>
          <div className="header-actions">
            {conflicts.length > 0 && <span className="sync-meta">⚠ {conflicts.length} unresolved conflict(s)</span>}
            <button className="sync-button" onClick={() => void runSync()} disabled={syncing}>
              {syncing ? 'Syncing…' : '⇅ Sync'}
            </button>
          </div>
        </div>

        <TaskListView
          view={view}
          onOpenTask={(task: Task) => setOpenTaskId(task.id)}
          onOpenConflict={(taskId: string) => setOpenConflictTaskId(taskId)}
        />
      </div>

      {openTaskId &&
        (() => {
          const liveTask = tasks.find((t) => t.id === openTaskId)
          return liveTask ? <TaskDetailPanel task={liveTask} onClose={() => setOpenTaskId(null)} /> : null
        })()}
      {openConflictTaskId &&
        (() => {
          const liveConflict = conflicts.find((c) => c.taskId === openConflictTaskId)
          return liveConflict ? <ConflictModal conflict={liveConflict} onClose={() => setOpenConflictTaskId(null)} /> : null
        })()}
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
    </div>
  )
}
