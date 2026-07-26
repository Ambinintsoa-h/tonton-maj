// ─────────────────────────────────────────────────────────────────────────────
// firebase.js — FAÇADE-AIGUILLEUR (dispatchers uniformes ci-dessous)
// Route chaque appel vers l'impl. Firestore (firebase.firestore.js) ou MySQL
// (firebase.mysql.js) selon le flag de backend (backendMode.js, alimenté au
// bootstrap par GET /api/backend). Défaut 'firestore' → comportement 100%
// identique tant qu'on n'a pas basculé. Les composants importent TOUJOURS depuis
// ce fichier — signatures inchangées.
// MAINTENANCE : pour ajouter une fonction, l'écrire dans firebase.firestore.js,
// puis ajouter ici son dispatcher et dans firebase.mysql.js son stub/impl.
// ─────────────────────────────────────────────────────────────────────────────
import * as firestoreImpl from './firebase.firestore';
import * as mysqlImpl from './firebase.mysql';
import { getBackend } from './backendMode';

const impl = () => (getBackend() === 'mysql' ? mysqlImpl : firestoreImpl);

// Backend-agnostiques ou init Firebase : ré-exportés tels quels depuis l'impl. Firestore.
export {
  initFirebase,
  getDb,
  getStorageRef,
  getFirebaseAuth,
  fetchArticleHtml,
  uploadTicketFile,
  LOCK_STALE_MS,
  LOCK_HEARTBEAT_MS,
  isLockActive,
} from './firebase.firestore';

// Aiguillés selon le flag (mêmes signatures ; le dispatcher relaie args et retour).
export const loginWithUsernameOrEmail = (...a) => impl().loginWithUsernameOrEmail(...a);
export const getSkills = (...a) => impl().getSkills(...a);
export const saveSkill = (...a) => impl().saveSkill(...a);
export const deleteSkill = (...a) => impl().deleteSkill(...a);
export const getArticles = (...a) => impl().getArticles(...a);
export const saveArticle = (...a) => impl().saveArticle(...a);
export const updateArticleHtml = (...a) => impl().updateArticleHtml(...a);
export const acquireEditLock = (...a) => impl().acquireEditLock(...a);
export const heartbeatEditLock = (...a) => impl().heartbeatEditLock(...a);
export const releaseEditLock = (...a) => impl().releaseEditLock(...a);
export const deleteArticle = (...a) => impl().deleteArticle(...a);
export const getWordPressSites = (...a) => impl().getWordPressSites(...a);
export const saveWordPressSite = (...a) => impl().saveWordPressSite(...a);
export const deleteWordPressSite = (...a) => impl().deleteWordPressSite(...a);
export const saveSiteFonts = (...a) => impl().saveSiteFonts(...a);
export const saveArticleDraftRemote = (...a) => impl().saveArticleDraftRemote(...a);
export const getArticleDraftRemote = (...a) => impl().getArticleDraftRemote(...a);
export const deleteArticleDraftRemote = (...a) => impl().deleteArticleDraftRemote(...a);
export const getKnowledge = (...a) => impl().getKnowledge(...a);
export const saveKnowledge = (...a) => impl().saveKnowledge(...a);
export const deleteKnowledge = (...a) => impl().deleteKnowledge(...a);
export const getCommentAi = (...a) => impl().getCommentAi(...a);
export const saveCommentAi = (...a) => impl().saveCommentAi(...a);
export const getCommentSettings = (...a) => impl().getCommentSettings(...a);
export const saveCommentSettings = (...a) => impl().saveCommentSettings(...a);
export const getSettings = (...a) => impl().getSettings(...a);
export const saveSettings = (...a) => impl().saveSettings(...a);
export const getUsers = (...a) => impl().getUsers(...a);
export const getPendingItems = (...a) => impl().getPendingItems(...a);
export const savePendingList = (...a) => impl().savePendingList(...a);
export const getStats = (...a) => impl().getStats(...a);
export const saveStats = (...a) => impl().saveStats(...a);
export const getTickets = (...a) => impl().getTickets(...a);
export const createTicket = (...a) => impl().createTicket(...a);
export const updateTicketDoc = (...a) => impl().updateTicketDoc(...a);
export const deleteTicketDoc = (...a) => impl().deleteTicketDoc(...a);
export const getComments = (...a) => impl().getComments(...a);
export const addComment = (...a) => impl().addComment(...a);
export const updateCommentAttachments = (...a) => impl().updateCommentAttachments(...a);
export const createNotification = (...a) => impl().createNotification(...a);
export const getNotifications = (...a) => impl().getNotifications(...a);
export const markNotificationRead = (...a) => impl().markNotificationRead(...a);
export const markAllNotificationsRead = (...a) => impl().markAllNotificationsRead(...a);
export const saveActivitySession = (...a) => impl().saveActivitySession(...a);
export const updateActivityHeartbeat = (...a) => impl().updateActivityHeartbeat(...a);
export const recordActivityPause = (...a) => impl().recordActivityPause(...a);
export const recordSessionClose = (...a) => impl().recordSessionClose(...a);
export const recordActivityAction = (...a) => impl().recordActivityAction(...a);
export const ensureArticleTimeDoc = (...a) => impl().ensureArticleTimeDoc(...a);
export const recordArticleTime = (...a) => impl().recordArticleTime(...a);
export const markArticleTimePublished = (...a) => impl().markArticleTimePublished(...a);
export const getArticleTimeAll = (...a) => impl().getArticleTimeAll(...a);
export const archiveArticle = (...a) => impl().archiveArticle(...a);
export const restoreArticle = (...a) => impl().restoreArticle(...a);
export const getTodayActivitySessions = (...a) => impl().getTodayActivitySessions(...a);
export const getActivitySessionsRange = (...a) => impl().getActivitySessionsRange(...a);
export const getUserActivitySessions = (...a) => impl().getUserActivitySessions(...a);
export const initArticleSeoTracking = (...a) => impl().initArticleSeoTracking(...a);
export const saveSeoSnapshot = (...a) => impl().saveSeoSnapshot(...a);
export const getArticleSeoTracking = (...a) => impl().getArticleSeoTracking(...a);
export const firebaseLogout = (...a) => impl().firebaseLogout(...a);
export const watchEditLock = (...a) => impl().watchEditLock(...a);
export const subscribeToPending = (...a) => impl().subscribeToPending(...a);
export const subscribeToComments = (...a) => impl().subscribeToComments(...a);
export const subscribeToNotifications = (...a) => impl().subscribeToNotifications(...a);
