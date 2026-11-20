import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Task } from '@shared/types'
import { MAIN_LIST_ID } from '@shared/types'
import { resolveTheme } from '@shared/themes'
import { resolveFont } from '@shared/fonts'
import { resolveStyle } from '@shared/styles'
import { useAppState } from './state/AppStateContext'
import { applyAppearance } from './theme'
import { Sidebar } from './components/Sidebar'
import { TaskListView } from './components/TaskListView'
import { TaskDetailPanel } from './components/TaskDetailPanel'
import { ConflictModal } from './components/ConflictModal'
import { useUpdateState } from './components/UpdatesSection'
import { SettingsModal } from './components/SettingsModal'
import { ActivityModal } from './components/ActivityModal'
import { ExtensionsModal } from './components/extensions/ExtensionsModal'
import { StatsView } from './components/StatsView'
import { ContentHeader } from './components/ContentHeader'
import { TerminalShell } from './components/terminal/TerminalShell'
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
  const update = useUpdateState()
  // On a phone the sidebar is a drawer over the list (see the Android rules in global.css).
  const [drawerOpen, setDrawerOpen] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)
  /** Bumped to make the terminal style start an `add` at its prompt (the widget's "+"). */
  const [terminalAddRequest, setTerminalAddRequest] = useState(0)

  const savedTheme = useMemo(() => resolveTheme(syncedSettings.appearance), [syncedSettings.appearance])
  const font = resolveFont(syncedSettings.appearance.fontId)
  const style = resolveStyle(syncedSettings.appearance.styleId)
  const terminal = style.id === 'terminal'
  useEffect(() => {
    // Wait for settings to load, so the cached look isn't replaced by the defaults for a moment.
    if (loading) return
    if (previewTheme) applyAppearance(previewTheme, font, style, { remember: false })
    else applyAppearance(savedTheme, font, style)
  }, [loading, savedTheme, previewTheme, font, style])

  // Stable, so the terminal's command host isn't rebuilt on every render.
  const openSettings = useCallback(() => {
    setDrawerOpen(false)
    setSettingsOpen(true)
  }, [])

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
      if (terminal) setTerminalAddRequest((n) => n + 1)
      else requestAnimationFrame(() => document.querySelector<HTMLInputElement>('.add-task-bar input')?.focus())
    })
  }, [loading, setView, terminal])

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
      {update?.status.state === 'ready' && (
        <button className="update-ready" onClick={() => void window.api.updates?.install()} data-tooltip={`Restart into version ${update.status.version}`}>
          Update ready
        </button>
      )}
      {conflicts.length > 0 && (
        <button className="conflict-count" onClick={() => setOpenConflictTaskId(conflicts[0].taskId)}>
          {conflicts.length} unresolved conflict{conflicts.length === 1 ? '' : 's'}
        </button>
      )}
      <button className="sync-button" onClick={() => void runSync()} disabled={syncing}>
        <span aria-hidden>⇅</span>
        {syncing ? 'Syncing…' : 'Sync'}
      </button>
    </>
  )

  const overlays = (
    <>
      {openTaskId &&
        (() => {
          const liveTask = tasks.find((t) => t.id === openTaskId)
          return liveTask ? <TaskDetailPanel task={liveTask} onClose={() => setOpenTaskId(null)} /> : null
        })()}
      {openConflictTaskId &&
        (() => {
          const index = conflicts.findIndex((c) => c.taskId === openConflictTaskId)
          if (index < 0) return null
          // After a pick, go on to the next unresolved conflict (wrapping round), or close when it was the last.
          const next = conflicts[index + 1] ?? conflicts.find((c) => c.taskId !== openConflictTaskId)
          return (
            <ConflictModal
              conflict={conflicts[index]}
              position={conflicts.length > 1 ? `${index + 1} of ${conflicts.length}` : undefined}
              onClose={() => setOpenConflictTaskId(null)}
              onResolved={() => setOpenConflictTaskId(next?.taskId ?? null)}
            />
          )
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
    </>
  )

  if (terminal) {
    return (
      <div className="term-root">
        <TerminalShell onOpenTask={setOpenTaskId} onOpenConflict={setOpenConflictTaskId} onOpenSettings={openSettings} addRequest={terminalAddRequest} />
        {overlays}
      </div>
    )
  }

  return (
    <div className={`app-shell${drawerOpen ? ' drawer-open' : ''}`}>
      <Sidebar
        onOpenSettings={openSettings}
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

      {overlays}
    </div>
  )
}
