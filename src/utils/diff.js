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
 * Tente de localiser `original` dans `html` et l'entoure des balises diff.
 * 4 stratégies par ordre de précision décroissante.
 * @returns {{ html: string, matched: boolean }}
 */
export const applyDiff = (html, original, updated, reason) => {
  const safeReason = (reason || "").replace(/"/g, "'");
  const replacement = (matched) =>
    `<del class="deleted-content">${matched}</del><mark class="updated-content" title="${safeReason}">${updated}</mark>`;

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
 * Insère `updated` après le bloc contenant `anchor`.
 * Utilisé pour les updates de type "addition" (nouveaux paragraphes).
 * @returns {{ html: string, matched: boolean }}
 */
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

  const insertPos = anchorEnd + blockMatch.index + blockMatch[0].length;
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
  if (h2) return { html: html.slice(0, h2.index) + block + html.slice(h2.index), matched: true };
  const p = /<\/p>/i.exec(html);
  if (p) { const pos = p.index + p[0].length; return { html: html.slice(0, pos) + block + html.slice(pos), matched: true }; }
  const fig = /<\/figure>/i.exec(html);
  if (fig) { const pos = fig.index + fig[0].length; return { html: html.slice(0, pos) + block + html.slice(pos), matched: true }; }
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
  bestBlock.insertAdjacentElement('afterend', ins);
  return { html: div.innerHTML, matched: true };
};

/**
 * Détecte la section FAQ dans le HTML et la déplace à la fin.
 * Supporte : class/id contenant "faq", headings contenant "faq" / "questions fréquentes".
 * Retourne le HTML réorganisé, ou l'original si aucune FAQ n'est trouvée / déjà en fin.
 */
export const moveFaqToEnd = (html) => {
  if (!html || typeof document === 'undefined') return html;

  const container = document.createElement('div');
  container.innerHTML = html;

  // Stratégie 1 : enfant direct avec classe/id contenant "faq"
  // Ex: <div class="schema-faq">, <section id="faq">, <div class="wp-block-yoast-faq-block">
  for (const child of Array.from(container.children)) {
    const cls = (child.className || '').toLowerCase();
    const id  = (child.id || '').toLowerCase();
    if (cls.includes('faq') || id.includes('faq') || id === 'foire-aux-questions') {
      // Extraire les <ins class="added-content"> qui ont atterri à l'intérieur du bloc FAQ
      // (cas : passe 2 a ancré sur du texte à l'intérieur du FAQ → insertion enfouie dedans)
      const insertions = Array.from(child.querySelectorAll('ins.added-content'));
      for (const ins of insertions) container.insertBefore(ins, child);

      const alreadyLast = child === container.lastElementChild;
      if (!alreadyLast) container.appendChild(child);
      return (insertions.length || !alreadyLast) ? container.innerHTML : html;
    }
  }

  // Stratégie 2 : heading direct (h1-h4) contenant "faq" ou "questions fréquentes"
  for (const h of Array.from(container.querySelectorAll('h1, h2, h3, h4'))) {
    if (h.parentNode !== container) continue;          // pas un enfant direct → skip
    const text = h.textContent.toLowerCase().trim();
    if (
      !text.includes('faq') &&
      !text.includes('questions fréquentes') &&
      !text.includes('questions frequentes') &&
      !text.includes('foire aux questions')
    ) continue;

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
    if (alreadyAtEnd && !insertions.length) return html;

    for (const n of faqNodes) container.appendChild(n);
    return container.innerHTML;
  }

  return html;
};

/**
 * Applique une liste de mises à jour sur un HTML, retourne le HTML annoté
 * et les updates avec leur flag applied + pass.
 */
export const applyAllDiffs = (html, updates, passNumber = 1) => {
  let updatedHtml = html;
  const withStatus = (updates || []).map((update) => {
    // Nouveau paragraphe (enrichissement actualités)
    if (update.type === 'addition') {
      if (!update.updated) return { ...update, applied: false, pass: passNumber };
      // Le résumé (TL;DR) est TOUJOURS placé après l'intro, sans dépendre de l'anchor.
      if (isTldrAddition(update)) {
        const { html: nh } = insertAfterIntro(updatedHtml, update.updated);
        updatedHtml = nh;
        return { ...update, applied: true, pass: passNumber };
      }
      const { html: newHtml, matched } = applyAddition(updatedHtml, update.anchor || '', update.updated);
      if (matched) {
        updatedHtml = newHtml;
        return { ...update, applied: true, pass: passNumber };
      }
      console.warn(`[diff p${passNumber}] Addition non localisée (anchor):`, (update.anchor || '').substring(0, 70));
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
  return { html: updatedHtml, updates: withStatus };
};
