// ─────────────────────────────────────────────────────────────────────────────
// batches.js — client des endpoints /api/data/batches (MAJ en lot, Phase 4)
// ─────────────────────────────────────────────────────────────────────────────
// Feature 100 % MySQL, sans équivalent Firestore : pas de raison de passer par
// la façade firebase.js/firebase.mysql.js (qui, elle, aiguille les 65 fonctions
// communes aux deux backends). Helper `api()` isolé mais fidèle au même contrat
// 401 → signalSessionExpired() que firebase.mysql.js, pour que l'app réagisse
// pareil (bandeau session expirée) quel que soit l'endroit qui appelle l'API.

import { signalSessionExpired } from './sessionExpiry';

const authToken = () => sessionStorage.getItem('tonton_auth_token');

const api = async (method, path, body) => {
  const res = await fetch('/api/data/batches' + path, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(authToken() ? { Authorization: `Bearer ${authToken()}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) {
    signalSessionExpired();
    throw new Error(`[batches] ${method} ${path} → session expirée (401)`);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`[batches] ${method} ${path} → HTTP ${res.status}${text ? ` — ${text}` : ''}`);
  }
  if (res.status === 204) return null;
  return res.json();
};

// `search` (titre d'article généré, mot-clé cible ou URL) : quand fourni, le
// serveur ignore `limit` et cherche dans TOUT l'historique des lots (voir
// GET /batches ci-dessus, data-api.js) -- l'appelant n'a donc rien à changer
// à `limit` selon qu'une recherche est en cours ou non.
export const listBatches = (limit = 20, { search } = {}) => {
  const params = new URLSearchParams({ limit: String(limit) });
  if (search) params.set('search', search);
  return api('GET', `?${params.toString()}`);
};

export const getBatch = (id) => api('GET', `/${encodeURIComponent(id)}`);

// payload = { source?, items: [{ site?, articleUrl, majType, consigne? }, ...] }
// launchedBy/launchedByName ne se passent pas ici : le serveur les tire du JWT.
export const createBatch = (payload) => api('POST', '', payload);

export const updateBatchItem = (batchId, itemId, patch) =>
  api('PUT', `/${encodeURIComponent(batchId)}/items/${encodeURIComponent(itemId)}`, patch);
