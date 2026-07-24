'use strict';

const fs = require('fs');
const path = require('path');
const Module = require('module');

const bootstrapPath = path.join(__dirname, 'bootstrap.js');
let source = fs.readFileSync(bootstrapPath, 'utf8');

let corrections = 0;
source = source.replace(/^(\s*)migracionId(\s*,?)$/gm, (_match, indent, suffix) => {
  corrections += 1;
  return `${indent}migracionId: migrationId${suffix}`;
});

if (corrections === 0) {
  console.warn('[Migrador] No se encontraron identificadores abreviados de migración para corregir.');
} else {
  console.log(`[Migrador] Se corrigieron ${corrections} referencias de migracionId.`);
}

process.on('uncaughtException', (error) => {
  console.error('[Error no controlado]', error);
});

process.on('unhandledRejection', (error) => {
  console.error('[Promesa rechazada]', error);
});

const runtimeModule = new Module(bootstrapPath, module);
runtimeModule.filename = bootstrapPath;
runtimeModule.paths = Module._nodeModulePaths(path.dirname(bootstrapPath));
runtimeModule._compile(source, bootstrapPath);
