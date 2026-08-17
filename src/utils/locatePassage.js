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
 * Marque de SURLIGNAGE TEMPORAIRE d'un passage visé en relecture.
 *
 * Même mécanique que `[data-il-idx]` et `[data-lien-redige]` : un `<mark>` porteur
 * qui est DÉBALISÉ à l'export (src/utils/export.js). C'est la ceinture : le
 * surlignage est retiré au bout de quelques secondes, mais si un autosave passe
 * entre-temps il ne doit surtout pas finir publié.
 */
export const FOCUS_ATTR  = 'data-relecture-focus';
export const FOCUS_CLASS = 'relecture-focus';

/**
 * SURLIGNE un passage dans le DOM et rend la fonction de nettoyage.
 *
 * Le clic sur un pattern de relecture amenait bien au bon endroit, mais entourait
 * tout le BLOC : sur un paragraphe de 60 mots, le rédacteur devait encore chercher
 * lequel remplacer. On surligne donc le terme lui-même quand il est connu, et le
 * passage entier sinon.
 *
 * @param {Element} root
 * @param {string}  passage  la phrase repérée (sert à borner la recherche)
 * @param {string}  [terme]  le mot fautif, s'il est connu — c'est LUI qu'on surligne
 * @returns {{el: Element|null, cleanup: function}}
 */
export const highlightPassage = (root, passage, terme = '') => {
  const rien = { el: null, cleanup: () => {} };
  if (!root || typeof root.querySelectorAll !== 'function') return rien;
  const bloc = findBlockForPassage(root, passage);
  if (!bloc) return rien;

  // Le terme est cherché DANS le passage repéré, pas dans tout le bloc : un mot
  // courant (« reste », « offre ») apparaîtrait ailleurs et on surlignerait la
  // mauvaise occurrence.
  const cible = String(terme || '').trim() || passage;
  const noeuds = [];
  const walker = document.createTreeWalker(bloc, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = walker.nextNode())) noeuds.push(n);

  let sig = '';
  const map = [];
  noeuds.forEach((node, ni) => {
    const s = node.nodeValue || '';
    for (let i = 0; i < s.length; i++) {
      const piece = charSignature(s[i]);
      for (let k = 0; k < piece.length; k++) { sig += piece[k]; map.push({ ni, off: i }); }
    }
  });

  // Position du passage, puis du terme À L'INTÉRIEUR de ce passage.
  const sigPassage = passageSignature(passage);
  const sigCible   = passageSignature(cible);
  if (!sigCible) return rien;
  const base = sigPassage ? sig.indexOf(sigPassage) : 0;
  const dans = sigCible === sigPassage ? 0 : sigPassage.indexOf(sigCible);
  const at = base >= 0 && dans >= 0 ? base + dans : sig.indexOf(sigCible);
  if (at < 0) return rien;

  const debut = map[at];
  const fin   = map[at + sigCible.length - 1];
  if (!debut || !fin) return rien;

  const range = document.createRange();
  try {
    range.setStart(noeuds[debut.ni], debut.off);
    range.setEnd(noeuds[fin.ni], fin.off + 1);
  } catch { return rien; }

  const marque = document.createElement('mark');
  marque.className = FOCUS_CLASS;
  marque.setAttribute(FOCUS_ATTR, '1');
  try { range.surroundContents(marque); }
  catch {
    // Bornes à cheval sur des balises : on retombe sur le passage entier plutôt
    // que de ne rien montrer.
    try {
      marque.appendChild(range.extractContents());
      range.insertNode(marque);
    } catch { return rien; }
  }

  return {
    el: marque,
    cleanup: () => {
      if (!marque.parentNode) return;
      const parent = marque.parentNode;
      while (marque.firstChild) parent.insertBefore(marque.firstChild, marque);
      parent.removeChild(marque);
      if (typeof parent.normalize === 'function') parent.normalize();
    },
  };
};

/**
 * Éléments qu'un remplacement de texte ne doit JAMAIS emporter.
 *
 * `a` d'abord : supprimer un lien EXTERNE est interdit sans exception (règle 8 du
 * projet), et ce chemin ne passe ni par `enforceExternalLinkPolicy` ni par aucun
 * autre verrou — la perte serait donc silencieuse. Les médias suivent la même
 * logique : une correction de style n'a aucune raison de supprimer une image.
 */
const PROTEGE_DANS_LA_PLAGE = 'a,img,iframe,video,audio,figure';

/**
 * REMPLACE `avant` par `apres` dans le DOM, même quand le passage traverse des
 * balises inline.
 *
 * Pourquoi cette fonction existe : accepter une correction de style faisait
 * `innerHTML.includes(avant)` — or `avant` est du TEXTE NU (les extraits viennent
 * de `texteDe`, qui retire les balises). Dès que la phrase contenait un `<em>`, un
 * `<strong>` ou un `<br>`, elle n'apparaissait pas telle quelle dans le HTML et la
 * correction était REFUSÉE. Les phrases de plus de 20 mots étant les plus longues,
 * ce sont précisément celles qui portent une balise — donc celles qui échouaient.
 *
 * Le balisage inline PUREMENT DÉCORATIF présent dans la plage remplacée disparaît :
 * c'est inévitable, la phrase corrigée est un texte neuf où les positions du gras
 * n'ont plus de sens. Ce qui est protégé, en revanche, ne l'est jamais : un passage
 * contenant un lien ou un média est REFUSÉ, avec son motif.
 *
 * @returns {{ok: true} | {ok: false, reason: 'introuvable'|'protege'}}
 */
export const replacePassageInDom = (root, avant, apres) => {
  if (!root || typeof root.querySelectorAll !== 'function') return { ok: false, reason: 'introuvable' };
  const needle = passageSignature(avant);
  if (!needle || typeof apres !== 'string') return { ok: false, reason: 'introuvable' };

  const bloc = findBlockForPassage(root, avant);
  if (!bloc) return { ok: false, reason: 'introuvable' };

  // Signature de TOUT le bloc, nœud texte par nœud texte, avec le chemin de retour
  // vers (nœud, offset) : c'est ce qui permet de borner une plage qui traverse
  // plusieurs balises.
  const noeuds = [];
  const walker = document.createTreeWalker(bloc, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = walker.nextNode())) noeuds.push(n);

  let sig = '';
  const map = [];
  noeuds.forEach((node, ni) => {
    const s = node.nodeValue || '';
    for (let i = 0; i < s.length; i++) {
      const piece = charSignature(s[i]);
      for (let k = 0; k < piece.length; k++) { sig += piece[k]; map.push({ ni, off: i }); }
    }
  });

  const at = sig.indexOf(needle);
  if (at === -1) return { ok: false, reason: 'introuvable' };
  const debut = map[at];
  const fin   = map[at + needle.length - 1];
  if (!debut || !fin) return { ok: false, reason: 'introuvable' };

  const range = document.createRange();
  try {
    range.setStart(noeuds[debut.ni], debut.off);
    range.setEnd(noeuds[fin.ni], fin.off + 1);
  } catch { return { ok: false, reason: 'introuvable' }; }

  // Un lien ou un média dans la plage : on REFUSE plutôt que de le détruire.
  const copie = range.cloneContents();
  if (copie.querySelector && copie.querySelector(PROTEGE_DANS_LA_PLAGE)) {
    return { ok: false, reason: 'protege' };
  }

  range.deleteContents();
  range.insertNode(document.createTextNode(apres));

  // Balises inline vidées par le remplacement : un `<em></em>` résiduel n'a plus
  // d'objet. On ne touche QUE le décoratif, et seulement s'il ne reste rien dedans.
  Array.from(bloc.querySelectorAll('em,strong,i,b,u,span')).forEach((e) => {
    if (!(e.textContent || '').trim() && !e.querySelector('img,br,a')) e.remove();
  });
  if (typeof bloc.normalize === 'function') bloc.normalize();
  return { ok: true };
};

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
