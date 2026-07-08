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
    loadedMetric: 'Cargado',
    filters: [
      { name: 'Word', extensions: ['docx'] }
    ]
  },
  pea: {
    title: 'Seleccionar PEA',
    emptyText: 'Sin archivo seleccionado.',
    loadedMetric: 'Cargado',
    filters: [
      { name: 'PEA en Word o PDF', extensions: ['docx', 'pdf'] }
    ]
  },
  rubric: {
    title: 'Seleccionar rúbrica',
    emptyText: 'Usando rúbrica interna.',
    loadedMetric: 'Externa',
    filters: [
      { name: 'Rúbrica en Word o PDF', extensions: ['docx', 'pdf'] }
    ]
  },
  formatBase: {
    title: 'Seleccionar formato base',
    emptyText: 'Usando formato interno.',
    loadedMetric: 'Externo',
    filters: [
      { name: 'Formato en Word o PDF', extensions: ['docx', 'pdf'] }
    ]
  }
};

function getFileName(filePath) {
  if (!filePath) return '';
  return filePath.split(/[\\/]/).pop();
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

function updateFileUi(role) {
  const config = fileRoleConfig[role];
  const filePath = appState.files[role];
  const textElement = document.getElementById(`file-${role}`);
  const cardElement = document.querySelector(`[data-role-card="${role}"]`);

  if (textElement) {
    textElement.textContent = filePath ? getFileName(filePath) : config.emptyText;
    textElement.title = filePath || '';
  }

  if (cardElement) {
    cardElement.classList.toggle('has-file', Boolean(filePath));
  }
}

function updateMetrics() {
  const metricMainDoc = document.getElementById('metricMainDoc');
  const metricPea = document.getElementById('metricPea');
  const metricRubric = document.getElementById('metricRubric');
  const metricFormat = document.getElementById('metricFormat');

  metricMainDoc.textContent = appState.files.mainDocument ? 'Cargado' : 'Pendiente';
  metricPea.textContent = appState.files.pea ? 'Cargado' : 'Pendiente';
  metricRubric.textContent = appState.files.rubric ? 'Externa' : 'Interna';
  metricFormat.textContent = appState.files.formatBase ? 'Externo' : 'Interno';
}

function updateProgress() {
  const requiredLoaded = Boolean(appState.files.mainDocument && appState.files.pea);
  const optionalLoaded = Number(Boolean(appState.files.rubric)) + Number(Boolean(appState.files.formatBase));
  const percent = requiredLoaded ? Math.min(100, 60 + optionalLoaded * 20) : appState.files.mainDocument || appState.files.pea ? 30 : 0;

  const progressText = document.getElementById('progressText');
  const progressBar = document.getElementById('progressBar');
  const stepUpload = document.getElementById('stepUpload');

  progressText.textContent = `${percent}%`;
  progressBar.style.width = `${percent}%`;
  stepUpload.classList.toggle('is-complete', requiredLoaded);
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

  appState.files[role] = result.files[0];
  updateFileUi(role);
  updateMetrics();
  updateProgress();
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
    appStage.textContent = info.stage || 'Bloque 2';
  } catch (error) {
    statusTitle.textContent = 'Error de inicio';
    statusText.textContent = error.message;
  }
}

window.addEventListener('DOMContentLoaded', bootApp);
