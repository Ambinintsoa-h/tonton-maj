// ── OÙ UN LIEN NE DOIT JAMAIS ÊTRE POSÉ — règle unique, partagée R1 / R2 ──────
//
// Deux mécanismes posent des liens dans le texte SANS aucun appel IA :
//   • R1 — `carryOverInternalLinks` (src/utils/diff.js) ré-enveloppe l'ancre d'un
//     lien interne de l'article d'origine que la refonte a délié ;
//   • R2 — `weaveBriefLinks` (src/utils/internalWeave.js) tisse, et au besoin
//     RÉDIGE, les paires du brief.
//
// Les deux doivent respecter les MÊMES interdits — ceux affichés au rédacteur
// (QatBriefFields) et envoyés au modèle (agentQat) : jamais dans un titre, le
// TL;DR, le sommaire, un tableau, la FAQ, une citation ou une légende. R2 se les
// était écrits pour lui seul et R1 ne connaissait que « déjà lié » et « en
// instance de suppression » : deux règles pour un même interdit, donc un des deux
// chemins violait la règle affichée au rédacteur (liens posés dans un tableau,
// une FAQ, un h2, un blockquote — constaté par exécution en relecture).
//
// Ce module est cette règle, écrite UNE fois. Aucune dépendance : il est importé
// par diff.js (qui n'importait rien) comme par internalWeave.js, sans cycle.
//
// DEUX NIVEAUX, et la nuance est volontaire :
//   • NO_LINK_TAG_SEL    — un lien NOUVEAU (R2, brief) : tout est interdit ;
//   • NEVER_LINK_TAG_SEL — une REPRISE (R1, le lien existait AVANT) : un tableau
//     redevient acceptable en dernier recours, parce qu'un lien préexistant a
//     très bien pu vivre dans une cellule et que le perdre serait pire que de le
//     remettre là où son texte se trouve désormais. Le reste (titre, FAQ,
//     citation, légende, code) reste interdit : c'est ce qu'on promet au
//     rédacteur et au modèle, et R1 n'a pas à faire exception.

// Cellules et structure de tableau — seul interdit LEVÉ pour une reprise (R1).
export const TABLE_SEL = 'table,thead,tbody,tfoot,tr,td,th,caption';

// Interdits qui valent TOUJOURS, reprise comprise :
//   `a`            un lien dans un lien n'existe pas ;
//   `del`          texte en instance de suppression : le lien partirait avec ;
//   `ins`, `mark`  diff non encore arbitré — et `ins.added-content` est purement
//                  supprimé à l'export : le lien serait perdu à la publication ;
//   `[data-il-idx]`     surlignage d'un lien interne SUGGÉRÉ non validé, débalisé
//                  à l'export → un lien posé dedans disparaîtrait ;
//   `[data-lien-redige]` clause déjà écrite par le code : on n'empile pas ;
//   titres, `summary`, `details` : interdits par la règle métier affichée au
//                  rédacteur (QatBriefFields) et envoyée au modèle (agentQat) ;
//   `figure`, `figcaption`, `code`, `pre`, `blockquote` : une légende, un extrait
//                  de code ou une CITATION ne sont pas du texte rédactionnel — y
//                  glisser un lien le mettrait dans la bouche de la source citée ;
//   `[data-media-*]`    overlays et wrappers de l'éditeur, jamais publiés tels quels.
export const NEVER_LINK_TAG_SEL = [
  'a', 'del', 'ins', 'mark', '[data-il-idx]', '[data-lien-redige]',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'summary', 'details',
  'figure', 'figcaption', 'code', 'pre', 'blockquote',
  '[data-media-type]', '[data-media-overlay]',
].join(',');

/** Interdits d'un lien NOUVEAU (R2) : les précédents + toute la structure de tableau. */
export const NO_LINK_TAG_SEL = `${NEVER_LINK_TAG_SEL},${TABLE_SEL}`;

// Un `<p>` PARENT d'un diff en attente n'est pas détecté par `closest` (qui
// remonte, il ne descend pas) : il faut le tester dans l'autre sens. Sans ça, une
// clause écrite dans un `<p>` réduit à un `<ins class="added-content">` finissait
// publiée SEULE, tout le reste du paragraphe ayant été supprimé à l'export —
// « <p> À lire aussi : … </p> », espace initial compris (constaté par exécution).
// Volontairement limité aux diffs EN ATTENTE : `[data-il-idx]` et
// `[data-lien-redige]` sont seulement débalisés à l'export, le texte survit.
const BLOCKING_DESCENDANT_SEL = 'ins,mark,del';

/** Le bloc contient-il un diff en attente (ins/mark/del), quelque part en dessous ? */
export const hasBlockingDescendant = (el) =>
  !!el && typeof el.querySelector === 'function' && !!el.querySelector(BLOCKING_DESCENDANT_SEL);

// ── OBSERVATION (constat), pas placement ──────────────────────────────────────
// Emplacements NON CONFORMES d'un lien de maillage tel qu'on le CONSTATE dans un
// HTML déjà produit — typiquement un lien du brief que l'IA a posé dans un titre
// ou un tableau. On ne peut pas réutiliser NO_LINK_TAG_SEL tel quel : il contient
// `a` (le lien constaté EST un `a`) et `[data-lien-redige]` (une clause écrite par
// le code est un emplacement VOULU, pas une faute).
export const MISPLACED_LINK_SEL = [
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'summary', 'details',
  'figure', 'figcaption', 'code', 'pre', 'blockquote', TABLE_SEL,
].join(',');

// Titres des sections à emplacement imposé — MIROIR de diff.js (`FAQ_TITLE_RX` /
// `TLDR_TITLE_RX`, privées à ce module) + le sommaire, qui n'est qu'une liste
// d'ancres locales et n'accueille aucun lien de maillage.
const ZONE_TITLE_RX = /faq|questions?\s+fr[ée]quentes|foire aux questions|r[ée]sum[ée] de l'article|tl\s*;?\s*dr|sommaire|table des mati[èe]res/i;

/**
 * Éléments appartenant à une section INTERDITE (FAQ, TL;DR, sommaire).
 *
 * Ces sections ne sont pas des balises : ce sont des TITRES suivis de leur
 * contenu. On part donc de CHAQUE titre du document, à n'importe quelle
 * profondeur, et on marque ses frères suivants jusqu'au prochain titre de niveau
 * supérieur ou égal.
 *
 * Partir des titres et non des enfants de la racine est ce qui fait la
 * différence : un article dont le corps est enveloppé dans un `<div>` masquait
 * entièrement ces zones à la version précédente, et une clause a bien été écrite
 * dans le TL;DR (constaté par exécution en relecture).
 *
 * @returns {Set<Element>}
 */
export const forbiddenLinkZones = (root) => {
  const zones = new Set();
  if (!root || typeof root.querySelectorAll !== 'function') return zones;
  Array.from(root.querySelectorAll('h1,h2,h3,h4,h5,h6')).forEach((h) => {
    if (!ZONE_TITLE_RX.test(h.textContent || '')) return;
    zones.add(h);
    const lvl = Number(h.tagName[1]);
    for (let el = h.nextElementSibling; el; el = el.nextElementSibling) {
      const l = /^H[1-6]$/.test(el.tagName) ? Number(el.tagName[1]) : 0;
      if (l && l <= lvl) break;                 // la zone se referme
      zones.add(el);                            // la descendance suit (on remonte les parents)
    }
  });
  return zones;
};

/**
 * `el` est-il dans un emplacement interdit ?
 * @param {Element|null} el
 * @param {Set<Element>} zones résultat de `forbiddenLinkZones`
 * @param {string} sel NO_LINK_TAG_SEL (lien nouveau) ou NEVER_LINK_TAG_SEL (reprise)
 */
export const isInForbiddenLinkZone = (el, zones, sel = NO_LINK_TAG_SEL) => {
  if (!el) return true;
  if (typeof el.closest === 'function' && el.closest(sel)) return true;
  if (zones && zones.size) {
    for (let n = el; n; n = n.parentElement) if (zones.has(n)) return true;
  }
  return false;
};
