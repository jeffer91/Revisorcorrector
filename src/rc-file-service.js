const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { parseDocument } = require('./rc-document-parser');
const { classifyDocument } = require('./rc-document-classifier');
const { analyzeStructure } = require('./rc-structure-analyzer');
const { extractPeaProfile, analyzePeaAlignment } = require('./rc-pea-analyzer');
const { calculateRubricReview } = require('./rc-rubric-engine');
const { buildInstitutionalReview } = require('./rc-ai-reviewer');
const { exportReviewFiles } = require('./rc-export-service');

const PROJECT_ROOT = path.join(__dirname, '..');
const STORAGE_ROOT = path.join(PROJECT_ROOT, 'storage');
const UPLOADS_DIR = path.join(STORAGE_ROOT, 'uploads');
const EXTRACTED_DIR = path.join(STORAGE_ROOT, 'extracted');
const REVIEWS_DIR = path.join(STORAGE_ROOT, 'reviews');

function sanitizeFileName(fileName) {
  return String(fileName || 'documento')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 140);
}

function createImportId(role) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const random = crypto.randomUUID().slice(0, 8);
  return `${role}-${timestamp}-${random}`;
}

async function ensureStorageDirs() {
  await Promise.all([
    fs.mkdir(UPLOADS_DIR, { recursive: true }),
    fs.mkdir(EXTRACTED_DIR, { recursive: true }),
    fs.mkdir(REVIEWS_DIR, { recursive: true })
  ]);
}

async function assertFileExists(filePath) {
  const stats = await fs.stat(filePath);
  if (!stats.isFile()) {
    throw new Error('La ruta seleccionada no es un archivo válido.');
  }
  return stats;
}

function buildRoleValidation(role, classification) {
  const expectedByRole = {
    mainDocument: ['libro_asignatura', 'guia_formacion_practica', 'formato_base'],
    pea: ['pea'],
    rubric: ['rubrica'],
    formatBase: ['formato_base', 'libro_asignatura', 'guia_formacion_practica']
  };

  const expected = expectedByRole[role] || [];
  const isExpected = expected.includes(classification.detectedType);

  return {
    role,
    expectedTypes: expected,
    isExpected,
    message: isExpected
      ? 'El tipo detectado coincide con el uso esperado.'
      : 'El tipo detectado debe revisarse manualmente antes del análisis final.'
  };
}

async function readExtractedRecord(documentRef) {
  if (!documentRef || !documentRef.extractedPath) {
    throw new Error('No existe una extracción válida para leer.');
  }

  const raw = await fs.readFile(documentRef.extractedPath, 'utf8');
  return JSON.parse(raw);
}

async function writeReviewRecord(prefix, payload) {
  await ensureStorageDirs();
  const fileName = `${prefix}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  const reviewPath = path.join(REVIEWS_DIR, fileName);
  await fs.writeFile(reviewPath, JSON.stringify(payload, null, 2), 'utf8');
  return reviewPath;
}

async function importAcademicDocument({ filePath, role }) {
  if (!filePath) {
    throw new Error('No se recibió la ruta del archivo.');
  }

  if (!role) {
    throw new Error('No se recibió el rol del documento.');
  }

  await ensureStorageDirs();

  const stats = await assertFileExists(filePath);
  const originalName = path.basename(filePath);
  const extension = path.extname(originalName).toLowerCase();
  const importId = createImportId(role);
  const safeName = sanitizeFileName(originalName);
  const storedFileName = `${importId}-${safeName}`;
  const uploadPath = path.join(UPLOADS_DIR, storedFileName);
  const extractedPath = path.join(EXTRACTED_DIR, `${importId}.json`);

  await fs.copyFile(filePath, uploadPath);

  const parsed = await parseDocument(uploadPath);
  const classification = classifyDocument(parsed.summary, parsed.text);
  const roleValidation = buildRoleValidation(role, classification);
  const structureAnalysis = analyzeStructure({
    text: parsed.text,
    summary: parsed.summary,
    classification,
    role
  });
  const peaProfile = classification.detectedType === 'pea'
    ? extractPeaProfile(parsed.text, parsed.summary)
    : null;

  const record = {
    id: importId,
    role,
    originalName,
    extension,
    sourcePath: filePath,
    uploadPath,
    extractedPath,
    importedAt: new Date().toISOString(),
    sizeBytes: stats.size,
    summary: parsed.summary,
    classification,
    roleValidation,
    structureAnalysis,
    peaProfile,
    text: parsed.text
  };

  await fs.writeFile(extractedPath, JSON.stringify(record, null, 2), 'utf8');

  return {
    id: record.id,
    role: record.role,
    originalName: record.originalName,
    extension: record.extension,
    sourcePath: record.sourcePath,
    uploadPath: record.uploadPath,
    extractedPath: record.extractedPath,
    importedAt: record.importedAt,
    sizeBytes: record.sizeBytes,
    summary: record.summary,
    classification: record.classification,
    roleValidation: record.roleValidation,
    structureAnalysis: record.structureAnalysis,
    peaProfile: record.peaProfile
  };
}

async function runPeaAlignment({ mainDocument, pea }) {
  const documentRecord = await readExtractedRecord(mainDocument);
  const peaRecord = await readExtractedRecord(pea);
  const alignment = analyzePeaAlignment({ documentRecord, peaRecord });
  const reviewPath = await writeReviewRecord('pea-alignment', {
    mainDocument: {
      id: mainDocument.id,
      name: mainDocument.originalName
    },
    pea: {
      id: pea.id,
      name: pea.originalName
    },
    alignment
  });

  return {
    ...alignment,
    reviewPath
  };
}

async function runInstitutionalReview({ mainDocument, pea }) {
  const documentRecord = await readExtractedRecord(mainDocument);
  const peaRecord = pea ? await readExtractedRecord(pea) : null;
  const peaAlignment = peaRecord ? analyzePeaAlignment({ documentRecord, peaRecord }) : null;
  const rubricReview = calculateRubricReview({ documentRecord, peaAlignment });
  const aiReview = buildInstitutionalReview({ documentRecord, peaAlignment, rubricReview });
  const reviewPayload = {
    mainDocument: {
      id: mainDocument.id,
      name: mainDocument.originalName
    },
    pea: pea ? {
      id: pea.id,
      name: pea.originalName
    } : null,
    peaAlignment,
    rubricReview,
    aiReview
  };
  const reviewPath = await writeReviewRecord('institutional-review', reviewPayload);
  const exportPaths = await exportReviewFiles(reviewPayload);

  return {
    ...reviewPayload,
    reviewPath,
    exportPaths
  };
}

module.exports = {
  importAcademicDocument,
  ensureStorageDirs,
  runPeaAlignment,
  runInstitutionalReview
};
