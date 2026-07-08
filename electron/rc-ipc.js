const { app, dialog, ipcMain } = require('electron');
const { rcConfig } = require('../src/rc-config');
const { createInitialState } = require('../src/rc-state');
const { importAcademicDocument } = require('../src/rc-file-service');

const runtimeState = createInitialState();

function safeError(error) {
  return {
    ok: false,
    message: error && error.message ? error.message : 'Error desconocido.'
  };
}

function registerIpcHandlers() {
  ipcMain.handle('app:get-info', () => ({
    name: rcConfig.appName,
    version: app.getVersion(),
    stage: rcConfig.stage,
    documentTypes: rcConfig.documentTypes
  }));

  ipcMain.handle('app:health-check', () => ({
    ok: true,
    message: 'Carga y lectura de archivos activa',
    loadedAt: runtimeState.loadedAt
  }));

  ipcMain.handle('dialog:select-files', async (_event, options = {}) => {
    const result = await dialog.showOpenDialog({
      title: options.title || 'Seleccionar archivo',
      properties: options.multiple ? ['openFile', 'multiSelections'] : ['openFile'],
      filters: options.filters || rcConfig.fileFilters.allSupported
    });

    if (result.canceled) {
      return { canceled: true, files: [] };
    }

    return { canceled: false, files: result.filePaths };
  });

  ipcMain.handle('files:import-document', async (_event, payload = {}) => {
    try {
      const document = await importAcademicDocument(payload);
      runtimeState.files[payload.role] = document;

      return {
        ok: true,
        document
      };
    } catch (error) {
      return safeError(error);
    }
  });

  ipcMain.handle('files:get-imported', () => ({
    ok: true,
    files: runtimeState.files
  }));
}

module.exports = {
  registerIpcHandlers
};
