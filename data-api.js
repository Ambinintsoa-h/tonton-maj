'use strict';
/**
 * ─────────────────────────────────────────────────────────────────────────────
 * data-api.js — Endpoints REST du backend MySQL (montés sous /api/data)
 * ─────────────────────────────────────────────────────────────────────────────
 * Rejoue, côté serveur, les accès données qui passaient par le SDK Firestore
 * client + les règles Firestore. Utilisé UNIQUEMENT quand DATA_BACKEND=mysql :
 * en mode firestore (défaut), ces routes existent mais ne sont jamais appelées,
 * et le pool MySQL n'est créé qu'à la PREMIÈRE requête réelle (getPool paresseux)
 * → le proxy démarre normalement même sans credentials DB.
 *
 * Modèle HYBRIDE : chaque ligne = colonnes réelles + colonne `data` (JSON) pour
 * le reste du document. Les helpers *ToObj/objToData reconstituent la forme
 * Firestore (camelCase) attendue par le client — signatures de firebase.mysql.js
 * inchangées.
 *
 * Étape 3 en cours : domaines simples d'abord (skills, knowledge, settings,
 * stats). Les autres suivront le même patron.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const express = require('express');
const crypto = require('crypto');
const { getPool } = require('./db');

const genId = () => crypto.randomUUID();

// Parse une colonne JSON (MariaDB la renvoie en string). Fallback si vide/illisible.
const parseJson = (v, fallback) => {
  if (v == null) return fallback;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return fallback; }
};
const asJson = (v) => (v == null ? null : JSON.stringify(v));

// Renvoie l'objet privé des clés extraites en colonnes → colonne `data`.
const omit = (obj, keys) => {
  const skip = new Set(keys);
  const out = {};
  for (const k of Object.keys(obj || {})) if (!skip.has(k)) out[k] = obj[k];
  return out;
};

module.exports = ({ requireAuth, requireRole }) => {
  const router = express.Router();

  // Pool PARESSEUX : jamais appelé tant qu'aucune route data n'est sollicitée.
  const q = (sql, params) => getPool().query(sql, params);

  const wrap = (fn) => (req, res) => fn(req, res).catch((e) => {
    console.error('[data-api]', req.method, req.originalUrl, '—', e.message);
    res.status(500).json({ error: 'Erreur base de données' });
  });

  // ── skills ──────────────────────────────────────────────────────────────────
  // Règle Firestore : lecture/écriture pour tout membre authentifié.
  const skillToObj = (r) => ({
    id: r.id,
    ...parseJson(r.data, {}),
    ...(r.name != null ? { name: r.name } : {}),
    ...(r.active != null ? { active: !!r.active } : {}),
    ...(r.created_at != null ? { createdAt: r.created_at } : {}),
    ...(r.updated_at != null ? { updatedAt: r.updated_at } : {}),
  });
  router.get('/skills', requireAuth, wrap(async (_req, res) => {
    const [rows] = await q('SELECT * FROM skills ORDER BY created_at DESC');
    res.json(rows.map(skillToObj));
  }));
  router.post('/skills', requireAuth, wrap(async (req, res) => {
    const b = req.body || {};
    const id = b.id || genId();
    const name = b.name != null ? String(b.name) : null;
    const active = b.active == null ? null : (b.active ? 1 : 0);
    const data = asJson(omit(b, ['id', 'name', 'active', 'createdAt', 'updatedAt']));
    if (b.id) {
      await q('UPDATE skills SET name=?, active=?, data=?, updated_at=? WHERE id=?',
        [name, active, data, Date.now(), id]);
    } else {
      await q('INSERT INTO skills (id, name, active, data, created_at) VALUES (?,?,?,?,?)',
        [id, name, active, data, Date.now()]);
    }
    res.json({ id });
  }));
  router.delete('/skills/:id', requireAuth, wrap(async (req, res) => {
    await q('DELETE FROM skills WHERE id=?', [req.params.id]);
    res.json({ ok: true });
  }));

  // ── knowledge ─────────────────────────────────────────────────────────────── (même patron)
  const knowledgeToObj = (r) => ({
    id: r.id,
    ...parseJson(r.data, {}),
    ...(r.title != null ? { title: r.title } : {}),
    ...(r.created_at != null ? { createdAt: r.created_at } : {}),
    ...(r.updated_at != null ? { updatedAt: r.updated_at } : {}),
  });
  router.get('/knowledge', requireAuth, wrap(async (_req, res) => {
    const [rows] = await q('SELECT * FROM knowledge ORDER BY created_at DESC');
    res.json(rows.map(knowledgeToObj));
  }));
  router.post('/knowledge', requireAuth, wrap(async (req, res) => {
    const b = req.body || {};
    const id = b.id || genId();
    const title = b.title != null ? String(b.title) : null;
    const data = asJson(omit(b, ['id', 'title', 'createdAt', 'updatedAt']));
    if (b.id) {
      await q('UPDATE knowledge SET title=?, data=?, updated_at=? WHERE id=?',
        [title, data, Date.now(), id]);
    } else {
      await q('INSERT INTO knowledge (id, title, data, created_at) VALUES (?,?,?,?)',
        [id, title, data, Date.now()]);
    }
    res.json({ id });
  }));
  router.delete('/knowledge/:id', requireAuth, wrap(async (req, res) => {
    await q('DELETE FROM knowledge WHERE id=?', [req.params.id]);
    res.json({ ok: true });
  }));

  // ── settings (singleton 'main') ───────────────────────────────────────────────
  // Règle Firestore : lecture = authentifié ; écriture = admin (super_admin|manager).
  // Les clés API restent STRIPPÉES (jamais persistées), comme dans firebase.js.
  const API_KEYS = ['anthropicKey', 'braveKey', 'tavilyKey', 'groqKey'];
  router.get('/settings', requireAuth, wrap(async (_req, res) => {
    const [rows] = await q("SELECT data FROM settings WHERE id='main'");
    res.json(rows.length ? parseJson(rows[0].data, {}) : {});
  }));
  router.put('/settings', requireAuth, requireRole('super_admin', 'manager'), wrap(async (req, res) => {
    const incoming = omit(req.body || {}, API_KEYS);
    const [rows] = await q("SELECT data FROM settings WHERE id='main'");
    const existing = rows.length ? parseJson(rows[0].data, {}) : {};
    const merged = { ...existing, ...incoming }; // setDoc merge
    await q("INSERT INTO settings (id, data, updated_at) VALUES ('main',?,?) ON DUPLICATE KEY UPDATE data=VALUES(data), updated_at=VALUES(updated_at)",
      [asJson(merged), Date.now()]);
    res.json({ ok: true });
  }));

  // ── stats (singleton 'main') ──────────────────────────────────────────────────
  const statsToObj = (r) => ({
    totalArticles: r.total_articles,
    totalInputTokens: r.total_input_tokens,
    totalOutputTokens: r.total_output_tokens,
    totalCostUsd: r.total_cost_usd != null ? Number(r.total_cost_usd) : 0,
    history: parseJson(r.history, []),
    updatedAt: r.updated_at,
  });
  router.get('/stats', requireAuth, wrap(async (_req, res) => {
    const [rows] = await q("SELECT * FROM stats WHERE id='main'");
    res.json(rows.length ? statsToObj(rows[0]) : null);
  }));
  router.put('/stats', requireAuth, wrap(async (req, res) => {
    const s = req.body || {};
    await q(
      `INSERT INTO stats (id, total_articles, total_input_tokens, total_output_tokens, total_cost_usd, history, updated_at)
       VALUES ('main',?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE total_articles=VALUES(total_articles), total_input_tokens=VALUES(total_input_tokens),
         total_output_tokens=VALUES(total_output_tokens), total_cost_usd=VALUES(total_cost_usd),
         history=VALUES(history), updated_at=VALUES(updated_at)`,
      [s.totalArticles || 0, s.totalInputTokens || 0, s.totalOutputTokens || 0, s.totalCostUsd || 0, asJson(s.history || []), Date.now()]
    );
    res.json({ ok: true });
  }));

  return router;
};
