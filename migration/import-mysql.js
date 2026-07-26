'use strict';
/**
 * ─────────────────────────────────────────────────────────────────────────────
 * IMPORT MySQL/MariaDB direct (via mysql2) — pour une base JOIGNABLE
 * ─────────────────────────────────────────────────────────────────────────────
 * Charge les ~25 tables depuis l'export Firestore (voir transform.js pour l'ETL).
 * À utiliser quand on peut se connecter à la base (localhost / SSH sur n0c).
 * Pour un import MANUEL via phpMyAdmin, préférer `build-sql-dump.js` (génère un
 * fichier .sql à uploader — aucune connexion requise depuis le poste).
 *
 * Prérequis : schéma appliqué (schema-mysql-v1.sql) · .env (DB_* + APP_ENCRYPTION_KEY)
 *             · export présent (migration/export/*.json).
 * Lancer : node migration/import-mysql.js   (idempotent : TRUNCATE + INSERT)
 * ─────────────────────────────────────────────────────────────────────────────
 */

const { getPool, closePool } = require('../db');
const { buildTables } = require('./transform');

const CHUNK = 100;

async function reload(pool, table, columns, rows) {
  await pool.query(`TRUNCATE TABLE \`${table}\``);
  if (!rows.length) { console.log(`  ${table.padEnd(24)} 0`); return; }
  const cols = columns.map(c => `\`${c}\``).join(', ');
  for (let i = 0; i < rows.length; i += CHUNK) {
    await pool.query(`INSERT INTO \`${table}\` (${cols}) VALUES ?`, [rows.slice(i, i + CHUNK)]);
  }
  console.log(`  ${table.padEnd(24)} ${rows.length}`);
}

(async () => {
  const pool = getPool();

  const [csRows] = await pool.query("SHOW VARIABLES LIKE 'character_set_connection'");
  const cs = csRows[0] && csRows[0].Value;
  console.log(`[import] character_set_connection = ${cs}`);
  if (cs && !String(cs).startsWith('utf8mb4')) {
    throw new Error(`Connexion PAS en utf8mb4 (${cs}) — risque de corruption. Abandon.`);
  }
  console.log('[import] Rechargement complet (TRUNCATE + INSERT). Idempotent.\n');

  for (const { table, columns, rows } of buildTables()) {
    await reload(pool, table, columns, rows);
  }

  console.log('\n[import] ✅ Import terminé. (Mots de passe NON importés — reset forcé à la bascule.)');
  await closePool();
  process.exit(0);
})().catch(async (e) => {
  console.error('\n[import] ❌ ÉCHEC :', e.message);
  try { await closePool(); } catch { /* noop */ }
  process.exit(1);
});
