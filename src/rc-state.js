function createInitialState() {
  return {
    loadedAt: new Date().toISOString(),
    currentProject: null,
    files: {
      mainDocument: null,
      pea: null,
      rubric: null,
      formatBase: null
    },
    analysis: {
      documentType: 'desconocido',
      structure: null,
      pea: null,
      rubric: null,
      report: null
    }
  };
}

module.exports = {
  createInitialState
};
