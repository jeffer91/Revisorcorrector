const fs = require('fs/promises');
const path = require('path');
const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const { rcConfig } = require('../src/rc-config');
const { createInitialState } = require('../src/rc-state');
const { importAcademicDocument, runPeaAlignment, runInstitutionalReview } = require('../src/rc-file-service');

const runtimeState = createInitialState();

function safeError(error) {
  return {
    ok: false,
    message: error && error.message ? error.message : 'Error desconocido.'
  };
}

async function exportHtmlToPdf(htmlPath) {
  if (!htmlPath) return null;

  const pdfPath = htmlPath.replace(/\.html$/i, '.pdf');
  const pdfWindow = new BrowserWindow({
    show: false,
    webPreferences: {
      sandbox: true,
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  try {
    await pdfWindow.loadFile(htmlPath);
    const pdfBuffer = await pdfWindow.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4',
      margins: {
        marginType: 'custom',
        top: 0.6,
        bottom: 0.6,
        left: 0.6,
        right: 0.6
      }
    });

    await fs.writeFile(pdfPath, pdfBuffer);
    return pdfPath;
  } finally {
    if (!pdfWindow.isDestroyed()) {
      pdfWindow.destroy();
    }
  }
}

function registerIpcHandlers() {
  ipcMain.handle('app:get-info', () => ({
    name: rcConfig.appName,
    version: app.getVersion(),
    stage: rcConfig.stage,
    documentTypes: rcConfig.documentTypes
  }));

  ipcMain.handle('app:health-check', () => ({
    ok: true,
    message: 'Exportación PDF real activa',
    loadedAt: runtimeState.loadedAt
  }));

  ipcMain.handle('dialog:select-files', async (_event, options = {}) => {
    const result = await dialog.showOpenDialog({
      title: options.title || 'Seleccionar archivo',
      properties: options.multiple ? ['openFile', 'multiSelections'] : ['openFile'],
      filters: options.filters || rcConfig.fileFilters.allSupported
    });

    if (result.canceled) {
      return { canceled: true, files: [] };
    }

    return { canceled: false, files: result.filePaths };
  });

  ipcMain.handle('files:import-document', async (_event, payload = {}) => {
    try {
      const document = await importAcademicDocument(payload);
      runtimeState.files[payload.role] = document;

      return {
        ok: true,
        document
      };
    } catch (error) {
      return safeError(error);
    }
  });

  ipcMain.handle('files:get-imported', () => ({
    ok: true,
    files: runtimeState.files
  }));

  ipcMain.handle('files:open-path', async (_event, filePath) => {
    try {
      if (!filePath) throw new Error('No se recibió una ruta para abrir.');
      const result = await shell.openPath(filePath);
      if (result) throw new Error(result);
      return { ok: true };
    } catch (error) {
      return safeError(error);
    }
  });

  ipcMain.handle('analysis:pea-alignment', async () => {
    try {
      if (!runtimeState.files.mainDocument || !runtimeState.files.pea) {
        throw new Error('Carga primero el documento principal y el PEA.');
      }

      const alignment = await runPeaAlignment({
        mainDocument: runtimeState.files.mainDocument,
        pea: runtimeState.files.pea
      });

      runtimeState.analysis.pea = alignment;

      return {
        ok: true,
        alignment
      };
    } catch (error) {
      return safeError(error);
    }
  });

  ipcMain.handle('analysis:institutional-review', async () => {
    try {
      if (!runtimeState.files.mainDocument) {
        throw new Error('Carga primero el documento principal.');
      }

      const review = await runInstitutionalReview({
        mainDocument: runtimeState.files.mainDocument,
        pea: runtimeState.files.pea
      });

      if (review.exportPaths && review.exportPaths.html) {
        review.exportPaths.pdf = await exportHtmlToPdf(review.exportPaths.html);
      }

      runtimeState.analysis.report = review;
      runtimeState.analysis.pea = review.peaAlignment;
      runtimeState.analysis.rubric = review.rubricReview;

      return {
        ok: true,
        review
      };
    } catch (error) {
      return safeError(error);
    }
  });
}

module.exports = {
  registerIpcHandlers
};
