// ⚠️ GÉNÉRÉ — impl. MySQL de la façade (étape 3 à venir).
// Le flag de backend vaut 'firestore' par défaut : ces stubs ne sont PAS appelés
// tant que l'impl. n'est pas prête. Un flip prématuré vers 'mysql' échoue fort
// (erreur claire) plutôt qu'en silence.
'use strict';

const NI = (name) => { throw new Error(`[mysql] ${name} — endpoint pas encore implémenté (backend MySQL en construction)`); };

export const loginWithUsernameOrEmail = async () => NI('loginWithUsernameOrEmail');
export const getSkills = async () => NI('getSkills');
export const saveSkill = async () => NI('saveSkill');
export const deleteSkill = async () => NI('deleteSkill');
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
export const getKnowledge = async () => NI('getKnowledge');
export const saveKnowledge = async () => NI('saveKnowledge');
export const deleteKnowledge = async () => NI('deleteKnowledge');
export const getCommentAi = async () => NI('getCommentAi');
export const saveCommentAi = async () => NI('saveCommentAi');
export const getCommentSettings = async () => NI('getCommentSettings');
export const saveCommentSettings = async () => NI('saveCommentSettings');
export const getSettings = async () => NI('getSettings');
export const saveSettings = async () => NI('saveSettings');
export const getUsers = async () => NI('getUsers');
export const getPendingItems = async () => NI('getPendingItems');
export const savePendingList = async () => NI('savePendingList');
export const getStats = async () => NI('getStats');
export const saveStats = async () => NI('saveStats');
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

// Déconnexion : pas de session Firebase à fermer en mode MySQL.
export const firebaseLogout = async () => {};

// Abonnements temps réel : deviendront du polling (étape 3). Stub = unsub no-op.
export const watchEditLock = () => () => {};
export const subscribeToPending = () => () => {};
export const subscribeToComments = () => () => {};
export const subscribeToNotifications = () => () => {};
