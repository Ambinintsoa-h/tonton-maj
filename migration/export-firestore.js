/**
 * ─────────────────────────────────────────────────────────────────────────────
 * EXPORT FIRESTORE → JSON  (LECTURE SEULE — 100% NON DESTRUCTIF)
 * ─────────────────────────────────────────────────────────────────────────────
 * Étape 1 de la migration Firestore → MySQL/MariaDB.
 *
 * But : sortir un instantané fidèle de TOUTES les collections Firestore afin de
 *   (a) alimenter l'import MySQL (étape suivante) ;
 *   (b) INSPECTER les vraies formes de documents (champs réels, types mixtes,
 *       tailles) pour valider/ajuster le schéma hybride AVANT d'écrire l'import.
 *
 * Ce script NE FAIT QUE LIRE. Aucune écriture Firestore, aucune suppression.
 *
 * Sortie (dossier `migration/export/`, gitignoré — contient des données réelles
 * dont des jetons WordPress) :
 *   - <collection>.json  → tableau [{ id, ...data }] (streamé, sans surcharge mémoire)
 *   - _report.json       → statistiques par collection (champs/types/tailles) —
 *                          SANS valeurs (pas de fuite de données dans le rapport)
 *
 * Prérequis : data/firebase-service-account.json (la même clé que proxy.js), ou
 *   la variable d'env FIREBASE_SERVICE_ACCOUNT pointant vers un autre chemin.
 *
 * Usage :
 *   node migration/export-firestore.js
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ── Localisation de la clé de service (identique à proxy.js) ──────────────────
const SA_PATH = process.env.FIREBASE_SERVICE_ACCOUNT
  || path.join(__dirname, '..', 'data', 'firebase-service-account.json');

if (!fs.existsSync(SA_PATH)) {
  console.error(`[export] Clé de service introuvable : ${SA_PATH}`);
  console.error('[export] Placez data/firebase-service-account.json ou définissez FIREBASE_SERVICE_ACCOUNT.');
  process.exit(1);
}

let admin;
try {
  admin = require('firebase-admin');
} catch (e) {
  console.error('[export] Module firebase-admin absent. Lancez `npm install` d\'abord.', e.message);
  process.exit(1);
}

const sa = JSON.parse(fs.readFileSync(SA_PATH, 'utf8'));
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();
const FieldPath = admin.firestore.FieldPath;

const OUT_DIR = path.join(__dirname, 'export');
fs.mkdirSync(OUT_DIR, { recursive: true });

const BATCH = 400; // pagination par documentId — évite de tout charger en mémoire

// ── Normalisation d'une valeur Firestore vers du JSON simple ──────────────────
// - Timestamp Firestore → nombre de millisecondes (notre convention BIGINT ms).
// - DocumentReference   → { __ref: 'chemin' } (marqueur, peu probable ici).
// - GeoPoint            → { __geo: [lat, lng] } (marqueur, peu probable ici).
// - Récursif sur objets et tableaux (gère les Timestamps imbriqués).
function normalize(v) {
  if (v === null || typeof v !== 'object') return v;
  if (typeof v.toMillis === 'function') return v.toMillis();        // Timestamp
  if (Array.isArray(v)) return v.map(normalize);
  const ctor = v.constructor && v.constructor.name;
  if (ctor === 'DocumentReference') return { __ref: v.path };
  if (ctor === 'GeoPoint') return { __geo: [v.latitude, v.longitude] };
  const out = {};
  for (const k of Object.keys(v)) out[k] = normalize(v[k]);
  return out;
}

// ── Type "métier" d'une valeur, pour le rapport d'inspection ──────────────────
function typeOf(v) {
  if (v === null || v === undefined) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v; // string | number | boolean | object
}

// Un champ ressemble-t-il à un horodatage ? (piège ISO-string vs nombre ms)
const TS_RE = /(at|time|date|_at|_time|expiry|snapshotat)$/i;

// ── Export + inspection d'une collection ──────────────────────────────────────
async function exportCollection(colRef) {
  const name    = colRef.id;
  const outPath = path.join(OUT_DIR, `${name}.json`);
  const stream  = fs.createWriteStream(outPath, { encoding: 'utf8' });
  stream.write('[\n');

  const stat = {
    collection: name,
    docCount: 0,
    fields: {},                 // field -> { present, types: {t: n} }
    mixedTypeFields: [],        // rempli en fin de passe
    timestampSuspects: [],      // champs horodatage à types mixtes (ISO vs ms)
    size: { largestBytes: 0, over_900k: 0, over_1m: 0, totalBytes: 0 },
  };

  let first = true;
  let last  = null;

  // Pagination stable par documentId (aucun index composite requis)
  // eslint-disable-next-line no-constant-condition
  while (true) {
    let q = colRef.orderBy(FieldPath.documentId()).limit(BATCH);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) break;

    for (const doc of snap.docs) {
      const record = { id: doc.id, ...normalize(doc.data()) };
      const json   = JSON.stringify(record);
      const bytes  = Buffer.byteLength(json, 'utf8');

      // Écriture streamée (tableau JSON valide, sans tout garder en RAM)
      stream.write((first ? '' : ',\n') + json);
      first = false;

      // Stats de taille (les anciennes limites Firestore : 900k / 1Mo)
      stat.docCount++;
      stat.size.totalBytes += bytes;
      if (bytes > stat.size.largestBytes) stat.size.largestBytes = bytes;
      if (bytes > 900_000)   stat.size.over_900k++;
      if (bytes > 1_000_000) stat.size.over_1m++;

      // Stats de champs / types (profondeur 1 — suffit pour la modélisation)
      for (const [k, val] of Object.entries(record)) {
        const t = typeOf(val);
        const f = (stat.fields[k] ||= { present: 0, types: {} });
        f.present++;
        f.types[t] = (f.types[t] || 0) + 1;
      }
    }

    last = snap.docs[snap.docs.length - 1].id;
    if (snap.size < BATCH) break;
  }

  stream.write('\n]\n');
  await new Promise((res, rej) => stream.end(err => (err ? rej(err) : res())));

  // Post-traitement : champs à types mixtes (hors null) + suspects horodatage
  for (const [field, info] of Object.entries(stat.fields)) {
    const realTypes = Object.keys(info.types).filter(t => t !== 'null');
    if (realTypes.length > 1) {
      stat.mixedTypeFields.push({ field, types: info.types });
      if (TS_RE.test(field) && info.types.string && info.types.number) {
        stat.timestampSuspects.push({
          field, stringCount: info.types.string, numberCount: info.types.number,
        });
      }
    }
  }

  return stat;
}

(async () => {
  console.log(`[export] Projet : ${sa.project_id}`);
  console.log(`[export] Sortie : ${OUT_DIR}\n`);

  // Auto-découverte des collections racine (n'oublie aucune collection connue)
  const cols = await db.listCollections();
  if (!cols.length) {
    console.error('[export] Aucune collection racine détectée. Vérifiez la clé/le projet.');
    process.exit(1);
  }
  console.log(`[export] ${cols.length} collections : ${cols.map(c => c.id).join(', ')}\n`);

  const report = { projectId: sa.project_id, generatedAtMs: null, collections: [] };
  for (const col of cols) {
    process.stdout.write(`[export] ${col.id} … `);
    const stat = await exportCollection(col);
    report.collections.push(stat);
    console.log(
      `${stat.docCount} docs · plus gros ${(stat.size.largestBytes / 1024).toFixed(0)} Ko` +
      (stat.size.over_1m ? ` · ⚠ ${stat.size.over_1m} > 1 Mo` : '') +
      (stat.timestampSuspects.length ? ` · ⚠ ${stat.timestampSuspects.length} champ(s) date à types mixtes` : '')
    );
  }

  // Horodatage passé par argument (Date.now() interdit dans certains contextes) —
  // ici script CLI classique, on peut lire l'heure système directement.
  report.generatedAtMs = Date.now();
  fs.writeFileSync(path.join(OUT_DIR, '_report.json'), JSON.stringify(report, null, 2), 'utf8');

  // Récapitulatif des points d'attention pour la modélisation
  console.log('\n[export] ── Points d\'attention (à vérifier avant l\'import) ──');
  let flagged = 0;
  for (const c of report.collections) {
    if (c.timestampSuspects.length) {
      flagged++;
      console.log(`  • ${c.collection} : champ(s) date à NORMALISER (ISO string ↔ nombre ms) → ` +
        c.timestampSuspects.map(s => `${s.field} (${s.stringCount} str / ${s.numberCount} num)`).join(', '));
    }
    if (c.size.over_1m) {
      flagged++;
      console.log(`  • ${c.collection} : ${c.size.over_1m} doc(s) > 1 Mo (OK en MariaDB, packet 512 Mo)`);
    }
  }
  if (!flagged) console.log('  (aucun — données homogènes)');

  console.log(`\n[export] Terminé. Rapport détaillé : ${path.join(OUT_DIR, '_report.json')}`);
  process.exit(0);
})().catch(e => {
  console.error('\n[export] ÉCHEC :', e.message);
  process.exit(1);
});
