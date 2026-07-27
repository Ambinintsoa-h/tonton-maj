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

  // ── articles (+ verrou d'édition + SEO, tables filles) ────────────────────────
  // Règle Firestore : lecture ET écriture pour TOUT membre authentifié
  // (firestore.rules autorisait déjà l'écriture articles à tout membre connecté ;
  // le verrou d'édition est APPLICATIF). Donc requireAuth seul, aucun rôle.
  //
  // Modèle hybride : colonnes réelles (title/url/contenu/archivage/tri) + `data`
  // JSON (updates/audit/analysis/seoMeta/instruction/editedTitle/publishDate/…).
  // editingLock et seoTracking, sous-objets du doc Firestore, deviennent des
  // tables SÉPARÉES : un heartbeat (30 s) ou un snapshot SEO ne réécrit donc pas
  // l'article de ~200 Ko, et saveArticle (merge) ne peut plus les écraser.
  const LOCK_STALE_MS = 90_000;             // = LOCK_STALE_MS côté client (isLockActive)
  const DAY_MS = 24 * 60 * 60 * 1000;
  const MAX_INLINE = 800_000;               // filet taille HTML inline (idem firebase.js)

  // camelCase (métadonnée article) → colonne réelle. Le reste va dans `data`.
  const ART_COL = {
    title: 'title', url: 'url', archived: 'archived', archivedAt: 'archived_at',
    archivedBy: 'archived_by', lastModifiedAt: 'last_modified_at',
    lastModifiedBy: 'last_modified_by', assigneeId: 'assignee_id',
  };
  // Clés jamais rangées dans `data` (colonnes, contenu, horloge serveur, sous-tables,
  // vestiges Storage). id/createdAt/updatedAt gérés à part ; editingLock/seoTracking
  // vivent dans leurs propres tables ; *ContentUrl n'existent pas en mode MySQL.
  const ART_DATA_SKIP = [
    'id', 'title', 'url', 'originalContent', 'updatedContent', 'archived', 'archivedAt',
    'archivedBy', 'lastModifiedAt', 'lastModifiedBy', 'assigneeId', 'createdAt', 'updatedAt',
    'editingLock', 'seoTracking', 'originalContentUrl', 'updatedContentUrl',
  ];

  const lockToObj = (l) => ({ uid: l.uid, name: l.name || '', since: l.since, heartbeat: l.heartbeat });

  // Reconstitue le sous-objet seoTracking (forme Firestore) depuis la ligne
  // seo_tracking + ses snapshots (chaque snapshot = { type, capturedAt, ...data }).
  const seoTrackingToObj = (t, snaps) => ({
    enabled: !!t.enabled,
    keywords: parseJson(t.keywords, null),
    articleUrl: t.article_url || '',
    completed: !!t.completed,
    nextSnapshotType: t.next_snapshot_type,
    nextSnapshotAt: t.next_snapshot_at,
    ...(t.last_snapshot_at != null ? { lastSnapshotAt: t.last_snapshot_at } : {}),
    createdAt: t.created_at,
    snapshots: (snaps || []).map((s) => ({ type: s.type, capturedAt: s.captured_at, ...parseJson(s.data, {}) })),
  });

  // Reconstitue un article (forme Firestore camelCase). editingLock/seoTracking
  // sont greffés par l'appelant (getArticles) depuis leurs tables.
  const articleToObj = (r) => ({
    id: r.id,
    ...parseJson(r.data, {}),
    ...(r.title != null ? { title: r.title } : {}),
    ...(r.url != null ? { url: r.url } : {}),
    ...(r.original_content != null ? { originalContent: r.original_content } : {}),
    ...(r.updated_content != null ? { updatedContent: r.updated_content } : {}),
    archived: !!r.archived,
    ...(r.archived_at != null ? { archivedAt: r.archived_at } : {}),
    ...(r.archived_by != null ? { archivedBy: r.archived_by } : {}),
    ...(r.last_modified_at != null ? { lastModifiedAt: r.last_modified_at } : {}),
    ...(r.last_modified_by != null ? { lastModifiedBy: r.last_modified_by } : {}),
    ...(r.assignee_id != null ? { assigneeId: r.assignee_id } : {}),
    ...(r.created_at != null ? { createdAt: r.created_at } : {}),
    ...(r.updated_at != null ? { updatedAt: r.updated_at } : {}),
  });

  // GET /articles — équivaut à getDocs(collection('articles')) + tri client
  // max(lastModifiedAt,updatedAt,createdAt) desc (colonne générée sort_at).
  // Renvoie le contenu HTML inline (iso Firestore : les docs le portent déjà).
  // editingLock et seoTracking sont recollés pour que l'Historique retrouve les
  // badges verrou/SEO exactement comme avant (il les lit sur chaque article).
  router.get('/articles', requireAuth, wrap(async (_req, res) => {
    const [arts] = await q('SELECT * FROM articles ORDER BY sort_at DESC');
    const [locks] = await q('SELECT * FROM article_editing_locks');
    const [tracks] = await q('SELECT * FROM seo_tracking');
    const [snaps] = await q('SELECT * FROM seo_snapshots ORDER BY captured_at ASC');
    const lockBy = new Map(locks.map((l) => [l.article_id, l]));
    const trackBy = new Map(tracks.map((t) => [t.article_id, t]));
    const snapsBy = new Map();
    for (const s of snaps) {
      if (!snapsBy.has(s.article_id)) snapsBy.set(s.article_id, []);
      snapsBy.get(s.article_id).push(s);
    }
    res.json(arts.map((r) => {
      const o = articleToObj(r);
      const l = lockBy.get(r.id);
      if (l) o.editingLock = lockToObj(l);
      const t = trackBy.get(r.id);
      if (t) o.seoTracking = seoTrackingToObj(t, snapsBy.get(r.id));
      return o;
    }));
  }));

  // POST /articles — saveArticle. id fourni ⟹ upsert MERGE (préserve les champs
  // non transmis, ex. extraFields écrits par updateArticleHtml ; seoTracking/
  // editingLock sont hors table donc intouchables) + updated_at serveur. Sans id
  // ⟹ création avec created_at serveur. Retour { id, *ContentUrl:null } (pas de
  // Storage en MySQL — déjà null en prod Firestore Storage-off).
  router.post('/articles', requireAuth, wrap(async (req, res) => {
    const b = req.body || {};
    const now = Date.now();
    const { originalContent, updatedContent } = b;
    const origInline = originalContent != null ? String(originalContent) : null;
    const updInline = updatedContent != null ? String(updatedContent) : null;
    const colVal = (k) => {
      if (k === 'archived') return b.archived == null ? undefined : (b.archived ? 1 : 0);
      return k in b ? (b[k] != null ? (k === 'lastModifiedAt' || k === 'archivedAt' ? b[k] : String(b[k])) : null) : undefined;
    };

    if (b.id) {
      const id = String(b.id);
      const [rows] = await q('SELECT * FROM articles WHERE id=?', [id]);
      const existing = rows[0] || null;
      const existingData = existing ? parseJson(existing.data, {}) : {};
      const mergedData = { ...existingData, ...omit(b, ART_DATA_SKIP) };
      // Colonnes : valeur transmise sinon existant (sémantique merge).
      const sets = ['data=?', 'updated_at=?'];
      const args = [asJson(mergedData), now];
      for (const [k, col] of Object.entries(ART_COL)) {
        const v = colVal(k);
        if (v !== undefined) { sets.push(`${col}=?`); args.push(v); }
      }
      if (origInline != null) { sets.push('original_content=?'); args.push(origInline); }
      if (updInline != null) { sets.push('updated_content=?'); args.push(updInline); }
      if (existing) {
        args.push(id);
        await q(`UPDATE articles SET ${sets.join(', ')} WHERE id=?`, args);
      } else {
        // id fourni mais article absent (flux CQ : id issu du pending) → création.
        await q(
          `INSERT INTO articles (id, title, url, original_content, updated_content, archived,
             archived_at, archived_by, last_modified_at, last_modified_by, assignee_id, updated_at, data)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [id, colVal('title') ?? null, colVal('url') ?? null, origInline, updInline,
           colVal('archived') ?? 0, colVal('archivedAt') ?? null, colVal('archivedBy') ?? null,
           colVal('lastModifiedAt') ?? null, colVal('lastModifiedBy') ?? null,
           colVal('assigneeId') ?? null, now, asJson(mergedData)]);
      }
      return res.json({ id, originalContentUrl: null, updatedContentUrl: null });
    }

    // Sans id → nouvel article, created_at serveur.
    const id = genId();
    await q(
      `INSERT INTO articles (id, title, url, original_content, updated_content, archived,
         archived_at, archived_by, last_modified_at, last_modified_by, assignee_id, created_at, data)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, colVal('title') ?? null, colVal('url') ?? null, origInline, updInline,
       colVal('archived') ?? 0, colVal('archivedAt') ?? null, colVal('archivedBy') ?? null,
       colVal('lastModifiedAt') ?? null, colVal('lastModifiedBy') ?? null,
       colVal('assigneeId') ?? null, now, asJson(omit(b, ART_DATA_SKIP))]);
    res.json({ id, originalContentUrl: null, updatedContentUrl: null });
  }));

  // PUT /articles/:id/html — updateArticleHtml (autosave throttlé). Met à jour
  // updated_content + updated_at ; editorMeta → last_modified_* ; extraFields
  // (seoMeta/publishDate/instruction/editedTitle…) fusionnés dans les colonnes
  // connues sinon dans `data`. No-op silencieux si l'article n'existe pas
  // (best-effort ; localStorage reste le filet).
  router.put('/articles/:id/html', requireAuth, wrap(async (req, res) => {
    const id = req.params.id;
    const { updatedContent, editorMeta, extraFields } = req.body || {};
    if (!updatedContent) return res.json({ ok: true });
    const [rows] = await q('SELECT data FROM articles WHERE id=?', [id]);
    if (!rows.length) return res.json({ ok: true }); // updateDoc n'existe pas → no-op
    const sets = ['updated_at=?'];
    const args = [Date.now()];
    if (editorMeta && editorMeta.lastModifiedAt) {
      sets.push('last_modified_at=?', 'last_modified_by=?');
      args.push(editorMeta.lastModifiedAt, editorMeta.lastModifiedBy || '');
    }
    if (String(updatedContent).length <= MAX_INLINE) {
      sets.push('updated_content=?'); args.push(String(updatedContent));
    }
    if (extraFields && typeof extraFields === 'object') {
      const dataExtra = {};
      for (const [k, v] of Object.entries(extraFields)) {
        if (ART_COL[k]) {
          const col = ART_COL[k];
          sets.push(`${col}=?`);
          args.push(k === 'archived' ? (v ? 1 : 0) : (v != null ? v : null));
        } else {
          dataExtra[k] = v;
        }
      }
      if (Object.keys(dataExtra).length) {
        const merged = { ...parseJson(rows[0].data, {}), ...dataExtra };
        sets.push('data=?'); args.push(asJson(merged));
      }
    }
    args.push(id);
    await q(`UPDATE articles SET ${sets.join(', ')} WHERE id=?`, args);
    res.json({ ok: true });
  }));

  // DELETE /articles/:id — supprime l'article ET ses sous-tables (le doc Firestore
  // portait editingLock/seoTracking en sous-champs). article_time reste (collection
  // séparée, conservée comme sous Firestore).
  router.delete('/articles/:id', requireAuth, wrap(async (req, res) => {
    const id = req.params.id;
    await q('DELETE FROM article_editing_locks WHERE article_id=?', [id]);
    await q('DELETE FROM seo_snapshots WHERE article_id=?', [id]);
    await q('DELETE FROM seo_tracking WHERE article_id=?', [id]);
    await q('DELETE FROM articles WHERE id=?', [id]);
    res.json({ ok: true });
  }));

  // POST /articles/:id/archive — flag d'archivage (article conservé).
  router.post('/articles/:id/archive', requireAuth, wrap(async (req, res) => {
    await q('UPDATE articles SET archived=1, archived_at=?, archived_by=? WHERE id=?',
      [Date.now(), (req.body && req.body.archivedBy) || '', req.params.id]);
    res.json({ ok: true });
  }));

  // POST /articles/:id/restore — annule l'archivage (deleteField → NULL).
  router.post('/articles/:id/restore', requireAuth, wrap(async (req, res) => {
    await q('UPDATE articles SET archived=0, archived_at=NULL, archived_by=NULL WHERE id=?', [req.params.id]);
    res.json({ ok: true });
  }));

  // ── Verrou d'édition collaboratif ─────────────────────────────────────────────
  // POST /articles/:id/lock — acquireEditLock. Décision atomique par transaction
  // (SELECT … FOR UPDATE sérialise les acquéreurs concurrents), fidèle au read-
  // decide-write de Firestore : verrou pris si libre, périmé, déjà à moi, ou force.
  router.post('/articles/:id/lock', requireAuth, wrap(async (req, res) => {
    const id = req.params.id;
    const { uid, name, force } = req.body || {};
    if (!uid) return res.json({ ok: true, offline: true });
    const conn = await getPool().getConnection();
    try {
      await conn.beginTransaction();
      const [artRows] = await conn.query('SELECT 1 FROM articles WHERE id=? LIMIT 1', [id]);
      if (!artRows.length) { await conn.commit(); return res.json({ ok: true, missing: true }); }
      const [lockRows] = await conn.query('SELECT * FROM article_editing_locks WHERE article_id=? FOR UPDATE', [id]);
      const now = Date.now();
      const lock = lockRows[0] || null;
      const active = !!(lock && now - lock.heartbeat < LOCK_STALE_MS);
      if (active && lock.uid !== uid && !force) {
        await conn.commit();
        return res.json({ ok: false, lock: lockToObj(lock) });
      }
      const since = active && lock.uid === uid ? lock.since : now;
      await conn.query(
        `INSERT INTO article_editing_locks (article_id, uid, name, since, heartbeat) VALUES (?,?,?,?,?)
         ON DUPLICATE KEY UPDATE uid=VALUES(uid), name=VALUES(name), since=VALUES(since), heartbeat=VALUES(heartbeat)`,
        [id, uid, name || '', since, now]);
      await conn.commit();
      res.json({ ok: true });
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  }));

  // POST /articles/:id/lock/heartbeat — prolonge SI le verrou est encore à moi.
  router.post('/articles/:id/lock/heartbeat', requireAuth, wrap(async (req, res) => {
    const { uid } = req.body || {};
    if (uid) await q('UPDATE article_editing_locks SET heartbeat=? WHERE article_id=? AND uid=?',
      [Date.now(), req.params.id, uid]);
    res.json({ ok: true });
  }));

  // DELETE /articles/:id/lock — releaseEditLock (uniquement si à moi).
  router.delete('/articles/:id/lock', requireAuth, wrap(async (req, res) => {
    const { uid } = req.body || {};
    if (uid) await q('DELETE FROM article_editing_locks WHERE article_id=? AND uid=?', [req.params.id, uid]);
    res.json({ ok: true });
  }));

  // ── SEO (Haloscan) ────────────────────────────────────────────────────────────
  // POST /articles/:id/seo/init — initArticleSeoTracking. setDoc merge côté
  // Firestore crée le doc article s'il manque (item MAJ en attente J+0) → on
  // garantit une ligne articles (INSERT IGNORE) pour que getArticles le retrouve.
  router.post('/articles/:id/seo/init', requireAuth, wrap(async (req, res) => {
    const id = req.params.id;
    const { keywords, articleUrl } = req.body || {};
    const now = Date.now();
    await q('INSERT IGNORE INTO articles (id) VALUES (?)', [id]);
    await q(
      `INSERT INTO seo_tracking (article_id, enabled, keywords, article_url, completed,
         next_snapshot_type, next_snapshot_at, last_snapshot_at, created_at)
       VALUES (?,1,?,?,0,'after_7d',?,NULL,?)
       ON DUPLICATE KEY UPDATE enabled=VALUES(enabled), keywords=VALUES(keywords),
         article_url=VALUES(article_url), completed=VALUES(completed),
         next_snapshot_type=VALUES(next_snapshot_type), next_snapshot_at=VALUES(next_snapshot_at),
         created_at=VALUES(created_at)`,
      [id, asJson(keywords || null), articleUrl || '', now + 7 * DAY_MS, now]);
    res.json({ ok: true });
  }));

  // POST /articles/:id/seo/snapshot — saveSeoSnapshot. arrayUnion(snapshot) →
  // 1 ligne seo_snapshots (PK article_id+type) + maj de l'échéance suivante.
  router.post('/articles/:id/seo/snapshot', requireAuth, wrap(async (req, res) => {
    const id = req.params.id;
    const snapshot = req.body || {};
    const now = Date.now();
    const type = snapshot.type;
    const isLast = type === 'after_30d';
    const nextType = type === 'before' ? 'after_7d' : type === 'after_7d' ? 'after_30d' : null;
    const nextAt = type === 'before' ? now + 7 * DAY_MS
      : type === 'after_7d' ? now + 23 * DAY_MS
        : Number.MAX_SAFE_INTEGER;
    const conn = await getPool().getConnection();
    try {
      await conn.beginTransaction();
      await conn.query(
        `INSERT INTO seo_snapshots (article_id, type, captured_at, data) VALUES (?,?,?,?)
         ON DUPLICATE KEY UPDATE captured_at=VALUES(captured_at), data=VALUES(data)`,
        [id, String(type), snapshot.capturedAt || now, asJson(omit(snapshot, ['type', 'capturedAt']))]);
      await conn.query(
        `UPDATE seo_tracking SET last_snapshot_at=?, completed=?, next_snapshot_type=?, next_snapshot_at=? WHERE article_id=?`,
        [snapshot.capturedAt || now, isLast ? 1 : 0, nextType, nextAt, id]);
      await conn.commit();
      res.json({ ok: true });
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  }));

  // GET /articles/:id/seo — getArticleSeoTracking (ou null).
  router.get('/articles/:id/seo', requireAuth, wrap(async (req, res) => {
    const id = req.params.id;
    const [rows] = await q('SELECT * FROM seo_tracking WHERE article_id=?', [id]);
    if (!rows.length) return res.json(null);
    const [snaps] = await q('SELECT * FROM seo_snapshots WHERE article_id=? ORDER BY captured_at ASC', [id]);
    res.json(seoTrackingToObj(rows[0], snaps));
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

  // ── tickets + ticket_comments ────────────────────────────────────────────────
  // Règles Firestore rejouées : la LISTE des tickets est filtrée par rôle
  // (super_admin|manager|support voient tout via /api/admin/tickets ; cq_ia ne voit
  // que ses tickets, creatorId==uid). commentaires lisibles par tout membre
  // authentifié (règle permissive répliquée). Rôle/uid pris du JWT, jamais du client.
  const TICKET_COL = {
    creatorId: 'creator_id', creatorUsername: 'creator_username', creatorRole: 'creator_role',
    assigneeId: 'assignee_id', assigneeUsername: 'assignee_username', status: 'status',
    priority: 'priority', level: 'level', commentCount: 'comment_count', title: 'title',
    resolvedAt: 'resolved_at', closedAt: 'closed_at',
  };
  const TICKET_DATA_SKIP = ['id', 'createdAt', 'updatedAt', ...Object.keys(TICKET_COL)];
  const ADMIN_TICKET_ROLES = new Set(['super_admin', 'manager', 'support']);

  const ticketToObj = (r) => ({
    id: r.id,
    ...parseJson(r.data, {}),
    creatorId: r.creator_id,
    ...(r.creator_username != null ? { creatorUsername: r.creator_username } : {}),
    ...(r.creator_role != null ? { creatorRole: r.creator_role } : {}),
    ...(r.assignee_id != null ? { assigneeId: r.assignee_id } : {}),
    ...(r.assignee_username != null ? { assigneeUsername: r.assignee_username } : {}),
    status: r.status,
    ...(r.priority != null ? { priority: r.priority } : {}),
    ...(r.level != null ? { level: r.level } : {}),
    commentCount: r.comment_count,
    ...(r.title != null ? { title: r.title } : {}),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    resolvedAt: r.resolved_at,
    closedAt: r.closed_at,
  });
  const commentToObj = (r) => ({
    id: r.id,
    ticketId: r.ticket_id,
    ...(r.author_id != null ? { authorId: r.author_id } : {}),
    ...(r.author_username != null ? { authorUsername: r.author_username } : {}),
    ...(r.author_role != null ? { authorRole: r.author_role } : {}),
    ...(r.content != null ? { content: r.content } : {}),
    attachments: parseJson(r.attachments, []),
    ...(r.created_at != null ? { createdAt: r.created_at } : {}),
  });

  // GET /tickets — liste filtrée par rôle (JWT). Tri created_at desc (iso Firestore).
  router.get('/tickets', requireAuth, wrap(async (req, res) => {
    if (ADMIN_TICKET_ROLES.has(req.user.role)) {
      const [rows] = await q('SELECT * FROM tickets ORDER BY created_at DESC');
      return res.json(rows.map(ticketToObj));
    }
    // cq_ia (ou tout rôle non-admin) : seulement ses tickets. creator_id = uid || username.
    const ids = [req.user.uid, req.user.username].filter(Boolean);
    if (!ids.length) return res.json([]);
    const [rows] = await q(
      `SELECT * FROM tickets WHERE creator_id IN (${ids.map(() => '?').join(',')}) ORDER BY created_at DESC`, ids);
    res.json(rows.map(ticketToObj));
  }));

  // POST /tickets — createTicket. status='open', comment_count=0, horloge serveur.
  router.post('/tickets', requireAuth, wrap(async (req, res) => {
    const b = req.body || {};
    const id = genId();
    const now = Date.now();
    const v = (k) => (k in b && b[k] !== undefined ? b[k] : null);
    await q(
      `INSERT INTO tickets (id, creator_id, creator_username, creator_role, assignee_id, assignee_username,
         status, priority, level, comment_count, title, created_at, updated_at, resolved_at, closed_at, data)
       VALUES (?,?,?,?,?,?,'open',?,?,0,?,?,?,NULL,NULL,?)`,
      [id, b.creatorId || req.user.uid || req.user.username, v('creatorUsername'), v('creatorRole'),
       v('assigneeId'), v('assigneeUsername'), v('priority'), v('level'), v('title'),
       now, now, asJson(omit(b, TICKET_DATA_SKIP))]);
    res.json({ id });
  }));

  // PUT /tickets/:id — updateTicketDoc. Chaque champ → colonne connue sinon `data`
  // (fusion). updated_at serveur ; no-op silencieux si le ticket n'existe pas.
  router.put('/tickets/:id', requireAuth, wrap(async (req, res) => {
    const updates = req.body || {};
    const [rows] = await q('SELECT data FROM tickets WHERE id=?', [req.params.id]);
    if (!rows.length) return res.json({ ok: true }); // updateDoc n'existe pas → no-op
    const sets = ['updated_at=?'];
    const args = [Date.now()];
    const dataUpd = {};
    for (const [k, val] of Object.entries(updates)) {
      if (TICKET_COL[k]) { sets.push(`${TICKET_COL[k]}=?`); args.push(val); }
      else dataUpd[k] = val;
    }
    if (Object.keys(dataUpd).length) {
      sets.push('data=?'); args.push(asJson({ ...parseJson(rows[0].data, {}), ...dataUpd }));
    }
    args.push(req.params.id);
    await q(`UPDATE tickets SET ${sets.join(', ')} WHERE id=?`, args);
    res.json({ ok: true });
  }));

  // DELETE /tickets/:id — supprime le ticket (iso Firestore : les commentaires,
  // collection séparée, ne sont pas cascadés ; getComments les filtre par ticketId).
  router.delete('/tickets/:id', requireAuth, wrap(async (req, res) => {
    await q('DELETE FROM tickets WHERE id=?', [req.params.id]);
    res.json({ ok: true });
  }));

  // GET /tickets/:id/comments — getComments, tri created_at asc.
  router.get('/tickets/:id/comments', requireAuth, wrap(async (req, res) => {
    const [rows] = await q('SELECT * FROM ticket_comments WHERE ticket_id=? ORDER BY created_at ASC', [req.params.id]);
    res.json(rows.map(commentToObj));
  }));

  // POST /tickets/:id/comments — addComment : INSERT commentaire + increment ATOMIQUE
  // comment_count (+ maj statut optionnelle) en une transaction (= addDoc+updateDoc
  // parallèles côté Firestore, mais sans race sur le compteur).
  router.post('/tickets/:id/comments', requireAuth, wrap(async (req, res) => {
    const ticketId = req.params.id;
    const { comment = {}, statusUpdate = {} } = req.body || {};
    const id = genId();
    const now = Date.now();
    const conn = await getPool().getConnection();
    try {
      await conn.beginTransaction();
      await conn.query(
        `INSERT INTO ticket_comments (id, ticket_id, author_id, author_username, author_role, content, attachments, created_at)
         VALUES (?,?,?,?,?,?,?,?)`,
        [id, ticketId, comment.authorId ?? null, comment.authorUsername ?? null, comment.authorRole ?? null,
         comment.content ?? null, asJson(comment.attachments || []), now]);
      const sets = ['comment_count=comment_count+1', 'updated_at=?'];
      const args = [now];
      const dataUpd = {};
      for (const [k, val] of Object.entries(statusUpdate || {})) {
        if (TICKET_COL[k]) { sets.push(`${TICKET_COL[k]}=?`); args.push(val); }
        else dataUpd[k] = val;
      }
      if (Object.keys(dataUpd).length) {
        const [tr] = await conn.query('SELECT data FROM tickets WHERE id=?', [ticketId]);
        sets.push('data=?'); args.push(asJson({ ...(tr.length ? parseJson(tr[0].data, {}) : {}), ...dataUpd }));
      }
      args.push(ticketId);
      await conn.query(`UPDATE tickets SET ${sets.join(', ')} WHERE id=?`, args);
      await conn.commit();
      res.json({ id });
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  }));

  // PUT /ticket-comments/:commentId/attachments — updateCommentAttachments.
  router.put('/ticket-comments/:commentId/attachments', requireAuth, wrap(async (req, res) => {
    await q('UPDATE ticket_comments SET attachments=? WHERE id=?',
      [asJson((req.body && req.body.attachments) || []), req.params.commentId]);
    res.json({ ok: true });
  }));

  return router;
};
