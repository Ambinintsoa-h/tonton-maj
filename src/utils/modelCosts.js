// Coût moyen d'une passe du registre IA (MODEL_PASSES, agent.js), mesuré sur
// les N derniers articles qui l'ont exercée — utilisé par le panneau
// superadmin (Parametres.jsx) pour éclairer le choix de modèle par passe.

// Un seul littéral pour le calcul ET le texte affiché à l'écran — deux
// nombres qui divergent silencieusement seraient pires qu'un seul.
export const N_RECENTS = 20;

/**
 * `history` vient de statsSlice (déjà trié du plus récent au plus ancien —
 * unshift à chaque nouvel article). Une moyenne sur les DERNIERS articles
 * plutôt que sur tout l'historique : un cumul depuis toujours mélangerait
 * l'ancien modèle et le nouveau si le choix a changé, et donnerait une
 * moyenne qui ne reflète plus le réglage actuel.
 *
 * Retourne `null` si aucun article de l'historique ne porte de détail pour
 * cette passe (jamais exercée, ou tout l'historique date d'avant le
 * dispositif de labellisation par passe).
 */
export const recentAvgForPass = (history, passId, n = N_RECENTS) => {
  const withPass = (history || []).filter(h => h.byPass && h.byPass[passId]).slice(0, n);
  if (!withPass.length) return null;
  const total = withPass.reduce((s, h) => s + (h.byPass[passId].costUsd || 0), 0);
  return { avg: total / withPass.length, n: withPass.length };
};
