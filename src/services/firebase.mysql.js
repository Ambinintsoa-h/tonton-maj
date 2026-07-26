// ─────────────────────────────────────────────────────────────────────────────
// firebase.mysql.js — impl. MySQL de la façade (via endpoints proxy /api/data)
// ─────────────────────────────────────────────────────────────────────────────
// Utilisée UNIQUEMENT quand DATA_BACKEND=mysql (voir firebase.js / backendMode.js).
// Mêmes signatures que l'impl. Firestore ; les fonctions non encore portées lèvent
// une erreur claire (NI) — un flip vers mysql avant qu'un domaine soit prêt échoue
// fort, pas en silence.
//
// ⚠️ MAINTENUE À LA MAIN (le générateur scratchpad ne sert qu'aux stubs initiaux).
// Doit exporter EXACTEMENT les 65 fonctions aiguillées par firebase.js.
//
// Étape 3 — domaines portés : skills, knowledge, settings, stats.
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

// ── Domaines portés ───────────────────────────────────────────────────────────

// skills
export const getSkills = () => api('GET', '/skills');
export const saveSkill = (skill) => api('POST', '/skills', skill).then((r) => r.id);
export const deleteSkill = (id) => api('DELETE', '/skills/' + id);

// knowledge
export const getKnowledge = () => api('GET', '/knowledge');
export const saveKnowledge = (item) => api('POST', '/knowledge', item).then((r) => r.id);
export const deleteKnowledge = (id) => api('DELETE', '/knowledge/' + id);

// settings (singleton)
export const getSettings = () => api('GET', '/settings');
export const saveSettings = (settings) => api('PUT', '/settings', settings);

// stats (singleton)
export const getStats = () => api('GET', '/stats');
export const saveStats = (stats) => api('PUT', '/stats', stats);

// Déconnexion : pas de session Firebase à fermer en mode MySQL.
export const firebaseLogout = async () => {};

// Abonnements temps réel → deviendront du polling (domaines à venir). Stub = unsub no-op.
export const watchEditLock = () => () => {};
export const subscribeToPending = () => () => {};
export const subscribeToComments = () => () => {};
export const subscribeToNotifications = () => () => {};

// ── À porter (étape 3, domaine par domaine) ───────────────────────────────────
export const loginWithUsernameOrEmail = async () => NI('loginWithUsernameOrEmail');
export const getArticles = async () => NI('getArticles');
export const saveArticle = async () => NI('saveArticle');
export const updateArticleHtml = async () => NI('updateArticleHtml');
export const acquireEditLock = async () => NI('acquireEditLock');
export const heartbeatEditLock = async () => NI('heartbeatEditLock');
export const releaseEditLock = async () => NI('releaseEditLock');
export const deleteArticle = async () => NI('deleteArticle');
export const getWordPressSites = async () => NI('getWordPressSites');
export const saveWordPressSite = async () => NI('saveWordPressSite');
export const deleteWordPressSite = async () => NI('deleteWordPressSite');
export const saveSiteFonts = async () => NI('saveSiteFonts');
export const saveArticleDraftRemote = async () => NI('saveArticleDraftRemote');
export const getArticleDraftRemote = async () => NI('getArticleDraftRemote');
export const deleteArticleDraftRemote = async () => NI('deleteArticleDraftRemote');
export const getCommentAi = async () => NI('getCommentAi');
export const saveCommentAi = async () => NI('saveCommentAi');
export const getCommentSettings = async () => NI('getCommentSettings');
export const saveCommentSettings = async () => NI('saveCommentSettings');
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
export const archiveArticle = async () => NI('archiveArticle');
export const restoreArticle = async () => NI('restoreArticle');
export const getTodayActivitySessions = async () => NI('getTodayActivitySessions');
export const getActivitySessionsRange = async () => NI('getActivitySessionsRange');
export const getUserActivitySessions = async () => NI('getUserActivitySessions');
export const initArticleSeoTracking = async () => NI('initArticleSeoTracking');
export const saveSeoSnapshot = async () => NI('saveSeoSnapshot');
export const getArticleSeoTracking = async () => NI('getArticleSeoTracking');
