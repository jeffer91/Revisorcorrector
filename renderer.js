const state = { rows: [], analyzed: false, busy: false };
const $ = (id) => document.getElementById(id);

function log(message) {
  const time = new Date().toLocaleTimeString('es-EC', { hour12: false });
  $('log').textContent += `\n[${time}] ${message}`;
  $('log').scrollTop = $('log').scrollHeight;
}

function toast(message, type = '') {
  const box = $('toast');
  box.textContent = message;
  box.className = `show ${type}`;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => box.className = '', 3800);
}

function setBusy(busy) {
  state.busy = busy;
  document.querySelectorAll('button').forEach((button) => button.disabled = busy || (button.id === 'reportBtn' && !state.analyzed) || (button.id === 'migrateBtn' && (!state.analyzed || !$('targetCredentialPath').value)));
  $('globalStatus').textContent = busy ? 'Procesando…' : state.analyzed ? 'Análisis listo' : 'Esperando configuración';
}

function config() {
  return {
    excelPath: $('excelPath').value,
    sourceType: $('sourceType').value,
    sourcePath: $('sourcePath').value,
    lookupMode: $('lookupMode').value,
    idField: $('idField').value,
    databaseUrl: $('databaseUrl').value,
    sourceCredentialPath: $('sourceCredentialPath').value
  };
}

document.querySelectorAll('[data-pick]').forEach((button) => button.addEventListener('click', async () => {
  const result = await window.api.pick(button.dataset.pick);
  if (!result.ok) return;
  $(button.dataset.target).value = result.path;
  log(`Seleccionado: ${result.name}`);
  setBusy(false);
}));

$('sourceType').addEventListener('change', () => $('databaseUrlWrap').classList.toggle('hidden', $('sourceType').value !== 'rtdb'));
$('lookupMode').addEventListener('change', () => $('idFieldWrap').classList.toggle('hidden', $('lookupMode').value === 'documentId'));
$('filter').addEventListener('change', renderRows);
$('search').addEventListener('input', renderRows);

$('analyzeBtn').addEventListener('click', async () => {
  if (!$('excelPath').value) return toast('Selecciona el archivo Excel.', 'error');
  setBusy(true);
  state.analyzed = false;
  log('Iniciando análisis. La Firebase de destino no será modificada.');
  const result = await window.api.analyze(config());
  if (!result.ok) {
    setBusy(false);
    log(`ERROR: ${result.message}`);
    return toast(result.message, 'error');
  }
  state.rows = result.rows;
  state.analyzed = true;
  renderSummary(result.summary);
  renderRows();
  setBusy(false);
  log(`Análisis finalizado: ${result.summary.consolidated} envíos consolidados.`);
  toast('Análisis terminado. Revisa los resultados.', 'success');
});

$('reportBtn').addEventListener('click', async () => {
  const result = await window.api.exportReport();
  if (result.canceled) return;
  if (!result.ok) return toast(result.message, 'error');
  log(`Informe guardado: ${result.path}`);
  toast('Informe Excel guardado.', 'success');
});

$('migrateBtn').addEventListener('click', async () => {
  if (!$('targetCredentialPath').value) return toast('Selecciona la credencial de destino.', 'error');
  const includeMissing = $('includeMissing').checked;
  const message = includeMissing
    ? 'También se migrarán registros no encontrados en la Firebase de estudiantes. ¿Continuar?'
    : 'Solo se migrarán registros encontrados en la Firebase de estudiantes. ¿Continuar?';
  if (!confirm(message)) return;
  setBusy(true);
  log('Iniciando migración y respaldo previo.');
  const result = await window.api.migrate({ targetCredentialPath: $('targetCredentialPath').value, includeMissing });
  setBusy(false);
  if (!result.ok) {
    log(`ERROR DE MIGRACIÓN: ${result.message}`);
    return toast(result.message, 'error');
  }
  log(`Migración ${result.migrationId} completada. Registros: ${result.recordsMigrated}.`);
  log(`Respaldo: ${result.backupPath}`);
  toast('Migración completada correctamente.', 'success');
});

function renderSummary(summary) {
  $('summary').classList.remove('hidden');
  $('sRows').textContent = summary.submissionRows;
  $('sConsolidated').textContent = summary.consolidated;
  $('sDuplicates').textContent = summary.duplicates;
  $('sResolutions').textContent = summary.resolutions;
  $('sFound').textContent = summary.found;
  $('sMissing').textContent = summary.missing;
  $('sWarnings').textContent = summary.warnings;
  $('sErrors').textContent = summary.errors;
}

function renderRows() {
  const filter = $('filter').value;
  const search = $('search').value.trim().toLowerCase();
  const rows = state.rows.filter((row) => {
    if (filter === 'found' && !row.found) return false;
    if (filter === 'missing' && row.found) return false;
    if (filter === 'warnings' && !row.warnings.length) return false;
    return !search || `${row.cedula} ${row.student} ${row.career} ${row.period}`.toLowerCase().includes(search);
  });
  if (!rows.length) {
    $('rows').innerHTML = '<tr><td colspan="8" class="empty">No hay registros para este filtro.</td></tr>';
    return;
  }
  $('rows').innerHTML = rows.map((row) => {
    const found = row.found ? '<span class="chip ok">✓ Encontrado</span>' : '<span class="chip bad">× No encontrado</span>';
    const statusClass = row.status === 'APROBADO' ? 'ok' : row.status === 'DEVUELTO' ? 'bad' : 'warn';
    return `<tr>
      <td>${found}</td>
      <td><strong>${escapeHtml(row.cedula)}</strong><div class="sub">${escapeHtml(row.student)}</div></td>
      <td>${escapeHtml(row.period)}</td>
      <td>${escapeHtml(row.career || '—')}</td>
      <td><span class="chip ${statusClass}">${escapeHtml(row.status || 'PENDIENTE')}</span></td>
      <td>${row.versions}</td><td>${row.resolutions}</td>
      <td class="notes">${row.warnings.length ? row.warnings.map(escapeHtml).join('<br>') : '—'}</td>
    </tr>`;
  }).join('');
}

function escapeHtml(value) {
  return String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
}

window.api.onProgress((data) => {
  $('progressBar').style.width = `${data.percent}%`;
  $('progressNumber').textContent = `${data.percent}%`;
  $('progressMessage').textContent = data.message;
  $('progressBar').style.background = data.stage === 'error' ? '#b42336' : data.percent === 100 ? '#138a58' : 'linear-gradient(90deg,#1769aa,#38a0df)';
});

setBusy(false);
