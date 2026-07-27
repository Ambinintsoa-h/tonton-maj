'use strict';
/**
 * ─────────────────────────────────────────────────────────────────────────────
 * IMPORT 2FA — fichiers data/2fa/*.json → table two_factor (lot 7b-2)
 * ─────────────────────────────────────────────────────────────────────────────
 * À LANCER SUR n0c (les fichiers 2FA vivent sur le serveur, pas dans le dépôt),
 * AVANT la bascule DATA_BACKEND=mysql. Sans cet import, un membre ayant activé
 * la 2FA se retrouverait sans secret en base : au mieux verrouillé, au pire
 * connecté SANS second facteur. C'est l'étape la plus sensible de la bascule.
 *
 * Prérequis : .env (DB_* + APP_ENCRYPTION_KEY) · migration/alter-2fa-secrets.sql
 *             appliqué · table users déjà peuplée (résolution username → uid).
 *
 * Lancer :  node migration/import-2fa.js            (DRY-RUN : n'écrit rien)
 *           node migration/import-2fa.js --apply    (écrit réellement)
 *
 * Idempotent : INSERT ... ON DUPLICATE KEY UPDATE, relançable sans dégât.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const fs = require('fs');
const path = require('path');
const { getPool, closePool } = require('../db');
const { encrypt } = require('../crypto-util');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const TFA_DIR = path.join(__dirname, '..', 'data', '2fa');
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const APPLY = process.argv.includes('--apply');

const COLS = ['enabled', 'method', 'totp_secret', 'email', 'email_code_hash', 'email_code_expiry',
  'pending_totp_secret', 'pending_email', 'pending_email_code', 'pending_email_expiry'];

// Même mapping que set2fa dans proxy.js — à garder synchronisé.
const toRow = (key, d) => [
  key,
  d.enabled ? 1 : 0,
  d.method || 'none',
  d.totpSecret ? encrypt(d.totpSecret) : null,
  d.email || null,
  d.emailCode || null,
  d.emailCodeExpiry || null,
  d.pendingTotpSecret ? encrypt(d.pendingTotpSecret) : null,
  d.pendingEmail || null,
  d.pendingEmailCode || null,
  d.pendingEmailExpiry || null,
];

(async () => {
  if (!fs.existsSync(TFA_DIR)) {
    console.log(`[2fa] Aucun dossier ${TFA_DIR} — rien à importer.`);
    return process.exit(0);
  }
  const files = fs.readdirSync(TFA_DIR).filter(f => f.endsWith('.json'));
  if (!files.length) {
    console.log('[2fa] Aucun fichier 2FA — rien à importer.');
    return process.exit(0);
  }

  const pool = getPool();
  const [users] = await pool.query('SELECT uid, username FROM users');
  const byUsername = new Map(users.map(u => [String(u.username).toLowerCase(), u.uid]));

  console.log(`[2fa] ${files.length} fichier(s) trouvé(s). Mode : ${APPLY ? 'ÉCRITURE' : 'DRY-RUN (aucune écriture)'}\n`);
  const report = { imported: 0, orphans: [], disabled: 0 };

  for (const file of files) {
    const username = path.basename(file, '.json');
    let d;
    try { d = JSON.parse(fs.readFileSync(path.join(TFA_DIR, file), 'utf8')); }
    catch (e) { console.log(`  ⚠ ${username.padEnd(20)} fichier illisible (${e.message}) — ignoré`); continue; }

    // Clé : uid de la fiche users ; `env:<username>` pour le break-glass .env.
    const uid = byUsername.get(username.toLowerCase());
    const key = uid || (username === ADMIN_USERNAME ? `env:${username}` : null);
    if (!key) {
      report.orphans.push(username);
      console.log(`  ⚠ ${username.padEnd(20)} AUCUNE fiche users correspondante — NON importé`);
      continue;
    }

    const state = d.enabled ? `2FA ${d.method}` : '2FA désactivée';
    if (!d.enabled) report.disabled++;
    console.log(`  ✓ ${username.padEnd(20)} → ${String(key).padEnd(30)} ${state}`);

    if (APPLY) {
      const row = toRow(key, d);
      await pool.query(
        `INSERT INTO two_factor (user_id, ${COLS.join(', ')}) VALUES (${Array(COLS.length + 1).fill('?').join(', ')})
         ON DUPLICATE KEY UPDATE ${COLS.map(c => `${c}=VALUES(${c})`).join(', ')}`, row);
    }
    report.imported++;
  }

  console.log(`\n[2fa] ${APPLY ? 'Importés' : 'À importer'} : ${report.imported} (dont ${report.disabled} avec 2FA désactivée)`);
  if (report.orphans.length) {
    console.log(`[2fa] ⚠ ORPHELINS (${report.orphans.length}) : ${report.orphans.join(', ')}`);
    console.log('[2fa]   → ces comptes n\'existent pas dans la table users. Vérifier AVANT la bascule :');
    console.log('[2fa]   un membre avec 2FA active mais sans ligne users ne pourra pas se connecter.');
  }
  if (!APPLY) console.log('\n[2fa] DRY-RUN — relancer avec --apply pour écrire.');
  else console.log('\n[2fa] ✅ Import terminé.');

  await closePool();
  process.exit(0);
})().catch(async (e) => {
  console.error('\n[2fa] ❌ ÉCHEC :', e.message);
  try { await closePool(); } catch { /* noop */ }
  process.exit(1);
});
