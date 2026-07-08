const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('rcApi', {
  getAppInfo: () => ipcRenderer.invoke('app:get-info'),
  healthCheck: () => ipcRenderer.invoke('app:health-check'),
  selectFiles: (options) => ipcRenderer.invoke('dialog:select-files', options),
  importDocument: (payload) => ipcRenderer.invoke('files:import-document', payload),
  getImportedFiles: () => ipcRenderer.invoke('files:get-imported'),
  analyzePeaAlignment: () => ipcRenderer.invoke('analysis:pea-alignment')
});
