// ─────────────────────────────────────────────────────────────────────────────
// modelCallLog.js — client de GET /api/data/model-call-log
// ─────────────────────────────────────────────────────────────────────────────
// Journal PERMANENT (jamais purgé, jamais affecté par resetStats) des appels
// modèle par (article, passe, sous-passe) -- voir migration/alter-add-model-call-log.sql
// et data-api.js (logModelCalls). Sert à afficher/exporter le(s) modèle(s)
// RÉELLEMENT utilisé(s) sur un article, colonne à colonne avec le reste des
// stats "Mes MAJ" (voir exportStatsXlsx.js).
//
// Même pattern que batches.js (helper `api()` isolé, contrat 401 identique) :
// pas de raison de passer par la façade firebase.js/firebase.mysql.js pour une
// feature 100 % MySQL sans équivalent Firestore.
import { signalSessionExpired } from './sessionExpiry';

const authToken = () => sessionStorage.getItem('tonton_auth_token');

const api = async (path) => {
  const res = await fetch('/api/data/model-call-log' + path, {
    method: 'GET',
    headers: { ...(authToken() ? { Authorization: `Bearer ${authToken()}` } : {}) },
  });
  if (res.status === 401) {
    signalSessionExpired();
    throw new Error(`[modelCallLog] GET ${path} → session expirée (401)`);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`[modelCallLog] GET ${path} → HTTP ${res.status}${text ? ` — ${text}` : ''}`);
  }
  return res.json();
};

/**
 * @param {object} [opts]
 * @param {number} [opts.since] — timestamp ms (converti en ISO pour le serveur)
 * @param {number} [opts.until] — timestamp ms
 * @returns {Promise<{ calls:number, articles:number, totalCostUsd:number,
 *   avgCostPerCall:number, avgCostPerArticle:number, rows:Array }>}
 *   `since`/`until` omis → tout l'historique (plafonné à 5000 lignes côté
 *   serveur, ORDER BY logged_at DESC -- même limite déjà acceptée ailleurs
 *   dans l'app pour une recherche sans borne de date, voir batches.js/GET
 *   /batch-items LIMIT 300).
 */
export const listModelCallLog = ({ since, until } = {}) => {
  const params = new URLSearchParams();
  if (since != null) params.set('since', new Date(since).toISOString());
  if (until != null) params.set('until', new Date(until).toISOString());
  const qs = params.toString();
  return api(qs ? `?${qs}` : '');
};
