'use strict';
/**
 * ─────────────────────────────────────────────────────────────────────────────
 * IMPORT PROFILS — fichiers data/profiles/*.json → colonnes users (lot 7b-3)
 * ─────────────────────────────────────────────────────────────────────────────
 * À LANCER SUR n0c (les profils vivent sur le serveur, pas dans le dépôt),
 * AVANT la bascule DATA_BACKEND=mysql.
 *
 * Pourquoi c'est nécessaire alors que nom/prénom/avatar sont déjà en base :
 * `PUT /api/account` synchronisait déjà firstName/lastName/avatarUrl vers la
 * collection Firestore `users` (pour la page Équipe) — ces champs ont donc suivi
 * l'import initial. En revanche l'EMAIL DE CONTACT saisi dans Mon Compte n'a
 * JAMAIS été synchronisé : il n'existait que dans le fichier. Sans ce script il
 * serait perdu à la bascule.
 *
 * Règle d'écriture (prudente, non destructive) :
 *   · data.profileEmail  → TOUJOURS écrit depuis le fichier (seule source).
 *   · first_name / last_name / avatar_url → écrits UNIQUEMENT si la colonne est
 *     vide en base, pour ne jamais écraser une valeur posée par un admin.
 *
 * ⚠️ users.email (identité de connexion, clé unique) n'est JAMAIS touché.
 *
 * Lancer :  node migration/import-profiles.js            (DRY-RUN : n'écrit rien)
 *           node migration/import-profiles.js --apply    (écrit réellement)
 *
 * Idempotent : relançable sans dégât.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const fs = require('fs');
const path = require('path');
const { getPool, closePool } = require('../db');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const PROFILES_DIR = path.join(__dirname, '..', 'data', 'profiles');
const APPLY = process.argv.includes('--apply');

const parseData = (v) => { try { return v ? (typeof v === 'string' ? JSON.parse(v) : v) : {}; } catch { return {}; } };

(async () => {
  if (!fs.existsSync(PROFILES_DIR)) {
    console.log(`[profils] Aucun dossier ${PROFILES_DIR} — rien à importer.`);
    return process.exit(0);
  }
  const files = fs.readdirSync(PROFILES_DIR).filter(f => f.endsWith('.json'));
  if (!files.length) {
    console.log('[profils] Aucun fichier profil — rien à importer.');
    return process.exit(0);
  }

  const pool = getPool();
  const [users] = await pool.query('SELECT uid, username, first_name, last_name, avatar_url, data FROM users');
  const byUsername = new Map(users.map(u => [String(u.username).toLowerCase(), u]));

  console.log(`[profils] ${files.length} fichier(s) trouvé(s). Mode : ${APPLY ? 'ÉCRITURE' : 'DRY-RUN (aucune écriture)'}\n`);
  const report = { updated: 0, orphans: [], emails: 0, filled: 0 };

  for (const file of files) {
    const username = path.basename(file, '.json');
    let d;
    try { d = JSON.parse(fs.readFileSync(path.join(PROFILES_DIR, file), 'utf8')); }
    catch (e) { console.log(`  ⚠ ${username.padEnd(20)} fichier illisible (${e.message}) — ignoré`); continue; }

    const row = byUsername.get(username.toLowerCase());
    if (!row) {
      report.orphans.push(username);
      console.log(`  ⚠ ${username.padEnd(20)} AUCUNE fiche users correspondante — NON importé`);
      continue;
    }

    const sets = [];
    const vals = [];
    const notes = [];

    // Email de contact : seule source = le fichier.
    if (d.email) {
      const data = parseData(row.data);
      if (data.profileEmail !== d.email) {
        data.profileEmail = d.email;
        sets.push('data=?'); vals.push(JSON.stringify(data));
        notes.push('email de contact');
        report.emails++;
      }
    }
    // Champs déjà synchronisés vers Firestore : on ne comble que les trous.
    if (d.prenom && !row.first_name) { sets.push('first_name=?'); vals.push(d.prenom); notes.push('prénom'); report.filled++; }
    if (d.nom    && !row.last_name)  { sets.push('last_name=?');  vals.push(d.nom);    notes.push('nom');    report.filled++; }
    if (d.avatarUrl && !row.avatar_url) { sets.push('avatar_url=?'); vals.push(d.avatarUrl); notes.push('avatar'); report.filled++; }

    if (!sets.length) { console.log(`  · ${username.padEnd(20)} déjà à jour`); continue; }
    console.log(`  ✓ ${username.padEnd(20)} → ${notes.join(', ')}`);

    if (APPLY) {
      sets.push('updated_at=?'); vals.push(Date.now());
      await pool.query(`UPDATE users SET ${sets.join(', ')} WHERE uid=?`, [...vals, row.uid]);
    }
    report.updated++;
  }

  console.log(`\n[profils] ${APPLY ? 'Mis à jour' : 'À mettre à jour'} : ${report.updated} compte(s) — ${report.emails} email(s) de contact, ${report.filled} champ(s) comblé(s)`);
  if (report.orphans.length) {
    console.log(`[profils] ⚠ ORPHELINS (${report.orphans.length}) : ${report.orphans.join(', ')}`);
    console.log('[profils]   → fichiers profil sans fiche users (comptes supprimés ?). Sans effet sur la bascule.');
  }
  if (!APPLY) console.log('\n[profils] DRY-RUN — relancer avec --apply pour écrire.');
  else console.log('\n[profils] ✅ Import terminé. (users.email jamais modifié.)');

  await closePool();
  process.exit(0);
})().catch(async (e) => {
  console.error('\n[profils] ❌ ÉCHEC :', e.message);
  try { await closePool(); } catch { /* noop */ }
  process.exit(1);
});
