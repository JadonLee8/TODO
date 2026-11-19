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
import { ExtensionsModal } from './components/extensions/ExtensionsModal'
import { StatsView } from './components/StatsView'
import { ContentHeader } from './components/ContentHeader'
import { catalogEntry } from '@shared/extensions'
import { sharedTextToTask } from '@shared/share'
import { widgetSnapshot } from '@shared/widget'

export default function App() {
  const { loading, tasks, lists, conflicts, view, setView, syncing, lastSyncResult, runSync, syncedSettings, previewTheme, addTask } =
    useAppState()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [activityOpen, setActivityOpen] = useState(false)
  const [extensionsOpen, setExtensionsOpen] = useState(false)
  const [openTaskId, setOpenTaskId] = useState<string | null>(null)
  const [openConflictTaskId, setOpenConflictTaskId] = useState<string | null>(null)
  // On a phone the sidebar is a drawer over the list (see the Android rules in global.css).
  const [drawerOpen, setDrawerOpen] = useState(false)
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

  // Text shared from another app (Android) becomes a task in Tasks, opened so its title and list can be adjusted.
  const addTaskRef = useRef(addTask)
  addTaskRef.current = addTask
  useEffect(() => {
    if (loading || !window.api.shareTarget) return
    return window.api.shareTarget.onShare((shared) => {
      const input = sharedTextToTask(shared)
      if (!input) return
      void addTaskRef.current({ ...input, listId: MAIN_LIST_ID }).then((task) => {
        setDrawerOpen(false)
        setOpenTaskId(task.id)
      })
    })
  }, [loading])

  // Android home-screen widget: keep what it shows current, and open what was tapped on it.
  useEffect(() => {
    if (!loading) window.api.widget?.update(widgetSnapshot(tasks, syncedSettings))
  }, [loading, tasks, syncedSettings])
  useEffect(() => {
    if (loading || !window.api.widget) return
    return window.api.widget.onOpen((action) => {
      setDrawerOpen(false)
      if (action.kind === 'task') {
        setOpenTaskId(action.taskId)
        return
      }
      setOpenTaskId(null)
      setView({ kind: 'list', listId: MAIN_LIST_ID })
      requestAnimationFrame(() => document.querySelector<HTMLInputElement>('.add-task-bar input')?.focus())
    })
  }, [loading, setView])

  // Picking a list closes the drawer. Typing a search keeps it open so the box keeps focus.
  useEffect(() => {
    if (view.kind !== 'search') setDrawerOpen(false)
  }, [view])

  if (loading) {
    return <div className="loading">Loading your tasks…</div>
  }

  let title: string
  if (view.kind === 'search') title = 'Search'
  else if (view.kind === 'important') title = 'Important'
  else if (view.kind === 'stats') title = 'Stats'
  else if (view.listId === MAIN_LIST_ID) title = 'Tasks'
  else title = lists.find((l) => l.id === view.listId)?.name ?? 'Tasks'

  const syncStatus = lastSyncResult && (
    <p className={`sync-meta${lastSyncResult.error ? ' error' : ''}`}>
      {lastSyncResult.error
        ? `Sync failed: ${lastSyncResult.error}`
        : `Synced: ${lastSyncResult.pushed} pushed, ${lastSyncResult.pulled} pulled${
            lastSyncResult.conflicts.length ? `, ${lastSyncResult.conflicts.length} conflict${lastSyncResult.conflicts.length === 1 ? '' : 's'}` : ''
          }.`}
      {lastSyncResult.extensions.map((r) => {
        const name = catalogEntry(r.extensionId)?.name ?? r.extensionId
        if (r.error) return ` ${name} failed: ${r.error}.`
        return r.changedTasks ? ` ${name}: ${r.summary}.` : ''
      })}
    </p>
  )

  const actions = (
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
  )

  return (
    <div className={`app-shell${drawerOpen ? ' drawer-open' : ''}`}>
      <Sidebar
        onOpenSettings={() => {
          setDrawerOpen(false)
          setSettingsOpen(true)
        }}
        onOpenExtensions={() => setExtensionsOpen(true)}
        onSearchSubmit={() => setDrawerOpen(false)}
        searchInputRef={searchInputRef}
      />
      {/* Phone only (hidden on desktop by CSS). */}
      <div className="drawer-scrim" onClick={() => setDrawerOpen(false)} />
      <button className="menu-button" onClick={() => setDrawerOpen(true)} aria-label="Open lists">
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
          <path d="M2 4.5h14M2 9h14M2 13.5h14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      </button>

      <main className="main-content">
        {view.kind === 'stats' ? (
          <StatsView header={(summary) => <ContentHeader title={title} summary={summary} status={syncStatus} actions={actions} />} />
        ) : (
          <TaskListView
            view={view}
            title={title}
            status={syncStatus}
            actions={actions}
            onOpenTask={(task: Task) => setOpenTaskId(task.id)}
            onOpenConflict={(taskId: string) => setOpenConflictTaskId(taskId)}
          />
        )}
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
          onOpenExtensions={() => {
            setSettingsOpen(false)
            setExtensionsOpen(true)
          }}
        />
      )}
      {extensionsOpen && <ExtensionsModal onClose={() => setExtensionsOpen(false)} />}
      {activityOpen && <ActivityModal onClose={() => setActivityOpen(false)} />}
    </div>
  )
}
