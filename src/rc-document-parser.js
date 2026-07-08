const fs = require('fs/promises');
const path = require('path');
const mammoth = require('mammoth');
const pdfParse = require('pdf-parse');

const SUPPORTED_EXTENSIONS = new Set(['.docx', '.pdf', '.txt']);

function normalizeText(text) {
  return String(text || '')
    .replace(/\r/g, '')
    .replace(/[\t ]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function getExtension(filePath) {
  return path.extname(filePath || '').toLowerCase();
}

async function extractDocx(filePath) {
  const result = await mammoth.extractRawText({ path: filePath });
  return {
    text: normalizeText(result.value),
    pageCount: null,
    warnings: result.messages || []
  };
}

async function extractPdf(filePath) {
  const buffer = await fs.readFile(filePath);
  const result = await pdfParse(buffer);
  return {
    text: normalizeText(result.text),
    pageCount: result.numpages || null,
    warnings: []
  };
}

async function extractTxt(filePath) {
  const text = await fs.readFile(filePath, 'utf8');
  return {
    text: normalizeText(text),
    pageCount: null,
    warnings: []
  };
}

function buildStats(text) {
  const words = text.match(/\S+/g) || [];
  const paragraphs = text.split(/\n\s*\n/g).filter((item) => item.trim().length > 0);
  const lines = text.split('\n').filter((item) => item.trim().length > 0);

  return {
    characterCount: text.length,
    wordCount: words.length,
    paragraphCount: paragraphs.length,
    lineCount: lines.length
  };
}

function looksLikeHeading(line) {
  const value = line.trim();

  if (value.length < 3 || value.length > 140) return false;

  const strongPatterns = [
    /^\d+(\.\d+)*\.?\s+[A-ZÁÉÍÓÚÑ]/,
    /^Unidad\s+[IVXLCDM]+/i,
    /^Taller\s+\d+/i,
    /^Proyecto\s+Final/i,
    /^Resultado\s+de\s+Aprendizaje/i,
    /^Contenidos$/i,
    /^Estrategias\s+de\s+enseñanza/i,
    /^Evaluación\s+de\s+Unidad/i,
    /^Auto\s*evaluación/i,
    /^Reflexiones\s+sobre\s+la\s+Unidad/i,
    /^Presentación/i,
    /^Nombre\s+de\s+la\s+asignatura/i,
    /^Pre\s*requisitos/i,
    /^Orientaciones\s+Generales/i,
    /^Referencias/i,
    /^Bibliografía/i,
    /^Glosario/i,
    /^Anexos/i,
    /^Fundamentación\s+Teórica/i,
    /^Preparación\s+previa/i,
    /^Enunciado\s+del\s+Taller/i,
    /^Destrezas\s+y\s+habilidades/i,
    /^Identificación\s+de\s+Riesgos/i,
    /^Normas\s+de\s+Seguridad/i,
    /^Equipo\s+de\s+bioseguridad/i,
    /^Evaluación$/i
  ];

  return strongPatterns.some((pattern) => pattern.test(value));
}

function extractHeadings(text) {
  const headings = [];
  const lines = text.split('\n');

  lines.forEach((line, index) => {
    const value = line.trim().replace(/\s+/g, ' ');
    if (looksLikeHeading(value)) {
      headings.push({
        title: value,
        line: index + 1
      });
    }
  });

  return headings.slice(0, 250);
}

function extractReferences(text) {
  const referenceStart = text.search(/\n\s*(referencias|bibliografía)\b/i);
  const source = referenceStart >= 0 ? text.slice(referenceStart) : text;
  const lines = source.split('\n').map((line) => line.trim()).filter(Boolean);

  const candidates = lines.filter((line) => {
    const hasYear = /\((20\d{2}|19\d{2})\)|\b(20\d{2}|19\d{2})\b/.test(line);
    const hasAuthorShape = /^[A-ZÁÉÍÓÚÑ][A-Za-zÁÉÍÓÚÑáéíóúñüÜ.,\s-]+/.test(line);
    return hasYear && hasAuthorShape && line.length > 25;
  });

  return candidates.slice(0, 120);
}

function countLabels(text, label) {
  const regex = new RegExp(`\\b${label}\\s+\\d+`, 'gi');
  const matches = text.match(regex) || [];
  const normalized = matches.map((item) => item.toLowerCase().replace(/\s+/g, ' '));
  const duplicates = normalized.filter((item, index) => normalized.indexOf(item) !== index);

  return {
    count: matches.length,
    duplicates: Array.from(new Set(duplicates))
  };
}

function buildDocumentSummary({ filePath, extension, text, pageCount, warnings }) {
  const headings = extractHeadings(text);
  const references = extractReferences(text);
  const figures = countLabels(text, 'Figura');
  const tables = countLabels(text, 'Tabla');

  return {
    originalName: path.basename(filePath),
    extension,
    pageCount,
    stats: buildStats(text),
    headings,
    references: {
      count: references.length,
      samples: references.slice(0, 10)
    },
    resources: {
      figures,
      tables
    },
    preview: text.slice(0, 1600),
    warnings
  };
}

async function parseDocument(filePath) {
  const extension = getExtension(filePath);

  if (!SUPPORTED_EXTENSIONS.has(extension)) {
    throw new Error(`Formato no soportado: ${extension || 'sin extensión'}`);
  }

  const extracted = extension === '.docx'
    ? await extractDocx(filePath)
    : extension === '.pdf'
      ? await extractPdf(filePath)
      : await extractTxt(filePath);

  const summary = buildDocumentSummary({
    filePath,
    extension,
    text: extracted.text,
    pageCount: extracted.pageCount,
    warnings: extracted.warnings
  });

  return {
    text: extracted.text,
    summary
  };
}

module.exports = {
  parseDocument,
  normalizeText,
  SUPPORTED_EXTENSIONS
};
