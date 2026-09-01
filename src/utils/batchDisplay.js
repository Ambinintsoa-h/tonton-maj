/**
 * batchDisplay.js — mise en forme partagée pour tout ce qui affiche des
 * `batch_items` (coût, durée, statut) : LotsBatch.jsx ("MAJ en lot") et
 * MajEnAttente.jsx ("Mes MAJ"). Extrait de LotsBatch.jsx (chantier "Mes MAJ",
 * septembre 2026) pour que les deux écrans ne dérivent jamais l'un de
 * l'autre sur ce qui est, au fond, la même donnée présentée deux fois.
 */

export const fmtDate = (ts) => {
  if (!ts) return '—';
  try {
    return new Date(ts).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch { return '—'; }
};

export const fmtDuration = (ms) => {
  if (ms == null || ms < 0) return '—';
  const totalSec = Math.round(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return min > 0 ? `${min} min ${sec}s` : `${sec}s`;
};

export const fmtCost = (usd) => (usd == null ? '—' : `$${usd < 0.01 ? usd.toFixed(4) : usd.toFixed(2)}`);

export const BATCH_STATUS_META = {
  pending: { label: 'En attente', color: 'text-amber-600  bg-amber-50  border-amber-200' },
  running: { label: 'En cours',   color: 'text-blue-600   bg-blue-50   border-blue-200' },
  done:    { label: 'Terminé',    color: 'text-emerald-600 bg-emerald-50 border-emerald-200' },
  error:   { label: 'Erreur',     color: 'text-red-600    bg-red-50    border-red-200' },
};

export const ITEM_STATUS_META = {
  en_attente: { label: 'En attente', color: 'text-amber-600  bg-amber-50  border-amber-200' },
  en_cours:   { label: 'En cours',   color: 'text-blue-600   bg-blue-50   border-blue-200' },
  fait:       { label: 'Fait',       color: 'text-emerald-600 bg-emerald-50 border-emerald-200' },
  erreur:     { label: 'Erreur',     color: 'text-red-600    bg-red-50    border-red-200' },
  a_revoir:   { label: 'À revoir',   color: 'text-purple-600 bg-purple-50 border-purple-200' },
};

// ── "Mes MAJ" : distingue "à relire" de "publié", que batch_items seul ne
// sait pas dire (son statut 'fait' veut juste dire "prêt pour la relecture
// humaine" -- la publication est un fait distinct, tracé dans article_time).
export const DISPLAY_STATUS = {
  a_traiter: { key: 'a_traiter', label: 'À traiter', color: 'text-amber-600  bg-amber-50  border-amber-200' },
  a_relire:  { key: 'a_relire',  label: 'À relire',   color: 'text-blue-600   bg-blue-50   border-blue-200' },
  publie:    { key: 'publie',    label: 'Publié',     color: 'text-emerald-600 bg-emerald-50 border-emerald-200' },
  erreur:    { key: 'erreur',    label: 'Erreur',     color: 'text-red-600    bg-red-50    border-red-200' },
};

/**
 * @param {{status:string, publishedAt?:number|null}} item
 * @returns {keyof typeof DISPLAY_STATUS}
 */
export const deriveDisplayStatus = (item) => {
  if (item.status === 'erreur' || item.status === 'a_revoir') return 'erreur';
  if (item.status === 'fait') return item.publishedAt ? 'publie' : 'a_relire';
  return 'a_traiter'; // en_attente | en_cours
};

/**
 * Regroupe une liste de batch_items (avec costUsd/completedAt) par jour local
 * (YYYY-MM-DD, fuseau du lecteur -- pas UTC, pour ne pas décaler les articles
 * traités près de minuit). Jours triés du plus récent au plus ancien.
 * @returns {Array<{day:string, count:number, costUsd:number}>}
 */
export const groupCostByDay = (items) => {
  const byDay = new Map();
  items.forEach((it) => {
    const ts = it.completedAt || it.startedAt;
    if (!ts) return;
    const d = new Date(ts);
    const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const entry = byDay.get(day) || { day, count: 0, costUsd: 0 };
    entry.count += 1;
    entry.costUsd += it.costUsd || 0;
    byDay.set(day, entry);
  });
  return [...byDay.values()].sort((a, b) => (a.day < b.day ? 1 : -1));
};
