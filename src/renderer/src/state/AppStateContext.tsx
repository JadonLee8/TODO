import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { LocalSettings, Priority, SyncConflict, SyncResult, SyncedSettings, Task, TaskList } from '@shared/types'
import { DEFAULT_LOCAL_SETTINGS, DEFAULT_SYNCED_SETTINGS, MAIN_LIST_ID } from '@shared/types'
import type { TokenCheckResult } from '@shared/ipc'
import { newId } from '@shared/id'
import { taskIdsToArchive } from '@shared/archive'

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

  saveSyncedSettings: (settings: SyncedSettings) => Promise<void>
  saveLocalSettings: (settings: Omit<LocalSettings, 'hasToken'>) => Promise<void>
  saveToken: (token: string) => Promise<void>
  clearToken: () => Promise<void>
  verifyToken: () => Promise<TokenCheckResult>

  runSync: () => Promise<void>
  resolveConflictKeepLocal: (taskId: string) => Promise<void>
  resolveConflictKeepRemote: (taskId: string) => Promise<void>
}

const Ctx = createContext<AppState | null>(null)

export function AppStateProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [loading, setLoading] = useState(true)
  const [tasks, setTasks] = useState<Task[]>([])
  const [lists, setLists] = useState<TaskList[]>([])
  const [syncedSettings, setSyncedSettings] = useState<SyncedSettings>(DEFAULT_SYNCED_SETTINGS)
  const [localSettings, setLocalSettings] = useState<LocalSettings>(DEFAULT_LOCAL_SETTINGS)
  const [view, setView] = useState<View>({ kind: 'list', listId: MAIN_LIST_ID })
  const viewBeforeSearch = useRef<View>(view)
  const [conflicts, setConflicts] = useState<SyncConflict[]>([])
  const [syncing, setSyncing] = useState(false)
  const [lastSyncResult, setLastSyncResult] = useState<SyncResult | null>(null)

  useEffect(() => {
    void (async () => {
      const [loadedTasks, loadedLists, loadedSyncedSettings, loadedLocalSettings, loadedConflicts] = await Promise.all([
        window.api.tasks.getAll(),
        window.api.lists.getAll(),
        window.api.settings.getSynced(),
        window.api.settings.getLocal(),
        window.api.sync.getPendingConflicts()
      ])

      let finalLists = loadedLists
      if (!finalLists.some((l) => l.id === MAIN_LIST_ID)) {
        finalLists = [{ id: MAIN_LIST_ID, name: 'Tasks', order: -1 }, ...finalLists]
        await window.api.lists.save(finalLists)
      }

      setTasks(loadedTasks)
      setLists(finalLists)
      setSyncedSettings(loadedSyncedSettings)
      setLocalSettings(loadedLocalSettings)
      setConflicts(loadedConflicts)
      setLoading(false)
    })()
  }, [])

  const selectList = useCallback((id: string) => setView({ kind: 'list', listId: id }), [])

  const setSearchQuery = useCallback((query: string) => {
    setView((prev) => {
      if (!query.trim()) return prev.kind === 'search' ? viewBeforeSearch.current : prev
      if (prev.kind !== 'search') viewBeforeSearch.current = prev
      return { kind: 'search', query }
    })
  }, [])

  const addTask = useCallback(async (input: { title: string; listId: string; priority?: Priority; starred?: boolean }) => {
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
    setTasks((prev) => [...prev, task])
    await window.api.tasks.upsert(task)
  }, [])

  const updateTask = useCallback(async (task: Task) => {
    const updated: Task = { ...task, updatedAt: new Date().toISOString() }
    setTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)))
    await window.api.tasks.upsert(updated)
  }, [])

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

  // Auto-archive completed tasks older than the configured retention window.
  useEffect(() => {
    if (loading) return
    const idsToArchive = taskIdsToArchive(tasks, syncedSettings.archive)
    if (idsToArchive.length === 0) return
    const idSet = new Set(idsToArchive)
    for (const task of tasks) {
      if (idSet.has(task.id)) void updateTask({ ...task, archived: true })
    }
  }, [loading, tasks, syncedSettings.archive, updateTask])

  const deleteTask = useCallback(async (id: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== id))
    await window.api.tasks.remove(id)
  }, [])

  const saveLists = useCallback(async (next: TaskList[]) => {
    setLists(next)
    await window.api.lists.save(next)
  }, [])

  const addList = useCallback(
    async (name: string) => {
      const trimmed = name.trim()
      if (!trimmed) return
      const list: TaskList = { id: newId(), name: trimmed, order: lists.length }
      await saveLists([...lists, list])
    },
    [lists, saveLists]
  )

  const renameList = useCallback(
    async (id: string, name: string) => {
      const trimmed = name.trim()
      if (!trimmed) return
      await saveLists(lists.map((l) => (l.id === id ? { ...l, name: trimmed } : l)))
    },
    [lists, saveLists]
  )

  const deleteList = useCallback(
    async (id: string) => {
      if (id === MAIN_LIST_ID) return
      // Tasks in a deleted list move back to the main Tasks list rather than being lost.
      const affected = tasks.filter((t) => t.listId === id)
      for (const t of affected) {
        await updateTask({ ...t, listId: MAIN_LIST_ID })
      }
      const isDeleted = (v: View) => v.kind === 'list' && v.listId === id
      setView((prev) => (isDeleted(prev) ? { kind: 'list', listId: MAIN_LIST_ID } : prev))
      if (isDeleted(viewBeforeSearch.current)) viewBeforeSearch.current = { kind: 'list', listId: MAIN_LIST_ID }
      await saveLists(lists.filter((l) => l.id !== id))
    },
    [lists, tasks, saveLists, updateTask]
  )

  const saveSyncedSettings = useCallback(async (settings: SyncedSettings) => {
    setSyncedSettings(settings)
    await window.api.settings.saveSynced(settings)
  }, [])

  const saveLocalSettings = useCallback(
    async (settings: Omit<LocalSettings, 'hasToken'>) => {
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

  const refreshFromCache = useCallback(async () => {
    const [nextTasks, nextLists, nextSettings, nextConflicts] = await Promise.all([
      window.api.tasks.getAll(),
      window.api.lists.getAll(),
      window.api.settings.getSynced(),
      window.api.sync.getPendingConflicts()
    ])
    setTasks(nextTasks)
    setLists(nextLists)
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
      saveSyncedSettings,
      saveLocalSettings,
      saveToken,
      clearToken,
      verifyToken,
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
      saveSyncedSettings,
      saveLocalSettings,
      saveToken,
      clearToken,
      verifyToken,
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
