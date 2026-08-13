// ── R2 — TOUTES les suggestions de lien interne sont intégrées ────────────────
//
// Règle métier (décision explicite d'Andrianina) : « toutes les suggestions de
// lien interne doivent être TOUTES intégrées dans le texte ». Jusqu'ici R2
// n'existait NULLE PART : une phrase de prompt, plus une auto-déclaration du
// modèle (`ancres_placees`) affichée sans aucun contrôle. Personne ne comptait
// rien, et un lien du brief oublié par l'IA partait en production sans un mot.
//
// Ce module fait DEUX choses, dans cet ordre :
//   1. TISSAGE — l'ancre du brief figure déjà en clair dans le texte : on
//      l'enveloppe sur place. Portage de l'algorithme éprouvé de
//      ArticleResult.jsx (`weaveLinksInto`, TreeWalker, une injection par lien),
//      avec des EXCLUSIONS ÉLARGIES (voir EXCLUDE_SEL et forbiddenZones) : le
//      sélecteur d'origine n'excluait ni les tableaux, ni la FAQ, ni le TL;DR,
//      alors que la règle affichée au rédacteur (QatBriefFields) et la consigne
//      envoyée à l'IA (agentQat) les interdisent explicitement. Un portage naïf
//      aurait posé une ancre dans un tableau comparatif.
//   2. FORÇAGE À 100 % — l'ancre ne figure NULLE PART : le code REDIGE lui-même
//      une clause courte qui la porte, en fin du paragraphe le plus pertinent.
//      Décision assumée en connaissance du risque. Les deux garde-fous promis :
//        • DÉTERMINISTE — aucun appel IA, aucun aléa, et on ne triture JAMAIS une
//          phrase existante : on AJOUTE une clause, on n'en réécrit aucune ;
//        • MARQUÉ VISIBLEMENT — classe CSS + data-attribut + infobulle, pour que
//          le rédacteur repère d'un coup d'œil le texte écrit par du code et le
//          relise. La MARQUE ne part pas en production (débalisée par
//          `exportAsHtml`, comme [data-il-idx]) ; le LIEN, lui, reste.
//
// RÈGLE 8 — le placement refiltre TOUJOURS par domaine (`filterSameSiteLinks`) :
// poser une URL hors domaine saisie par erreur dans le maillage serait un LIEN
// EXTERNE AJOUTÉ. Ce module ne touche à AUCUN lien externe existant.
//
// Ce module ne doit tourner qu'APRÈS `sanitizeFullArticle` : ajouter des ancres
// avant le verrou externe ferait échouer `Range.surroundContents` sur les ancres
// à cheval sur des balises et augmenterait mécaniquement le taux de rejet.

import { escRx, filterSameSiteLinks } from './diff';
import { cleanLinkRows } from '../constants/majMode';

// ── Marque de rédaction automatique ───────────────────────────────────────────
// Même mécanique que [data-il-idx] : un <span> porteur, débalisé à l'export
// (src/utils/export.js) → le lien survit à la publication, la marque non.
export const WRITTEN_MARK_ATTR  = 'data-lien-redige';
export const WRITTEN_MARK_CLASS = 'lien-redige';
export const WRITTEN_MARK_TITLE =
  'Phrase ÉCRITE PAR LE CODE pour placer un lien interne du brief dont l\'ancre '
  + 'n\'apparaissait nulle part dans le texte. À RELIRE et reformuler avant publication. '
  + 'Cette marque ne part pas dans WordPress ; le lien, lui, reste.';
/** Amorce de la clause rédigée — formule éditoriale neutre, jamais tirée au hasard. */
export const WRITTEN_CLAUSE_LEAD = ' À lire aussi : ';

// ── Emplacements INTERDITS ────────────────────────────────────────────────────
// `a`            un lien dans un lien n'existe pas ;
// `del`          texte en instance de suppression : le lien disparaîtrait avec ;
// `ins`, `mark`  diff non encore accepté : idem, et `ins.added-content` est
//                purement et simplement supprimé à l'export ;
// `[data-il-idx]` surlignage d'un lien interne SUGGÉRÉ non validé, débalisé à
//                l'export → un lien posé dedans serait perdu ;
// titres, `summary`, `table`* et `details` : interdits par la règle métier
//                affichée au rédacteur (QatBriefFields) ;
// `figure`, `figcaption`, `code`, `pre`, `blockquote` : une légende, un extrait
//                de code ou une CITATION ne sont pas du texte rédactionnel — y
//                glisser un lien (ou une clause) le mettrait dans la bouche de
//                la source citée ;
// `[data-media-*]` overlays et wrappers de l'éditeur, jamais publiés tels quels.
export const EXCLUDE_SEL = [
  'a', 'del', 'ins', 'mark', '[data-il-idx]', `[${WRITTEN_MARK_ATTR}]`,
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'summary', 'details',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption',
  'figure', 'figcaption', 'code', 'pre', 'blockquote',
  '[data-media-type]', '[data-media-overlay]',
].join(',');

// Titres des sections à emplacement imposé — MIROIR de diff.js:643-644
// (`FAQ_TITLE_RX` / `TLDR_TITLE_RX`, privées à ce module) + le sommaire, qui
// n'est qu'une liste d'ancres locales et n'accueille aucun lien de maillage.
const ZONE_TITLE_RX = /faq|questions?\s+fr[ée]quentes|foire aux questions|r[ée]sum[ée] de l'article|tl\s*;?\s*dr|sommaire|table des mati[èe]res/i;

/**
 * Éléments appartenant à une section INTERDITE (FAQ, TL;DR, sommaire).
 *
 * Ces sections ne sont pas des balises : ce sont des TITRES suivis de leur
 * contenu. On parcourt donc les enfants de premier niveau et on marque tout ce
 * qui suit un titre interdit, jusqu'au prochain titre de niveau supérieur ou
 * égal. Limite connue et assumée : un article dont le corps serait enveloppé
 * dans un conteneur intermédiaire masquerait ces zones — les exclusions par
 * BALISE (`details`, `table`…) restent alors la seule protection.
 */
const forbiddenZones = (root) => {
  const zones = new Set();
  let openLvl = 0;
  for (const el of Array.from(root.children)) {
    const lvl = /^H[1-6]$/.test(el.tagName) ? Number(el.tagName[1]) : 0;
    if (lvl) {
      if (openLvl && lvl <= openLvl) openLvl = 0;              // la zone se referme
      if (ZONE_TITLE_RX.test(el.textContent || '')) { openLvl = lvl; zones.add(el); continue; }
    }
    if (openLvl) zones.add(el);
  }
  return zones;
};

/** L'élément est-il dans un emplacement interdit (balise ou zone) ? */
const isBlocked = (el, zones) => {
  if (!el) return true;
  if (el.closest(EXCLUDE_SEL)) return true;
  for (let n = el; n; n = n.parentElement) if (zones.has(n)) return true;
  return false;
};

// ── Identité d'une URL ────────────────────────────────────────────────────────
const RELATIVE_BASE = 'https://article.local/';

/**
 * Clé d'identité d'une URL : `/prix`, `/prix/` et `https://monsite.fr/prix`
 * désignent LE MÊME lien. SŒUR de `internalHrefKey` (privée à diff.js), pas une
 * modification de celle-ci : les fonctions du verrou de la règle 8 sont
 * partagées par tous les flux et ne doivent pas bouger.
 */
const urlKey = (href = '', articleUrl = '') => {
  try {
    const u = new URL(String(href), articleUrl || RELATIVE_BASE);
    return `${u.hostname.replace(/^www\./i, '').toLowerCase()}${u.pathname.replace(/\/+$/, '')}${u.search}`;
  } catch {
    return String(href).trim().toLowerCase().replace(/\/+$/, '');
  }
};

/**
 * Un lien vers cette URL existe-t-il déjà dans `scope` ?
 * Les liens en instance de SUPPRESSION (`<del>`) ne comptent pas : ils sont sur
 * le départ, s'y fier laisserait le lien du brief absent de l'article publié.
 */
const hasLinkTo = (scope, url, articleUrl = '') => {
  const key = urlKey(url, articleUrl);
  return Array.from(scope.querySelectorAll('a[href]')).some(
    (a) => !a.closest('del') && urlKey(a.getAttribute('href'), articleUrl) === key,
  );
};

/** Le lien vers cette URL a-t-il été RÉDIGÉ par le code (marque présente) ? */
const hasWrittenLinkTo = (scope, url, articleUrl = '') => {
  const key = urlKey(url, articleUrl);
  return Array.from(scope.querySelectorAll(`[${WRITTEN_MARK_ATTR}] a[href]`)).some(
    (a) => urlKey(a.getAttribute('href'), articleUrl) === key,
  );
};

// ── 1. TISSAGE : envelopper une ancre déjà présente ───────────────────────────

/**
 * Enveloppe la PREMIÈRE occurrence exploitable de l'ancre dans un vrai <a>.
 * Portage de ArticleResult.jsx:2938-2963 (TreeWalker, une injection par lien,
 * `break`). Aucun rel : un lien du maillage est DOFOLLOW par construction (R3).
 * @returns {boolean} true si le lien a été posé.
 */
const weaveOne = (root, link, zones) => {
  const rx = new RegExp(escRx(link.anchor), 'i');
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  let node;
  while ((node = walker.nextNode())) {
    if (isBlocked(node.parentElement, zones)) continue;
    const m = node.textContent.match(rx);
    if (!m) continue;
    const target = node.splitText(node.textContent.search(rx));
    target.splitText(m[0].length);
    const a = document.createElement('a');
    a.setAttribute('href', link.url);
    target.parentNode.insertBefore(a, target);
    a.appendChild(target);
    return true;                                   // une seule injection par lien
  }
  return false;
};

// ── 2. FORÇAGE : rédiger une clause qui porte l'ancre ─────────────────────────

// Mots vides : sans ce filtre, « le » et « de » suffiraient à faire gagner
// n'importe quel paragraphe et le choix ne serait plus pertinent.
// Marques diacritiques (U+0300..U+036F) — construite par chaîne échappée : un
// intervalle de caractères combinants écrit en clair est illisible et fragile.
const DIACRITICS_RX = new RegExp('[\u0300-\u036f]', 'g');

const STOP_WORDS = new Set([
  'les', 'des', 'une', 'aux', 'pour', 'par', 'sur', 'dans', 'avec', 'sans', 'plus', 'moins',
  'cette', 'ces', 'son', 'sa', 'ses', 'leur', 'leurs', 'nos', 'notre', 'vos', 'votre',
  'que', 'qui', 'quoi', 'dont', 'est', 'sont', 'ont', 'tout', 'tous', 'toute', 'toutes',
  'comment', 'quel', 'quelle', 'quels', 'quelles', 'pourquoi', 'aussi', 'donc', 'mais',
  'lire', 'voir', 'faire', 'peut', 'peuvent', 'doit', 'doivent',
]);

const tokens = (s) => String(s || '')
  .normalize('NFD').replace(DIACRITICS_RX, '')   // « energetique » = « énergétique »
  .toLowerCase()
  .split(/[^a-z0-9]+/)
  .filter((w) => w.length >= 3 && !STOP_WORDS.has(w));

// Un paragraphe trop court (« Sommaire : », une légende orpheline) n'est pas un
// support rédactionnel : y accrocher une clause serait visible et laid.
const MIN_PARAGRAPH_CHARS = 40;

/**
 * Paragraphe d'accueil de la clause : celui dont le texte RECOUVRE le plus de
 * mots de l'ancre. À égalité, le premier — le choix doit être reproductible.
 * À défaut de tout recouvrement, le DERNIER paragraphe autorisé du corps.
 * @returns {HTMLElement|null}
 */
const pickParagraph = (root, link, zones, articleUrl) => {
  const wanted = new Set(tokens(link.anchor));
  const candidates = Array.from(root.querySelectorAll('p')).filter((p) => {
    if (isBlocked(p, zones)) return false;
    if ((p.textContent || '').trim().length < MIN_PARAGRAPH_CHARS) return false;
    return !hasLinkTo(p, link.url, articleUrl);   // jamais deux fois la même URL dans un bloc
  });
  if (!candidates.length) return null;
  let best = null;
  let bestScore = 0;
  candidates.forEach((p) => {
    const have = new Set(tokens(p.textContent));
    let score = 0;
    wanted.forEach((w) => { if (have.has(w)) score++; });
    if (score > bestScore) { bestScore = score; best = p; }
  });
  return best || candidates[candidates.length - 1];
};

/** Écrit la clause marquée en FIN du paragraphe. Aucune phrase existante touchée. */
const writeClause = (p, link) => {
  const span = document.createElement('span');
  span.setAttribute('class', WRITTEN_MARK_CLASS);
  span.setAttribute(WRITTEN_MARK_ATTR, '1');
  span.setAttribute('title', WRITTEN_MARK_TITLE);
  span.appendChild(document.createTextNode(WRITTEN_CLAUSE_LEAD));
  const a = document.createElement('a');
  a.setAttribute('href', link.url);               // aucun rel → DOFOLLOW (R3)
  a.textContent = link.anchor;
  span.appendChild(a);
  span.appendChild(document.createTextNode('.'));
  p.appendChild(span);
};

// ── API ───────────────────────────────────────────────────────────────────────

/**
 * Paires de maillage réellement PLAÇABLES : complètes, dédoublonnées, et du même
 * domaine que l'article (règle 8). Ici le filtre s'applique TOUJOURS, même sans
 * `articleUrl` — contrairement à `cleanLinkRows`, qui ne fait qu'alimenter un
 * prompt : ce module POSE les liens, une URL absolue non vérifiable ne doit
 * jamais être écrite dans l'article.
 */
export const placeableBriefLinks = (links = [], articleUrl = '') =>
  filterSameSiteLinks(cleanLinkRows(links), articleUrl);

/** Paires écartées par le filtre de domaine — à DIRE au rédacteur, jamais à taire. */
export const offDomainBriefLinks = (links = [], articleUrl = '') => {
  const all = cleanLinkRows(links);
  const kept = new Set(placeableBriefLinks(links, articleUrl).map((l) => l.url));
  return all.filter((l) => !kept.has(l.url));
};

/**
 * CONSTAT — quelles paires du brief sont RÉELLEMENT dans le HTML produit.
 * Purement observationnel : ne fait aucune confiance ni au modèle (dont
 * `ancres_placees` est une auto-déclaration jamais vérifiée), ni au rapport du
 * tissage. C'est ce constat qui est affiché au rédacteur.
 * @returns {Array<{anchor:string,url:string,placed:boolean,written:boolean}>}
 */
export const countPlacedBriefLinks = (html = '', links = [], articleUrl = '') => {
  const kept = placeableBriefLinks(links, articleUrl);
  if (!kept.length || typeof document === 'undefined') return [];
  const root = document.createElement('div');
  root.innerHTML = html || '';
  return kept.map((l) => ({
    anchor: l.anchor,
    url: l.url,
    placed: hasLinkTo(root, l.url, articleUrl),
    written: hasWrittenLinkTo(root, l.url, articleUrl),
  }));
};

/**
 * TISSE tous les liens du brief dans `html`, et FORCE ceux dont l'ancre est
 * introuvable (`force: true`, le défaut — décision d'Andrianina).
 *
 * @returns {{
 *   html: string, total: number,
 *   placed: Array<{anchor,url,source:'existant'|'tisse'|'redige'}>,
 *   written: Array<{anchor,url}>, missing: Array<{anchor,url,reason:string}>,
 *   offDomain: Array<{anchor,url}>
 * }}
 */
export const weaveBriefLinks = (html = '', links = [], articleUrl = '', { force = true } = {}) => {
  const kept = placeableBriefLinks(links, articleUrl);
  const offDomain = offDomainBriefLinks(links, articleUrl);
  const empty = { html, total: kept.length, placed: [], written: [], missing: [], offDomain };
  if (!kept.length || !html || typeof document === 'undefined') return empty;

  const root = document.createElement('div');
  root.innerHTML = html;
  const zones = forbiddenZones(root);
  const placed = [];
  const written = [];
  const missing = [];

  kept.forEach((link) => {
    const entry = { anchor: link.anchor, url: link.url };
    // Déjà là : posé par l'IA, ou repris par R1. On n'en met pas un second.
    if (hasLinkTo(root, link.url, articleUrl)) { placed.push({ ...entry, source: 'existant' }); return; }
    if (weaveOne(root, link, zones)) { placed.push({ ...entry, source: 'tisse' }); return; }
    if (!force) { missing.push({ ...entry, reason: 'ancre-absente' }); return; }
    const p = pickParagraph(root, link, zones, articleUrl);
    // Aucun paragraphe éligible (article réduit à un tableau, à une FAQ…) : on ne
    // fabrique pas un bloc de toutes pièces, on le SIGNALE.
    if (!p) { missing.push({ ...entry, reason: 'aucun-emplacement' }); return; }
    writeClause(p, link);
    placed.push({ ...entry, source: 'redige' });
    written.push(entry);
  });

  if (written.length) {
    console.warn(`[R2 maillage] ${written.length} clause(s) RÉDIGÉE(S) PAR LE CODE pour placer un lien du brief — à relire :`, written.map((l) => l.url));
  }
  if (missing.length) {
    console.warn(`[R2 maillage] ${missing.length} lien(s) du brief NON placé(s) :`, missing);
  }
  if (offDomain.length) {
    console.warn(`[R2 maillage] ${offDomain.length} lien(s) du brief écarté(s) — URL hors du domaine de l'article (règle 8) :`, offDomain.map((l) => l.url));
  }
  return { html: root.innerHTML, total: kept.length, placed, written, missing, offDomain };
};

/** Phrase de compte rendu au rédacteur : « 7 lien(s) … dont 2 rédigé(s) … ». */
export const briefLinkReportLine = ({ total = 0, placed = [], written = [], offDomain = [] } = {}) => {
  if (!total && !offDomain.length) return '';
  const parts = [`Maillage interne : ${placed.length}/${total} lien(s) du brief placé(s)`];
  if (written.length) parts.push(`dont ${written.length} rédigé(s) par le code, à relire`);
  const miss = total - placed.length;
  if (miss > 0) parts.push(`${miss} non plaçable(s)`);
  if (offDomain.length) parts.push(`${offDomain.length} écarté(s) car hors domaine (règle 8)`);
  return parts.join(' — ');
};
