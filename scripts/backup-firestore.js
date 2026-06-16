/**
 * Sauvegarde Firestore → fichier JSON (toutes les collections racine).
 *
 * Utilisé par le workflow .github/workflows/backup-firestore.yml.
 * Auth : compte de service Firebase fourni via la variable d'env
 * FIREBASE_SERVICE_ACCOUNT (contenu JSON de la clé).
 *
 * Sortie : backup/firestore-<stamp>.json  (stamp = $BACKUP_STAMP ou la date du jour)
 */
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!raw) {
  console.error('FIREBASE_SERVICE_ACCOUNT manquant.');
  process.exit(1);
}

let serviceAccount;
try {
  serviceAccount = JSON.parse(raw);
} catch (e) {
  console.error('FIREBASE_SERVICE_ACCOUNT invalide (JSON non parsable) :', e.message);
  process.exit(1);
}

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

(async () => {
  const dir = path.join(process.cwd(), 'backup');
  fs.mkdirSync(dir, { recursive: true });

  const stamp = process.env.BACKUP_STAMP || new Date().toISOString().slice(0, 10);
  const collections = await db.listCollections();

  const dump = {};
  let totalDocs = 0;
  for (const col of collections) {
    const snap = await col.get();
    dump[col.id] = snap.docs.map((d) => ({ id: d.id, data: d.data() }));
    totalDocs += snap.size;
    console.log(`  • ${col.id} : ${snap.size} documents`);
  }

  const meta = {
    exportedAt: new Date().toISOString(),
    project: serviceAccount.project_id || null,
    collections: Object.keys(dump),
    totalDocs,
  };

  const file = path.join(dir, `firestore-${stamp}.json`);
  fs.writeFileSync(file, JSON.stringify({ meta, data: dump }, null, 2), 'utf8');
  console.log(`Backup écrit : ${file} (${Object.keys(dump).length} collections, ${totalDocs} documents)`);
})().catch((e) => {
  console.error('Échec du backup :', e);
  process.exit(1);
});
