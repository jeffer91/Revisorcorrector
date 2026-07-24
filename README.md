# Migrador de Títulos

Aplicación local de escritorio para analizar un respaldo Excel, relacionar los envíos con la Firebase oficial de estudiantes y migrar la información propia de titulación hacia Cloud Firestore.

## Ejecutar

```powershell
npm install
npm start
```

## Crear instalador y versión portable

```powershell
npm run dist
```

Los ejecutables se generan en `dist`.

## Flujo

1. Seleccionar el respaldo Excel.
2. Configurar la Firebase de estudiantes y su cuenta de servicio.
3. Analizar, normalizar y revisar inconsistencias.
4. Seleccionar la cuenta de servicio del Firestore de destino.
5. Exportar el informe o ejecutar la migración.

La aplicación no guarda cuentas de servicio en el repositorio. Antes de escribir crea un respaldo local de los documentos `envios` que ya existan.

## Colecciones de destino

- `periodos`
- `coordinadores`
- `envios`
- `envios/{id}/versiones`
- `envios/{id}/resoluciones`
- `migraciones`
