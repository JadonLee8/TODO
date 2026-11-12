import { useEffect, useMemo, useRef, useState } from 'react'
import type { Task } from '@shared/types'
import { MAIN_LIST_ID } from '@shared/types'
import { resolveTheme } from '@shared/themes'
import { resolveFont } from '@shared/fonts'
import { useAppState } from './state/AppStateContext'
import { applyAppearance } from './theme'
import { Sidebar } from './components/Sidebar'
import { TaskListView } from './components/TaskListView'
import { TaskDetailPanel } from './components/TaskDetailPanel'
import { ConflictModal } from './components/ConflictModal'
import { SettingsModal } from './components/SettingsModal'
import { ActivityModal } from './components/ActivityModal'

export default function App() {
  const { loading, tasks, lists, conflicts, view, syncing, lastSyncResult, runSync, syncedSettings, previewTheme } = useAppState()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [activityOpen, setActivityOpen] = useState(false)
  const [openTaskId, setOpenTaskId] = useState<string | null>(null)
  const [openConflictTaskId, setOpenConflictTaskId] = useState<string | null>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  const savedTheme = useMemo(() => resolveTheme(syncedSettings.appearance), [syncedSettings.appearance])
  const font = resolveFont(syncedSettings.appearance.fontId)
  useEffect(() => {
    // Wait for settings to load, so the cached look isn't replaced by the defaults for a moment.
    if (loading) return
    if (previewTheme) applyAppearance(previewTheme, font, { remember: false })
    else applyAppearance(savedTheme, font)
  }, [loading, savedTheme, previewTheme, font])

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
    return <div className="loading">Loading your tasks…</div>
  }

  let title: string
  if (view.kind === 'search') title = 'Search'
  else if (view.kind === 'important') title = 'Important'
  else if (view.listId === MAIN_LIST_ID) title = 'Tasks'
  else title = lists.find((l) => l.id === view.listId)?.name ?? 'Tasks'

  const syncStatus = lastSyncResult && (
    <p className={`sync-meta${lastSyncResult.error ? ' error' : ''}`}>
      {lastSyncResult.error
        ? `Sync failed: ${lastSyncResult.error}`
        : `Synced: ${lastSyncResult.pushed} pushed, ${lastSyncResult.pulled} pulled${
            lastSyncResult.conflicts.length ? `, ${lastSyncResult.conflicts.length} conflict${lastSyncResult.conflicts.length === 1 ? '' : 's'}` : ''
          }.`}
      {lastSyncResult.calendarImport &&
        (lastSyncResult.calendarImport.error
          ? ` Calendar import failed: ${lastSyncResult.calendarImport.error}`
          : lastSyncResult.calendarImport.imported
            ? ` ${lastSyncResult.calendarImport.imported} imported from Google Calendar.`
            : '')}
    </p>
  )

  return (
    <div className="app-shell">
      <Sidebar onOpenSettings={() => setSettingsOpen(true)} searchInputRef={searchInputRef} />

      <main className="main-content">
        <TaskListView
          view={view}
          title={title}
          status={syncStatus}
          actions={
            <>
              {conflicts.length > 0 && (
                <span className="conflict-count">
                  {conflicts.length} unresolved conflict{conflicts.length === 1 ? '' : 's'}
                </span>
              )}
              <button className="sync-button" onClick={() => void runSync()} disabled={syncing}>
                <span aria-hidden>⇅</span>
                {syncing ? 'Syncing…' : 'Sync'}
              </button>
            </>
          }
          onOpenTask={(task: Task) => setOpenTaskId(task.id)}
          onOpenConflict={(taskId: string) => setOpenConflictTaskId(taskId)}
        />
      </main>

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
      {settingsOpen && (
        <SettingsModal
          onClose={() => setSettingsOpen(false)}
          onOpenActivity={() => {
            setSettingsOpen(false)
            setActivityOpen(true)
          }}
        />
      )}
      {activityOpen && <ActivityModal onClose={() => setActivityOpen(false)} />}
    </div>
  )
}
