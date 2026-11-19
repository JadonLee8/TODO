import { Preferences } from '@capacitor/preferences'
import { SecureStoragePlugin } from 'capacitor-secure-storage-plugin'
import type { Api, Outcome } from '@shared/ipc'
import type { ActivityEntry } from '@shared/activity'
import { MAX_ACTIVITY_ENTRIES } from '@shared/activity'
import { DEFAULT_LOCAL_SETTINGS, type EditableLocalSettings, type LocalSettings } from '@shared/types'
import { createMemoryCacheStore } from '@shared/memoryCacheStore'
import { syncNow } from '@shared/sync'
import { verifyRepoAccess, verifyToken } from '@shared/github'
import { openRecordStore } from './storage'
import { shareTarget, widget } from './native'

/**
 * The Android implementation of `window.api`: what the Electron main process does on desktop, done in the WebView.
 *  - Cache: in memory, written behind to IndexedDB (same records as the desktop cache's files).
 *  - GitHub token: Android Keystore, through the secure-storage plugin. Never in IndexedDB or localStorage.
 *  - Local settings: Capacitor Preferences. Activity log: IndexedDB.
 *  - Sync: the same engine as desktop (shared/sync.ts). Extensions are desktop-only.
 */

const CACHE = 'cache:'
const ACTIVITY_KEY = 'activity'
const SETTINGS_KEY = 'local-settings'
const TOKEN_KEY = 'github-token'

const desktopOnly = async <T>(): Promise<Outcome<T>> => ({ ok: false, error: 'Only available in the desktop app' })

export async function createAndroidApi(): Promise<Api> {
  const records = await openRecordStore()
  const cache = createMemoryCacheStore({
    initial: records.entries.filter(([key]) => key.startsWith(CACHE)).map(([key, value]) => [key.slice(CACHE.length), value] as const),
    onChange: (key, value) => records.set(CACHE + key, value)
  })
  let activity = (records.entries.find(([key]) => key === ACTIVITY_KEY)?.[1] as ActivityEntry[] | undefined) ?? []

  const stored = (await Preferences.get({ key: SETTINGS_KEY })).value
  let editable: Partial<EditableLocalSettings> = stored ? (JSON.parse(stored) as Partial<EditableLocalSettings>) : {}
  // The plugin rejects when the key doesn't exist.
  const loadToken = (): Promise<string | null> =>
    SecureStoragePlugin.get({ key: TOKEN_KEY }).then(
      (r) => r.value || null,
      () => null
    )
  let hasToken = (await loadToken()) !== null

  const localSettings = (): LocalSettings => ({ ...DEFAULT_LOCAL_SETTINGS, autoSync: true, ...editable, hasToken, hasGoogleClientSecret: false, googleConnected: false })

  // Make sure the last edits are on disk before Android can kill the app in the background.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void records.flush()
  })

  return {
    platform: 'android',
    shareTarget,
    widget,
    tasks: {
      getAll: async () => cache.getAllTasks(),
      upsert: async (task) => {
        cache.writeTaskLocal(task)
        cache.markTaskDirty(task.id)
      },
      remove: async (id) => {
        cache.removeTaskLocal(id)
        cache.markTaskDeleted(id)
      }
    },
    lists: {
      getAll: async () => cache.getLists(),
      save: async (lists) => {
        cache.writeListsLocal(lists)
        cache.markListsDirty()
      }
    },
    folders: {
      getAll: async () => cache.getFolders(),
      save: async (folders) => {
        cache.writeFoldersLocal(folders)
        cache.markFoldersDirty()
      }
    },
    settings: {
      getSynced: async () => cache.getSettings(),
      saveSynced: async (settings) => {
        cache.writeSettingsLocal(settings)
        cache.markSettingsDirty()
      },
      getLocal: async () => localSettings(),
      saveLocal: async (settings) => {
        editable = { ...editable, ...settings }
        await Preferences.set({ key: SETTINGS_KEY, value: JSON.stringify(editable) })
      },
      saveToken: async (token) => {
        await SecureStoragePlugin.set({ key: TOKEN_KEY, value: token })
        hasToken = true
      },
      clearToken: async () => {
        await SecureStoragePlugin.remove({ key: TOKEN_KEY }).catch(() => undefined)
        hasToken = false
      },
      verifyToken: async () => {
        const token = await loadToken()
        if (!token) return { ok: false, error: 'No token saved yet' }
        try {
          const { login } = await verifyToken(token)
          const local = localSettings()
          if (local.githubOwner && local.githubRepo) await verifyRepoAccess(token, local.githubOwner, local.githubRepo)
          return { ok: true, login }
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) }
        }
      }
    },
    sync: {
      run: async () => {
        const token = await loadToken()
        const local = localSettings()
        const error = !token
          ? 'No GitHub token saved. Add one in Settings.'
          : !local.githubOwner || !local.githubRepo
            ? 'No GitHub repo configured. Set one in Settings.'
            : null
        if (error || !token) return { pushed: 0, pulled: 0, conflicts: [], error, extensions: [] }
        const result = await syncNow(cache, token, local.githubOwner, local.githubRepo, local.githubBranch || 'main')
        await records.flush()
        return result
      },
      getPendingConflicts: async () =>
        cache.getSyncMeta().conflictTaskIds.flatMap((id) => {
          const local = cache.getTask(id)
          const remote = cache.getConflictRemote(id)
          return local && remote ? [{ taskId: id, local, remote, base: cache.getSyncedTask(id) }] : []
        }),
      resolveKeepLocal: async (taskId) => {
        cache.markTaskDirty(taskId)
        cache.clearTaskConflict(taskId)
      },
      resolveKeepRemote: async (taskId) => {
        const remote = cache.getConflictRemote(taskId)
        if (remote) cache.acceptRemoteTask(remote)
        cache.clearTaskConflict(taskId)
      }
    },
    calendar: {
      saveClientSecret: async () => {},
      connect: desktopOnly,
      disconnect: async () => {},
      listCalendars: desktopOnly
    },
    extensions: {
      runNow: async (id) => ({ extensionId: id, at: new Date().toISOString(), summary: '', changedTasks: 0, error: 'Only available in the desktop app' }),
      getLastRuns: async () => ({})
    },
    obsidian: { pickVault: desktopOnly, open: desktopOnly },
    microsoftTodo: { listAccounts: desktopOnly },
    activity: {
      getAll: async () => activity,
      save: async (entries) => {
        activity = entries.slice(0, MAX_ACTIVITY_ENTRIES)
        records.set(ACTIVITY_KEY, activity)
      }
    }
  }
}
