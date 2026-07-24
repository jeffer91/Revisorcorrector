'use strict';

const fs = require('fs');
const path = require('path');
const Module = require('module');

const mainPath = path.join(__dirname, 'main.js');
let source = fs.readFileSync(mainPath, 'utf8');

const marker = "const migrationId = `MIG_${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`;";

if (!source.includes(marker)) {
  throw new Error('No se encontró la declaración migrationId en main.js.');
}

source = source.replace(
  marker,
  `${marker}\n  const migracionId = migrationId;`
);

const runtimeModule = new Module(mainPath, module);
runtimeModule.filename = mainPath;
runtimeModule.paths = Module._nodeModulePaths(path.dirname(mainPath));
runtimeModule._compile(source, mainPath);
