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
  if (!res.ok) throw new Error(`[mysql] ${method} ${path} → HTTP ${res.status}`);
  if (res.status === 204) return null;
  const ct = res.headers.get('content-type') || '';
  return ct.includes('application/json') ? res.json() : null;
};

const enc = encodeURIComponent;

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

// Déconnexion : pas de session Firebase à fermer en mode MySQL.
export const firebaseLogout = async () => {};

// Abonnements temps réel → deviendront du polling (domaines à venir). Stub = unsub no-op.
export const watchEditLock = () => () => {};
export const subscribeToPending = () => () => {};
export const subscribeToComments = () => () => {};
export const subscribeToNotifications = () => () => {};

// ── À porter (étape 3, domaine par domaine) ───────────────────────────────────
export const loginWithUsernameOrEmail = async () => NI('loginWithUsernameOrEmail');
export const getUsers = async () => NI('getUsers');
export const getPendingItems = async () => NI('getPendingItems');
export const savePendingList = async () => NI('savePendingList');
export const getTickets = async () => NI('getTickets');
export const createTicket = async () => NI('createTicket');
export const updateTicketDoc = async () => NI('updateTicketDoc');
export const deleteTicketDoc = async () => NI('deleteTicketDoc');
export const getComments = async () => NI('getComments');
export const addComment = async () => NI('addComment');
export const updateCommentAttachments = async () => NI('updateCommentAttachments');
export const createNotification = async () => NI('createNotification');
export const getNotifications = async () => NI('getNotifications');
export const markNotificationRead = async () => NI('markNotificationRead');
export const markAllNotificationsRead = async () => NI('markAllNotificationsRead');
export const saveActivitySession = async () => NI('saveActivitySession');
export const updateActivityHeartbeat = async () => NI('updateActivityHeartbeat');
export const recordActivityPause = async () => NI('recordActivityPause');
export const recordSessionClose = async () => NI('recordSessionClose');
export const recordActivityAction = async () => NI('recordActivityAction');
export const ensureArticleTimeDoc = async () => NI('ensureArticleTimeDoc');
export const recordArticleTime = async () => NI('recordArticleTime');
export const markArticleTimePublished = async () => NI('markArticleTimePublished');
export const getArticleTimeAll = async () => NI('getArticleTimeAll');
export const getTodayActivitySessions = async () => NI('getTodayActivitySessions');
export const getActivitySessionsRange = async () => NI('getActivitySessionsRange');
export const getUserActivitySessions = async () => NI('getUserActivitySessions');
