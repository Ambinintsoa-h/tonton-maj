'use strict';
/**
 * ─────────────────────────────────────────────────────────────────────────────
 * db.js — Pool de connexions MariaDB partagé (mysql2/promise)
 * ─────────────────────────────────────────────────────────────────────────────
 * Module racine (comme proxy.js) : réutilisé par le script d'import de migration
 * ET, en Phase 2, par proxy.js pour tous les endpoints.
 *
 * Credentials via .env (jamais dans data/settings.json, jamais committés) :
 *   DB_HOST (def. 127.0.0.1) · DB_PORT (def. 3306) · DB_USER · DB_PASSWORD ·
 *   DB_NAME · DB_POOL (def. 10)
 *
 * ⚠ La base serveur n0c est en latin1 : la connexion FORCE utf8mb4 (charset)
 *   pour ne pas corrompre le HTML des articles (emoji / caractères 4 octets).
 * ─────────────────────────────────────────────────────────────────────────────
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

let mysql;
try {
  mysql = require('mysql2/promise');
} catch (e) {
  console.error('[db] Module mysql2 introuvable — lancez `npm install`.');
  throw e;
}

let pool = null;

function getPool() {
  if (pool) return pool;

  const {
    DB_HOST = '127.0.0.1',
    DB_PORT = '3306',
    DB_USER,
    DB_PASSWORD,
    DB_NAME,
    DB_POOL = '10',
  } = process.env;

  if (!DB_USER || !DB_PASSWORD || !DB_NAME) {
    throw new Error('[db] Variables manquantes dans .env : DB_USER, DB_PASSWORD, DB_NAME');
  }

  pool = mysql.createPool({
    host: DB_HOST,
    port: Number(DB_PORT),
    user: DB_USER,
    password: DB_PASSWORD,
    database: DB_NAME,
    charset: 'utf8mb4',                       // ⚠ base en latin1 -> forcer utf8mb4 sur la connexion
    connectionLimit: Number(DB_POOL),         // max_user_connections = 60 sur n0c -> garder une marge
    waitForConnections: true,
    queueLimit: 0,
    supportBigNumbers: true,                  // timestamps BIGINT ms
    bigNumberStrings: false,
    multipleStatements: false,                // sécurité — requêtes séparées uniquement
  });

  return pool;
}

async function closePool() {
  if (pool) { await pool.end(); pool = null; }
}

module.exports = { getPool, closePool };
