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

// ── Traversée des marqueurs de diff ──────────────────────────────────────────
// Un bloc AJOUTÉ par l'agent (accepté ou encore en vert) est enveloppé dans
// <ins class="added-content"> (remplacement → <del class="deleted-content"> +
// <mark class="updated-content">). Pour le typage, l'étiquette, le groupement
// H2 et le copier/déplacer, on regarde À TRAVERS ce wrapper : s'il n'enveloppe
// qu'un seul élément de bloc, on le représente par cet élément → il se comporte
// comme n'importe quel bloc.
export const isDiffWrapper = (el) =>
  !!el && el.nodeType === Node.ELEMENT_NODE
  && (el.tagName === 'INS' || el.tagName === 'MARK' || el.tagName === 'DEL')
  && typeof el.className === 'string' && /(added|updated|deleted)-content/.test(el.className);

export const unwrapDiffWrapper = (el) => {
  if (!isDiffWrapper(el)) return el;
  const kids = Array.from(el.children);
  return kids.length === 1 ? kids[0] : el;
};

// ── Cluster de diff : les nœuds top-level d'UNE modification en attente ──────
// applyDiff insère un remplacement sous forme de paire ADJACENTE
// <del class="deleted-content">…</del><mark class="updated-content">…</mark>,
// et un ajout sous forme d'<ins class="added-content"> seul. Les boutons
// Accepter/Rejeter (resolveDiffPair) reposent sur cette adjacence : toute
// manipulation de bloc (couper, déplacer, dupliquer, supprimer, coller à côté)
// doit traiter la paire comme UN SEUL bloc — la séparer casse l'accept/reject.
export const isDiffDel = (el) =>
  !!el && el.nodeType === Node.ELEMENT_NODE && el.tagName === 'DEL'
  && typeof el.className === 'string' && el.className.includes('deleted-content');

export const isDiffMark = (el) =>
  !!el && el.nodeType === Node.ELEMENT_NODE && el.tagName === 'MARK'
  && typeof el.className === 'string' && el.className.includes('updated-content');

// Tous les nœuds du cluster contenant el, dans l'ordre du document :
// [del, mark] pour une paire, sinon [el].
export const diffClusterOf = (el) => {
  if (isDiffDel(el)) {
    const next = el.nextElementSibling;
    return isDiffMark(next) ? [el, next] : [el];
  }
  if (isDiffMark(el)) {
    const prev = el.previousElementSibling;
    return isDiffDel(prev) ? [prev, el] : [el];
  }
  return [el];
};

// HTML PROPRE (sans marqueurs de diff) d'une suite de nœuds top-level : chaque
// modification en attente est représentée par sa VERSION COURANTE proposée —
// contenu du <mark>/<ins> ; le <del> d'une paire est ignoré, un <del> seul
// (suppression en attente) garde son contenu (il est encore dans l'article).
export const cleanBlocksHtml = (nodes) => {
  let html = '';
  Array.from(nodes).forEach((n) => {
    if (!n) return;
    if (n.nodeType !== Node.ELEMENT_NODE) { html += n.textContent || ''; return; }
    if (isDiffDel(n) && isDiffMark(n.nextElementSibling)) return; // ancienne version d'une paire
    html += isDiffWrapper(n) ? n.innerHTML : n.outerHTML;
  });
  return html;
};

// ── Métadonnées d'affichage d'un bloc ────────────────────────────────────────
// name : libellé (toasts, snackbar) · art : avec article défini (« Coller le
// tableau ») · fem : accord des participes (« coupée » vs « coupé »).
export const blockMeta = (rawEl) => {
  const el = unwrapDiffWrapper(rawEl); // voir à travers <ins>/<mark>
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
    // Ne jamais s'insérer ENTRE le <del> et le <mark> d'une paire de diff
    const cluster = diffClusterOf(refEl);
    anchor = where === 'before' ? cluster[0] : cluster[cluster.length - 1].nextSibling;
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

// Retire les <br> parasites DIRECTEMENT enfants du conteneur (avant/après le
// tableau) : l'éditeur contentEditable de Chrome en injecte au fil des éditions
// autour d'un tableau non éditable, et ils s'accumulaient en un grand vide au-
// dessus du tableau sur le site publié. Le tableau seul doit vivre dans le wrap.
const stripWrapBr = (wrap) => {
  let removed = false;
  Array.from(wrap.childNodes).forEach((n) => {
    if (n.nodeName === 'BR') { n.remove(); removed = true; }
  });
  return removed;
};

// ── Normalisation STRUCTURELLE d'un tableau ──────────────────────────────────
// Répare les corruptions accumulées par l'éditeur contentEditable et garantit
// un format STANDARD (le thème WordPress rend alors le tableau normalement) :
//   • sort un <table> piégé dans un heading (hN) — cause du rendu « titre » ;
//   • supprime les <thead>/<tbody>/<tfoot> et les lignes ENTIÈREMENT vides
//     (les rangées fantômes accumulées) et les <thead> en double ;
//   • déballe les cellules : <td><p><span style="font-weight:normal">x</span></p>
//     → <td>x</td>, et retire les styles de police inline (taille/police/poids/
//     couleur) → le texte reprend la taille/police standard du site.
const CELL_STYLE_RE = /(font-[\w-]+|color|background(?:-color)?)\s*:[^;]+;?/gi;
export const normalizeTableStructure = (root) => {
  if (!root) return false;
  let changed = false;
  root.querySelectorAll('table').forEach((table) => {
    // 1. Table enfermée dans un heading → l'en sortir (structure invalide)
    const h = table.closest('h1,h2,h3,h4,h5,h6');
    if (h && h.parentNode && h !== table) {
      h.parentNode.insertBefore(table, h.nextSibling);
      if (!(h.textContent || '').trim() && !h.querySelector('img')) h.remove();
      changed = true;
    }
    // 2. Cellules : déballer les wrappers cosmétiques + retirer styles de police
    table.querySelectorAll('td, th').forEach((cell) => {
      cell.querySelectorAll('span[style]').forEach((sp) => {
        const st = sp.getAttribute('style') || '';
        if (sp.attributes.length === 1 && /font-|color|background/i.test(st)) {
          while (sp.firstChild) sp.parentNode.insertBefore(sp.firstChild, sp);
          sp.remove(); changed = true;
        }
      });
      // <p> unique enfant d'une cellule → déballé (une cellule n'a pas besoin de <p>)
      const kids = Array.from(cell.childNodes).filter(n => !(n.nodeType === 3 && !n.textContent.trim()));
      if (kids.length === 1 && kids[0].nodeType === 1 && kids[0].tagName === 'P') {
        const p = kids[0];
        while (p.firstChild) cell.insertBefore(p.firstChild, p);
        p.remove(); changed = true;
      }
      const st = cell.getAttribute('style');
      if (st && CELL_STYLE_RE.test(st)) {
        const cleaned = st.replace(CELL_STYLE_RE, '').replace(/;\s*;/g, ';').trim().replace(/^;|;$/g, '');
        if (cleaned) cell.setAttribute('style', cleaned); else cell.removeAttribute('style');
        changed = true;
      }
    });
    // 3. Lignes entièrement vides → suppression
    const hasContent = (c) => (c.textContent || '').trim() !== '' || c.querySelector('img, iframe, video');
    table.querySelectorAll('tr').forEach((tr) => {
      const cells = Array.from(tr.children).filter(c => c.tagName === 'TD' || c.tagName === 'TH');
      if (cells.length > 0 && cells.every(c => !hasContent(c))) { tr.remove(); changed = true; }
    });
    // 4. Sections vides + <thead> en double (garder le premier)
    table.querySelectorAll('thead, tbody, tfoot').forEach((sec) => {
      if (!sec.querySelector('tr')) { sec.remove(); changed = true; }
    });
    const theads = table.querySelectorAll('thead');
    for (let i = 1; i < theads.length; i++) { theads[i].remove(); changed = true; }
  });
  return changed;
};

export const wrapTablesResponsive = (root) => {
  if (!root) return false;
  let changed = normalizeTableStructure(root); // répare la structure AVANT d'envelopper
  root.querySelectorAll('table').forEach((table) => {
    // Largeur fluide : occupe l'espace disponible, ne déborde jamais du wrapper
    if (!table.style.width) { table.style.width = '100%'; changed = true; }
    if (!table.style.borderCollapse) table.style.borderCollapse = 'collapse';
    const parent = table.parentElement;
    if (parent && parent.hasAttribute(TABLE_WRAP_ATTR)) {
      // Déjà enveloppé → nettoyer les <br> parasites accumulés dans le conteneur
      if (stripWrapBr(parent)) changed = true;
      return;
    }
    const wrap = document.createElement('div');
    wrap.setAttribute(TABLE_WRAP_ATTR, '1');
    wrap.style.overflowX = 'auto';
    wrap.style.maxWidth = '100%';
    wrap.style.setProperty('-webkit-overflow-scrolling', 'touch');
    table.parentNode.insertBefore(wrap, table);
    wrap.appendChild(table);
    stripWrapBr(wrap); // sécurité : seul le tableau doit rester dans le conteneur
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
