const formatRules = require('../data/rc-format-rules.json');

const STRUCTURE_LABELS = {
  libro_asignatura: 'Libro de asignatura',
  guia_formacion_practica: 'Guía de formación práctica',
  pea: 'PEA',
  rubrica: 'Rúbrica',
  formato_base: 'Formato base',
  desconocido: 'Documento desconocido'
};

function normalize(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function countWords(text) {
  return (String(text || '').match(/\S+/g) || []).length;
}

function getLines(text) {
  return String(text || '').split('\n');
}

function getHeadings(summary) {
  return summary && Array.isArray(summary.headings) ? summary.headings : [];
}

function findHeading(headings, target) {
  const normalizedTarget = normalize(target);
  return headings.find((heading) => normalize(heading.title).includes(normalizedTarget));
}

function findHeadingsByRegex(headings, regex) {
  return headings.filter((heading) => regex.test(heading.title));
}

function getRangeContent(lines, headings, startHeading, stopRegex = null) {
  if (!startHeading) return '';

  const startLine = Math.max(0, startHeading.line || 1);
  const nextHeading = headings.find((heading) => {
    const afterStart = heading.line > startHeading.line;
    const matchesStop = stopRegex ? stopRegex.test(heading.title) : true;
    return afterStart && matchesStop;
  });

  const endLine = nextHeading ? Math.max(startLine, nextHeading.line - 1) : lines.length;
  return lines.slice(startLine, endLine).join('\n').trim();
}

function createIssue(code, severity, title, evidence, recommendation) {
  return { code, severity, title, evidence, recommendation };
}

function addRequiredSectionIssues({ issues, lines, headings, requiredSections, weakThreshold = 20 }) {
  const missing = [];
  const weak = [];

  requiredSections.forEach((sectionName) => {
    const heading = findHeading(headings, sectionName);

    if (!heading) {
      missing.push(sectionName);
      issues.push(createIssue(
        'SECTION_MISSING',
        'major',
        `Falta la sección obligatoria: ${sectionName}`,
        'No se encontró un encabezado compatible en el documento.',
        `Agregar y desarrollar la sección "${sectionName}" según el formato institucional.`
      ));
      return;
    }

    const content = getRangeContent(lines, headings, heading);
    const words = countWords(content);

    if (words < weakThreshold) {
      weak.push(sectionName);
      issues.push(createIssue(
        'SECTION_WEAK',
        'minor',
        `La sección parece vacía o débil: ${sectionName}`,
        `Se detectaron ${words} palabras después del encabezado.`,
        `Desarrollar la sección "${sectionName}" con contenido suficiente y pertinente.`
      ));
    }
  });

  return { missing, weak };
}

function analyzeBookUnits({ issues, lines, headings, rules }) {
  const romanUnits = ['I', 'II', 'III', 'IV'];
  const unitResults = [];

  romanUnits.forEach((roman) => {
    const unitRegex = new RegExp(`^\\s*Unidad\\s+${roman}\\b`, 'i');
    const unitHeading = findHeadingsByRegex(headings, unitRegex)[0];

    if (!unitHeading) {
      issues.push(createIssue(
        'UNIT_MISSING',
        'critical',
        `Falta la Unidad ${roman}`,
        `No se encontró el encabezado Unidad ${roman}.`,
        `Agregar la Unidad ${roman} con todas sus secciones obligatorias.`
      ));
      unitResults.push({ unit: roman, present: false, missingSubsections: rules.seccionesPorUnidad });
      return;
    }

    const nextUnitRegex = /^\s*Unidad\s+[IVXLCDM]+\b|^\s*Referencias\b|^\s*Glosario\b|^\s*Anexos\b/i;
    const unitText = getRangeContent(lines, headings, unitHeading, nextUnitRegex);
    const unitStart = unitHeading.line;
    const nextBoundary = headings.find((heading) => heading.line > unitStart && nextUnitRegex.test(heading.title));
    const unitEnd = nextBoundary ? nextBoundary.line : lines.length;
    const unitHeadings = headings.filter((heading) => heading.line >= unitStart && heading.line < unitEnd);
    const missingSubsections = [];

    rules.seccionesPorUnidad.forEach((subsection) => {
      if (!findHeading(unitHeadings, subsection)) {
        missingSubsections.push(subsection);
        issues.push(createIssue(
          'UNIT_SUBSECTION_MISSING',
          'major',
          `Unidad ${roman}: falta ${subsection}`,
          `No se encontró "${subsection}" dentro de la Unidad ${roman}.`,
          `Agregar "${subsection}" en la Unidad ${roman} y conectarlo con el resultado de aprendizaje.`
        ));
      }
    });

    unitResults.push({
      unit: roman,
      present: true,
      wordCount: countWords(unitText),
      missingSubsections
    });
  });

  return unitResults;
}

function analyzeGuideComponents({ issues, lines, headings, rules }) {
  const components = [
    { key: 'taller1', label: 'Taller 1', regex: /^\s*Taller\s+1\b/i },
    { key: 'taller2', label: 'Taller 2', regex: /^\s*Taller\s+2\b/i },
    { key: 'proyectoFinal', label: 'Proyecto Final', regex: /^\s*Proyecto\s+Final\b/i }
  ];

  return components.map((component) => {
    const heading = findHeadingsByRegex(headings, component.regex)[0];

    if (!heading) {
      issues.push(createIssue(
        'COMPONENT_MISSING',
        'critical',
        `Falta ${component.label}`,
        `No se encontró el encabezado ${component.label}.`,
        `Agregar ${component.label} según el formato de guía de formación práctica.`
      ));
      return { key: component.key, label: component.label, present: false, missingSubsections: rules.seccionesPorTaller };
    }

    const boundaryRegex = /^\s*Taller\s+\d+\b|^\s*Proyecto\s+Final\b|^\s*Referencias\b/i;
    const nextBoundary = headings.find((item) => item.line > heading.line && boundaryRegex.test(item.title));
    const componentEnd = nextBoundary ? nextBoundary.line : lines.length;
    const componentHeadings = headings.filter((item) => item.line >= heading.line && item.line < componentEnd);
    const componentText = lines.slice(heading.line, componentEnd).join('\n');
    const missingSubsections = [];

    rules.seccionesPorTaller.forEach((subsection) => {
      const isEnunciado = normalize(subsection).includes('enunciado');
      const found = isEnunciado
        ? componentHeadings.some((item) => normalize(item.title).includes('enunciado'))
        : findHeading(componentHeadings, subsection);

      if (!found) {
        missingSubsections.push(subsection);
        issues.push(createIssue(
          'GUIDE_SUBSECTION_MISSING',
          'major',
          `${component.label}: falta ${subsection}`,
          `No se encontró "${subsection}" dentro de ${component.label}.`,
          `Agregar "${subsection}" en ${component.label} y desarrollarlo de forma clara.`
        ));
      }
    });

    return {
      key: component.key,
      label: component.label,
      present: true,
      wordCount: countWords(componentText),
      missingSubsections
    };
  });
}

function analyzeReferences({ issues, summary, minimum }) {
  const count = summary && summary.references ? summary.references.count : 0;

  if (count < minimum) {
    issues.push(createIssue(
      'REFERENCES_INSUFFICIENT',
      'major',
      `Referencias insuficientes: ${count}/${minimum}`,
      `Se detectaron ${count} referencias candidatas.`,
      `Completar mínimo ${minimum} referencias académicas pertinentes y actualizadas.`
    ));
  }

  return { count, minimum, ok: count >= minimum };
}

function analyzeGlossary({ issues, text, headings, lines, minimum }) {
  const glossaryHeading = findHeading(headings, 'Glosario');

  if (!glossaryHeading) {
    issues.push(createIssue(
      'GLOSSARY_MISSING',
      'major',
      'Falta el glosario',
      'No se encontró la sección Glosario.',
      `Agregar glosario con mínimo ${minimum} términos.`
    ));
    return { count: 0, minimum, ok: false };
  }

  const glossaryText = getRangeContent(lines, headings, glossaryHeading, /^\s*Anexos\b/i);
  const candidates = glossaryText
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 3 && line.length < 180);

  const count = candidates.length;

  if (count < minimum) {
    issues.push(createIssue(
      'GLOSSARY_INSUFFICIENT',
      'minor',
      `Glosario insuficiente: ${count}/${minimum}`,
      `Se detectaron ${count} entradas candidatas.`,
      `Completar mínimo ${minimum} palabras o conceptos en el glosario.`
    ));
  }

  return { count, minimum, ok: count >= minimum };
}

function analyzeResources({ issues, summary }) {
  const figures = summary && summary.resources ? summary.resources.figures : { count: 0, duplicates: [] };
  const tables = summary && summary.resources ? summary.resources.tables : { count: 0, duplicates: [] };

  if (figures.duplicates && figures.duplicates.length) {
    issues.push(createIssue(
      'FIGURE_DUPLICATES',
      'minor',
      'Numeración duplicada de figuras',
      `Duplicados detectados: ${figures.duplicates.join(', ')}.`,
      'Revisar la numeración secuencial de todas las figuras.'
    ));
  }

  if (tables.duplicates && tables.duplicates.length) {
    issues.push(createIssue(
      'TABLE_DUPLICATES',
      'minor',
      'Numeración duplicada de tablas',
      `Duplicados detectados: ${tables.duplicates.join(', ')}.`,
      'Revisar la numeración secuencial de todas las tablas.'
    ));
  }

  return { figures, tables };
}

function summarizeIssues(issues) {
  return {
    critical: issues.filter((issue) => issue.severity === 'critical').length,
    major: issues.filter((issue) => issue.severity === 'major').length,
    minor: issues.filter((issue) => issue.severity === 'minor').length,
    total: issues.length
  };
}

function calculateStructureScore(summary) {
  const score = 100 - summary.critical * 15 - summary.major * 8 - summary.minor * 3;
  return Math.max(0, Math.min(100, score));
}

function calculateRisk(summary) {
  if (summary.critical > 0) return 'alto';
  if (summary.major > 2) return 'alto';
  if (summary.major > 0 || summary.minor > 3) return 'medio';
  return 'bajo';
}

function getRecommendedStatus(risk) {
  if (risk === 'alto') return 'Debe corregirse antes de continuar';
  if (risk === 'medio') return 'Requiere ajustes estructurales';
  return 'Estructura aceptable para continuar';
}

function analyzeStructure({ text, summary, classification }) {
  const documentType = classification && classification.detectedType ? classification.detectedType : 'desconocido';
  const rules = formatRules[documentType];
  const issues = [];
  const lines = getLines(text);
  const headings = getHeadings(summary);

  if (!rules) {
    return {
      applies: false,
      documentType,
      label: STRUCTURE_LABELS[documentType] || STRUCTURE_LABELS.desconocido,
      checkedAt: new Date().toISOString(),
      status: 'Sin reglas estructurales aplicables todavía',
      risk: 'sin_aplicar',
      score: null,
      issueSummary: { critical: 0, major: 0, minor: 0, total: 0 },
      issues: []
    };
  }

  const required = addRequiredSectionIssues({
    issues,
    lines,
    headings,
    requiredSections: rules.seccionesObligatorias,
    weakThreshold: documentType === 'guia_formacion_practica' ? 12 : 20
  });

  const componentAnalysis = documentType === 'libro_asignatura'
    ? analyzeBookUnits({ issues, lines, headings, rules })
    : documentType === 'guia_formacion_practica'
      ? analyzeGuideComponents({ issues, lines, headings, rules })
      : [];

  const references = analyzeReferences({ issues, summary, minimum: rules.minimoReferencias || 0 });
  const glossary = rules.minimoGlosario
    ? analyzeGlossary({ issues, text, headings, lines, minimum: rules.minimoGlosario })
    : null;
  const resources = analyzeResources({ issues, summary });
  const issueSummary = summarizeIssues(issues);
  const risk = calculateRisk(issueSummary);

  return {
    applies: true,
    documentType,
    label: STRUCTURE_LABELS[documentType] || STRUCTURE_LABELS.desconocido,
    checkedAt: new Date().toISOString(),
    status: getRecommendedStatus(risk),
    risk,
    score: calculateStructureScore(issueSummary),
    issueSummary,
    required,
    componentAnalysis,
    references,
    glossary,
    resources,
    issues: issues.slice(0, 80)
  };
}

module.exports = {
  analyzeStructure
};
