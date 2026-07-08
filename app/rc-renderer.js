const appState = {
  mode: 'experto',
  files: {
    mainDocument: null,
    pea: null,
    rubric: null,
    formatBase: null
  }
};

const fileRoleConfig = {
  mainDocument: {
    title: 'Seleccionar libro o guía en Word',
    emptyText: 'Sin archivo seleccionado.',
    filters: [
      { name: 'Word', extensions: ['docx'] }
    ]
  },
  pea: {
    title: 'Seleccionar PEA',
    emptyText: 'Sin archivo seleccionado.',
    filters: [
      { name: 'PEA en Word o PDF', extensions: ['docx', 'pdf'] }
    ]
  },
  rubric: {
    title: 'Seleccionar rúbrica',
    emptyText: 'Usando rúbrica interna.',
    filters: [
      { name: 'Rúbrica en Word o PDF', extensions: ['docx', 'pdf'] }
    ]
  },
  formatBase: {
    title: 'Seleccionar formato base',
    emptyText: 'Usando formato interno.',
    filters: [
      { name: 'Formato en Word o PDF', extensions: ['docx', 'pdf'] }
    ]
  }
};

function getFileName(filePath) {
  if (!filePath) return '';
  return String(filePath).split(/[\\/]/).pop();
}

function formatNumber(value) {
  return new Intl.NumberFormat('es-EC').format(value || 0);
}

function getDocumentLabel(document) {
  if (!document) return '';
  return document.originalName || getFileName(document.sourcePath || document.uploadPath || '');
}

function getClassificationText(document) {
  if (!document || !document.classification) return 'Sin clasificar';
  const percent = Math.round((document.classification.confidence || 0) * 100);
  return `${document.classification.label} (${percent}%)`;
}

function getStructureText(document) {
  if (!document || !document.structureAnalysis) return 'estructura pendiente';

  const analysis = document.structureAnalysis;
  if (!analysis.applies) return 'estructura: no aplica';

  const issueSummary = analysis.issueSummary || { total: 0 };
  return `estructura: ${analysis.score}/100 · ${issueSummary.total} alertas · riesgo ${analysis.risk}`;
}

function getDocumentSummaryLine(document, emptyText) {
  if (!document) return emptyText;

  const stats = document.summary && document.summary.stats ? document.summary.stats : {};
  const headingCount = document.summary && document.summary.headings ? document.summary.headings.length : 0;
  const pageText = document.summary && document.summary.pageCount ? ` · ${document.summary.pageCount} páginas` : '';
  const classificationText = getClassificationText(document);
  const structureText = getStructureText(document);

  return `${getDocumentLabel(document)} · ${classificationText} · ${structureText} · ${formatNumber(stats.wordCount)} palabras · ${headingCount} secciones${pageText}`;
}

function setView(viewName) {
  const views = document.querySelectorAll('.rc-view');
  const navItems = document.querySelectorAll('.rc-nav-item');
  const target = document.getElementById(`view-${viewName}`);
  const pageTitle = document.getElementById('pageTitle');

  views.forEach((view) => view.classList.remove('is-active'));
  navItems.forEach((item) => item.classList.toggle('is-active', item.dataset.view === viewName));

  if (target) {
    target.classList.add('is-active');
    pageTitle.textContent = target.dataset.title || 'Revisorcorrector';
  }
}

function documentHasRisk(document) {
  if (!document) return false;
  const invalidRole = document.roleValidation && !document.roleValidation.isExpected;
  const structureRisk = document.structureAnalysis && ['alto', 'medio'].includes(document.structureAnalysis.risk);
  return Boolean(invalidRole || structureRisk);
}

function updateFileUi(role, temporaryText = null, isError = false) {
  const config = fileRoleConfig[role];
  const documentRecord = appState.files[role];
  const textElement = document.getElementById(`file-${role}`);
  const cardElement = document.querySelector(`[data-role-card="${role}"]`);

  if (textElement) {
    textElement.textContent = temporaryText || getDocumentSummaryLine(documentRecord, config.emptyText);
    textElement.title = documentRecord ? documentRecord.sourcePath : '';
  }

  if (cardElement) {
    cardElement.classList.toggle('has-file', Boolean(documentRecord));
    cardElement.classList.toggle('has-error', Boolean(isError || documentHasRisk(documentRecord)));
  }
}

function getMetricLabel(document, fallback) {
  if (!document) return fallback;
  if (!document.structureAnalysis || !document.structureAnalysis.applies) return document.classification.label;
  return `${document.classification.label} · ${document.structureAnalysis.score}/100`;
}

function updateMetrics() {
  const metricMainDoc = document.getElementById('metricMainDoc');
  const metricPea = document.getElementById('metricPea');
  const metricRubric = document.getElementById('metricRubric');
  const metricFormat = document.getElementById('metricFormat');

  metricMainDoc.textContent = getMetricLabel(appState.files.mainDocument, 'Pendiente');
  metricPea.textContent = getMetricLabel(appState.files.pea, 'Pendiente');
  metricRubric.textContent = getMetricLabel(appState.files.rubric, 'Interna');
  metricFormat.textContent = getMetricLabel(appState.files.formatBase, 'Interno');
}

function updateProgress() {
  const requiredLoaded = Boolean(appState.files.mainDocument && appState.files.pea);
  const optionalLoaded = Number(Boolean(appState.files.rubric)) + Number(Boolean(appState.files.formatBase));
  const percent = requiredLoaded ? Math.min(100, 60 + optionalLoaded * 20) : appState.files.mainDocument || appState.files.pea ? 30 : 0;
  const classifiedCount = Object.values(appState.files).filter((item) => item && item.classification).length;
  const structuredCount = Object.values(appState.files).filter((item) => item && item.structureAnalysis).length;

  const progressText = document.getElementById('progressText');
  const progressBar = document.getElementById('progressBar');
  const stepUpload = document.getElementById('stepUpload');
  const stepParse = document.getElementById('stepParse');
  const stepClassify = document.getElementById('stepClassify');
  const stepReview = document.getElementById('stepReview');

  progressText.textContent = `${percent}%`;
  progressBar.style.width = `${percent}%`;
  stepUpload.classList.toggle('is-complete', requiredLoaded);
  stepParse.classList.toggle('is-ready', Boolean(appState.files.mainDocument || appState.files.pea));
  stepParse.classList.toggle('is-complete', classifiedCount > 0);
  stepClassify.classList.toggle('is-ready', classifiedCount > 0);
  stepClassify.classList.toggle('is-complete', classifiedCount > 0);
  stepReview.classList.toggle('is-ready', structuredCount > 0);
}

function updateMode(mode) {
  appState.mode = mode;

  document.querySelectorAll('[data-mode]').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.mode === mode);
  });

  const label = document.getElementById('selectedModeLabel');
  const modeName = {
    experto: 'Modo experto',
    completo: 'Modo completo',
    rapido: 'Modo rápido'
  }[mode] || 'Modo experto';

  label.textContent = modeName;
}

async function selectFileForRole(role) {
  const config = fileRoleConfig[role];
  const result = await window.rcApi.selectFiles({
    title: config.title,
    multiple: false,
    filters: config.filters
  });

  if (result.canceled || result.files.length === 0) {
    return;
  }

  const filePath = result.files[0];
  updateFileUi(role, `Leyendo, clasificando y revisando estructura de ${getFileName(filePath)}...`);

  try {
    const imported = await window.rcApi.importDocument({ filePath, role });

    if (!imported.ok) {
      throw new Error(imported.message || 'No se pudo importar el documento.');
    }

    appState.files[role] = imported.document;
    updateFileUi(role);
    updateMetrics();
    updateProgress();
  } catch (error) {
    appState.files[role] = null;
    updateFileUi(role, `Error: ${error.message}`, true);
    updateMetrics();
    updateProgress();
  }
}

function bindNavigation() {
  document.querySelectorAll('.rc-nav-item').forEach((button) => {
    button.addEventListener('click', () => setView(button.dataset.view));
  });
}

function bindFileButtons() {
  document.querySelectorAll('[data-file-role]').forEach((button) => {
    button.addEventListener('click', () => selectFileForRole(button.dataset.fileRole));
  });
}

function bindModeButtons() {
  document.querySelectorAll('[data-mode]').forEach((button) => {
    button.addEventListener('click', () => updateMode(button.dataset.mode));
  });
}

function bindReviewButton() {
  const btnStartReview = document.getElementById('btnStartReview');

  btnStartReview.addEventListener('click', () => {
    setView('analisis');
    updateProgress();
  });
}

async function bootApp() {
  const statusTitle = document.getElementById('rcStatusTitle');
  const statusText = document.getElementById('rcStatusText');
  const appStage = document.getElementById('appStage');

  bindNavigation();
  bindFileButtons();
  bindModeButtons();
  bindReviewButton();
  updateMode(appState.mode);
  updateMetrics();
  updateProgress();

  try {
    const [info, health] = await Promise.all([
      window.rcApi.getAppInfo(),
      window.rcApi.healthCheck()
    ]);

    statusTitle.textContent = `${info.name} v${info.version}`;
    statusText.textContent = health.ok ? health.message : 'La app no respondió correctamente.';
    appStage.textContent = info.stage || 'Bloque 5';
  } catch (error) {
    statusTitle.textContent = 'Error de inicio';
    statusText.textContent = error.message;
  }
}

window.addEventListener('DOMContentLoaded', bootApp);
