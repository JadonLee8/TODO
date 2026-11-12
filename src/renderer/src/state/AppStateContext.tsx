import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type {
  EditableLocalSettings,
  LocalSettings,
  Priority,
  SyncConflict,
  SyncResult,
  SyncedSettings,
  Task,
  Theme,
  TaskFolder,
  TaskList
} from '@shared/types'
import { DEFAULT_LOCAL_SETTINGS, DEFAULT_SYNCED_SETTINGS, MAIN_LIST_ID } from '@shared/types'
import type { TokenCheckResult } from '@shared/ipc'
import { newId } from '@shared/id'
import { taskIdsToArchive } from '@shared/archive'
import { nextOrderInFolder, nextTopLevelOrder, reorderSidebar, type DropPosition, type SidebarItem } from '@shared/sidebarTree'
import {
  MAX_ACTIVITY_ENTRIES,
  NO_CHANGES,
  applyEntityChanges,
  changedSince,
  describeSidebarMove,
  describeTaskEdit,
  diffById,
  hasChanges,
  undoChanges,
  type ActivityChanges,
  type ActivityEntry,
  type EntityChange
} from '@shared/activity'

/** What the main pane is showing. */
export type View = { kind: 'list'; listId: string } | { kind: 'important' } | { kind: 'search'; query: string }

interface AppState {
  loading: boolean
  tasks: Task[]
  lists: TaskList[]
  syncedSettings: SyncedSettings
  localSettings: LocalSettings
  view: View
  conflicts: SyncConflict[]
  syncing: boolean
  lastSyncResult: SyncResult | null

  selectList: (id: string) => void
  setView: (view: View) => void
  /** Switches to the search view; a blank query returns to the view that was showing before the search. */
  setSearchQuery: (query: string) => void
  addTask: (input: { title: string; listId: string; priority?: Priority; starred?: boolean }) => Promise<void>
  updateTask: (task: Task) => Promise<void>
  toggleComplete: (task: Task) => Promise<void>
  toggleStarred: (task: Task) => Promise<void>
  /** Moves a task to another list; a no-op if it is already there. */
  moveTask: (id: string, listId: string) => Promise<void>
  starTask: (id: string) => Promise<void>
  deleteTask: (id: string) => Promise<void>

  addList: (name: string) => Promise<void>
  renameList: (id: string, name: string) => Promise<void>
  deleteList: (id: string) => Promise<void>

  folders: TaskFolder[]
  /** Creates a folder at the bottom of the top level and returns its id. */
  addFolder: (name: string) => Promise<string | null>
  renameFolder: (id: string, name: string) => Promise<void>
  /** Deletes a folder; its lists move back to the top level (nothing else is deleted). */
  deleteFolder: (id: string) => Promise<void>
  /** Moves a list into a folder, or to the top level with null. */
  moveListToFolder: (listId: string, folderId: string | null) => Promise<void>
  /** Drag-and-drop reordering in the sidebar; a null target means the end of the top level. */
  moveSidebarItem: (dragged: SidebarItem, target: SidebarItem | null, position: DropPosition) => Promise<void>

  /** Changes made on this device, newest first. */
  activity: ActivityEntry[]
  undoActivity: (entryId: string) => Promise<void>
  /** Names of things an entry changed that have changed again since (undoing would overwrite them). */
  activityConflicts: (entry: ActivityEntry) => string[]

  saveSyncedSettings: (settings: SyncedSettings) => Promise<void>
  /** A theme being edited, shown in place of the saved one until the edit is saved or cancelled. */
  previewTheme: Theme | null
  setPreviewTheme: (theme: Theme | null) => void
  saveLocalSettings: (settings: Partial<EditableLocalSettings>) => Promise<void>
  saveToken: (token: string) => Promise<void>
  clearToken: () => Promise<void>
  verifyToken: () => Promise<TokenCheckResult>
  refreshLocalSettings: () => Promise<void>
  reloadTasks: () => Promise<void>

  runSync: () => Promise<void>
  resolveConflictKeepLocal: (taskId: string) => Promise<void>
  resolveConflictKeepRemote: (taskId: string) => Promise<void>
}

const Ctx = createContext<AppState | null>(null)

export function AppStateProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [loading, setLoading] = useState(true)
  const [tasks, setTasks] = useState<Task[]>([])
  const [lists, setLists] = useState<TaskList[]>([])
  const [folders, setFolders] = useState<TaskFolder[]>([])
  const [syncedSettings, setSyncedSettings] = useState<SyncedSettings>(DEFAULT_SYNCED_SETTINGS)
  const [localSettings, setLocalSettings] = useState<LocalSettings>(DEFAULT_LOCAL_SETTINGS)
  const [previewTheme, setPreviewTheme] = useState<Theme | null>(null)
  const [view, setView] = useState<View>({ kind: 'list', listId: MAIN_LIST_ID })
  const viewBeforeSearch = useRef<View>(view)
  const [conflicts, setConflicts] = useState<SyncConflict[]>([])
  const [syncing, setSyncing] = useState(false)
  const [lastSyncResult, setLastSyncResult] = useState<SyncResult | null>(null)
  const [activity, setActivity] = useState<ActivityEntry[]>([])
  const activityLoaded = useRef(false)

  useEffect(() => {
    void (async () => {
      const [loadedTasks, loadedLists, loadedFolders, loadedSyncedSettings, loadedLocalSettings, loadedConflicts, loadedActivity] = await Promise.all([
        window.api.tasks.getAll(),
        window.api.lists.getAll(),
        window.api.folders.getAll(),
        window.api.settings.getSynced(),
        window.api.settings.getLocal(),
        window.api.sync.getPendingConflicts(),
        window.api.activity.getAll()
      ])

      let finalLists = loadedLists
      if (!finalLists.some((l) => l.id === MAIN_LIST_ID)) {
        finalLists = [{ id: MAIN_LIST_ID, name: 'Tasks', order: -1 }, ...finalLists]
        await window.api.lists.save(finalLists)
      }

      setTasks(loadedTasks)
      setLists(finalLists)
      setFolders(loadedFolders)
      setSyncedSettings(loadedSyncedSettings)
      setLocalSettings(loadedLocalSettings)
      setConflicts(loadedConflicts)
      activityLoaded.current = true
      setActivity(loadedActivity)
      setLoading(false)
    })()
  }, [])

  useEffect(() => {
    if (activityLoaded.current) void window.api.activity.save(activity)
  }, [activity])

  const selectList = useCallback((id: string) => setView({ kind: 'list', listId: id }), [])

  const setSearchQuery = useCallback((query: string) => {
    setView((prev) => {
      if (!query.trim()) return prev.kind === 'search' ? viewBeforeSearch.current : prev
      if (prev.kind !== 'search') viewBeforeSearch.current = prev
      return { kind: 'search', query }
    })
  }, [])

  // Current state for callbacks that need it without being recreated on every change.
  const stateRef = useRef({ tasks, lists, folders })
  stateRef.current = { tasks, lists, folders }
  const listName = useCallback((id: string) => stateRef.current.lists.find((l) => l.id === id)?.name ?? 'Tasks', [])

  /** Adds an entry to the activity log. Returns null (and logs nothing) when nothing actually changed. */
  const record = useCallback((summary: string, changes: ActivityChanges, extra: Partial<ActivityEntry> = {}): ActivityEntry | null => {
    if (!hasChanges(changes)) return null
    const entry: ActivityEntry = { id: newId(), at: new Date().toISOString(), summary, changes, ...extra }
    setActivity((prev) => [entry, ...prev].slice(0, MAX_ACTIVITY_ENTRIES))
    return entry
  }, [])

  // ---- Plain writers: save a change without logging it ----

  const persistTask = useCallback(async (task: Task) => {
    setTasks((prev) => (prev.some((t) => t.id === task.id) ? prev.map((t) => (t.id === task.id ? task : t)) : [...prev, task]))
    await window.api.tasks.upsert(task)
  }, [])

  const removeTask = useCallback(async (id: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== id))
    await window.api.tasks.remove(id)
  }, [])

  const saveLists = useCallback(async (next: TaskList[]) => {
    setLists(next)
    await window.api.lists.save(next)
  }, [])

  const saveFolders = useCallback(async (next: TaskFolder[]) => {
    setFolders(next)
    await window.api.folders.save(next)
  }, [])

  // ---- User actions: save and log ----

  const addTask = useCallback(
    async (input: { title: string; listId: string; priority?: Priority; starred?: boolean }) => {
      const now = new Date().toISOString()
      const task: Task = {
        id: newId(),
        listId: input.listId,
        title: input.title.trim(),
        notes: '',
        priority: input.priority ?? 3,
        starred: input.starred ?? false,
        completed: false,
        createdAt: now,
        updatedAt: now,
        completedAt: null,
        archived: false,
        dueDate: null,
        source: null
      }
      await persistTask(task)
      record(`Added “${task.title}” to ${listName(task.listId)}`, { ...NO_CHANGES, tasks: [{ id: task.id, before: null, after: task }] })
    },
    [persistTask, record, listName]
  )

  const updateTask = useCallback(
    async (task: Task) => {
      const before = stateRef.current.tasks.find((t) => t.id === task.id) ?? null
      const updated: Task = { ...task, updatedAt: new Date().toISOString() }
      await persistTask(updated)
      if (before) record(describeTaskEdit(before, updated, listName), { ...NO_CHANGES, tasks: [{ id: task.id, before, after: updated }] })
    },
    [persistTask, record, listName]
  )

  const toggleComplete = useCallback(
    async (task: Task) => {
      const completed = !task.completed
      await updateTask({ ...task, completed, completedAt: completed ? new Date().toISOString() : null })
    },
    [updateTask]
  )

  const toggleStarred = useCallback(async (task: Task) => updateTask({ ...task, starred: !task.starred }), [updateTask])

  const moveTask = useCallback(
    async (id: string, listId: string) => {
      const task = tasks.find((t) => t.id === id)
      if (!task || task.listId === listId) return
      await updateTask({ ...task, listId })
    },
    [tasks, updateTask]
  )

  const starTask = useCallback(
    async (id: string) => {
      const task = tasks.find((t) => t.id === id)
      if (!task || task.starred) return
      await updateTask({ ...task, starred: true })
    },
    [tasks, updateTask]
  )

  // Auto-archive completed tasks older than the configured retention window. Not logged: it's housekeeping.
  useEffect(() => {
    if (loading) return
    const idsToArchive = taskIdsToArchive(tasks, syncedSettings.archive)
    if (idsToArchive.length === 0) return
    const idSet = new Set(idsToArchive)
    const now = new Date().toISOString()
    for (const task of tasks) {
      if (idSet.has(task.id)) void persistTask({ ...task, archived: true, updatedAt: now })
    }
  }, [loading, tasks, syncedSettings.archive, persistTask])

  const deleteTask = useCallback(
    async (id: string) => {
      const before = stateRef.current.tasks.find((t) => t.id === id)
      await removeTask(id)
      if (before) record(`Deleted task “${before.title}”`, { ...NO_CHANGES, tasks: [{ id, before, after: null }] })
    },
    [removeTask, record]
  )

  const addList = useCallback(
    async (name: string) => {
      const trimmed = name.trim()
      if (!trimmed) return
      const list: TaskList = { id: newId(), name: trimmed, order: nextTopLevelOrder(lists, folders), folderId: null }
      const next = [...lists, list]
      await saveLists(next)
      record(`Created list “${trimmed}”`, { ...NO_CHANGES, lists: diffById(lists, next) })
    },
    [lists, folders, saveLists, record]
  )

  const renameList = useCallback(
    async (id: string, name: string) => {
      const trimmed = name.trim()
      const old = lists.find((l) => l.id === id)
      if (!trimmed || !old || old.name === trimmed) return
      const next = lists.map((l) => (l.id === id ? { ...l, name: trimmed } : l))
      await saveLists(next)
      record(`Renamed list “${old.name}” to “${trimmed}”`, { ...NO_CHANGES, lists: diffById(lists, next) })
    },
    [lists, saveLists, record]
  )

  const deleteList = useCallback(
    async (id: string) => {
      const list = lists.find((l) => l.id === id)
      if (id === MAIN_LIST_ID || !list) return
      // Tasks in a deleted list move back to the main Tasks list rather than being lost.
      const now = new Date().toISOString()
      const taskChanges: EntityChange<Task>[] = []
      for (const t of tasks.filter((t) => t.listId === id)) {
        const moved = { ...t, listId: MAIN_LIST_ID, updatedAt: now }
        await persistTask(moved)
        taskChanges.push({ id: t.id, before: t, after: moved })
      }
      const next = lists.filter((l) => l.id !== id)
      await saveLists(next)
      const n = taskChanges.length
      record(`Deleted list “${list.name}”${n ? ` and moved its ${n} task${n === 1 ? '' : 's'} to Tasks` : ''}`, {
        ...NO_CHANGES,
        tasks: taskChanges,
        lists: diffById(lists, next)
      })
    },
    [lists, tasks, saveLists, persistTask, record]
  )

  const saveSyncedSettings = useCallback(async (settings: SyncedSettings) => {
    setSyncedSettings(settings)
    await window.api.settings.saveSynced(settings)
  }, [])

  const saveLocalSettings = useCallback(
    async (settings: Partial<EditableLocalSettings>) => {
      setLocalSettings((prev) => ({ ...prev, ...settings }))
      await window.api.settings.saveLocal(settings)
    },
    []
  )

  const saveToken = useCallback(async (token: string) => {
    await window.api.settings.saveToken(token)
    setLocalSettings((prev) => ({ ...prev, hasToken: true }))
  }, [])

  const clearToken = useCallback(async () => {
    await window.api.settings.clearToken()
    setLocalSettings((prev) => ({ ...prev, hasToken: false }))
  }, [])

  const verifyToken = useCallback(() => window.api.settings.verifyToken(), [])

  /** Re-reads local settings from the main process (e.g. after connecting to Google). */
  const refreshLocalSettings = useCallback(async () => {
    setLocalSettings(await window.api.settings.getLocal())
  }, [])

  /** Reloads tasks after something in the main process wrote them (e.g. a calendar import). */
  const reloadTasks = useCallback(async () => {
    setTasks(await window.api.tasks.getAll())
  }, [])

  const addFolder = useCallback(
    async (name: string) => {
      const trimmed = name.trim()
      if (!trimmed) return null
      const folder: TaskFolder = { id: newId(), name: trimmed, order: nextTopLevelOrder(lists, folders) }
      const next = [...folders, folder]
      await saveFolders(next)
      record(`Created folder “${trimmed}”`, { ...NO_CHANGES, folders: diffById(folders, next) })
      return folder.id
    },
    [lists, folders, saveFolders, record]
  )

  const renameFolder = useCallback(
    async (id: string, name: string) => {
      const trimmed = name.trim()
      const old = folders.find((f) => f.id === id)
      if (!trimmed || !old || old.name === trimmed) return
      const next = folders.map((f) => (f.id === id ? { ...f, name: trimmed } : f))
      await saveFolders(next)
      record(`Renamed folder “${old.name}” to “${trimmed}”`, { ...NO_CHANGES, folders: diffById(folders, next) })
    },
    [folders, saveFolders, record]
  )

  const deleteFolder = useCallback(
    async (id: string) => {
      const folder = folders.find((f) => f.id === id)
      if (!folder) return
      const remaining = folders.filter((f) => f.id !== id)
      // Its lists go back to the top level, after everything already there, keeping their relative order.
      let order = nextTopLevelOrder(lists, remaining)
      const contained = lists.filter((l) => l.folderId === id).sort((a, b) => a.order - b.order)
      const newOrder = new Map(contained.map((l) => [l.id, order++]))
      const nextLists = lists.map((l) => (newOrder.has(l.id) ? { ...l, folderId: null, order: newOrder.get(l.id)! } : l))
      if (contained.length) await saveLists(nextLists)
      await saveFolders(remaining)
      const n = contained.length
      record(`Deleted folder “${folder.name}”${n ? ` and moved its ${n} list${n === 1 ? '' : 's'} out` : ''}`, {
        ...NO_CHANGES,
        lists: diffById(lists, nextLists),
        folders: diffById(folders, remaining)
      })
    },
    [lists, folders, saveLists, saveFolders, record]
  )

  const moveListToFolder = useCallback(
    async (listId: string, folderId: string | null) => {
      const list = lists.find((l) => l.id === listId)
      if (!list || listId === MAIN_LIST_ID || (list.folderId ?? null) === folderId) return
      const others = lists.filter((l) => l.id !== listId)
      const order = folderId ? nextOrderInFolder(others, folderId) : nextTopLevelOrder(others, folders)
      const next = lists.map((l) => (l.id === listId ? { ...l, folderId, order } : l))
      await saveLists(next)
      const changes = { ...NO_CHANGES, lists: diffById(lists, next) }
      record(describeSidebarMove(changes, folders, { kind: 'list', id: listId }), changes)
    },
    [lists, folders, saveLists, record]
  )

  const moveSidebarItem = useCallback(
    async (dragged: SidebarItem, target: SidebarItem | null, position: DropPosition) => {
      const next = reorderSidebar(lists, folders, dragged, target, position)
      if (!next) return
      if (next.lists.some((l, i) => l !== lists[i])) await saveLists(next.lists)
      if (next.folders.some((f, i) => f !== folders[i])) await saveFolders(next.folders)
      const changes = { ...NO_CHANGES, lists: diffById(lists, next.lists), folders: diffById(folders, next.folders) }
      record(describeSidebarMove(changes, next.folders, dragged), changes)
    },
    [lists, folders, saveLists, saveFolders, record]
  )

  /**
   * Undoes a logged change by writing back the earlier state of everything it touched. That is itself a new change
   * (logged, and synced as new commits), so an undo can be undone too ("redo").
   */
  const undoActivity = useCallback(
    async (entryId: string) => {
      const entry = activity.find((e) => e.id === entryId)
      if (!entry || entry.undoneBy) return
      const current = stateRef.current
      const changes = undoChanges(entry, current)
      const now = new Date().toISOString()
      changes.tasks = changes.tasks.map((c) => (c.after ? { ...c, after: { ...c.after, updatedAt: now } } : c))
      for (const c of changes.tasks) await (c.after ? persistTask(c.after) : removeTask(c.id))
      if (changes.lists.length) await saveLists(applyEntityChanges(current.lists, changes.lists, 'after'))
      if (changes.folders.length) await saveFolders(applyEntityChanges(current.folders, changes.folders, 'after'))

      const undo: ActivityEntry = { id: newId(), at: now, summary: undoSummary(entry.summary), changes, undoes: entry.id }
      // Only the newest entry in an undo/redo chain stays undoable, so each change has one Undo button.
      setActivity((prev) => [undo, ...prev.map((e) => (e.id === entry.id ? { ...e, undoneBy: undo.id } : e))].slice(0, MAX_ACTIVITY_ENTRIES))
    },
    [activity, persistTask, removeTask, saveLists, saveFolders]
  )

  const activityConflicts = useCallback((entry: ActivityEntry) => changedSince(entry, stateRef.current), [])

  // If the list being shown disappears (deleted, undone, or removed by a sync), go back to the main list.
  useEffect(() => {
    if (loading || view.kind !== 'list' || lists.some((l) => l.id === view.listId)) return
    setView({ kind: 'list', listId: MAIN_LIST_ID })
  }, [loading, view, lists])
  useEffect(() => {
    const v = viewBeforeSearch.current
    if (v.kind === 'list' && !lists.some((l) => l.id === v.listId)) viewBeforeSearch.current = { kind: 'list', listId: MAIN_LIST_ID }
  }, [lists])

  const refreshFromCache = useCallback(async () => {
    const [nextTasks, nextLists, nextFolders, nextSettings, nextConflicts] = await Promise.all([
      window.api.tasks.getAll(),
      window.api.lists.getAll(),
      window.api.folders.getAll(),
      window.api.settings.getSynced(),
      window.api.sync.getPendingConflicts()
    ])
    setTasks(nextTasks)
    setLists(nextLists)
    setFolders(nextFolders)
    setSyncedSettings(nextSettings)
    setConflicts(nextConflicts)
  }, [])

  const runSync = useCallback(async () => {
    setSyncing(true)
    try {
      const result = await window.api.sync.run()
      setLastSyncResult(result)
      await refreshFromCache()
    } finally {
      setSyncing(false)
    }
  }, [refreshFromCache])

  const resolveConflictKeepLocal = useCallback(
    async (taskId: string) => {
      await window.api.sync.resolveKeepLocal(taskId)
      setConflicts((prev) => prev.filter((c) => c.taskId !== taskId))
    },
    []
  )

  const resolveConflictKeepRemote = useCallback(async (taskId: string) => {
    await window.api.sync.resolveKeepRemote(taskId)
    const nextTasks = await window.api.tasks.getAll()
    setTasks(nextTasks)
    setConflicts((prev) => prev.filter((c) => c.taskId !== taskId))
  }, [])

  const value = useMemo<AppState>(
    () => ({
      loading,
      tasks,
      lists,
      syncedSettings,
      localSettings,
      view,
      conflicts,
      syncing,
      lastSyncResult,
      selectList,
      setView,
      setSearchQuery,
      addTask,
      updateTask,
      toggleComplete,
      toggleStarred,
      moveTask,
      starTask,
      deleteTask,
      addList,
      renameList,
      deleteList,
      folders,
      addFolder,
      renameFolder,
      deleteFolder,
      moveListToFolder,
      moveSidebarItem,
      activity,
      undoActivity,
      activityConflicts,
      saveSyncedSettings,
      previewTheme,
      setPreviewTheme,
      saveLocalSettings,
      saveToken,
      clearToken,
      verifyToken,
      refreshLocalSettings,
      reloadTasks,
      runSync,
      resolveConflictKeepLocal,
      resolveConflictKeepRemote
    }),
    [
      loading,
      tasks,
      lists,
      syncedSettings,
      localSettings,
      view,
      conflicts,
      syncing,
      lastSyncResult,
      selectList,
      setView,
      setSearchQuery,
      addTask,
      updateTask,
      toggleComplete,
      toggleStarred,
      moveTask,
      starTask,
      deleteTask,
      addList,
      renameList,
      deleteList,
      folders,
      addFolder,
      renameFolder,
      deleteFolder,
      moveListToFolder,
      moveSidebarItem,
      activity,
      undoActivity,
      activityConflicts,
      saveSyncedSettings,
      previewTheme,
      saveLocalSettings,
      saveToken,
      clearToken,
      verifyToken,
      refreshLocalSettings,
      reloadTasks,
      runSync,
      resolveConflictKeepLocal,
      resolveConflictKeepRemote
    ]
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAppState(): AppState {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useAppState must be used within AppStateProvider')
  return ctx
}

/** "Undid: X" for an undo; undoing that gives "Redid: X", and so on. */
function undoSummary(summary: string): string {
  if (summary.startsWith('Undid: ')) return 'Redid: ' + summary.slice(7)
  if (summary.startsWith('Redid: ')) return 'Undid: ' + summary.slice(7)
  return 'Undid: ' + summary
}
