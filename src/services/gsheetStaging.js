// ─────────────────────────────────────────────────────────────────────────────
// gsheetStaging.js — client des endpoints /api/data/gsheet-staged (lignes
// détectées automatiquement sur le Google Sheet de suivi, cron 5 min côté
// serveur) + /api/internal/gsheet-sync (bouton "Synchroniser maintenant").
// Même contrat d'erreur que batches.js (401 → signalSessionExpired()).
// ─────────────────────────────────────────────────────────────────────────────

import { signalSessionExpired } from './sessionExpiry';

const authToken = () => sessionStorage.getItem('tonton_auth_token');

const request = async (url, { method = 'GET', body } = {}) => {
  const res = await fetch(url, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(authToken() ? { Authorization: `Bearer ${authToken()}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) {
    signalSessionExpired();
    throw new Error(`[gsheet-staging] ${method} ${url} → session expirée (401)`);
  }
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error || `[gsheet-staging] ${method} ${url} → HTTP ${res.status}`);
  }
  if (res.status === 204) return null;
  return res.json();
};

export const listStagedItems = () => request('/api/data/gsheet-staged?status=nouveau');

// ids: string[] -- crée un batch à partir des lignes choisies (voir POST /batches)
export const launchStagedItems = (ids) => request('/api/data/gsheet-staged/launch', { method: 'POST', body: { ids } });

export const ignoreStagedItem = (id) => request(`/api/data/gsheet-staged/${encodeURIComponent(id)}/ignore`, { method: 'POST' });

// Lance une synchronisation immédiate (même effet que le cron 5 min, tout de
// suite) -- utilisé par le bouton "Synchroniser maintenant" de /lots et par
// le test de connexion dans Paramètres.
export const syncGoogleSheetNow = () => request('/api/internal/gsheet-sync', { method: 'POST' });
