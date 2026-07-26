'use strict';
/**
 * ─────────────────────────────────────────────────────────────────────────────
 * BUILD SQL DUMP — génère un fichier .sql prêt à importer via phpMyAdmin
 * ─────────────────────────────────────────────────────────────────────────────
 * Aucune connexion à la base requise : lit l'export Firestore, applique tout
 * l'ETL (transform.js) et écrit des INSERT prêts à l'emploi. Idéal pour un
 * import MANUEL (phpMyAdmin) sur une base non joignable depuis le poste.
 *
 * Prérequis : export présent (migration/export/*.json) + APP_ENCRYPTION_KEY (.env)
 *             pour chiffrer les jetons WordPress.
 * Lancer : node migration/build-sql-dump.js
 *
 * Sortie (migration/dump/, gitignoré) :
 *   - data.sql      : SET NAMES utf8mb4 + par table : TRUNCATE + INSERT (rejouable)
 *   - data.sql.gz   : même contenu gzippé (phpMyAdmin l'accepte — plus léger à uploader)
 *
 * Ordre d'import phpMyAdmin :
 *   1) migration/schema-mysql-v1.sql   (crée les tables — une seule fois)
 *   2) migration/dump/data.sql[.gz]    (charge les données — rejouable)
 * ─────────────────────────────────────────────────────────────────────────────
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { buildTables } = require('./transform');

const OUT_DIR = path.join(__dirname, 'dump');
const CHUNK = 100;

// Échappement MySQL d'une valeur (le seul point délicat d'un dump maison).
// Gère NULL, nombres et chaînes (quotes, backslash, caractères de contrôle).
// L'UTF-8/emoji passe tel quel (fichier écrit en utf8 + SET NAMES utf8mb4).
function esc(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  const str = String(v).replace(/[\0\b\t\n\r\x1a\\'"]/g, (c) => ({
    '\0': '\\0', '\b': '\\b', '\t': '\\t', '\n': '\\n', '\r': '\\r',
    '\x1a': '\\Z', '\\': '\\\\', "'": "\\'", '"': '\\"',
  }[c]));
  return `'${str}'`;
}

function insertStatements(table, columns, rows) {
  const cols = columns.map(c => `\`${c}\``).join(', ');
  const out = [];
  for (let i = 0; i < rows.length; i += CHUNK) {
    const values = rows.slice(i, i + CHUNK)
      .map(r => `(${r.map(esc).join(',')})`)
      .join(',\n');
    out.push(`INSERT INTO \`${table}\` (${cols}) VALUES\n${values};`);
  }
  return out.join('\n');
}

(() => {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const parts = [
    '-- ===================================================================',
    '-- TONTON AI — données Firestore -> MariaDB (import phpMyAdmin)',
    '-- Généré par migration/build-sql-dump.js — NE PAS committer (données réelles).',
    '-- Prérequis : importer d\'abord migration/schema-mysql-v1.sql (crée les tables).',
    '-- Rejouable : chaque table est vidée (TRUNCATE) puis rechargée (INSERT).',
    '-- ===================================================================',
    'SET NAMES utf8mb4;',
    'SET FOREIGN_KEY_CHECKS = 0;',
    '',
  ];

  let totalRows = 0;
  const summary = [];
  for (const { table, columns, rows } of buildTables()) {
    parts.push(`-- ${table} (${rows.length})`);
    parts.push(`TRUNCATE TABLE \`${table}\`;`);
    if (rows.length) parts.push(insertStatements(table, columns, rows));
    parts.push('');
    totalRows += rows.length;
    summary.push(`  ${table.padEnd(24)} ${rows.length}`);
  }

  parts.push('SET FOREIGN_KEY_CHECKS = 1;');
  const sql = parts.join('\n') + '\n';

  const sqlPath = path.join(OUT_DIR, 'data.sql');
  const gzPath  = path.join(OUT_DIR, 'data.sql.gz');
  fs.writeFileSync(sqlPath, sql, 'utf8');
  fs.writeFileSync(gzPath, zlib.gzipSync(Buffer.from(sql, 'utf8')));

  const mb = (p) => (fs.statSync(p).size / 1024 / 1024).toFixed(2);
  console.log('[dump] Lignes par table :');
  console.log(summary.join('\n'));
  console.log(`\n[dump] Total : ${totalRows} lignes`);
  console.log(`[dump] data.sql     ${mb(sqlPath)} Mo`);
  console.log(`[dump] data.sql.gz  ${mb(gzPath)} Mo  (à importer dans phpMyAdmin)`);
  console.log('\n[dump] ✅ Terminé. Importer dans phpMyAdmin : 1) schema-mysql-v1.sql  2) dump/data.sql.gz');
})();
