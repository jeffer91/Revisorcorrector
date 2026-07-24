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

  return result;
}

function enableCredentialPicker(code) {
  let result = code;

  result = result.replace(
    /function loadServiceAccount\(sourcePath\)\s*\{/,
    'function loadServiceAccount(sourcePath, explicitPath = null) {'
  );

  result = result.replace(
    /const accountPath = findServiceAccount\(sourcePath\);/,
    'const accountPath = explicitPath || findServiceAccount(sourcePath);'
  );

  result = result.replace(
    /async function migrateToFirestore\(result\)\s*\{/,
    'async function migrateToFirestore(result, explicitAccountPath = null) {'
  );

  result = result.replace(
    /loadServiceAccount\(result\.sourcePath\)/,
    'loadServiceAccount(result.sourcePath, explicitAccountPath)'
  );

  const handlerPattern = /ipcMain\.handle\('firebase:migrar', async \(\) => \{[\s\S]*?return migrateToFirestore\(analysisResult(?:,\s*[^)]*)?\);\s*\}\);/m;
  const handlerReplacement = [
    "ipcMain.handle('firebase:migrar', async () => {",
    "  if (!analysisResult) throw new Error('Primero pulsa Analizar.');",
    "",
    "  let accountPath = findServiceAccount(analysisResult.sourcePath);",
    "  if (!accountPath) {",
    "    const credentialResult = await dialog.showOpenDialog(mainWindow, {",
    "      title: 'Seleccionar clave privada de Firebase',",
    "      properties: ['openFile'],",
    "      filters: [{ name: 'Cuenta de servicio Firebase', extensions: ['json'] }]",
    "    });",
    "",
    "    if (credentialResult.canceled || !credentialResult.filePaths[0]) {",
    "      throw new Error('Debes seleccionar la clave privada JSON del proyecto titulos-ec2fa para poder subir.');",
    "    }",
    "",
    "    accountPath = credentialResult.filePaths[0];",
    "  }",
    "",
    "  return migrateToFirestore(analysisResult, accountPath);",
    "});"
  ].join('\n');

  if (handlerPattern.test(result)) {
    result = result.replace(handlerPattern, handlerReplacement);
  } else {
    console.warn('[Migrador] No se encontró el manejador firebase:migrar para activar el selector automático de credenciales.');
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
source = enableCredentialPicker(source);

const runtimeModule = new Module(mainPath, module);
runtimeModule.filename = mainPath;
runtimeModule.paths = Module._nodeModulePaths(path.dirname(mainPath));
runtimeModule._compile(source, mainPath);
