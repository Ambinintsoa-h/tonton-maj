// ── Réécriture Gemini — clé PERSONNELLE par utilisateur ──────────────────────
// La clé API Gemini (gratuite, liée au compte Google : aistudio.google.com →
// « Get API key ») est stockée en LOCAL sur le poste (localStorage) — jamais
// dans Firestore (les profils sont lisibles par tous les membres authentifiés).
// L'appel passe par le proxy (/api/gemini/rewrite) : le navigateur ne parle
// jamais à Google directement (CSP conservée), la clé transite par requête et
// n'est jamais stockée côté serveur.
import axios from 'axios';

const KEY_STORAGE = 'tonton_gemini_key';

export const getGeminiKey = () => {
  try { return localStorage.getItem(KEY_STORAGE) || ''; } catch { return ''; }
};

export const setGeminiKey = (key) => {
  try {
    const k = (key || '').trim();
    if (k) localStorage.setItem(KEY_STORAGE, k);
    else localStorage.removeItem(KEY_STORAGE);
  } catch { /* stockage indisponible — la clé sera redemandée */ }
};

// Modèles de prompts préfabriqués — alignés sur les règles d'écriture de
// l'équipe (skills « Style d'écriture ») : voix active, phrases ≤ 20 mots,
// pas de participe présent, pas de tirets cadratins, pas de formules IA.
const COMMON_RULES = `Règles impératives : même sens et mêmes informations, même langue, voix active uniquement, phrases de 20 mots maximum, aucun participe présent, aucun tiret cadratin (—) ni demi-cadratin (–), aucune formule creuse (« il est important de noter »…). Réponds UNIQUEMENT avec le texte réécrit, sans commentaire, sans guillemets d'encadrement.`;

export const GEMINI_PRESETS = [
  { id: 'fluide', label: 'Fluidifier — plus naturel',
    prompt: `Réécris ce texte pour le rendre plus fluide et naturel, comme écrit par un rédacteur humain expérimenté. ${COMMON_RULES}` },
  { id: 'humain', label: 'Ton humain (anti-IA)',
    prompt: `Ce texte sonne « écrit par une IA ». Réécris-le avec un ton humain et conversationnel : tournures directes, rythme varié, zéro jargon marketing. ${COMMON_RULES}` },
  { id: 'court', label: 'Raccourcir (−30 %)',
    prompt: `Réécris ce texte en le raccourcissant d'environ un tiers : retire les redondances et le remplissage, garde toutes les informations concrètes (chiffres, noms, faits). ${COMMON_RULES}` },
  { id: 'simple', label: 'Simplifier',
    prompt: `Réécris ce texte pour un lecteur pressé : vocabulaire simple, une idée par phrase. ${COMMON_RULES}` },
];

/** Appelle Gemini via le proxy. Retourne le texte réécrit. Lève une Error à message lisible. */
export const geminiRewrite = async ({ key, text, instruction }) => {
  try {
    const r = await axios.post('/api/gemini/rewrite', { key, text, instruction }, { timeout: 45000 });
    return (r.data?.text || '').trim();
  } catch (e) {
    throw new Error(e.response?.data?.error || 'Erreur Gemini — réessayez.');
  }
};
