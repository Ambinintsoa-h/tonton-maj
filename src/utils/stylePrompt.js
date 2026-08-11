/**
 * stylePrompt.js — moitié IA de la correction des patterns (PHASE 4).
 *
 * `styleFixes.js` traite ce qui est calculable sans comprendre la phrase (tirets,
 * adverbes). Reste ce qui exige du sens : verbes interdits, participe présent,
 * voix passive, phrases trop longues, clichés, méta-commentaires. Un verbe
 * n'a pas de remplaçant universel — « s'impose » devient « domine », « revient »
 * ou « fait référence » selon ce que la phrase dit.
 *
 * Un SEUL appel pour tout l'article : envoyer 79 occurrences une par une
 * coûterait 79 appels pour un résultat moins cohérent.
 *
 * Contrat volontairement étroit : l'IA renvoie, pour chaque occurrence numérotée,
 * la phrase réécrite — rien d'autre. Pas de commentaire, pas de reformulation du
 * paragraphe : la phase 4 corrige des patterns, elle ne réécrit pas l'article.
 */
import { AI_IDS } from './styleFixes';

/** Consigne par règle — ce que l'IA doit faire, pas seulement ce qu'elle doit éviter. */
const CONSIGNE = {
  verbes:     'Remplace le verbe fade par un verbe précis et concret, sans changer le sens.',
  participes: 'Reformule le participe présent en verbe conjugué (« qui permet », « il évite »).',
  passive:    'Mets le sujet en action : « Google indexe la page » plutôt que « la page est indexée par Google ».',
  phrases:    'Coupe en deux phrases, ou raccourcis sous 20 mots, sans rien perdre du contenu.',
  cliches:    'Supprime la formule creuse et garde uniquement l\'information.',
  meta:       'Supprime le méta-commentaire et garde l\'information factuelle.',
};

const LIGNE = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();

/**
 * Aplati les anomalies en une liste d'occurrences numérotées, en ne gardant que
 * celles qui relèvent de l'IA.
 * @returns {Array<{n:number, id:string, terme:string, extrait:string}>}
 */
export const flattenAiOccurrences = (findings = []) => {
  const out = [];
  (Array.isArray(findings) ? findings : []).forEach((f) => {
    if (!f || !AI_IDS.includes(f.id)) return;
    (Array.isArray(f.exemples) ? f.exemples : []).forEach((ex) => {
      const extrait = LIGNE(ex && ex.extrait);
      if (!extrait) return;
      out.push({ n: out.length + 1, id: f.id, terme: LIGNE(ex.terme), extrait });
    });
  });
  return out;
};

/**
 * Construit le prompt. Les occurrences sont numérotées : c'est ce numéro qui
 * permettra de rattacher chaque réponse à son passage, sans dépendre d'une
 * correspondance de texte approximative.
 */
export const buildStyleFixPrompt = (occurrences = []) => {
  const liste = Array.isArray(occurrences) ? occurrences : [];
  if (!liste.length) return '';
  const parRegle = {};
  liste.forEach((o) => { (parRegle[o.id] = parRegle[o.id] || []).push(o); });

  const blocs = Object.entries(parRegle).map(([id, occ]) => {
    const lignes = occ.map((o) => `${o.n}. ${o.terme ? `[${o.terme}] ` : ''}${o.extrait}`);
    return [`## ${CONSIGNE[id] || 'Corrige le passage.'}`, ...lignes].join('\n');
  });

  return [
    'Tu corriges des PATTERNS D\'ÉCRITURE dans un article déjà rédigé.',
    '',
    'Règles absolues :',
    '- Réécris UNIQUEMENT la phrase fournie, jamais le paragraphe autour.',
    '- Ne change aucun chiffre, aucune date, aucun nom propre, aucune unité.',
    '- N\'ajoute ni ne supprime aucun lien.',
    '- Si une phrase est déjà correcte, renvoie-la à l\'identique.',
    '',
    ...blocs,
    '',
    'Réponds UNIQUEMENT par un tableau JSON, sans texte autour :',
    '[{ "n": 1, "apres": "la phrase réécrite" }]',
  ].join('\n');
};

/**
 * Rattache les réponses de l'IA aux occurrences, par NUMÉRO.
 *
 * Écarte silencieusement ce qui n'est pas exploitable — numéro inconnu, réponse
 * vide, ou proposition identique à l'original (rien à accepter). Une proposition
 * absurdement plus longue que la phrase d'origine est aussi écartée : c'est le
 * signe que le modèle a réécrit le paragraphe malgré la consigne.
 */
export const normalizeStyleProposals = (brut, occurrences = []) => {
  const parNum = new Map((Array.isArray(occurrences) ? occurrences : []).map((o) => [o.n, o]));
  const items = Array.isArray(brut) ? brut : (brut && Array.isArray(brut.propositions) ? brut.propositions : []);
  const out = new Map();
  items.forEach((it) => {
    if (!it) return;
    const n = Number(it.n);
    const occ = parNum.get(n);
    const apres = LIGNE(it.apres);
    if (!occ || !apres) return;
    if (apres === occ.extrait) return;                      // rien à corriger
    if (apres.length > occ.extrait.length * 2.5 + 40) return; // le modèle a débordé
    out.set(n, { n, id: occ.id, avant: occ.extrait, apres });
  });
  return [...out.values()];
};
