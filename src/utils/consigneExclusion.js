/**
 * LA CONSIGNE EXCLUT D'AUTRES SAISONS : ON VÉRIFIE QU'ELLES SONT PARTIES.
 *
 * Mesuré en production le 25/11/2026 (lemondedesartisans.fr, « La meilleure
 * boulangerie de France », refonte), consigne « ne parle pas des autres saisons
 * mais seulement de cette année ». La règle ajoutée au prompt (PR #424) n'a pas
 * suffi : l'article généré gardait une section entière « La saison 10, un repère
 * pour comprendre le programme », avec son tableau, et une phrase sur « le gagnant
 * de la saison 10 ». Un prompt n'est jamais une garantie : on MESURE, puis on
 * relance une fois — même principe que `consigneCibles.js`.
 *
 * POURQUOI UN JUGE ET PAS UN MOTIF : « autre saison » n'a pas de définition
 * mécanique. La saison en cours s'écrit « saison 2026 », « treizième édition » ou
 * « saison 13 » dans le même article ; un compte de numéros accuserait la saison
 * demandée. La détection du PÉRIMÈTRE (la consigne exclut-elle d'autres saisons ?)
 * est en code ; le JUGEMENT (ce passage parle-t-il d'une autre saison ?) est
 * confié à un petit modèle, dont chaque citation est ensuite VÉRIFIÉE mot pour mot
 * dans le texte (`verifierCitations`) : une citation inventée ne déclenche rien.
 *
 * Ce module est PUR et AUTONOME (aucun import). L'appel au modèle et la décision
 * de relancer vivent dans `agentQat.js`.
 *
 * Ce que ce contrôle NE fait PAS : supprimer lui-même. Une section retirée par du
 * code pourrait emporter un lien externe (règle 8 : jamais supprimer un lien
 * externe). C'est le modèle qui retire, et le verrou externe valide le résultat.
 */

/** Une seule relance : chaque relance coûte une génération complète (~1 min). */
export const MAX_RELANCES_EXCLUSION = 1;
/** Passages cités au plus dans la reprise : au-delà, le prompt devient un cahier de doléances. */
export const MAX_PASSAGES_EXCLUS = 8;
/** Une citation plus courte n'est pas vérifiable (« saison 10 » seul tomberait partout). */
const MIN_CARS_CITATION = 25;

const sansAccents = (s = '') => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Minuscules, sans accents, apostrophes et ponctuation en espaces, espaces condensés. */
const normaliser = (s = '') => sansAccents(s).toLowerCase()
  .replace(/[’'`]/g, ' ')
  .replace(/[^a-z0-9\s]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

// Une négation ou une restriction, puis — sans changer de phrase — « autre(s) saison(s) ».
// Les trois noms (saison, édition, année) : la consigne peut parler de l'un ou de l'autre.
const NOM = '(?:saisons?|editions?|annees?)';
// « autres saisons » / « anciennes éditions » ET « saisons précédentes » / « éditions passées ».
const AUTRES = `(?:(?:autres?|precedent\\w*|ancienn?\\w*|passe\\w*)\\s+${NOM}|${NOM}\\s+(?:precedent\\w*|passe\\w*|anterieur\\w*|ancienn?\\w*))`;
const NEGATION_AVANT = new RegExp(
  `\\b(?:ne\\s+parl\\w*|ne\\s+cit\\w*|ne\\s+mentionn\\w*|n\\s+evoqu\\w*|pas|sans|evit\\w*|exclu\\w*|retir\\w*|supprim\\w*|enleve\\w*)\\b(?:(?!oubli|aussi|egalement|compar|rappel)[^.;\\n]){0,60}\\b${AUTRES}\\b`,
);
// « seulement / uniquement de cette année », « que de la saison en cours ».
const RESTRICTION = /\b(?:seulement|uniquement|exclusivement)\s+(?:de\s+|sur\s+|pour\s+)?(?:cette|la\s+presente|la\s+derniere|l\s*actuelle|la\s+saison\s+(?:en\s+cours|actuelle))\s*(?:annee|saison|edition)?\b/;

/**
 * La consigne demande-t-elle de NE PAS parler des autres saisons / éditions ?
 * « parle aussi des autres saisons » (sans négation) ne déclenche rien.
 */
export const detecterExclusionSaisons = (consigne = '') => {
  // Les points et points-virgules sont GARDÉS : les motifs ci-dessous s'arrêtent à la
  // fin de la phrase (une négation d'une phrase ne vise pas l'exclusion de la suivante).
  const t = sansAccents(String(consigne || '')).toLowerCase()
    .replace(/[’'`]/g, ' ').replace(/[^a-z0-9\s.;]/g, ' ').replace(/[ \t]+/g, ' ').trim();
  if (!t) return false;
  // Par proposition : « n'oublie pas de parler des autres saisons » contient une
  // négation, mais demande l'inverse d'une exclusion.
  return t.split(/[.;\n]/).some((p) => !/oubli/.test(p) && (NEGATION_AVANT.test(p) || RESTRICTION.test(p)));
};

/**
 * Ne garde que les citations que le modèle-juge a réellement reprises du texte :
 * ≥ 25 caractères et présentes mot pour mot (casse, accents et ponctuation
 * ignorés) dans l'article. Dédoublonne et borne à `MAX_PASSAGES_EXCLUS`.
 * @param {string} texteArticle article sans balises
 * @param {Array<{citation?:string}|string>} citations réponse brute du juge
 * @returns {string[]} citations vérifiées, telles qu'écrites par le juge
 */
export const verifierCitations = (texteArticle = '', citations = []) => {
  const corps = normaliser(texteArticle);
  if (!corps || !Array.isArray(citations)) return [];
  const vues = new Set();
  const gardees = [];
  citations.forEach((c) => {
    const brut = String(typeof c === 'string' ? c : (c && c.citation) || '').replace(/[…]|\.{3}/g, ' ').trim();
    const n = normaliser(brut);
    if (n.length < MIN_CARS_CITATION || vues.has(n) || !corps.includes(n)) return;
    vues.add(n);
    gardees.push(brut.replace(/\s+/g, ' '));
  });
  return gardees.slice(0, MAX_PASSAGES_EXCLUS);
};

/**
 * Bloc ajouté au message utilisateur de la relance : nomme les passages qui
 * restent, dit quoi en faire, et rappelle que le verrou des liens externes ne bouge pas.
 */
export const repriseExclusion = (passages = []) => `

## ═══ REPRISE — LA CONSIGNE EXCLUT LES AUTRES SAISONS ET ILS SONT RESTÉS ═══
La génération précédente a été REJETÉE : la consigne demande de ne PAS parler des
autres saisons, et ces passages parlent encore d'une saison autre que celle
demandée :
${passages.map((p) => `    « ${p} »`).join('\n')}

Reprends la rédaction et RETIRE tout ce qui traite d'une autre saison : le titre,
les paragraphes, les lignes de tableau, les questions de FAQ et les phrases qui
la racontent — la section ENTIÈRE si elle ne parle que de cela. Ne la remplace pas
par un contenu inventé : l'article se resserre sur la saison demandée.
Une phrase qui situe la saison demandée sans développer une autre (« arrivée cette
saison ») peut rester.
Si un passage retiré portait un lien EXTERNE de l'article d'origine, reprends ce
lien (même href, même ancre) dans une phrase conservée de la saison demandée :
aucun lien externe ne doit disparaître. Le reste suit les mêmes règles qu'avant.`;

/** Consigne envoyée au juge : tout est dans le message, rien n'est supposé. */
export const promptJugeExclusion = (consigne, texteArticle) => `Consigne de l'équipe pour cet article :
${String(consigne || '').slice(0, 1200)}

Cette consigne demande de NE PAS parler des autres saisons / éditions, seulement de la saison (ou de l'année) qu'elle désigne.

Article généré (texte brut) :
${String(texteArticle || '').slice(0, 24000)}

Liste les passages de l'article qui DÉVELOPPENT une saison ou une édition AUTRE que celle que la consigne désigne : titre de section, phrase qui raconte son déroulement, son gagnant, ses candidats ou ses chiffres, ligne de tableau, question de FAQ. Ne liste PAS :
- une mention qui situe seulement la saison demandée (« arrivée cette saison », « depuis la saison précédente » en une demi-phrase) ;
- l'histoire d'une PERSONNE ou du jury qui ne raconte pas une autre saison ;
- ce dont tu n'es pas sûr : dans le doute, ne liste pas.

Pour chaque passage, recopie un extrait EXACT du texte (mêmes mots, 8 à 25 mots, sans rien changer). Réponds UNIQUEMENT par un JSON : {"passages":[{"citation":"extrait exact"}]} — ou {"passages":[]} si l'article est conforme.`;
