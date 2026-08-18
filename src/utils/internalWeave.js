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
//          relise. La règle de style est `.lien-redige` dans src/index.css (fond
//          jaune + soulignement pointillé) : SANS ELLE la classe ne fait rien et
//          la contrepartie du forçage n'est pas livrée — c'était le cas jusqu'à la
//          relecture. La MARQUE ne part pas en production (débalisée par
//          `exportAsHtml`, comme [data-il-idx]) ; le LIEN, lui, reste.
//          Au moment de PUBLIER, la marque disparaît dans la même foulée : il n'y
//          a plus d'étape de relecture après. C'est pourquoi `handlePublish`
//          (ArticleResult.jsx) DEMANDE CONFIRMATION quand le code a dû écrire.
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
import {
  NO_LINK_TAG_SEL, MISPLACED_LINK_SEL,
  forbiddenLinkZones, isInForbiddenLinkZone, hasBlockingDescendant,
} from './linkZones';

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
export const WRITTEN_CLAUSE_LEAD = 'À lire aussi : ';

/**
 * ENCART : la clause est son PROPRE BLOC, plus une queue de paragraphe.
 *
 * Corrigé le 18 août 2026 sur constat d'Andrianina — « ils sont un peu
 * orphelins ». La clause était collée en fin du paragraphe d'accueil
 * (`p.appendChild`), donc le lecteur tombait sur « …des combats plus nerveux. À
 * lire aussi : les actualités PlayStation 5. » d'un seul souffle : un renvoi
 * éditorial déguisé en fin de phrase, qui ne se voit ni ne se saute.
 *
 * Trois conséquences du choix du bloc :
 *   • le SAUT DE LIGNE est structurel, pas un `<br>` que WordPress peut ravaler ;
 *   • le libellé passe en `<strong>`, donc mis en avant SANS dépendre du thème —
 *     une classe CSS ne serait stylée que si le thème la connaît ;
 *   • `pickParagraph` doit compter autrement (la clause n'est plus un enfant du
 *     `<p>`) et s'interdire de choisir un encart comme paragraphe d'accueil.
 *     Sans ces deux ajustements, les 15 clauses reviendraient s'empiler — le
 *     défaut que le critère `clauses` avait justement été écrit pour fermer.
 *
 * La classe SURVIT à l'export, contrairement à la marque jaune : elle ne dit rien
 * au rédacteur, elle donne au thème une prise pour styler le renvoi s'il le veut.
 */
export const WRITTEN_BLOCK_CLASS = 'lien-connexe';

// ── Emplacements INTERDITS ────────────────────────────────────────────────────
// La liste vit désormais dans src/utils/linkZones.js, PARTAGÉE avec R1
// (`carryOverInternalLinks`, src/utils/diff.js) : deux mécanismes qui posent des
// liens sans appel IA ne peuvent pas se donner chacun ses propres interdits — R1
// posait des liens dans les tableaux, la FAQ, les titres et les citations que R2
// s'interdisait. Réexporté ici pour ne pas casser un import existant.
export const EXCLUDE_SEL = NO_LINK_TAG_SEL;

/** L'élément est-il dans un emplacement interdit (balise ou zone) ? */
const isBlocked = (el, zones) => isInForbiddenLinkZone(el, zones, NO_LINK_TAG_SEL);

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
 * Les `<a>` de `scope` qui pointent vers cette URL.
 * Les liens en instance de SUPPRESSION (`<del>`) ne comptent pas : ils sont sur
 * le départ, s'y fier laisserait le lien du brief absent de l'article publié.
 */
const findLinksTo = (scope, url, articleUrl = '') => {
  const key = urlKey(url, articleUrl);
  return Array.from(scope.querySelectorAll('a[href]')).filter(
    (a) => !a.closest('del') && urlKey(a.getAttribute('href'), articleUrl) === key,
  );
};

/** Un lien vers cette URL existe-t-il déjà dans `scope` ? */
const hasLinkTo = (scope, url, articleUrl = '') => findLinksTo(scope, url, articleUrl).length > 0;

/**
 * Un lien portant EXACTEMENT ce texte d'ancre existe-t-il déjà dans `scope` ?
 * Sert à ne pas coller côte à côte, dans le même paragraphe, deux fois la même
 * ancre pointant vers deux cibles différentes — le lecteur ne peut pas deviner
 * laquelle mène où, et un moteur non plus.
 */
const hasAnchorTextLinked = (scope, anchorLc) => {
  if (!anchorLc) return false;
  return Array.from(scope.querySelectorAll('a')).some(
    (a) => (a.textContent || '').trim().toLowerCase() === anchorLc,
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
 * Paragraphe d'accueil de la clause. Tri DÉTERMINISTE, par priorités :
 *   1. le moins de clauses déjà rédigées par le code — sans ce critère, un
 *      article à un seul paragraphe éligible recevait jusqu'à 15 « À lire
 *      aussi : » collés bout à bout (INTERNAL_LINK_ROWS_MAX), publiés tels
 *      quels : constaté par exécution. `isBlocked` ne pouvait pas l'attraper,
 *      la marque étant un ENFANT du `<p>` et `closest` ne descendant pas ;
 *   2. le meilleur recouvrement de mots avec l'ancre (pertinence) ;
 *   3. l'ordre du document, pour que le résultat soit reproductible.
 *
 * Écartés : les emplacements interdits, les paragraphes trop courts, ceux qui
 * portent DÉJÀ un lien vers la même URL, ceux qui portent déjà la même ancre vers
 * une AUTRE cible, et ceux qui contiennent un diff en attente (le paragraphe peut
 * disparaître à l'export en ne laissant que la clause).
 * @returns {HTMLElement|null}
 */
const pickParagraph = (root, link, zones, articleUrl) => {
  const wanted = new Set(tokens(link.anchor));
  const anchorLc = String(link.anchor || '').trim().toLowerCase();
  const candidates = [];
  Array.from(root.querySelectorAll('p')).forEach((p, index) => {
    // Un encart de renvoi n'est PAS un support rédactionnel : y accrocher une
    // clause produirait « À lire aussi : X. À lire aussi : Y. » en cascade. Le
    // filtre par longueur ne suffit pas, une ancre longue dépassant les 40 car.
    if (isClauseBlock(p)) return;
    if (isBlocked(p, zones)) return;
    if (hasBlockingDescendant(p)) return;
    if ((p.textContent || '').trim().length < MIN_PARAGRAPH_CHARS) return;
    if (hasLinkTo(p, link.url, articleUrl)) return;   // jamais deux fois la même URL dans un bloc
    if (hasAnchorTextLinked(p, anchorLc)) return;     // même ancre, autre cible : illisible
    const have = new Set(tokens(p.textContent));
    let score = 0;
    wanted.forEach((w) => { if (have.has(w)) score++; });
    // Les clauses se comptent sur les FRÈRES SUIVANTS depuis que l'encart est un
    // bloc à part : `p.querySelectorAll` ne voyait plus rien, et le critère qui
    // répartit les renvois entre paragraphes valait 0 pour tout le monde — les 15
    // « À lire aussi » se seraient réempilés sous le même paragraphe.
    candidates.push({ p, index, score, clauses: clauseBlocksAfter(p).length });
  });
  if (!candidates.length) return null;
  candidates.sort((a, b) => (a.clauses - b.clauses) || (b.score - a.score) || (a.index - b.index));
  return candidates[0].p;
};

/** Vrai si l'élément est un encart de renvoi écrit par le code. */
const isClauseBlock = (el) =>
  !!el && el.nodeType === 1 && !!el.querySelector && !!el.querySelector(`[${WRITTEN_MARK_ATTR}]`)
  && el.classList.contains(WRITTEN_BLOCK_CLASS);

/** Encarts déjà posés APRÈS ce paragraphe — ils se suivent, jamais s'intercalent. */
const clauseBlocksAfter = (p) => {
  const out = [];
  let n = p.nextElementSibling;
  while (isClauseBlock(n)) { out.push(n); n = n.nextElementSibling; }
  return out;
};

/**
 * Écrit l'encart de renvoi APRÈS le paragraphe. Aucune phrase existante touchée.
 *
 * L'encart est inséré à la SUITE des encarts déjà présents, pas juste après le
 * paragraphe : sinon les renvois s'afficheraient dans l'ordre inverse de leur
 * ajout, et le résultat cesserait d'être reproductible (le déterminisme est la
 * contrepartie de « le code rédige », règle 9).
 */
const writeClause = (p, link) => {
  const bloc = document.createElement('p');
  bloc.setAttribute('class', WRITTEN_BLOCK_CLASS);

  // Le <span> marqué enveloppe TOUT le contenu de l'encart : à l'export il est
  // débalisé (export.js), et il ne doit rien emporter d'autre que lui-même.
  const span = document.createElement('span');
  span.setAttribute('class', WRITTEN_MARK_CLASS);
  span.setAttribute(WRITTEN_MARK_ATTR, '1');
  span.setAttribute('title', WRITTEN_MARK_TITLE);

  // Libellé en gras : mise en avant qui ne dépend d'AUCUNE feuille de style.
  const label = document.createElement('strong');
  label.textContent = WRITTEN_CLAUSE_LEAD;
  span.appendChild(label);

  const a = document.createElement('a');
  a.setAttribute('href', link.url);               // aucun rel → DOFOLLOW (R3)
  a.textContent = link.anchor;
  span.appendChild(a);
  span.appendChild(document.createTextNode('.'));

  bloc.appendChild(span);
  const deja = clauseBlocksAfter(p);
  const apres = deja.length ? deja[deja.length - 1] : p;
  if (apres.parentNode) apres.parentNode.insertBefore(bloc, apres.nextSibling);
  else p.appendChild(bloc);                       // paragraphe détaché : repli sûr
};

// ── API ───────────────────────────────────────────────────────────────────────

/** Une URL absolue, dans ses trois écritures (`https://h`, `//h`, `\\h`). */
const isAbsoluteUrl = (u = '') => /^https?:\/\//i.test(u) || /^[\\/]{2}[^\\/]/.test(u);

/**
 * CLASSEMENT des paires du brief en catégories EXCLUSIVES. Une seule fonction,
 * parce que le motif d'écart doit être DIT au rédacteur, et dit juste :
 *
 *   • `placeable`    — complète, même domaine que l'article : le code peut la poser ;
 *   • `selfLinks`    — l'URL EST celle de l'article : un article qui se lie à
 *                      lui-même n'a aucun sens, et rien ne l'écartait ;
 *   • `offDomain`    — URL d'un AUTRE domaine, ou inexploitable en maillage
 *                      (mailto:, javascript:) : la poser violerait la règle 8 ;
 *   • `unverifiable` — URL de l'article NON FOURNIE (contenu collé) et paire à URL
 *                      ABSOLUE : faute d'hôte de référence on ne peut ni la
 *                      valider ni l'accuser. La version précédente les rangeait
 *                      dans « hors domaine (règle 8) » et annonçait au rédacteur
 *                      que l'URL de SON PROPRE SITE était hors domaine.
 *
 * Rappel : sur ce flux sans URL d'article, une URL absolue est de toute façon
 * INPLAÇABLE — le verrou liens externes (`sanitizeFullArticle`, articleHost null)
 * considère alors TOUT lien absolu comme externe et désenveloppe celui que l'IA
 * aurait posé. Seuls les chemins relatifs (`/ma-page`) fonctionnent, et c'est ce
 * que le message doit dire.
 */
export const classifyBriefLinks = (links = [], articleUrl = '') => {
  const all = cleanLinkRows(links);
  const selfKey = articleUrl ? urlKey(articleUrl, articleUrl) : null;
  const placeable = []; const offDomain = []; const unverifiable = []; const selfLinks = [];
  all.forEach((l) => {
    if (selfKey && urlKey(l.url, articleUrl) === selfKey) { selfLinks.push(l); return; }
    if (filterSameSiteLinks([l], articleUrl).length) { placeable.push(l); return; }
    if (!articleUrl && isAbsoluteUrl(l.url)) { unverifiable.push(l); return; }
    offDomain.push(l);
  });
  return { all, placeable, offDomain, unverifiable, selfLinks };
};

/**
 * Paires de maillage réellement PLAÇABLES : complètes, dédoublonnées, du même
 * domaine que l'article (règle 8) et différentes de l'article lui-même. Ici le
 * filtre de domaine s'applique TOUJOURS, même sans `articleUrl` — contrairement à
 * `cleanLinkRows`, qui ne fait qu'alimenter un prompt : ce module POSE les liens,
 * une URL absolue non vérifiable ne doit jamais être écrite dans l'article.
 */
export const placeableBriefLinks = (links = [], articleUrl = '') =>
  classifyBriefLinks(links, articleUrl).placeable;

/** Paires écartées par le filtre de domaine — à DIRE au rédacteur, jamais à taire. */
export const offDomainBriefLinks = (links = [], articleUrl = '') =>
  classifyBriefLinks(links, articleUrl).offDomain;

/**
 * CONSTAT — quelles paires du brief sont RÉELLEMENT dans le HTML produit.
 * Purement observationnel : ne fait aucune confiance ni au modèle (dont
 * `ancres_placees` est une auto-déclaration jamais vérifiée), ni au rapport du
 * tissage. C'est ce constat qui est affiché au rédacteur.
 *
 * Porte sur TOUTES les paires saisies, pas seulement les plaçables : COMPTER un
 * lien que l'IA a posé n'écrit rien dans l'article, donc ne risque rien, alors
 * que ne rien compter faisait disparaître le décompte affiché au rédacteur sur le
 * flux « contenu collé » (régression d'affichage constatée en relecture). Le
 * champ `placeable` dit si le CODE aurait le droit de la poser, lui.
 *
 * `misplaced` : le lien est bien là, mais uniquement dans un emplacement que la
 * règle interdit (titre, tableau, FAQ, TL;DR, citation) — placé, non conforme.
 *
 * @returns {Array<{anchor:string,url:string,placed:boolean,placeable:boolean,written:boolean,misplaced:boolean}>}
 */
export const countPlacedBriefLinks = (html = '', links = [], articleUrl = '') => {
  const { all, placeable } = classifyBriefLinks(links, articleUrl);
  if (!all.length || typeof document === 'undefined') return [];
  const placeableUrls = new Set(placeable.map((l) => l.url));
  const root = document.createElement('div');
  root.innerHTML = html || '';
  const zones = forbiddenLinkZones(root);
  return all.map((l) => {
    const found = findLinksTo(root, l.url, articleUrl);
    return {
      anchor: l.anchor,
      url: l.url,
      placed: found.length > 0,
      placeable: placeableUrls.has(l.url),
      written: found.some((a) => !!a.closest(`[${WRITTEN_MARK_ATTR}]`)),
      misplaced: found.length > 0
        && found.every((a) => isInForbiddenLinkZone(a.parentElement, zones, MISPLACED_LINK_SEL)),
    };
  });
};

/**
 * DÉLIE les liens INTERNES que le modèle a posés dans un emplacement interdit
 * (FAQ, TL;DR, sommaire, titre, tableau, citation, légende).
 *
 * Pourquoi du code alors que la consigne est déjà écrite : « aucun lien dans la
 * FAQ » figure DÉJÀ trois fois dans le skill (deux fois dans
 * `maillage-interne-ancres.md`, une fois dans `tldr-et-faq.md`) et le code
 * empêchait ces emplacements pour SES propres liens (R1/R2, via linkZones.js).
 * Rien n'empêchait le modèle d'en poser quand même : `countPlacedBriefLinks` ne
 * faisait que le CONSTATER (`misplaced`), et seulement pour les paires du brief.
 * Une quatrième formulation de la même consigne ne fermerait pas le trou —
 * seul un verrou le ferme.
 *
 * ⚠️ RÈGLE 8, LIMITE ABSOLUE DE CETTE FONCTION : on ne touche QUE les liens
 * INTERNES. Délier un lien EXTERNE serait le SUPPRIMER de l'article — interdit
 * sans exception, et `enforceExternalLinkPolicy` a déjà validé le texte à ce
 * stade : la suppression passerait donc inaperçue. Sans `articleUrl`,
 * `filterSameSiteLinks` traite toute URL absolue comme externe (protection
 * maximale) : dans le doute, on ne délie pas.
 *
 * À appeler ENTRE R1 et R2, jamais après : le lien délié redevient « absent »
 * pour `weaveBriefLinks`, qui le replace alors dans le corps de l'article. La
 * violation se transforme en placement correct au lieu d'être perdue.
 *
 * Le TEXTE de l'ancre est toujours conservé : on retire la balise `<a>`, pas les
 * mots. Une FAQ ne perd donc jamais une phrase.
 *
 * @returns {{ html: string, unwrapped: Array<{anchor: string, url: string}> }}
 */
export const unwrapForbiddenInternalLinks = (html = '', articleUrl = '') => {
  if (!html || typeof document === 'undefined') return { html, unwrapped: [] };
  const root = document.createElement('div');
  root.innerHTML = html;
  const zones = forbiddenLinkZones(root);
  const unwrapped = [];

  Array.from(root.querySelectorAll('a[href]')).forEach((a) => {
    const url = a.getAttribute('href') || '';
    if (!url) return;
    // Interne uniquement (règle 8). `filterSameSiteLinks` porte déjà toute la
    // logique de domaine, URL protocol-relative comprise.
    if (!filterSameSiteLinks([{ anchor: 'x', url }], articleUrl).length) return;
    if (!isInForbiddenLinkZone(a.parentElement, zones, MISPLACED_LINK_SEL)) return;

    unwrapped.push({ anchor: (a.textContent || '').trim(), url });
    // Remplacer le <a> par ses enfants : le texte reste, la balise part.
    const parent = a.parentNode;
    if (!parent) return;
    while (a.firstChild) parent.insertBefore(a.firstChild, a);
    parent.removeChild(a);
  });

  return { html: unwrapped.length ? root.innerHTML : html, unwrapped };
};

/**
 * TISSE tous les liens du brief dans `html`, et FORCE ceux dont l'ancre est
 * introuvable (`force: true`, le défaut — décision d'Andrianina).
 *
 * @returns {{
 *   html: string, total: number,
 *   placed: Array<{anchor,url,source:'existant'|'tisse'|'redige'}>,
 *   written: Array<{anchor,url}>, missing: Array<{anchor,url,reason:string}>,
 *   offDomain: Array<{anchor,url}>, unverifiable: Array<{anchor,url}>,
 *   selfLinks: Array<{anchor,url}>
 * }}
 */
export const weaveBriefLinks = (html = '', links = [], articleUrl = '', { force = true } = {}) => {
  const { placeable: kept, offDomain, unverifiable, selfLinks } = classifyBriefLinks(links, articleUrl);
  const empty = {
    html, total: kept.length, placed: [], written: [], missing: [],
    offDomain, unverifiable, selfLinks,
  };
  if (!kept.length || !html || typeof document === 'undefined') return empty;

  const root = document.createElement('div');
  root.innerHTML = html;
  const zones = forbiddenLinkZones(root);
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
  if (unverifiable.length) {
    console.warn(`[R2 maillage] ${unverifiable.length} lien(s) du brief écarté(s) — URL de l'article NON FOURNIE, une URL absolue n'est pas vérifiable (utilisez un chemin relatif) :`, unverifiable.map((l) => l.url));
  }
  if (selfLinks.length) {
    console.warn(`[R2 maillage] ${selfLinks.length} lien(s) du brief écarté(s) — l'URL est celle de l'article lui-même :`, selfLinks.map((l) => l.url));
  }
  return {
    html: root.innerHTML, total: kept.length, placed, written, missing,
    offDomain, unverifiable, selfLinks,
  };
};

/**
 * Phrase de compte rendu au rédacteur. Chaque motif d'écart est NOMMÉ : annoncer
 * « 0/0 lien placé — 1 écarté car hors domaine (règle 8) » pour une URL du propre
 * site du rédacteur, faute d'URL d'article, l'envoyait chercher un problème qui
 * n'existait pas.
 */
export const briefLinkReportLine = ({
  total = 0, placed = [], written = [], offDomain = [], unverifiable = [], selfLinks = [],
} = {}) => {
  const parts = [];
  if (total) {
    parts.push(`Maillage interne : ${placed.length}/${total} lien(s) du brief placé(s)`);
    if (written.length) parts.push(`dont ${written.length} RÉDIGÉ(S) PAR LE CODE, à relire`);
    const miss = total - placed.length;
    if (miss > 0) parts.push(`${miss} sans emplacement autorisé`);
  }
  if (offDomain.length) parts.push(`${offDomain.length} écarté(s) : URL hors du domaine de l'article (règle 8)`);
  if (selfLinks.length) parts.push(`${selfLinks.length} écarté(s) : l'article ne peut pas se lier à lui-même`);
  if (unverifiable.length) {
    parts.push(`${unverifiable.length} écarté(s) : URL de l'article non fournie, une URL absolue n'est ni vérifiable ni plaçable (saisissez un chemin relatif, /ma-page)`);
  }
  return parts.join(' — ');
};
