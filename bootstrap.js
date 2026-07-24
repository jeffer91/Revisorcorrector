'use strict';

const fs = require('fs');
const path = require('path');
const Module = require('module');
const { app, BrowserWindow, Menu } = require('electron');

const mainPath = path.join(__dirname, 'main.js');
let source = fs.readFileSync(mainPath, 'utf8');

function fixCareerIdentifiers(code) {
  return code
    .replace(/(^[\t ]*)carreraId,(\r?\n)([\t ]*carreraCodigo:)/gm, '$1carreraId: careerId,$2$3')
    .replace(/(^[\t ]*)carreraId,(\r?\n)([\t ]*carreraNombre:)/gm, '$1carreraId: careerId,$2$3');
}

function enableDirectFirestoreMigration(code) {
  const migrationCode = String.raw`
function serializeFirestoreValue(value) {
  if (value == null) return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(serializeFirestoreValue);
  if (typeof value === 'object') {
    if (typeof value.toDate === 'function') {
      try { return value.toDate().toISOString(); } catch (_error) { return String(value); }
    }
    const output = {};
    for (const [key, item] of Object.entries(value)) output[key] = serializeFirestoreValue(item);
    return output;
  }
  return value;
}

async function migrateToFirestore(result) {
  const { initializeApp: initializeClientApp, getApps: getClientApps } = require('firebase/app');
  const {
    getFirestore: getClientFirestore,
    doc,
    getDoc,
    setDoc,
    writeBatch,
    serverTimestamp
  } = require('firebase/firestore');

  const firebaseConfig = {
    apiKey: 'AIzaSyDkSOhJ552LwxQtt8GhP5iDJk49y0t4mOg',
    authDomain: 'titulos-ec2fa.firebaseapp.com',
    projectId: 'titulos-ec2fa',
    storageBucket: 'titulos-ec2fa.firebasestorage.app',
    messagingSenderId: '14269419714',
    appId: '1:14269419714:web:79df03c4df888c61edab5b',
    measurementId: 'G-4MC529QMW9'
  };

  const appName = 'titulos-migrador-web';
  const clientApp = getClientApps().find((item) => item.name === appName)
    || initializeClientApp(firebaseConfig, appName);
  const db = getClientFirestore(clientApp);
  const migrationId = 'MIG_' + new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  const migrationRef = doc(db, 'migraciones', migrationId);

  try {
    sendProgress(42, 'Conectando directamente con Firestore…');
    await setDoc(migrationRef, {
      estado: 'EJECUTANDO',
      archivoOrigen: path.basename(result.sourcePath),
      proyectoDestino: TARGET_PROJECT_ID,
      iniciadoEn: serverTimestamp(),
      resumenAnalisis: result.summary
    }, { merge: true });

    sendProgress(47, 'Creando respaldo local de documentos existentes…');
    const backupDocuments = [];
    for (let index = 0; index < result.envios.length; index += 1) {
      const envio = result.envios[index];
      const snapshot = await getDoc(doc(db, 'envios', envio.id));
      if (snapshot.exists()) {
        backupDocuments.push({ id: envio.id, data: serializeFirestoreValue(snapshot.data()) });
      }
      if ((index + 1) % 10 === 0 || index + 1 === result.envios.length) {
        sendProgress(47 + Math.round(((index + 1) / Math.max(result.envios.length, 1)) * 7),
          'Preparando respaldo: ' + (index + 1) + '/' + result.envios.length);
      }
    }

    const backupFolder = path.join(path.dirname(result.sourcePath), 'backups_migracion');
    fs.mkdirSync(backupFolder, { recursive: true });
    const backupPath = path.join(backupFolder, migrationId + '.json');
    fs.writeFileSync(backupPath, JSON.stringify({
      migrationId,
      createdAt: new Date().toISOString(),
      documents: backupDocuments
    }, null, 2));

    let totalWrites = result.periods.length + result.careers.length + result.coordinators.length + result.envios.length + 1;
    totalWrites += result.envios.reduce((total, item) => total + item.versions.length + item.resolutions.length, 0);

    let batch = writeBatch(db);
    let pendingInBatch = 0;
    let queued = 0;

    const flush = async () => {
      if (!pendingInBatch) return;
      await batch.commit();
      batch = writeBatch(db);
      pendingInBatch = 0;
    };

    const queueSet = async (reference, data) => {
      batch.set(reference, data, { merge: true });
      pendingInBatch += 1;
      queued += 1;
      sendProgress(56 + Math.round((queued / Math.max(totalWrites, 1)) * 40),
        'Subiendo ' + queued + '/' + totalWrites + ' documentos…');
      if (pendingInBatch >= 400) await flush();
    };

    for (const period of result.periods) {
      await queueSet(doc(db, 'periodos', period.id), {
        ...period,
        actualizadoEn: serverTimestamp(),
        migracionId
      });
    }

    for (const career of result.careers) {
      await queueSet(doc(db, 'carreras', career.id), {
        ...career,
        actualizadoEn: serverTimestamp(),
        migracionId
      });
    }

    for (const coordinator of result.coordinators) {
      await queueSet(doc(db, 'coordinadores', coordinator.id), {
        ...coordinator,
        actualizadoEn: serverTimestamp(),
        migracionId
      });
    }

    for (const envio of result.envios) {
      const envioRef = doc(db, 'envios', envio.id);
      const { versions, resolutions, id: _envioId, ...envioData } = envio;

      await queueSet(envioRef, {
        ...envioData,
        actualizadoEn: serverTimestamp(),
        migracion: {
          id: migrationId,
          archivoOrigen: path.basename(result.sourcePath),
          migradoEn: serverTimestamp()
        }
      });

      for (let index = 0; index < versions.length; index += 1) {
        const version = versions[index];
        const versionId = version.sourceId
          ? slug(version.sourceId)
          : 'version_' + String(index + 1).padStart(3, '0') + '_' + version.signature;
        const { sortMillis: _sortMillis, signature: _signature, ...versionData } = version;
        await queueSet(doc(db, 'envios', envio.id, 'versiones', versionId), {
          ...versionData,
          numeroVersion: index + 1,
          migracionId
        });
      }

      for (let index = 0; index < resolutions.length; index += 1) {
        const resolution = resolutions[index];
        const resolutionId = resolution.sourceId
          ? slug(resolution.sourceId)
          : 'resolucion_' + String(index + 1).padStart(3, '0') + '_' + resolution.signature;
        const { sortMillis: _sortMillis, signature: _signature, ...resolutionData } = resolution;
        await queueSet(doc(db, 'envios', envio.id, 'resoluciones', resolutionId), {
          ...resolutionData,
          numeroResolucion: index + 1,
          migracionId
        });
      }
    }

    await queueSet(doc(db, 'configuracion', 'general'), {
      proyectoId: TARGET_PROJECT_ID,
      ultimaMigracionId: migrationId,
      ultimaMigracionEn: serverTimestamp(),
      periodoActivoId: result.periods.find((item) => item.activo)?.id || null,
      enviosHabilitados: true
    });

    await flush();

    await setDoc(migrationRef, {
      estado: 'COMPLETADA',
      finalizadoEn: serverTimestamp(),
      archivoOrigen: path.basename(result.sourcePath),
      resumen: result.summary,
      documentosProgramados: totalWrites,
      respaldoLocal: backupPath,
      documentosRespaldados: backupDocuments.length,
      errores: []
    }, { merge: true });

    sendProgress(100, 'Migración completada correctamente.', 'success');
    return {
      migrationId,
      projectId: TARGET_PROJECT_ID,
      totalWrites,
      backupPath,
      errors: []
    };
  } catch (error) {
    try {
      await setDoc(migrationRef, {
        estado: 'ERROR',
        finalizadoEn: serverTimestamp(),
        error: error?.message || String(error)
      }, { merge: true });
    } catch (_secondaryError) {
      // Ignorar: el error original es el importante.
    }

    const message = error?.code === 'permission-denied'
      ? 'Firestore rechazó la escritura. Verifica que las reglas publicadas permitan read y write.'
      : (error?.message || String(error));
    sendProgress(0, 'La migración no pudo completarse.', 'error');
    throw new Error(message);
  }
}
`;

  const migrationPattern = /async function migrateToFirestore\(result(?:,\s*explicitAccountPath\s*=\s*null)?\)\s*\{[\s\S]*?\n\}\n\nipcMain\.handle\('excel:seleccionar'/m;
  if (!migrationPattern.test(code)) {
    throw new Error('No se encontró el bloque de migración de main.js. Actualiza el repositorio e inténtalo otra vez.');
  }

  let result = code.replace(
    migrationPattern,
    migrationCode.trim() + "\n\nipcMain.handle('excel:seleccionar'"
  );

  const handlerPattern = /ipcMain\.handle\('firebase:migrar', async \(\) => \{[\s\S]*?\n\}\);/m;
  const handlerReplacement = [
    "ipcMain.handle('firebase:migrar', async () => {",
    "  if (!analysisResult) throw new Error('Primero pulsa Analizar.');",
    "  return migrateToFirestore(analysisResult);",
    "});"
  ].join('\n');

  if (!handlerPattern.test(result)) {
    throw new Error('No se encontró el botón de subida de main.js. Actualiza el repositorio e inténtalo otra vez.');
  }

  return result.replace(handlerPattern, handlerReplacement);
}

function buildMenu() {
  const openConsole = () => {
    const window = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
    if (window && !window.isDestroyed()) window.webContents.toggleDevTools();
  };

  return Menu.buildFromTemplate([
    {
      label: 'Archivo',
      submenu: [{ role: 'quit', label: 'Salir' }]
    },
    {
      label: 'Ver',
      submenu: [
        { role: 'reload', label: 'Recargar' },
        { role: 'forceReload', label: 'Forzar recarga' },
        { type: 'separator' },
        { label: 'Abrir/cerrar consola', accelerator: 'F12', click: openConsole },
        { type: 'separator' },
        { role: 'resetZoom', label: 'Tamaño real' },
        { role: 'zoomIn', label: 'Aumentar zoom' },
        { role: 'zoomOut', label: 'Reducir zoom' },
        { role: 'togglefullscreen', label: 'Pantalla completa' }
      ]
    },
    {
      label: 'Ayuda',
      submenu: [{ label: 'Consola de diagnóstico', click: openConsole }]
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

process.on('uncaughtException', (error) => console.error('[Error no controlado]', error));
process.on('unhandledRejection', (error) => console.error('[Promesa rechazada]', error));

source = fixCareerIdentifiers(source);
source = enableDirectFirestoreMigration(source);

const runtimeModule = new Module(mainPath, module);
runtimeModule.filename = mainPath;
runtimeModule.paths = Module._nodeModulePaths(path.dirname(mainPath));
runtimeModule._compile(source, mainPath);
