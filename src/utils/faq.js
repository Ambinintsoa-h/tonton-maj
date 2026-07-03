// ── Manipulation du bloc FAQ dans l'éditeur (ArticleResult) ──────────────────
// Opère sur les nœuds LIVE du contentEditable (pas sur des strings HTML) pour
// préserver l'identité des nœuds (surlignages diff, médias verrouillés…).
// Les heuristiques de détection sont alignées sur moveFaqToEnd (utils/diff.js) :
//   1. enfant direct avec classe/id contenant "faq"
//   2. heading direct h1-h4 contenant "faq" / "questions fréquentes" / "foire aux questions"

const isFaqTitle = (text) => {
  const t = (text || '').toLowerCase().trim();
  return (
    t.includes('faq') ||
    t.includes('questions fréquentes') ||
    t.includes('questions frequentes') ||
    t.includes('foire aux questions')
  );
};

const headingLevel = (node) => {
  if (!node || node.nodeType !== Node.ELEMENT_NODE) return null;
  const m = node.tagName?.match(/^H([1-6])$/i);
  return m ? parseInt(m[1], 10) : null;
};

/**
 * Détecte le bloc FAQ parmi les enfants directs du container (le div contentEditable).
 * Retourne null si aucune FAQ, sinon :
 *   { kind: 'container', nodes: [root], root, heading, level }
 *   { kind: 'heading',   nodes: [h, …siblings], root: null, heading: h, level }
 * `nodes` = liste ordonnée des nœuds top-level qui composent la FAQ (texte inclus).
 */
export const findFaqBlock = (container) => {
  if (!container) return null;

  // Stratégie 1 : enfant direct avec classe/id contenant "faq"
  for (const child of Array.from(container.children)) {
    const cls = (typeof child.className === 'string' ? child.className : '').toLowerCase();
    const id = (child.id || '').toLowerCase();
    if (cls.includes('faq') || id.includes('faq') || id === 'foire-aux-questions') {
      const heading = child.querySelector('h1, h2, h3, h4');
      return { kind: 'container', nodes: [child], root: child, heading, level: headingLevel(heading) || 2 };
    }
  }

  // Stratégie 2 : heading direct (h1-h4) — collecte le heading + frères suivants
  // jusqu'au prochain heading de niveau ≤ (même logique que moveFaqToEnd)
  for (const h of Array.from(container.querySelectorAll('h1, h2, h3, h4'))) {
    if (h.parentNode !== container) continue;
    if (!isFaqTitle(h.textContent)) continue;
    const level = headingLevel(h);
    const nodes = [h];
    let node = h.nextSibling;
    while (node) {
      const lvl = headingLevel(node);
      if (lvl && lvl <= level) break;
      nodes.push(node);
      node = node.nextSibling;
    }
    return { kind: 'heading', nodes, root: null, heading: h, level };
  }

  return null;
};

/** true si `target` est à l'intérieur du bloc FAQ (un de ses nœuds ou descendant). */
export const isInsideFaq = (block, target) =>
  !!block && block.nodes.some(n => n === target || (n.nodeType === Node.ELEMENT_NODE && n.contains(target)));

// ── Groupes Question/Réponse ──────────────────────────────────────────────────
// Un groupe = { nodes: [...], question: <élément portant le texte de la question> }
// Formats supportés :
//   - 'details'  : chaque <details><summary>Q</summary>…réponse…</details>
//   - 'section'  : chaque .schema-faq-section (Yoast)
//   - 'heading'  : heading hN (niveau min > titre FAQ) + frères jusqu'au hN suivant

/** Nœuds internes du bloc : frères après le titre (kind heading) ou enfants du root. */
const faqScope = (block) =>
  block.kind === 'container' ? Array.from(block.root.childNodes) : block.nodes.slice(1);

export const getQAGroups = (block) => {
  if (!block) return { format: null, groups: [] };
  const scope = faqScope(block);
  const elems = scope.filter(n => n.nodeType === Node.ELEMENT_NODE);

  // Format <details>
  const details = elems.filter(el => el.tagName === 'DETAILS');
  if (details.length) {
    return {
      format: 'details',
      groups: details.map(el => ({ nodes: [el], question: el.querySelector('summary') || el })),
    };
  }

  // Format Yoast .schema-faq-section
  const sections = elems.filter(el => (typeof el.className === 'string' ? el.className : '').toLowerCase().includes('faq-section'));
  if (sections.length) {
    return {
      format: 'section',
      groups: sections.map(el => ({ nodes: [el], question: el.querySelector('strong, h2, h3, h4, h5') || el })),
    };
  }

  // Format headings : niveau de question = plus petit niveau strictement > titre FAQ
  const titleLevel = block.level || 2;
  const qLevels = elems.map(headingLevel).filter(l => l && l > titleLevel);
  if (!qLevels.length) return { format: null, groups: [] };
  const qLevel = Math.min(...qLevels);

  const groups = [];
  let current = null;
  for (const n of scope) {
    if (headingLevel(n) === qLevel) {
      current = { nodes: [n], question: n };
      groups.push(current);
    } else if (current) {
      current.nodes.push(n);
    }
  }
  return { format: 'heading', groups, qLevel };
};

/** Groupe Q/R contenant `target` (index dans groups), ou -1. */
export const findQAIndex = (groups, target) =>
  groups.findIndex(g => g.nodes.some(n => n === target || (n.nodeType === Node.ELEMENT_NODE && n.contains(target))));

// ── Opérations Q/R ────────────────────────────────────────────────────────────

/** Échange le groupe `index` avec son voisin (dir = -1 monter / +1 descendre). */
export const moveQAGroup = (groups, index, dir) => {
  const from = groups[index];
  const to = groups[index + dir];
  if (!from || !to) return false;
  const parent = from.nodes[0].parentNode;
  if (dir < 0) {
    // insérer les nœuds de `from` avant le premier nœud de `to`
    const ref = to.nodes[0];
    from.nodes.forEach(n => parent.insertBefore(n, ref));
  } else {
    // insérer les nœuds de `to` avant le premier nœud de `from`
    const ref = from.nodes[0];
    to.nodes.forEach(n => parent.insertBefore(n, ref));
  }
  return true;
};

export const deleteQAGroup = (groups, index) => {
  const g = groups[index];
  if (!g) return false;
  g.nodes.forEach(n => n.parentNode && n.parentNode.removeChild(n));
  return true;
};

export const NEW_QUESTION_TEXT = 'Nouvelle question ?';
export const NEW_ANSWER_TEXT = 'Rédigez la réponse ici…';

/**
 * Crée une nouvelle Q/R au format du bloc et l'insère après le groupe `index`
 * (ou en fin de FAQ si index = -1 / dernier). Retourne l'élément « question »
 * créé (pour y placer le caret), ou null.
 */
export const insertQAAfter = (block, qa, index) => {
  const { format, groups, qLevel } = qa;
  const doc = document;
  let nodes = [];
  let questionEl = null;

  if (format === 'details') {
    const d = doc.createElement('details');
    d.setAttribute('open', '');
    const s = doc.createElement('summary');
    // Répliquer le <hN> dans le <summary> si le format existant en a un
    const refHeading = groups[0]?.question?.querySelector?.('h1, h2, h3, h4, h5');
    if (refHeading) {
      const hN = doc.createElement(refHeading.tagName);
      hN.textContent = NEW_QUESTION_TEXT;
      s.appendChild(hN);
    } else {
      s.textContent = NEW_QUESTION_TEXT;
    }
    const p = doc.createElement('p');
    p.textContent = NEW_ANSWER_TEXT;
    d.appendChild(s);
    d.appendChild(p);
    nodes = [d];
    questionEl = s;
  } else if (format === 'section') {
    const div = doc.createElement('div');
    div.className = 'schema-faq-section';
    const q = doc.createElement('strong');
    q.className = 'schema-faq-question';
    q.textContent = NEW_QUESTION_TEXT;
    const p = doc.createElement('p');
    p.className = 'schema-faq-answer';
    p.textContent = NEW_ANSWER_TEXT;
    div.appendChild(q);
    div.appendChild(p);
    nodes = [div];
    questionEl = q;
  } else if (format === 'heading') {
    const h = doc.createElement('H' + (qLevel || (block.level || 2) + 1));
    h.textContent = NEW_QUESTION_TEXT;
    const p = doc.createElement('p');
    p.textContent = NEW_ANSWER_TEXT;
    nodes = [h, p];
    questionEl = h;
  } else {
    return null;
  }

  const refGroup = groups[index] || groups[groups.length - 1];
  if (refGroup) {
    const last = refGroup.nodes[refGroup.nodes.length - 1];
    const parent = last.parentNode;
    let ref = last.nextSibling;
    nodes.forEach(n => parent.insertBefore(n, ref));
  } else if (block.kind === 'container') {
    nodes.forEach(n => block.root.appendChild(n));
  } else {
    // FAQ vide (titre seul) : insérer juste après le dernier nœud du bloc
    const last = block.nodes[block.nodes.length - 1];
    const parent = last.parentNode;
    let ref = last.nextSibling;
    nodes.forEach(n => parent.insertBefore(n, ref));
    block.nodes.push(...nodes);
  }
  return questionEl;
};

// ── Opérations sur le bloc entier ─────────────────────────────────────────────

/** HTML sérialisé du bloc FAQ (clones — le DOM n'est pas modifié). */
export const serializeFaqBlock = (block) => {
  const tmp = document.createElement('div');
  block.nodes.forEach(n => tmp.appendChild(n.cloneNode(true)));
  return tmp.innerHTML;
};

export const removeFaqBlock = (block) => {
  block.nodes.forEach(n => n.parentNode && n.parentNode.removeChild(n));
};

/**
 * Déplace le bloc FAQ d'une section (heading de niveau ≤ level du titre FAQ)
 * vers le haut (dir=-1) ou le bas (dir=+1). Retourne false si impossible
 * (déjà tout en haut / tout en bas).
 */
export const moveFaqBlockBySection = (container, block, dir) => {
  const level = block.level || 2;
  const isBoundary = (n) => {
    const lvl = headingLevel(n);
    return lvl != null && lvl <= level;
  };

  if (dir < 0) {
    // Remonter : insérer la FAQ avant le heading qui ouvre la section précédente
    let cursor = block.nodes[0].previousSibling;
    let target = null;
    while (cursor) {
      if (isBoundary(cursor)) { target = cursor; break; }
      cursor = cursor.previousSibling;
    }
    if (!target) return false;
    block.nodes.forEach(n => container.insertBefore(n, target));
    return true;
  }

  // Descendre : trouver le heading qui ouvre la section suivante, puis la fin
  // de cette section → insérer la FAQ après.
  let cursor = block.nodes[block.nodes.length - 1].nextSibling;
  let nextHeading = null;
  while (cursor) {
    if (isBoundary(cursor)) { nextHeading = cursor; break; }
    cursor = cursor.nextSibling;
  }
  if (!nextHeading) return false;
  let end = nextHeading.nextSibling;
  while (end && !isBoundary(end)) end = end.nextSibling;
  block.nodes.forEach(n => (end ? container.insertBefore(n, end) : container.appendChild(n)));
  return true;
};

/**
 * Insère le HTML de FAQ (presse-papiers interne) après le bloc top-level qui
 * contient le caret courant ; sinon en fin d'article. Retourne le premier
 * nœud inséré (pour scroller dessus), ou null.
 */
export const insertFaqHtmlAtCaret = (container, html) => {
  if (!container || !html) return null;
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  const nodes = Array.from(tmp.childNodes);
  if (!nodes.length) return null;

  // Bloc top-level contenant le caret
  let ref = null;
  const sel = window.getSelection();
  if (sel && sel.rangeCount) {
    const range = sel.getRangeAt(0);
    let n = range.startContainer;
    if (n === container) {
      // Caret directement entre deux blocs : insérer à cet endroit précis
      const after = container.childNodes[range.startOffset] || null;
      nodes.forEach(x => container.insertBefore(x, after));
      return nodes.find(x => x.nodeType === Node.ELEMENT_NODE) || nodes[0];
    }
    if (container.contains(n)) {
      while (n && n.parentNode !== container) n = n.parentNode;
      ref = n || null;
    }
  }

  if (ref) {
    let after = ref.nextSibling;
    nodes.forEach(n => container.insertBefore(n, after));
  } else {
    nodes.forEach(n => container.appendChild(n));
  }
  return nodes.find(n => n.nodeType === Node.ELEMENT_NODE) || nodes[0];
};

/** Rect union (viewport) des nœuds éléments d'une liste — pour positionner les toolbars. */
export const rectOfNodes = (nodes) => {
  let top = Infinity, left = Infinity, right = -Infinity, bottom = -Infinity;
  for (const n of nodes) {
    if (n.nodeType !== Node.ELEMENT_NODE) continue;
    const r = n.getBoundingClientRect();
    if (!r.width && !r.height) continue;
    top = Math.min(top, r.top);
    left = Math.min(left, r.left);
    right = Math.max(right, r.right);
    bottom = Math.max(bottom, r.bottom);
  }
  if (top === Infinity) return null;
  return { top, left, right, bottom, width: right - left, height: bottom - top };
};
