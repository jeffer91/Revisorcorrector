const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const admin = require('firebase-admin');
const { trim, cleanPath, cedulaVariants, mapLimit, serialize } = require('./normalize');

async function readCredential(filePath) {
  if (!filePath || !fs.existsSync(filePath)) throw new Error('No se encontró la credencial Firebase.');
  const credential = JSON.parse(await fsp.readFile(filePath, 'utf8'));
  if (!credential.project_id || !credential.client_email || !credential.private_key) throw new Error('El JSON no es una cuenta de servicio válida.');
  return credential;
}

async function connectSource(config) {
  const credential = await readCredential(config.sourceCredentialPath);
  const options = { credential: admin.credential.cert(credential) };
  if (config.sourceType === 'rtdb') options.databaseURL = trim(config.databaseUrl) || `https://${credential.project_id}-default-rtdb.firebaseio.com`;
  const app = admin.initializeApp(options, `source-${Date.now()}`);
  return { app, projectId: credential.project_id, db: config.sourceType === 'firestore' ? app.firestore() : app.database() };
}

async function connectTarget(credentialPath) {
  const credential = await readCredential(credentialPath);
  const app = admin.initializeApp({ credential: admin.credential.cert(credential) }, `target-${Date.now()}`);
  return { app, projectId: credential.project_id, db: app.firestore() };
}

async function findStudents(source, cedulas, config, progress) {
  const result = new Map();
  let done = 0;
  await mapLimit(cedulas, 8, async (cedula) => {
    const match = config.sourceType === 'firestore'
      ? await findFirestore(source.db, cedula, config)
      : await findRealtime(source.db, cedula, config);
    result.set(cedula, match);
    done += 1;
    progress('cross', 40 + (done / Math.max(cedulas.length, 1)) * 37, `Buscando estudiantes: ${done} de ${cedulas.length}`);
  });
  return result;
}

async function findFirestore(db, cedula, config) {
  const collection = db.collection(cleanPath(config.sourcePath));
  if (config.lookupMode === 'documentId') {
    for (const variant of cedulaVariants(cedula)) {
      const doc = await collection.doc(String(variant)).get();
      if (doc.exists) return { found: true, id: doc.id, data: doc.data() };
    }
  } else {
    for (const variant of cedulaVariants(cedula)) {
      const snapshot = await collection.where(trim(config.idField), '==', variant).limit(1).get();
      if (!snapshot.empty) return { found: true, id: snapshot.docs[0].id, data: snapshot.docs[0].data() };
    }
  }
  return { found: false, id: null, data: null };
}

async function findRealtime(db, cedula, config) {
  const ref = db.ref(cleanPath(config.sourcePath));
  if (config.lookupMode === 'documentId') {
    for (const variant of cedulaVariants(cedula)) {
      const snapshot = await ref.child(String(variant)).get();
      if (snapshot.exists()) return { found: true, id: snapshot.key, data: snapshot.val() };
    }
  } else {
    for (const variant of cedulaVariants(cedula)) {
      const snapshot = await ref.orderByChild(trim(config.idField)).equalTo(variant).limitToFirst(1).get();
      if (snapshot.exists()) {
        const [id, data] = Object.entries(snapshot.val())[0];
        return { found: true, id, data };
      }
    }
  }
  return { found: false, id: null, data: null };
}

async function backupExisting(db, records, backupDir, migrationId) {
  await fsp.mkdir(backupDir, { recursive: true });
  const existing = [];
  for (let i = 0; i < records.length; i += 100) {
    const docs = await db.getAll(...records.slice(i, i + 100).map((r) => db.collection('envios').doc(r.id)));
    docs.filter((doc) => doc.exists).forEach((doc) => existing.push({ id: doc.id, data: serialize(doc.data()) }));
  }
  const filePath = path.join(backupDir, `backup_${migrationId}.json`);
  await fsp.writeFile(filePath, JSON.stringify({ migrationId, createdAt:new Date().toISOString(), envios:existing }, null, 2));
  return filePath;
}

async function closeApp(firebaseApp) { if (firebaseApp) try { await firebaseApp.delete(); } catch {} }
module.exports = { connectSource, connectTarget, findStudents, backupExisting, closeApp };
