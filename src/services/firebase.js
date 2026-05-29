import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore, collection, doc, getDocs, addDoc, updateDoc, deleteDoc, setDoc, getDoc, orderBy, query, onSnapshot, where, limit } from 'firebase/firestore';
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
  // Le mot de passe Application Password ne doit jamais être persisté en cloud.
  // Il reste uniquement dans localStorage côté client, jamais dans Firestore.
  // eslint-disable-next-line no-unused-vars
  const { password, ...safeData } = site;
  if (site.id) {
    await updateDoc(doc(db, 'wordpress_sites', site.id), safeData);
    return site.id;
  }
  const ref = await addDoc(collection(db, 'wordpress_sites'), { ...safeData, createdAt: Date.now() });
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
    level: 1,
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
  // where seul — tri client-side pour éviter l'index composite
  const q = query(collection(db, 'ticket_comments'), where('ticketId', '==', ticketId));
  const snap = await getDocs(q);
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
};

export const addComment = async (comment) => {
  if (!db) throw new Error('Firebase non initialisé');
  const ref = await addDoc(collection(db, 'ticket_comments'), {
    ...comment,
    createdAt: Date.now(),
  });
  // Incrémenter le compteur
  const ticketRef = doc(db, 'tickets', comment.ticketId);
  const ticketSnap = await getDoc(ticketRef);
  if (ticketSnap.exists()) {
    const t = ticketSnap.data();
    const updates = { commentCount: (t.commentCount || 0) + 1, updatedAt: Date.now() };
    // Auto in_progress si ticket open ET auteur n'est pas le créateur
    if (t.status === 'open' && comment.authorId !== t.creatorId) {
      updates.status = 'in_progress';
    }
    await updateDoc(ticketRef, updates);
  }
  return ref.id;
};

export const uploadTicketFile = async (ticketId, file) => {
  if (!storage) throw new Error('Storage non initialisé');
  const path = `ticket-attachments/${ticketId}/${Date.now()}_${file.name}`;
  const r = storageRef(storage, path);
  await uploadBytes(r, file);
  const url = await getDownloadURL(r);
  return { url, name: file.name, type: file.type, size: file.size };
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
