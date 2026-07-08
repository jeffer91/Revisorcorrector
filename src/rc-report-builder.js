function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatDate(value) {
  const date = value ? new Date(value) : new Date();
  return date.toLocaleString('es-EC', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function getSummary(reviewPayload) {
  const rubric = reviewPayload.rubricReview || {};
  const ai = reviewPayload.aiReview || {};
  const executive = ai.executiveSummary || {};

  return {
    documentName: reviewPayload.mainDocument ? reviewPayload.mainDocument.name : 'Documento principal',
    peaName: reviewPayload.pea ? reviewPayload.pea.name : 'No cargado',
    total: rubric.total || 0,
    max: rubric.max || 30,
    status: rubric.status || 'Sin estado',
    risk: rubric.risk || 'sin definir',
    conclusion: rubric.conclusion || executive.conclusion || 'Sin conclusión disponible.',
    checkedAt: rubric.checkedAt || new Date().toISOString()
  };
}

function buildMarkdownReport(reviewPayload) {
  const summary = getSummary(reviewPayload);
  const rubric = reviewPayload.rubricReview || {};
  const pea = reviewPayload.peaAlignment || null;
  const criteria = rubric.criteria || [];
  const observations = rubric.observations || [];

  const lines = [];
  lines.push('# Informe de revisión institucional');
  lines.push('');
  lines.push(`**Documento:** ${summary.documentName}`);
  lines.push(`**PEA:** ${summary.peaName}`);
  lines.push(`**Fecha de revisión:** ${formatDate(summary.checkedAt)}`);
  lines.push(`**Puntaje:** ${summary.total}/${summary.max}`);
  lines.push(`**Estado:** ${summary.status}`);
  lines.push(`**Riesgo:** ${summary.risk}`);
  lines.push('');
  lines.push('## Resumen ejecutivo');
  lines.push(summary.conclusion);
  lines.push('');

  if (pea) {
    lines.push('## Alineación al PEA');
    lines.push(`**Puntaje PEA:** ${pea.score}/100`);
    lines.push(`**Estado PEA:** ${pea.status}`);
    lines.push(`**Riesgo PEA:** ${pea.risk}`);
    lines.push('');
  }

  lines.push('## Rúbrica institucional');
  lines.push('| Criterio | Puntaje | Riesgo | Recomendación |');
  lines.push('|---|---:|---|---|');
  criteria.forEach((criterion) => {
    lines.push(`| ${criterion.code}. ${criterion.name} | ${criterion.score}/5 | ${criterion.risk} | ${criterion.recommendation} |`);
  });
  lines.push('');

  lines.push('## Evidencias por criterio');
  criteria.forEach((criterion) => {
    lines.push(`### ${criterion.code}. ${criterion.name}`);
    (criterion.evidence || []).forEach((item) => lines.push(`- ${item}`));
    lines.push(`**Recomendación:** ${criterion.recommendation}`);
    lines.push('');
  });

  lines.push('## Observaciones priorizadas');
  if (observations.length === 0) {
    lines.push('- No se generaron observaciones críticas o medias desde la rúbrica automática.');
  } else {
    observations.forEach((item) => lines.push(`- **${item.criterion} (${item.severity}):** ${item.text}`));
  }
  lines.push('');
  lines.push('## Nota técnica');
  lines.push('Este informe fue generado automáticamente por Revisorcorrector. Debe ser validado por un revisor académico antes de emitir aprobación final.');

  return lines.join('\n');
}

function buildPlainTextReport(reviewPayload) {
  return buildMarkdownReport(reviewPayload)
    .replace(/^#+\s*/gm, '')
    .replace(/\*\*/g, '')
    .replace(/\|/g, ' ');
}

function buildHtmlReport(reviewPayload) {
  const summary = getSummary(reviewPayload);
  const rubric = reviewPayload.rubricReview || {};
  const pea = reviewPayload.peaAlignment || null;
  const criteria = rubric.criteria || [];
  const observations = rubric.observations || [];

  const criteriaRows = criteria.map((criterion) => `
    <tr>
      <td>${escapeHtml(criterion.code)}</td>
      <td>${escapeHtml(criterion.name)}</td>
      <td>${escapeHtml(`${criterion.score}/5`)}</td>
      <td>${escapeHtml(criterion.risk)}</td>
      <td>${escapeHtml(criterion.recommendation)}</td>
    </tr>`).join('');

  const evidenceBlocks = criteria.map((criterion) => `
    <section class="criterion">
      <h3>${escapeHtml(criterion.code)}. ${escapeHtml(criterion.name)}</h3>
      <ul>${(criterion.evidence || []).map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
      <p><strong>Recomendación:</strong> ${escapeHtml(criterion.recommendation)}</p>
    </section>`).join('');

  const observationItems = observations.length
    ? observations.map((item) => `<li><strong>${escapeHtml(item.criterion)} (${escapeHtml(item.severity)}):</strong> ${escapeHtml(item.text)}</li>`).join('')
    : '<li>No se generaron observaciones críticas o medias desde la rúbrica automática.</li>';

  const peaBlock = pea ? `
    <section>
      <h2>Alineación al PEA</h2>
      <p><strong>Puntaje PEA:</strong> ${escapeHtml(`${pea.score}/100`)}</p>
      <p><strong>Estado PEA:</strong> ${escapeHtml(pea.status)}</p>
      <p><strong>Riesgo PEA:</strong> ${escapeHtml(pea.risk)}</p>
    </section>` : '';

  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <title>Informe Revisorcorrector</title>
  <style>
    body { font-family: Arial, sans-serif; color: #1f2937; line-height: 1.5; margin: 36px; }
    h1, h2, h3 { color: #0f172a; }
    .meta, .summary, .criterion { border: 1px solid #d8dee9; border-radius: 12px; padding: 16px; margin-bottom: 16px; }
    table { width: 100%; border-collapse: collapse; margin: 16px 0; }
    th, td { border: 1px solid #d8dee9; padding: 8px; text-align: left; vertical-align: top; }
    th { background: #f1f5f9; }
    .status { font-size: 18px; font-weight: bold; color: #0f766e; }
  </style>
</head>
<body>
  <h1>Informe de revisión institucional</h1>
  <section class="meta">
    <p><strong>Documento:</strong> ${escapeHtml(summary.documentName)}</p>
    <p><strong>PEA:</strong> ${escapeHtml(summary.peaName)}</p>
    <p><strong>Fecha de revisión:</strong> ${escapeHtml(formatDate(summary.checkedAt))}</p>
    <p><strong>Puntaje:</strong> ${escapeHtml(`${summary.total}/${summary.max}`)}</p>
    <p class="status"><strong>Estado:</strong> ${escapeHtml(summary.status)}</p>
    <p><strong>Riesgo:</strong> ${escapeHtml(summary.risk)}</p>
  </section>
  <section class="summary">
    <h2>Resumen ejecutivo</h2>
    <p>${escapeHtml(summary.conclusion)}</p>
  </section>
  ${peaBlock}
  <section>
    <h2>Rúbrica institucional</h2>
    <table>
      <thead><tr><th>Código</th><th>Criterio</th><th>Puntaje</th><th>Riesgo</th><th>Recomendación</th></tr></thead>
      <tbody>${criteriaRows}</tbody>
    </table>
  </section>
  <section>
    <h2>Evidencias por criterio</h2>
    ${evidenceBlocks}
  </section>
  <section>
    <h2>Observaciones priorizadas</h2>
    <ul>${observationItems}</ul>
  </section>
  <section>
    <h2>Nota técnica</h2>
    <p>Este informe fue generado automáticamente por Revisorcorrector. Debe ser validado por un revisor académico antes de emitir aprobación final.</p>
  </section>
</body>
</html>`;
}

module.exports = {
  buildMarkdownReport,
  buildPlainTextReport,
  buildHtmlReport
};
