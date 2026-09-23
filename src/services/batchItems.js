// ─────────────────────────────────────────────────────────────────────────────
// batchItems.js — client de GET /api/data/batch-items ("Mes MAJ").
// Miroir de batches.js : même contrat d'erreur (401 → signalSessionExpired()).
// ─────────────────────────────────────────────────────────────────────────────

import { signalSessionExpired } from './sessionExpiry';

const authToken = () => sessionStorage.getItem('tonton_auth_token');

const api = async (path) => {
  const res = await fetch('/api/data/batch-items' + path, {
    headers: authToken() ? { Authorization: `Bearer ${authToken()}` } : {},
  });
  if (res.status === 401) {
    signalSessionExpired();
    throw new Error(`[batchItems] GET ${path} → session expirée (401)`);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`[batchItems] GET ${path} → HTTP ${res.status}${text ? ` — ${text}` : ''}`);
  }
  return res.json();
};

// { from?, to?: timestamps ms ; scope?: 'mine' | 'all' ; search?: string } --
// un cq_ia est de toute façon forcé sur "mine" côté serveur, quel que soit ce
// qui est envoyé. `search` (titre d'article, mot-clé ou URL) est prioritaire
// côté serveur : quand il est fourni, from/to sont ignorés là-bas (recherche
// sur tout l'historique, pas seulement la période affichée) -- inutile donc de
// les omettre ici, l'appelant garde le même objet qu'il ait ou non une
// recherche en cours.
export const listMyBatchItems = ({ from, to, scope, search } = {}) => {
  const params = new URLSearchParams();
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  if (scope) params.set('scope', scope);
  if (search) params.set('search', search);
  const qs = params.toString();
  return api(qs ? `?${qs}` : '');
};
