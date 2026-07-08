# Revisorcorrector

App de escritorio en modo Electron para revisar libros de asignatura y guías de formación práctica mediante estructura institucional, rúbricas, PEA y revisión asistida por IA.

## Estado del proyecto

Bloque 1 iniciado: base Electron y estructura principal del proyecto.

## Objetivo general

Construir una app local para cargar documentos académicos grandes, extraer su contenido, clasificarlos, analizarlos contra formatos institucionales y generar informes de revisión claros.

## Tipos de documentos previstos

- Libro de asignatura en Word.
- Guía de formación práctica en Word.
- PEA en Word o PDF.
- Rúbrica institucional en Word o PDF.
- Formato base institucional en Word o PDF.

## Bloques de desarrollo

1. Base Electron y estructura del proyecto.
2. Interfaz principal.
3. Carga y lectura de archivos.
4. Clasificador de documentos.
5. Motor de estructura institucional.
6. Motor PEA.
7. Motor IA y rúbrica.
8. Reportes, exportación y prueba real.

## Ejecutar en desarrollo

```bash
npm install
npm start
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

## Regla de mantenimiento

La app debe mantenerse potente, pero compacta. Ningún archivo debe crecer de forma innecesaria; si un archivo supera aproximadamente 700 líneas, se divide por responsabilidad.
