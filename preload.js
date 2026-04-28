const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  config: {
    load: () => ipcRenderer.invoke('config:load'),
    set: (key, value) => ipcRenderer.invoke('config:set', key, value),
  },
  plex: {
    signIn: (email, password) => ipcRenderer.invoke('plex:signIn', email, password),
    getSessions: () => ipcRenderer.invoke('plex:getSessions'),
    getDisplays: () => ipcRenderer.invoke('plex:getDisplays'),
  },
  sync: {
    start: (params) => ipcRenderer.invoke('sync:start', params),
    stop: () => ipcRenderer.invoke('sync:stop'),
    onStatus: (cb) => ipcRenderer.on('sync:status', (_, data) => cb(data)),
    getDisplayLag: () => ipcRenderer.invoke('sync:getDisplayLag'),
    nudgeDisplayLag: (delta) => ipcRenderer.invoke('sync:nudgeDisplayLag', delta),
  },
  download: {
    openWindow: () => ipcRenderer.invoke('download:openWindow'),
    getRemoteServers: () => ipcRenderer.invoke('download:getRemoteServers'),
    getLocalSections: () => ipcRenderer.invoke('download:getLocalSections'),
    search: (uri, token, query, opts) => ipcRenderer.invoke('download:search', uri, token, query, opts),
    start: (params) => ipcRenderer.invoke('download:start', params),
    onProgress: (cb) => ipcRenderer.on('download:progress', (_, p) => cb(p)),
    onDone: (cb) => ipcRenderer.once('download:done', () => cb()),
    onError: (cb) => ipcRenderer.once('download:error', (_, msg) => cb(msg)),
  },
  app: { quit: () => ipcRenderer.invoke('app:quit') },
});
