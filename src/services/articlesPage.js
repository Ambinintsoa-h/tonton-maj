// ─────────────────────────────────────────────────────────────────────────────
// articlesPage.js — client de /api/data/articles-page (Historique allégé)
// ─────────────────────────────────────────────────────────────────────────────
// Feature 100 % MySQL, sans équivalent Firestore : même raison que batches.js
// (Phase 4) -- pas de raison de passer par la façade firebase.js/firebase.mysql.js
// qui aiguille les fonctions communes aux deux backends. Même contrat 401 →
// signalSessionExpired() que firebase.mysql.js, pour que l'app réagisse pareil
// (bandeau session expirée) quel que soit l'endroit qui appelle l'API.

import { signalSessionExpired } from './sessionExpiry';

const authToken = () => sessionStorage.getItem('tonton_auth_token');

// { limit, offset } → { items: [...], total } -- items ont EXACTEMENT la même
// forme que getArticles() (contenu inline compris), pour que preview/réouverture
// en éditeur dans Historique.jsx n'aient rien à changer.
export const listArticlesPage = async ({ limit = 30, offset = 0 } = {}) => {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  const res = await fetch(`/api/data/articles-page?${params}`, {
    headers: authToken() ? { Authorization: `Bearer ${authToken()}` } : {},
  });
  if (res.status === 401) {
    signalSessionExpired();
    throw new Error('[articlesPage] GET /articles-page → session expirée (401)');
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`[articlesPage] GET /articles-page → HTTP ${res.status}${text ? ` — ${text}` : ''}`);
  }
  return res.json();
};
