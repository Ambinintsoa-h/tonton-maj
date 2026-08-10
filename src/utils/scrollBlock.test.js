// Défaut n°3 : les flèches « modification précédente / suivante » ne déplaçaient
// rien. jumpToChange appelait container.scrollTo() sur l'éditeur, or l'éditeur
// n'est PAS un conteneur défilant : il grandit à la hauteur de son contenu
// (13 235 px mesurés) et c'est le document qui défile. Constaté en production :
// 8 clics, window.scrollY figé à 1685.
/* eslint-env jest */
import { scrollBlockIntoView, flashBlock } from './scrollBlock';

// jsdom ne calcule aucune géométrie : on la simule explicitement.
const dimensionner = (el, { scrollHeight, clientHeight }) => {
  Object.defineProperty(el, 'scrollHeight', { value: scrollHeight, configurable: true });
  Object.defineProperty(el, 'clientHeight', { value: clientHeight, configurable: true });
};
const positionner = (el, top) => {
  el.getBoundingClientRect = () => ({ top, bottom: top + 20, left: 0, right: 100, width: 100, height: 20 });
};

describe('scrollBlockIntoView — le bon niveau de défilement', () => {
  let scrollBy;
  beforeEach(() => {
    document.body.innerHTML = '';
    scrollBy = jest.fn();
    window.scrollBy = scrollBy;
    window.innerHeight = 700;
  });

  test('le cas RÉEL de l\'éditeur : rien ne défile en interne → c\'est la fenêtre', () => {
    const ed = document.createElement('div');
    const bloc = document.createElement('p');
    ed.appendChild(bloc);
    document.body.appendChild(ed);
    // L'éditeur fait 13 235 px de haut ET affiche tout : aucun scroll interne.
    dimensionner(ed, { scrollHeight: 13235, clientHeight: 13235 });
    positionner(bloc, 4000);

    const r = scrollBlockIntoView(ed, bloc);
    expect(r.ok).toBe(true);
    expect(r.scrolledContainer).toBe(false);   // l'ancien code s'arrêtait ici → aucun effet
    expect(r.scrolledAncestor).toBe(false);
    expect(r.scrolledWindow).toBe(true);
    expect(scrollBy).toHaveBeenCalledTimes(1);
    // On amène le bloc au tiers haut de l'écran : 4000 - 700/3
    expect(scrollBy.mock.calls[0][1]).toBeCloseTo(4000 - 700 / 3, 5);
  });

  test('un ancêtre défilant (le <main> du layout) est corrigé, pas la fenêtre', () => {
    const main = document.createElement('main');
    const ed = document.createElement('div');
    const bloc = document.createElement('p');
    ed.appendChild(bloc); main.appendChild(ed); document.body.appendChild(main);
    dimensionner(ed, { scrollHeight: 13235, clientHeight: 13235 });
    dimensionner(main, { scrollHeight: 13900, clientHeight: 700 });
    main.style.overflowY = 'auto';
    main.scrollTop = 0;
    positionner(bloc, 4000);

    const r = scrollBlockIntoView(ed, bloc);
    expect(r.scrolledAncestor).toBe(true);
    expect(r.scrolledWindow).toBe(false);
    expect(scrollBy).not.toHaveBeenCalled();
    expect(main.scrollTop).toBeGreaterThan(0);
  });

  test('un ancêtre haut mais NON défilant (overflow visible) est ignoré', () => {
    const wrap = document.createElement('div');
    const ed = document.createElement('div');
    const bloc = document.createElement('p');
    ed.appendChild(bloc); wrap.appendChild(ed); document.body.appendChild(wrap);
    dimensionner(ed, { scrollHeight: 100, clientHeight: 100 });
    dimensionner(wrap, { scrollHeight: 13900, clientHeight: 700 }); // dépasse, mais overflow visible
    positionner(bloc, 900);

    const r = scrollBlockIntoView(ed, bloc);
    expect(r.scrolledAncestor).toBe(false);
    expect(r.scrolledWindow).toBe(true);
  });

  test('un éditeur réellement défilant est corrigé en interne', () => {
    const ed = document.createElement('div');
    const bloc = document.createElement('p');
    ed.appendChild(bloc); document.body.appendChild(ed);
    dimensionner(ed, { scrollHeight: 5000, clientHeight: 600 });
    ed.scrollTop = 0;
    ed.getBoundingClientRect = () => ({ top: 0, bottom: 600, left: 0, right: 100, width: 100, height: 600 });
    positionner(bloc, 2000);

    const r = scrollBlockIntoView(ed, bloc);
    expect(r.scrolledContainer).toBe(true);
    expect(ed.scrollTop).toBeGreaterThan(0);
    expect(ed.scrollTop).toBeLessThanOrEqual(5000 - 600);   // clampé
  });

  test('entrées dégénérées → aucun défilement, aucun crash', () => {
    const ed = document.createElement('div');
    const dehors = document.createElement('p');
    document.body.appendChild(ed);
    expect(scrollBlockIntoView(null, dehors).ok).toBe(false);
    expect(scrollBlockIntoView(ed, null).ok).toBe(false);
    expect(scrollBlockIntoView(ed, dehors).ok).toBe(false);  // hors du conteneur
    expect(scrollBy).not.toHaveBeenCalled();
  });
});

describe('flashBlock — signaler sans polluer le HTML publié', () => {
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => { jest.useRealTimers(); });

  test('l\'attribut style est entièrement retiré après le flash', () => {
    const el = document.createElement('p');
    flashBlock(el);
    expect(el.getAttribute('style')).toContain('outline');
    jest.advanceTimersByTime(1000);
    // Sans ce nettoyage, chaque saut laissait un style="" résiduel dans l'article
    expect(el.hasAttribute('style')).toBe(false);
  });

  test('un style préexistant du rédacteur est préservé', () => {
    const el = document.createElement('p');
    el.style.textAlign = 'center';
    flashBlock(el);
    jest.advanceTimersByTime(1000);
    expect(el.style.textAlign).toBe('center');
    expect(el.style.outline).toBe('');
  });

  test('entrée dégénérée', () => {
    expect(() => flashBlock(null)).not.toThrow();
  });
});
