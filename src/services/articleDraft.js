/**
 * Autosave d'une MAJ en cours (façon Google Docs).
 *
 * Deux niveaux de persistance :
 *   1. localStorage  → instantané, survit au rechargement / navigation (cet appareil)
 *   2. Firestore     → debounce, survit au vidage du cache / autre appareil
 *
 * Le brouillon (draft) contient le HTML édité en direct + l'état de l'agent
 * nécessaire pour reconstituer la vue diff au retour.
 */
import {
  saveArticleDraftRemote, getArticleDraftRemote, deleteArticleDraftRemote,
} from './firebase';

const KEY = (uid) => `tonton_article_draft_${uid || 'anon'}`;
// Au-delà de cette taille de HTML on ne pousse pas en Firestore (limite doc 1 Mo)
const MAX_REMOTE_HTML = 900_000;
// Délai de debounce pour l'écriture Firestore (le localStorage, lui, est instantané)
const REMOTE_DEBOUNCE_MS = 6000;

let remoteTimer = null;
// Fenêtre durant laquelle tout save est ignoré (juste après un clearDraft) — évite
// qu'un flush de démontage ne ressuscite un brouillon volontairement supprimé.
let suppressUntil = 0;

/** Sauvegarde locale immédiate + Firestore debouncée. Retourne le timestamp. */
export const saveDraft = (uid, draft) => {
  if (Date.now() < suppressUntil) return null;
  const payload = { ...draft, savedAt: Date.now() };
  try { localStorage.setItem(KEY(uid), JSON.stringify(payload)); } catch { /* quota */ }

  if (uid) {
    clearTimeout(remoteTimer);
    remoteTimer = setTimeout(() => {
      if ((payload.html || '').length <= MAX_REMOTE_HTML) {
        saveArticleDraftRemote(uid, payload).catch(() => {});
      }
    }, REMOTE_DEBOUNCE_MS);
  }
  return payload.savedAt;
};

/** Force l'écriture distante en attente immédiatement (ex: avant démontage). */
export const flushDraftRemote = (uid, draft) => {
  clearTimeout(remoteTimer);
  if (!uid || !draft || Date.now() < suppressUntil) return;
  if ((draft.html || '').length <= MAX_REMOTE_HTML) {
    saveArticleDraftRemote(uid, { ...draft, savedAt: Date.now() }).catch(() => {});
  }
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
  suppressUntil = Date.now() + 2500; // neutralise un éventuel flush de démontage
  try { localStorage.removeItem(KEY(uid)); } catch { /* noop */ }
  if (uid) deleteArticleDraftRemote(uid).catch(() => {});
};
