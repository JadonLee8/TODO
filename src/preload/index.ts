import { contextBridge, ipcRenderer } from 'electron'
import { CHANNELS } from '@shared/ipc'
import type { Api } from '@shared/ipc'

const api: Api = {
  platform: 'desktop',
  tasks: {
    getAll: () => ipcRenderer.invoke(CHANNELS.tasksGetAll),
    upsert: (task) => ipcRenderer.invoke(CHANNELS.tasksUpsert, task),
    remove: (id) => ipcRenderer.invoke(CHANNELS.tasksRemove, id)
  },
  lists: {
    getAll: () => ipcRenderer.invoke(CHANNELS.listsGetAll),
    save: (lists) => ipcRenderer.invoke(CHANNELS.listsSave, lists)
  },
  folders: {
    getAll: () => ipcRenderer.invoke(CHANNELS.foldersGetAll),
    save: (folders) => ipcRenderer.invoke(CHANNELS.foldersSave, folders)
  },
  settings: {
    getSynced: () => ipcRenderer.invoke(CHANNELS.settingsGetSynced),
    saveSynced: (settings) => ipcRenderer.invoke(CHANNELS.settingsSaveSynced, settings),
    getLocal: () => ipcRenderer.invoke(CHANNELS.settingsGetLocal),
    saveLocal: (settings) => ipcRenderer.invoke(CHANNELS.settingsSaveLocal, settings),
    saveToken: (token) => ipcRenderer.invoke(CHANNELS.settingsSaveToken, token),
    clearToken: () => ipcRenderer.invoke(CHANNELS.settingsClearToken),
    verifyToken: () => ipcRenderer.invoke(CHANNELS.settingsVerifyToken)
  },
  sync: {
    run: () => ipcRenderer.invoke(CHANNELS.syncRun),
    getPendingConflicts: () => ipcRenderer.invoke(CHANNELS.syncGetPendingConflicts),
    resolveKeepLocal: (taskId) => ipcRenderer.invoke(CHANNELS.syncResolveKeepLocal, taskId),
    resolveKeepRemote: (taskId) => ipcRenderer.invoke(CHANNELS.syncResolveKeepRemote, taskId)
  },
  calendar: {
    saveClientSecret: (secret) => ipcRenderer.invoke(CHANNELS.calendarSaveClientSecret, secret),
    connect: () => ipcRenderer.invoke(CHANNELS.calendarConnect),
    disconnect: () => ipcRenderer.invoke(CHANNELS.calendarDisconnect),
    listCalendars: () => ipcRenderer.invoke(CHANNELS.calendarListCalendars)
  },
  extensions: {
    runNow: (id) => ipcRenderer.invoke(CHANNELS.extensionsRunNow, id),
    getLastRuns: () => ipcRenderer.invoke(CHANNELS.extensionsGetLastRuns)
  },
  obsidian: {
    pickVault: () => ipcRenderer.invoke(CHANNELS.obsidianPickVault),
    open: (target) => ipcRenderer.invoke(CHANNELS.obsidianOpen, target)
  },
  microsoftTodo: {
    listAccounts: () => ipcRenderer.invoke(CHANNELS.microsoftTodoListAccounts)
  },
  activity: {
    getAll: () => ipcRenderer.invoke(CHANNELS.activityGetAll),
    save: (entries) => ipcRenderer.invoke(CHANNELS.activitySave, entries)
  }
}

contextBridge.exposeInMainWorld('api', api)
