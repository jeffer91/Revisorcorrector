const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const admin = require('firebase-admin');
const {
  PENDING,
  trim,
  normalizeSubmission,
  normalizeResolution,
  normalizeCoordinator,
  consolidate,
  buildSnapshot,
  timestamp,
  clean,
  safeId,
  uiRow,
  reportRow
} = require('./normalize');
const {
  connectSource,
  connectTarget,
  findStudents,
  backupExisting,
  closeApp
} = require('./firebase');

let lastAnalysis = null;

async function analyze(config, progress = () => {}) {
  validateConfig(config);
  progress('excel', 4, 'Abriendo el respaldo Excel…');

  const workbook = XLSX.readFile(config.excelPath, { cellDates: true });
  const submissionRows = sheetRows(workbook, 'Envios');
  const resolutionRows = sheetRows(workbook, 'Resoluciones');
  const coordinatorRows = sheetRows(workbook, 'Coordinadores');
  if (!submissionRows.length) throw new Error('La hoja “Envios” no existe o está vacía.');

  progress('normalize', 12, 'Normalizando cédulas, periodos, fechas y estados…');
  const submissions = submissionRows.map((row, index) => normalizeSubmission(row, index + 2));
  const resolutions = resolutionRows.map((row, index) => normalizeResolution(row, index + 2));
  const coordinators = coordinatorRows
    .map((row, index) => normalizeCoordinator(row, index + 2))
    .filter(Boolean);

  const errors = collectErrors(submissions, resolutions);
  const records = consolidate(submissions, resolutions);
  if (!records.length) throw new Error('No se encontraron envíos válidos para consolidar.');

  let source = null;
  try {
    progress('connection', 29, 'Conectando con la Firebase oficial de estudiantes…');
    source = await connectSource(config);
    const matches = await findStudents(
      source,
      [...new Set(records.map((record) => record.cedula))],
      config,
      progress
    );

    for (const record of records) {
      const match = matches.get(record.cedula) || { found: false, id: null, data: null };
      record.studentFound = match.found;
      record.sourceStudentId = match.id;
      record.studentSnapshot = buildSnapshot(record, match.data || {});
      if (!match.found) record.warnings.push('ESTUDIANTE_NO_ENCONTRADO');
      const sourceCareer = trim(record.studentSnapshot.sourceCareer);
      if (match.found && sourceCareer && normalizeComparable(sourceCareer) !== normalizeComparable(record.career)) {
        record.warnings.push('CARRERA_DIFERENTE');
      }
    }

    const found = records.filter((record) => record.studentFound).length;
    const summary = {
      submissionRows: submissionRows.length,
      consolidated: records.length,
      duplicates: records.reduce((total, record) => total + Math.max(0, record.versions.length - 1), 0),
      resolutions: resolutions.filter((item) => item.cedula && item.periodId).length,
      coordinators: coordinators.length,
      found,
      missing: records.length - found,
      warnings: records.filter((record) => record.warnings.length).length,
      errors: errors.length
    };

    lastAnalysis = {
      createdAt: new Date().toISOString(),
      sourceFile: config.excelPath,
      sourceProjectId: source.projectId,
      config: sanitizeConfig(config),
      records,
      coordinators,
      errors,
      summary
    };

    progress('done', 100, 'Análisis completado. No se modificó la base de destino.');
    return { summary, rows: records.map(uiRow), sourceProjectId: source.projectId };
  } finally {
    await closeApp(source?.app);
  }
}

async function migrate(options, progress = () => {}) {
  if (!lastAnalysis) throw new Error('Primero debes ejecutar el análisis.');
  if (!options?.targetCredentialPath || !fs.existsSync(options.targetCredentialPath)) {
    throw new Error('Selecciona una cuenta de servicio válida para la Firebase de destino.');
  }

  const records = lastAnalysis.records.filter((record) => options.includeMissing || record.studentFound);
  if (!records.length) throw new Error('No hay registros habilitados para migrar.');

  const target = await connectTarget(options.targetCredentialPath);
  const migrationId = `MIG_${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`;
  try {
    progress('backup', 3, 'Creando respaldo previo de documentos existentes…');
    const backupPath = await backupExisting(target.db, records, options.backupDir, migrationId);

    const periodMap = new Map();
    records.forEach((record) => {
      if (!periodMap.has(record.periodId)) {
        periodMap.set(record.periodId, {
          id: record.periodId,
          nombre: record.periodLabel || record.periodId
        });
      }
    });

    const totalWrites = periodMap.size
      + lastAnalysis.coordinators.length
      + records.reduce((total, record) => total + 1 + record.versions.length + record.resolutions.length, 0);
    let completed = 0;
    const advance = (message) => {
      completed += 1;
      progress('migration', 8 + (completed / Math.max(totalWrites, 1)) * 88, message);
    };

    const writer = target.db.bulkWriter();
    writer.onWriteError((error) => error.failedAttempts < 3);

    for (const period of periodMap.values()) {
      writer.set(
        target.db.collection('periodos').doc(period.id),
        clean({
          codigo: period.id,
          nombre: period.nombre,
          activo: true,
          migracionId,
          actualizadoEn: admin.firestore.FieldValue.serverTimestamp()
        }),
        { merge: true }
      ).then(() => advance(`Periodo: ${period.nombre}`));
    }

    for (const coordinator of lastAnalysis.coordinators) {
      writer.set(
        target.db.collection('coordinadores').doc(coordinator.id),
        clean({
          nombre: coordinator.name,
          carreras: coordinator.careers,
          estado: coordinator.status,
          telegram: coordinator.telegram || null,
          observacion: coordinator.note || null,
          fechaOrigen: timestamp(coordinator.date),
          migracionId,
          actualizadoEn: admin.firestore.FieldValue.serverTimestamp()
        }),
        { merge: true }
      ).then(() => advance(`Coordinador: ${coordinator.name}`));
    }

    for (const record of records) {
      const submissionRef = target.db.collection('envios').doc(record.id);
      writer.set(submissionRef, submissionDocument(record, migrationId, lastAnalysis.sourceProjectId), { merge: true })
        .then(() => advance(`Envío: ${record.student || record.cedula}`));

      record.versions.forEach((version, index) => {
        const versionId = safeId(version.sourceId || `v_${String(index + 1).padStart(3, '0')}_${version.hash.slice(0, 10)}`);
        writer.set(
          submissionRef.collection('versiones').doc(versionId),
          versionDocument(version, index + 1, migrationId),
          { merge: true }
        ).then(() => advance(`Versión: ${record.student || record.cedula}`));
      });

      record.resolutions.forEach((resolution) => {
        writer.set(
          submissionRef.collection('resoluciones').doc(resolution.id),
          resolutionDocument(resolution, migrationId),
          { merge: true }
        ).then(() => advance(`Resolución: ${record.student || record.cedula}`));
      });
    }

    await writer.close();
    await target.db.collection('migraciones').doc(migrationId).set({
      migracionId,
      estado: 'COMPLETADA',
      archivoOrigen: path.basename(lastAnalysis.sourceFile),
      proyectoOrigen: lastAnalysis.sourceProjectId,
      proyectoDestino: target.projectId,
      resumenAnalisis: lastAnalysis.summary,
      registrosMigrados: records.length,
      noEncontradosIncluidos: records.filter((record) => !record.studentFound).length,
      backupLocal: backupPath,
      creadoEn: admin.firestore.FieldValue.serverTimestamp()
    });

    progress('migration', 100, 'Migración completada correctamente.');
    return {
      migrationId,
      recordsMigrated: records.length,
      backupPath,
      targetProjectId: target.projectId
    };
  } finally {
    await closeApp(target.app);
  }
}

function exportReport(filePath) {
  if (!lastAnalysis) throw new Error('Primero debes analizar el Excel.');
  const workbook = XLSX.utils.book_new();
  const summaryRows = Object.entries(lastAnalysis.summary).map(([Indicador, Valor]) => ({ Indicador, Valor }));
  appendSheet(workbook, summaryRows, 'Resumen');
  appendSheet(workbook, lastAnalysis.records.filter((record) => record.studentFound).map(reportRow), 'Listos');
  appendSheet(workbook, lastAnalysis.records.filter((record) => !record.studentFound).map(reportRow), 'No encontrados');
  appendSheet(workbook, lastAnalysis.records.filter((record) => record.versions.length > 1).map(reportRow), 'Duplicados');
  appendSheet(workbook, lastAnalysis.records.filter((record) => record.warnings.length).map(reportRow), 'Advertencias');
  appendSheet(workbook, lastAnalysis.errors, 'Errores');
  XLSX.writeFile(workbook, filePath);
}

function submissionDocument(record, migrationId, sourceProjectId) {
  return clean({
    schemaVersion: 1,
    estudianteId: record.sourceStudentId || null,
    estudianteEncontrado: Boolean(record.studentFound),
    proyectoEstudiantes: sourceProjectId,
    cedula: record.cedula,
    periodoId: record.periodId,
    periodoNombre: record.periodLabel || record.periodId,
    carrera: record.career || null,
    carreraCodigo: record.careerCode || null,
    estudianteSnapshot: record.studentSnapshot,
    telegram: record.telegram || null,
    propuestas: record.proposals,
    propuestaPreferida: record.preferred,
    estado: record.status || PENDING,
    resolucionActual: resolutionSummary(record.currentResolution),
    versionActual: record.versions.length,
    advertenciasMigracion: record.warnings,
    contenidoHash: record.contentHash,
    fuente: {
      archivo: path.basename(lastAnalysis.sourceFile),
      idRegistro: record.sourceId || null,
      prueba: Boolean(record.test)
    },
    enviadoEn: timestamp(record.sentDate || record.serverDate),
    migracionId,
    actualizadoEn: admin.firestore.FieldValue.serverTimestamp()
  });
}

function versionDocument(version, number, migrationId) {
  return clean({
    numeroVersion: number,
    telegram: version.telegram || null,
    propuestas: version.proposals,
    propuestaPreferida: version.preferred,
    estado: version.status || PENDING,
    observacion: version.note || null,
    estadoFirebaseOrigen: version.firebaseStatus || null,
    estadoSheetsOrigen: version.sheetsStatus || null,
    idRegistroOrigen: version.sourceId || null,
    filaExcel: version.excelRow,
    prueba: Boolean(version.test),
    enviadoEn: timestamp(version.sentDate || version.serverDate),
    migracionId
  });
}

function resolutionDocument(resolution, migrationId) {
  return clean({
    estado: resolution.finalStatus || null,
    tituloElegido: resolution.chosenTitle || null,
    tituloCorregido: resolution.correctedTitle || null,
    observacion: resolution.note || null,
    coordinador: resolution.coordinator || null,
    idRegistroOrigen: resolution.sourceId || null,
    filaExcel: resolution.excelRow,
    prueba: Boolean(resolution.test),
    resueltoEn: timestamp(resolution.date || resolution.serverDate),
    migracionId
  });
}

function resolutionSummary(resolution) {
  if (!resolution) return null;
  return clean({
    estado: resolution.finalStatus || null,
    tituloElegido: resolution.chosenTitle || null,
    tituloCorregido: resolution.correctedTitle || null,
    observacion: resolution.note || null,
    coordinador: resolution.coordinator || null,
    fecha: timestamp(resolution.date || resolution.serverDate)
  });
}

function validateConfig(config) {
  if (!config?.excelPath || !fs.existsSync(config.excelPath)) throw new Error('Selecciona el archivo Excel.');
  if (!['firestore', 'rtdb'].includes(config.sourceType)) throw new Error('Selecciona el tipo de Firebase de origen.');
  if (!trim(config.sourcePath)) throw new Error('Escribe la colección o ruta de estudiantes.');
  if (config.lookupMode === 'field' && !trim(config.idField)) throw new Error('Escribe el campo de identificación.');
  if (!config.sourceCredentialPath || !fs.existsSync(config.sourceCredentialPath)) {
    throw new Error('Selecciona la cuenta de servicio de la Firebase de estudiantes.');
  }
}

function collectErrors(submissions, resolutions) {
  const errors = [];
  submissions.forEach((item) => {
    if (!item.cedula) errors.push({ Hoja: 'Envios', Fila: item.excelRow, Error: 'CEDULA_INVALIDA' });
    if (!item.periodId) errors.push({ Hoja: 'Envios', Fila: item.excelRow, Error: 'PERIODO_INVALIDO' });
    if (!item.proposals.some((proposal) => proposal.title)) errors.push({ Hoja: 'Envios', Fila: item.excelRow, Error: 'SIN_PROPUESTAS' });
  });
  resolutions.forEach((item) => {
    if (!item.cedula) errors.push({ Hoja: 'Resoluciones', Fila: item.excelRow, Error: 'CEDULA_INVALIDA' });
    if (!item.periodId) errors.push({ Hoja: 'Resoluciones', Fila: item.excelRow, Error: 'PERIODO_INVALIDO' });
  });
  return errors;
}

function sheetRows(workbook, name) {
  const sheet = workbook.Sheets[name];
  return sheet ? XLSX.utils.sheet_to_json(sheet, { defval: null, raw: true }) : [];
}

function appendSheet(workbook, rows, name) {
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows.length ? rows : [{ Estado: 'SIN_REGISTROS' }]), name);
}

function normalizeComparable(value) {
  return trim(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function sanitizeConfig(config) {
  return {
    sourceType: config.sourceType,
    sourcePath: config.sourcePath,
    lookupMode: config.lookupMode,
    idField: config.idField || null,
    databaseUrl: config.databaseUrl || null
  };
}

module.exports = { analyze, migrate, exportReport };
