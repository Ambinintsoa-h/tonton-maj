/**
 * locatePassage.js — RETROUVER un passage cité dans le HTML d'un article.
 *
 * Une source UNIQUE pour les deux écrans qui en ont besoin : le repérage des
 * suggestions d'obsolescence (phase 3, `markSuggestions`) et le bouton « situer »
 * de la relecture (phase 4, `handleLocateStyle`). Ils avaient chacun leur
 * implémentation, et la seconde était une version naïve de la première.
 *
 * ── LE PROBLÈME (piste d'Andrianina, vérifiée par exécution) ──────────────────
 * Les balises INLINE découpent les nœuds texte et faussent `textContent` :
 *
 *   <p>Le prix <em>moyen</em> atteint 60 EUR</p>
 *     → nœuds texte : ["Le prix ", "moyen", " atteint 60 EUR"]
 *     → AUCUN nœud ne contient la phrase : une recherche par nœud échoue toujours
 *       dès qu'un <em> ou un <strong> traverse l'amorce.
 *
 *   <p>Ligne A<br>Ligne B</p>
 *     → textContent = "Ligne ALigne B"   ← les mots sont COLLÉS
 *     → `<br>` ne produit AUCUN caractère. Le passage cité, lui, porte une
 *       séparation. Même le repli par bloc échouait donc.
 *
 *   <p>Comptez 60&nbsp;000 EUR</p>
 *     → textContent porte un vrai U+00A0, alors que l'extrait de `texteDe`
 *       (stylePatterns.js) a déjà converti `&nbsp;` en espace ordinaire.
 *
 *   <p>Tarif <strong>60 EUR</strong>/m2</p>
 *     → textContent = "Tarif 60 EUR/m2", mais `texteDe` remplace chaque balise
 *       par une ESPACE et produit "Tarif 60 EUR /m2" : une espace fantôme.
 *
 * ── LA SOLUTION ───────────────────────────────────────────────────────────────
 * Comparer sur une SIGNATURE d'où TOUTE espace est retirée, des deux côtés. Les
 * quatre cas ci-dessus s'effondrent alors sur la même chaîne. On unifie au passage
 * la typographie (apostrophes et guillemets courbes, tirets longs), qui varie
 * entre le texte publié et le texte cité.
 *
 * Retirer toute espace plutôt que la normaliser est délibéré : c'est le seul
 * traitement qui absorbe `<br>` (zéro caractère) ET l'espace fantôme des balises
 * (un caractère en trop) avec la même règle. Le risque théorique — une amorce qui
 * apparierait par-dessus une frontière de mots — est nul en pratique sur 40 à 45
 * caractères, et un faux positif (on défile au bon endroit à un mot près) est de
 * toute façon bien moins grave qu'un faux négatif (« passage introuvable », le
 * rédacteur cherche à la main).
 */

/**
 * Transformation d'UN caractère vers la signature. Peut rendre '' (l'espace
 * disparaît) — c'est ce qui rend la comparaison insensible au balisage.
 */
const charSignature = (ch) => {
  if (/\s/.test(ch)) return '';          // \s couvre U+00A0 en JS
  if (/[’‘‛´`]/.test(ch)) return "'";
  if (/[“”«»„]/.test(ch)) return '"';
  if (/[–—−]/.test(ch)) return '-';
  return ch;
};

/** Signature comparable d'un texte : sans espaces, typographie unifiée. */
export const passageSignature = (s = '') => {
  let out = '';
  for (const ch of String(s)) out += charSignature(ch);
  return out;
};

/**
 * Signature + table de correspondance vers les index du texte D'ORIGINE.
 * Nécessaire pour surligner la portion EXACTE dans un nœud texte : sans elle, on
 * ne sait pas où commence ni où finit l'appariement dans le texte réel.
 */
const signatureWithMap = (raw = '') => {
  const str = String(raw);
  let sig = '';
  const map = [];
  for (let i = 0; i < str.length; i++) {
    const piece = charSignature(str[i]);
    for (let k = 0; k < piece.length; k++) { sig += piece[k]; map.push(i); }
  }
  return { sig, map };
};

/**
 * Localise `passage` dans `raw` et rend les bornes dans `raw`, ou null.
 * @returns {{start:number, end:number}|null}
 */
export const findPassageInText = (raw = '', passage = '') => {
  const needle = passageSignature(passage);
  if (!needle) return null;
  const { sig, map } = signatureWithMap(raw);
  const at = sig.indexOf(needle);
  if (at === -1) return null;
  return { start: map[at], end: map[at + needle.length - 1] + 1 };
};

/** Le texte contient-il ce passage, balisage et typographie mis à part ? */
export const textContainsPassage = (raw = '', passage = '') => {
  const needle = passageSignature(passage);
  return !!needle && passageSignature(raw).includes(needle);
};

/**
 * Blocs où un passage peut être localisé.
 *
 * La liste précédente (`p, li, h2, h3, h4, td, blockquote`) laissait sans recours
 * un passage vivant dans un `h1`, un `th`, une légende ou un `div` d'habillage —
 * il n'était localisable par AUCUNE des deux phases.
 *
 * `div` est inclus mais dangereux : un conteneur enveloppant tout l'article
 * apparierait n'importe quel passage. D'où la sélection du bloc le PLUS PETIT
 * dans `findBlockForPassage` — jamais le premier venu dans l'ordre du document.
 */
export const LOCATABLE_BLOCK_SEL =
  'p, li, h1, h2, h3, h4, h5, h6, td, th, caption, blockquote, figcaption, dd, dt, div';

/**
 * Bloc le plus SPÉCIFIQUE contenant `passage`.
 *
 * @param {Element} root
 * @param {string}  passage
 * @param {(el: Element) => boolean} [exclude] blocs à écarter (déjà repérés…)
 * @returns {Element|null}
 */
export const findBlockForPassage = (root, passage, exclude) => {
  if (!root || typeof root.querySelectorAll !== 'function') return null;
  const needle = passageSignature(passage);
  if (!needle) return null;
  let best = null;
  let bestLen = Infinity;
  Array.from(root.querySelectorAll(LOCATABLE_BLOCK_SEL)).forEach((b) => {
    if (typeof exclude === 'function' && exclude(b)) return;
    const sig = passageSignature(b.textContent || '');
    if (!sig.includes(needle)) return;
    // Le plus COURT gagne : c'est le bloc réellement porteur, pas son conteneur.
    if (sig.length < bestLen) { best = b; bestLen = sig.length; }
  });
  return best;
};
