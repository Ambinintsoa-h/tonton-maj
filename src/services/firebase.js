import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore, collection, doc, getDocs, addDoc, updateDoc, deleteDoc, setDoc, getDoc, orderBy, query, onSnapshot, where, limit, increment, arrayUnion } from 'firebase/firestore';
import { getStorage, ref as storageRef, uploadString, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { getAuth, signInWithEmailAndPassword, signOut as firebaseSignOut } from 'firebase/auth';

let app = null;
let db = null;
let storage = null;
let auth = null;

export const initFirebase = (config) => {
  try {
    // Réutiliser l'instance existante si déjà initialisée (évite l'erreur HMR/double-init)
    app = getApps().length > 0 ? getApp() : initializeApp(config);
    db = getFirestore(app);
    storage = getStorage(app);
    auth = getAuth(app);
    return true;
  } catch (e) {
    console.error('[firebase] Erreur init :', e.message);
    return false;
  }
};

export const getDb = () => db;
export const getStorageRef = () => storage;
export const getFirebaseAuth = () => auth;

export const loginWithUsernameOrEmail = async (identifier, password) => {
  if (!auth) throw new Error('Firebase Auth non initialisé');

  let email = identifier;
  // Si c'est un username (pas d'@), résoudre en email via le proxy
  if (!identifier.includes('@')) {
    const res = await fetch(`/api/auth/resolve-username?u=${encodeURIComponent(identifier.toLowerCase())}`);
    if (!res.ok) throw new Error('Identifiant introuvable');
    const data = await res.json();
    email = data.email;
  }

  // Firebase Auth sign-in
  const credential = await signInWithEmailAndPassword(auth, email, password);
  const idToken = await credential.user.getIdToken();

  // Échanger contre un JWT interne
  const resp = await fetch('/api/auth/firebase-login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken }),
  });
  if (!resp.ok) throw new Error('Échec authentification serveur');
  return await resp.json(); // { token, role, username, uid }
};

export const firebaseLogout = async () => {
  if (auth) await firebaseSignOut(auth);
};

// Skills
export const getSkills = async () => {
  if (!db) return [];
  const q = query(collection(db, 'skills'), orderBy('createdAt', 'desc'));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
};

export const saveSkill = async (skill) => {
  if (!db) throw new Error('Firebase non initialisé');
  if (skill.id) {
    await updateDoc(doc(db, 'skills', skill.id), { ...skill, updatedAt: Date.now() });
    return skill.id;
  }
  const ref = await addDoc(collection(db, 'skills'), { ...skill, createdAt: Date.now() });
  return ref.id;
};

export const deleteSkill = async (id) => {
  if (!db) throw new Error('Firebase non initialisé');
  await deleteDoc(doc(db, 'skills', id));
};

// ── Storage helpers ──────────────────────────────────────────────────────────

// Upload d'un fichier HTML vers Firebase Storage.
// Retourne l'URL de téléchargement, ou null si Storage indisponible / erreur.
const uploadHtml = async (path, html) => {
  if (!storage || !html) return null;
  try {
    const r = storageRef(storage, path);
    const timeoutMs = 25000;
    const timer = new Promise((_, rej) =>
      setTimeout(() => rej(new Error('Firebase Storage timeout')), timeoutMs)
    );
    await Promise.race([
      uploadString(r, html, 'raw', { contentType: 'text/html; charset=utf-8' }),
      timer,
    ]);
    return await getDownloadURL(r);
  } catch {
    return null;
  }
};

// Télécharge un fichier HTML depuis une URL Firebase Storage (ou toute URL publique).
export const fetchArticleHtml = async (url) => {
  if (!url) return '';
  try {
    const res = await fetch(url);
    return res.ok ? await res.text() : '';
  } catch {
    return '';
  }
};

// Articles history
export const getArticles = async () => {
  if (!db) return [];
  const q = query(collection(db, 'articles'), orderBy('createdAt', 'desc'));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
};

// Sauvegarde un article : HTML → Firebase Storage, métadonnées + URLs → Firestore.
// Retourne { id, originalContentUrl, updatedContentUrl }
export const saveArticle = async (article) => {
  if (!db) throw new Error('Firebase non initialisé');

  const { originalContent, updatedContent, ...metadata } = article;

  // Pré-générer un ID pour construire le chemin Storage avant d'écrire Firestore
  const docRef = article.id
    ? doc(db, 'articles', article.id)
    : doc(collection(db, 'articles'));
  const docId = docRef.id;

  // Upload HTML vers Storage en parallèle
  const [originalContentUrl, updatedContentUrl] = await Promise.all([
    uploadHtml(`articles/${docId}/original.html`, originalContent),
    uploadHtml(`articles/${docId}/updated.html`, updatedContent),
  ]);

  // Firestore : URLs si Storage OK, sinon HTML inline en fallback
  // Sécurité : si le contenu dépasse 800 000 chars, ne pas l'inclure en fallback inline
  const MAX_INLINE_SIZE = 800000;
  const origTooLarge = (originalContent || '').length > MAX_INLINE_SIZE;
  const updTooLarge  = (updatedContent  || '').length > MAX_INLINE_SIZE;
  if (origTooLarge) console.warn('[firebase] originalContent trop volumineux (>800 000 chars) — exclut du fallback Firestore');
  if (updTooLarge)  console.warn('[firebase] updatedContent trop volumineux (>800 000 chars) — exclut du fallback Firestore');

  const firestoreData = {
    ...metadata,
    ...(originalContentUrl ? { originalContentUrl }
        : (originalContent && !origTooLarge) ? { originalContent } : {}),
    ...(updatedContentUrl  ? { updatedContentUrl  }
        : (updatedContent  && !updTooLarge)  ? { updatedContent  } : {}),
  };

  if (article.id) {
    await updateDoc(docRef, { ...firestoreData, updatedAt: Date.now() });
  } else {
    await setDoc(docRef, { ...firestoreData, createdAt: Date.now() });
  }

  return { id: docId, originalContentUrl, updatedContentUrl };
};

export const deleteArticle = async (id) => {
  if (!db) throw new Error('Firebase non initialisé');
  await deleteDoc(doc(db, 'articles', id));
  // Nettoyage Storage (best-effort — ignorer les erreurs si fichiers absents)
  if (storage) {
    await Promise.allSettled([
      deleteObject(storageRef(storage, `articles/${id}/original.html`)),
      deleteObject(storageRef(storage, `articles/${id}/updated.html`)),
    ]);
  }
};

// WordPress sites
export const getWordPressSites = async () => {
  if (!db) return [];
  const snap = await getDocs(collection(db, 'wordpress_sites'));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
};

export const saveWordPressSite = async (site) => {
  if (!db) throw new Error('Firebase non initialisé');
  // WordPress Application Password : token révocable (≠ mot de passe admin).
  // Persisté dans Firestore pour survie au vidage de cache — révocable depuis WP Admin → Users → Application Passwords.
  // Le vrai mot de passe admin n'est jamais stocké ici.
  const { id, ...data } = site;
  if (id) {
    await updateDoc(doc(db, 'wordpress_sites', id), data);
    return id;
  }
  const ref = await addDoc(collection(db, 'wordpress_sites'), { ...data, createdAt: Date.now() });
  return ref.id;
};

export const deleteWordPressSite = async (id) => {
  if (!db) throw new Error('Firebase non initialisé');
  await deleteDoc(doc(db, 'wordpress_sites', id));
};

// Knowledge base
export const getKnowledge = async () => {
  if (!db) return [];
  const q = query(collection(db, 'knowledge'), orderBy('createdAt', 'desc'));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
};

export const saveKnowledge = async (item) => {
  if (!db) throw new Error('Firebase non initialisé');
  if (item.id) {
    await updateDoc(doc(db, 'knowledge', item.id), { ...item, updatedAt: Date.now() });
    return item.id;
  }
  const ref = await addDoc(collection(db, 'knowledge'), { ...item, createdAt: Date.now() });
  return ref.id;
};

export const deleteKnowledge = async (id) => {
  if (!db) throw new Error('Firebase non initialisé');
  await deleteDoc(doc(db, 'knowledge', id));
};

// Settings
export const getSettings = async () => {
  if (!db) return {};
  const snap = await getDoc(doc(db, 'settings', 'main'));
  return snap.exists() ? snap.data() : {};
};

// Équipe (membres)
export const getUsers = async () => {
  if (!db) return [];
  const q = query(collection(db, 'users'), orderBy('createdAt', 'desc'));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
};

export const saveUser = async (user) => {
  if (!db) throw new Error('Firebase non initialisé');
  if (user.id) {
    await updateDoc(doc(db, 'users', user.id), { ...user, updatedAt: Date.now() });
    return user.id;
  }
  const ref = await addDoc(collection(db, 'users'), { ...user, createdAt: Date.now() });
  return ref.id;
};

export const deleteUser = async (id) => {
  if (!db) throw new Error('Firebase non initialisé');
  await deleteDoc(doc(db, 'users', id));
};

// Pending items (file d'attente partagée entre membres de l'équipe)
export const getPendingItems = async () => {
  if (!db) return [];
  const q = query(collection(db, 'pending'), orderBy('createdAt', 'desc'));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
};

// Remplace la totalité de la liste pending en Firestore (full-replace debounced)
export const savePendingList = async (items) => {
  if (!db || !Array.isArray(items)) return;
  const snap = await getDocs(collection(db, 'pending'));
  // Supprimer les docs qui ne sont plus dans la liste
  const currentIds = new Set(items.map(i => String(i.id)));
  await Promise.all(snap.docs.filter(d => !currentIds.has(d.id)).map(d => deleteDoc(d.ref)));
  // Upsert tous les items courants
  await Promise.all(items.map(item =>
    setDoc(doc(db, 'pending', String(item.id)), { ...item })
  ));
};

// Stats globales (document unique partagé par toute l'équipe)
export const getStats = async () => {
  if (!db) return null;
  const snap = await getDoc(doc(db, 'stats', 'main'));
  return snap.exists() ? snap.data() : null;
};

export const saveStats = async (stats) => {
  if (!db) return;
  await setDoc(doc(db, 'stats', 'main'), {
    totalArticles:     stats.totalArticles     || 0,
    totalInputTokens:  stats.totalInputTokens  || 0,
    totalOutputTokens: stats.totalOutputTokens || 0,
    totalCostUsd:      stats.totalCostUsd      || 0,
    history:           stats.history           || [],
    updatedAt: Date.now(),
  });
};

export const saveSettings = async (settings) => {
  if (!db) throw new Error('Firebase non initialisé');
  // Ne jamais persister les clés API en cloud Firestore — elles restent dans localStorage.
  // Seule la config Firebase elle-même est utile à synchroniser.
  // eslint-disable-next-line no-unused-vars
  const { anthropicKey, braveKey, tavilyKey, groqKey, ...safeSettings } = settings;
  await setDoc(doc(db, 'settings', 'main'), safeSettings, { merge: true });
};

// ── Tickets ──────────────────────────────────────────────────────────────────

export const getTickets = async (userId, role) => {
  if (!db) return [];
  // Pas de combinaison where+orderBy sur des champs différents → évite l'exigence d'index composite
  let q;
  if (role === 'cq_ia') {
    q = query(collection(db, 'tickets'), where('creatorId', '==', userId));
  } else {
    q = query(collection(db, 'tickets'), orderBy('createdAt', 'desc'));
  }
  const snap = await getDocs(q);
  const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  // Tri client-side pour cq_ia (évite l'index composite Firestore)
  if (role === 'cq_ia') docs.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return docs;
};

export const createTicket = async (ticket) => {
  if (!db) throw new Error('Firebase non initialisé');
  const ref = await addDoc(collection(db, 'tickets'), {
    ...ticket,
    status: 'open',
    commentCount: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    resolvedAt: null,
    closedAt: null,
  });
  return ref.id;
};

export const updateTicketDoc = async (ticketId, updates) => {
  if (!db) throw new Error('Firebase non initialisé');
  await updateDoc(doc(db, 'tickets', ticketId), { ...updates, updatedAt: Date.now() });
};

export const getComments = async (ticketId) => {
  if (!db) return [];
  const q = query(collection(db, 'ticket_comments'), where('ticketId', '==', ticketId));
  const snap = await getDocs(q);
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
};

// Abonnement temps réel aux commentaires d'un ticket.
// Lit d'abord depuis le cache Firestore local (quasi-instantané), puis sync serveur.
// Retourne la fonction de désabonnement (à appeler au unmount).
export const subscribeToComments = (ticketId, onUpdate, onError = () => {}) => {
  if (!db) return () => {};
  const q = query(collection(db, 'ticket_comments'), where('ticketId', '==', ticketId));
  return onSnapshot(
    q,
    { includeMetadataChanges: false },
    (snap) => {
      const comments = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
      onUpdate(comments);
    },
    onError,
  );
};

// ticketStatusUpdate : objet optionnel calculé côté client (ex: { status: 'in_progress' })
// Évite un getDoc() inutile → addDoc + updateDoc lancés en parallèle
export const addComment = async (comment, ticketStatusUpdate = {}) => {
  if (!db) throw new Error('Firebase non initialisé');
  const [ref] = await Promise.all([
    addDoc(collection(db, 'ticket_comments'), { ...comment, createdAt: Date.now() }),
    updateDoc(doc(db, 'tickets', comment.ticketId), {
      commentCount: increment(1),
      updatedAt:    Date.now(),
      ...ticketStatusUpdate,
    }),
  ]);
  return ref.id;
};

// Upload via proxy serveur (Firebase Admin SDK) — bypasse les règles Storage,
// fonctionne pour tous les rôles y compris super_admin sans Firebase Auth.
export const uploadTicketFile = async (ticketId, file) => {
  const token = sessionStorage.getItem('tonton_auth_token');
  const formData = new FormData();
  formData.append('file', file);
  formData.append('ticketId', ticketId);

  const resp = await fetch('/api/upload-ticket-file', {
    method: 'POST',
    headers: token ? { 'Authorization': `Bearer ${token}` } : {},
    body: formData,
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: `HTTP ${resp.status}` }));
    throw new Error(err.error || `Erreur upload HTTP ${resp.status}`);
  }

  return resp.json(); // { url, name, type, size }
};

// Met à jour les PJ d'un commentaire après upload en arrière-plan
export const updateCommentAttachments = async (commentId, attachments) => {
  if (!db || !commentId) return;
  await updateDoc(doc(db, 'ticket_comments', commentId), { attachments });
};

// ── Notifications ─────────────────────────────────────────────────────────────

export const createNotification = async (notif) => {
  if (!db) return;
  try {
    await addDoc(collection(db, 'notifications'), {
      ...notif,
      read: false,
      createdAt: Date.now(),
    });
  } catch {}
};

export const getNotifications = async (userId) => {
  if (!db) return [];
  // where seul — tri client-side pour éviter l'index composite
  const q = query(collection(db, 'notifications'), where('toUserId', '==', userId), limit(50));
  const snap = await getDocs(q);
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
};

export const subscribeToNotifications = (userId, callback) => {
  if (!db) return () => {};
  // where seul — tri client-side pour éviter l'index composite
  const q = query(collection(db, 'notifications'), where('toUserId', '==', userId), limit(50));
  return onSnapshot(q, (snap) => {
    const sorted = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    callback(sorted);
  });
};

export const markNotificationRead = async (notifId) => {
  if (!db) return;
  await updateDoc(doc(db, 'notifications', notifId), { read: true });
};

export const markAllNotificationsRead = async (userId) => {
  if (!db) return;
  const q = query(
    collection(db, 'notifications'),
    where('toUserId', '==', userId),
    where('read', '==', false)
  );
  const snap = await getDocs(q);
  await Promise.all(snap.docs.map(d => updateDoc(d.ref, { read: true })));
};

// ── Activity Tracking (invisible — manager / cq_ia uniquement) ────────────────

const _localDate = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/**
 * Crée le document de session du jour OU enregistre une reconnexion.
 *
 * CRÉATION (première activité du jour) :
 *   - setDoc complet avec firstActivityAt, connections[0]
 *
 * RECONNEXION (document déjà existant) :
 *   - NE JAMAIS écraser firstActivityAt
 *   - Ajouter la reconnexion dans connections[] via arrayUnion
 *
 * Structure connections[] : [{at: timestamp}] — une entrée par connexion du jour.
 * Permet de déduire les périodes hors-ligne (gap entre lastActivityAt et connections[n].at).
 */
export const saveActivitySession = async (data) => {
  if (!db) return;
  const ref  = doc(db, 'activity_sessions', `${data.userId}_${data.date}`);
  const snap = await getDoc(ref);

  if (!snap.exists()) {
    // Première connexion du jour → créer le document complet
    await setDoc(ref, {
      userId:             data.userId,
      userRole:           data.userRole,
      userName:           data.userName,
      date:               data.date,
      firstActivityAt:    data.firstActivityAt,
      lastActivityAt:     data.lastActivityAt,
      totalActiveMinutes: 0,
      pauses:             [],
      connections:        [{ at: data.firstActivityAt }],
      hourlyActivity:     {},
      actions: {
        articlesUpdated:  0,
        ticketsCreated:   0,
        ticketsCommented: 0,
        ticketsResolved:  0,
        total:            0,
      },
    });
  } else {
    // Reconnexion — firstActivityAt préservé, reconnexion ajoutée à l'historique
    await updateDoc(ref, {
      lastActivityAt: data.lastActivityAt,
      connections:    arrayUnion({ at: data.firstActivityAt }),
    });
  }
};

/**
 * Heartbeat toutes les 2 min — incrémente l'activité horaire et le temps actif.
 */
export const updateActivityHeartbeat = async (userId, date, hour) => {
  if (!db) return;
  await updateDoc(doc(db, 'activity_sessions', `${userId}_${date}`), {
    lastActivityAt:                    Date.now(),
    totalActiveMinutes:                increment(2),
    [`hourlyActivity.${hour}`]:        increment(1),
  });
};

/**
 * Enregistre une pause complète {start, end} dans le tableau Firestore.
 */
export const recordActivityPause = async (userId, date, pause) => {
  if (!db) return;
  await updateDoc(doc(db, 'activity_sessions', `${userId}_${date}`), {
    pauses: arrayUnion(pause),
  });
};

/**
 * Incrémente le compteur d'une action métier spécifique + le total.
 * actionType : 'articlesUpdated' | 'ticketsCreated' | 'ticketsCommented' | 'ticketsResolved'
 */
export const recordActivityAction = async (userId, date, actionType) => {
  if (!db) return;
  await updateDoc(doc(db, 'activity_sessions', `${userId}_${date}`), {
    [`actions.${actionType}`]: increment(1),
    'actions.total':           increment(1),
    lastActivityAt:            Date.now(),
  });
};

/**
 * Sessions de TOUS les utilisateurs pour aujourd'hui — pour le dashboard super_admin.
 * @deprecated Utiliser getActivitySessionsRange à la place
 */
export const getTodayActivitySessions = async () => getActivitySessionsRange(_localDate(), _localDate());

/**
 * Sessions de TOUS les utilisateurs sur une plage de dates (incluse).
 * startDate / endDate : strings 'YYYY-MM-DD'
 * Tri client-side (pas d'index composite nécessaire — range sur champ unique `date`).
 */
export const getActivitySessionsRange = async (startDate, endDate) => {
  if (!db) return [];
  const snap = await getDocs(
    query(
      collection(db, 'activity_sessions'),
      where('date', '>=', startDate),
      where('date', '<=', endDate)
    )
  );
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
};

/**
 * Sessions récentes d'un utilisateur — pour la fiche membre.
 */
export const getUserActivitySessions = async (userId, days = 7) => {
  if (!db) return [];
  const snap = await getDocs(
    query(collection(db, 'activity_sessions'), where('userId', '==', userId), limit(days + 3))
  );
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, days);
};

// ─── Haloscan SEO Tracking ────────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Initialise le tracking SEO pour un article (appelé après saveArticle).
 * Enregistre les mots-clés cibles et l'URL de l'article.
 */
export const initArticleSeoTracking = async (articleId, { keywords, articleUrl }) => {
  if (!db || !articleId) return;
  const now = Date.now();
  await updateDoc(doc(db, 'articles', articleId), {
    'seoTracking.enabled':           true,
    'seoTracking.keywords':          keywords,
    'seoTracking.articleUrl':        articleUrl || '',
    'seoTracking.snapshots':         [],
    'seoTracking.completed':         false,
    'seoTracking.nextSnapshotType':  'after_7d',
    'seoTracking.nextSnapshotAt':    now + 7 * DAY_MS,
    'seoTracking.createdAt':         now,
  });
};

/**
 * Ajoute un snapshot SEO à un article (J+0, J+7 ou J+30).
 * nextType : 'after_7d' | 'after_30d' | null (terminé)
 */
export const saveSeoSnapshot = async (articleId, snapshot) => {
  if (!db || !articleId) return;
  const now      = Date.now();
  const type     = snapshot.type;
  const isLast   = type === 'after_30d';
  const nextType = type === 'before' ? 'after_7d' : type === 'after_7d' ? 'after_30d' : null;
  const nextAt   = type === 'before'   ? now + 7  * DAY_MS
                 : type === 'after_7d' ? now + 23 * DAY_MS  // 30 - 7 = 23 jours restants
                 : Number.MAX_SAFE_INTEGER;                  // terminé

  await updateDoc(doc(db, 'articles', articleId), {
    'seoTracking.snapshots':        arrayUnion(snapshot),
    'seoTracking.lastSnapshotAt':   snapshot.capturedAt,
    'seoTracking.completed':        isLast,
    'seoTracking.nextSnapshotType': nextType,
    'seoTracking.nextSnapshotAt':   nextAt,
  });
};

/**
 * Récupère le seoTracking d'un article.
 */
export const getArticleSeoTracking = async (articleId) => {
  if (!db || !articleId) return null;
  const snap = await getDoc(doc(db, 'articles', articleId));
  return snap.exists() ? (snap.data().seoTracking || null) : null;
};
