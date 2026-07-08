const rcConfig = {
  appName: 'Revisorcorrector',
  stage: 'bloque-09-pdf-real-apertura-reportes',
  window: {
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 680
  },
  documentTypes: [
    'libro_asignatura',
    'guia_formacion_practica',
    'pea',
    'rubrica',
    'formato_base',
    'desconocido'
  ],
  supportedExtensions: ['docx', 'pdf', 'txt'],
  fileFilters: {
    allSupported: [
      { name: 'Documentos académicos', extensions: ['docx', 'pdf', 'txt'] },
      { name: 'Word', extensions: ['docx'] },
      { name: 'PDF', extensions: ['pdf'] },
      { name: 'Texto', extensions: ['txt'] }
    ]
  }
};

module.exports = {
  rcConfig
};
