// ── Manipulation du bloc FAQ dans l'éditeur (ArticleResult) ──────────────────
// Opère sur les nœuds LIVE du contentEditable (pas sur des strings HTML) pour
// préserver l'identité des nœuds (surlignages diff, médias verrouillés…).
// Les heuristiques de détection sont alignées sur moveFaqToEnd (utils/diff.js) :
//   1. enfant direct avec classe/id contenant "faq"
//   2. heading direct h1-h4 contenant "faq" / "questions fréquentes" / "foire aux questions"
//   3. suite d'accordéons <details> top-level (FAQ normalisée dont le titre ne
//      contient pas les mots-clés — reformulé par l'agent — ou a été coupé) ;
//      le heading immédiatement précédent, quel que soit son texte, sert de titre

import { diffClusterOf } from './blocks';

// Titres de FAQ acceptés. Les quatre premiers sont historiques ; les suivants
// viennent d'articles réels où la FAQ n'était PAS normalisée faute de vocabulaire
// (« Questions et réponses », « Vos questions les plus courantes »). La liste
// reste FERMÉE : l'ouvrir à « questions » seul convertirait en accordéon une
// section légitime du type « Questions à poser à votre artisan ».
const FAQ_TITLE_RX = new RegExp([
  'faq',
  'foire aux questions',
  'questions? fr[eé]quentes?',
  'questions? courantes?',
  'questions? (?:les )?plus (?:fr[eé]quentes?|courantes?|pos[eé]es?)',
  'questions? (?:et|/) r[eé]ponses?',
  'vos questions',
  'questions? des lecteurs',
  'on (?:vous )?r[eé]pond',
].join('|'), 'i');

const isFaqTitle = (text) => FAQ_TITLE_RX.test((text || '').toLowerCase().trim());

const headingLevel = (node) => {
  if (!node || node.nodeType !== Node.ELEMENT_NODE) return null;
  const m = node.tagName?.match(/^H([1-6])$/i);
  return m ? parseInt(m[1], 10) : null;
};

/**
 * Un titre qui EST une question : son texte se termine par « ? ».
 *
 * C'est le garde-fou de tous les assouplissements ci-dessous. Élargir la
 * détection sur le seul vocabulaire du titre ferait convertir en accordéon des
 * sections légitimes ; exiger le point d'interrogation rend le faux positif
 * quasi impossible, parce qu'un H2 rédactionnel n'en porte pas.
 */
const isQuestionHeading = (node) => {
  const lvl = headingLevel(node);
  return !!lvl && /\?\s*$/.test((node.textContent || '').trim());
};

/**
 * Déduplique un titre FAQ redondant — ex. « FAQ — Questions fréquentes (FAQ) » :
 * quand le modèle reformule un titre qui commence déjà par « FAQ », il ajoute
 * parfois « (FAQ) » en fin → mention doublée à la publication. On retire la
 * parenthèse finale UNIQUEMENT si « FAQ » apparaît déjà avant elle.
 * Opère sur les h1-h4 du conteneur ; ne touche à rien d'autre.
 */
export const dedupeFaqHeading = (container) => {
  if (!container) return;
  container.querySelectorAll('h1, h2, h3, h4').forEach((h) => {
    const t = h.textContent || '';
    const PAREN_RX = /\s*\(\s*f\.?a\.?q\.?\s*\)\s*$/i;
    if (!PAREN_RX.test(t)) return;
    if (!/faq|questions?\s+fr[ée]quentes|foire aux questions/i.test(t.replace(PAREN_RX, ''))) return;
    // Retirer la parenthèse dans le DERNIER nœud texte qui la contient
    // (préserve les balises internes du titre : del/mark de diff, strong…)
    const walker = document.createTreeWalker(h, NodeFilter.SHOW_TEXT);
    let last = null;
    while (walker.nextNode()) {
      if (/\(\s*f\.?a\.?q\.?\s*\)/i.test(walker.currentNode.nodeValue)) last = walker.currentNode;
    }
    if (last) last.nodeValue = last.nodeValue.replace(/\s*\(\s*f\.?a\.?q\.?\s*\)\s*/i, '').replace(/\s+$/, '');
  });
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
    // Un <ins> du pipeline n'est retenu que s'il contient une VRAIE FAQ
    // (<details> ou heading FAQ) : un marqueur tt-faq résiduel sur un autre
    // contenu (ex. puces du TL;DR) détournerait la barre FAQ et ses actions
    // (couper/coller/déplacer) vers le mauvais bloc. Les conteneurs d'auteur
    // (div.schema-faq, section#faq) gardent le comportement historique.
    if (child.tagName === 'INS'
        && !child.querySelector('details')
        && !Array.from(child.querySelectorAll('h1, h2, h3, h4')).some(h => isFaqTitle(h.textContent))) {
      continue;
    }
    if (cls.includes('faq') || id.includes('faq') || id === 'foire-aux-questions') {
      const heading = child.querySelector('h1, h2, h3, h4');
      return { kind: 'container', nodes: [child], root: child, heading, level: headingLevel(heading) || 2 };
    }
  }

  // Stratégie 1 bis : la FAQ est enfermée dans un conteneur NEUTRE (<section>,
  // <div>, <article>) sans classe ni id « faq ». La stratégie 2 ne la voyait pas
  // — elle exige un titre enfant DIRECT du container — et la FAQ restait donc en
  // titres bruts. On ne retient le conteneur que s'il porte un titre de FAQ ou
  // au moins deux vraies questions : un <div> quelconque n'est jamais capturé.
  for (const child of Array.from(container.children)) {
    if (!['SECTION', 'DIV', 'ARTICLE'].includes(child.tagName)) continue;
    const heads = Array.from(child.querySelectorAll('h1, h2, h3, h4'));
    if (!heads.length) continue;
    const titre = heads.find(h => isFaqTitle(h.textContent)) || null;
    const questions = heads.filter(isQuestionHeading);
    if (!titre && questions.length < 2) continue;
    const heading = titre || null;
    return { kind: 'container', nodes: [child], root: child, heading,
             level: headingLevel(heading) || 2 };
  }

  // Stratégie 2 : heading direct (h1-h4) — collecte le heading + frères suivants
  // jusqu'au prochain heading de niveau ≤ (même logique que moveFaqToEnd)
  for (const h of Array.from(container.querySelectorAll('h1, h2, h3, h4'))) {
    if (h.parentNode !== container) continue;
    if (!isFaqTitle(h.textContent)) continue;
    const level = headingLevel(h);
    const nodes = [h];
    let node = h.nextSibling;
    // Une FAQ pose ses questions à UN seul niveau. Dès qu'un titre plus profond
    // est vu, c'est LUI le niveau des questions : un titre de même niveau que le
    // titre FAQ redevient alors une frontière, même s'il finit par « ? ».
    // Sans cette borne, un H2 rédactionnel interrogatif placé après la FAQ était
    // absorbé — avec tout son texte — à l'intérieur de la dernière réponse.
    let vuPlusProfond = false;
    while (node) {
      const lvl = headingLevel(node);
      if (lvl && lvl > level) vuPlusProfond = true;
      // On traverse les titres de MÊME niveau tant que ce sont des QUESTIONS et
      // qu'aucun niveau plus profond n'a été rencontré (cas du modèle qui écrit
      // les questions en <h2>, comme le titre de la FAQ).
      if (lvl && lvl <= level && (vuPlusProfond || !isQuestionHeading(node))) break;
      nodes.push(node);
      node = node.nextSibling;
    }
    return { kind: 'heading', nodes, root: null, heading: h, level };
  }

  // Stratégie 2 ter : AUCUN titre reconnaissable, mais une suite d'au moins deux
  // titres de même niveau qui sont de vraies questions. C'est la FAQ détectée par
  // sa STRUCTURE, plus par son vocabulaire : un titre inventé par le modèle
  // (« Ce qu'on nous demande le plus ») ne bloque plus la mise en forme.
  {
    const kids = Array.from(container.children);
    for (let i = 0; i < kids.length; i++) {
      if (!isQuestionHeading(kids[i])) continue;
      const level = headingLevel(kids[i]);
      let n = 0;
      for (let j = i; j < kids.length; j++) {
        const lvl = headingLevel(kids[j]);
        if (lvl && lvl < level) break;              // on a quitté la section
        if (lvl === level && isQuestionHeading(kids[j])) n++;
        else if (lvl === level) break;              // titre de même niveau, pas une question
      }
      if (n < 2) continue;
      // Le titre est le heading juste avant, s'il est de niveau strictement
      // supérieur (donc un vrai chapeau) et n'est pas lui-même une question.
      const prev = kids[i - 1];
      const prevLvl = prev ? headingLevel(prev) : null;
      const heading = prevLvl && prevLvl < level && !isQuestionHeading(prev) ? prev : null;
      const debut = heading ? i - 1 : i;
      const nodes = [];
      for (let j = debut; j < kids.length; j++) {
        const lvl = headingLevel(kids[j]);
        if (j > debut && lvl && lvl <= level && !isQuestionHeading(kids[j])) break;
        nodes.push(kids[j]);
      }
      return { kind: 'heading', nodes, root: null, heading,
               level: heading ? prevLvl : level - 1 };
    }
  }

  // Stratégie 3 : suite de <details> top-level consécutifs (format accordéon
  // normalisé). Sans elle, une FAQ dont le titre ne matche pas les mots-clés
  // (ou dont le titre a été coupé/déplacé) devenait insélectionnable : plus de
  // barre au survol, plus de couper/copier/coller du bloc.
  {
    const kids = Array.from(container.children);
    const firstIdx = kids.findIndex(el => el.tagName === 'DETAILS');
    if (firstIdx !== -1) {
      const nodes = [];
      // Titre = heading (h1-h4) immédiatement AVANT la première question — texte libre
      const prev = kids[firstIdx - 1];
      const heading = prev && headingLevel(prev) && headingLevel(prev) <= 4 ? prev : null;
      if (heading) nodes.push(heading);
      // Collecte de la suite de <details> (tolère les <br> intercalés)
      for (let i = firstIdx; i < kids.length; i++) {
        if (kids[i].tagName === 'DETAILS' || kids[i].tagName === 'BR') nodes.push(kids[i]);
        else break;
      }
      while (nodes.length && nodes[nodes.length - 1].tagName === 'BR') nodes.pop();
      return { kind: 'heading', nodes, root: null, heading, level: headingLevel(heading) || 2 };
    }
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
//   - 'pb'       : <p><b>Question ?</b></p> suivi de <p> de réponse (ancien format WP)

// <p> dont le contenu est essentiellement un <b>/<strong> se terminant par « ? »
// → question de FAQ à l'ancien format. Le ratio évite de confondre avec un simple
// passage en gras au début d'une réponse.
const isQuestionParagraph = (el) => {
  if (!el || el.nodeType !== Node.ELEMENT_NODE || el.tagName !== 'P') return false;
  const first = el.firstElementChild;
  if (!first || !['B', 'STRONG'].includes(first.tagName)) return false;
  const pText = (el.textContent || '').trim();
  const bText = (first.textContent || '').trim();
  if (!bText.endsWith('?')) return false;
  return bText.length >= pText.length * 0.5;
};

/** Nœuds internes du bloc : frères après le titre (kind heading) ou enfants du root.
 *  Un bloc sans titre (stratégie 3, FAQ décapitée) garde TOUS ses nœuds. */
const faqScope = (block) =>
  block.kind === 'container'
    ? Array.from(block.root.childNodes)
    : block.nodes.slice(block.heading ? 1 : 0);

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
  let qLevels = elems.map(headingLevel).filter(l => l && l > titleLevel);
  // Questions au MÊME niveau que le titre (modèle qui écrit tout en <h2>) :
  // accepté UNIQUEMENT si ce sont de vraies questions, sinon on découperait un
  // article entier en accordéon.
  if (!qLevels.length) {
    const memeNiveau = elems.filter(el => headingLevel(el) === titleLevel && isQuestionHeading(el));
    if (memeNiveau.length) qLevels = [titleLevel];
  }
  if (qLevels.length) {
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
  }

  // Ancien format WP : <p><b>Question ?</b></p><br><p>réponse…</p>
  if (elems.some(isQuestionParagraph)) {
    const groups = [];
    let current = null;
    for (const n of scope) {
      if (isQuestionParagraph(n)) {
        current = { nodes: [n], question: n.querySelector('b, strong') };
        groups.push(current);
      } else if (current) {
        current.nodes.push(n); // <br> séparateurs inclus → déplacés/supprimés avec le groupe
      }
    }
    return { format: 'pb', groups };
  }

  return { format: null, groups: [] };
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
  } else if (format === 'pb') {
    const q = doc.createElement('p');
    const b = doc.createElement('b');
    b.textContent = NEW_QUESTION_TEXT;
    q.appendChild(b);
    const p = doc.createElement('p');
    p.textContent = NEW_ANSWER_TEXT;
    nodes = [q, p];
    questionEl = b;
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
      // Caret directement entre deux blocs : insérer à cet endroit précis —
      // sauf entre le <del> et le <mark> d'une paire de diff (adjacence requise
      // par Accepter/Rejeter) → on remonte AVANT la paire entière.
      let after = container.childNodes[range.startOffset] || null;
      if (after && after.nodeType === Node.ELEMENT_NODE) {
        const cluster = diffClusterOf(after);
        if (cluster[0] !== after) after = cluster[0];
      }
      nodes.forEach(x => container.insertBefore(x, after));
      return nodes.find(x => x.nodeType === Node.ELEMENT_NODE) || nodes[0];
    }
    if (container.contains(n)) {
      while (n && n.parentNode !== container) n = n.parentNode;
      ref = n || null;
    }
  }

  if (ref) {
    // Caret dans le <del> d'une paire de diff → insérer APRÈS la paire entière
    // (jamais entre le <del> et son <mark>).
    const cluster = diffClusterOf(ref);
    let after = cluster[cluster.length - 1].nextSibling;
    nodes.forEach(n => container.insertBefore(n, after));
  } else {
    nodes.forEach(n => container.appendChild(n));
  }
  return nodes.find(n => n.nodeType === Node.ELEMENT_NODE) || nodes[0];
};

// ── Normalisation de la FAQ au format accordéon ───────────────────────────────
// Convertit N'IMPORTE QUEL format de FAQ détecté (h3/p, <p><b>Q</b></p> + <br>,
// .schema-faq-section Yoast) vers le format canonique :
//   <h2>Titre FAQ</h2><details><summary>Q</summary><p>A</p></details>…
// Appelée après moveFaqToEnd à CHAQUE analyse (passe 1 et 2, les deux flux) →
// toutes les FAQ, anciennes comme nouvelles, ont la même structure dans
// l'éditeur (barres de manipulation) et à la publication WordPress.
// Les marques de diff (<ins>/<mark>) à l'intérieur des Q/R sont préservées
// (on déplace les innerHTML, pas les textContent).
export const normalizeFaqToAccordion = (html) => {
  if (!html || typeof document === 'undefined') return html;
  const container = document.createElement('div');
  container.innerHTML = html;
  const block = findFaqBlock(container);
  if (!block) return html;

  const qa = getQAGroups(block);

  // Déjà en accordéon : on retire juste les <br> séparateurs parasites du scope
  if (qa.format === 'details') {
    let cleaned = 0;
    const scope = block.kind === 'container' ? Array.from(block.root.childNodes) : block.nodes;
    for (const n of scope) {
      if (n.nodeType === Node.ELEMENT_NODE && n.tagName === 'BR') { n.remove(); cleaned++; }
    }
    return cleaned ? container.innerHTML : html;
  }

  if (!qa.groups.length) return html;

  // Construit un <details> à partir d'un groupe Q/R (contenu déplacé, pas cloné —
  // le container est détaché, les marques de diff restent intactes)
  const buildDetails = (g) => {
    const d = document.createElement('details');
    const s = document.createElement('summary');
    d.appendChild(s);

    let answers = [];
    if (qa.format === 'heading') {
      s.innerHTML = g.question.innerHTML;
      answers = g.nodes.slice(1);
    } else if (qa.format === 'pb') {
      s.innerHTML = g.question.innerHTML;      // contenu du <b> (sans le gras)
      // Reste éventuel du <p> question après le <b> → début de réponse
      const rest = document.createElement('p');
      let n = g.question.nextSibling;
      while (n) { const next = n.nextSibling; rest.appendChild(n); n = next; }
      if ((rest.textContent || '').trim()) answers.push(rest);
      answers.push(...g.nodes.slice(1));
    } else if (qa.format === 'section') {
      s.innerHTML = g.question.innerHTML;
      answers = Array.from(g.nodes[0].children).filter(c => c !== g.question);
    }

    if (!(s.textContent || '').trim()) return null;   // question vide → groupe ignoré

    for (const a of answers) {
      if (a.nodeType === Node.TEXT_NODE) {
        if ((a.textContent || '').trim()) {
          const p = document.createElement('p');
          p.textContent = a.textContent.trim();
          d.appendChild(p);
        }
        continue;
      }
      if (a.nodeType !== Node.ELEMENT_NODE) continue;
      if (a.tagName === 'BR') continue;                // séparateurs de l'ancien format
      d.appendChild(a);
    }
    // Réponse totalement vide → conserver quand même la question (réponse à rédiger)
    if (d.children.length === 1) {
      const p = document.createElement('p');
      p.textContent = '';
      d.appendChild(p);
    }
    return d;
  };

  const detailsList = qa.groups.map(buildDetails).filter(Boolean);
  if (!detailsList.length) return html;

  if (block.kind === 'heading') {
    // Retirer les nœuds du bloc restés au niveau racine (les réponses ont été
    // DÉPLACÉES dans les <details> — leur parent n'est plus le container, on
    // ne doit surtout pas les retirer des accordéons). Le titre est conservé.
    const title = block.heading;
    for (const n of block.nodes) {
      if (n !== title && n.parentNode === container) container.removeChild(n);
    }
    let ref = title.nextSibling;
    for (const d of detailsList) container.insertBefore(d, ref);
  } else {
    // Conteneur (div.faq…) : titre conservé, contenu remplacé par les <details>
    const root = block.root;
    const title = block.heading;
    while (root.firstChild) root.removeChild(root.firstChild);
    if (title) root.appendChild(title);
    for (const d of detailsList) root.appendChild(d);
  }
  return container.innerHTML;
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
