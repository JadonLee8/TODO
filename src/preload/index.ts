import { contextBridge, ipcRenderer } from 'electron'
import { CHANNELS } from '@shared/ipc'
import type { Api } from '@shared/ipc'

const api: Api = {
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
  }
}

contextBridge.exposeInMainWorld('api', api)
