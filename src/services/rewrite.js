// ── Réécriture d'un passage — prompts préfabriqués + mémoire des consignes ───
// Les modèles sont alignés sur les règles d'écriture de l'équipe (skills
// « Style d'écriture ») : voix active, phrases ≤ 20 mots, pas de participe
// présent, pas de tirets cadratins, pas de formules IA. Les consignes
// personnalisées tapées par l'utilisateur sont mémorisées sur le poste et la
// dernière est proposée automatiquement à la prochaine ouverture.

const HISTORY_KEY = 'tonton_rewrite_prompts';
const HISTORY_MAX = 5;

export const REWRITE_PRESETS = [
  { id: 'fluide', label: 'Fluidifier — plus naturel',
    prompt: 'Réécris ce texte pour le rendre plus fluide et naturel, comme écrit par un rédacteur humain expérimenté.' },
  { id: 'humain', label: 'Ton humain (anti-IA)',
    prompt: 'Ce texte sonne « écrit par une IA ». Réécris-le avec un ton humain et conversationnel : tournures directes, rythme varié, zéro jargon marketing.' },
  { id: 'court', label: 'Raccourcir (−30 %)',
    prompt: 'Réécris ce texte en le raccourcissant d\'environ un tiers : retire les redondances et le remplissage, garde toutes les informations concrètes (chiffres, noms, faits).' },
  { id: 'simple', label: 'Simplifier',
    prompt: 'Réécris ce texte pour un lecteur pressé : vocabulaire simple, une idée par phrase.' },
];

/** Consignes personnalisées récentes — la plus récente d'abord (max 5). */
export const getRecentPrompts = () => {
  try {
    const list = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    return Array.isArray(list) ? list.filter(p => typeof p === 'string' && p.trim()).slice(0, HISTORY_MAX) : [];
  } catch { return []; }
};

/** Mémorise une consigne tapée (dédupliquée, plafonnée, la plus récente en tête). */
export const rememberPrompt = (prompt) => {
  const t = (prompt || '').trim();
  if (!t) return;
  try {
    const list = [t, ...getRecentPrompts().filter(p => p !== t)].slice(0, HISTORY_MAX);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
  } catch { /* stockage indisponible — la mémoire des consignes est best-effort */ }
};
