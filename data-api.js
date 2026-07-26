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
const { encrypt, decrypt } = require('./crypto-util'); // jetons WP (chiffrés au repos)

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

  // ── wordpress_sites ───────────────────────────────────────────────────────────
  // Règle Firestore : lecture = authentifié ; écriture = admin|support.
  // app_password CHIFFRÉ au repos → déchiffré à la lecture (champ `password`).
  const wpWrite = requireRole('super_admin', 'manager', 'support');
  const safeDecrypt = (v) => { try { return decrypt(v) || ''; } catch { return ''; } };
  const wpToObj = (r) => ({
    id: r.id,
    ...parseJson(r.data, {}),
    ...(r.name != null ? { name: r.name } : {}),
    ...(r.url != null ? { url: r.url } : {}),
    ...(r.username != null ? { username: r.username } : {}),
    password: safeDecrypt(r.app_password),
    ...(r.fonts != null ? { fonts: parseJson(r.fonts, []) } : {}),
    ...(r.created_at != null ? { createdAt: r.created_at } : {}),
  });
  router.get('/wordpress-sites', requireAuth, wrap(async (_req, res) => {
    const [rows] = await q('SELECT * FROM wordpress_sites');
    res.json(rows.map(wpToObj));
  }));
  router.post('/wordpress-sites', requireAuth, wpWrite, wrap(async (req, res) => {
    const b = req.body || {};
    const id = b.id || genId();
    const name = b.name != null ? String(b.name) : null;
    const url = b.url != null ? String(b.url) : null;
    const username = b.username != null ? String(b.username) : null;
    const fonts = b.fonts != null ? asJson(b.fonts) : null;
    const data = asJson(omit(b, ['id', 'name', 'url', 'username', 'password', 'fonts', 'createdAt']));
    const appPwd = b.password ? encrypt(b.password) : null;
    if (b.id) {
      // On ne réécrit app_password que s'il est fourni (évite d'effacer le jeton
      // sur une édition partielle qui ne renvoie pas le mot de passe).
      if (appPwd != null) {
        await q('UPDATE wordpress_sites SET name=?, url=?, username=?, app_password=?, fonts=?, data=? WHERE id=?',
          [name, url, username, appPwd, fonts, data, id]);
      } else {
        await q('UPDATE wordpress_sites SET name=?, url=?, username=?, fonts=?, data=? WHERE id=?',
          [name, url, username, fonts, data, id]);
      }
    } else {
      await q('INSERT INTO wordpress_sites (id, name, url, username, app_password, fonts, created_at, data) VALUES (?,?,?,?,?,?,?,?)',
        [id, name, url, username, appPwd, fonts, Date.now(), data]);
    }
    res.json({ id });
  }));
  router.delete('/wordpress-sites/:id', requireAuth, wpWrite, wrap(async (req, res) => {
    await q('DELETE FROM wordpress_sites WHERE id=?', [req.params.id]);
    res.json({ ok: true });
  }));
  router.put('/wordpress-sites/:id/fonts', requireAuth, wpWrite, wrap(async (req, res) => {
    await q('UPDATE wordpress_sites SET fonts=? WHERE id=?', [asJson((req.body && req.body.fonts) || []), req.params.id]);
    res.json({ ok: true });
  }));

  // ── comment_ai (PK composite site_id/comment_id) ──────────────────────────────
  // Règle Firestore : lecture/écriture = admin|support. setDoc merge → lecture-fusion-écriture.
  const commentRole = requireRole('super_admin', 'manager', 'support');
  const commentAiCols = ['category', 'sentiment', 'priority', 'summary', 'draftReply'];
  const commentAiToObj = (r) => ({
    id: r.site_id + '__' + r.comment_id,
    siteId: r.site_id,
    commentId: r.comment_id,
    ...parseJson(r.data, {}),
    ...(r.category != null ? { category: r.category } : {}),
    ...(r.sentiment != null ? { sentiment: r.sentiment } : {}),
    ...(r.priority != null ? { priority: r.priority } : {}),
    ...(r.summary != null ? { summary: r.summary } : {}),
    ...(r.draft_reply != null ? { draftReply: r.draft_reply } : {}),
    ...(r.updated_at != null ? { updatedAt: r.updated_at } : {}),
  });
  router.get('/comment-ai', requireAuth, commentRole, wrap(async (req, res) => {
    if (!req.query.siteId) return res.json([]);
    const [rows] = await q('SELECT * FROM comment_ai WHERE site_id=?', [String(req.query.siteId)]);
    res.json(rows.map(commentAiToObj));
  }));
  router.post('/comment-ai', requireAuth, commentRole, wrap(async (req, res) => {
    const b = req.body || {};
    const siteId = String(b.siteId);
    const commentId = String(b.commentId);
    const [rows] = await q('SELECT * FROM comment_ai WHERE site_id=? AND comment_id=?', [siteId, commentId]);
    const existing = rows.length ? commentAiToObj(rows[0]) : {};
    const merged = { ...existing, ...omit(b, ['id']) };
    const data = asJson(omit(merged, ['id', 'siteId', 'commentId', 'updatedAt', ...commentAiCols]));
    await q(
      `INSERT INTO comment_ai (site_id, comment_id, category, sentiment, priority, summary, draft_reply, updated_at, data)
       VALUES (?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE category=VALUES(category), sentiment=VALUES(sentiment), priority=VALUES(priority),
         summary=VALUES(summary), draft_reply=VALUES(draft_reply), updated_at=VALUES(updated_at), data=VALUES(data)`,
      [siteId, commentId, merged.category ?? null, merged.sentiment ?? null, merged.priority ?? null,
       merged.summary ?? null, merged.draftReply ?? null, Date.now(), data]
    );
    res.json({ ok: true });
  }));

  // ── comment_settings (1 par site) ─────────────────────────────────────────────
  const commentSettingsToObj = (r) => ({
    id: r.site_id,
    siteId: r.site_id,
    ...parseJson(r.data, {}),
    ...(r.auto_spam != null ? { autoSpam: !!r.auto_spam } : {}),
    ...(r.updated_at != null ? { updatedAt: r.updated_at } : {}),
  });
  router.get('/comment-settings/:siteId', requireAuth, commentRole, wrap(async (req, res) => {
    const [rows] = await q('SELECT * FROM comment_settings WHERE site_id=?', [req.params.siteId]);
    res.json(rows.length ? commentSettingsToObj(rows[0]) : {});
  }));
  router.put('/comment-settings/:siteId', requireAuth, commentRole, wrap(async (req, res) => {
    const siteId = req.params.siteId;
    const [rows] = await q('SELECT * FROM comment_settings WHERE site_id=?', [siteId]);
    const existing = rows.length ? commentSettingsToObj(rows[0]) : {};
    const merged = { ...existing, ...(req.body || {}) };
    const autoSpam = merged.autoSpam ? 1 : 0;
    const data = asJson(omit(merged, ['id', 'siteId', 'autoSpam', 'updatedAt']));
    await q(`INSERT INTO comment_settings (site_id, auto_spam, updated_at, data) VALUES (?,?,?,?)
             ON DUPLICATE KEY UPDATE auto_spam=VALUES(auto_spam), updated_at=VALUES(updated_at), data=VALUES(data)`,
      [siteId, autoSpam, Date.now(), data]);
    res.json({ ok: true });
  }));

  // ── article_drafts (privé : clé = uid du JWT, jamais un id fourni par le client) ─
  router.get('/article-drafts', requireAuth, wrap(async (req, res) => {
    const [rows] = await q('SELECT draft FROM article_drafts WHERE user_id=?', [req.user.uid]);
    res.json(rows.length ? parseJson(rows[0].draft, null) : null);
  }));
  router.put('/article-drafts', requireAuth, wrap(async (req, res) => {
    await q(`INSERT INTO article_drafts (user_id, draft, updated_at) VALUES (?,?,?)
             ON DUPLICATE KEY UPDATE draft=VALUES(draft), updated_at=VALUES(updated_at)`,
      [req.user.uid, asJson(req.body || {}), Date.now()]);
    res.json({ ok: true });
  }));
  router.delete('/article-drafts', requireAuth, wrap(async (req, res) => {
    await q('DELETE FROM article_drafts WHERE user_id=?', [req.user.uid]);
    res.json({ ok: true });
  }));

  return router;
};
