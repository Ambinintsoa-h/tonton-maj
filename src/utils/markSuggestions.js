/**
 * markSuggestions.js — repérage visuel des passages à remplacer (PHASE 3).
 *
 * L'écran double montrait l'article à gauche et les suggestions à droite, sans
 * aucun lien visuel entre les deux : le rédacteur devait chercher à l'œil le
 * passage concerné dans 2 900 mots. On surligne donc chaque passage en rouge et
 * on lui accole le MÊME numéro que dans la liste de droite.
 *
 * Le repérage est fait sur une COPIE du HTML destinée à l'affichage : l'article
 * lui-même n'est pas modifié. Ce qui n'est pas retrouvé est signalé (`missed`)
 * plutôt que silencieusement ignoré — le rédacteur doit savoir qu'une suggestion
 * n'a pas d'ancre visible.
 */

import {
  findPassageInText, findBlockForPassage, rangeForPassage, wrapRange,
} from './locatePassage';

/** Compare deux textes en ignorant les différences d'espaces et d'apostrophes. */
const norm = (s) => String(s || '')
  .replace(/[’‘]/g, "'")
  .replace(/\s+/g, ' ')
  .trim();

/** Longueur d'amorce utilisée quand le passage entier n'est pas dans un seul nœud. */
const AMORCE = 45;

export const MARK_CLASS = 'sugg-repere';
/** Posée EN PLUS de MARK_CLASS sur une suggestion déjà appliquée → surlignage vert. */
export const MARK_CLASS_OK = 'sugg-applique';

/** Texte nu d'un fragment : une suggestion peut contenir du balisage
 *  (`<p>`, `<strong>`), alors qu'on cherche dans des NŒUDS TEXTE — comparer avec
 *  les balises ne trouverait jamais rien. */
const texteNu = (frag) => {
  const d = document.createElement('div');
  d.innerHTML = String(frag || '');
  return d.textContent || '';
};

/**
 * @param {string} html         article issu de la phase 2
 * @param {Array}  suggestions  [{ original, updated, ... }]
 * @param {number[]} appliquees index (0-based, comme dans la liste) des suggestions
 *          DÉJÀ ACCEPTÉES : leur passage d'origine n'existe plus dans le texte, on y
 *          cherche donc le texte NOUVEAU et on le montre en vert. Paramètre optionnel
 *          — sans lui, comportement strictement inchangé.
 * @returns {{ html:string, marked:number[], missed:number[], ajouts:number[] }}
 *          Numéros AFFICHÉS (1-based). Trois cas distincts, à ne pas confondre :
 *          `marked` repéré ; `ajouts` sans passage d'origine (ajout pur, il n'y a
 *          rien à repérer, c'est normal) ; `missed` un passage est cité mais
 *          introuvable dans le texte — là il y a un problème à comprendre.
 */
export const markSuggestions = (html, suggestions = [], appliquees = []) => {
  const src = typeof html === 'string' ? html : '';
  const liste = Array.isArray(suggestions) ? suggestions : [];
  const faites = Array.isArray(appliquees) ? appliquees : [];
  if (!src || !liste.length || typeof document === 'undefined') {
    return { html: src, marked: [], missed: [], ajouts: [] };
  }

  const box = document.createElement('div');
  box.innerHTML = src;
  const marked = [];
  const missed = [];
  const ajouts = [];

  /**
   * Repère UNE cible dans le document de travail. Extrait tel quel de la boucle
   * pour pouvoir être rejoué sur une seconde cible (cas des suggestions
   * appliquées, ci-dessous) ; rien n'est écrit tant que rien n'est trouvé, donc
   * un essai infructueux se rattrape sans dégât.
   * @returns {boolean} vrai si un repère a été posé.
   */
  const reperer = (cible, num, vert) => {
    const classes = vert ? [MARK_CLASS, MARK_CLASS_OK] : [MARK_CLASS];

    // 1) Le passage tient dans UN nœud texte : on encadre exactement la portion.
    // Les bornes viennent de `findPassageInText`, qui apparie sur une signature
    // sans espaces et rend les index dans le texte RÉEL. La version précédente
    // appariait sur le texte NORMALISÉ puis recherchait la position du premier mot
    // dans le texte BRUT (`brut.indexOf(premierMot)`) : quand c'était justement la
    // normalisation qui avait rendu l'appariement possible — apostrophe courbe,
    // espace insécable — la position était introuvable et l'appariement JETÉ.
    const amorce = cible.length > AMORCE ? cible.slice(0, AMORCE) : cible;
    const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
    let trouve = false;
    let n;
    while ((n = walker.nextNode())) {
      if (n.parentElement && n.parentElement.closest(`.${MARK_CLASS}`)) continue; // déjà repéré
      const bornes = findPassageInText(n.nodeValue, amorce);
      if (!bornes) continue;
      const range = document.createRange();
      range.setStart(n, bornes.start);
      range.setEnd(n, bornes.end);
      const marque = document.createElement('mark');
      // MARK_CLASS est TOUJOURS posée, même en vert : c'est elle qui porte la
      // pastille numérotée et qui sert de garde anti-imbrication ci-dessus.
      marque.className = classes.join(' ');
      marque.setAttribute('data-sugg', String(num));
      marque.setAttribute('id', `sugg-${num}`);
      try { range.surroundContents(marque); trouve = true; } catch { /* bornes invalides */ }
      break;
    }

    // 2) Le passage TRAVERSE des balises inline : on marque quand même la PORTION
    //    EXACTE, sur une plage qui enjambe plusieurs nœuds texte.
    //
    //    C'est ce qui règle le cas des DEUX SUGGESTIONS DANS LE MÊME PARAGRAPHE.
    //    Avant, le repli marquait tout le bloc et refusait donc un bloc portant
    //    déjà un repère : la seconde suggestion était déclarée « introuvable »
    //    alors que son texte était bien là. En marquant la portion, les deux
    //    cohabitent — et `ignorer` saute les nœuds déjà marqués, sans quoi les
    //    plages se chevaucheraient.
    let bloc = null;
    if (!trouve) {
      bloc = findBlockForPassage(box, cible.slice(0, AMORCE));
      const range = bloc && rangeForPassage(bloc, cible.slice(0, AMORCE), `.${MARK_CLASS}`);
      if (range) {
        const marque = document.createElement('mark');
        marque.className = classes.join(' ');
        marque.setAttribute('data-sugg', String(num));
        marque.setAttribute('id', `sugg-${num}`);
        if (wrapRange(range, marque)) trouve = true;
      }
    }

    // 3) Dernier recours : marquer le BLOC entier. Ne sert plus que lorsque la
    //    portion est impossible à isoler (plage refusée par le DOM). Un bloc qui
    //    porte déjà un repère reste écarté : empiler une marque de paragraphe
    //    par-dessus une marque de portion rendrait les deux illisibles.
    if (!trouve && bloc
        && !bloc.closest(`.${MARK_CLASS}`) && !bloc.querySelector(`.${MARK_CLASS}`)) {
      bloc.classList.add(...classes);
      bloc.setAttribute('data-sugg', String(num));
      bloc.setAttribute('id', `sugg-${num}`);
      trouve = true;
    }
    return trouve;
  };

  liste.forEach((s, i) => {
    const num = i + 1;
    const applique = faites.includes(i);
    // Une suggestion acceptée a déjà remplacé son passage d'origine : chercher
    // `original` ne donnerait plus rien et la classerait « introuvable » — la
    // fausse alerte exactement à l'envers de la réalité. On vise donc le texte
    // NOUVEAU en priorité, avec l'ancien en repli : le volet de gauche est un
    // instantané qui n'a pas toujours pu être réécrit (le rédacteur a pu retoucher
    // le passage entre-temps). Dans les deux cas c'est VERT et jamais une anomalie.
    const cibles = (applique
      ? [norm(texteNu(s && s.updated)), norm(s && s.original)]
      : [norm(s && s.original)]).filter(Boolean);
    // Aucun passage d'origine = ajout pur : il n'y a rien à repérer, ce n'est
    // pas un échec. Les mélanger dans `missed` faisait passer une situation
    // normale pour une anomalie.
    if (!cibles.length) { if (!applique) ajouts.push(num); return; }

    const trouve = cibles.some((cible) => reperer(cible, num, applique));

    // Une suggestion appliquée n'est jamais une anomalie : si son texte n'est pas
    // retrouvé (reformulé à la main, coupé par du balisage), on se tait plutôt que
    // d'alerter à tort sur un travail qui vient justement d'être fait.
    if (trouve) marked.push(num);
    else if (!applique) missed.push(num);
  });

  return { html: marked.length ? box.innerHTML : src, marked, missed, ajouts };
};
