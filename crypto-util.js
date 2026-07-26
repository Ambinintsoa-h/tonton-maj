'use strict';
/**
 * ─────────────────────────────────────────────────────────────────────────────
 * crypto-util.js — Chiffrement symétrique au repos (AES-256-GCM)
 * ─────────────────────────────────────────────────────────────────────────────
 * Module racine partagé : utilisé par l'import de migration pour chiffrer les
 * Application Passwords WordPress, et par proxy.js (Phase 2) pour les déchiffrer
 * au moment de publier sur WordPress.
 *
 * Clé via .env : APP_ENCRYPTION_KEY = 32 octets, en base64 (44 car.) ou hex (64 car.).
 *   Générer : node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
 *
 * Format de sortie : "ivB64:tagB64:cipherB64" (IV 12 o, tag GCM 16 o).
 * ─────────────────────────────────────────────────────────────────────────────
 */

const crypto = require('crypto');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const ALGO = 'aes-256-gcm';

function getKey() {
  const raw = process.env.APP_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      '[crypto] APP_ENCRYPTION_KEY manquante dans .env (32 octets base64 ou hex). ' +
      'Générer : node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"'
    );
  }
  const key = /^[0-9a-fA-F]{64}$/.test(raw)
    ? Buffer.from(raw, 'hex')
    : Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error(`[crypto] APP_ENCRYPTION_KEY doit faire 32 octets (reçu ${key.length}).`);
  }
  return key;
}

// Chiffre une chaîne. Renvoie null pour une entrée vide/nulle (colonne NULL).
function encrypt(plain) {
  if (plain == null || plain === '') return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, getKey(), iv);
  const ct = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${tag.toString('base64')}:${ct.toString('base64')}`;
}

// Déchiffre une valeur produite par encrypt(). Renvoie null si entrée vide.
function decrypt(payload) {
  if (payload == null || payload === '') return null;
  const [ivB64, tagB64, ctB64] = String(payload).split(':');
  if (!ivB64 || !tagB64 || !ctB64) throw new Error('[crypto] format chiffré invalide');
  const decipher = crypto.createDecipheriv(ALGO, getKey(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  const pt = Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]);
  return pt.toString('utf8');
}

module.exports = { encrypt, decrypt };
