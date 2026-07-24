const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const XLSX = require('xlsx');
const { cert, getApps, initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const TARGET_PROJECT_ID = 'titulos-ec2fa';
let mainWindow;
let selectedExcelPath = null;
let analysisResult = null;

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
  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile('index.html');
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

function sendProgress(percent, message, tone = 'normal') {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('migracion:progreso', { percent, message, tone });
}

function readWorkbook(filePath) {
  return XLSX.readFile(filePath, { cellDates: false, raw: true });
}

function hasMigrationSheets(workbook) {
  const names = new Set(workbook.SheetNames.map((name) => normalizeText(name)));
  return names.has('envios') && names.has('resoluciones') && names.has('coordinadores');
}

function resolveBackupPath(chosenPath) {
  const chosenBook = readWorkbook(chosenPath);
  if (hasMigrationSheets(chosenBook)) return chosenPath;

  const folder = path.dirname(chosenPath);
  const candidates = fs.readdirSync(folder)
    .filter((name) => /\.xlsx?$/i.test(name) && !name.startsWith('~$'))
    .map((name) => path.join(folder, name));

  for (const candidate of candidates) {
    try {
      if (hasMigrationSheets(readWorkbook(candidate))) return candidate;
    } catch (_error) {
      // Ignorar archivos dañados o protegidos.
    }
  }

  throw new Error('El archivo seleccionado no contiene Envios, Resoluciones y Coordinadores, y no se encontró un respaldo válido en la misma carpeta.');
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

function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
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

function cleanString(value) {
  const text = String(value ?? '').trim();
  return text || null;
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

function slug(value) {
  return normalizeText(value)
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120);
}

function stableHash(value, length = 12) {
  return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, length);
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
  return text.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
}

function compactObject(value) {
  if (Array.isArray(value)) return value.map(compactObject).filter((item) => item !== undefined);
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

function analyzeWorkbook(filePath) {
  const workbook = readWorkbook(filePath);
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
      carreraId,
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
    const careerId = indexSnapshot.carreraId || careerByName.get(normalizeText(careerName)) || `carrera_${stableHash(careerName || 'sin_carrera')}`;

    if (careerName && !careers.has(careerId)) {
      careers.set(careerId, { id: careerId, codigo: indexSnapshot.carreraCodigo || null, nombre: careerName, activo: true });
      careerByName.set(normalizeText(careerName), careerId);
    }
    periods.set(period.id, { id: period.id, nombre: period.label, activo: false });

    const version = compactObject({
      sourceRow: index + 2,
      sourceId: cleanString(pick(row, ['ID registro'])),
      fechaServidor: serverDate,
      fechaEnvio: sentDate,
      cedula,
      estudiante: cleanString(pick(row, ['Estudiante', 'Nombres'])) || indexSnapshot.nombres,
      carreraId,
      carreraNombre: careerName || indexSnapshot.carreraNombre,
      periodoId: period.id,
      periodoLabel: period.label,
      telegram: cleanString(pick(row, ['Telegram'])),
      propuestas: [1, 2, 3].map((number) => ({
        numero: number,
        titulo: cleanString(pick(row, [`Título ${number}`, `Titulo ${number}`, `Titulo${number}`]))
      })).filter((item) => item.titulo),
      propuestaPreferida: Number(pick(row, ['Preferido'])) || null,
      estadoFirebase: normalizeStatus(pick(row, ['Estado Firebase']), 'ENVIADO'),
      estadoGoogleSheets: normalizeStatus(pick(row, ['Estado Google Sheets']), 'RESPALDADO'),
      estado: normalizeStatus(pick(row, ['Estado']), 'PENDIENTE_REVISION'),
      observacion: cleanString(pick(row, ['Observación', 'Observacion']))
    });
    version.sortMillis = dateMillis(version.fechaEnvio || version.fechaServidor);
    version.signature = stableHash(JSON.stringify({
      propuestas: version.propuestas,
      preferida: version.propuestaPreferida,
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
      sourceRow: index + 2,
      sourceId: cleanString(pick(row, ['ID registro'])),
      fechaServidor: excelDateToIso(pick(row, ['Fecha servidor'])),
      fechaResolucion: excelDateToIso(pick(row, ['Fecha resolución', 'Fecha resolucion'])) || excelDateToIso(pick(row, ['Fecha servidor'])),
      cedula,
      estudiante: cleanString(pick(row, ['Estudiante'])),
      carrera: cleanString(pick(row, ['Carrera'])),
      periodoId: period.id,
      periodoLabel: period.label,
      coordinador: cleanString(pick(row, ['Coordinador'])),
      estadoFinal: normalizeStatus(pick(row, ['Estado final'])),
      tituloElegido: cleanString(pick(row, ['Título elegido', 'Titulo elegido'])),
      tituloCorregido: cleanString(pick(row, ['Título corregido', 'Titulo corregido'])),
      observacion: cleanString(pick(row, ['Observación', 'Observacion']))
    });
    resolution.sortMillis = dateMillis(resolution.fechaResolucion || resolution.fechaServidor);
    resolution.signature = stableHash(JSON.stringify({
      estado: resolution.estadoFinal,
      titulo: resolution.tituloCorregido || resolution.tituloElegido,
      observacion: resolution.observacion,
      coordinador: resolution.coordinador
    }), 20);
    if (!resolutionsByEnvio.has(envioId)) resolutionsByEnvio.set(envioId, []);
    resolutionsByEnvio.get(envioId).push(resolution);
  }

  const envios = [];
  let duplicateRows = 0;
  for (const [envioId, versions] of groups.entries()) {
    versions.sort((a, b) => a.sortMillis - b.sortMillis || a.sourceRow - b.sourceRow);
    const uniqueVersions = [];
    const signatures = new Set();
    for (const version of versions) {
      if (signatures.has(version.signature)) {
        duplicateRows += 1;
        continue;
      }
      signatures.add(version.signature);
      uniqueVersions.push(version);
    }
    const current = uniqueVersions.at(-1) || versions.at(-1);
    const resolutions = (resolutionsByEnvio.get(envioId) || [])
      .sort((a, b) => a.sortMillis - b.sortMillis || a.sourceRow - b.sourceRow);
    const uniqueResolutions = [];
    const resolutionSignatures = new Set();
    for (const resolution of resolutions) {
      if (resolutionSignatures.has(resolution.signature)) continue;
      resolutionSignatures.add(resolution.signature);
      uniqueResolutions.push(resolution);
    }
    const currentResolution = uniqueResolutions.at(-1) || null;
    const snapshot = studentIndex.get(envioId) || studentIndex.get(current.cedula) || {};
    const finalStatus = currentResolution?.estadoFinal || current.estado || 'PENDIENTE_REVISION';

    envios.push(compactObject({
      id: envioId,
      cedula: current.cedula,
      periodoId: current.periodoId,
      periodoLabel: current.periodoLabel,
      carreraId: current.carreraId,
      estudianteSnapshot: {
        nombres: current.estudiante || snapshot.nombres,
        carreraCodigo: snapshot.carreraCodigo,
        carreraNombre: current.carreraNombre || snapshot.carreraNombre,
        sede: snapshot.sede,
        correoInstitucional: snapshot.correoInstitucional,
        correoPersonal: snapshot.correoPersonal,
        celular: snapshot.celular
      },
      telegram: current.telegram,
      propuestas: current.propuestas,
      propuestaPreferida: current.propuestaPreferida,
      estado: finalStatus,
      estadoFirebase: current.estadoFirebase,
      estadoGoogleSheets: current.estadoGoogleSheets,
      observacion: current.observacion,
      fechaEnvio: current.fechaEnvio || current.fechaServidor,
      versionActual: uniqueVersions.length,
      resolucionActual: currentResolution ? {
        estado: currentResolution.estadoFinal,
        tituloElegido: currentResolution.tituloElegido,
        tituloCorregido: currentResolution.tituloCorregido,
        observacion: currentResolution.observacion,
        coordinador: currentResolution.coordinador,
        fecha: currentResolution.fechaResolucion || currentResolution.fechaServidor
      } : null,
      versions: uniqueVersions,
      resolutions: uniqueResolutions
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
    if (!hasSubmission.includes('si') && !hasSubmission.includes('sí') && estado === 'PENDIENTE_REVISION') continue;
    const snapshot = studentIndex.get(id) || studentIndex.get(cedula) || {};
    envios.push(compactObject({
      id,
      cedula,
      periodoId: period.id,
      periodoLabel: period.label,
      carreraId: snapshot.carreraId || `carrera_${stableHash(pick(row, ['Carrera']) || 'sin_carrera')}`,
      estudianteSnapshot: {
        nombres: cleanString(pick(row, ['Estudiante', 'Nombres'])) || snapshot.nombres,
        carreraCodigo: snapshot.carreraCodigo,
        carreraNombre: cleanString(pick(row, ['Carrera'])) || snapshot.carreraNombre,
        correoInstitucional: snapshot.correoInstitucional,
        correoPersonal: snapshot.correoPersonal
      },
      telegram: cleanString(pick(row, ['Telegram'])),
      propuestas: [],
      estado,
      versionActual: 0,
      datosIncompletosOrigen: true,
      requiereRevision: true,
      versions: [],
      resolutions: resolutionsByEnvio.get(id) || []
    }));
    warnings.push(`Se recuperó ${id} desde Estudiantes, pero no tiene propuestas completas en Envios.`);
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
    const careerIds = careerNames.map((careerName) => {
      const normalizedName = normalizeText(careerName);
      let careerId = careerByName.get(normalizedName);
      if (!careerId) {
        careerId = `carrera_${stableHash(careerName)}`;
        careers.set(careerId, { id: careerId, codigo: null, nombre: careerName, activo: true });
        careerByName.set(normalizedName, careerId);
      }
      return careerId;
    });
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

  const summary = {
    archivo: path.basename(filePath),
    enviosOriginales: enviosRows.length,
    enviosConsolidados: envios.length,
    filasDuplicadas: duplicateRows,
    resolucionesOriginales: resolucionesRows.length,
    resolucionesUnicas: envios.reduce((total, item) => total + item.resolutions.length, 0),
    coordinadores: coordinators.size,
    periodos: periods.size,
    carreras: careers.size,
    advertencias: warnings.length
  };

  return {
    sourcePath: filePath,
    analyzedAt: new Date().toISOString(),
    summary,
    periods: [...periods.values()],
    careers: [...careers.values()],
    coordinators: [...coordinators.values()],
    envios,
    warnings: warnings.slice(0, 100),
    preview: envios.slice(0, 30).map((item) => ({
      cedula: item.cedula,
      estudiante: item.estudianteSnapshot?.nombres || 'Sin nombre',
      periodo: item.periodoLabel,
      carrera: item.estudianteSnapshot?.carreraNombre || 'Sin carrera',
      estado: item.estado,
      versiones: item.versionActual,
      resoluciones: item.resolutions.length
    }))
  };
}

function findServiceAccount(sourcePath) {
  const directories = [
    path.dirname(sourcePath),
    app.getPath('userData'),
    path.dirname(app.getPath('exe')),
    process.resourcesPath
  ];
  const exactNames = ['firebase-admin.json', 'titulos-admin.json', 'service-account.json'];

  for (const directory of [...new Set(directories)]) {
    if (!directory || !fs.existsSync(directory)) continue;
    for (const fileName of exactNames) {
      const candidate = path.join(directory, fileName);
      if (fs.existsSync(candidate)) return candidate;
    }
    const generated = fs.readdirSync(directory).find((name) => /^titulos-ec2fa-firebase-adminsdk.*\.json$/i.test(name));
    if (generated) return path.join(directory, generated);
  }
  return null;
}

function loadServiceAccount(sourcePath) {
  const accountPath = findServiceAccount(sourcePath);
  if (!accountPath) {
    throw new Error('No se encontró firebase-admin.json. Descarga la clave privada de Cuentas de servicio, renómbrala firebase-admin.json y colócala en la misma carpeta del Excel.');
  }
  const data = JSON.parse(fs.readFileSync(accountPath, 'utf8'));
  if (data.project_id !== TARGET_PROJECT_ID) {
    throw new Error(`La cuenta de servicio pertenece a ${data.project_id || 'otro proyecto'}, no a ${TARGET_PROJECT_ID}.`);
  }
  return { data, accountPath };
}

function getAdminApp(serviceAccount) {
  const existing = getApps().find((item) => item.name === 'titulos-migrador');
  if (existing) return existing;
  return initializeApp({ credential: cert(serviceAccount) }, 'titulos-migrador');
}

async function backupExisting(db, envios, migrationId, sourcePath) {
  const backup = [];
  let processed = 0;
  for (const item of envios) {
    const snapshot = await db.collection('envios').doc(item.id).get();
    if (snapshot.exists) backup.push({ id: item.id, data: snapshot.data() });
    processed += 1;
    if (processed % 10 === 0) sendProgress(48 + Math.round((processed / envios.length) * 7), `Preparando respaldo: ${processed}/${envios.length}`);
  }
  const backupFolder = path.join(path.dirname(sourcePath), 'backups_migracion');
  fs.mkdirSync(backupFolder, { recursive: true });
  const backupPath = path.join(backupFolder, `${migrationId}.json`);
  fs.writeFileSync(backupPath, JSON.stringify({ migrationId, createdAt: new Date().toISOString(), documents: backup }, null, 2));
  return { backupPath, total: backup.length };
}

function addBulkErrorHandling(writer, errors) {
  writer.onWriteError((error) => {
    errors.push({ code: error.code, message: error.message, path: error.documentRef?.path || null });
    return error.failedAttempts < 3;
  });
}

async function migrateToFirestore(result) {
  const { data: serviceAccount, accountPath } = loadServiceAccount(result.sourcePath);
  const adminApp = getAdminApp(serviceAccount);
  const db = getFirestore(adminApp);
  const migrationId = `MIG_${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`;
  const errors = [];

  sendProgress(42, 'Conectando con Firestore…');
  await db.collection('migraciones').doc(migrationId).set({
    estado: 'EJECUTANDO',
    archivoOrigen: path.basename(result.sourcePath),
    iniciadoEn: FieldValue.serverTimestamp(),
    resumenAnalisis: result.summary
  });

  sendProgress(48, 'Creando respaldo de documentos existentes…');
  const backup = await backupExisting(db, result.envios, migrationId, result.sourcePath);

  const writer = db.bulkWriter();
  addBulkErrorHandling(writer, errors);
  let totalWrites = result.periods.length + result.careers.length + result.coordinators.length + result.envios.length;
  totalWrites += result.envios.reduce((total, item) => total + item.versions.length + item.resolutions.length, 0);
  totalWrites += 2;
  let queued = 0;

  const queueSet = (ref, data, options = { merge: true }) => {
    writer.set(ref, data, options);
    queued += 1;
    if (queued % 25 === 0 || queued === totalWrites) {
      sendProgress(56 + Math.round((queued / totalWrites) * 40), `Subiendo ${queued}/${totalWrites} documentos…`);
    }
  };

  for (const period of result.periods) {
    queueSet(db.collection('periodos').doc(period.id), {
      ...period,
      actualizadoEn: FieldValue.serverTimestamp(),
      migracionId
    });
  }

  for (const career of result.careers) {
    queueSet(db.collection('carreras').doc(career.id), {
      ...career,
      actualizadoEn: FieldValue.serverTimestamp(),
      migracionId
    });
  }

  for (const coordinator of result.coordinators) {
    queueSet(db.collection('coordinadores').doc(coordinator.id), {
      ...coordinator,
      actualizadoEn: FieldValue.serverTimestamp(),
      migracionId
    });
  }

  for (const envio of result.envios) {
    const envioRef = db.collection('envios').doc(envio.id);
    const { versions, resolutions, id: _envioId, ...envioData } = envio;
    queueSet(envioRef, {
      ...envioData,
      actualizadoEn: FieldValue.serverTimestamp(),
      migracion: {
        id: migrationId,
        archivoOrigen: path.basename(result.sourcePath),
        migradoEn: FieldValue.serverTimestamp()
      }
    });

    versions.forEach((version, index) => {
      const versionId = version.sourceId ? slug(version.sourceId) : `version_${String(index + 1).padStart(3, '0')}_${version.signature}`;
      const { sortMillis: _sortMillis, signature: _signature, ...versionData } = version;
      queueSet(envioRef.collection('versiones').doc(versionId), {
        ...versionData,
        numeroVersion: index + 1,
        migracionId
      });
    });

    resolutions.forEach((resolution, index) => {
      const resolutionId = resolution.sourceId ? slug(resolution.sourceId) : `resolucion_${String(index + 1).padStart(3, '0')}_${resolution.signature}`;
      const { sortMillis: _sortMillis, signature: _signature, ...resolutionData } = resolution;
      queueSet(envioRef.collection('resoluciones').doc(resolutionId), {
        ...resolutionData,
        numeroResolucion: index + 1,
        migracionId
      });
    });
  }

  queueSet(db.collection('configuracion').doc('general'), {
    proyectoId: TARGET_PROJECT_ID,
    ultimaMigracionId: migrationId,
    ultimaMigracionEn: FieldValue.serverTimestamp(),
    periodoActivoId: result.periods.find((item) => item.activo)?.id || null,
    enviosHabilitados: true
  });

  await writer.close();

  const finalState = errors.length ? 'COMPLETADA_CON_ERRORES' : 'COMPLETADA';
  await db.collection('migraciones').doc(migrationId).set({
    estado: finalState,
    finalizadoEn: FieldValue.serverTimestamp(),
    archivoOrigen: path.basename(result.sourcePath),
    resumen: result.summary,
    documentosProgramados: totalWrites,
    respaldoLocal: backup.backupPath,
    documentosRespaldados: backup.total,
    errores: errors.slice(0, 100)
  }, { merge: true });

  sendProgress(100, errors.length ? `Migración terminada con ${errors.length} errores.` : 'Migración completada correctamente.', errors.length ? 'warning' : 'success');
  return {
    migrationId,
    projectId: TARGET_PROJECT_ID,
    credentialFile: path.basename(accountPath),
    totalWrites,
    backupPath: backup.backupPath,
    errors
  };
}

ipcMain.handle('excel:seleccionar', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Seleccionar Excel',
    properties: ['openFile'],
    filters: [{ name: 'Archivos Excel', extensions: ['xlsx', 'xls'] }]
  });
  if (result.canceled || !result.filePaths[0]) return null;

  const resolved = resolveBackupPath(result.filePaths[0]);
  selectedExcelPath = resolved;
  analysisResult = null;
  return {
    selectedName: path.basename(result.filePaths[0]),
    sourceName: path.basename(resolved),
    sourcePath: resolved,
    autoDetected: path.resolve(resolved) !== path.resolve(result.filePaths[0])
  };
});

ipcMain.handle('excel:analizar', async () => {
  if (!selectedExcelPath) throw new Error('Primero selecciona uno de los archivos Excel.');
  sendProgress(8, 'Leyendo hojas del respaldo…');
  await new Promise((resolve) => setTimeout(resolve, 50));
  analysisResult = analyzeWorkbook(selectedExcelPath);
  sendProgress(100, 'Análisis completado. Ya puedes subir a Firestore.', 'success');
  return {
    summary: analysisResult.summary,
    warnings: analysisResult.warnings,
    preview: analysisResult.preview,
    collections: [
      { name: 'periodos', count: analysisResult.periods.length },
      { name: 'carreras', count: analysisResult.careers.length },
      { name: 'coordinadores', count: analysisResult.coordinators.length },
      { name: 'envios', count: analysisResult.envios.length },
      { name: 'versiones', count: analysisResult.envios.reduce((sum, item) => sum + item.versions.length, 0) },
      { name: 'resoluciones', count: analysisResult.envios.reduce((sum, item) => sum + item.resolutions.length, 0) },
      { name: 'migraciones', count: 1 }
    ],
    credentialDetected: Boolean(findServiceAccount(selectedExcelPath))
  };
});

ipcMain.handle('firebase:migrar', async () => {
  if (!analysisResult) throw new Error('Primero pulsa Analizar.');
  return migrateToFirestore(analysisResult);
});
