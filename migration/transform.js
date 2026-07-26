'use strict';
/**
 * ─────────────────────────────────────────────────────────────────────────────
 * transform.js — Brique ETL partagée (Firestore JSON -> lignes MySQL)
 * ─────────────────────────────────────────────────────────────────────────────
 * SOURCE UNIQUE de la logique de transformation. Utilisée par :
 *   - import-mysql.js       (INSERT direct via mysql2, sur une base joignable)
 *   - build-sql-dump.js     (génère un fichier .sql à importer via phpMyAdmin)
 *
 * buildTables() renvoie un tableau ordonné :
 *   [{ table, columns: [...], rows: [[...], ...] }, ...]
 *
 * Normalisations (validées sur l'export réel) :
 *   timestamps ISO/nombre -> ms · IDs numériques -> string · arrayUnion -> tables
 *   filles · editingLock/seoTracking -> tables dédiées · jetons WP chiffrés ·
 *   mots de passe NON importés (password_hash NULL) · firebaseConfig supprimé.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const fs = require('fs');
const path = require('path');
const { encrypt } = require('../crypto-util');

const EXPORT_DIR = path.join(__dirname, 'export');

function readCol(name) {
  const p = path.join(EXPORT_DIR, `${name}.json`);
  if (!fs.existsSync(p)) { console.warn(`  (${name}.json absent — ignoré)`); return []; }
  const arr = JSON.parse(fs.readFileSync(p, 'utf8'));
  return Array.isArray(arr) ? arr : [];
}

// ── Normalisations ────────────────────────────────────────────────────────────
function toMs(v) {                       // nombre ms | chaîne ISO -> ms | NULL
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
}
const bool = (v) => (v ? 1 : 0);
const s    = (v) => (v == null ? null : String(v));
const num  = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const j    = (v) => (v == null ? null : JSON.stringify(v));   // colonne JSON
function rest(obj, keys) {                                    // reste -> colonne data
  const skip = new Set(keys);
  const out = {};
  for (const k of Object.keys(obj)) if (!skip.has(k)) out[k] = obj[k];
  return Object.keys(out).length ? out : null;
}

function buildTables() {
  const tables = [];
  const add = (table, columns, rows) => tables.push({ table, columns, rows });

  // ── users (password_hash NULL : reset forcé) ────────────────────────────────
  add('users',
    ['uid', 'username', 'email', 'password_hash', 'password_algo', 'first_name',
     'last_name', 'role', 'status', 'avatar_url', 'note', 'created_at', 'updated_at', 'data'],
    readCol('users').map(d => {
      const uid = s(d.uid || d.id);
      const username = s(d.username) || (d.email ? String(d.email).split('@')[0] : uid);
      return [
        uid, username, s(d.email), null, 'bcrypt',
        s(d.firstName) || '', s(d.lastName) || '', s(d.role) || 'cq_ia', s(d.status) || 'active',
        d.avatarUrl != null ? s(d.avatarUrl) : null, d.note != null ? s(d.note) : null,
        toMs(d.createdAt), toMs(d.updatedAt),
        j(rest(d, ['id', 'uid', 'username', 'email', 'password', 'firstName', 'lastName',
                   'role', 'status', 'avatarUrl', 'note', 'createdAt', 'updatedAt'])),
      ];
    }));

  // ── articles (+ editing_locks, seo_tracking, seo_snapshots) ─────────────────
  {
    const A = [], L = [], T = [], S = [];
    const snapSeen = new Set();
    for (const d of readCol('articles')) {
      const id = s(d.id);
      A.push([
        id, d.title != null ? s(d.title) : null, d.url != null ? s(d.url) : null,
        d.originalContent != null ? String(d.originalContent) : null,
        d.updatedContent != null ? String(d.updatedContent) : null,
        bool(d.archived), toMs(d.archivedAt), d.archivedBy != null ? s(d.archivedBy) : null,
        toMs(d.lastModifiedAt), d.lastModifiedBy != null ? s(d.lastModifiedBy) : null,
        d.assigneeId != null ? s(d.assigneeId) : null, toMs(d.createdAt), toMs(d.updatedAt),
        j(rest(d, ['id', 'title', 'url', 'originalContent', 'updatedContent', 'archived',
                   'archivedAt', 'archivedBy', 'lastModifiedAt', 'lastModifiedBy', 'assigneeId',
                   'createdAt', 'updatedAt', 'editingLock', 'seoTracking'])),
      ]);
      const lk = d.editingLock;
      if (lk && lk.uid) L.push([id, s(lk.uid), s(lk.name) || '', toMs(lk.since) || 0, toMs(lk.heartbeat) || 0]);
      const st = d.seoTracking;
      if (st && typeof st === 'object') {
        T.push([
          id, bool(st.enabled), j(st.keywords || null), st.articleUrl != null ? s(st.articleUrl) : null,
          bool(st.completed), st.nextSnapshotType != null ? s(st.nextSnapshotType) : null,
          toMs(st.nextSnapshotAt), toMs(st.lastSnapshotAt), toMs(st.createdAt),
        ]);
        for (const snap of (Array.isArray(st.snapshots) ? st.snapshots : [])) {
          if (!snap || !snap.type) continue;
          const key = id + '|' + snap.type;
          if (snapSeen.has(key)) continue;
          snapSeen.add(key);
          S.push([id, s(snap.type), toMs(snap.capturedAt) || 0, j(rest(snap, ['type', 'capturedAt']))]);
        }
      }
    }
    add('articles',
      ['id', 'title', 'url', 'original_content', 'updated_content', 'archived', 'archived_at',
       'archived_by', 'last_modified_at', 'last_modified_by', 'assignee_id', 'created_at', 'updated_at', 'data'], A);
    add('article_editing_locks', ['article_id', 'uid', 'name', 'since', 'heartbeat'], L);
    add('seo_tracking',
      ['article_id', 'enabled', 'keywords', 'article_url', 'completed', 'next_snapshot_type',
       'next_snapshot_at', 'last_snapshot_at', 'created_at'], T);
    add('seo_snapshots', ['article_id', 'type', 'captured_at', 'data'], S);
  }

  // ── article_time ────────────────────────────────────────────────────────────
  add('article_time',
    ['article_id', 'user_id', 'user_name', 'user_role', 'title', 'url',
     'total_active_minutes', 'started_at', 'last_activity_at', 'published_at'],
    readCol('article_time').map(d => [
      s(d.articleId), s(d.userId), d.userName != null ? s(d.userName) : null,
      d.userRole != null ? s(d.userRole) : null, d.title != null ? s(d.title) : null,
      d.url != null ? s(d.url) : null, num(d.totalActiveMinutes),
      toMs(d.startedAt), toMs(d.lastActivityAt), toMs(d.publishedAt),
    ]));

  // ── article_drafts (draft complet en JSON, id = userId) ─────────────────────
  add('article_drafts', ['user_id', 'draft', 'updated_at'],
    readCol('article_drafts').map(d => [s(d.id), j(rest(d, ['id'])), toMs(d.savedAt)]));

  // ── pending ─────────────────────────────────────────────────────────────────
  add('pending', ['id', 'status', 'assignee_id', 'priority', 'title', 'url', 'added_at', 'created_at', 'data'],
    readCol('pending').map(d => [
      s(d.id), d.status != null ? s(d.status) : null, d.assigneeId != null ? s(d.assigneeId) : null,
      d.priority != null ? s(d.priority) : null, d.title != null ? s(d.title) : null,
      d.url != null ? s(d.url) : null, toMs(d.addedAt), toMs(d.createdAt),
      j(rest(d, ['id', 'status', 'assigneeId', 'priority', 'title', 'url', 'addedAt', 'createdAt'])),
    ]));

  // ── skills · knowledge ──────────────────────────────────────────────────────
  add('skills', ['id', 'name', 'active', 'created_at', 'updated_at', 'data'],
    readCol('skills').map(d => [
      s(d.id), d.name != null ? s(d.name) : null, d.active != null ? bool(d.active) : null,
      toMs(d.createdAt), toMs(d.updatedAt), j(rest(d, ['id', 'name', 'active', 'createdAt', 'updatedAt'])),
    ]));
  add('knowledge', ['id', 'title', 'created_at', 'updated_at', 'data'],
    readCol('knowledge').map(d => [
      s(d.id), d.title != null ? s(d.title) : null, toMs(d.createdAt), toMs(d.updatedAt),
      j(rest(d, ['id', 'title', 'createdAt', 'updatedAt'])),
    ]));

  // ── wordpress_sites (app_password chiffré) ──────────────────────────────────
  add('wordpress_sites', ['id', 'name', 'url', 'username', 'app_password', 'fonts', 'created_at', 'data'],
    readCol('wordpress_sites').map(d => [
      s(d.id), d.name != null ? s(d.name) : null, d.url != null ? s(d.url) : null,
      d.username != null ? s(d.username) : null, encrypt(d.password),
      j(d.fonts || null), toMs(d.createdAt),
      j(rest(d, ['id', 'name', 'url', 'username', 'password', 'fonts', 'createdAt'])),
    ]));

  // ── comment_ai (PK composite site_id/comment_id ; commentId -> string) ──────
  {
    const seen = new Set(), rows = [];
    for (const d of readCol('comment_ai')) {
      const site = s(d.siteId), cid = s(d.commentId), key = site + '|' + cid;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push([
        site, cid, d.category != null ? s(d.category) : null, d.sentiment != null ? s(d.sentiment) : null,
        d.priority != null ? s(d.priority) : null, d.summary != null ? s(d.summary) : null,
        d.draftReply != null ? s(d.draftReply) : null, toMs(d.updatedAt),
        j(rest(d, ['id', 'siteId', 'commentId', 'category', 'sentiment', 'priority', 'summary', 'draftReply', 'updatedAt'])),
      ]);
    }
    add('comment_ai',
      ['site_id', 'comment_id', 'category', 'sentiment', 'priority', 'summary', 'draft_reply', 'updated_at', 'data'], rows);
  }

  // ── comment_settings ────────────────────────────────────────────────────────
  add('comment_settings', ['site_id', 'auto_spam', 'updated_at', 'data'],
    readCol('comment_settings').map(d => [
      s(d.siteId || d.id), bool(d.autoSpam), toMs(d.updatedAt), j(rest(d, ['id', 'siteId', 'autoSpam', 'updatedAt'])),
    ]));

  // ── settings (firebaseConfig SUPPRIMÉ) ──────────────────────────────────────
  add('settings', ['id', 'data', 'updated_at'],
    readCol('settings').map(d => [s(d.id) || 'main', j(rest(d, ['id', 'firebaseConfig'])), toMs(d.updatedAt)]));

  // ── stats ───────────────────────────────────────────────────────────────────
  add('stats', ['id', 'total_articles', 'total_input_tokens', 'total_output_tokens', 'total_cost_usd', 'history', 'updated_at'],
    readCol('stats').map(d => [
      s(d.id) || 'main', num(d.totalArticles), num(d.totalInputTokens), num(d.totalOutputTokens),
      num(d.totalCostUsd), j(d.history || []), toMs(d.updatedAt),
    ]));

  // ── tickets ─────────────────────────────────────────────────────────────────
  add('tickets',
    ['id', 'creator_id', 'creator_username', 'creator_role', 'assignee_id', 'assignee_username',
     'status', 'priority', 'level', 'comment_count', 'title', 'created_at', 'updated_at', 'resolved_at', 'closed_at', 'data'],
    readCol('tickets').map(d => [
      s(d.id), s(d.creatorId), d.creatorUsername != null ? s(d.creatorUsername) : null,
      d.creatorRole != null ? s(d.creatorRole) : null, d.assigneeId != null ? s(d.assigneeId) : null,
      d.assigneeUsername != null ? s(d.assigneeUsername) : null, s(d.status) || 'open',
      d.priority != null ? s(d.priority) : null, d.level != null ? num(d.level) : null,
      num(d.commentCount), d.title != null ? s(d.title) : null,
      toMs(d.createdAt), toMs(d.updatedAt), toMs(d.resolvedAt), toMs(d.closedAt),
      j(rest(d, ['id', 'creatorId', 'creatorUsername', 'creatorRole', 'assigneeId', 'assigneeUsername',
                 'status', 'priority', 'level', 'commentCount', 'title', 'createdAt', 'updatedAt', 'resolvedAt', 'closedAt'])),
    ]));

  // ── ticket_comments ─────────────────────────────────────────────────────────
  add('ticket_comments',
    ['id', 'ticket_id', 'author_id', 'author_username', 'author_role', 'content', 'attachments', 'created_at'],
    readCol('ticket_comments').map(d => [
      s(d.id), s(d.ticketId), d.authorId != null ? s(d.authorId) : null,
      d.authorUsername != null ? s(d.authorUsername) : null, d.authorRole != null ? s(d.authorRole) : null,
      d.content != null ? s(d.content) : null, j(d.attachments || []), toMs(d.createdAt),
    ]));

  // ── notifications (read -> is_read) ─────────────────────────────────────────
  add('notifications', ['id', 'to_user_id', 'type', 'message', 'is_read', 'created_at', 'data'],
    readCol('notifications').map(d => [
      s(d.id), s(d.toUserId), d.type != null ? s(d.type) : null, d.message != null ? s(d.message) : null,
      bool(d.read), toMs(d.createdAt), j(rest(d, ['id', 'toUserId', 'type', 'message', 'read', 'createdAt'])),
    ]));

  // ── activity_sessions (+ hourly, connections, pauses, closes) ───────────────
  {
    const Se = [], H = [], C = [], P = [], Cl = [];
    for (const d of readCol('activity_sessions')) {
      const uid = s(d.userId), date = s(d.date), a = d.actions || {};
      Se.push([
        uid, date, d.userRole != null ? s(d.userRole) : null, d.userName != null ? s(d.userName) : null,
        toMs(d.firstActivityAt), toMs(d.lastActivityAt), num(d.totalActiveMinutes),
        num(a.articlesUpdated), num(a.ticketsCreated), num(a.ticketsCommented), num(a.ticketsResolved), num(a.total),
      ]);
      for (const [h, c] of Object.entries(d.hourlyActivity || {})) {
        const hn = Number(h);
        if (Number.isInteger(hn) && hn >= 0 && hn <= 23) H.push([uid, date, hn, num(c)]);
      }
      for (const c of (Array.isArray(d.connections) ? d.connections : [])) {
        const at = toMs(c && c.at); if (at != null) C.push([uid, date, at]);
      }
      for (const p of (Array.isArray(d.pauses) ? d.pauses : [])) {
        const st = toMs(p && p.start), en = toMs(p && p.end);
        if (st != null && en != null) P.push([uid, date, st, en]);
      }
      for (const t of (Array.isArray(d.closes) ? d.closes : [])) {
        const ct = toMs(t); if (ct != null) Cl.push([uid, date, ct]);
      }
    }
    add('activity_sessions',
      ['user_id', 'date', 'user_role', 'user_name', 'first_activity_at', 'last_activity_at', 'total_active_minutes',
       'actions_articles_updated', 'actions_tickets_created', 'actions_tickets_commented',
       'actions_tickets_resolved', 'actions_total'], Se);
    add('activity_hourly', ['user_id', 'date', 'hour', 'activity_count'], H);
    add('activity_connections', ['user_id', 'date', 'connected_at'], C);
    add('activity_pauses', ['user_id', 'date', 'pause_start', 'pause_end'], P);
    add('activity_closes', ['user_id', 'date', 'close_time'], Cl);
  }

  return tables;
}

module.exports = { buildTables };
