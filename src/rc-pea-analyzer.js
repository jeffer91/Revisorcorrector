const STOPWORDS = new Set([
  'para', 'como', 'con', 'por', 'los', 'las', 'del', 'una', 'uno', 'que', 'sus', 'esta',
  'este', 'desde', 'sobre', 'entre', 'cada', 'debe', 'deben', 'ser', 'son', 'se', 'en',
  'de', 'la', 'el', 'y', 'o', 'a', 'un', 'al', 'lo', 'su', 'es', 'e', 'u'
]);

function normalize(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getLines(text) {
  return String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function cleanLine(line) {
  return String(line || '')
    .replace(/^[-•*\d.)\s]+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function countWords(text) {
  return (String(text || '').match(/\S+/g) || []).length;
}

function containsAny(value, terms) {
  const normalized = normalize(value);
  return terms.some((term) => normalized.includes(normalize(term)));
}

function importantTerms(value) {
  return normalize(value)
    .split(' ')
    .filter((word) => word.length >= 5 && !STOPWORDS.has(word))
    .slice(0, 14);
}

function uniqueList(items, limit = 80) {
  const seen = new Set();
  const output = [];

  items.forEach((item) => {
    const value = cleanLine(item);
    const key = normalize(value);
    if (value.length >= 12 && !seen.has(key)) {
      seen.add(key);
      output.push(value);
    }
  });

  return output.slice(0, limit);
}

function extractSubject(lines) {
  const joined = lines.slice(0, 80).join('\n');
  const patterns = [
    /nombre\s+de\s+la\s+asignatura\s*:?\s*([^\n]+)/i,
    /asignatura\s*:?\s*([^\n]+)/i,
    /materia\s*:?\s*([^\n]+)/i
  ];

  for (const pattern of patterns) {
    const match = joined.match(pattern);
    if (match && cleanLine(match[1]).length > 3) {
      return cleanLine(match[1]).slice(0, 120);
    }
  }

  return '';
}

function extractProfileItems(lines, terms, maxAfterHeading = 18) {
  const items = [];

  lines.forEach((line, index) => {
    if (!containsAny(line, terms)) return;

    const current = cleanLine(line);
    if (current.length > 20) items.push(current);

    for (let offset = 1; offset <= maxAfterHeading; offset += 1) {
      const next = lines[index + offset];
      if (!next) break;
      if (/^(unidad|bibliograf|evaluaci|metodolog|resultado|contenido|objetivo)\b/i.test(next) && offset > 3) break;
      if (cleanLine(next).length > 18) items.push(next);
    }
  });

  return uniqueList(items);
}

function extractUnits(lines) {
  const units = [];

  lines.forEach((line) => {
    const value = cleanLine(line);
    if (/^unidad\s+([ivxlcdm]+|\d+)/i.test(value)) {
      units.push(value);
    }
  });

  return uniqueList(units, 20);
}

function extractPeaProfile(text, summary = {}) {
  const lines = getLines(text);
  const learningOutcomes = extractProfileItems(lines, [
    'resultado de aprendizaje',
    'resultados de aprendizaje',
    'logro de aprendizaje'
  ], 10);

  const contents = extractProfileItems(lines, [
    'contenidos mínimos',
    'contenidos minimos',
    'contenidos de la asignatura',
    'unidades de aprendizaje',
    'desarrollo de unidades',
    'temas y subtemas'
  ], 22);

  const evaluation = extractProfileItems(lines, [
    'sistema de evaluación',
    'sistema de evaluacion',
    'criterios de evaluación',
    'evaluación de los aprendizajes',
    'instrumentos de evaluación'
  ], 10);

  const methodology = extractProfileItems(lines, [
    'metodología de enseñanza',
    'metodologia de enseñanza',
    'estrategias metodológicas',
    'estrategias metodologicas',
    'estrategias de enseñanza'
  ], 10);

  const objectives = extractProfileItems(lines, [
    'objetivo general',
    'objetivos específicos',
    'objetivos especificos',
    'objetivo de la asignatura'
  ], 8);

  return {
    subject: extractSubject(lines),
    wordCount: countWords(text),
    headingCount: Array.isArray(summary.headings) ? summary.headings.length : 0,
    units: extractUnits(lines),
    objectives,
    learningOutcomes,
    contents,
    methodology,
    evaluation,
    referencesCount: summary.references ? summary.references.count : 0
  };
}

function itemCoverage(item, documentTextNormalized) {
  const terms = importantTerms(item);
  if (terms.length === 0) return { covered: false, percent: 0, terms, missingTerms: [] };

  const found = terms.filter((term) => documentTextNormalized.includes(term));
  const missingTerms = terms.filter((term) => !documentTextNormalized.includes(term));
  const percent = found.length / terms.length;

  return {
    covered: percent >= 0.55,
    percent: Number(percent.toFixed(2)),
    terms,
    missingTerms
  };
}

function analyzeItemGroup(items, documentTextNormalized, groupName) {
  const results = items.slice(0, 70).map((item) => ({
    item,
    group: groupName,
    ...itemCoverage(item, documentTextNormalized)
  }));

  const coveredCount = results.filter((item) => item.covered).length;
  const coverage = results.length ? coveredCount / results.length : null;

  return {
    total: results.length,
    covered: coveredCount,
    coverage: coverage === null ? null : Number(coverage.toFixed(2)),
    missing: results.filter((item) => !item.covered).slice(0, 20)
  };
}

function createIssue(code, severity, title, evidence, recommendation) {
  return { code, severity, title, evidence, recommendation };
}

function buildIssues({ contentCoverage, outcomeCoverage, evaluationCoverage, methodologyCoverage }) {
  const issues = [];

  if (contentCoverage.coverage !== null && contentCoverage.coverage < 0.7) {
    issues.push(createIssue(
      'PEA_CONTENT_LOW_COVERAGE',
      'major',
      'Baja cobertura de contenidos del PEA',
      `Cobertura detectada: ${Math.round(contentCoverage.coverage * 100)}%.`,
      'Revisar los contenidos faltantes del PEA e incorporarlos en el libro o guía.'
    ));
  }

  if (outcomeCoverage.coverage !== null && outcomeCoverage.coverage < 0.7) {
    issues.push(createIssue(
      'PEA_OUTCOME_LOW_COVERAGE',
      'major',
      'Baja cobertura de resultados de aprendizaje',
      `Cobertura detectada: ${Math.round(outcomeCoverage.coverage * 100)}%.`,
      'Conectar resultados de aprendizaje con contenidos, actividades y evaluación.'
    ));
  }

  if (evaluationCoverage.total > 0 && evaluationCoverage.coverage < 0.45) {
    issues.push(createIssue(
      'PEA_EVALUATION_WEAK_ALIGNMENT',
      'major',
      'Evaluación poco alineada al PEA',
      `Cobertura de evaluación: ${Math.round(evaluationCoverage.coverage * 100)}%.`,
      'Ajustar instrumentos y actividades evaluativas a lo indicado en el PEA.'
    ));
  }

  if (methodologyCoverage.total > 0 && methodologyCoverage.coverage < 0.45) {
    issues.push(createIssue(
      'PEA_METHODOLOGY_WEAK_ALIGNMENT',
      'minor',
      'Metodología poco visible frente al PEA',
      `Cobertura metodológica: ${Math.round(methodologyCoverage.coverage * 100)}%.`,
      'Hacer explícitas las estrategias metodológicas esperadas por el PEA.'
    ));
  }

  return issues;
}

function calculateScore(coverages) {
  const values = coverages.filter((item) => item !== null);
  if (values.length === 0) return null;

  const average = values.reduce((total, value) => total + value, 0) / values.length;
  return Math.round(average * 100);
}

function riskFromScore(score, issues) {
  if (score === null) return 'sin_aplicar';
  if (score < 55 || issues.some((item) => item.severity === 'critical')) return 'alto';
  if (score < 75 || issues.some((item) => item.severity === 'major')) return 'medio';
  return 'bajo';
}

function analyzePeaAlignment({ documentRecord, peaRecord }) {
  if (!documentRecord || !peaRecord) {
    throw new Error('Se necesita un documento principal y un PEA para comparar.');
  }

  const documentTextNormalized = normalize(documentRecord.text || '');
  const peaProfile = extractPeaProfile(peaRecord.text || '', peaRecord.summary || {});
  const documentProfile = extractPeaProfile(documentRecord.text || '', documentRecord.summary || {});

  const contentCoverage = analyzeItemGroup(peaProfile.contents, documentTextNormalized, 'contenidos');
  const outcomeCoverage = analyzeItemGroup(peaProfile.learningOutcomes, documentTextNormalized, 'resultados');
  const evaluationCoverage = analyzeItemGroup(peaProfile.evaluation, documentTextNormalized, 'evaluacion');
  const methodologyCoverage = analyzeItemGroup(peaProfile.methodology, documentTextNormalized, 'metodologia');
  const issues = buildIssues({ contentCoverage, outcomeCoverage, evaluationCoverage, methodologyCoverage });
  const score = calculateScore([
    contentCoverage.coverage,
    outcomeCoverage.coverage,
    evaluationCoverage.coverage,
    methodologyCoverage.coverage
  ]);
  const risk = riskFromScore(score, issues);

  return {
    checkedAt: new Date().toISOString(),
    score,
    risk,
    status: risk === 'bajo' ? 'Alineación PEA aceptable' : 'Requiere revisión de alineación al PEA',
    peaProfile,
    documentProfile,
    coverage: {
      contents: contentCoverage,
      learningOutcomes: outcomeCoverage,
      evaluation: evaluationCoverage,
      methodology: methodologyCoverage
    },
    issues,
    recommendations: issues.map((issue) => issue.recommendation)
  };
}

module.exports = {
  extractPeaProfile,
  analyzePeaAlignment
};
