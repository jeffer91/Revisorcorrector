'use strict';

const fs = require('fs');
const path = require('path');
const Module = require('module');

const mainPath = path.join(__dirname, 'main.js');
let source = fs.readFileSync(mainPath, 'utf8');

function replaceRequired(searchValue, replacement, description) {
  if (!source.includes(searchValue)) {
    throw new Error(`No se pudo aplicar la corrección: ${description}. Actualiza el repositorio e inténtalo otra vez.`);
  }
  source = source.replace(searchValue, replacement);
}

replaceRequired(
  "const { app, BrowserWindow, dialog, ipcMain } = require('electron');",
  "const { app, BrowserWindow, dialog, ipcMain, Menu } = require('electron');",
  'importación del menú de Electron'
);

replaceRequired(
  "      carreraId,\n      carreraCodigo: careerCode,",
  "      carreraId: careerId,\n      carreraCodigo: careerCode,",
  'identificador de carrera del índice de estudiantes'
);

replaceRequired(
  "      carreraId,\n      carreraNombre: careerName || indexSnapshot.carreraNombre,",
  "      carreraId: careerId,\n      carreraNombre: careerName || indexSnapshot.carreraNombre,",
  'identificador de carrera de los envíos'
);

const menuCode = `function createApplicationMenu() {
  const template = [
    {
      label: 'Archivo',
      submenu: [
        { role: 'quit', label: 'Salir' }
      ]
    },
    {
      label: 'Ver',
      submenu: [
        { role: 'reload', label: 'Recargar' },
        { role: 'forceReload', label: 'Forzar recarga' },
        { type: 'separator' },
        {
          label: 'Abrir/cerrar consola',
          accelerator: 'F12',
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.toggleDevTools();
          }
        },
        { type: 'separator' },
        { role: 'resetZoom', label: 'Tamaño real' },
        { role: 'zoomIn', label: 'Aumentar zoom' },
        { role: 'zoomOut', label: 'Reducir zoom' },
        { role: 'togglefullscreen', label: 'Pantalla completa' }
      ]
    },
    {
      label: 'Ayuda',
      submenu: [
        {
          label: 'Consola de diagnóstico',
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.openDevTools({ mode: 'detach' });
            }
          }
        }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}`;

replaceRequired(
  'function createWindow() {',
  `${menuCode}\n\nfunction createWindow() {`,
  'creación del menú superior'
);

replaceRequired(
  "  mainWindow.setMenuBarVisibility(false);\n  mainWindow.loadFile('index.html');",
  "  createApplicationMenu();\n  mainWindow.setMenuBarVisibility(true);\n  mainWindow.loadFile('index.html');",
  'activación del menú superior'
);

process.on('uncaughtException', (error) => {
  console.error('[Error no controlado]', error);
});
process.on('unhandledRejection', (error) => {
  console.error('[Promesa rechazada]', error);
});

const runtimeModule = new Module(mainPath, module);
runtimeModule.filename = mainPath;
runtimeModule.paths = Module._nodeModulePaths(path.dirname(mainPath));
runtimeModule._compile(source, mainPath);
