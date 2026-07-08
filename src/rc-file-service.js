const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { parseDocument } = require('./rc-document-parser');

const PROJECT_ROOT = path.join(__dirname, '..');
const STORAGE_ROOT = path.join(PROJECT_ROOT, 'storage');
const UPLOADS_DIR = path.join(STORAGE_ROOT, 'uploads');
const EXTRACTED_DIR = path.join(STORAGE_ROOT, 'extracted');

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
    fs.mkdir(EXTRACTED_DIR, { recursive: true })
  ]);
}

async function assertFileExists(filePath) {
  const stats = await fs.stat(filePath);
  if (!stats.isFile()) {
    throw new Error('La ruta seleccionada no es un archivo válido.');
  }
  return stats;
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
    summary: record.summary
  };
}

module.exports = {
  importAcademicDocument,
  ensureStorageDirs
};
