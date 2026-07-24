'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('migrador', {
  seleccionarExcel: () => ipcRenderer.invoke('excel:seleccionar'),
  analizar: () => ipcRenderer.invoke('excel:analizar'),
  migrar: () => ipcRenderer.invoke('firebase:migrar'),

  obtenerResumenFirebase: () => ipcRenderer.invoke('firebase:resumen'),
  leerColeccionFirebase: (collectionName) => ipcRenderer.invoke('firebase:leer-coleccion', collectionName),
  exportarFirebase: (collectionNames) => ipcRenderer.invoke('firebase:exportar', collectionNames),

  analizarCorrecciones: () => ipcRenderer.invoke('correcciones:analizar'),
  aplicarCorrecciones: (categoryIds) => ipcRenderer.invoke('correcciones:aplicar', categoryIds),

  onProgreso: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('migracion:progreso', listener);
    return () => ipcRenderer.removeListener('migracion:progreso', listener);
  },

  onProgresoCorrecciones: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('correccion:progreso', listener);
    return () => ipcRenderer.removeListener('correccion:progreso', listener);
  }
});
