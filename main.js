const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const path = require('path');
const { analyze, migrate, exportReport } = require('./migration');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 850,
    minWidth: 1040,
    minHeight: 700,
    show: false,
    backgroundColor: '#f4f7fb',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWindow.removeMenu();
  mainWindow.loadFile('index.html');
  mainWindow.once('ready-to-show', () => mainWindow.show());
}

function sendProgress(stage, percent, message, detail = null) {
  mainWindow?.webContents.send('progress', { stage, percent: Math.round(percent), message, detail });
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow());
});
app.on('window-all-closed', () => process.platform !== 'darwin' && app.quit());

ipcMain.handle('pick', async (_event, type) => {
  const excel = type === 'excel';
  const result = await dialog.showOpenDialog({
    title: excel ? 'Seleccionar respaldo Excel' : 'Seleccionar cuenta de servicio Firebase',
    properties: ['openFile'],
    filters: [{ name: excel ? 'Excel' : 'JSON', extensions: excel ? ['xlsx', 'xls'] : ['json'] }]
  });
  if (result.canceled || !result.filePaths[0]) return { ok: false };
  return { ok: true, path: result.filePaths[0], name: path.basename(result.filePaths[0]) };
});

ipcMain.handle('analyze', async (_event, config) => {
  try {
    return { ok: true, ...(await analyze(config, sendProgress)) };
  } catch (error) {
    sendProgress('error', 100, error.message);
    return { ok: false, message: error.message };
  }
});

ipcMain.handle('migrate', async (_event, options) => {
  try {
    const backupDir = path.join(app.getPath('documents'), 'MigradorTitulos', 'backups');
    return { ok: true, ...(await migrate({ ...options, backupDir }, sendProgress)) };
  } catch (error) {
    sendProgress('error', 100, error.message);
    return { ok: false, message: error.message };
  }
});

ipcMain.handle('export-report', async () => {
  try {
    const result = await dialog.showSaveDialog({
      title: 'Guardar informe de validación',
      defaultPath: path.join(app.getPath('documents'), `informe_migracion_${Date.now()}.xlsx`),
      filters: [{ name: 'Excel', extensions: ['xlsx'] }]
    });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    exportReport(result.filePath);
    return { ok: true, path: result.filePath };
  } catch (error) {
    return { ok: false, message: error.message };
  }
});

ipcMain.handle('open-path', async (_event, filePath) => {
  const error = filePath ? await shell.openPath(filePath) : 'Ruta vacía';
  return error ? { ok: false, message: error } : { ok: true };
});
