// ── Utilitaires de diff partagés entre Articles.jsx et ArticleResult.jsx ────

export const normalizeText = (str) =>
  str
    .replace(/ /g, " ")
    .replace(/ /g, " ")
    .replace(/'/g, "'").replace(/'/g, "'")
    .replace(/"/g, '"').replace(/"/g, '"')
    .replace(/–/g, "-").replace(/—/g, "--")
    .replace(/\s+/g, " ")
    .trim();

export const escRx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Échappe une chaîne pour un ATTRIBUT HTML (title="…"). Le `reason` généré par
 * l'IA peut contenir <, >, & (ex. « score < 3/10 », « balise <table> ») : sans
 * échappement il fuit brut dans l'attribut, ce qui peut malformer le HTML et
 * fausser les comptages de balises basés sur regex (escapeEnclosingIns). On
 * échappe & en premier pour ne pas ré-échapper les entités produites ensuite.
 */
export const escapeAttr = (s) => (s || "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;");

/**
 * Tente de localiser `original` dans `html` et l'entoure des balises diff.
 * 4 stratégies par ordre de précision décroissante.
 * @returns {{ html: string, matched: boolean }}
 */
export const applyDiff = (html, original, updated, reason, deleteOnly = false) => {
  const safeReason = escapeAttr(reason);
  const replacement = (matched) =>
    deleteOnly
      ? `<del class="deleted-content" title="${safeReason}">${matched}</del>`
      : `<del class="deleted-content">${matched}</del><mark class="updated-content" title="${safeReason}">${updated}</mark>`;

  // Guard : sur les articles très longs (>150 000 chars), bypasser les stratégies
  // avec quantificateurs flexibles (gap) pour éviter le backtracking catastrophique.
  const LONG_ARTICLE_THRESHOLD = 150000;
  const isLongArticle = html.length > LONG_ARTICLE_THRESHOLD;

  // Stratégie 1 : correspondance exacte
  try {
    const rx = new RegExp(escRx(original), "g");
    if (rx.test(html)) return { html: html.replace(rx, replacement(original)), matched: true };
  } catch {}

  // Stratégie 2 : regex flexible sur HTML original
  // Gère apostrophes/guillemets typographiques, espaces insécables, tirets/tirets longs
  try {
    const normOrig = normalizeText(original);
    const flexPattern = escRx(normOrig)
      .replace(/\\ /g, "[\\s\\u00a0\\u202f]+")
      .replace(/'/g, "[\\u0027\\u2018\\u2019]")
      .replace(/"/g, "[\\u0022\\u201c\\u201d\\u00ab\\u00bb]")
      // Bug fix : normalizeText convertit — en -- (2 chars), ce qui devient [-–—][-–—]
      // dans le pattern → ne matche pas un — unique dans le HTML.
      // On re-collapse les paires de tirets en un seul class de tiret.
      .replace(/(?:[-–—]){1,2}/g, "[-\\u2013\\u2014]");
    const rxFlex = new RegExp(flexPattern, "gi");
    const res2 = html.replace(rxFlex, (m) => replacement(m));
    if (res2 !== html) return { html: res2, matched: true };
  } catch {}

  // Stratégie 2.5 : tous les mots avec gaps souples
  // Cas typique : str. 1 et 2 échouent (variation de chars, balise HTML entre les mots),
  // mais le texte existe dans le HTML à peu près intact.
  // Utilise TOUS les mots (y compris <4 chars comme "les", "de", "un") → <del> couvre
  // l'original COMPLET, pas seulement les mots-clés ≥4 chars.
  // Gap : [^\n\r]{0,20}? — accepte balises HTML inline (<em>, <strong>…) mais s'arrête
  // aux sauts de ligne (pas de match cross-paragraphe).
  if (!isLongArticle) try {
    const allWordsArr = normalizeText(original).split(/\s+/).filter(Boolean);
    if (allWordsArr.length >= 2 && allWordsArr.length <= 30 && original.length < 600) {
      const pat25 = allWordsArr.map((w) => escRx(w)).join("[^\\n\\r]{0,20}?");
      const rx25  = new RegExp(pat25, "i");
      const res25 = html.replace(rx25, (m) => replacement(m));
      if (res25 !== html) return { html: res25, matched: true };
    }
  } catch {}

  // Stratégie 3 : mots-clés ordonnés, phrases simples
  // ≥4 mots de ≥4 chars — deux variantes selon la densité HTML du contenu
  try {
    const words = normalizeText(original).split(/\s+/).filter((w) => w.length >= 4);
    if (words.length >= 4) {
      // Variante A : gap texte pur, sans balises (rapide, précis)
      const GAP_PURE = "[^\\n\\r.!?<]{0,25}?";
      const pattern3a = words.map((w) => escRx(w)).join(GAP_PURE);
      const rx3a = new RegExp(pattern3a, "i");
      const res3a = html.replace(rx3a, (m) => replacement(m));
      if (res3a !== html) return { html: res3a, matched: true };

      // Variante B : gap peut traverser une balise HTML (passe 2 sur HTML marqué)
      // GAP_HTML simplifié — un seul quantificateur plat pour éviter le backtracking catastrophique
      // Autorise jusqu'à 60 chars dont d'éventuelles balises <mark>/<del> insérées par la passe 1
      // Bypasser sur les articles longs pour éviter les freezes regex
      if (!isLongArticle) {
        const GAP_HTML = "[\\s\\S]{0,60}?";
        const pattern3b = words.map((w) => escRx(w)).join(GAP_HTML);
        const rx3b = new RegExp(pattern3b, "i");
        const res3b = html.replace(rx3b, (m) => replacement(m));
        if (res3b !== html) return { html: res3b, matched: true };
      }
    }
  } catch {}

  // Stratégie 4 : ancres début + fin pour originaux multi-phrases
  // 3 premiers mots + 3 derniers mots, span plafonné à 600 chars pour éviter les freezes
  // Bypasser sur les articles longs ([\s\S] flexible sur un très long haystack = freeze)
  if (isLongArticle) return { html, matched: false };
  try {
    const allWords = normalizeText(original).split(/\s+/).filter((w) => w.length >= 4);
    if (allWords.length >= 8) {
      const firstWords = allWords.slice(0, 3);
      const lastWords  = allWords.slice(-3);
      // Plafonner maxInner : évite les regex catastrophiques sur de très longs originaux
      const maxInner   = Math.min(Math.round(original.length * 1.5), 600);
      const startPat   = firstWords.map((w) => escRx(w)).join("[\\s\\S]{0,20}?");
      const endPat     = lastWords.map((w) => escRx(w)).join("[\\s\\S]{0,20}?");
      const fullPat    = `${startPat}[\\s\\S]{0,${maxInner}}?${endPat}`;
      const rx4 = new RegExp(fullPat, "i");
      const res4 = html.replace(rx4, (m) => replacement(m));
      if (res4 !== html) return { html: res4, matched: true };
    }
  } catch {}

  return { html, matched: false };
};

/**
 * Corrige les résidus dupliqués après </mark> quand l'agent a tronqué "original".
 *
 * Problème : Claude écrit original="20 ans" mais le texte complet est
 * "20 ans de franchise (2005-2025)". Le diff produit alors :
 *
 *   <del>20 ans</del>
 *   <mark>20 ans de franchise (2005-2025), avec 21 ans en cours</mark>
 *   de franchise (2005-2025)   ← résidu visible non barré
 *
 * Solution : trouver mot par mot le plus long préfixe de ce résidu
 * qui est contenu dans le <mark>, puis l'intégrer dans le <del> :
 *
 *   <del>20 ans de franchise (2005-2025)</del>
 *   <mark>20 ans de franchise (2005-2025), avec 21 ans en cours</mark>
 *
 * Algo : pour chaque mot du texte après </mark>, on accumule mot par mot
 * tant que le cumul (normalisé sans ponctuation) est contenu dans le texte
 * normalisé du <mark>. Quand ça casse, la partie accumulée est le vrai
 * résidu → on l'intègre dans le <del>.
 *
 * La normalisation retire la ponctuation pour la comparaison uniquement,
 * ce qui gère les décalages de ponctuation entre l'article ("(2005-2025).")
 * et le <mark> ("(2005-2025),").
 */

// Regex : capture <del>...</del><mark>...</mark> + texte brut qui suit (jusqu'au prochain tag/newline)
const RESIDUAL_RX = /(<del class="deleted-content">)([\s\S]*?)(<\/del>)(<mark class="updated-content"[^>]*>)([\s\S]*?)(<\/mark>)([^\n<]*)/g;

// Retire ponctuation et espaces multiples pour la comparaison de résidus uniquement.
// Permet de matcher "(2005-2025)." du texte contre "(2005-2025)," du <mark>.
const normForCheck = (s) => s.replace(/[.,;:!?»"'()[\]–—]+/g, "").replace(/\s+/g, " ").trim();

const residualPass = (html) => {
  let changed = false;
  const newHtml = html.replace(
    RESIDUAL_RX,
    (match, delOpen, delContent, delClose, markOpen, markContent, markClose, after) => {
      // Texte brut du <mark> normalisé pour comparaison
      const markText = markContent.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
      // Texte après </mark> nettoyé
      const afterTrimmed = after.replace(/\s+/g, " ").trim();
      if (!afterTrimmed || !markText) return match;

      const markNorm = normForCheck(markText);

      // Trouver le plus long préfixe (mot par mot) de afterTrimmed contenu dans markNorm.
      // La comparaison se fait sans ponctuation pour gérer les décalages de ponctuation.
      // Ex: "de franchise (2005-2025)." matche "de franchise (2005-2025)," dans le <mark>.
      const afterWords = afterTrimmed.split(/\s+/);
      let residual = "";
      let cumulative = "";
      for (let i = 0; i < afterWords.length; i++) {
        const next = cumulative ? cumulative + " " + afterWords[i] : afterWords[i];
        if (markNorm.includes(normForCheck(next))) {
          cumulative = next;
        } else {
          break;
        }
      }
      residual = cumulative;

      // Seuil : un seul mot court commun (ex: "de", "le") n'est pas un vrai résidu
      if (residual.length < 8) return match;

      changed = true;

      // Étendre le <del> pour inclure le résidu → toute la phrase originale est barrée
      const sep         = /\s$/.test(delContent) ? "" : " ";
      const extendedDel = delContent.trimEnd() + sep + residual;

      // Reconstruit la partie après : retirer le résidu, conserver la suite
      const remainder = afterTrimmed.substring(residual.length).trimStart();
      // Préserver l'espace de tête du after original
      const leadingWs = after.match(/^(\s*)/)?.[1] || "";
      const trailingPart = remainder ? (" " + remainder) : "";

      return delOpen + extendedDel + delClose + markOpen + markContent + markClose + leadingWs + trailingPart;
    }
  );
  return { html: newHtml, changed };
};

export const cleanResiduals = (html) => {
  let result = html;
  for (let pass = 0; pass < 5; pass++) {
    const { html: newHtml, changed } = residualPass(result);
    result = newHtml;
    if (!changed) break;
  }
  return result;
};

/**
 * Garantit que le texte AJOUTÉ (vert, <mark class="updated-content">) n'est JAMAIS barré.
 *
 * Les stratégies de diff à « gap » peuvent capturer un <mark> déjà inséré et
 * l'envelopper dans un nouveau <del> → le texte vert se retrouve descendant d'un
 * <del> et hérite du line-through (impossible à retirer via text-decoration sur le
 * mark). On sort donc chaque <mark> hors de tout <del> ancêtre (placé juste après).
 * Idempotent, robuste aux imbrications multiples.
 */
export const liftMarksOutOfDel = (html) => {
  if (!html || (html.indexOf('<del') === -1 && html.indexOf('<mark') === -1)) return html;
  let div;
  try { div = document.createElement('div'); div.innerHTML = html; }
  catch { return html; }

  let safety = 0;
  let nested = div.querySelectorAll('del mark, del .updated-content');
  while (nested.length && safety++ < 300) {
    nested.forEach((mark) => {
      const del = mark.closest('del');
      if (del && del.parentNode) del.parentNode.insertBefore(mark, del.nextSibling);
    });
    nested = div.querySelectorAll('del mark, del .updated-content');
  }
  return div.innerHTML;
};

/**
 * Insère `updated` après le bloc contenant `anchor`.
 * Utilisé pour les updates de type "addition" (nouveaux paragraphes).
 * @returns {{ html: string, matched: boolean }}
 */
/**
 * Si `pos` tombe À L'INTÉRIEUR d'un ou plusieurs <ins> (cas : l'anchor d'une
 * addition est du texte AJOUTÉ par une addition précédente → son </p> de bloc
 * est dans le <ins> voisin), renvoie la position juste APRÈS le(s) <ins>
 * englobant(s). Garantit que les additions restent SŒURS et ne s'imbriquent
 * jamais (source du bug 20/07 : poupées russes d'<ins>). No-op au niveau racine.
 */
const escapeEnclosingIns = (html, pos) => {
  const pre = html.slice(0, pos);
  let depth = (pre.match(/<ins\b/gi) || []).length - (pre.match(/<\/ins>/gi) || []).length;
  if (depth <= 0) return pos;
  const tokenRx = /<ins\b|<\/ins>/gi;
  tokenRx.lastIndex = pos;
  let m;
  while ((m = tokenRx.exec(html))) {
    depth += m[0][1] === '/' ? -1 : 1;
    if (depth === 0) return m.index + m[0].length;
  }
  return pos;
};

export const applyAddition = (html, anchor, updated) => {
  if (!anchor || !updated) return { html, matched: false };

  // Localiser l'anchor avec correspondance flexible (même algo que applyDiff str.2)
  let anchorEnd = -1;
  try {
    const normAnchor = normalizeText(anchor);
    const flexPat = escRx(normAnchor)
      .replace(/\\ /g, "[\\s\\u00a0\\u202f]+")
      .replace(/'/g, "[\\u0027\\u2018\\u2019]")
      .replace(/"/g, "[\\u0022\\u201c\\u201d\\u00ab\\u00bb]")
      .replace(/(?:[-–—]){1,2}/g, "[-\\u2013\\u2014]");
    const rx = new RegExp(flexPat, 'i');
    const m = rx.exec(html);
    if (m) anchorEnd = m.index + m[0].length;
  } catch {}

  // Fallback : correspondance exacte
  if (anchorEnd < 0) {
    const idx = html.indexOf(anchor);
    if (idx >= 0) anchorEnd = idx + anchor.length;
  }

  if (anchorEnd < 0) return { html, matched: false };

  // Trouver la prochaine balise fermante de bloc après la position de l'anchor
  const tail = html.slice(anchorEnd);
  const blockCloseRx = /<\/(p|h[1-6]|li|blockquote|div|section|article|td|th)>/i;
  const blockMatch = blockCloseRx.exec(tail);
  if (!blockMatch) return { html, matched: false };

  let insertPos = anchorEnd + blockMatch.index + blockMatch[0].length;

  // Un bloc <ins> ne doit JAMAIS devenir enfant direct d'une liste ou d'un
  // tableau (enfant non-<li>/<tr> invalide → le navigateur ré-imbrique le
  // contenu voisin : sections qui « disparaissent » ou se déplacent). Si
  // l'anchor se termine dans un <li>/<td>/<th>, on remonte à la fermeture de
  // la structure ENGLOBANTE (imbrications comptées) et on insère après elle.
  const tag = blockMatch[1].toLowerCase();
  if (tag === 'li' || tag === 'td' || tag === 'th') {
    const containerRx = tag === 'li'
      ? /<(\/?)(?:ul|ol)\b[^>]*>/gi
      : /<(\/?)table\b[^>]*>/gi;
    containerRx.lastIndex = insertPos;
    let depth = 1;
    let cm;
    while ((cm = containerRx.exec(html))) {
      depth += cm[1] ? -1 : 1;
      if (depth === 0) { insertPos = cm.index + cm[0].length; break; }
    }
    // structure jamais refermée (HTML malformé) → comportement d'origine
  }

  // Ne jamais insérer une addition DANS une autre addition <ins> → ressortir
  insertPos = escapeEnclosingIns(html, insertPos);

  const newHtml =
    html.slice(0, insertPos) +
    `<ins class="added-content">${updated}</ins>` +
    html.slice(insertPos);
  return { html: newHtml, matched: true };
};

/**
 * Insère un bloc TOUJOURS juste après l'introduction de l'article :
 *  1. avant le premier <h2> (= après les paragraphes d'intro), sinon
 *  2. après le premier </p>, sinon
 *  3. après la figure de l'image à la une, sinon
 *  4. au tout début.
 * Utilisé pour le résumé (TL;DR) dont la position ne doit pas dépendre de l'anchor.
 * @returns {{ html: string, matched: boolean }}
 */
export const insertAfterIntro = (html, updated) => {
  if (!updated) return { html, matched: false };
  const block = `<ins class="added-content">${updated}</ins>`;
  const h2 = /<h2\b/i.exec(html);
  if (h2) { const pos = escapeEnclosingIns(html, h2.index); return { html: html.slice(0, pos) + block + html.slice(pos), matched: true }; }
  const p = /<\/p>/i.exec(html);
  if (p) { const pos = escapeEnclosingIns(html, p.index + p[0].length); return { html: html.slice(0, pos) + block + html.slice(pos), matched: true }; }
  const fig = /<\/figure>/i.exec(html);
  if (fig) { const pos = escapeEnclosingIns(html, fig.index + fig[0].length); return { html: html.slice(0, pos) + block + html.slice(pos), matched: true }; }
  return { html: block + html, matched: true };
};

/** Détecte une addition « Résumé de l'article » / TL;DR (placement forcé après l'intro). */
const isTldrAddition = (u) => {
  if (u.type !== 'addition') return false;
  const r = (u.reason || '').toLowerCase();
  const up = (u.updated || '').toLowerCase();
  return /tl\s*;?\s*dr|r[ée]sum[ée] de l'article/.test(r)
      || /r[ée]sum[ée] de l'article/.test(up);
};

/**
 * Insère un bloc après le n-ième titre H2 de l'article (1-based).
 * Utilisé pour placer un tableau comparatif dans le 2e H2 (sinon le dernier dispo).
 * Fallbacks : si moins de n H2 → dernier H2 ; aucun H2 → après le 1er </p> ; sinon fin.
 * @returns {{ html: string, matched: boolean }}
 */
export const insertAfterNthH2 = (html, updated, n = 2) => {
  if (!updated) return { html, matched: false };
  const block = `<ins class="added-content">${updated}</ins>`;
  const rx = /<\/h2>/gi;
  const ends = [];
  let m;
  while ((m = rx.exec(html)) !== null) ends.push(m.index + m[0].length);

  if (!ends.length) {
    const p = /<\/p>/i.exec(html);
    if (p) { const pos = escapeEnclosingIns(html, p.index + p[0].length); return { html: html.slice(0, pos) + block + html.slice(pos), matched: true }; }
    return { html: html + block, matched: true };
  }
  // n-ième H2 si disponible, sinon le dernier — jamais À L'INTÉRIEUR d'un <ins>
  // (ex. le seul H2 présent est le titre du TL;DR : insérer après son </h2>
  // couperait le TL;DR de ses puces → on ressort de l'addition).
  const pos = escapeEnclosingIns(html, ends[Math.min(n, ends.length) - 1]);
  return { html: html.slice(0, pos) + block + html.slice(pos), matched: true };
};

/** Détecte une addition contenant un tableau (placement forcé : 2e H2). */
const isTableAddition = (u) => u.type === 'addition' && /<table[\s>]/i.test(u.updated || '');

/**
 * Insère `newContent` après le bloc le plus proche de `referenceText` par chevauchement lexical.
 * Fallback utilisé quand applyDiff et applyAddition échouent tous les deux.
 * @returns {{ html: string, matched: boolean }}
 */
export const insertNearClosestParagraph = (html, referenceText, newContent) => {
  const div = document.createElement('div');
  div.innerHTML = html;

  const blocks = Array.from(div.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, td'));
  if (!blocks.length) {
    // Pas de blocs : ajouter à la fin
    const ins = document.createElement('ins');
    ins.className = 'added-content';
    ins.innerHTML = newContent;
    div.appendChild(ins);
    return { html: div.innerHTML, matched: true };
  }

  // Score chaque bloc par chevauchement de mots avec referenceText
  const refWords = new Set(
    normalizeText((referenceText || '').replace(/<[^>]+>/g, ' '))
      .toLowerCase()
      .split(/\s+/)
      .filter(w => w.length > 3)
  );

  let bestBlock = blocks[blocks.length - 1]; // défaut : dernier bloc
  if (refWords.size > 0) {
    let bestScore = 0;
    for (const block of blocks) {
      const blockWords = (block.textContent || '').toLowerCase().split(/\s+/).filter(w => w.length > 3);
      const overlap = blockWords.filter(w => refWords.has(w)).length;
      const score = overlap / refWords.size;
      if (score > bestScore) { bestScore = score; bestBlock = block; }
    }
  }

  const ins = document.createElement('ins');
  ins.className = 'added-content';
  ins.innerHTML = newContent;
  // Ne jamais nicher l'addition dans une autre : si le bloc cible est dans un
  // <ins.added-content>, insérer après CET <ins> (addition sœur, pas enfant).
  const enclosingIns = bestBlock.closest('ins.added-content');
  (enclosingIns || bestBlock).insertAdjacentElement('afterend', ins);
  return { html: div.innerHTML, matched: true };
};

/**
 * Remplacement FLOU (#1) — quand applyDiff échoue à localiser `original`
 * (segment déplacé, reformulé, ou fragmenté par des balises), on barre tout de
 * même le passage le plus PROCHE : on repère le bloc au plus fort recouvrement
 * lexical avec `original`, puis on tente d'y appliquer le diff exact ; à défaut
 * on barre l'ensemble du bloc et on insère le remplacement juste après.
 * Déclenché UNIQUEMENT sur action manuelle (bouton « localiser/appliquer »).
 * @returns {{ html: string, matched: boolean }}
 */
export const applyReplacementFuzzy = (html, original, updated, reason) => {
  if (!original || typeof document === 'undefined') return { html, matched: false };
  const div = document.createElement('div');
  div.innerHTML = html;

  const blocks = Array.from(div.querySelectorAll('p, li, td, h1, h2, h3, h4, h5, h6, blockquote'));
  if (!blocks.length) return { html, matched: false };

  const refWords = new Set(
    normalizeText(original.replace(/<[^>]+>/g, ' ')).toLowerCase().split(/\s+/).filter(w => w.length > 3)
  );
  if (!refWords.size) return { html, matched: false };

  let best = null;
  let bestScore = 0;
  for (const b of blocks) {
    // Ne pas re-marquer un bloc déjà porteur d'un diff (évite les imbrications)
    if (b.querySelector('del, mark, ins')) continue;
    const bw = (b.textContent || '').toLowerCase().split(/\s+/).filter(w => w.length > 3);
    if (!bw.length) continue;
    const overlap = bw.filter(w => refWords.has(w)).length;
    const score = overlap / refWords.size;
    if (score > bestScore) { bestScore = score; best = b; }
  }
  // Seuil de prudence : au moins ~40 % des mots significatifs présents dans le bloc
  if (!best || bestScore < 0.4) return { html, matched: false };

  const safeReason = escapeAttr(reason);
  // 1) tenter le diff exact à l'intérieur du bloc (barre le segment précis)
  const scoped = applyDiff(best.innerHTML, original, updated, reason);
  if (scoped.matched) {
    best.innerHTML = scoped.html;
  } else {
    // 2) repli : barrer tout le contenu du bloc + insérer le remplacement
    best.innerHTML =
      `<del class="deleted-content">${best.innerHTML}</del>` +
      `<mark class="updated-content" title="${safeReason}">${updated}</mark>`;
  }
  return { html: liftMarksOutOfDel(div.innerHTML), matched: true };
};

/**
 * Répare une structure HTML cassée par un DÉPLACEMENT / COLLAGE dans le
 * contentEditable (#2) : sort les blocs illégalement imbriqués dans un <p>
 * (table, listes, titres…), retire les <del>/<mark>/<ins> devenus vides et les
 * <p> vidés par le déplacement. Opère IN PLACE sur l'élément fourni (préserve
 * l'identité des nœuds → curseur conservé). Idempotent.
 */
export const repairStructureEl = (el) => {
  if (!el) return;
  const BLOCK = 'table, ul, ol, h1, h2, h3, h4, h5, h6, blockquote, figure, pre, hr';
  // 1) Sortir tout bloc enfant direct d'un <p> juste après celui-ci (ordre conservé)
  el.querySelectorAll('p').forEach((p) => {
    let ref = p;
    Array.from(p.children).forEach((child) => {
      if (child.matches && child.matches(BLOCK) && p.parentNode) {
        p.parentNode.insertBefore(child, ref.nextSibling);
        ref = child;
      }
    });
  });
  // 1b) Sortir d'une liste (ul/ol) tout enfant direct qui N'EST PAS un <li> :
  //     un heading/paragraphe/tableau glissé DANS une <ul> (souvent parce qu'un
  //     <li> n'a pas été fermé) est une imbrication invalide qui casse le rendu
  //     sur le site. On le replace APRÈS la liste, en conservant l'ordre.
  el.querySelectorAll('ul, ol').forEach((list) => {
    let ref = list;
    Array.from(list.children).forEach((child) => {
      if (child.tagName !== 'LI' && list.parentNode) {
        list.parentNode.insertBefore(child, ref.nextSibling);
        ref = child;
      }
    });
  });
  // 2) Retirer les marqueurs de diff vides (résidus d'édition manuelle / déplacement)
  el.querySelectorAll('del, mark, ins').forEach((n) => {
    if (!n.textContent.trim() && !n.querySelector('img, table, iframe, video')) n.remove();
  });
  // 3) Supprimer les <p> devenus totalement vides après un déplacement
  el.querySelectorAll('p').forEach((p) => {
    if (!p.textContent.trim() && !p.querySelector('img, br, table, iframe, video')) p.remove();
  });
};

/** Variante string de repairStructureEl (#2) — pour l'export / la vue finale. */
export const repairStructure = (html) => {
  if (!html || typeof document === 'undefined') return html;
  const div = document.createElement('div');
  div.innerHTML = html;
  repairStructureEl(div);
  return div.innerHTML;
};

/**
 * Enveloppe en <p> les nœuds texte / inline « lâches » à la racine du conteneur.
 *
 * Cas visé : article importé en TEXTE BRUT. Le pipeline de diff travaille alors
 * sur des nœuds texte nus — une fois les marqueurs résolus (vue finale, export,
 * publication), les passages originaux restent du texte sans AUCUNE structure de
 * blocs : les sauts de ligne disparaissent au rendu HTML et tout s'affiche en un
 * seul pavé. Ici, chaque saut de ligne d'un nœud texte lâche redevient un
 * séparateur de paragraphe (même granularité que la vue « Avant »).
 *
 * Les blocs existants (<p>, <h2>, <table>…) ne sont pas touchés : pour un
 * article déjà structuré en HTML, la fonction est un no-op.
 */
export const wrapLooseTextIntoParagraphs = (el) => {
  if (!el) return;
  const BLOCK_RX = /^(P|H[1-6]|UL|OL|TABLE|BLOCKQUOTE|FIGURE|PRE|HR|DIV|SECTION|ARTICLE|ASIDE|HEADER|FOOTER|NAV|IFRAME|VIDEO|DETAILS|FORM|ADDRESS|MAIN)$/;
  const isBlock = (n) => n.nodeType === 1 && BLOCK_RX.test(n.tagName);
  const doc = el.ownerDocument || document;

  let run = []; // nœuds texte/inline consécutifs, à envelopper au prochain bloc
  const flush = (before) => {
    if (!run.length) return;
    let p = null;
    const ensureP = () => {
      if (!p) { p = doc.createElement('p'); el.insertBefore(p, before); }
      return p;
    };
    run.forEach((n) => {
      if (n.nodeType === 3 && n.nodeValue.includes('\n')) {
        // Un \n dans un texte lâche = fin de paragraphe
        n.nodeValue.split('\n').forEach((part, i) => {
          if (i > 0) p = null;
          if (part.trim()) ensureP().appendChild(doc.createTextNode(part));
        });
        n.remove();
      } else if (n.nodeType === 3 && !n.nodeValue.trim()) {
        n.remove(); // blanc pur (indentation entre blocs)
      } else {
        ensureP().appendChild(n); // inline (<a>, <strong>…) ou texte sans \n
      }
    });
    run = [];
  };

  Array.from(el.childNodes).forEach((n) => {
    if (isBlock(n)) flush(n);
    else run.push(n);
  });
  flush(null);

  // Purge des <p> vides créés par des lignes blanches consécutives
  el.querySelectorAll(':scope > p').forEach((p) => {
    if (!p.textContent.trim() && !p.querySelector('img, br, iframe, video')) p.remove();
  });
};

// Titres des sections « spéciales » à emplacement imposé
const FAQ_TITLE_RX  = /faq|questions?\s+fr[ée]quentes|foire aux questions/i;
const TLDR_TITLE_RX = /r[ée]sum[ée] de l'article|tl\s*;?\s*dr/i;

/**
 * Un élément contient-il une VRAIE FAQ ? (accordéon <details> ou heading FAQ).
 * Nécessaire car un <ins> marqué `tt-faq` peut ne plus contenir la FAQ après
 * les désimbrications successives (cas observé : les puces du TL;DR restées
 * seules dans l'ins) — le traiter comme FAQ enverrait le TL;DR en fin de
 * document et détournerait la barre FAQ de l'éditeur.
 */
const looksLikeRealFaq = (el) =>
  !!el.querySelector('details') ||
  Array.from(el.querySelectorAll('h1, h2, h3, h4')).some(h => FAQ_TITLE_RX.test(h.textContent || ''));

/**
 * Aplatit les additions <ins> IMBRIQUÉES. `applyAllDiffs` peut nicher une
 * addition dans une autre quand elle est ancrée sur du texte AJOUTÉ par une
 * addition précédente (ex. « Aides » ancré sur une phrase de « Normes ») →
 * structure en poupées russes `<ins>A<ins>B<ins>C…</ins></ins></ins>`. Sans
 * aplatissement, la désimbrication des sections spéciales part en vrille
 * (tableau marqué FAQ, TL;DR séparé de ses puces, <ins> vides — bug 20/07).
 * On désenveloppe chaque <ins.added-content> niché DANS son parent, sur place
 * → une séquence de blocs à plat, dans l'ordre de lecture.
 */
const flattenNestedAdditions = (container) => {
  let changed = false;
  let guard = 0;
  while (guard++ < 500) {
    const nested = container.querySelector('ins.added-content ins.added-content');
    if (!nested) break;
    const frag = document.createDocumentFragment();
    while (nested.firstChild) frag.appendChild(nested.firstChild);
    nested.parentNode.replaceChild(frag, nested);
    changed = true;
  }
  return changed;
};

/** Niveau d'un heading (1-6) ou null si le nœud n'est pas un titre. */
const headingLvl = (n) =>
  (n && n.nodeType === Node.ELEMENT_NODE && /^H[1-6]$/.test(n.tagName)) ? parseInt(n.tagName[1], 10) : null;

/** Contenu significatif (texte non vide ou média) dans un nœud. */
const isSignificantNode = (n) =>
  (n.textContent || '').trim() || (n.nodeType === Node.ELEMENT_NODE && n.querySelector('img, table, iframe, video'));

/**
 * Désimbrique une section spéciale enfouie dans une addition <ins>. Le modèle
 * groupe parfois PLUSIEURS sections dans UNE seule addition (tableau + résumé +
 * autres H2 + FAQ), pas forcément avec la section spéciale en queue. Il faut
 * alors extraire UNIQUEMENT la section spéciale (titre + son contenu, jusqu'au
 * prochain titre qui la clôt) dans son propre <ins> marqué, et laisser tout ce
 * qui la précède ET la suit dans des additions normales, à leur place.
 *
 * L'ancienne version coupait « du titre jusqu'à la fin de l'ins », ce qui, quand
 * la section n'était pas en dernier, emportait les blocs suivants, séparait un
 * TL;DR de ses puces et marquait à tort le tableau/les blocs voisins (bug 20/07).
 *
 * @param titleRx        motif du titre de la section (FAQ / TL;DR)
 * @param markerClass    classe repère posée sur le <ins> extrait (tt-faq / tt-tldr)
 * @param stopAtAnyHeading  true : la section s'arrête au PROCHAIN titre quel que
 *   soit son niveau (TL;DR = titre + puces, jamais de sous-titre) ; false : elle
 *   s'arrête au prochain titre de niveau ≤ (FAQ à l'ancien format peut contenir
 *   des sous-titres de questions).
 */
const splitSpecialFromIns = (container, titleRx, markerClass, stopAtAnyHeading = false) => {
  let changed = false;
  let guard = 0;
  let again = true;
  // Re-scan après chaque extraction : l'addition résiduelle « après » peut à son
  // tour contenir une autre occurrence de la même section spéciale.
  while (again && guard++ < 50) {
    again = false;
    for (const ins of Array.from(container.querySelectorAll('ins.added-content'))) {
      if (ins.classList.contains(markerClass)) continue;
      const heading = Array.from(ins.querySelectorAll('h1, h2, h3, h4'))
        .find(h => titleRx.test(h.textContent || ''));
      if (!heading) continue;

      // Bloc top-level de l'ins contenant le titre
      let top = heading;
      while (top.parentNode !== ins) top = top.parentNode;
      const lvl = headingLvl(top) || headingLvl(heading) || 2;

      // Section = le titre + ses frères suivants jusqu'au titre qui la clôt
      const sectionNodes = [top];
      for (let n = top.nextSibling; n; n = n.nextSibling) {
        const hl = headingLvl(n);
        if (hl && (stopAtAnyHeading || hl <= lvl)) break;
        sectionNodes.push(n);
      }
      const lastSection = sectionNodes[sectionNodes.length - 1];

      // Groupes avant / après la section (références capturées AVANT tout déplacement)
      const beforeNodes = [];
      for (let n = ins.firstChild; n && n !== top; n = n.nextSibling) beforeNodes.push(n);
      const afterNodes = [];
      for (let n = lastSection.nextSibling; n; n = n.nextSibling) afterNodes.push(n);

      const hasBefore = beforeNodes.some(isSignificantNode);
      const hasAfter  = afterNodes.some(isSignificantNode);

      // L'ins EST déjà exactement la section → marquer sur place
      if (!hasBefore && !hasAfter) {
        ins.classList.add(markerClass);
        changed = true;
        continue;
      }

      // Extraire la section dans son propre <ins> marqué
      const wrapper = document.createElement('ins');
      wrapper.className = `added-content ${markerClass}`;
      sectionNodes.forEach(n => wrapper.appendChild(n));
      ins.parentNode.insertBefore(wrapper, ins.nextSibling);

      // Nœuds APRÈS la section → nouvelle addition normale (ordre du document préservé)
      if (hasAfter) {
        const afterIns = document.createElement('ins');
        afterIns.className = 'added-content';
        afterNodes.forEach(n => afterIns.appendChild(n));
        ins.parentNode.insertBefore(afterIns, wrapper.nextSibling);
      } else {
        afterNodes.forEach(n => n.parentNode && n.remove()); // résidus vides
      }

      // L'ins d'origine ne garde que le « avant » ; le supprimer s'il devient vide
      if (!ins.textContent.trim() && !ins.querySelector('img, table, iframe, video')) ins.remove();

      changed = true;
      again = true; // re-scan pour d'éventuelles sections restantes
      break;
    }
  }
  return changed;
};

/** Déplace le bloc FAQ en fin de document. Retourne true si le DOM a changé. */
const moveFaqBlockToEnd = (container) => {
  // Stratégie 1 : enfant direct avec classe/id contenant "faq"
  // Ex: <div class="schema-faq">, <section id="faq">, <ins class="added-content tt-faq">
  for (const child of Array.from(container.children)) {
    const cls = (child.className || '').toLowerCase();
    const id  = (child.id || '').toLowerCase();
    // Un <ins> du pipeline n'est retenu que s'il contient une VRAIE FAQ — un
    // marqueur tt-faq résiduel sur un autre contenu (puces TL;DR) ne doit pas
    // l'envoyer en fin de document. Les conteneurs d'auteur (div.schema-faq,
    // section#faq) gardent le comportement historique.
    if (child.tagName === 'INS' && !looksLikeRealFaq(child)) continue;
    if (cls.includes('faq') || id.includes('faq') || id === 'foire-aux-questions') {
      // Extraire les <ins class="added-content"> qui ont atterri à l'intérieur du bloc FAQ
      // (cas : passe 2 a ancré sur du texte à l'intérieur du FAQ → insertion enfouie dedans)
      const insertions = Array.from(child.querySelectorAll('ins.added-content'));
      for (const ins of insertions) container.insertBefore(ins, child);

      const alreadyLast = child === container.lastElementChild;
      if (!alreadyLast) container.appendChild(child);
      return !!(insertions.length || !alreadyLast);
    }
  }

  // Stratégie 2 : heading direct (h1-h4) contenant "faq" ou "questions fréquentes"
  for (const h of Array.from(container.querySelectorAll('h1, h2, h3, h4'))) {
    if (h.parentNode !== container) continue;          // pas un enfant direct → skip
    if (!FAQ_TITLE_RX.test(h.textContent || '')) continue;

    const headingLevel = parseInt(h.tagName[1], 10);

    // Collecter le heading + ses frères suivants jusqu'au prochain heading ≤ même niveau
    const faqNodes = [];
    let node = h;
    while (node) {
      const next = node.nextSibling;
      if (node !== h && node.nodeType === Node.ELEMENT_NODE) {
        const lvl = node.tagName?.match(/^H([1-6])$/i)?.[1];
        if (lvl && parseInt(lvl, 10) <= headingLevel) break;
      }
      faqNodes.push(node);
      node = next;
    }
    if (!faqNodes.length) continue;

    // Extraire les <ins class="added-content"> enfouies à l'intérieur des nœuds FAQ
    const insertions = [];
    for (const n of faqNodes) {
      if (n.nodeType === Node.ELEMENT_NODE) {
        for (const ins of Array.from(n.querySelectorAll('ins.added-content'))) {
          insertions.push(ins);
        }
      }
    }
    for (const ins of insertions) container.insertBefore(ins, h);

    const alreadyAtEnd = faqNodes[faqNodes.length - 1] === container.lastChild;
    if (alreadyAtEnd && !insertions.length) return false;

    for (const n of faqNodes) container.appendChild(n);
    return true;
  }

  return false;
};

/**
 * Repositionne le TL;DR (« Résumé de l'article ») juste avant le premier H2 du
 * document (= après l'intro) quand il a atterri ailleurs — typiquement en fin
 * d'article quand le modèle l'a groupé dans une addition avec la FAQ.
 */
const moveTldrAfterIntro = (container) => {
  // Bloc TL;DR : ins marqué par la désimbrication, ou section directe du document
  let nodes = null;
  const marked = container.querySelector(':scope > ins.tt-tldr');
  if (marked) {
    nodes = [marked];
  } else {
    const h = Array.from(container.querySelectorAll('h1, h2, h3, h4'))
      .find(x => x.parentNode === container && TLDR_TITLE_RX.test(x.textContent || ''));
    if (!h) return false;
    const lvl = parseInt(h.tagName[1], 10);
    nodes = [h];
    for (let n = h.nextSibling; n; n = n.nextSibling) {
      if (n.nodeType === Node.ELEMENT_NODE && /^H[1-6]$/.test(n.tagName) && parseInt(n.tagName[1], 10) <= lvl) break;
      nodes.push(n);
    }
  }

  // Cible : premier H2 du document HORS bloc TL;DR (début de la 1re section)
  const firstH2 = Array.from(container.querySelectorAll('h2'))
    .find(h2 => !nodes.some(n => n === h2 || (n.nodeType === Node.ELEMENT_NODE && n.contains(h2))));
  if (!firstH2) return false;
  let anchor = firstH2;
  while (anchor.parentNode !== container) anchor = anchor.parentNode;

  // Déjà en place (le bloc précède immédiatement l'ancre) → rien à faire
  let after = nodes[nodes.length - 1].nextSibling;
  while (after && after.nodeType === Node.TEXT_NODE && !(after.textContent || '').trim()) after = after.nextSibling;
  if (after === anchor) return false;

  for (const n of nodes) container.insertBefore(n, anchor);
  return true;
};

/**
 * Normalise l'emplacement des sections spéciales après application des diffs :
 *   1. FAQ et TL;DR enfouis dans une addition <ins> → désimbriqués chacun dans
 *      leur propre <ins> (jamais « section + FAQ + résumé » dans un seul bloc) ;
 *   2. FAQ déplacée en fin de document (class/id "faq" ou heading FAQ) ;
 *   3. TL;DR repositionné après l'intro (avant le premier H2).
 * Retourne le HTML réorganisé, ou l'original si rien n'a changé.
 */
export const moveFaqToEnd = (html) => {
  if (!html || typeof document === 'undefined') return html;

  const container = document.createElement('div');
  container.innerHTML = html;

  let changed = false;
  // Aplatir d'abord les additions imbriquées (poupées russes) — sinon la
  // désimbrication des sections spéciales produit tableau-marqué-FAQ, TL;DR
  // séparé de ses puces et <ins> vides.
  changed = flattenNestedAdditions(container) || changed;
  changed = splitSpecialFromIns(container, FAQ_TITLE_RX, 'tt-faq') || changed;
  changed = splitSpecialFromIns(container, TLDR_TITLE_RX, 'tt-tldr', true) || changed;

  // Nettoyage défensif — quoi qu'il arrive en amont, aucun marqueur ne doit
  // rester sur un bloc qui ne correspond pas à sa section, et aucun <ins>
  // spécial vide ne doit subsister :
  for (const ins of Array.from(container.querySelectorAll('ins.tt-faq, ins.tt-tldr'))) {
    // 1) <ins> spécial vide (résidu de découpe) → supprimé
    if (!ins.textContent.trim() && !ins.querySelector('img, table, iframe, video')) {
      ins.remove(); changed = true; continue;
    }
    // 2) marqueur tt-faq sur un bloc sans vraie FAQ → retiré
    if (ins.classList.contains('tt-faq') && !looksLikeRealFaq(ins)) {
      ins.classList.remove('tt-faq'); changed = true;
    }
    // 3) marqueur tt-tldr sur un bloc sans titre TL;DR → retiré
    if (ins.classList.contains('tt-tldr')
        && !Array.from(ins.querySelectorAll('h1, h2, h3, h4')).some(h => TLDR_TITLE_RX.test(h.textContent || ''))) {
      ins.classList.remove('tt-tldr'); changed = true;
    }
  }

  changed = moveFaqBlockToEnd(container) || changed;
  changed = moveTldrAfterIntro(container) || changed;

  return changed ? container.innerHTML : html;
};

/**
 * Applique une liste de mises à jour sur un HTML, retourne le HTML annoté
 * et les updates avec leur flag applied + pass.
 */
// ── VERROU LIENS EXTERNES — RÈGLE ABSOLUE, NE JAMAIS AFFAIBLIR ────────────────
// L'agent IA ne doit JAMAIS ajouter ni supprimer de lien EXTERNE (href http(s)
// vers un autre domaine que celui de l'article). Verrou appliqué EN DUR à
// chaque update AVANT application (passes 1 et 2, tous les flux) :
//   • lien externe AJOUTÉ dans "updated" (absent d'"original") → désenveloppé :
//     le texte de l'ancre est conservé, la balise <a> disparaît ;
//   • lien externe SUPPRIMÉ ("original" le contient, "updated" non) :
//       1. si le texte d'ancre existe encore en clair dans "updated" → il est
//          RÉ-ENVELOPPÉ avec le lien d'origine (attributs conservés) ;
//       2. sinon → update REJETÉE (applied:false) : le passage d'origine, avec
//          son lien, reste intact dans l'article.
// Les liens INTERNES (même domaine que l'article, chemins relatifs, ancres #,
// mailto) ne sont PAS concernés — le maillage interne reste une feature voulue.
// Sans URL d'article connue (contenu collé), TOUT lien http(s) absolu est
// considéré externe : protection maximale.

const hostOf = (href) => {
  try { return new URL(href).hostname.replace(/^www\./, '').toLowerCase(); }
  catch { return null; }
};

/**
 * Ne garde que les suggestions de maillage pointant vers le MÊME site que
 * l'article. L'IA choisit ses liens dans la liste des articles du site, mais
 * rien ne l'empêche d'halluciner une URL hors liste : appliquée telle quelle,
 * ce serait un lien EXTERNE injecté par la feature maillage (violation de la
 * règle absolue). Sans URL d'article connue, seuls les chemins relatifs et
 * ancres passent — protection maximale, même philosophie que le verrou.
 */
export const filterSameSiteLinks = (links = [], articleUrl = '') => {
  const articleHost = articleUrl ? hostOf(articleUrl) : null;
  return (links || []).filter((l) => {
    const u = String(l?.url || '').trim();
    if (!u) return false;
    if (!/^https?:\/\//i.test(u)) return /^[/#]/.test(u); // relatif ou ancre = même site ; mailto:/javascript: rejetés
    const h = hostOf(u);
    return !!articleHost && !!h && h === articleHost;
  });
};

// Liens externes d'un fragment HTML : Map href → { text, attrs }
const externalLinksOf = (fragmentHtml, articleHost) => {
  const map = new Map();
  if (!fragmentHtml || typeof document === 'undefined') return map;
  const tmp = document.createElement('div');
  tmp.innerHTML = fragmentHtml;
  tmp.querySelectorAll('a[href]').forEach((a) => {
    const href = a.getAttribute('href') || '';
    if (!/^https?:\/\//i.test(href)) return;            // relatif, #ancre, mailto… → hors périmètre
    const h = hostOf(href);
    if (!h || (articleHost && h === articleHost)) return; // lien interne
    if (!map.has(href)) {
      map.set(href, {
        text: (a.textContent || '').trim(),
        attrs: Array.from(a.attributes).map(({ name, value }) => [name, value]),
      });
    }
  });
  return map;
};

// Désenveloppe les liens externes NON autorisés d'un fragment (texte conservé)
const stripForeignExternalLinks = (fragmentHtml, allowedHrefs, articleHost) => {
  const tmp = document.createElement('div');
  tmp.innerHTML = fragmentHtml;
  let changed = false;
  tmp.querySelectorAll('a[href]').forEach((a) => {
    const href = a.getAttribute('href') || '';
    if (!/^https?:\/\//i.test(href)) return;
    const h = hostOf(href);
    if (!h || (articleHost && h === articleHost)) return;
    if (allowedHrefs.has(href)) return;                  // lien externe préexistant → conservé
    while (a.firstChild) a.parentNode.insertBefore(a.firstChild, a);
    a.remove();
    changed = true;
  });
  return changed ? tmp.innerHTML : fragmentHtml;
};

export const enforceExternalLinkPolicy = (update, articleUrl = '') => {
  if (!update || typeof document === 'undefined') return { update, blocked: false };
  const articleHost = articleUrl ? hostOf(articleUrl) : null;

  // Suppression pure : si le passage supprimé contient un lien externe → rejet
  if (update.type === 'suppression') {
    const removed = externalLinksOf(update.original || '', articleHost);
    return removed.size > 0 ? { update, blocked: true } : { update, blocked: false };
  }

  // Addition : aucun lien externe préexistant → tout lien externe est désenveloppé
  if (update.type === 'addition') {
    if (!update.updated) return { update, blocked: false };
    const cleaned = stripForeignExternalLinks(update.updated, new Map(), articleHost);
    return { update: cleaned === update.updated ? update : { ...update, updated: cleaned }, blocked: false };
  }

  // Remplacement
  if (!update.original || !update.updated) return { update, blocked: false };
  const before = externalLinksOf(update.original, articleHost);
  let updatedHtml = stripForeignExternalLinks(update.updated, before, articleHost);

  const after = externalLinksOf(updatedHtml, articleHost);
  for (const [href, info] of before) {
    if (after.has(href)) continue;
    // Lien externe disparu → ré-envelopper son ancre si elle existe encore en clair
    let reinjected = false;
    if (info.text) {
      const tmp = document.createElement('div');
      tmp.innerHTML = updatedHtml;
      const walker = document.createTreeWalker(tmp, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        const idx = node.textContent.indexOf(info.text);
        if (idx === -1) continue;
        if (node.parentElement?.closest('a')) continue;  // déjà lié
        const range = document.createRange();
        range.setStart(node, idx);
        range.setEnd(node, idx + info.text.length);
        const a = document.createElement('a');
        info.attrs.forEach(([name, value]) => { try { a.setAttribute(name, value); } catch {} });
        try { range.surroundContents(a); reinjected = true; } catch { /* sélection à cheval sur des balises */ }
        break;
      }
      if (reinjected) updatedHtml = tmp.innerHTML;
    }
    if (!reinjected) return { update, blocked: true };
  }

  return {
    update: updatedHtml === update.updated ? update : { ...update, updated: updatedHtml },
    blocked: false,
  };
};

/**
 * Équilibre un fragment HTML produit par l'IA : le passe par un nœud DOM détaché
 * puis le re-sérialise. Toute balise de bloc restée OUVERTE dans le fragment
 * (fréquent en mode Refonte : le modèle émet des sections entières, parfois
 * tronquées, parfois avec un <div>/<section> wrapper non refermé) est fermée
 * DANS le fragment. Sans ça, la balise ouverte fuit dans le document au moment
 * de l'insertion (concaténation de chaînes dans applyDiff/applyAddition) et le
 * navigateur imbrique tout le contenu suivant → cascade d'indentation qui casse
 * la mise en page publiée. Idempotent : un fragment déjà équilibré se
 * re-sérialise à l'identique (mêmes round-trips DOM que le reste du pipeline).
 * N'altère pas les liens (le verrou externe s'exécute AVANT).
 */
export const balanceFragment = (fragment) => {
  if (!fragment || typeof document === 'undefined' || fragment.indexOf('<') === -1) return fragment;
  try {
    // <template> (et NON un <div>) : son contenu est un DocumentFragment qui
    // préserve les fragments tabulaires (<tr>/<td> isolés) au lieu de les écarter
    // par « foster parenting », tout en refermant les balises restées ouvertes.
    const tpl = document.createElement('template');
    tpl.innerHTML = fragment;
    return tpl.innerHTML;
  } catch { return fragment; }
};

/**
 * Verrou liens externes + sécurité structure pour le mode ARTICLE ENTIER.
 *
 * Le pipeline historique applique `enforceExternalLinkPolicy` et `balanceFragment`
 * update par update (voir `applyAllDiffs`). En mode « Audit QAT + Refonte » l'IA
 * renvoie UN bloc HTML complet : il n'y a plus d'update, donc plus aucun de ces
 * deux garde-fous. Cette fonction rejoue la MÊME politique à l'échelle de
 * l'article :
 *   1. tout lien EXTERNE absent de l'original est désenveloppé (texte conservé) ;
 *   2. tout lien EXTERNE de l'original disparu du nouveau texte est ré-enveloppé
 *      sur son ancre si elle existe encore en clair ;
 *   3. s'il ne peut pas être ré-enveloppé, il est reporté dans `missing` — au
 *      caller de REJETER la génération et de relancer (règle 8 : on n'ajoute ni
 *      ne supprime jamais un lien externe, et ce verrou ne s'affaiblit pas).
 * Puis la structure est sécurisée (balises rouvertes fermées, FAQ en fin).
 *
 * Les liens INTERNES (même domaine) ne sont pas concernés : ce sont eux que le
 * rédacteur fournit au lancement.
 *
 * @returns {{ html: string, stripped: string[], missing: string[] }}
 */
export const sanitizeFullArticle = (originalHtml = '', newHtml = '', articleUrl = '') => {
  if (!newHtml || typeof document === 'undefined') {
    return { html: newHtml, stripped: [], missing: [] };
  }
  const articleHost = articleUrl ? hostOf(articleUrl) : null;
  const before = externalLinksOf(originalHtml, articleHost);

  // 1. Liens externes AJOUTÉS → désenveloppés (le texte de l'ancre reste)
  const incoming = externalLinksOf(newHtml, articleHost);
  const stripped = [...incoming.keys()].filter((href) => !before.has(href));
  let html = stripForeignExternalLinks(newHtml, before, articleHost);

  // 2. Liens externes SUPPRIMÉS → ré-enveloppés sur leur ancre si possible
  const missing = [];
  const after = externalLinksOf(html, articleHost);
  for (const [href, info] of before) {
    if (after.has(href)) continue;
    let reinjected = false;
    if (info.text) {
      const tmp = document.createElement('div');
      tmp.innerHTML = html;
      const walker = document.createTreeWalker(tmp, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        const idx = node.textContent.indexOf(info.text);
        if (idx === -1) continue;
        if (node.parentElement?.closest('a')) continue;  // déjà lié
        const range = document.createRange();
        range.setStart(node, idx);
        range.setEnd(node, idx + info.text.length);
        const a = document.createElement('a');
        info.attrs.forEach(([name, value]) => { try { a.setAttribute(name, value); } catch {} });
        try { range.surroundContents(a); reinjected = true; } catch { /* sélection à cheval sur des balises */ }
        break;
      }
      if (reinjected) html = tmp.innerHTML;
    }
    if (!reinjected) missing.push(href);
  }

  // 3. Sécurité structure — mêmes garde-fous que le mode update
  html = balanceFragment(html);
  html = moveFaqToEnd(html);

  if (stripped.length) {
    console.warn(`[refonte] ${stripped.length} lien(s) externe(s) ajouté(s) par l'IA → désenveloppé(s) :`, stripped);
  }
  if (missing.length) {
    console.warn(`[refonte] ${missing.length} lien(s) externe(s) d'origine INTROUVABLE(s) → génération à rejeter :`, missing);
  }
  return { html, stripped, missing };
};

// ── Suppressions : absorber les petits mots orphelins ─────────────────────────
// Quand l'IA barre « chats noirs » dans « voici les chats noirs », le
// déterminant « les » reste orphelin après acceptation (« voici les . »).
// Cette passe étend chaque <del> de suppression PURE (sans <mark> adjacent —
// dans un remplacement le vert prend la place, rien n'est orphelin) aux mots
// grammaticaux qui le précèdent immédiatement : déterminants, possessifs,
// élisions (l'/d'), conjonctions et virgule de liste. L'absorption est en
// boucle (« et le », « de la »…). Un rejet reste sans perte : le texte absorbé
// vit DANS le <del>, donc il est restauré à l'identique.
const ORPHAN_BEFORE_RX = /(?:\b(?:les?|la|une?|des?|du|aux?|ce|cet|cette|ces|mon|ma|mes|ton|ta|tes|son|sa|ses|notre|nos|votre|vos|leur|leurs|et|ou)\s+|\b[ld]['’]\s*|,\s*)$/i;

export const absorbOrphanDeterminers = (html) => {
  if (typeof document === 'undefined' || !html || html.indexOf('deleted-content') === -1) return html;
  const div = document.createElement('div');
  div.innerHTML = html;
  let changed = false;
  div.querySelectorAll('del.deleted-content').forEach((del) => {
    const next = del.nextElementSibling;
    if (next && next.tagName === 'MARK' && next.classList.contains('updated-content')) return;
    const prev = del.previousSibling;
    if (!prev || prev.nodeType !== Node.TEXT_NODE) return;
    let m;
    while ((m = prev.textContent.match(ORPHAN_BEFORE_RX))) {
      const cut = prev.textContent.length - m[0].length;
      del.insertBefore(document.createTextNode(prev.textContent.slice(cut)), del.firstChild);
      prev.textContent = prev.textContent.slice(0, cut);
      changed = true;
      if (!prev.textContent) break;
    }
  });
  return changed ? div.innerHTML : html;
};

export const applyAllDiffs = (html, updates, passNumber = 1, articleUrl = '') => {
  let updatedHtml = html;
  const withStatus = (updates || []).map((rawUpdate) => {
    // Verrou liens externes (règle absolue) — assainit ou rejette AVANT application
    const { update: policed, blocked } = enforceExternalLinkPolicy(rawUpdate, articleUrl);
    if (blocked) {
      console.warn(`[diff p${passNumber}] Update BLOQUÉE (supprimerait un lien externe) :`, (policed.original || '').substring(0, 70));
      return { ...policed, applied: false, pass: passNumber, blockedReason: 'lien-externe' };
    }
    // Sécurité structure : équilibrer le fragment inséré (updated) pour qu'aucune
    // balise non fermée ne fuie dans le document (cascade d'imbrication en Refonte).
    const update = policed.updated ? { ...policed, updated: balanceFragment(policed.updated) } : policed;
    // Nouveau paragraphe (enrichissement actualités)
    if (update.type === 'addition') {
      if (!update.updated) return { ...update, applied: false, pass: passNumber };
      // Le résumé (TL;DR) est TOUJOURS placé après l'intro, sans dépendre de l'anchor.
      if (isTldrAddition(update)) {
        const { html: nh } = insertAfterIntro(updatedHtml, update.updated);
        updatedHtml = nh;
        return { ...update, applied: true, pass: passNumber };
      }
      // Tableau comparatif → placement forcé dans le 2e H2 (sinon dernier dispo).
      if (isTableAddition(update)) {
        const { html: nh } = insertAfterNthH2(updatedHtml, update.updated, 2);
        updatedHtml = nh;
        return { ...update, applied: true, pass: passNumber };
      }
      const { html: newHtml, matched } = applyAddition(updatedHtml, update.anchor || '', update.updated);
      if (matched) {
        updatedHtml = newHtml;
        return { ...update, applied: true, pass: passNumber };
      }
      // Anchor introuvable (le passage visé a été remanié ou a disparu depuis
      // l'analyse) : placer le bloc au plus fort recouvrement lexical plutôt
      // que de PERDRE l'addition — une suggestion ne doit pas pointer dans le
      // vide. Marqué placed:'fuzzy' pour que l'UI puisse le signaler.
      const fuzzyRef = `${update.anchor || ''} ${update.reason || ''}`.trim() || update.updated;
      const fuzzy = insertNearClosestParagraph(updatedHtml, fuzzyRef, update.updated);
      if (fuzzy.matched) {
        updatedHtml = fuzzy.html;
        console.warn(`[diff p${passNumber}] Addition placée au plus proche (anchor introuvable):`, (update.anchor || '').substring(0, 70));
        return { ...update, applied: true, pass: passNumber, placed: 'fuzzy' };
      }
      console.warn(`[diff p${passNumber}] Addition non localisée (anchor):`, (update.anchor || '').substring(0, 70));
      return { ...update, applied: false, pass: passNumber };
    }
    // Suppression pure (redondance / répétition) : barré rouge SANS ajout vert.
    // Le contenu barré est réellement retiré dans la vue « Après » (getFinalHtml supprime les <del>).
    if (update.type === 'suppression') {
      if (!update.original) return { ...update, applied: false, pass: passNumber };
      const { html: delHtml, matched: delMatched } = applyDiff(updatedHtml, update.original, '', update.reason, true);
      if (delMatched) { updatedHtml = delHtml; return { ...update, applied: true, pass: passNumber }; }
      console.warn(`[diff p${passNumber}] Suppression non localisée :`, update.original.substring(0, 70));
      return { ...update, applied: false, pass: passNumber };
    }
    // Remplacement classique
    if (!update.original || !update.updated) return { ...update, applied: false, pass: passNumber };
    const { html: newHtml, matched } = applyDiff(updatedHtml, update.original, update.updated, update.reason);
    if (matched) {
      updatedHtml = newHtml;
      return { ...update, applied: true, pass: passNumber };
    }
    console.warn(`[diff p${passNumber}] Non localisé :`, update.original.substring(0, 70));
    return { ...update, applied: false, pass: passNumber };
  });
  updatedHtml = cleanResiduals(updatedHtml);
  updatedHtml = liftMarksOutOfDel(updatedHtml); // le texte ajouté (vert) ne doit jamais être barré
  updatedHtml = absorbOrphanDeterminers(updatedHtml); // suppressions : pas de « le/la/des » orphelins
  return { html: updatedHtml, updates: withStatus };
};
