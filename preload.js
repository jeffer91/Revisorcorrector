const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('api', {
  pick: (type) => ipcRenderer.invoke('pick', type),
  analyze: (config) => ipcRenderer.invoke('analyze', config),
  migrate: (options) => ipcRenderer.invoke('migrate', options),
  exportReport: () => ipcRenderer.invoke('export-report'),
  openPath: (filePath) => ipcRenderer.invoke('open-path', filePath),
  onProgress: (callback) => ipcRenderer.on('progress', (_event, data) => callback(data))
});
