'use strict';

const { BrowserWindow, dialog, ipcMain } = require('electron');
const path = require('path');
const XLSX = require('xlsx');

const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyDkSOhJ552LwxQtt8GhP5iDJk49y0t4mOg',
  authDomain: 'titulos-ec2fa.firebaseapp.com',
  projectId: 'titulos-ec2fa',
  storageBucket: 'titulos-ec2fa.firebasestorage.app',
  messagingSenderId: '14269419714',
  appId: '1:14269419714:web:79df03c4df888c61edab5b',
  measurementId: 'G-4MC529QMW9'
};

const COLLECTIONS = [
  'envios',
  'versiones_envio',
  'resoluciones',
  'periodos',
  'carreras',
  'coordinadores',
  'ia',
  'servicios',
  'configuracion',
  'migraciones'
];

async function getDatabase() {
  const { initializeApp, getApps } = require('firebase/app');
  const { getFirestore } = require('firebase/firestore');
  const appName = 'titulos-migrador-web';
  const firebaseApp = getApps().find((item) => item.name === appName)
    || initializeApp(FIREBASE_CONFIG, appName);
  return getFirestore(firebaseApp);
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

function flattenForExport(value, prefix = '', output = {}) {
  if (value == null || typeof value !== 'object' || value instanceof Date) {
    if (prefix) output[prefix] = value;
    return output;
  }

  if (Array.isArray(value)) {
    output[prefix] = JSON.stringify(value.map(serializeValue));
    return output;
  }

  for (const [key, item] of Object.entries(value)) {
    const field = prefix ? `${prefix}.${key}` : key;
    if (item && typeof item === 'object' && !Array.isArray(item) && typeof item.toDate !== 'function') {
      flattenForExport(item, field, output);
    } else if (Array.isArray(item)) {
      output[field] = JSON.stringify(item.map(serializeValue));
    } else {
      output[field] = serializeValue(item);
    }
  }

  return output;
}

async function readCollection(collectionName) {
  if (!COLLECTIONS.includes(collectionName)) {
    throw new Error('La colección solicitada no está habilitada en el visor.');
  }

  const { collection, getDocs } = require('firebase/firestore');
  const db = await getDatabase();
  const snapshot = await getDocs(collection(db, collectionName));
  const documents = snapshot.docs.map((item) => ({
    id: item.id,
    ...serializeValue(item.data())
  }));

  const fields = new Set(['id']);
  for (const document of documents) {
    for (const key of Object.keys(document)) fields.add(key);
  }

  return {
    collection: collectionName,
    total: documents.length,
    fields: [...fields],
    documents
  };
}

async function readSummary() {
  const collections = [];
  for (const collectionName of COLLECTIONS) {
    const data = await readCollection(collectionName);
    collections.push({
      name: collectionName,
      count: data.total,
      fields: data.fields.length - 1
    });
  }

  return {
    projectId: FIREBASE_CONFIG.projectId,
    totalDocuments: collections.reduce((total, item) => total + item.count, 0),
    collections
  };
}

function safeSheetName(name, used) {
  let base = String(name).replace(/[\\/?*\[\]:]/g, '_').slice(0, 31) || 'Hoja';
  let candidate = base;
  let index = 2;
  while (used.has(candidate)) {
    const suffix = `_${index}`;
    candidate = `${base.slice(0, 31 - suffix.length)}${suffix}`;
    index += 1;
  }
  used.add(candidate);
  return candidate;
}

async function exportCollections(collectionNames) {
  const selected = Array.isArray(collectionNames) && collectionNames.length
    ? collectionNames.filter((item) => COLLECTIONS.includes(item))
    : COLLECTIONS;

  if (!selected.length) throw new Error('No hay colecciones seleccionadas para exportar.');

  const defaultName = selected.length === 1
    ? `Firestore_${selected[0]}_${new Date().toISOString().slice(0, 10)}.xlsx`
    : `Firestore_completo_${new Date().toISOString().slice(0, 10)}.xlsx`;

  const result = await dialog.showSaveDialog(BrowserWindow.getFocusedWindow(), {
    title: 'Exportar datos de Firestore',
    defaultPath: path.join(process.cwd(), defaultName),
    filters: [{ name: 'Libro de Excel', extensions: ['xlsx'] }]
  });

  if (result.canceled || !result.filePath) return null;

  const workbook = XLSX.utils.book_new();
  const usedNames = new Set();

  for (const collectionName of selected) {
    const data = await readCollection(collectionName);
    const rows = data.documents.length
      ? data.documents.map((document) => flattenForExport(document))
      : [{ mensaje: 'Colección vacía' }];
    const sheet = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(workbook, sheet, safeSheetName(collectionName, usedNames));
  }

  XLSX.writeFile(workbook, result.filePath);
  return {
    filePath: result.filePath,
    collections: selected.length
  };
}

ipcMain.handle('firebase:resumen', async () => readSummary());
ipcMain.handle('firebase:leer-coleccion', async (_event, collectionName) => readCollection(collectionName));
ipcMain.handle('firebase:exportar', async (_event, collectionNames) => exportCollections(collectionNames));
