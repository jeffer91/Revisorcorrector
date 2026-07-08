const path = require('path');
const { app, BrowserWindow } = require('electron');
const { registerIpcHandlers } = require('./rc-ipc');
const { rcConfig } = require('../src/rc-config');

let mainWindow = null;

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: rcConfig.window.width,
    height: rcConfig.window.height,
    minWidth: rcConfig.window.minWidth,
    minHeight: rcConfig.window.minHeight,
    show: false,
    backgroundColor: '#f5f7fb',
    webPreferences: {
      preload: path.join(__dirname, 'rc-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'app', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });
}

app.whenReady().then(() => {
  registerIpcHandlers();
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
