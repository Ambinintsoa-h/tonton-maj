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

/** Compare deux textes en ignorant les différences d'espaces et d'apostrophes. */
const norm = (s) => String(s || '')
  .replace(/[’‘]/g, "'")
  .replace(/\s+/g, ' ')
  .trim();

/** Longueur d'amorce utilisée quand le passage entier n'est pas dans un seul nœud. */
const AMORCE = 45;

export const MARK_CLASS = 'sugg-repere';

/**
 * @param {string} html         article issu de la phase 2
 * @param {Array}  suggestions  [{ original, updated, ... }]
 * @returns {{ html:string, marked:number[], missed:number[] }}
 *          `marked` / `missed` contiennent les NUMÉROS affichés (1-based).
 */
export const markSuggestions = (html, suggestions = []) => {
  const src = typeof html === 'string' ? html : '';
  const liste = Array.isArray(suggestions) ? suggestions : [];
  if (!src || !liste.length || typeof document === 'undefined') {
    return { html: src, marked: [], missed: [] };
  }

  const box = document.createElement('div');
  box.innerHTML = src;
  const marked = [];
  const missed = [];

  liste.forEach((s, i) => {
    const num = i + 1;
    const cible = norm(s && s.original);
    if (!cible) { missed.push(num); return; }

    // 1) Le passage tient dans UN nœud texte : on encadre exactement la portion.
    const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
    let trouve = false;
    let n;
    while ((n = walker.nextNode())) {
      if (n.parentElement && n.parentElement.closest(`.${MARK_CLASS}`)) continue; // déjà repéré
      const texte = norm(n.nodeValue);
      const idx = texte.indexOf(cible.length > AMORCE ? cible.slice(0, AMORCE) : cible);
      if (idx === -1) continue;
      // On retrouve la position dans le nœud NON normalisé, en tolérant les
      // espaces multiples : on repart du premier mot de la cible.
      const premierMot = cible.split(' ')[0];
      const brut = n.nodeValue;
      const pos = brut.indexOf(premierMot);
      if (pos === -1) continue;
      const fin = Math.min(brut.length, pos + (cible.length > AMORCE ? AMORCE : cible.length));
      const range = document.createRange();
      range.setStart(n, pos);
      range.setEnd(n, fin);
      const marque = document.createElement('mark');
      marque.className = MARK_CLASS;
      marque.setAttribute('data-sugg', String(num));
      marque.setAttribute('id', `sugg-${num}`);
      try { range.surroundContents(marque); trouve = true; } catch { /* bornes invalides */ }
      break;
    }

    // 2) Repli : le passage chevauche plusieurs balises → on repère le BLOC qui
    //    le contient, sans tenter de découper le balisage.
    if (!trouve) {
      const blocs = [...box.querySelectorAll('p, li, h2, h3, h4, td, blockquote')];
      // Un bloc qui CONTIENT déjà un repère est écarté : sans ce test, deux
      // suggestions portant sur le même passage aboutissaient à marquer d'abord
      // la portion exacte, puis tout le paragraphe par-dessus.
      const bloc = blocs.find((b) => !b.closest(`.${MARK_CLASS}`)
        && !b.querySelector(`.${MARK_CLASS}`)
        && norm(b.textContent).includes(cible.slice(0, AMORCE)));
      if (bloc) {
        bloc.classList.add(MARK_CLASS);
        bloc.setAttribute('data-sugg', String(num));
        bloc.setAttribute('id', `sugg-${num}`);
        trouve = true;
      }
    }

    (trouve ? marked : missed).push(num);
  });

  return { html: marked.length ? box.innerHTML : src, marked, missed };
};
