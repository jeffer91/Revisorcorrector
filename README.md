# Migrador de Títulos

Aplicación local con un flujo único:

1. Seleccionar cualquiera de los Excel de la carpeta.
2. Pulsar **Analizar**.
3. Pulsar **Subir a Firestore**.

La aplicación detecta automáticamente el archivo que contiene las hojas `Envios`, `Resoluciones` y `Coordinadores`. El destino está fijado al proyecto `titulos-ec2fa`.

## Preparación única y segura

La configuración web de Firebase identifica el proyecto, pero no autoriza una migración administrativa. Descarga una clave privada desde:

`Firebase → Configuración del proyecto → Cuentas de servicio → Generar nueva clave privada`

Renombra el archivo como:

```text
firebase-admin.json
```

Colócalo en la misma carpeta que los Excel. La app lo detectará automáticamente y no mostrará campos adicionales.

## Ejecutar

```powershell
npm install
npm start
```

## Crear ejecutables de Windows

```powershell
npm run dist
```

## Colecciones

- `periodos`
- `carreras`
- `coordinadores`
- `envios`
- `envios/{id}/versiones`
- `envios/{id}/resoluciones`
- `configuracion`
- `migraciones`

La app no elimina documentos. Antes de actualizar envíos existentes genera un respaldo en `backups_migracion` junto al Excel.
