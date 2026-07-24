const crypto = require('crypto');
const XLSX = require('xlsx');
const admin = require('firebase-admin');

const MONTHS = { enero:1, febrero:2, marzo:3, abril:4, mayo:5, junio:6, julio:7, agosto:8, septiembre:9, setiembre:9, octubre:10, noviembre:11, diciembre:12 };
const PENDING = 'PENDIENTE_REVISION';

function get(object, keys) {
  if (!object) return null;
  for (const key of keys) if (Object.prototype.hasOwnProperty.call(object, key) && object[key] !== null && object[key] !== undefined) return object[key];
  return null;
}
function trim(value) { return value === null || value === undefined ? '' : String(value).replace(/[\u200B-\u200D\uFEFF]/g, '').trim(); }
function normalizeCedula(value) { const digits = trim(value).replace(/\D/g, ''); return !digits || digits.length > 10 ? null : digits.padStart(10, '0'); }
function cedulaVariants(cedula) { return [...new Set([cedula, Number(cedula), cedula.replace(/^0+/, '')].filter((x) => x !== '' && x !== null && x !== undefined))]; }
function normalizeText(value) { return trim(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim(); }
function slug(value) { return normalizeText(value).toLowerCase().replace(/\s+/g, '_').slice(0, 100); }
function safeId(value) { return trim(value).replace(/[/.#$\[\]]/g, '_').replace(/\s+/g, '_').slice(0, 240) || `id_${crypto.randomUUID()}`; }
function cleanPath(value) { return trim(value).replace(/^\/+|\/+$/g, ''); }
function objectHash(value) { return crypto.createHash('sha256').update(JSON.stringify(value, (_k, v) => v instanceof Date ? v.toISOString() : v)).digest('hex'); }
function dateValue(value) { return value instanceof Date ? value.getTime() : 0; }
function normalizeBoolean(value) { return ['SI','TRUE','1','VERDADERO'].includes(normalizeText(value)); }

function normalizePeriod(value) {
  const text = trim(value);
  if (!text) return null;
  const id = text.match(/(\d{4})-(\d{2})__(\d{4})-(\d{2})/);
  if (id) return `${id[1]}-${id[2]}__${id[3]}-${id[4]}`;
  const normalized = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const dates = [...normalized.matchAll(/(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\s+(\d{4})/g)];
  if (dates.length >= 2) return `${dates[0][2]}-${String(MONTHS[dates[0][1]]).padStart(2,'0')}__${dates[1][2]}-${String(MONTHS[dates[1][1]]).padStart(2,'0')}`;
  return slug(text).replace(/-/g, '_').slice(0, 80) || null;
}

function parseDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === 'number' && Number.isFinite(value)) {
    const d = XLSX.SSF.parse_date_code(value);
    if (d) return new Date(Date.UTC(d.y, d.m - 1, d.d, d.H || 0, d.M || 0, Math.floor(d.S || 0)));
  }
  const text = trim(value);
  if (!text || text.includes('FieldValue.serverTimestamp')) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeStatus(value) {
  const status = normalizeText(value);
  if (!status) return null;
  if (['ENVIADO','RESPALDADO','PENDIENTE','PENDIENTE REVISION','PENDIENTE DE REVISION'].includes(status)) return PENDING;
  if (status.includes('APROBAD')) return 'APROBADO';
  if (status.includes('DEVUELT')) return 'DEVUELTO';
  if (status.includes('REEMPLAZ')) return 'REEMPLAZADO';
  if (status.includes('RESUELT')) return 'RESUELTO';
  return status.replace(/\s+/g, '_');
}

function normalizeSubmission(row, excelRow) {
  const periodLabel = trim(get(row, ['Periodo', 'periodo']));
  const serverDate = parseDate(get(row, ['Fecha servidor', 'fechaServidor']));
  const sentDate = parseDate(get(row, ['Fecha envío', 'Fecha envio', 'fechaEnvio'])) || serverDate;
  return {
    excelRow,
    cedula: normalizeCedula(get(row, ['Cédula', 'Cedula', 'cedula', 'numeroIdentificacion'])),
    student: trim(get(row, ['Estudiante', 'Nombres', 'nombres'])),
    career: trim(get(row, ['Carrera', 'NombreCarrera', 'nombreCarrera'])),
    careerCode: trim(get(row, ['CodigoCarrera', 'codigoCarrera'])),
    periodId: normalizePeriod(periodLabel), periodLabel,
    telegram: trim(get(row, ['Telegram', 'telegram'])),
    proposals: [1,2,3].map((number) => ({ number, title: trim(get(row, [`Título ${number}`, `Titulo ${number}`, `titulo${number}`])) })),
    preferred: [1,2,3].includes(Number(get(row, ['Preferido', 'preferido']))) ? Number(get(row, ['Preferido', 'preferido'])) : null,
    firebaseStatus: trim(get(row, ['Estado Firebase', 'estadoFirebase'])),
    sheetsStatus: trim(get(row, ['Estado Google Sheets', 'estadoGoogleSheets'])),
    status: normalizeStatus(get(row, ['Estado', 'estado']) || get(row, ['Estado Google Sheets']) || get(row, ['Estado Firebase'])) || PENDING,
    note: trim(get(row, ['Observación', 'Observacion', 'observacion'])),
    sourceId: trim(get(row, ['ID registro', 'idRegistro'])),
    test: normalizeBoolean(get(row, ['Prueba', 'prueba'])), serverDate, sentDate,
    hash: objectHash(row)
  };
}

function normalizeResolution(row, excelRow) {
  const periodLabel = trim(get(row, ['Periodo', 'periodo']));
  const serverDate = parseDate(get(row, ['Fecha servidor', 'fechaServidor']));
  const date = parseDate(get(row, ['Fecha resolución', 'Fecha resolucion', 'fechaResolucion'])) || serverDate;
  const sourceId = trim(get(row, ['ID registro', 'idRegistro']));
  return {
    excelRow, id: safeId(sourceId || `res_${objectHash(row).slice(0, 22)}`), sourceId,
    cedula: normalizeCedula(get(row, ['Cédula', 'Cedula', 'cedula'])),
    student: trim(get(row, ['Estudiante', 'Nombres'])),
    career: trim(get(row, ['Carrera', 'NombreCarrera'])),
    periodId: normalizePeriod(periodLabel), periodLabel,
    coordinator: trim(get(row, ['Coordinador', 'coordinador'])),
    finalStatus: normalizeStatus(get(row, ['Estado final', 'Estado', 'estadoFinal'])),
    chosenTitle: trim(get(row, ['Título elegido', 'Titulo elegido', 'tituloElegido'])),
    correctedTitle: trim(get(row, ['Título corregido', 'Titulo corregido', 'tituloCorregido'])),
    note: trim(get(row, ['Observación', 'Observacion', 'observacion'])),
    test: normalizeBoolean(get(row, ['Prueba', 'prueba'])), serverDate, date
  };
}

function normalizeCoordinator(row, excelRow) {
  const name = trim(get(row, ['Coordinador', 'Nombre', 'nombre']));
  if (!name) return null;
  return {
    excelRow, id: safeId(trim(get(row, ['ID registro', 'idRegistro'])) || slug(name)), name,
    careers: trim(get(row, ['Carreras', 'carreras'])).split('|').map(trim).filter(Boolean),
    status: trim(get(row, ['Estado', 'estado'])) || 'ACTIVO',
    telegram: trim(get(row, ['Telegram', 'telegram'])),
    note: trim(get(row, ['Observación', 'Observacion', 'observacion'])),
    date: parseDate(get(row, ['Fecha', 'fecha'])) || parseDate(get(row, ['Fecha servidor']))
  };
}

function consolidate(submissions, resolutions) {
  const groups = new Map(), resolutionGroups = new Map();
  submissions.filter((s) => s.cedula && s.periodId).forEach((s) => {
    const key = `${s.periodId}__${s.cedula}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(s);
  });
  resolutions.filter((r) => r.cedula && r.periodId).forEach((r) => {
    const key = `${r.periodId}__${r.cedula}`;
    if (!resolutionGroups.has(key)) resolutionGroups.set(key, []);
    resolutionGroups.get(key).push(r);
  });
  return [...groups.entries()].map(([id, versions]) => {
    versions.sort((a,b) => dateValue(a.sentDate || a.serverDate) - dateValue(b.sentDate || b.serverDate));
    const combined = mergeVersions(versions);
    const grouped = (resolutionGroups.get(id) || []).sort((a,b) => dateValue(a.date) - dateValue(b.date));
    const currentResolution = grouped.at(-1) || null;
    const status = currentResolution?.finalStatus || combined.status || PENDING;
    const warnings = [];
    if (versions.length > 1) warnings.push('ENVIO_REPETIDO');
    if (versions.some((v) => !v.sentDate)) warnings.push('FECHA_ENVIO_INVALIDA');
    if (grouped.length > 1) warnings.push('MULTIPLES_RESOLUCIONES');
    return { ...combined, id, status, versions, resolutions: grouped, currentResolution, warnings,
      contentHash: objectHash({ id, telegram: combined.telegram, proposals: combined.proposals, preferred: combined.preferred, status, currentResolution }) };
  }).sort((a,b) => `${a.periodId}|${a.student}`.localeCompare(`${b.periodId}|${b.student}`, 'es'));
}

function mergeVersions(versions) {
  const result = { ...versions[0], proposals: versions[0].proposals.map((p) => ({ ...p })) };
  for (const version of versions) {
    ['student','career','careerCode','periodLabel','telegram','firebaseStatus','sheetsStatus','note','sourceId'].forEach((key) => { if (trim(version[key])) result[key] = version[key]; });
    if (version.preferred) result.preferred = version.preferred;
    if (version.status) result.status = version.status;
    if (version.serverDate) result.serverDate = version.serverDate;
    if (version.sentDate) result.sentDate = version.sentDate;
    result.test = version.test;
    result.proposals = result.proposals.map((p, i) => ({ number: i + 1, title: trim(version.proposals[i]?.title) || p.title }));
  }
  return result;
}

function buildSnapshot(record, sourceData = {}) {
  const first = (keys) => trim(get(sourceData || {}, keys));
  return clean({ nombres: first(['nombres','Nombres','nombreCompleto','estudiante','nombre']) || record.student,
    excelCareer: record.career, sourceCareer: first(['nombreCarrera','NombreCarrera','carrera','Carrera']),
    careerCode: first(['codigoCarrera','CodigoCarrera','carreraCodigo']) || record.careerCode,
    personalEmail: first(['correoPersonal','CorreoPersonal','emailPersonal']),
    institutionalEmail: first(['correoInstitucional','CorreoInstitucional','emailInstitucional']),
    phone: first(['celular','Celular','telefono','Telefono']), campus: first(['sede','Sede']),
    enrollmentStatus: first(['estadoMatricula','EstadoMatricula','estado']) });
}

function timestamp(value) { return value instanceof Date && !Number.isNaN(value.getTime()) ? admin.firestore.Timestamp.fromDate(value) : null; }
function clean(value) {
  if (Array.isArray(value)) return value.map(clean);
  if (value && typeof value === 'object' && !(value instanceof Date) && !(value instanceof admin.firestore.Timestamp) && !value._methodName)
    return Object.fromEntries(Object.entries(value).filter(([,v]) => v !== undefined).map(([k,v]) => [k, clean(v)]));
  return value;
}
function serialize(value) {
  if (value instanceof admin.firestore.Timestamp) return { __timestamp: value.toDate().toISOString() };
  if (Array.isArray(value)) return value.map(serialize);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v]) => [k, serialize(v)]));
  return value;
}
function uiRow(record) { return { id:record.id, cedula:record.cedula, student:record.studentSnapshot.nombres || record.student || 'Sin nombre', period:record.periodLabel || record.periodId, career:record.career, found:record.studentFound, versions:record.versions.length, resolutions:record.resolutions.length, status:record.status, warnings:record.warnings }; }
function reportRow(record) { return { Cedula:record.cedula, Estudiante:record.studentSnapshot.nombres || record.student, PeriodoId:record.periodId, Periodo:record.periodLabel, CarreraExcel:record.career, CarreraOrigen:record.studentSnapshot.sourceCareer || '', Encontrado:record.studentFound?'SI':'NO', SourceStudentId:record.sourceStudentId || '', Telegram:record.telegram || '', Titulo1:record.proposals[0]?.title || '', Titulo2:record.proposals[1]?.title || '', Titulo3:record.proposals[2]?.title || '', Preferido:record.preferred || '', Estado:record.status, Versiones:record.versions.length, Resoluciones:record.resolutions.length, Observaciones:record.warnings.join(' | ') }; }
async function mapLimit(items, limit, fn) { const queue=[...items]; await Promise.all(Array.from({length:Math.min(limit,queue.length||1)},async()=>{while(queue.length) await fn(queue.shift());})); }

module.exports = { PENDING, get, trim, normalizeCedula, cedulaVariants, normalizeText, safeId, cleanPath, normalizeSubmission, normalizeResolution, normalizeCoordinator, consolidate, buildSnapshot, timestamp, clean, serialize, uiRow, reportRow, mapLimit };
