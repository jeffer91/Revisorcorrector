const DOCUMENT_LABELS = {
  libro_asignatura: 'Libro de asignatura',
  guia_formacion_practica: 'Guía de formación práctica',
  pea: 'PEA',
  rubrica: 'Rúbrica',
  formato_base: 'Formato base',
  desconocido: 'Documento desconocido'
};

const CLASSIFICATION_RULES = {
  libro_asignatura: [
    { pattern: /libro\s+de\s+asignatura/i, weight: 8, evidence: 'Menciona libro de asignatura' },
    { pattern: /nombre\s+de\s+la\s+asignatura/i, weight: 4, evidence: 'Incluye nombre de la asignatura' },
    { pattern: /presentaci[oó]n\s+de\s+la\s+asignatura/i, weight: 4, evidence: 'Incluye presentación de la asignatura' },
    { pattern: /pre\s*requisitos\s+de\s+la\s+asignatura/i, weight: 3, evidence: 'Incluye prerrequisitos' },
    { pattern: /evaluaci[oó]n\s+inicial\s+diagn[oó]stica/i, weight: 3, evidence: 'Incluye evaluación diagnóstica' },
    { pattern: /orientaciones\s+generales\s+para\s+el\s+estudiante/i, weight: 4, evidence: 'Incluye orientaciones generales' },
    { pattern: /unidad\s+i\b/i, weight: 4, evidence: 'Incluye Unidad I' },
    { pattern: /unidad\s+ii\b/i, weight: 4, evidence: 'Incluye Unidad II' },
    { pattern: /unidad\s+iii\b/i, weight: 4, evidence: 'Incluye Unidad III' },
    { pattern: /unidad\s+iv\b/i, weight: 4, evidence: 'Incluye Unidad IV' },
    { pattern: /resultado\s+de\s+aprendizaje/i, weight: 4, evidence: 'Incluye resultados de aprendizaje' },
    { pattern: /estrategias\s+de\s+enseñanza[-\s]aprendizaje/i, weight: 4, evidence: 'Incluye estrategias de enseñanza-aprendizaje' },
    { pattern: /evaluaci[oó]n\s+de\s+unidad/i, weight: 4, evidence: 'Incluye evaluación de unidad' },
    { pattern: /auto\s*evaluaci[oó]n/i, weight: 3, evidence: 'Incluye autoevaluación' },
    { pattern: /reflexiones\s+sobre\s+la\s+unidad/i, weight: 3, evidence: 'Incluye reflexiones por unidad' },
    { pattern: /glosario/i, weight: 3, evidence: 'Incluye glosario' },
    { pattern: /anexos/i, weight: 2, evidence: 'Incluye anexos' }
  ],
  guia_formacion_practica: [
    { pattern: /gu[ií]a\s+de\s+formaci[oó]n\s+pr[aá]ctica/i, weight: 8, evidence: 'Menciona guía de formación práctica' },
    { pattern: /gu[ií]a\s+pr[aá]ctica/i, weight: 5, evidence: 'Menciona guía práctica' },
    { pattern: /taller\s+1\b/i, weight: 5, evidence: 'Incluye Taller 1' },
    { pattern: /taller\s+2\b/i, weight: 5, evidence: 'Incluye Taller 2' },
    { pattern: /proyecto\s+final/i, weight: 5, evidence: 'Incluye Proyecto Final' },
    { pattern: /tiempo\s+de\s+duraci[oó]n/i, weight: 3, evidence: 'Incluye tiempo de duración' },
    { pattern: /fundamentaci[oó]n\s+te[oó]rica/i, weight: 4, evidence: 'Incluye fundamentación teórica' },
    { pattern: /preparaci[oó]n\s+previa/i, weight: 4, evidence: 'Incluye preparación previa' },
    { pattern: /enunciado\s+del\s+taller/i, weight: 4, evidence: 'Incluye enunciado del taller' },
    { pattern: /destrezas\s+y\s+habilidades/i, weight: 4, evidence: 'Incluye destrezas y habilidades' },
    { pattern: /identificaci[oó]n\s+de\s+riesgos/i, weight: 4, evidence: 'Incluye identificación de riesgos' },
    { pattern: /normas\s+de\s+seguridad/i, weight: 4, evidence: 'Incluye normas de seguridad' },
    { pattern: /equipo\s+de\s+bioseguridad/i, weight: 4, evidence: 'Incluye equipo de bioseguridad' }
  ],
  pea: [
    { pattern: /\bpea\b/i, weight: 7, evidence: 'Menciona PEA' },
    { pattern: /plan\s+de\s+estudio\s+de\s+asignatura/i, weight: 8, evidence: 'Menciona plan de estudio de asignatura' },
    { pattern: /programa\s+de\s+estudio\s+de\s+asignatura/i, weight: 8, evidence: 'Menciona programa de estudio de asignatura' },
    { pattern: /datos\s+informativos\s+de\s+la\s+asignatura/i, weight: 4, evidence: 'Incluye datos informativos' },
    { pattern: /objetivo\s+general\s+de\s+la\s+asignatura/i, weight: 4, evidence: 'Incluye objetivo general' },
    { pattern: /resultados\s+de\s+aprendizaje/i, weight: 5, evidence: 'Incluye resultados de aprendizaje' },
    { pattern: /contenidos\s+m[ií]nimos/i, weight: 5, evidence: 'Incluye contenidos mínimos' },
    { pattern: /unidades\s+de\s+aprendizaje/i, weight: 4, evidence: 'Incluye unidades de aprendizaje' },
    { pattern: /metodolog[ií]a\s+de\s+enseñanza/i, weight: 4, evidence: 'Incluye metodología de enseñanza' },
    { pattern: /sistema\s+de\s+evaluaci[oó]n/i, weight: 4, evidence: 'Incluye sistema de evaluación' },
    { pattern: /bibliograf[ií]a\s+b[aá]sica/i, weight: 3, evidence: 'Incluye bibliografía básica' }
  ],
  rubrica: [
    { pattern: /r[uú]brica\s+de\s+revisi[oó]n\s+interna/i, weight: 8, evidence: 'Menciona rúbrica de revisión interna' },
    { pattern: /criterios\s+de\s+evaluaci[oó]n/i, weight: 5, evidence: 'Incluye criterios de evaluación' },
    { pattern: /aspectos\s+por\s+evaluar/i, weight: 5, evidence: 'Incluye aspectos por evaluar' },
    { pattern: /ponderaci[oó]n/i, weight: 4, evidence: 'Incluye ponderación' },
    { pattern: /deficiente\s+regular\s+buena/i, weight: 5, evidence: 'Incluye escala de valoración' },
    { pattern: /rango\s+del\s+puntaje\s+obtenido/i, weight: 5, evidence: 'Incluye rango de puntaje' },
    { pattern: /no\s+aprobado/i, weight: 3, evidence: 'Incluye estado no aprobado' },
    { pattern: /aprobado\s+sin\s+modificaciones/i, weight: 3, evidence: 'Incluye estado aprobado sin modificaciones' },
    { pattern: /observaciones\s+generales/i, weight: 3, evidence: 'Incluye observaciones generales' },
    { pattern: /revisor\s+interno/i, weight: 3, evidence: 'Incluye revisor interno' }
  ],
  formato_base: [
    { pattern: /formato\s+oficial/i, weight: 6, evidence: 'Menciona formato oficial' },
    { pattern: /formato\s+base/i, weight: 6, evidence: 'Menciona formato base' },
    { pattern: /tabla\s+de\s+contenidos/i, weight: 2, evidence: 'Incluye tabla de contenidos' },
    { pattern: /t[ií]tulo:/i, weight: 2, evidence: 'Incluye campos guía tipo plantilla' },
    { pattern: /tiempo\s+de\s+duraci[oó]n:/i, weight: 2, evidence: 'Incluye campos de duración tipo plantilla' },
    { pattern: /describa\s+las\s+habilidades/i, weight: 4, evidence: 'Contiene instrucciones de plantilla' },
    { pattern: /en\s+este\s+apartado\s+es\s+necesario/i, weight: 5, evidence: 'Contiene instrucciones de llenado' },
    { pattern: /en\s+este\s+apartado\s+se\s+pretende/i, weight: 5, evidence: 'Contiene instrucciones de formato' }
  ]
};

function compactText(text, summary) {
  const headingText = summary && Array.isArray(summary.headings)
    ? summary.headings.map((heading) => heading.title).join('\n')
    : '';

  return `${headingText}\n${String(text || '').slice(0, 50000)}`;
}

function scoreDocument(text, summary) {
  const source = compactText(text, summary);

  return Object.entries(CLASSIFICATION_RULES).map(([type, rules]) => {
    const evidence = [];
    const score = rules.reduce((total, rule) => {
      if (rule.pattern.test(source)) {
        evidence.push(rule.evidence);
        return total + rule.weight;
      }
      return total;
    }, 0);

    return {
      type,
      label: DOCUMENT_LABELS[type],
      score,
      evidence: Array.from(new Set(evidence)).slice(0, 12)
    };
  }).sort((a, b) => b.score - a.score);
}

function calculateConfidence(best, second) {
  if (!best || best.score <= 0) return 0;

  const gap = best.score - (second ? second.score : 0);
  const raw = Math.min(0.98, 0.45 + best.score / 70 + gap / 50);
  return Number(raw.toFixed(2));
}

function classifyDocument(summary, text) {
  const scores = scoreDocument(text, summary);
  const best = scores[0];
  const second = scores[1];
  const confidence = calculateConfidence(best, second);
  const detectedType = best && best.score >= 8 ? best.type : 'desconocido';

  return {
    detectedType,
    label: DOCUMENT_LABELS[detectedType],
    confidence: detectedType === 'desconocido' ? 0 : confidence,
    scores,
    evidence: detectedType === 'desconocido' ? [] : best.evidence,
    requiresHumanConfirmation: detectedType === 'desconocido' || confidence < 0.65
  };
}

module.exports = {
  classifyDocument,
  DOCUMENT_LABELS
};
