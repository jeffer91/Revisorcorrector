const rubricConfig = require('../data/rc-rubrics.json');

const CRITERION_NAMES = {
  A: 'Cumplimiento del formato institucional',
  B: 'Contenidos alineados al PEA actual',
  C: 'Calidad de la escritura y edición',
  D: 'Didáctica del contenido',
  E: 'Originalidad del texto y recursos',
  F: 'Referencias bibliográficas y citas APA 7'
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function words(text) {
  return String(text || '').match(/\S+/g) || [];
}

function scoreFromPercent(percent) {
  if (percent === null || percent === undefined) return 1;
  if (percent >= 90) return 5;
  if (percent >= 75) return 4;
  if (percent >= 60) return 3;
  if (percent >= 40) return 2;
  return 1;
}

function scoreFromCoverage(coverage) {
  if (coverage === null || coverage === undefined) return 1;
  return scoreFromPercent(coverage * 100);
}

function getFinalStatus(total) {
  const ranges = rubricConfig.rangos || [];
  const found = ranges.find((range) => total >= range.min && total <= range.max);
  return found ? found.estado : 'Sin estado definido';
}

function createCriterion(code, score, evidence, recommendation, risk = 'medio') {
  return {
    code,
    name: CRITERION_NAMES[code],
    score: clamp(score, 1, 5),
    evidence: evidence.filter(Boolean).slice(0, 8),
    recommendation: recommendation || 'Revisar el criterio antes de emitir aprobación final.',
    risk
  };
}

function evaluateFormat(documentRecord) {
  const structure = documentRecord.structureAnalysis || null;

  if (!structure || !structure.applies) {
    return createCriterion(
      'A',
      2,
      ['No existen reglas estructurales aplicables o el documento no fue clasificado como libro/guía.'],
      'Confirmar manualmente el tipo documental y aplicar el formato institucional correspondiente.',
      'medio'
    );
  }

  const issueSummary = structure.issueSummary || { critical: 0, major: 0, minor: 0, total: 0 };
  const evidence = [
    `Puntaje estructural: ${structure.score}/100.`,
    `Alertas: ${issueSummary.total} total, ${issueSummary.critical} críticas, ${issueSummary.major} mayores, ${issueSummary.minor} menores.`,
    structure.status
  ];

  const recommendation = issueSummary.total > 0
    ? 'Corregir primero las secciones faltantes, vacías o incompletas antes de revisar redacción fina.'
    : 'Mantener la estructura actual y verificar formato visual en la versión final.';

  return createCriterion('A', scoreFromPercent(structure.score), evidence, recommendation, structure.risk || 'bajo');
}

function evaluatePea(peaAlignment) {
  if (!peaAlignment) {
    return createCriterion(
      'B',
      1,
      ['No se ejecutó comparación contra PEA.'],
      'Cargar el PEA oficial y ejecutar la comparación antes de aprobar el documento.',
      'alto'
    );
  }

  const coverage = peaAlignment.coverage || {};
  const evidence = [
    `Puntaje de alineación PEA: ${peaAlignment.score}/100.`,
    coverage.contents ? `Contenidos cubiertos: ${coverage.contents.covered}/${coverage.contents.total}.` : '',
    coverage.learningOutcomes ? `Resultados cubiertos: ${coverage.learningOutcomes.covered}/${coverage.learningOutcomes.total}.` : '',
    coverage.evaluation ? `Evaluación cubierta: ${coverage.evaluation.covered}/${coverage.evaluation.total}.` : '',
    coverage.methodology ? `Metodología cubierta: ${coverage.methodology.covered}/${coverage.methodology.total}.` : ''
  ];

  const recommendation = peaAlignment.issues && peaAlignment.issues.length
    ? peaAlignment.issues.map((issue) => issue.recommendation).join(' ')
    : 'Mantener la relación entre PEA, contenidos, actividades y evaluación.';

  return createCriterion('B', scoreFromPercent(peaAlignment.score), evidence, recommendation, peaAlignment.risk || 'medio');
}

function evaluateWriting(documentRecord) {
  const text = documentRecord.text || '';
  const totalWords = words(text).length;
  const paragraphs = text.split(/\n\s*\n/g).filter((item) => item.trim().length > 0);
  const longParagraphs = paragraphs.filter((item) => words(item).length > 180).length;
  const veryShortParagraphs = paragraphs.filter((item) => words(item).length > 0 && words(item).length < 8).length;
  const repeatedConnectors = (normalizeText(text).match(/\b(en este sentido|por lo tanto|de esta manera|cabe destacar)\b/g) || []).length;

  let score = 5;
  if (totalWords < 1200) score -= 1;
  if (paragraphs.length && longParagraphs / paragraphs.length > 0.18) score -= 1;
  if (paragraphs.length && veryShortParagraphs / paragraphs.length > 0.25) score -= 1;
  if (repeatedConnectors > 35) score -= 1;

  const evidence = [
    `Palabras detectadas: ${totalWords}.`,
    `Párrafos extensos: ${longParagraphs}.`,
    `Párrafos muy breves: ${veryShortParagraphs}.`,
    `Conectores repetidos detectados: ${repeatedConnectors}.`
  ];

  return createCriterion(
    'C',
    score,
    evidence,
    'Revisar estilo, precisión académica, repetición de conectores, párrafos extensos y continuidad entre ideas.',
    score <= 2 ? 'alto' : score <= 3 ? 'medio' : 'bajo'
  );
}

function evaluateDidactics(documentRecord, peaAlignment) {
  const text = normalizeText(documentRecord.text || '');
  const markers = [
    'actividad', 'taller', 'evaluacion', 'autoevaluacion', 'reflexion', 'resultado de aprendizaje',
    'estrategias de ensenanza', 'enunciado', 'retroalimentacion', 'proyecto final'
  ];
  const found = markers.filter((marker) => text.includes(marker));
  const baseScore = scoreFromCoverage(found.length / markers.length);
  const peaPenalty = peaAlignment && peaAlignment.risk === 'alto' ? 1 : 0;
  const score = clamp(baseScore - peaPenalty, 1, 5);

  const evidence = [
    `Marcadores didácticos detectados: ${found.length}/${markers.length}.`,
    found.length ? `Marcadores visibles: ${found.slice(0, 8).join(', ')}.` : 'No se encontraron marcadores didácticos suficientes.',
    peaAlignment ? `Riesgo PEA: ${peaAlignment.risk}.` : 'Alineación PEA no disponible.'
  ];

  return createCriterion(
    'D',
    score,
    evidence,
    'Fortalecer la relación entre resultado de aprendizaje, explicación, actividad, evaluación y retroalimentación.',
    score <= 2 ? 'alto' : score <= 3 ? 'medio' : 'bajo'
  );
}

function evaluateResources(documentRecord) {
  const resources = documentRecord.summary && documentRecord.summary.resources ? documentRecord.summary.resources : {};
  const figures = resources.figures || { count: 0, duplicates: [] };
  const tables = resources.tables || { count: 0, duplicates: [] };
  const totalResources = (figures.count || 0) + (tables.count || 0);
  const duplicateCount = (figures.duplicates || []).length + (tables.duplicates || []).length;

  let score = totalResources >= 8 ? 5 : totalResources >= 4 ? 4 : totalResources >= 2 ? 3 : totalResources >= 1 ? 2 : 1;
  if (duplicateCount > 0) score = Math.max(1, score - 1);

  const evidence = [
    `Figuras detectadas: ${figures.count || 0}.`,
    `Tablas detectadas: ${tables.count || 0}.`,
    duplicateCount ? `Duplicados de numeración: ${duplicateCount}.` : 'No se detectaron duplicados de numeración en recursos.'
  ];

  return createCriterion(
    'E',
    score,
    evidence,
    'Incluir recursos pertinentes, no decorativos, con numeración, título, fuente y relación clara con el contenido.',
    score <= 2 ? 'medio' : 'bajo'
  );
}

function extractReferenceYears(text) {
  const referencesIndex = normalizeText(text).search(/referencias|bibliografia/);
  const source = referencesIndex >= 0 ? text.slice(referencesIndex) : text;
  const matches = source.match(/\b(20\d{2}|19\d{2})\b/g) || [];
  return matches.map((year) => Number(year)).filter((year) => year >= 1900 && year <= 2100);
}

function evaluateApa(documentRecord) {
  const text = documentRecord.text || '';
  const summary = documentRecord.summary || {};
  const classification = documentRecord.classification || {};
  const references = summary.references || { count: 0 };
  const minimum = classification.detectedType === 'guia_formacion_practica' ? 5 : 15;
  const years = extractReferenceYears(text);
  const currentYear = new Date().getFullYear();
  const recentCount = years.filter((year) => currentYear - year <= 5).length;
  const doiCount = (text.match(/\bdoi\b|https:\/\/doi\.org/gi) || []).length;
  const urlCount = (text.match(/https?:\/\//gi) || []).length;

  let score = references.count >= minimum ? 4 : references.count >= Math.ceil(minimum * 0.65) ? 3 : references.count > 0 ? 2 : 1;
  if (references.count >= minimum && recentCount >= Math.ceil(minimum * 0.5)) score = 5;
  if (references.count >= minimum && recentCount === 0) score = Math.min(score, 3);

  const evidence = [
    `Referencias detectadas: ${references.count}/${minimum}.`,
    `Años recientes detectados: ${recentCount}.`,
    `DOI detectados: ${doiCount}.`,
    `URL detectadas: ${urlCount}.`
  ];

  return createCriterion(
    'F',
    score,
    evidence,
    'Revisar APA 7: citas en texto, referencias completas, DOI, URL, cursivas, fecha reciente y correspondencia cita-referencia.',
    score <= 2 ? 'alto' : score <= 3 ? 'medio' : 'bajo'
  );
}

function buildInstitutionalObservations(criteria) {
  return criteria.flatMap((criterion) => {
    const observations = [];
    if (criterion.score <= 2) {
      observations.push({
        criterion: criterion.code,
        severity: 'alta',
        text: `${criterion.name}: requiere corrección prioritaria. ${criterion.recommendation}`
      });
    } else if (criterion.score === 3) {
      observations.push({
        criterion: criterion.code,
        severity: 'media',
        text: `${criterion.name}: cumple parcialmente. ${criterion.recommendation}`
      });
    }
    return observations;
  });
}

function calculateRubricReview({ documentRecord, peaAlignment }) {
  const criteria = [
    evaluateFormat(documentRecord),
    evaluatePea(peaAlignment),
    evaluateWriting(documentRecord),
    evaluateDidactics(documentRecord, peaAlignment),
    evaluateResources(documentRecord),
    evaluateApa(documentRecord)
  ];

  const total = criteria.reduce((sum, criterion) => sum + criterion.score, 0);
  const status = getFinalStatus(total);
  const observations = buildInstitutionalObservations(criteria);
  const criticalCount = criteria.filter((criterion) => criterion.risk === 'alto' || criterion.score <= 2).length;

  return {
    checkedAt: new Date().toISOString(),
    total,
    max: 30,
    status,
    risk: criticalCount > 1 ? 'alto' : criticalCount === 1 ? 'medio' : 'bajo',
    criteria,
    observations,
    conclusion: status === 'Aprobado sin modificaciones'
      ? 'El documento puede continuar, sujeto a verificación final de formato visual.'
      : 'El documento requiere ajustes antes de aprobación institucional.'
  };
}

module.exports = {
  calculateRubricReview
};
