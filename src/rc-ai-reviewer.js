function buildReviewerComment(criterion) {
  const evidence = Array.isArray(criterion.evidence) && criterion.evidence.length
    ? criterion.evidence.join(' ')
    : 'No se registró evidencia suficiente.';

  return {
    criterio: criterion.code,
    nombre: criterion.name,
    puntaje: criterion.score,
    riesgo: criterion.risk,
    observacion: `${criterion.name}: puntaje ${criterion.score}/5. ${evidence}`,
    recomendacion: criterion.recommendation
  };
}

function buildExecutiveSummary({ documentRecord, peaAlignment, rubricReview }) {
  const documentName = documentRecord ? documentRecord.originalName : 'Documento principal';
  const documentType = documentRecord && documentRecord.classification
    ? documentRecord.classification.label
    : 'Sin clasificar';
  const peaScore = peaAlignment && peaAlignment.score !== null ? peaAlignment.score : 'N/D';

  return {
    titulo: 'Resumen ejecutivo de revisión institucional',
    documento: documentName,
    tipoDocumento: documentType,
    puntajeRubrica: `${rubricReview.total}/${rubricReview.max}`,
    estado: rubricReview.status,
    riesgo: rubricReview.risk,
    alineacionPea: `${peaScore}/100`,
    conclusion: rubricReview.conclusion
  };
}

function buildPromptContext({ documentRecord, peaAlignment, rubricReview }) {
  const summary = buildExecutiveSummary({ documentRecord, peaAlignment, rubricReview });
  const comments = rubricReview.criteria.map(buildReviewerComment);

  return {
    summary,
    comments,
    promptForExternalAi: [
      'Actúa como revisor académico institucional.',
      'Usa únicamente los datos estructurados entregados por la app.',
      'Redacta observaciones formales, específicas y accionables.',
      'No inventes contenidos no evidenciados.',
      'Prioriza alineación con PEA, estructura institucional, didáctica y APA 7.'
    ].join(' ')
  };
}

function buildInstitutionalReview({ documentRecord, peaAlignment, rubricReview }) {
  const promptContext = buildPromptContext({ documentRecord, peaAlignment, rubricReview });

  return {
    generatedAt: new Date().toISOString(),
    mode: 'rule_based_reviewer_ready_for_ai',
    executiveSummary: promptContext.summary,
    reviewerComments: promptContext.comments,
    aiPromptContext: promptContext.promptForExternalAi,
    nextStep: 'En una versión posterior se podrá enviar este contexto a un proveedor IA configurado por el usuario.'
  };
}

module.exports = {
  buildInstitutionalReview
};
