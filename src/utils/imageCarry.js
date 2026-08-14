// ── R4 — LES IMAGES DE L'ARTICLE D'ORIGINE NE DISPARAISSENT PLUS ──────────────
//
// Règle métier (demande d'Andrianina, août 2026) : « toutes les images doivent
// être là » — aucune image de l'article d'origine ne doit disparaître en
// traversant les quatre phases (audit, génération, obsolescence, relecture).
//
// LE DÉFAUT, exactement le même que celui des liens internes corrigé en R1 :
// `agentQat.js` ne mentionnait NULLE PART `img`, `figure` ni `alt`. Le prompt de
// refonte détaillait longuement comment reproduire chaque lien externe et
// interne, et ne disait RIEN des images. Le modèle réécrivait l'article et
// laissait tomber les `<img>` ; aucun verrou ne s'en apercevait (`diff.js` ne
// parle d'`img` que dans des gardes anti-paragraphes-vides). Les images
// survivent pourtant très bien à l'ingestion WordPress (`proxy.js`, liste
// blanche KEEP_ATTRS : src, srcset, sizes, alt, title ; liste STRUCTURAL qui
// protège `<img>` de la suppression des éléments vides) : elles arrivent
// intactes jusqu'au prompt. Le défaut était purement en aval.
//
// CE MODULE EST AUTONOME, comme `linkZones.js` et pour la même raison : il est
// importé par `diff.js`, qui n'importait jusqu'ici que `linkZones`. Aucune
// dépendance, donc aucun cycle possible. Il ne touche à AUCUNE fonction du
// verrou liens externes (`externalLinksOf`, `stripForeignExternalLinks`,
// `realignExternalHrefs`, `listExternalLinks`) : celles-ci sont partagées par
// TOUS les flux, les modifier changerait la règle 8 d'un coup partout.
//
// SANCTION : jamais un rejet. Une image perdue est RÉINSÉRÉE quand son point
// d'ancrage se retrouve, et signalée par un AVERTISSEMENT NON BLOQUANT sinon.
// C'est le même raisonnement qu'en R1 et il n'est pas cosmétique : côté refonte,
// chaque rejet ÉCRASE le message utilisateur de l'essai suivant (`currentUser`,
// agentQat.js), donc une 4ᵉ cause de rejet ferait perdre la consigne de reprise
// du verrou liens externes — on affaiblirait la règle 8 sans toucher à diff.js.
//
// ── LA DIFFICULTÉ PROPRE AUX IMAGES : RETROUVER LEUR PLACE ────────────────────
// Ré-envelopper un lien perdu est facile : son ancre est du TEXTE, on la
// retrouve. Une image n'a pas d'ancre. Trois stratégies ont été envisagées ;
// voici ce qui est retenu, et ce qui est écarté.
//
//   1. RETENU — ANCRAGE PAR LE TEXTE VOISIN. On mémorise, dans l'original, la
//      signature du bloc qui PRÉCÈDE l'image (ses 48 derniers caractères
//      normalisés — c'est la phrase juste avant l'image) et celle du bloc qui la
//      SUIT (ses 48 premiers caractères). Si cette signature se retrouve TELLE
//      QUELLE dans le nouveau texte, l'image reprend sa place exacte. Une
//      correspondance exacte sur 48 caractères ne se produit pas par hasard.
//
//   2. RETENU EN SECOURS, ET DIT — ANCRAGE PAR LA SECTION. Le paragraphe voisin
//      a été réécrit, mais le TITRE de sa section se retrouve à l'identique :
//      l'image revient dans CETTE section (en tête si elle y était en tête,
//      en fin sinon). Ce n'est pas une place inventée — le titre est un point
//      d'ancrage réellement retrouvé dans le nouveau texte — mais c'est une
//      place APPROXIMATIVE : elle est marquée `how: 'section'` et DITE au
//      rédacteur, jamais présentée comme une restauration exacte.
//
//   3. ÉCARTÉ — POSITION RELATIVE (« Nième bloc »). C'est précisément la phase
//      de refonte qui change le plan (`majDepth` : restructuration, refonte
//      totale) : un repère positionnel est donc le MOINS fiable exactement
//      quand il servirait le plus. Une photo de pompe à chaleur atterrissant
//      sous un paragraphe sur le crédit d'impôt est pire qu'une ligne
//      d'avertissement disant que l'image n'a pas été replacée. Aucun repli
//      positionnel n'existe dans ce module.
//
//   4. AUCUN ANCRAGE → RIEN N'EST INVENTÉ. L'image n'est pas placée, elle est
//      SIGNALÉE. Non bloquant.
//
// ── CE QUI EST HORS PÉRIMÈTRE, VOLONTAIREMENT ────────────────────────────────
//   • `figure[data-featured]` — l'image à la une est un artefact interne TONTON
//     AI, injecté par le proxy pour la seule prévisualisation, géré à part
//     (ArticleResult.jsx, ImageAltCaptionPanel.jsx) et RETIRÉ systématiquement du
//     contenu publié (sinon doublon avec le widget « Image mise en avant » du
//     thème). La réinjecter serait une régression, pas une réparation.
//   • `[data-media-overlay]` — décor d'éditeur (vignette YouTube posée par
//     `lockMedia`), jamais publié : ce n'est pas une image de l'article.
//   • Les `<iframe>` et les `<video>` : hors périmètre de cette tâche. Elles
//     souffrent du MÊME défaut (le prompt de refonte n'en parle pas davantage) —
//     c'est dit dans le rapport, ce n'est pas traité ici.

/** Blocs porteurs de texte, utilisés comme points d'ancrage. */
const BLOCK_SEL = 'p,h1,h2,h3,h4,h5,h6,li,blockquote,figcaption,pre,dd,dt,td,th';

/** Conteneurs neutres : on remonte JUSQU'À eux, jamais au-dessus. */
const CONTAINER_TAGS = new Set(['DIV', 'SECTION', 'ARTICLE', 'MAIN', 'BODY']);

/** Longueur minimale d'un bloc pour servir d'ancrage (sous ce seuil : trop banal). */
const MIN_SIG_CHARS = 40;
/** Longueur d'une signature. 48 caractères exacts ne coïncident pas par hasard. */
const SIG_LEN = 48;

/** Marque temporaire posée sur les unités réinsérées, retirée avant de rendre le HTML. */
const TMP_ATTR = 'data-img-carry-tmp';

/**
 * Normalisation de comparaison. Volontairement locale (ce module n'importe
 * rien) et plus agressive que `normalizeText` de diff.js : on compare du texte,
 * on ne réécrit jamais l'article avec.
 */
const norm = (s) => String(s || '')
  .replace(/[  ]/g, ' ')
  .replace(/[‘’]/g, "'")
  .replace(/[“”«»]/g, '"')
  .replace(/[–—]/g, '-')
  .replace(/\s+/g, ' ')
  .trim()
  .toLowerCase();

const RELATIVE_BASE = 'https://article.local/';

/**
 * Clé d'identité d'une image.
 *
 * Le suffixe de TAILLE WordPress est retiré : `photo-1024x768.jpg` et
 * `photo.jpg` sont LA MÊME image. Sans ça, un modèle qui recopie la vignette au
 * lieu de l'original ferait croire l'image perdue et on en insérerait une
 * SECONDE copie dans l'article — un doublon visible, pire que le défaut d'origine.
 * L'hôte est normalisé (`www.` retiré, minuscules) ; la query et le fragment sont
 * ignorés (`?ver=`, cache-busting). Le CHEMIN garde sa casse d'origine sur les
 * serveurs sensibles à la casse, mais la comparaison est faite en minuscules :
 * deux fichiers ne différant que par la casse sont assez improbables pour que le
 * risque de faux positif soit préférable au risque de doublon.
 */
export const imageKey = (src = '') => {
  const raw = String(src || '').trim();
  if (!raw) return '';
  if (/^data:/i.test(raw)) return raw.slice(0, 256).toLowerCase();
  let s = raw;
  try {
    const u = new URL(raw, RELATIVE_BASE);
    s = `${u.hostname.replace(/^www\./i, '').toLowerCase()}${u.pathname}`;
  } catch { /* URL inexploitable : on compare la chaîne brute */ }
  return s.replace(/-\d{2,5}x\d{2,5}(?=\.[a-z0-9]+$)/i, '').toLowerCase();
};

/** L'image est-elle hors périmètre (image à la une, décor d'éditeur, sans src) ? */
const isOutOfScope = (img) => {
  if (!img.getAttribute('src')) return true;
  if (typeof img.closest !== 'function') return false;
  return !!img.closest('[data-featured],[data-media-overlay]');
};

/**
 * UNITÉ à mémoriser et à réinsérer pour une image donnée.
 *   • la `<figure>` si l'image y vit — l'image ET sa `<figcaption>` vont
 *     ensemble, on ne les sépare JAMAIS ;
 *   • sinon le `<a>` qui n'enveloppe QUE l'image (image cliquable) : le
 *     reproduire tel quel restaure aussi son lien, qui existait déjà dans
 *     l'original — donc rien d'ajouté au sens de la règle 8 ;
 *   • sinon l'`<img>` elle-même.
 */
const unitOf = (img) => {
  const fig = typeof img.closest === 'function' ? img.closest('figure') : null;
  if (fig && !fig.hasAttribute('data-featured')) return fig;
  const a = img.parentElement;
  if (a && a.tagName === 'A' && !(a.textContent || '').trim()) return a;
  return img;
};

/** Remonte jusqu'au bloc de plus haut niveau (hors conteneurs neutres et racine). */
const topLevelOf = (el, root) => {
  let cur = el;
  while (cur.parentElement && cur.parentElement !== root
         && !CONTAINER_TAGS.has(cur.parentElement.tagName)) {
    cur = cur.parentElement;
  }
  return cur;
};

/** Signatures (tête / queue) d'un bloc, ou null s'il est trop court pour ancrer. */
const sigOf = (el) => {
  const t = norm(el && el.textContent);
  if (t.length < MIN_SIG_CHARS) return null;
  return { head: t.slice(0, SIG_LEN), tail: t.slice(-SIG_LEN) };
};

/** Blocs FEUILLES porteurs de texte (un `<li>` compte, la `<ul>` qui le contient non). */
const textBlocks = (root) => Array.from(root.querySelectorAll(BLOCK_SEL))
  .filter((b) => !b.querySelector(BLOCK_SEL));

/**
 * Contexte d'ancrage d'une unité : bloc précédent, bloc suivant, titre de section.
 * `firstInSection` dit si l'image ouvrait sa section (aucun bloc de texte entre
 * le titre et elle) — c'est ce qui décide, en secours, du haut ou du bas de la
 * section.
 */
const contextOf = (root, unit) => {
  const blocks = textBlocks(root).filter((b) => !b.contains(unit) && !unit.contains(b));
  let before = null;
  let after = null;
  blocks.forEach((b) => {
    const pos = unit.compareDocumentPosition(b);
    if (pos & Node.DOCUMENT_POSITION_PRECEDING) before = b;
    else if (pos & Node.DOCUMENT_POSITION_FOLLOWING && !after) after = b;
  });

  const headings = Array.from(root.querySelectorAll('h1,h2,h3,h4,h5,h6'))
    .filter((h) => unit.compareDocumentPosition(h) & Node.DOCUMENT_POSITION_PRECEDING);
  const heading = headings.length ? headings[headings.length - 1] : null;

  return {
    before: before ? sigOf(before) : null,
    after: after ? sigOf(after) : null,
    heading: heading ? norm(heading.textContent) : '',
    // « en tête de section » : aucun bloc de texte entre le titre et l'image.
    firstInSection: !!heading && (!before
      || !(heading.compareDocumentPosition(before) & Node.DOCUMENT_POSITION_FOLLOWING)),
    // Extrait lisible pour le PROMPT (ce qui précède l'image), jamais pour placer.
    lead: before ? norm(before.textContent).slice(-90) : '',
  };
};

/**
 * INVENTAIRE — les images de l'article, dans l'ordre du document.
 *
 * Jumelle de `listInternalLinks` (diff.js) : sert à NOMMER au modèle, AVANT la
 * génération, les images qu'il doit reproduire. Prévenir la perte coûte moins
 * cher que de la réparer.
 *
 * @returns {Array<{key:string, src:string, alt:string, html:string, tag:string,
 *                  caption:string, lead:string}>}
 */
export const listArticleImages = (html = '') => {
  if (!html || typeof document === 'undefined') return [];
  const root = document.createElement('div');
  root.innerHTML = html;
  const seen = new Set();
  const out = [];
  Array.from(root.querySelectorAll('img')).forEach((img) => {
    if (isOutOfScope(img)) return;
    const key = imageKey(img.getAttribute('src'));
    if (!key || seen.has(key)) return;
    seen.add(key);
    const unit = unitOf(img);
    const ctx = contextOf(root, unit);
    const cap = unit.querySelector ? unit.querySelector('figcaption') : null;
    out.push({
      key,
      src: img.getAttribute('src') || '',
      alt: img.getAttribute('alt') || '',
      html: unit.outerHTML,
      tag: img.outerHTML,
      caption: cap ? (cap.textContent || '').trim() : '',
      lead: ctx.lead,
    });
  });
  return out;
};

/** Clés des images RÉELLEMENT présentes dans un HTML (hors périmètre exclu). */
const imageKeysIn = (root) => {
  const keys = new Set();
  Array.from(root.querySelectorAll('img')).forEach((img) => {
    if (isOutOfScope(img)) return;
    const k = imageKey(img.getAttribute('src'));
    if (k) keys.add(k);
  });
  return keys;
};

/**
 * Bloc du nouveau document portant cette signature, ou null.
 * Correspondance EXACTE sur 48 caractères normalisés — pas de score, pas de
 * recouvrement lexical : un placement approximatif se paierait par une image au
 * mauvais endroit, ce qui est pire qu'une image signalée manquante.
 */
const findBySig = (root, sig, order = ['tail', 'head']) => {
  if (!sig) return null;
  const blocks = textBlocks(root);
  for (const which of order) {
    const needle = sig[which];
    if (!needle) continue;
    const hit = blocks.find((b) => norm(b.textContent).includes(needle));
    if (hit) return hit;
  }
  return null;
};

/** Insère `unit` juste après `node`, en sautant les unités déjà réinsérées ici. */
const insertAfter = (unit, node) => {
  let ref = node;
  while (ref.nextElementSibling && ref.nextElementSibling.hasAttribute(TMP_ATTR)) {
    ref = ref.nextElementSibling;
  }
  ref.parentNode.insertBefore(unit, ref.nextSibling);
};

/**
 * PLACEMENT d'une unité dans le nouveau document.
 * @returns {'contexte'|'section'|null} comment elle a été placée, null si nulle part.
 */
const place = (root, unit, ctx) => {
  // 1. Le bloc qui PRÉCÉDAIT l'image se retrouve → l'image reprend sa place exacte.
  //    On cherche d'abord par la QUEUE de ce bloc : c'est la phrase qui touchait
  //    l'image, donc l'ancrage le plus proche de sa vraie position.
  const prev = findBySig(root, ctx.before, ['tail', 'head']);
  if (prev) { insertAfter(unit, topLevelOf(prev, root)); return 'contexte'; }

  // 2. À défaut, le bloc qui la SUIVAIT — cherché par la TÊTE, pour la même raison.
  const next = findBySig(root, ctx.after, ['head', 'tail']);
  if (next) {
    const target = topLevelOf(next, root);
    target.parentNode.insertBefore(unit, target);
    return 'contexte';
  }

  // 3. Secours ANNONCÉ : le titre de section se retrouve à l'identique. Place
  //    approximative mais section juste — et c'est DIT au rédacteur.
  if (ctx.heading) {
    const h = Array.from(root.querySelectorAll('h1,h2,h3,h4,h5,h6'))
      .find((x) => norm(x.textContent) === ctx.heading);
    if (h) {
      const top = topLevelOf(h, root);
      if (ctx.firstInSection) { insertAfter(unit, top); return 'section'; }
      const lvl = Number(h.tagName[1]);
      let last = top;
      for (let el = top.nextElementSibling; el; el = el.nextElementSibling) {
        const l = /^H[1-6]$/.test(el.tagName) ? Number(el.tagName[1]) : 0;
        if (l && l <= lvl) break;                        // la section se referme
        last = el;
      }
      insertAfter(unit, last);
      return 'section';
    }
  }

  // 4. Aucun ancrage : on n'invente RIEN.
  return null;
};

/**
 * Reprend les images de l'original absentes du nouveau texte.
 *
 * Réparation DÉTERMINISTE, sans aucun appel IA : l'unité d'origine (figure +
 * figcaption, ou img) est réinsérée TELLE QUELLE — src, srcset, sizes, alt,
 * title, loading, width, height à l'identique, puisque c'est le même HTML.
 * Aucune phrase existante n'est touchée.
 *
 * NO-OP STRICT si `originalHtml` est vide : après un F5 sur un article dont le
 * contenu a été offloadé, la référence « AVANT » vaut '' — sans cette garde on
 * croirait TOUTES les images perdues et on en réinjecterait au hasard.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.appendIfNoAnchor=false] Réservé au flux des DIFFS
 *   (fragment) : le fragment REMPLACE exactement la région où vivait l'image,
 *   donc la remettre en fin de fragment n'est pas une place inventée, c'est la
 *   même région du document. Interdit à l'échelle de l'article entier.
 * @returns {{ html:string,
 *             restored:Array<{src:string,alt:string,how:string}>,
 *             missing:Array<{src:string,alt:string,reason:string}> }}
 */
export const carryOverImages = (originalHtml = '', newHtml = '', { appendIfNoAnchor = false } = {}) => {
  if (!originalHtml || !newHtml || typeof document === 'undefined'
      || originalHtml.indexOf('<img') === -1) {
    return { html: newHtml, restored: [], missing: [] };
  }
  const src = document.createElement('div');
  src.innerHTML = originalHtml;
  const imgs = Array.from(src.querySelectorAll('img')).filter((i) => !isOutOfScope(i));
  if (!imgs.length) return { html: newHtml, restored: [], missing: [] };

  const root = document.createElement('div');
  root.innerHTML = newHtml;
  const present = imageKeysIn(root);

  const restored = [];
  const missing = [];
  const done = new Set();

  imgs.forEach((img) => {
    const key = imageKey(img.getAttribute('src'));
    if (!key || done.has(key)) return;
    done.add(key);
    if (present.has(key)) return;                       // déjà là : on n'en met pas une seconde

    const unit = unitOf(img);
    const ctx = contextOf(src, unit);
    const clone = unit.cloneNode(true);
    clone.setAttribute(TMP_ATTR, '1');

    let how = place(root, clone, ctx);
    if (!how && appendIfNoAnchor) { root.appendChild(clone); how = 'fragment'; }

    const entry = { src: img.getAttribute('src') || '', alt: img.getAttribute('alt') || '' };
    if (how) { present.add(key); restored.push({ ...entry, how }); }
    else missing.push({ ...entry, reason: 'aucun-ancrage' });
  });

  if (!restored.length) {
    if (missing.length) {
      console.warn(`[R4 images] ${missing.length} image(s) de l'article d'origine absente(s) et non replaçable(s) — AVERTISSEMENT non bloquant :`, missing.map((i) => i.src));
    }
    return { html: newHtml, restored, missing };
  }

  root.querySelectorAll(`[${TMP_ATTR}]`).forEach((el) => el.removeAttribute(TMP_ATTR));
  const approx = restored.filter((r) => r.how === 'section').length;
  console.warn(`[R4 images] ${restored.length} image(s) de l'article d'origine réinsérée(s)${approx ? ` (dont ${approx} au niveau de la SECTION, placement approximatif à vérifier)` : ''} :`, restored.map((i) => i.src));
  if (missing.length) {
    console.warn(`[R4 images] ${missing.length} image(s) non replaçable(s) (contexte disparu) — AVERTISSEMENT non bloquant :`, missing.map((i) => i.src));
  }
  return { html: root.innerHTML, restored, missing };
};

/**
 * Volet R4 du flux des DIFFS (passes 1 et 2 d'`applyAllDiffs`, donc les phases 3
 * OBSOLESCENCE et 4 RELECTURE). Appelée À CÔTÉ d'`enforceExternalLinkPolicy`,
 * jamais dedans : le verrou de la règle 8 garde son contrat et ses tests.
 *
 * NO-OP STRICT dès que le fragment remplacé ne contient aucune `<img>` — c'est
 * l'écrasante majorité des updates, qui restent donc rigoureusement inchangées.
 *
 * NE BLOQUE JAMAIS (pas de `blocked` dans le retour, par construction).
 * @returns {{ update:object, missing:Array, restored:Array }}
 */
export const enforceImageCarryOver = (update) => {
  const none = { update, missing: [], restored: [] };
  if (!update || typeof document === 'undefined') return none;
  // Une addition n'écrase rien : elle ne peut pas faire perdre une image.
  if (update.type === 'addition') return none;
  const original = update.original || '';
  if (original.indexOf('<img') === -1) return none;      // NO-OP strict

  // Suppression pure : le passage disparaît AVEC ses images. Rien à replacer dans
  // un texte qui n'existera plus — on SIGNALE seulement (non bloquant : la
  // suppression est une décision d'audit, et le filet de publication repassera
  // sur l'article entier).
  if (update.type === 'suppression') {
    return {
      update,
      restored: [],
      missing: listArticleImages(original).map((i) => ({ src: i.src, alt: i.alt, reason: 'supprime' })),
    };
  }

  if (!update.updated) return none;
  const { html, restored, missing } = carryOverImages(original, update.updated, { appendIfNoAnchor: true });
  return {
    update: html === update.updated ? update : { ...update, updated: html },
    restored,
    missing,
  };
};
