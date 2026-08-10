/**
 * scrollBlock.js — amener un bloc de l'éditeur à l'écran.
 *
 * L'éditeur d'article n'est PAS un conteneur défilant : il grandit à la hauteur
 * de son contenu (13 000 px mesurés sur un article de 3 500 mots) et c'est le
 * DOCUMENT qui défile. Un `editeur.scrollTo(...)` est donc purement sans effet —
 * c'était la cause des flèches « modification précédente / suivante » qui ne
 * déplaçaient rien : 8 clics, scrollY figé.
 *
 * On corrige donc à tous les niveaux, du plus interne au plus externe :
 *   1. le scroll interne de l'éditeur, s'il en a réellement un ;
 *   2. chaque ancêtre véritablement défilant (le <main> du layout) ;
 *   3. à défaut la fenêtre — le cas réel de l'éditeur d'article.
 *
 * Défilement INSTANTANÉ et non `smooth` : deux animations douces imbriquées
 * (éditeur + page) s'annulent mutuellement dans Chrome. Pas de scrollIntoView
 * non plus : sur un contentEditable, Chrome remet scrollTop à 0 avant de
 * défiler. Même approche que le navigateur de structure, qui lui défile bien.
 */
export const scrollBlockIntoView = (container, el, { ratio = 1 / 3 } = {}) => {
  const vide = { scrolledContainer: false, scrolledAncestor: false, scrolledWindow: false, ok: false };
  if (!container || !el || !container.contains || !container.contains(el)) return vide;

  const viewH = (typeof window !== 'undefined' && window.innerHeight)
    || (typeof document !== 'undefined' && document.documentElement.clientHeight)
    || 0;

  // 1. Scroll interne de l'éditeur — assignation synchrone, donc la position
  //    relue aux étapes suivantes est déjà à jour.
  const innerMax = Math.max(0, container.scrollHeight - container.clientHeight);
  let scrolledContainer = false;
  if (innerMax > 0) {
    const relativeTop = el.getBoundingClientRect().top
      - container.getBoundingClientRect().top
      + container.scrollTop;
    container.scrollTop = Math.min(innerMax, Math.max(0, relativeTop - container.clientHeight * ratio));
    scrolledContainer = true;
  }

  // 2. Ancêtres défilants, du plus proche au plus lointain : chacun corrige le
  //    reste de l'écart pour poser le bloc dans le haut de l'écran.
  let scrolledAncestor = false;
  let p = container.parentElement;
  while (p) {
    if (p.scrollHeight > p.clientHeight + 1) {
      const s = typeof getComputedStyle === 'function' ? getComputedStyle(p) : null;
      if (s && /(auto|scroll)/.test(s.overflowY)) {
        p.scrollTop += el.getBoundingClientRect().top - viewH * ratio; // clampé par le DOM
        scrolledAncestor = true;
      }
    }
    p = p.parentElement;
  }

  // 3. Aucun ancêtre défilant → c'est la fenêtre qui porte le défilement.
  let scrolledWindow = false;
  if (!scrolledAncestor && typeof window !== 'undefined' && window.scrollBy) {
    window.scrollBy(0, el.getBoundingClientRect().top - viewH * ratio);
    scrolledWindow = true;
  }

  return { scrolledContainer, scrolledAncestor, scrolledWindow, ok: true };
};

/**
 * Signale visuellement le bloc visé, puis nettoie l'attribut `style` s'il
 * redevient vide — sinon chaque saut laissait un `style=""` résiduel dans le
 * HTML publié.
 */
export const flashBlock = (el, { color = '#2d6a2d', ms = 900 } = {}) => {
  if (!el || !el.style) return;
  el.style.outline = `2px solid ${color}`;
  el.style.outlineOffset = '2px';
  setTimeout(() => {
    if (!el.style) return;
    el.style.removeProperty('outline');
    el.style.removeProperty('outline-offset');
    if (!el.getAttribute('style')?.trim()) el.removeAttribute('style');
  }, ms);
};
