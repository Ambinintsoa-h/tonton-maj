/**
 * localCache — persistance localStorage ROBUSTE.
 *
 * Principe : **Firestore est la source de vérité**, localStorage n'est qu'un
 * cache d'amorçage rapide. Au démarrage, l'app recharge tout depuis Firestore
 * (App.js) → le cache local peut être allégé, purgé ou vidé SANS perte.
 *
 * Deux garanties :
 *   1. On ne met que l'ESSENTIEL en cache — jamais le HTML des articles ni les
 *      gros textes (audit, analyse), qui feraient exploser le quota (~5 Mo).
 *   2. Toute écriture est TOLÉRANTE AU QUOTA : en cas de dépassement on libère
 *      de la place puis on réessaie, et en dernier recours on échoue en
 *      SILENCE — jamais d'exception (donc plus jamais de page blanche).
 */
import { STORAGE_KEYS } from '../constants/storage';

// Champs lourds retirés des entrées d'historique mises en cache local.
// Le HTML complet vit dans Firebase Storage (via *ContentUrl) ; l'audit et les
// textes de diff sont rechargés depuis Firestore/Storage à l'ouverture.
const HEAVY_HISTORY_FIELDS = ['originalContent', 'updatedContent', 'audit', 'analysis'];

// Plafond d'entrées d'historique gardées en cache local (les plus récentes).
// La liste COMPLÈTE reste en base et est rechargée au démarrage.
const MAX_LOCAL_HISTORY = 150;

// Allège une liste d'historique pour le cache local (voir HEAVY_HISTORY_FIELDS).
export const slimHistoryForCache = (list) =>
  (Array.isArray(list) ? list : [])
    .slice(0, MAX_LOCAL_HISTORY)
    .map((a) => {
      const clean = { ...a };
      for (const f of HEAVY_HISTORY_FIELDS) delete clean[f];
      // updates : ne garder que ce qui sert aux COMPTEURS (applied/pass) — pas
      // les textes original/updated (lourds). Le détail complet vient de Firestore.
      if (Array.isArray(clean.updates)) {
        clean.updates = clean.updates.map((u) => ({ applied: u.applied, pass: u.pass }));
      }
      return clean;
    });

// Allège la file d'attente pour le cache local : retire le HTML de majResult
// (déjà archivé dans l'Historique — rechargé à la réouverture d'un item).
export const slimPendingForCache = (list) =>
  (Array.isArray(list) ? list : []).map((item) => {
    if (!item || !item.majResult) return item;
    const { originalContent, updatedContent, audit, analysis, ...rest } = item.majResult;
    return { ...item, majResult: { ...rest, contentInHistory: true } };
  });

// Libère les caches auxiliaires les plus volumineux (best-effort, une passe) :
// brouillons undo par article (HTML) + gros historiques secondaires. Ne touche
// JAMAIS au token de session ni aux settings.
const freeHeavyStorage = (exceptKey) => {
  const auxHeavy = [STORAGE_KEYS.statsHistory];
  for (const k of auxHeavy) {
    if (k !== exceptKey) { try { localStorage.removeItem(k); } catch { /* ignore */ } }
  }
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith('tonton_undo_')) localStorage.removeItem(k);
    }
  } catch { /* ignore */ }
};

/**
 * setItem tolérant au quota. Retourne true si écrit, false sinon (jamais throw).
 */
export const safeSetItem = (key, value) => {
  const str = typeof value === 'string' ? value : JSON.stringify(value);
  try {
    localStorage.setItem(key, str);
    return true;
  } catch {
    // Quota dépassé → libérer de la place puis réessayer une fois
    freeHeavyStorage(key);
    try {
      localStorage.setItem(key, str);
      return true;
    } catch {
      console.warn(`[localCache] Quota localStorage atteint — "${key}" non mis en cache (Firestore reste la source de vérité)`);
      return false;
    }
  }
};

/**
 * Persiste l'historique en cache local : version ALLÉGÉE + réessais DÉGRESSIFS
 * (liste complète slim → moitié → quart … → vide) jusqu'à ce que ça rentre.
 * Ne lève jamais d'exception.
 */
export const persistHistory = (list) => {
  const slim = slimHistoryForCache(list);
  let freed = false;
  let count = slim.length;
  while (count >= 0) {
    try {
      localStorage.setItem(STORAGE_KEYS.history, JSON.stringify(slim.slice(0, count)));
      return true;
    } catch {
      if (!freed) { freeHeavyStorage(STORAGE_KEYS.history); freed = true; continue; }
      if (count === 0) break;
      count = Math.floor(count / 2);
    }
  }
  console.warn('[localCache] Historique trop volumineux pour le cache local — Firestore reste la source de vérité');
  return false;
};

// Persiste la file d'attente (allégée), tolérant au quota.
export const persistPending = (list) => safeSetItem(STORAGE_KEYS.pending, slimPendingForCache(list));
