'use strict';

const fs = require('fs');
const path = require('path');
const Module = require('module');
const { app, BrowserWindow, Menu } = require('electron');

const mainPath = path.join(__dirname, 'main.js');
let source = fs.readFileSync(mainPath, 'utf8');

function fixCareerIdentifiers(code) {
  let result = code;

  result = result.replace(
    /(^[\t ]*)carreraId,(\r?\n)([\t ]*carreraCodigo:)/gm,
    '$1carreraId: careerId,$2$3'
  );

  result = result.replace(
    /(^[\t ]*)carreraId,(\r?\n)([\t ]*carreraNombre:)/gm,
    '$1carreraId: careerId,$2$3'
  );

  const correctedOccurrences = (result.match(/carreraId:\s*careerId/g) || []).length;
  if (correctedOccurrences < 2) {
    console.warn('[Migrador] No se encontraron las dos asignaciones esperadas de carreraId. Se continuará porque el archivo puede estar corregido en otra versión.');
  }

  return result;
}

function buildMenu() {
  const openConsole = () => {
    const window = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
    if (window && !window.isDestroyed()) window.webContents.toggleDevTools();
  };

  return Menu.buildFromTemplate([
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
          click: openConsole
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
          click: openConsole
        }
      ]
    }
  ]);
}

function installMenu() {
  Menu.setApplicationMenu(buildMenu());
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.setMenuBarVisibility(true);
  }
}

app.on('browser-window-created', (_event, window) => {
  setTimeout(() => {
    if (!window.isDestroyed()) {
      installMenu();
      window.setMenuBarVisibility(true);
    }
  }, 0);
});

app.whenReady().then(installMenu).catch((error) => {
  console.error('[Migrador] No se pudo instalar el menú:', error);
});

process.on('uncaughtException', (error) => {
  console.error('[Error no controlado]', error);
});

process.on('unhandledRejection', (error) => {
  console.error('[Promesa rechazada]', error);
});

source = fixCareerIdentifiers(source);

const runtimeModule = new Module(mainPath, module);
runtimeModule.filename = mainPath;
runtimeModule.paths = Module._nodeModulePaths(path.dirname(mainPath));
runtimeModule._compile(source, mainPath);
