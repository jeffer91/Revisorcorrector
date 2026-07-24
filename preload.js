const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('migrador', {
  seleccionarExcel: () => ipcRenderer.invoke('excel:seleccionar'),
  analizar: () => ipcRenderer.invoke('excel:analizar'),
  migrar: () => ipcRenderer.invoke('firebase:migrar'),
  onProgreso: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('migracion:progreso', listener);
    return () => ipcRenderer.removeListener('migracion:progreso', listener);
  }
});
