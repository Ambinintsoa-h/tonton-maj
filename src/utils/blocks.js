/**
 * blocks.js — manipulation générique des blocs top-level de l'éditeur.
 *
 * Presse-papiers interne couper/copier/coller pour TOUT type de bloc
 * (tableau, titre, paragraphe, liste, image, vidéo, citation, FAQ…) —
 * même mécanique que le presse-papiers FAQ (utils/faq.js), généralisée.
 *
 * + Rendu responsive des tableaux HTML : styles INLINE (aucune dépendance
 * au CSS du thème WordPress) pour que les tableaux publiés ne cassent
 * jamais la mise en page du site.
 */

// ── Bloc top-level contenant un nœud ─────────────────────────────────────────
export const topLevelBlockOf = (container, node) => {
  if (!container || !node || node === container) return null;
  if (!container.contains(node)) return null;
  let n = node;
  while (n && n.parentNode !== container) n = n.parentNode;
  return n && n.nodeType === Node.ELEMENT_NODE ? n : null;
};

// Bloc top-level au point d'un Range (clic droit) : gère le cas où le caret
// est directement entre deux blocs (startContainer === container).
export const blockAtRange = (container, range) => {
  if (!container || !range) return null;
  let node = null;
  try { node = range.startContainer; } catch { return null; }
  if (node === container) {
    const kids = container.childNodes;
    if (!kids.length) return null;
    let cand = kids[Math.min(range.startOffset, kids.length - 1)] || null;
    while (cand && cand.nodeType !== Node.ELEMENT_NODE) cand = cand.previousSibling;
    return cand;
  }
  return topLevelBlockOf(container, node);
};

// ── Métadonnées d'affichage d'un bloc ────────────────────────────────────────
// name : libellé (toasts, snackbar) · art : avec article défini (« Coller le
// tableau ») · fem : accord des participes (« coupée » vs « coupé »).
export const blockMeta = (el) => {
  if (!el || el.nodeType !== Node.ELEMENT_NODE) return { name: 'Bloc', art: 'le bloc', fem: false };
  const tag = el.tagName;
  if (tag === 'TABLE' || el.hasAttribute?.(TABLE_WRAP_ATTR)) return { name: 'Tableau', art: 'le tableau', fem: false };
  const hMatch = tag.match(/^H([1-6])$/);
  if (hMatch) return { name: `Titre H${hMatch[1]}`, art: `le titre H${hMatch[1]}`, fem: false };
  if (tag === 'P') return { name: 'Paragraphe', art: 'le paragraphe', fem: false };
  if (tag === 'UL') return { name: 'Liste', art: 'la liste', fem: true };
  if (tag === 'OL') return { name: 'Liste numérotée', art: 'la liste', fem: true };
  if (tag === 'LI') return { name: 'Élément de liste', art: "l'élément", fem: false };
  if (tag === 'A') return { name: 'Lien', art: 'le lien', fem: false };
  if (tag === 'IMG') return { name: 'Image', art: "l'image", fem: true };
  if (tag === 'IFRAME' || tag === 'VIDEO') return { name: 'Vidéo', art: 'la vidéo', fem: true };
  if (tag === 'DETAILS') return { name: 'Question FAQ', art: 'la question', fem: true };
  if (tag === 'BLOCKQUOTE') return { name: 'Citation', art: 'la citation', fem: true };
  if (tag === 'FIGURE') {
    if (el.querySelector('table')) return { name: 'Tableau', art: 'le tableau', fem: false };
    if (el.querySelector('iframe, video')) return { name: 'Vidéo', art: 'la vidéo', fem: true };
    if (el.querySelector('img')) return { name: 'Image', art: "l'image", fem: true };
    return { name: 'Média', art: 'le média', fem: false };
  }
  const cls = (typeof el.className === 'string' ? el.className : '').toLowerCase();
  if (cls.includes('faq') || (el.id || '').toLowerCase().includes('faq')) return { name: 'FAQ', art: 'la FAQ', fem: true };
  if (el.querySelector?.('table')) return { name: 'Tableau', art: 'le tableau', fem: false };
  if (el.querySelector?.('iframe, video')) return { name: 'Vidéo', art: 'la vidéo', fem: true };
  return { name: 'Bloc', art: 'le bloc', fem: false };
};

// Participe passé accordé : accord({fem:true}, 'coupé') → « coupée »
export const accord = (meta, participe) => participe + (meta?.fem ? 'e' : '');

// ── Insertion du HTML du presse-papiers autour d'un élément de référence ─────
// where : 'before' | 'after'. Sans refEl valide → fin d'article.
// Retourne le premier nœud élément inséré (pour scroller dessus), ou null.
export const insertBlockHtml = (container, html, refEl, where = 'after') => {
  if (!container || !html) return null;
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  const nodes = Array.from(tmp.childNodes);
  if (!nodes.length) return null;
  let anchor = null; // insertBefore(x, null) = append
  if (refEl && refEl.parentNode === container) {
    anchor = where === 'before' ? refEl : refEl.nextSibling;
  }
  nodes.forEach(n => container.insertBefore(n, anchor));
  return nodes.find(n => n.nodeType === Node.ELEMENT_NODE) || nodes[0];
};

// ── Tableaux responsives (publication WordPress) ─────────────────────────────
// Chaque <table> est enveloppée dans un conteneur à défilement horizontal :
// sur mobile, le tableau garde sa largeur naturelle et défile DANS son
// conteneur au lieu de déborder et casser la mise en page du site.
// Idempotent (marqueur data-tt-table-wrap) — ré-appliqué sans effet à chaque
// analyse et à chaque publication.
export const TABLE_WRAP_ATTR = 'data-tt-table-wrap';

export const wrapTablesResponsive = (root) => {
  if (!root) return false;
  let changed = false;
  root.querySelectorAll('table').forEach((table) => {
    // Largeur fluide : occupe l'espace disponible, ne déborde jamais du wrapper
    if (!table.style.width) { table.style.width = '100%'; changed = true; }
    if (!table.style.borderCollapse) table.style.borderCollapse = 'collapse';
    const parent = table.parentElement;
    if (parent && parent.hasAttribute(TABLE_WRAP_ATTR)) return; // déjà enveloppé
    const wrap = document.createElement('div');
    wrap.setAttribute(TABLE_WRAP_ATTR, '1');
    wrap.style.overflowX = 'auto';
    wrap.style.maxWidth = '100%';
    wrap.style.setProperty('-webkit-overflow-scrolling', 'touch');
    table.parentNode.insertBefore(wrap, table);
    wrap.appendChild(table);
    changed = true;
  });
  return changed;
};

export const makeTablesResponsive = (html) => {
  if (!html || typeof document === 'undefined' || !/<table/i.test(html)) return html;
  const container = document.createElement('div');
  container.innerHTML = html;
  const changed = wrapTablesResponsive(container);
  return changed ? container.innerHTML : html;
};
