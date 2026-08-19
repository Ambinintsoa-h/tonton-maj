// ─────────────────────────────────────────────────────────────────────────────
// firebase.mysql.js — impl. MySQL de la façade (via endpoints proxy /api/data)
// ─────────────────────────────────────────────────────────────────────────────
// Utilisée UNIQUEMENT quand DATA_BACKEND=mysql (voir firebase.js / backendMode.js).
// Mêmes signatures que l'impl. Firestore ; les fonctions non encore portées lèvent
// une erreur claire (NI) — un flip vers mysql avant qu'un domaine soit prêt échoue
// fort, pas en silence.
//
// ⚠️ MAINTENUE À LA MAIN. Doit exporter EXACTEMENT les 65 fonctions aiguillées.
//
// Étape 3 — domaines portés : skills, knowledge, settings, stats,
//   wordpress_sites, comment_ai, comment_settings, article_drafts.
// ─────────────────────────────────────────────────────────────────────────────

'use strict';
// ── 401 : LA SESSION A EXPIRÉ, ET ÇA SE DIT ─────────────────────────────────
// Cette couche ne faisait RIEN du 401, contrairement à l'intercepteur axios. Le
// magasin restait vide, l'écran annonçait « Aucun skill cerveau actif » — un
// message FAUX — et les sondages bouclaient. Voir sessionExpiry.js pour le détail.
import { signalSessionExpired, isSessionExpired } from './sessionExpiry';

const NI = (name) => { throw new Error(`[mysql] ${name} — endpoint pas encore implémenté (backend MySQL en construction)`); };


const authToken = () => sessionStorage.getItem('tonton_auth_token');

// Appel générique aux endpoints /api/data (JWT interne en Authorization).
const api = async (method, path, body) => {
  const res = await fetch('/api/data' + path, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(authToken() ? { Authorization: `Bearer ${authToken()}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  // 401 = jeton mort. On le SIGNALE (bandeau + arrêt des sondages) avant de lever,
  // sinon l'appelant ne voit qu'une erreur HTTP anonyme et l'utilisateur, rien.
  if (res.status === 401) {
    signalSessionExpired();
    throw new Error(`[mysql] ${method} ${path} → session expirée (401)`);
  }
  if (!res.ok) throw new Error(`[mysql] ${method} ${path} → HTTP ${res.status}`);
  if (res.status === 204) return null;
  const ct = res.headers.get('content-type') || '';
  return ct.includes('application/json') ? res.json() : null;
};

const enc = encodeURIComponent;

// ── Polling (remplace les listeners temps réel Firestore onSnapshot) ──────────
// Interroge un endpoint GET à intervalle régulier et invoque callback(data) à
// chaque CHANGEMENT. Fidèle au contrat onSnapshot : 1er appel immédiat (état
// initial), retourne une fonction de désabonnement.
//   • ETag/304 : envoie If-None-Match ; un 304 = inchangé, on n'appelle pas callback.
//   • Garde anti-re-render : même si le 304 est défait (cache navigateur), on
//     compare le corps brut et on ignore les réponses identiques.
//   • Pause quand l'onglet est caché (document.hidden) ; reprise immédiate au retour.
const pollUrl = (path, callback, intervalMs, { onError } = {}) => {
  let stopped = false;
  let etag = null;
  let lastBody = null;
  const fetchOnce = async (force) => {
    if (stopped) return;
    // Session déjà expirée : on n'interroge plus. Sans cette garde, chaque sondage
    // repartait toutes les N secondes avec un jeton mort — le serveur répondait 401
    // en boucle, et le journal se remplissait pour rien.
    if (isSessionExpired()) { stopped = true; return; }
    if (!force && typeof document !== 'undefined' && document.hidden) return; // pause onglet caché
    try {
      const res = await fetch('/api/data' + path, {
        cache: 'no-store',
        headers: {
          ...(authToken() ? { Authorization: `Bearer ${authToken()}` } : {}),
          ...(etag ? { 'If-None-Match': etag } : {}),
        },
      });
      if (stopped) return;
      if (res.status === 304) return;            // inchangé
      if (res.status === 401) {
        // Un sondage qui tombe sur un 401 ARRÊTE le sondage : le laisser tourner
        // n'apporterait rien et masquerait le vrai problème derrière du bruit.
        signalSessionExpired();
        stopped = true;
        if (onError) onError(new Error(`[mysql] poll ${path} → session expirée (401)`));
        return;
      }
      if (!res.ok) { if (onError) onError(new Error(`[mysql] poll ${path} → HTTP ${res.status}`)); return; }
      etag = res.headers.get('ETag') || etag;
      const text = await res.text();
      if (text === lastBody) return;             // identique → pas de re-render
      lastBody = text;
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch { return; }
      if (!stopped) callback(data);
    } catch (e) { if (onError) onError(e); }
  };
  fetchOnce(true);                               // état initial (même onglet caché)
  const timer = setInterval(() => fetchOnce(false), intervalMs);
  const onVis = () => { if (typeof document !== 'undefined' && !document.hidden) fetchOnce(false); };
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVis);
  return () => {
    stopped = true;
    clearInterval(timer);
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVis);
  };
};

// Allège un item de file avant persistance (iso firebase.firestore.js) : le HTML
// complet de majResult (avant/après) est déjà archivé dans articles/{id} — on ne
// le duplique pas dans la file (contentInHistory:true → la review le re-fetch).
const slimPendingItem = (item) => {
  if (!item || !item.majResult) return { ...item };
  const { originalContent, updatedContent, ...rest } = item.majResult;
  let slim = { ...item, majResult: { ...rest, contentInHistory: true } };
  for (const heavy of ['audit', 'analysis', 'updates', 'sources']) {
    let size;
    try { size = JSON.stringify(slim).length; } catch { break; }
    if (size <= 900000) break;
    slim = { ...slim, majResult: { ...slim.majResult, [heavy]: null } };
  }
  return slim;
};

// Date locale utilisateur 'YYYY-MM-DD' (jamais serveur — cf. getTodayActivitySessions).
const _localDate = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// ── Domaines portés ───────────────────────────────────────────────────────────

// skills
export const getSkills = () => api('GET', '/skills');
export const saveSkill = (skill) => api('POST', '/skills', skill).then((r) => r.id);
export const deleteSkill = (id) => api('DELETE', '/skills/' + enc(id));

// knowledge
export const getKnowledge = () => api('GET', '/knowledge');
export const saveKnowledge = (item) => api('POST', '/knowledge', item).then((r) => r.id);
export const deleteKnowledge = (id) => api('DELETE', '/knowledge/' + enc(id));

// settings (singleton)
export const getSettings = () => api('GET', '/settings');
export const saveSettings = (settings) => api('PUT', '/settings', settings);

// stats (singleton)
export const getStats = () => api('GET', '/stats');
export const saveStats = (stats) => api('PUT', '/stats', stats);

// wordpress_sites (le champ `password` = jeton WP, déchiffré côté serveur à la lecture)
export const getWordPressSites = () => api('GET', '/wordpress-sites');
export const saveWordPressSite = (site) => api('POST', '/wordpress-sites', site).then((r) => r.id);
export const deleteWordPressSite = (id) => api('DELETE', '/wordpress-sites/' + enc(id));
export const saveSiteFonts = (siteId, fonts) => api('PUT', '/wordpress-sites/' + enc(siteId) + '/fonts', { fonts });

// comment_ai / comment_settings
export const getCommentAi = (siteId) => api('GET', '/comment-ai?siteId=' + enc(siteId));
export const saveCommentAi = (siteId, commentId, data) => api('POST', '/comment-ai', { siteId, commentId, ...data });
export const getCommentSettings = (siteId) => api('GET', '/comment-settings/' + enc(siteId));
export const saveCommentSettings = (siteId, data) => api('PUT', '/comment-settings/' + enc(siteId), data);

// article_drafts (clé = uid du JWT côté serveur ; le userId passé est ignoré)
export const saveArticleDraftRemote = (userId, draft) => api('PUT', '/article-drafts', draft);
export const getArticleDraftRemote = () => api('GET', '/article-drafts');
export const deleteArticleDraftRemote = () => api('DELETE', '/article-drafts');

// ── articles (+ verrou d'édition + SEO) ───────────────────────────────────────
// getArticles renvoie le contenu inline + editingLock/seoTracking greffés
// (l'Historique lit ces sous-objets sur chaque article). saveArticle retourne
// { id, originalContentUrl, updatedContentUrl } (URLs null : pas de Storage).
export const getArticles = () => api('GET', '/articles');

// UN seul article. Évite de charger la collection entière — avec tout le HTML de
// chaque article — quand on n'en veut qu'un (réouverture d'une review).
export const getArticle = (id) => api('GET', `/articles/${enc(id)}`);
export const saveArticle = (article) => api('POST', '/articles', article);
export const updateArticleHtml = (articleId, updatedContent, editorMeta = null, extraFields = null) =>
  api('PUT', '/articles/' + enc(articleId) + '/html', { updatedContent, editorMeta, extraFields });
export const deleteArticle = (id) => api('DELETE', '/articles/' + enc(id));
export const archiveArticle = (id, archivedBy = '') => api('POST', '/articles/' + enc(id) + '/archive', { archivedBy });
export const restoreArticle = (id) => api('POST', '/articles/' + enc(id) + '/restore');

// Verrou d'édition collaboratif (décision atomique côté serveur).
export const acquireEditLock = (articleId, { uid, name }, { force = false } = {}) =>
  api('POST', '/articles/' + enc(articleId) + '/lock', { uid, name, force });
export const heartbeatEditLock = (articleId, uid) =>
  api('POST', '/articles/' + enc(articleId) + '/lock/heartbeat', { uid });
export const releaseEditLock = (articleId, uid) =>
  api('DELETE', '/articles/' + enc(articleId) + '/lock', { uid });

// SEO Haloscan (tracking J+0 / J+7 / J+30).
export const initArticleSeoTracking = (articleId, { keywords, articleUrl }) =>
  api('POST', '/articles/' + enc(articleId) + '/seo/init', { keywords, articleUrl });
export const saveSeoSnapshot = (articleId, snapshot) =>
  api('POST', '/articles/' + enc(articleId) + '/seo/snapshot', snapshot);
export const getArticleSeoTracking = (articleId) =>
  api('GET', '/articles/' + enc(articleId) + '/seo');

// ── tickets + ticket_comments ─────────────────────────────────────────────────
// getTickets : le serveur filtre par rôle (JWT) — les args userId/role sont
// ignorés côté serveur (jamais de rôle client de confiance). addComment fait
// l'increment atomique de commentCount côté serveur.
export const getTickets = (/* userId, role */) => api('GET', '/tickets');
export const createTicket = (ticket) => api('POST', '/tickets', ticket).then((r) => r.id);
export const updateTicketDoc = (ticketId, updates) => api('PUT', '/tickets/' + enc(ticketId), updates);
export const deleteTicketDoc = (ticketId) => api('DELETE', '/tickets/' + enc(ticketId));
export const getComments = (ticketId) => api('GET', '/tickets/' + enc(ticketId) + '/comments');
export const addComment = (comment, ticketStatusUpdate = {}) =>
  api('POST', '/tickets/' + enc(comment.ticketId) + '/comments', { comment, statusUpdate: ticketStatusUpdate }).then((r) => r.id);
export const updateCommentAttachments = (commentId, attachments) =>
  api('PUT', '/ticket-comments/' + enc(commentId) + '/attachments', { attachments });

// ── notifications ─────────────────────────────────────────────────────────────
// Le serveur filtre par utilisateur (JWT) ; userId passé = ignoré. createNotification
// est best-effort (erreur avalée, comme sous Firestore).
export const getNotifications = (/* userId */) => api('GET', '/notifications');
export const createNotification = (notif) => api('POST', '/notifications', notif).catch(() => {});
export const markNotificationRead = (notifId) => api('PUT', '/notifications/' + enc(notifId) + '/read');
export const markAllNotificationsRead = (/* userId */) => api('PUT', '/notifications/read-all');

// ── pending (file « MAJ en attente ») ─────────────────────────────────────────
// savePendingList : allègement client (slimPendingItem) puis full-replace serveur.
export const getPendingItems = () => api('GET', '/pending');
export const savePendingList = (items) =>
  api('PUT', '/pending', { items: (Array.isArray(items) ? items : []).map(slimPendingItem) });

// ── activité (tracking invisible) + temps par article ─────────────────────────
// date/hour = HEURE LOCALE utilisateur : calculées/fournies côté client (jamais
// serveur). Les wrappers de LECTURE tableau de bord reçoivent leurs bornes du client.
export const saveActivitySession = (data) => api('POST', '/activity/session', data);
export const updateActivityHeartbeat = (userId, date, hour) => api('POST', '/activity/heartbeat', { userId, date, hour });
export const recordActivityPause = (userId, date, pause) => api('POST', '/activity/pause', { userId, date, pause });
export const recordSessionClose = (userId, date, closeTime) => api('POST', '/activity/close', { userId, date, closeTime });
export const recordActivityAction = (userId, date, actionType) => api('POST', '/activity/action', { userId, date, actionType });
export const getActivitySessionsRange = (startDate, endDate) =>
  api('GET', '/activity/sessions?start=' + enc(startDate) + '&end=' + enc(endDate));
export const getUserActivitySessions = (userId, days = 7) =>
  api('GET', '/activity/sessions/user?userId=' + enc(userId) + '&days=' + Number(days));
export const getTodayActivitySessions = () => { const d = _localDate(); return getActivitySessionsRange(d, d); };

// article_time (temps actif par article × éditeur)
export const ensureArticleTimeDoc = (articleId, meta = {}) =>
  api('POST', '/article-time/ensure', { articleId, ...meta });
export const recordArticleTime = (articleId, userId, minutes = 1) =>
  api('POST', '/article-time/record', { articleId, userId, minutes });
export const markArticleTimePublished = (articleId, userId) =>
  api('POST', '/article-time/published', { articleId, userId });
export const getArticleTimeAll = () => api('GET', '/article-time');

// ── auth (login bcrypt en mode MySQL) ─────────────────────────────────────────
// Même contrat que l'impl. Firestore : renvoie { token, role, username, uid } OU
// { requires2fa, method, tempToken }. L'étape 2FA est jouée par la page Login via
// /api/auth/login (backend-agnostique). Lève en cas d'échec → la page retombe sur
// /api/auth/login (break-glass super_admin .env). getUsers = lecture seule (le
// CRUD comptes / reset / 2FA en SQL viendront au lot 7b).
export const loginWithUsernameOrEmail = async (identifier, password) => {
  const res = await fetch('/api/auth/mysql-login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: identifier, password }),
  });
  if (!res.ok) throw new Error('Échec authentification');
  return res.json();
};
export const getUsers = () => api('GET', '/users');

// Déconnexion : pas de session Firebase à fermer en mode MySQL.
export const firebaseLogout = async () => {};

// Abonnements temps réel → POLLING (intervalles verrouillés). Retour = désabonnement.
export const watchEditLock = (articleId, callback) => {
  if (!articleId) return () => {};
  return pollUrl('/articles/' + enc(articleId) + '/lock', callback, 5000);
};
export const subscribeToPending = (callback) => pollUrl('/pending', callback, 6000);
export const subscribeToComments = (ticketId, onUpdate, onError = () => {}) =>
  pollUrl('/tickets/' + enc(ticketId) + '/comments', onUpdate, 4000, { onError });
export const subscribeToNotifications = (userId, callback) =>
  pollUrl('/notifications', callback, 25000);

// ── À porter (étape 3, domaine par domaine) ───────────────────────────────────
