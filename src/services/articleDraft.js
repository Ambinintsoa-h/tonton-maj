/**
 * Autosave d'une MAJ en cours (façon Google Docs).
 *
 * Deux niveaux de persistance :
 *   1. localStorage  → écrit à chaque appel (cheap), survit au rechargement / navigation
 *   2. Firestore     → debounce sur l'inactivité + throttle (anti-saturation serveur)
 *
 * Statut exposé via onDraftStatus(cb) :
 *   'saving' → écriture Firestore en cours
 *   'saved'  → écriture Firestore réussie (2e arg = timestamp)
 *   'local'  → réseau/permission KO → sauvegardé en localStorage uniquement (2e arg = ts)
 */
import {
  saveArticleDraftRemote, getArticleDraftRemote, deleteArticleDraftRemote,
} from './firebase';

const KEY = (uid) => `tonton_article_draft_${uid || 'anon'}`;
const MAX_REMOTE_HTML = 900_000;          // au-delà : pas d'écriture Firestore (limite doc 1 Mo)
const REMOTE_IDLE_MS = 3000;              // Firestore : 3 s après la dernière modification
const REMOTE_MIN_INTERVAL_MS = 12000;     // … mais au plus une écriture toutes les 12 s

let remoteTimer = null;
let lastRemoteAt = 0;
let pending = null;                       // dernier { uid, payload } à pousser
let suppressUntil = 0;                    // fenêtre d'inhibition après un clearDraft
let statusCb = null;

/** S'abonner au statut d'enregistrement (un seul abonné — le composant courant). */
export const onDraftStatus = (cb) => { statusCb = cb; };
const emit = (status, at) => { if (statusCb) { try { statusCb(status, at ?? null); } catch {} } };

const writeLocal = (uid, payload) => {
  try { localStorage.setItem(KEY(uid), JSON.stringify(payload)); return true; }
  catch { return false; }
};

const doRemote = async () => {
  if (!pending || Date.now() < suppressUntil) return;
  const { uid, payload } = pending;
  if (!uid || (payload.html || '').length > MAX_REMOTE_HTML) { emit('local', payload.savedAt); return; }
  lastRemoteAt = Date.now();
  emit('saving');
  try {
    await saveArticleDraftRemote(uid, payload);
    emit('saved', payload.savedAt);
  } catch {
    // Réseau / permission → le localStorage a déjà servi de filet
    emit('local', payload.savedAt);
  }
};

// Planifie l'écriture Firestore : after idle, mais jamais plus d'une fois / 12 s.
const scheduleRemote = () => {
  clearTimeout(remoteTimer);
  const sinceLast = Date.now() - lastRemoteAt;
  const wait = sinceLast >= REMOTE_MIN_INTERVAL_MS
    ? REMOTE_IDLE_MS
    : Math.max(REMOTE_IDLE_MS, REMOTE_MIN_INTERVAL_MS - sinceLast);
  remoteTimer = setTimeout(doRemote, wait);
};

/**
 * Enregistre le brouillon : localStorage immédiat + Firestore planifié (idle + throttle).
 * L'appelant (ArticleResult) débounce déjà les appels (frappe / rafale).
 * Retourne le timestamp d'enregistrement local.
 */
export const saveDraft = (uid, draft) => {
  if (Date.now() < suppressUntil) return null;
  const payload = { ...draft, savedAt: Date.now() };
  writeLocal(uid, payload);     // filet de sécurité immédiat
  pending = { uid, payload };
  scheduleRemote();
  return payload.savedAt;
};

/** Force l'écriture distante immédiatement (ex: avant démontage / navigation). */
export const flushDraftRemote = (uid, draft) => {
  clearTimeout(remoteTimer);
  if (Date.now() < suppressUntil) return;
  const payload = { ...draft, savedAt: Date.now() };
  writeLocal(uid, payload);
  if (!uid || (payload.html || '').length > MAX_REMOTE_HTML) return;
  lastRemoteAt = Date.now();
  emit('saving');
  saveArticleDraftRemote(uid, payload).then(() => emit('saved', payload.savedAt)).catch(() => emit('local', payload.savedAt));
};

/** Lecture locale synchrone (restauration instantanée au montage). */
export const loadDraftLocal = (uid) => {
  try {
    const raw = localStorage.getItem(KEY(uid));
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
};

/** Lecture distante (réconciliation cross-appareil). */
export const loadDraftRemote = async (uid) => {
  if (!uid) return null;
  try { return await getArticleDraftRemote(uid); } catch { return null; }
};

/** Supprime le brouillon local + distant (MAJ publiée ou abandonnée). */
export const clearDraft = (uid) => {
  clearTimeout(remoteTimer);
  pending = null;
  suppressUntil = Date.now() + 2500; // neutralise un éventuel flush de démontage
  try { localStorage.removeItem(KEY(uid)); } catch { /* noop */ }
  if (uid) deleteArticleDraftRemote(uid).catch(() => {});
};
