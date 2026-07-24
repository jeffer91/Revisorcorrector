'use strict';

const { app, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');

const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyDkSOhJ552LwxQtt8GhP5iDJk49y0t4mOg',
  authDomain: 'titulos-ec2fa.firebaseapp.com',
  projectId: 'titulos-ec2fa',
  storageBucket: 'titulos-ec2fa.firebasestorage.app',
  messagingSenderId: '14269419714',
  appId: '1:14269419714:web:79df03c4df888c61edab5b',
  measurementId: 'G-4MC529QMW9'
};

const CATEGORY_DEFINITIONS = [
  {
    id: 'limpiar_titulos',
    label: 'Limpiar títulos',
    description: 'Quita comillas repetidas, saltos de línea y espacios innecesarios de los títulos.',
    recommended: true
  },
  {
    id: 'eliminar_redundantes',
    label: 'Eliminar campos duplicados',
    description: 'Elimina textos o contadores que ya se obtienen mediante otros campos y referencias.',
    recommended: true
  },
  {
    id: 'eliminar_tecnicos',
    label: 'Eliminar metadatos técnicos',
    description: 'Quita campos del Excel y de la migración que no son necesarios para usar la base.',
    recommended: true
  },
  {
    id: 'reparar_actuales',
    label: 'Reparar título y referencias actuales',
    description: 'Recalcula tituloFinal y valida versionActualId, resolucionActualId y tituloPreferidoNumero.',
    recommended: true
  },
  {
    id: 'compactar_historial',
    label: 'Compactar versiones y resoluciones',
    description: 'Elimina nombres, cédula, carrera y periodo repetidos; la relación se conserva mediante envioId.',
    recommended: false,
    warning: 'Más agresiva: deja los historiales compactos y dependientes de envios.'
  }
];

const COLLECTIONS_TO_ANALYZE = [
  'envios',
  'versiones_envio',
  'resoluciones',
  'periodos',
  'carreras',
  'coordinadores',
  'ia',
  'servicios',
  'configuracion'
];

async function getDatabase() {
  const { initializeApp, getApps } = require('firebase/app');
  const { getFirestore } = require('firebase/firestore');
  const appName = 'titulos-migrador-web';
  const firebaseApp = getApps().find((item) => item.name === appName)
    || initializeApp(FIREBASE_CONFIG, appName);
  return getFirestore(firebaseApp);
}

function sendProgress(percent, message, tone = 'normal') {
  const { BrowserWindow } = require('electron');
  const window = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
  if (window && !window.isDestroyed()) {
    window.webContents.send('correccion:progreso', { percent, message, tone });
  }
}

function serializeValue(value) {
  if (value == null) return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(serializeValue);
  if (typeof value === 'object') {
    if (typeof value.toDate === 'function') {
      try {
        return value.toDate().toISOString();
      } catch (_error) {
        return String(value);
      }
    }
    if (typeof value.path === 'string') return value.path;
    const output = {};
    for (const [key, item] of Object.entries(value)) output[key] = serializeValue(item);
    return output;
  }
  return value;
}

function cleanTitle(value) {
  if (typeof value !== 'string') return value;
  let text = value
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  const pairs = [
    ['"', '"'],
    ["'", "'"],
    ['“', '”'],
    ['«', '»']
  ];

  let changed = true;
  while (changed && text.length >= 2) {
    changed = false;
    for (const [open, close] of pairs) {
      if (text.startsWith(open) && text.endsWith(close)) {
        text = text.slice(open.length, -close.length).trim();
        changed = true;
      }
    }
  }

  return text;
}

function sameValue(left, right) {
  return JSON.stringify(serializeValue(left)) === JSON.stringify(serializeValue(right));
}

function dateValue(value) {
  if (!value) return 0;
  if (value && typeof value.toDate === 'function') {
    try {
      return value.toDate().getTime();
    } catch (_error) {
      return 0;
    }
  }
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function chooseLatest(items, numberField, dateFields) {
  if (!items.length) return null;
  return [...items].sort((left, right) => {
    const numberDifference = Number(left.data[numberField] || 0) - Number(right.data[numberField] || 0);
    if (numberDifference !== 0) return numberDifference;
    const leftDate = Math.max(...dateFields.map((field) => dateValue(left.data[field])));
    const rightDate = Math.max(...dateFields.map((field) => dateValue(right.data[field])));
    if (leftDate !== rightDate) return leftDate - rightDate;
    return left.id.localeCompare(right.id);
  }).at(-1);
}

async function readCollections(db) {
  const { collection, getDocs } = require('firebase/firestore');
  const result = {};

  for (let index = 0; index < COLLECTIONS_TO_ANALYZE.length; index += 1) {
    const name = COLLECTIONS_TO_ANALYZE[index];
    sendProgress(
      5 + Math.round(((index + 1) / COLLECTIONS_TO_ANALYZE.length) * 30),
      `Leyendo ${name}…`
    );
    const snapshot = await getDocs(collection(db, name));
    result[name] = snapshot.docs.map((item) => ({
      id: item.id,
      ref: item.ref,
      data: item.data()
    }));
  }

  return result;
}

function buildAnalysis(collections) {
  const changes = [];
  const changeKeys = new Set();

  const addChange = ({ category, collection, id, field, action, before, after, reason }) => {
    const key = `${category}|${collection}|${id}|${field}|${action}`;
    if (changeKeys.has(key)) return;
    changeKeys.add(key);
    changes.push({
      category,
      collection,
      id,
      field,
      action,
      before: serializeValue(before),
      after: serializeValue(after),
      reason
    });
  };

  const titleFieldsByCollection = {
    envios: ['titulo1', 'titulo2', 'titulo3'],
    versiones_envio: ['titulo1', 'titulo2', 'titulo3'],
    resoluciones: ['tituloElegido', 'tituloCorregido']
  };

  for (const [collectionName, fields] of Object.entries(titleFieldsByCollection)) {
    for (const document of collections[collectionName] || []) {
      for (const field of fields) {
        if (typeof document.data[field] !== 'string') continue;
        const cleaned = cleanTitle(document.data[field]);
        if (cleaned !== document.data[field]) {
          addChange({
            category: 'limpiar_titulos',
            collection: collectionName,
            id: document.id,
            field,
            action: 'set',
            before: document.data[field],
            after: cleaned,
            reason: 'Limpiar comillas y espacios del título.'
          });
        }
      }
    }
  }

  const redundantFields = {
    envios: ['tituloPreferido', 'versionActual', 'resolucionesTotal'],
    versiones_envio: ['tituloPreferido', 'esActual'],
    resoluciones: ['tituloFinal', 'esActual'],
    periodos: ['id'],
    carreras: ['id']
  };

  for (const [collectionName, fields] of Object.entries(redundantFields)) {
    for (const document of collections[collectionName] || []) {
      for (const field of fields) {
        if (!Object.prototype.hasOwnProperty.call(document.data, field)) continue;
        addChange({
          category: 'eliminar_redundantes',
          collection: collectionName,
          id: document.id,
          field,
          action: 'delete',
          before: document.data[field],
          after: null,
          reason: 'El campo se obtiene mediante otra referencia o ya coincide con el ID del documento.'
        });
      }
    }
  }

  for (const document of collections.coordinadores || []) {
    if (document.data.carrerasIds && Object.prototype.hasOwnProperty.call(document.data, 'carrerasNombres')) {
      addChange({
        category: 'eliminar_redundantes',
        collection: 'coordinadores',
        id: document.id,
        field: 'carrerasNombres',
        action: 'delete',
        before: document.data.carrerasNombres,
        after: null,
        reason: 'Los nombres se recuperan desde carreras usando carrerasIds.'
      });
    }
  }

  const technicalFields = {
    envios: ['estadoFirebase', 'estadoGoogleSheets', 'archivoOrigen', 'migradoEn'],
    versiones_envio: [
      'estadoFirebase',
      'estadoGoogleSheets',
      'archivoOrigen',
      'migradoEn',
      'filaOrigen',
      'fechaServidor',
      'idOrigen'
    ],
    resoluciones: ['archivoOrigen', 'migradoEn', 'filaOrigen', 'fechaServidor', 'idOrigen'],
    ia: ['archivoOrigen', 'actualizadoEnOrigen'],
    servicios: ['archivoOrigen', 'actualizadoEnOrigen'],
    configuracion: ['archivoOrigen', 'actualizadoEnOrigen']
  };

  for (const [collectionName, fields] of Object.entries(technicalFields)) {
    for (const document of collections[collectionName] || []) {
      for (const field of fields) {
        if (!Object.prototype.hasOwnProperty.call(document.data, field)) continue;
        addChange({
          category: 'eliminar_tecnicos',
          collection: collectionName,
          id: document.id,
          field,
          action: 'delete',
          before: document.data[field],
          after: null,
          reason: 'Metadato técnico que no es necesario para consultar o utilizar el registro.'
        });
      }
    }
  }

  const compactHistoryFields = {
    versiones_envio: ['cedula', 'nombres', 'periodoId', 'periodoNombre', 'carreraId', 'carreraNombre', 'telegram'],
    resoluciones: ['cedula', 'nombres', 'periodoId', 'periodoNombre', 'carreraNombre']
  };

  for (const [collectionName, fields] of Object.entries(compactHistoryFields)) {
    for (const document of collections[collectionName] || []) {
      for (const field of fields) {
        if (!Object.prototype.hasOwnProperty.call(document.data, field)) continue;
        addChange({
          category: 'compactar_historial',
          collection: collectionName,
          id: document.id,
          field,
          action: 'delete',
          before: document.data[field],
          after: null,
          reason: 'Dato repetido que se obtiene desde envios mediante envioId.'
        });
      }
    }
  }

  const versionsByEnvio = new Map();
  for (const document of collections.versiones_envio || []) {
    const envioId = document.data.envioId;
    if (!envioId) continue;
    if (!versionsByEnvio.has(envioId)) versionsByEnvio.set(envioId, []);
    versionsByEnvio.get(envioId).push(document);
  }

  const resolutionsByEnvio = new Map();
  const resolutionsById = new Map();
  for (const document of collections.resoluciones || []) {
    resolutionsById.set(document.id, document);
    const envioId = document.data.envioId;
    if (!envioId) continue;
    if (!resolutionsByEnvio.has(envioId)) resolutionsByEnvio.set(envioId, []);
    resolutionsByEnvio.get(envioId).push(document);
  }

  for (const document of collections.envios || []) {
    const data = document.data;
    const latestVersion = chooseLatest(
      versionsByEnvio.get(document.id) || [],
      'numeroVersion',
      ['fechaEnvio', 'fechaServidor', 'migradoEn']
    );
    const latestResolution = chooseLatest(
      resolutionsByEnvio.get(document.id) || [],
      'numeroResolucion',
      ['fechaResolucion', 'fechaServidor', 'migradoEn']
    );

    if (latestVersion && data.versionActualId !== latestVersion.id) {
      addChange({
        category: 'reparar_actuales',
        collection: 'envios',
        id: document.id,
        field: 'versionActualId',
        action: 'set',
        before: data.versionActualId,
        after: latestVersion.id,
        reason: 'Apuntar a la versión más reciente disponible.'
      });
    } else if (!latestVersion && Object.prototype.hasOwnProperty.call(data, 'versionActualId')) {
      addChange({
        category: 'reparar_actuales',
        collection: 'envios',
        id: document.id,
        field: 'versionActualId',
        action: 'delete',
        before: data.versionActualId,
        after: null,
        reason: 'La referencia no tiene una versión asociada.'
      });
    }

    if (latestResolution && data.resolucionActualId !== latestResolution.id) {
      addChange({
        category: 'reparar_actuales',
        collection: 'envios',
        id: document.id,
        field: 'resolucionActualId',
        action: 'set',
        before: data.resolucionActualId,
        after: latestResolution.id,
        reason: 'Apuntar a la resolución más reciente disponible.'
      });
    } else if (!latestResolution && Object.prototype.hasOwnProperty.call(data, 'resolucionActualId')) {
      addChange({
        category: 'reparar_actuales',
        collection: 'envios',
        id: document.id,
        field: 'resolucionActualId',
        action: 'delete',
        before: data.resolucionActualId,
        after: null,
        reason: 'La referencia no tiene una resolución asociada.'
      });
    }

    const titles = {
      1: cleanTitle(data.titulo1),
      2: cleanTitle(data.titulo2),
      3: cleanTitle(data.titulo3)
    };
    let preferredNumber = Number(data.tituloPreferidoNumero);

    if (![1, 2, 3].includes(preferredNumber) || !titles[preferredNumber]) {
      const legacyPreferred = cleanTitle(data.tituloPreferido);
      const matchedNumber = [1, 2, 3].find((number) => legacyPreferred && titles[number] === legacyPreferred);
      const versionPreferred = Number(latestVersion?.data?.tituloPreferidoNumero);
      const repairedNumber = matchedNumber || ([1, 2, 3].includes(versionPreferred) && titles[versionPreferred] ? versionPreferred : null);

      if (repairedNumber && repairedNumber !== preferredNumber) {
        addChange({
          category: 'reparar_actuales',
          collection: 'envios',
          id: document.id,
          field: 'tituloPreferidoNumero',
          action: 'set',
          before: data.tituloPreferidoNumero,
          after: repairedNumber,
          reason: 'Recuperar el número del título preferido a partir del texto o de la versión actual.'
        });
        preferredNumber = repairedNumber;
      } else if (!repairedNumber && Object.prototype.hasOwnProperty.call(data, 'tituloPreferidoNumero')) {
        addChange({
          category: 'reparar_actuales',
          collection: 'envios',
          id: document.id,
          field: 'tituloPreferidoNumero',
          action: 'delete',
          before: data.tituloPreferidoNumero,
          after: null,
          reason: 'El número no corresponde a un título disponible.'
        });
        preferredNumber = null;
      }
    }

    const resolution = latestResolution || resolutionsById.get(data.resolucionActualId);
    const expectedFinal = cleanTitle(
      resolution?.data?.tituloCorregido
      || resolution?.data?.tituloElegido
      || titles[preferredNumber]
      || titles[1]
      || titles[2]
      || titles[3]
      || null
    );

    if (expectedFinal && cleanTitle(data.tituloFinal) !== expectedFinal) {
      addChange({
        category: 'reparar_actuales',
        collection: 'envios',
        id: document.id,
        field: 'tituloFinal',
        action: 'set',
        before: data.tituloFinal,
        after: expectedFinal,
        reason: 'Usar el título corregido, elegido o preferido vigente.'
      });
    } else if (!expectedFinal && Object.prototype.hasOwnProperty.call(data, 'tituloFinal')) {
      addChange({
        category: 'reparar_actuales',
        collection: 'envios',
        id: document.id,
        field: 'tituloFinal',
        action: 'delete',
        before: data.tituloFinal,
        after: null,
        reason: 'No existe un título válido del cual obtener tituloFinal.'
      });
    }
  }

  const categoryStats = CATEGORY_DEFINITIONS.map((definition) => {
    const categoryChanges = changes.filter((item) => item.category === definition.id);
    return {
      ...definition,
      changes: categoryChanges.length,
      documents: new Set(categoryChanges.map((item) => `${item.collection}/${item.id}`)).size
    };
  });

  const affectedDocuments = new Set(changes.map((item) => `${item.collection}/${item.id}`));
  const totalDocuments = COLLECTIONS_TO_ANALYZE.reduce(
    (total, name) => total + (collections[name]?.length || 0),
    0
  );

  return {
    projectId: FIREBASE_CONFIG.projectId,
    analyzedAt: new Date().toISOString(),
    totalDocuments,
    affectedDocuments: affectedDocuments.size,
    totalChanges: changes.length,
    categories: categoryStats,
    changes,
    preview: changes.slice(0, 150)
  };
}

async function analyzeCorrections() {
  const db = await getDatabase();
  sendProgress(2, 'Iniciando análisis de correcciones…');
  const collections = await readCollections(db);
  sendProgress(40, 'Comparando campos, títulos y referencias…');
  const analysis = buildAnalysis(collections);
  sendProgress(100, 'Análisis de correcciones completado.', 'success');
  return analysis;
}

async function createBackup(db, selectedChanges, operationId) {
  const { doc, getDoc } = require('firebase/firestore');
  const uniquePaths = [...new Set(selectedChanges.map((item) => `${item.collection}/${item.id}`))];
  const documents = [];

  for (let index = 0; index < uniquePaths.length; index += 1) {
    const [collectionName, documentId] = uniquePaths[index].split('/');
    const snapshot = await getDoc(doc(db, collectionName, documentId));
    if (snapshot.exists()) {
      documents.push({
        path: uniquePaths[index],
        data: serializeValue(snapshot.data())
      });
    }
    sendProgress(
      10 + Math.round(((index + 1) / Math.max(uniquePaths.length, 1)) * 20),
      `Respaldando documentos: ${index + 1}/${uniquePaths.length}`
    );
  }

  const folder = path.join(app.getPath('documents'), 'MigradorTitulos', 'backups_correcciones');
  fs.mkdirSync(folder, { recursive: true });
  const backupPath = path.join(folder, `${operationId}.json`);
  fs.writeFileSync(backupPath, JSON.stringify({
    operationId,
    createdAt: new Date().toISOString(),
    changes: selectedChanges.length,
    documents
  }, null, 2));

  return { backupPath, documents: documents.length };
}

async function applyCorrections(categoryIds) {
  const selectedCategories = Array.isArray(categoryIds)
    ? [...new Set(categoryIds.filter((item) => CATEGORY_DEFINITIONS.some((definition) => definition.id === item)))]
    : [];

  if (!selectedCategories.length) {
    throw new Error('Selecciona al menos un tipo de corrección.');
  }

  const db = await getDatabase();
  sendProgress(2, 'Verificando nuevamente la información…');
  const collections = await readCollections(db);
  const analysis = buildAnalysis(collections);
  const selectedChanges = analysis.changes.filter((item) => selectedCategories.includes(item.category));

  if (!selectedChanges.length) {
    sendProgress(100, 'No se encontraron cambios pendientes para las opciones seleccionadas.', 'success');
    return {
      operationId: null,
      changesApplied: 0,
      documentsUpdated: 0,
      backupPath: null,
      categories: selectedCategories
    };
  }

  const operationId = `CORR_${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`;
  sendProgress(8, 'Creando respaldo local antes de corregir…');
  const backup = await createBackup(db, selectedChanges, operationId);

  const { doc, writeBatch, deleteField, serverTimestamp, setDoc } = require('firebase/firestore');
  const grouped = new Map();

  for (const change of selectedChanges) {
    const key = `${change.collection}/${change.id}`;
    if (!grouped.has(key)) grouped.set(key, { collection: change.collection, id: change.id, updates: {} });
    grouped.get(key).updates[change.field] = change.action === 'delete' ? deleteField() : change.after;
  }

  const groupedDocuments = [...grouped.values()];
  let batch = writeBatch(db);
  let pending = 0;
  let processed = 0;

  const flush = async () => {
    if (!pending) return;
    await batch.commit();
    batch = writeBatch(db);
    pending = 0;
  };

  const operationRef = doc(db, 'migraciones', operationId);
  await setDoc(operationRef, {
    tipo: 'CORRECCION',
    estado: 'EJECUTANDO',
    iniciadoEn: serverTimestamp(),
    categorias: selectedCategories.join('|'),
    cambiosProgramados: selectedChanges.length,
    documentosProgramados: groupedDocuments.length,
    respaldoLocal: backup.backupPath
  }, { merge: true });

  try {
    for (const item of groupedDocuments) {
      batch.update(doc(db, item.collection, item.id), item.updates);
      pending += 1;
      processed += 1;
      sendProgress(
        32 + Math.round((processed / Math.max(groupedDocuments.length, 1)) * 63),
        `Corrigiendo documentos: ${processed}/${groupedDocuments.length}`
      );
      if (pending >= 350) await flush();
    }

    await flush();

    await setDoc(operationRef, {
      estado: 'COMPLETADA',
      finalizadoEn: serverTimestamp(),
      cambiosAplicados: selectedChanges.length,
      documentosActualizados: groupedDocuments.length,
      documentosRespaldados: backup.documents,
      errores: []
    }, { merge: true });

    sendProgress(100, 'Correcciones aplicadas correctamente.', 'success');
    return {
      operationId,
      changesApplied: selectedChanges.length,
      documentsUpdated: groupedDocuments.length,
      backupPath: backup.backupPath,
      categories: selectedCategories
    };
  } catch (error) {
    try {
      await setDoc(operationRef, {
        estado: 'ERROR',
        finalizadoEn: serverTimestamp(),
        error: error?.message || String(error)
      }, { merge: true });
    } catch (_secondaryError) {
      // El error original es el importante.
    }
    sendProgress(0, 'No se pudieron completar las correcciones.', 'error');
    throw error;
  }
}

ipcMain.handle('correcciones:analizar', async () => analyzeCorrections());
ipcMain.handle('correcciones:aplicar', async (_event, categoryIds) => applyCorrections(categoryIds));
