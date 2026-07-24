'use strict';

const { app, BrowserWindow, dialog, ipcMain, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const XLSX = require('xlsx');

const TARGET_PROJECT_ID = 'titulos-ec2fa';
const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyDkSOhJ552LwxQtt8GhP5iDJk49y0t4mOg',
  authDomain: 'titulos-ec2fa.firebaseapp.com',
  projectId: 'titulos-ec2fa',
  storageBucket: 'titulos-ec2fa.firebasestorage.app',
  messagingSenderId: '14269419714',
  appId: '1:14269419714:web:79df03c4df888c61edab5b',
  measurementId: 'G-4MC529QMW9'
};

let mainWindow = null;
let selectedExcelPath = null;
let selectedWorkbookType = null;
let analysisResult = null;

function createApplicationMenu() {
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

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 980,
    minHeight: 700,
    title: 'Migrador de Títulos',
    backgroundColor: '#f4f7fb',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  Menu.setApplicationMenu(createApplicationMenu());
  mainWindow.setMenuBarVisibility(true);
  mainWindow.loadFile('index.html');
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

process.on('uncaughtException', (error) => console.error('[Error no controlado]', error));
process.on('unhandledRejection', (error) => console.error('[Promesa rechazada]', error));

function sendProgress(percent, message, tone = 'normal') {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('migracion:progreso', { percent, message, tone });
}

function readWorkbook(filePath) {
  return XLSX.readFile(filePath, { cellDates: false, raw: true });
}

function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function slug(value) {
  return normalizeText(value)
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120);
}

function stableHash(value, length = 12) {
  return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, length);
}

function cleanString(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

function compactObject(value) {
  if (Array.isArray(value)) {
    return value
      .map(compactObject)
      .filter((item) => item !== undefined && item !== null && item !== '');
  }

  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const result = {};
    for (const [key, item] of Object.entries(value)) {
      const cleaned = compactObject(item);
      if (cleaned !== undefined && cleaned !== null && cleaned !== '') result[key] = cleaned;
    }
    return result;
  }

  return value === undefined ? undefined : value;
}

function pick(row, aliases) {
  const keys = Object.keys(row || {});
  for (const alias of aliases) {
    const wanted = normalizeText(alias);
    const key = keys.find((candidate) => normalizeText(candidate) === wanted);
    if (key) return row[key];
  }
  return null;
}

function sheetRows(workbook, sheetName) {
  const realName = workbook.SheetNames.find((name) => normalizeText(name) === normalizeText(sheetName));
  if (!realName) return [];
  return XLSX.utils.sheet_to_json(workbook.Sheets[realName], {
    defval: null,
    raw: true,
    blankrows: false
  });
}

function detectWorkbookType(workbook) {
  const names = new Set(workbook.SheetNames.map(normalizeText));
  if (names.has('envios') && names.has('resoluciones') && names.has('coordinadores')) return 'titulos';
  if (names.has('ia') && names.has('servicios') && names.has('configuracion')) return 'claves';
  return null;
}

function normalizeCedula(value) {
  let digits = String(value ?? '').replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length === 9) digits = digits.padStart(10, '0');
  return digits;
}

const MONTHS = {
  enero: '01', febrero: '02', marzo: '03', abril: '04', mayo: '05', junio: '06',
  julio: '07', agosto: '08', septiembre: '09', setiembre: '09', octubre: '10',
  noviembre: '11', diciembre: '12'
};

function normalizePeriod(value) {
  const original = cleanString(value);
  if (!original) return { id: 'sin_periodo', label: 'Sin periodo' };

  const direct = original.match(/(20\d{2})[-_/](\d{2}).*?(20\d{2})[-_/](\d{2})/);
  if (direct) {
    return { id: `${direct[1]}-${direct[2]}__${direct[3]}-${direct[4]}`, label: original };
  }

  const normalized = normalizeText(original);
  const matches = [...normalized.matchAll(/(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\s+(20\d{2})/g)];
  if (matches.length >= 2) {
    return {
      id: `${matches[0][2]}-${MONTHS[matches[0][1]]}__${matches[1][2]}-${MONTHS[matches[1][1]]}`,
      label: original
    };
  }

  return { id: slug(original) || 'sin_periodo', label: original };
}

function excelDateToIso(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();

  if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) {
      return new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d, parsed.H, parsed.M, Math.floor(parsed.S))).toISOString();
    }
  }

  const text = String(value).trim();
  if (!text || text.includes('FieldValue.serverTimestamp')) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function dateMillis(value) {
  const iso = excelDateToIso(value);
  return iso ? new Date(iso).getTime() : 0;
}

function normalizeStatus(value, fallback = 'PENDIENTE_REVISION') {
  const text = normalizeText(value).replace(/\s+/g, '_');
  if (!text) return fallback;
  if (text.includes('devuelt')) return 'DEVUELTO';
  if (text.includes('aprobad')) return 'APROBADO';
  if (text.includes('reemplaz')) return 'REEMPLAZADO';
  if (text.includes('resuelt')) return 'RESUELTO';
  if (text.includes('enviad')) return 'ENVIADO';
  if (text.includes('pendient')) return 'PENDIENTE_REVISION';
  if (text.includes('activo')) return 'ACTIVO';
  if (text.includes('inactivo')) return 'INACTIVO';
  return text.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
}

function normalizeCellValue(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'boolean' || typeof value === 'number') return value;
  const iso = excelDateToIso(value);
  if (iso && /^\d{4}-\d{2}-\d{2}T/.test(String(value))) return iso;
  return cleanString(value);
}

function analyzeTitlesWorkbook(filePath, workbook) {
  const enviosRows = sheetRows(workbook, 'Envios');
  const resolucionesRows = sheetRows(workbook, 'Resoluciones');
  const coordinadoresRows = sheetRows(workbook, 'Coordinadores');
  const indiceRows = sheetRows(workbook, 'IndiceEstudiantes');
  const estudiantesRows = sheetRows(workbook, 'Estudiantes');

  if (!enviosRows.length) throw new Error('La hoja Envios está vacía o no existe.');

  const warnings = [];
  const studentIndex = new Map();
  const careerByName = new Map();
  const periods = new Map();
  const careers = new Map();

  for (const row of indiceRows) {
    const cedula = normalizeCedula(pick(row, ['cedula', 'Cédula', 'numeroIdentificacion']));
    const period = normalizePeriod(pick(row, ['periodoId', 'periodoLabel', 'Periodo']));
    const careerName = cleanString(pick(row, ['nombreCarrera', 'Carrera']));
    const careerCode = cleanString(pick(row, ['codigoCarrera', 'Código carrera']));
    if (!cedula) continue;

    const careerId = careerCode ? slug(careerCode) : `carrera_${stableHash(careerName || 'sin_carrera')}`;
    const snapshot = compactObject({
      cedula,
      nombres: cleanString(pick(row, ['nombres', 'Estudiante', 'Nombres'])),
      carreraId: careerId,
      carreraCodigo: careerCode,
      carreraNombre: careerName,
      periodoId: period.id,
      periodoLabel: cleanString(pick(row, ['periodoLabel'])) || period.label,
      sede: cleanString(pick(row, ['sede'])),
      modalidad: cleanString(pick(row, ['modalidad'])),
      estadoMatricula: cleanString(pick(row, ['estadoMatricula'])),
      correoInstitucional: cleanString(pick(row, ['correoInstitucional'])),
      correoPersonal: cleanString(pick(row, ['correoPersonal'])),
      celular: String(pick(row, ['celular']) ?? '').replace(/\D/g, '') || null
    });

    studentIndex.set(`${period.id}__${cedula}`, snapshot);
    if (!studentIndex.has(cedula)) studentIndex.set(cedula, snapshot);

    periods.set(period.id, { id: period.id, nombre: snapshot.periodoLabel || period.label, activo: false });
    if (careerName) {
      careers.set(careerId, { id: careerId, codigo: careerCode, nombre: careerName, activo: true });
      careerByName.set(normalizeText(careerName), careerId);
    }
  }

  const groups = new Map();
  for (const [index, row] of enviosRows.entries()) {
    const cedula = normalizeCedula(pick(row, ['Cédula', 'cedula', 'numeroIdentificacion']));
    const period = normalizePeriod(pick(row, ['Periodo', 'periodoId']));
    if (!cedula) {
      warnings.push(`Envios fila ${index + 2}: cédula inválida.`);
      continue;
    }

    const key = `${period.id}__${cedula}`;
    const serverDate = excelDateToIso(pick(row, ['Fecha servidor']));
    const sentDate = excelDateToIso(pick(row, ['Fecha envío'])) || serverDate;
    const careerName = cleanString(pick(row, ['Carrera', 'nombreCarrera']));
    const indexSnapshot = studentIndex.get(key) || studentIndex.get(cedula) || {};
    const careerId = indexSnapshot.carreraId
      || careerByName.get(normalizeText(careerName))
      || `carrera_${stableHash(careerName || 'sin_carrera')}`;

    if (careerName && !careers.has(careerId)) {
      careers.set(careerId, {
        id: careerId,
        codigo: indexSnapshot.carreraCodigo || null,
        nombre: careerName,
        activo: true
      });
      careerByName.set(normalizeText(careerName), careerId);
    }

    periods.set(period.id, { id: period.id, nombre: period.label, activo: false });

    const titles = [1, 2, 3].map((number) => ({
      numero: number,
      titulo: cleanString(pick(row, [`Título ${number}`, `Titulo ${number}`, `Titulo${number}`]))
    })).filter((item) => item.titulo);

    const version = compactObject({
      filaOrigen: index + 2,
      idOrigen: cleanString(pick(row, ['ID registro'])),
      fechaServidor: serverDate,
      fechaEnvio: sentDate,
      cedula,
      nombres: cleanString(pick(row, ['Estudiante', 'Nombres'])) || indexSnapshot.nombres,
      carreraId: careerId,
      carreraNombre: careerName || indexSnapshot.carreraNombre,
      periodoId: period.id,
      periodoNombre: period.label,
      telegram: cleanString(pick(row, ['Telegram'])),
      titulo1: titles.find((item) => item.numero === 1)?.titulo || null,
      titulo2: titles.find((item) => item.numero === 2)?.titulo || null,
      titulo3: titles.find((item) => item.numero === 3)?.titulo || null,
      tituloPreferidoNumero: Number(pick(row, ['Preferido'])) || null,
      estadoFirebase: normalizeStatus(pick(row, ['Estado Firebase']), 'ENVIADO'),
      estadoGoogleSheets: normalizeStatus(pick(row, ['Estado Google Sheets']), 'RESPALDADO'),
      estado: normalizeStatus(pick(row, ['Estado']), 'PENDIENTE_REVISION'),
      observacion: cleanString(pick(row, ['Observación', 'Observacion']))
    });

    version.ordenFecha = dateMillis(version.fechaEnvio || version.fechaServidor);
    version.firma = stableHash(JSON.stringify({
      titulo1: version.titulo1,
      titulo2: version.titulo2,
      titulo3: version.titulo3,
      preferido: version.tituloPreferidoNumero,
      estado: version.estado,
      observacion: version.observacion
    }), 20);

    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(version);
  }

  const resolutionsByEnvio = new Map();
  for (const [index, row] of resolucionesRows.entries()) {
    const cedula = normalizeCedula(pick(row, ['Cédula', 'cedula']));
    const period = normalizePeriod(pick(row, ['Periodo', 'periodoId']));
    if (!cedula) {
      warnings.push(`Resoluciones fila ${index + 2}: cédula inválida.`);
      continue;
    }

    const envioId = `${period.id}__${cedula}`;
    const resolution = compactObject({
      filaOrigen: index + 2,
      idOrigen: cleanString(pick(row, ['ID registro'])),
      fechaServidor: excelDateToIso(pick(row, ['Fecha servidor'])),
      fechaResolucion: excelDateToIso(pick(row, ['Fecha resolución', 'Fecha resolucion']))
        || excelDateToIso(pick(row, ['Fecha servidor'])),
      cedula,
      nombres: cleanString(pick(row, ['Estudiante'])),
      carreraNombre: cleanString(pick(row, ['Carrera'])),
      periodoId: period.id,
      periodoNombre: period.label,
      coordinador: cleanString(pick(row, ['Coordinador'])),
      estado: normalizeStatus(pick(row, ['Estado final'])),
      tituloElegido: cleanString(pick(row, ['Título elegido', 'Titulo elegido'])),
      tituloCorregido: cleanString(pick(row, ['Título corregido', 'Titulo corregido'])),
      observacion: cleanString(pick(row, ['Observación', 'Observacion']))
    });

    resolution.ordenFecha = dateMillis(resolution.fechaResolucion || resolution.fechaServidor);
    resolution.firma = stableHash(JSON.stringify({
      estado: resolution.estado,
      titulo: resolution.tituloCorregido || resolution.tituloElegido,
      observacion: resolution.observacion,
      coordinador: resolution.coordinador
    }), 20);

    if (!resolutionsByEnvio.has(envioId)) resolutionsByEnvio.set(envioId, []);
    resolutionsByEnvio.get(envioId).push(resolution);
  }

  const envios = [];
  let duplicateRows = 0;
  let uniqueResolutionCount = 0;

  for (const [envioId, versions] of groups.entries()) {
    versions.sort((a, b) => a.ordenFecha - b.ordenFecha || a.filaOrigen - b.filaOrigen);
    const uniqueVersions = [];
    const versionSignatures = new Set();

    for (const version of versions) {
      if (versionSignatures.has(version.firma)) {
        duplicateRows += 1;
        continue;
      }
      versionSignatures.add(version.firma);
      uniqueVersions.push(version);
    }

    const current = uniqueVersions.at(-1) || versions.at(-1);
    const resolutions = (resolutionsByEnvio.get(envioId) || [])
      .sort((a, b) => a.ordenFecha - b.ordenFecha || a.filaOrigen - b.filaOrigen);
    const uniqueResolutions = [];
    const resolutionSignatures = new Set();

    for (const resolution of resolutions) {
      if (resolutionSignatures.has(resolution.firma)) continue;
      resolutionSignatures.add(resolution.firma);
      uniqueResolutions.push(resolution);
    }

    uniqueResolutionCount += uniqueResolutions.length;
    const currentResolution = uniqueResolutions.at(-1) || null;
    const snapshot = studentIndex.get(envioId) || studentIndex.get(current.cedula) || {};
    const preferredNumber = current.tituloPreferidoNumero;
    const preferredText = preferredNumber ? current[`titulo${preferredNumber}`] : null;
    const finalTitle = currentResolution?.tituloCorregido
      || currentResolution?.tituloElegido
      || preferredText
      || current.titulo1
      || current.titulo2
      || current.titulo3
      || null;

    const cleanVersions = uniqueVersions.map(({ ordenFecha: _orden, firma: _firma, ...item }) => item);
    const cleanResolutions = uniqueResolutions.map(({ ordenFecha: _orden, firma: _firma, ...item }) => item);

    envios.push(compactObject({
      id: envioId,
      cedula: current.cedula,
      nombres: current.nombres || snapshot.nombres,
      periodoId: current.periodoId,
      periodoNombre: current.periodoNombre,
      carreraId: current.carreraId,
      carreraCodigo: snapshot.carreraCodigo,
      carreraNombre: current.carreraNombre || snapshot.carreraNombre,
      sede: snapshot.sede,
      modalidad: snapshot.modalidad,
      correoInstitucional: snapshot.correoInstitucional,
      correoPersonal: snapshot.correoPersonal,
      celular: snapshot.celular,
      telegram: current.telegram,
      titulo1: current.titulo1,
      titulo2: current.titulo2,
      titulo3: current.titulo3,
      tituloPreferidoNumero: preferredNumber,
      tituloPreferido: preferredText,
      tituloElegido: currentResolution?.tituloElegido || null,
      tituloCorregido: currentResolution?.tituloCorregido || null,
      tituloFinal: finalTitle,
      estado: currentResolution?.estado || current.estado || 'PENDIENTE_REVISION',
      observacion: currentResolution?.observacion || current.observacion,
      coordinador: currentResolution?.coordinador,
      fechaEnvio: current.fechaEnvio || current.fechaServidor,
      fechaResolucion: currentResolution?.fechaResolucion || currentResolution?.fechaServidor,
      estadoFirebase: current.estadoFirebase,
      estadoGoogleSheets: current.estadoGoogleSheets,
      versionActual: cleanVersions.length,
      resolucionesTotal: cleanResolutions.length,
      historialVersiones: cleanVersions,
      historialResoluciones: cleanResolutions,
      requiereRevision: false
    }));
  }

  for (const row of estudiantesRows) {
    const cedula = normalizeCedula(pick(row, ['Cédula', 'cedula', 'numeroIdentificacion']));
    const period = normalizePeriod(pick(row, ['Periodo', 'periodoId']));
    if (!cedula) continue;

    const id = `${period.id}__${cedula}`;
    if (groups.has(id)) continue;

    const estado = normalizeStatus(pick(row, ['Estado']), 'PENDIENTE_REVISION');
    const hasSubmission = normalizeText(pick(row, ['Tiene envío', 'Tiene envio']));
    if (!hasSubmission.includes('si') && estado === 'PENDIENTE_REVISION') continue;

    const snapshot = studentIndex.get(id) || studentIndex.get(cedula) || {};
    const relatedResolutions = (resolutionsByEnvio.get(id) || []).map(({ ordenFecha: _orden, firma: _firma, ...item }) => item);
    const currentResolution = relatedResolutions.at(-1) || null;

    envios.push(compactObject({
      id,
      cedula,
      nombres: cleanString(pick(row, ['Estudiante', 'Nombres'])) || snapshot.nombres,
      periodoId: period.id,
      periodoNombre: period.label,
      carreraId: snapshot.carreraId || `carrera_${stableHash(pick(row, ['Carrera']) || 'sin_carrera')}`,
      carreraCodigo: snapshot.carreraCodigo,
      carreraNombre: cleanString(pick(row, ['Carrera'])) || snapshot.carreraNombre,
      correoInstitucional: snapshot.correoInstitucional,
      correoPersonal: snapshot.correoPersonal,
      telegram: cleanString(pick(row, ['Telegram'])),
      tituloElegido: currentResolution?.tituloElegido,
      tituloCorregido: currentResolution?.tituloCorregido,
      tituloFinal: currentResolution?.tituloCorregido || currentResolution?.tituloElegido || null,
      estado: currentResolution?.estado || estado,
      observacion: currentResolution?.observacion,
      coordinador: currentResolution?.coordinador,
      fechaResolucion: currentResolution?.fechaResolucion,
      versionActual: 0,
      resolucionesTotal: relatedResolutions.length,
      historialVersiones: [],
      historialResoluciones: relatedResolutions,
      datosIncompletosOrigen: true,
      requiereRevision: true
    }));

    warnings.push(`Se recuperó ${id} desde Estudiantes, pero no tiene los tres títulos completos en Envios.`);
  }

  const coordinators = new Map();
  for (const row of coordinadoresRows) {
    const name = cleanString(pick(row, ['Coordinador']));
    if (!name) continue;

    const id = cleanString(pick(row, ['ID registro'])) || slug(name);
    const careerNames = String(pick(row, ['Carreras']) || '')
      .split('|')
      .map((item) => item.trim())
      .filter(Boolean);

    const careerIds = careerNames
      .map((careerName) => careerByName.get(normalizeText(careerName)))
      .filter(Boolean);

    coordinators.set(id, compactObject({
      id,
      nombre: name,
      telegram: cleanString(pick(row, ['Telegram'])),
      carrerasIds: [...new Set(careerIds)],
      carrerasNombres: careerNames,
      estado: normalizeStatus(pick(row, ['Estado']), 'ACTIVO'),
      actualizadoEn: excelDateToIso(pick(row, ['Fecha'])) || excelDateToIso(pick(row, ['Fecha servidor']))
    }));
  }

  const latestPeriod = [...periods.values()].sort((a, b) => a.id.localeCompare(b.id)).at(-1);
  if (latestPeriod) latestPeriod.activo = true;

  return {
    type: 'titulos',
    typeLabel: 'Respaldo de títulos',
    sourcePath: filePath,
    analyzedAt: new Date().toISOString(),
    periods: [...periods.values()],
    careers: [...careers.values()],
    coordinators: [...coordinators.values()],
    envios,
    warnings: warnings.slice(0, 100),
    summary: {
      archivo: path.basename(filePath),
      enviosOriginales: enviosRows.length,
      enviosConsolidados: envios.length,
      filasDuplicadas: duplicateRows,
      resolucionesOriginales: resolucionesRows.length,
      resolucionesUnicas: uniqueResolutionCount,
      coordinadores: coordinators.size,
      periodos: periods.size,
      carreras: careers.size,
      advertencias: warnings.length
    },
    metrics: [
      { label: 'Filas de envíos', value: enviosRows.length },
      { label: 'Envíos organizados', value: envios.length },
      { label: 'Resoluciones únicas', value: uniqueResolutionCount },
      { label: 'Duplicados descartados', value: duplicateRows }
    ],
    collections: [
      { name: 'periodos', count: periods.size },
      { name: 'carreras', count: careers.size },
      { name: 'coordinadores', count: coordinators.size },
      { name: 'envios', count: envios.length },
      { name: 'configuracion', count: 1 },
      { name: 'migraciones', count: 1 }
    ],
    previewHeaders: ['Cédula', 'Estudiante', 'Periodo', 'Estado'],
    previewRows: envios.slice(0, 40).map((item) => [
      item.cedula,
      item.nombres || 'Sin nombre',
      item.periodoNombre || 'Sin periodo',
      item.estado
    ])
  };
}

function analyzeKeysWorkbook(filePath, workbook) {
  const iaRows = sheetRows(workbook, 'IA');
  const serviceRows = sheetRows(workbook, 'Servicios');
  const configRows = sheetRows(workbook, 'Configuracion');

  const ia = iaRows
    .map((row, index) => {
      const id = cleanString(pick(row, ['id'])) || `ia_${index + 1}`;
      if (!cleanString(pick(row, ['nombre'])) && !cleanString(pick(row, ['credencial']))) return null;
      return compactObject({
        id: slug(id) || `ia_${index + 1}`,
        nombre: cleanString(pick(row, ['nombre'])),
        tipo: cleanString(pick(row, ['tipo'])),
        endpoint: cleanString(pick(row, ['endpoint'])),
        modelo: cleanString(pick(row, ['modelo'])),
        credencial: cleanString(pick(row, ['credencial'])),
        estado: normalizeStatus(pick(row, ['estado']), 'ACTIVO'),
        prioridad: Number(pick(row, ['prioridad'])) || null,
        timeoutMs: Number(pick(row, ['timeoutMs'])) || null,
        maxTokens: Number(pick(row, ['maxTokens'])) || null,
        temperatura: Number(pick(row, ['temperatura'])) || 0,
        descripcion: cleanString(pick(row, ['descripcion'])),
        ultimaPruebaOk: Boolean(pick(row, ['ultimaPruebaOk'])),
        ultimaPruebaEn: excelDateToIso(pick(row, ['ultimaPruebaEn'])),
        ultimaLatenciaMs: Number(pick(row, ['ultimaLatenciaMs'])) || null,
        ultimoError: cleanString(pick(row, ['ultimoError'])),
        actualizadoEnOrigen: excelDateToIso(pick(row, ['actualizadoEn']))
      });
    })
    .filter(Boolean);

  const services = serviceRows
    .map((row, index) => {
      const key = cleanString(pick(row, ['clave'])) || `servicio_${index + 1}`;
      if (!cleanString(pick(row, ['nombre'])) && !cleanString(pick(row, ['endpoint']))) return null;
      return compactObject({
        id: slug(key) || `servicio_${index + 1}`,
        clave: key,
        nombre: cleanString(pick(row, ['nombre'])),
        tipo: cleanString(pick(row, ['tipo'])),
        endpoint: cleanString(pick(row, ['endpoint'])),
        secreto: cleanString(pick(row, ['secreto'])),
        spreadsheetId: cleanString(pick(row, ['spreadsheetId'])),
        estado: normalizeStatus(pick(row, ['estado']), 'ACTIVO'),
        timeoutMs: Number(pick(row, ['timeoutMs'])) || null,
        version: cleanString(pick(row, ['version'])),
        mensaje: cleanString(pick(row, ['mensaje'])),
        actualizadoEnOrigen: excelDateToIso(pick(row, ['actualizadoEn']))
      });
    })
    .filter(Boolean);

  const configurations = configRows
    .map((row, index) => {
      const key = cleanString(pick(row, ['clave'])) || `config_${index + 1}`;
      const value = pick(row, ['valor']);
      if (!cleanString(key) || value == null || value === '') return null;
      return compactObject({
        id: slug(key) || `config_${index + 1}`,
        clave: key,
        valor: normalizeCellValue(value),
        descripcion: cleanString(pick(row, ['descripcion'])),
        actualizadoEnOrigen: excelDateToIso(pick(row, ['actualizadoEn']))
      });
    })
    .filter(Boolean);

  const credentialsCount = ia.filter((item) => item.credencial).length
    + services.filter((item) => item.secreto).length
    + configurations.filter((item) => /acceso|clave|token|secret/i.test(item.clave)).length;

  return {
    type: 'claves',
    typeLabel: 'Claves y configuración de IA',
    sourcePath: filePath,
    analyzedAt: new Date().toISOString(),
    ia,
    services,
    configurations,
    warnings: [],
    summary: {
      archivo: path.basename(filePath),
      proveedoresIA: ia.length,
      servicios: services.length,
      configuraciones: configurations.length,
      credenciales: credentialsCount
    },
    metrics: [
      { label: 'Proveedores IA', value: ia.length },
      { label: 'Servicios', value: services.length },
      { label: 'Configuraciones', value: configurations.length },
      { label: 'Claves incluidas', value: credentialsCount }
    ],
    collections: [
      { name: 'ia', count: ia.length },
      { name: 'servicios', count: services.length },
      { name: 'configuracion', count: configurations.length },
      { name: 'migraciones', count: 1 }
    ],
    previewHeaders: ['ID', 'Proveedor', 'Modelo o tipo', 'Estado'],
    previewRows: ia.map((item) => [
      item.id,
      item.nombre || 'Sin nombre',
      item.modelo || item.tipo || 'Sin modelo',
      item.estado || 'SIN_ESTADO'
    ])
  };
}

function analyzeSelectedWorkbook(filePath) {
  const workbook = readWorkbook(filePath);
  const type = detectWorkbookType(workbook);
  if (type === 'titulos') return analyzeTitlesWorkbook(filePath, workbook);
  if (type === 'claves') return analyzeKeysWorkbook(filePath, workbook);
  throw new Error('El Excel no corresponde al respaldo de títulos ni al archivo de claves de IA.');
}

function serializeFirestoreValue(value) {
  if (value == null) return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(serializeFirestoreValue);
  if (typeof value === 'object') {
    if (typeof value.toDate === 'function') {
      try {
        return value.toDate().toISOString();
      } catch (_error) {
        return String(value);
      }
    }
    const output = {};
    for (const [key, item] of Object.entries(value)) output[key] = serializeFirestoreValue(item);
    return output;
  }
  return value;
}

async function getClientDatabase() {
  const { initializeApp: initializeClientApp, getApps: getClientApps } = require('firebase/app');
  const { getFirestore } = require('firebase/firestore');
  const appName = 'titulos-migrador-web';
  const clientApp = getClientApps().find((item) => item.name === appName)
    || initializeClientApp(FIREBASE_CONFIG, appName);
  return getFirestore(clientApp);
}

async function createLocalBackup(db, result, migrationId) {
  const { doc, getDoc } = require('firebase/firestore');
  const documents = [];
  const targets = [];

  if (result.type === 'titulos') {
    for (const item of result.envios) targets.push(['envios', item.id]);
  } else {
    for (const item of result.ia) targets.push(['ia', item.id]);
    for (const item of result.services) targets.push(['servicios', item.id]);
    for (const item of result.configurations) targets.push(['configuracion', item.id]);
  }

  for (let index = 0; index < targets.length; index += 1) {
    const [collectionName, documentId] = targets[index];
    const snapshot = await getDoc(doc(db, collectionName, documentId));
    if (snapshot.exists()) {
      documents.push({
        path: `${collectionName}/${documentId}`,
        data: serializeFirestoreValue(snapshot.data())
      });
    }

    if ((index + 1) % 10 === 0 || index + 1 === targets.length) {
      sendProgress(
        47 + Math.round(((index + 1) / Math.max(targets.length, 1)) * 7),
        `Preparando respaldo: ${index + 1}/${targets.length}`
      );
    }
  }

  const backupFolder = path.join(path.dirname(result.sourcePath), 'backups_migracion');
  fs.mkdirSync(backupFolder, { recursive: true });
  const backupPath = path.join(backupFolder, `${migrationId}.json`);
  fs.writeFileSync(backupPath, JSON.stringify({
    migrationId,
    tipo: result.type,
    createdAt: new Date().toISOString(),
    documents
  }, null, 2));

  return { backupPath, total: documents.length };
}

async function migrateToFirestore(result) {
  const { doc, setDoc, writeBatch, serverTimestamp } = require('firebase/firestore');
  const db = await getClientDatabase();
  const migrationId = `MIG_${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`;
  const migrationRef = doc(db, 'migraciones', migrationId);

  try {
    sendProgress(42, 'Conectando directamente con Firestore…');
    await setDoc(migrationRef, {
      estado: 'EJECUTANDO',
      tipo: result.type,
      archivoOrigen: path.basename(result.sourcePath),
      proyectoDestino: TARGET_PROJECT_ID,
      iniciadoEn: serverTimestamp(),
      resumenAnalisis: result.summary
    }, { merge: true });

    sendProgress(47, 'Creando respaldo local de los documentos que se actualizarán…');
    const backup = await createLocalBackup(db, result, migrationId);

    const writes = [];
    if (result.type === 'titulos') {
      for (const period of result.periods) {
        writes.push(['periodos', period.id, { ...period, migracionId, actualizadoEn: serverTimestamp() }]);
      }
      for (const career of result.careers) {
        writes.push(['carreras', career.id, { ...career, migracionId, actualizadoEn: serverTimestamp() }]);
      }
      for (const coordinator of result.coordinators) {
        writes.push(['coordinadores', coordinator.id, { ...coordinator, migracionId, actualizadoEn: serverTimestamp() }]);
      }
      for (const envio of result.envios) {
        const { id, ...data } = envio;
        writes.push(['envios', id, {
          ...data,
          migracionId,
          archivoOrigen: path.basename(result.sourcePath),
          migradoEn: serverTimestamp(),
          actualizadoEn: serverTimestamp()
        }]);
      }
      writes.push(['configuracion', 'general', {
        proyectoId: TARGET_PROJECT_ID,
        ultimaMigracionId: migrationId,
        ultimaMigracionEn: serverTimestamp(),
        periodoActivoId: result.periods.find((item) => item.activo)?.id || null,
        enviosHabilitados: true
      }]);
    } else {
      for (const provider of result.ia) {
        const { id, ...data } = provider;
        writes.push(['ia', id, {
          ...data,
          migracionId,
          archivoOrigen: path.basename(result.sourcePath),
          actualizadoEn: serverTimestamp()
        }]);
      }
      for (const service of result.services) {
        const { id, ...data } = service;
        writes.push(['servicios', id, {
          ...data,
          migracionId,
          archivoOrigen: path.basename(result.sourcePath),
          actualizadoEn: serverTimestamp()
        }]);
      }
      for (const configuration of result.configurations) {
        const { id, ...data } = configuration;
        writes.push(['configuracion', id, {
          ...data,
          migracionId,
          archivoOrigen: path.basename(result.sourcePath),
          actualizadoEn: serverTimestamp()
        }]);
      }
    }

    let batch = writeBatch(db);
    let pendingInBatch = 0;
    let processed = 0;

    const flush = async () => {
      if (!pendingInBatch) return;
      await batch.commit();
      batch = writeBatch(db);
      pendingInBatch = 0;
    };

    for (const [collectionName, documentId, data] of writes) {
      batch.set(doc(db, collectionName, documentId), compactObject(data), { merge: true });
      pendingInBatch += 1;
      processed += 1;
      sendProgress(
        56 + Math.round((processed / Math.max(writes.length, 1)) * 40),
        `Subiendo ${processed}/${writes.length} documentos…`
      );
      if (pendingInBatch >= 400) await flush();
    }

    await flush();

    await setDoc(migrationRef, {
      estado: 'COMPLETADA',
      finalizadoEn: serverTimestamp(),
      tipo: result.type,
      archivoOrigen: path.basename(result.sourcePath),
      resumen: result.summary,
      documentosProgramados: writes.length,
      respaldoLocal: backup.backupPath,
      documentosRespaldados: backup.total,
      errores: []
    }, { merge: true });

    sendProgress(100, 'Migración completada correctamente.', 'success');
    return {
      migrationId,
      migrationType: result.type,
      projectId: TARGET_PROJECT_ID,
      totalWrites: writes.length,
      backupPath: backup.backupPath,
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
      // Conservar el error original.
    }

    const message = error?.code === 'permission-denied'
      ? 'Firestore rechazó la escritura. Verifica que las reglas publicadas permitan read y write.'
      : (error?.message || String(error));

    sendProgress(0, 'La migración no pudo completarse.', 'error');
    throw new Error(message);
  }
}

ipcMain.handle('excel:seleccionar', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Seleccionar Excel',
    properties: ['openFile'],
    filters: [{ name: 'Archivos Excel', extensions: ['xlsx', 'xls'] }]
  });

  if (result.canceled || !result.filePaths[0]) return null;
  const filePath = result.filePaths[0];
  const workbook = readWorkbook(filePath);
  const type = detectWorkbookType(workbook);

  if (!type) {
    throw new Error('El archivo no contiene las hojas necesarias de títulos ni las hojas de claves de IA.');
  }

  selectedExcelPath = filePath;
  selectedWorkbookType = type;
  analysisResult = null;

  return {
    selectedName: path.basename(filePath),
    sourceName: path.basename(filePath),
    sourcePath: filePath,
    type,
    typeLabel: type === 'titulos' ? 'Respaldo de títulos' : 'Claves y configuración de IA'
  };
});

ipcMain.handle('excel:analizar', async () => {
  if (!selectedExcelPath || !selectedWorkbookType) {
    throw new Error('Primero selecciona uno de los archivos Excel.');
  }

  sendProgress(8, 'Leyendo y organizando el Excel…');
  await new Promise((resolve) => setTimeout(resolve, 50));
  analysisResult = analyzeSelectedWorkbook(selectedExcelPath);
  sendProgress(100, 'Análisis completado. Ya puedes subir a Firestore.', 'success');

  return {
    type: analysisResult.type,
    typeLabel: analysisResult.typeLabel,
    summary: analysisResult.summary,
    metrics: analysisResult.metrics,
    collections: analysisResult.collections,
    warnings: analysisResult.warnings,
    previewHeaders: analysisResult.previewHeaders,
    previewRows: analysisResult.previewRows
  };
});

ipcMain.handle('firebase:migrar', async () => {
  if (!analysisResult) throw new Error('Primero pulsa Analizar.');
  return migrateToFirestore(analysisResult);
});
