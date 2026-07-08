# Revisorcorrector

App de escritorio en modo Electron para revisar libros de asignatura y guías de formación práctica mediante estructura institucional, rúbricas, PEA y revisión asistida por IA.

## Estado del proyecto

Bloque 4 iniciado: clasificador automático de documentos conectado a la carga.

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
5. Motor de estructura institucional.
6. Motor PEA.
7. Motor IA y rúbrica.
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

## Regla de mantenimiento

La app debe mantenerse potente, pero compacta. Ningún archivo debe crecer de forma innecesaria; si un archivo supera aproximadamente 700 líneas, se divide por responsabilidad.
