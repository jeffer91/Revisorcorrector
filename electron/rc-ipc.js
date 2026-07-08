const { app, dialog, ipcMain } = require('electron');
const { rcConfig } = require('../src/rc-config');
const { createInitialState } = require('../src/rc-state');

const runtimeState = createInitialState();

function registerIpcHandlers() {
  ipcMain.handle('app:get-info', () => ({
    name: rcConfig.appName,
    version: app.getVersion(),
    stage: rcConfig.stage,
    documentTypes: rcConfig.documentTypes
  }));

  ipcMain.handle('app:health-check', () => ({
    ok: true,
    message: 'Base Electron activa',
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
}

module.exports = {
  registerIpcHandlers
};
