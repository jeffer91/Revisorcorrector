const fs = require('fs/promises');
const path = require('path');
const { buildMarkdownReport, buildPlainTextReport, buildHtmlReport } = require('./rc-report-builder');

const PROJECT_ROOT = path.join(__dirname, '..');
const REPORTS_DIR = path.join(PROJECT_ROOT, 'storage', 'reports');

function safeName(value) {
  return String(value || 'informe')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 90);
}

async function ensureReportsDir() {
  await fs.mkdir(REPORTS_DIR, { recursive: true });
}

function buildBaseFileName(reviewPayload) {
  const documentName = reviewPayload.mainDocument ? reviewPayload.mainDocument.name : 'documento';
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${timestamp}-${safeName(documentName)}`;
}

async function writeFile(filePath, content) {
  await fs.writeFile(filePath, content, 'utf8');
  return filePath;
}

async function exportReviewFiles(reviewPayload) {
  await ensureReportsDir();

  const baseName = buildBaseFileName(reviewPayload);
  const markdown = buildMarkdownReport(reviewPayload);
  const text = buildPlainTextReport(reviewPayload);
  const html = buildHtmlReport(reviewPayload);
  const json = JSON.stringify(reviewPayload, null, 2);

  const paths = {
    json: path.join(REPORTS_DIR, `${baseName}.json`),
    markdown: path.join(REPORTS_DIR, `${baseName}.md`),
    text: path.join(REPORTS_DIR, `${baseName}.txt`),
    html: path.join(REPORTS_DIR, `${baseName}.html`),
    wordCompatible: path.join(REPORTS_DIR, `${baseName}.doc`)
  };

  await Promise.all([
    writeFile(paths.json, json),
    writeFile(paths.markdown, markdown),
    writeFile(paths.text, text),
    writeFile(paths.html, html),
    writeFile(paths.wordCompatible, html)
  ]);

  return paths;
}

module.exports = {
  exportReviewFiles
};
