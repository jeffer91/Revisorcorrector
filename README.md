# Revisorcorrector

App de escritorio en modo Electron para revisar libros de asignatura y guías de formación práctica mediante estructura institucional, rúbricas, PEA y revisión asistida por IA.

## Estado del proyecto

Bloque 7 iniciado: motor de rúbrica e IA estructurada conectado a la revisión institucional.

## Objetivo general

Construir una app local para cargar documentos académicos grandes, extraer su contenido, clasificarlos, analizarlos contra formatos institucionales y generar informes de revisión claros.

## Tipos de documentos previstos

- Libro de asignatura en Word.
- Guía de formación práctica en Word.
- PEA en Word o PDF.
- Rúbrica institucional en Word o PDF.
- Formato base institucional en Word o PDF.

## Bloques de desarrollo

1. Base Electron y estructura del proyecto. Completado.
2. Interfaz principal. Completado en primera versión funcional.
3. Carga y lectura de archivos. Completado en primera versión funcional.
4. Clasificador de documentos. Completado en primera versión funcional.
5. Motor de estructura institucional. Completado en primera versión funcional.
6. Motor PEA. Completado en primera versión funcional.
7. Motor IA y rúbrica. Completado en primera versión funcional.
8. Reportes, exportación y prueba real.

## Ejecutar en desarrollo

```bash
npm install
npm start
```

Para verificar módulos principales:

```bash
npm run check
```

## Estructura inicial

```text
Revisorcorrector/
├─ electron/
├─ app/
├─ src/
├─ data/
├─ storage/
└─ assets/
```

## Interfaz principal

La interfaz incluye las siguientes vistas:

- Inicio.
- Carga.
- Análisis.
- Resultados.
- Informe.
- Ajustes.

La pantalla de carga permite seleccionar:

- Word principal del libro o guía.
- PEA.
- Rúbrica externa opcional.
- Formato base opcional.

## Lectura inicial de documentos

El Bloque 3 agrega lectura local para:

- `.docx` mediante Mammoth.
- `.pdf` mediante pdf-parse.
- `.txt` mediante lectura directa.

Cada documento cargado se copia en `storage/uploads` y se guarda una extracción JSON en `storage/extracted` con texto, vista previa, conteo de palabras, encabezados detectados, referencias candidatas, figuras y tablas.

## Clasificador de documentos

El Bloque 4 agrega clasificación automática por patrones académicos. La app intenta detectar:

- Libro de asignatura.
- Guía de formación práctica.
- PEA.
- Rúbrica.
- Formato base.
- Documento desconocido.

La clasificación devuelve tipo detectado, porcentaje de confianza, evidencias y validación contra el rol de carga elegido por el usuario.

## Motor de estructura institucional

El Bloque 5 agrega revisión estructural automática para libros y guías. El motor puede detectar:

- Secciones obligatorias faltantes.
- Secciones vacías o débiles.
- Unidades incompletas.
- Talleres incompletos.
- Proyecto Final incompleto.
- Referencias insuficientes.
- Glosario insuficiente.
- Duplicados de figuras y tablas.
- Riesgo estructural y puntaje interno sobre 100.

## Motor PEA

El Bloque 6 agrega comparación automática entre el documento principal y el PEA cargado. El motor extrae un perfil académico del PEA y compara:

- Contenidos del PEA frente al documento.
- Resultados de aprendizaje.
- Metodología esperada.
- Evaluación esperada.
- Cobertura, riesgo y puntaje de alineación sobre 100.

La comparación se ejecuta desde el botón Preparar revisión y guarda un respaldo JSON en `storage/reviews`.

## Motor IA y rúbrica

El Bloque 7 agrega el motor de revisión institucional por criterios A-F. La app calcula:

- A. Cumplimiento del formato institucional.
- B. Contenidos alineados al PEA actual.
- C. Calidad de la escritura y edición.
- D. Didáctica del contenido.
- E. Originalidad del texto y recursos.
- F. Referencias bibliográficas y citas APA 7.

Cada criterio recibe puntaje de 1 a 5, con total sobre 30. El estado final se clasifica como:

- 06 a 12: No aprobado.
- 13 a 27: Debe realizar modificaciones.
- 28 a 30: Aprobado sin modificaciones.

También se genera un contexto estructurado listo para integrarse con IA externa en una versión posterior, sin enviar documentos automáticamente a ningún proveedor.

## Regla de mantenimiento

La app debe mantenerse potente, pero compacta. Ningún archivo debe crecer de forma innecesaria; si un archivo supera aproximadamente 700 líneas, se divide por responsabilidad.
