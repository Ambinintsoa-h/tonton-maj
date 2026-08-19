/**
 * boldApply.js — moitié DÉTERMINISTE de la passe de gras.
 *
 * Le modèle NOMME (voir `boldPrompt.js`), ce module APPLIQUE. Aucune décision
 * n'est prise ici : on enveloppe des passages déjà validés mot pour mot, et on
 * refuse tout ce qui ne s'enveloppe pas proprement.
 *
 * Découpage et interdits partagés avec `constatGras` et `carryOverBold` : les
 * trois doivent compter et exclure la MÊME chose, sinon la mesure contredirait la
 * pose — l'erreur que R1 et R2 avaient commise avant `linkZones.js`.
 */
import { NO_BOLD_SEL, GRAS_MIN_PAR_H2 } from './boldCarry';

const norm = (s = '') => String(s).replace(/\s+/g, ' ').trim();

/**
 * Sections de SERVICE, exclues de la passe.
 *
 * La FAQ et le TL;DR portent des réponses courtes, calibrées pour un extrait
 * enrichi. R8 y avait posé « ordre de sortie » en gras dans une réponse — hors
 * sujet. Le skill interdit déjà les LIENS dans ces blocs, même raison de fond.
 */
export const EST_SECTION_DE_SERVICE =
  /^\s*(?:FAQ|questions?\s+fr[eé]quentes?|TL\s*;?\s*DR|en\s+bref|r[eé]sum[eé])/i;

/**
 * Découpe l'article en sections H2 exploitables par la passe.
 *
 * Le texte est fourni SANS balises : le modèle doit renvoyer du texte nu, donc il
 * doit en recevoir. Lui donner du HTML l'inciterait à en produire — c'est ce qui
 * arrive en phase 4 quand on n'y fait pas attention.
 *
 * @returns {Array<{titre:string, texte:string}>} dans l'ordre du document
 */
export const splitSectionsForBold = (html = '') => {
  if (!html || typeof document === 'undefined') return [];
  const d = document.createElement('div');
  d.innerHTML = html;

  const sections = [];
  let courante = null;
  Array.from(d.children).forEach((el) => {
    if (el.tagName === 'H2') {
      courante = { titre: norm(el.textContent), morceaux: [] };
      sections.push(courante);
      return;
    }
    if (!courante) return;                       // chapô, TL;DR avant le 1er H2
    // Les blocs de service et les zones interdites ne sont pas soumis au modèle :
    // il ne peut pas proposer ce qu'il n'a pas vu, c'est le garde-fou le plus sûr.
    if (el.matches && el.matches('table, details, figure, blockquote')) return;
    const t = norm(el.textContent);
    if (t) courante.morceaux.push(t);
  });

  return sections
    .filter((s) => !EST_SECTION_DE_SERVICE.test(s.titre))
    .map((s) => ({ titre: s.titre, texte: s.morceaux.join('\n') }))
    .filter((s) => s.texte.length > 40);
};

/**
 * ENVELOPPE les passages retenus dans le HTML.
 *
 * @param {string} html
 * @param {Array<{titre:string, texte:string}>} sections  celles soumises au modèle
 * @param {Array<{section:number, passage:string}>} retenus
 * @returns {{ html:string, posed:Array<{passage:string, titre:string}>,
 *             echecs:Array<{passage:string, motif:string}>, sansGras:string[] }}
 */
export const applyBoldPassages = (html = '', sections = [], retenus = []) => {
  const rien = { html, posed: [], echecs: [], sansGras: [] };
  if (!html || typeof document === 'undefined' || !retenus.length) return rien;

  const root = document.createElement('div');
  root.innerHTML = html;

  // Correspondance titre de section → blocs du DOM. On repasse par le titre et non
  // par l'index brut : le modèle rend parfois un numéro décalé, et poser un gras
  // dans la mauvaise section serait invisible à la relecture.
  const parTitre = new Map();
  let courante = null;
  Array.from(root.children).forEach((el) => {
    if (el.tagName === 'H2') {
      courante = { titre: norm(el.textContent), blocs: [] };
      parTitre.set(courante.titre, courante);
      return;
    }
    if (courante) courante.blocs.push(el);
  });

  const posed = [];
  const echecs = [];

  retenus.forEach(({ section, passage }) => {
    const sec = sections[section - 1];
    const cible = sec && parTitre.get(sec.titre);
    if (!cible) { echecs.push({ passage, motif: 'section-absente' }); return; }

    let fait = false;
    for (const bloc of cible.blocs) {
      const walker = document.createTreeWalker(bloc, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        const parent = node.parentElement;
        if (!parent || typeof parent.closest !== 'function') continue;
        if (parent.closest(NO_BOLD_SEL) || parent.closest('strong, b')) continue;
        const idx = (node.textContent || '').indexOf(passage);
        if (idx === -1) continue;
        try {
          const range = document.createRange();
          range.setStart(node, idx);
          range.setEnd(node, idx + passage.length);
          const strong = document.createElement('strong');
          range.surroundContents(strong);
          fait = true;
        } catch { /* plage à cheval sur une balise : on renonce, on ne bricole pas */ }
        break;
      }
      if (fait) break;
    }
    if (fait) posed.push({ passage, titre: cible.titre });
    // Le passage existait dans le TEXTE de la section (déjà vérifié) mais pas dans
    // un nœud unique : il traverse une balise inline. On le signale plutôt que de
    // découper le balisage.
    else echecs.push({ passage, motif: 'traverse-une-balise' });
  });

  // Sections encore vides APRÈS la passe : le rédacteur doit le savoir, c'est la
  // part que ni le modèle ni le code n'ont su traiter.
  const sansGras = [];
  parTitre.forEach((sec, titre) => {
    if (EST_SECTION_DE_SERVICE.test(titre)) return;
    const n = sec.blocs.reduce((acc, b) => acc + Array.from(b.querySelectorAll('strong, b'))
      .filter((e) => !e.closest('h1, h2, h3, h4, h5, h6') && !e.closest('a')).length, 0);
    if (n < GRAS_MIN_PAR_H2) sansGras.push(titre);
  });

  if (!posed.length) return { html, posed, echecs, sansGras };
  return { html: root.innerHTML, posed, echecs, sansGras };
};
