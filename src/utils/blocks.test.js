// Tests des utilitaires de blocs : tableaux responsives + presse-papiers de blocs
/* eslint-env jest */
import {
  makeTablesResponsive, TABLE_WRAP_ATTR,
  blockMeta, accord, insertBlockHtml, topLevelBlockOf, blockAtRange,
} from './blocks';

const TABLE = '<table><tbody><tr><td>Prix</td><td>120 €</td></tr></tbody></table>';

describe('makeTablesResponsive', () => {
  it('enveloppe un tableau nu dans un conteneur à défilement horizontal', () => {
    const out = makeTablesResponsive(`<p>Avant</p>${TABLE}<p>Après</p>`);
    const tmp = document.createElement('div');
    tmp.innerHTML = out;
    const wrap = tmp.querySelector(`[${TABLE_WRAP_ATTR}]`);
    expect(wrap).not.toBeNull();
    expect(wrap.style.overflowX).toBe('auto');
    expect(wrap.querySelector('table')).not.toBeNull();
    expect(tmp.querySelector('table').style.width).toBe('100%');
    // Les paragraphes autour ne bougent pas
    expect(tmp.children[0].tagName).toBe('P');
    expect(tmp.children[2].tagName).toBe('P');
  });

  it('est idempotente (ré-application sans effet)', () => {
    const once = makeTablesResponsive(`<h2>Tarifs</h2>${TABLE}`);
    expect(makeTablesResponsive(once)).toBe(once);
    const tmp = document.createElement('div');
    tmp.innerHTML = makeTablesResponsive(once);
    expect(tmp.querySelectorAll(`[${TABLE_WRAP_ATTR}]`).length).toBe(1);
  });

  it('préserve les marques de diff <ins>/<mark> dans les cellules', () => {
    const input = '<table><tbody><tr><td><ins>Nouveau prix</ins></td><td><mark>140 €</mark></td></tr></tbody></table>';
    const out = makeTablesResponsive(input);
    expect(out).toContain('<ins>Nouveau prix</ins>');
    expect(out).toContain('<mark>140 €</mark>');
  });

  it('traite plusieurs tableaux et laisse le HTML sans tableau intact', () => {
    const out = makeTablesResponsive(`${TABLE}<p>Texte</p>${TABLE}`);
    const tmp = document.createElement('div');
    tmp.innerHTML = out;
    expect(tmp.querySelectorAll(`[${TABLE_WRAP_ATTR}]`).length).toBe(2);

    const noTable = '<h2>Titre</h2><p>Paragraphe</p>';
    expect(makeTablesResponsive(noTable)).toBe(noTable);
  });

  it('ne modifie pas une largeur inline déjà définie sur le tableau', () => {
    const input = '<table style="width:80%"><tbody><tr><td>x</td></tr></tbody></table>';
    const out = makeTablesResponsive(input);
    const tmp = document.createElement('div');
    tmp.innerHTML = out;
    expect(tmp.querySelector('table').style.width).toBe('80%');
  });
});

describe('blockMeta / accord', () => {
  const el = (html) => {
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    return tmp.firstElementChild;
  };

  it('identifie les types de blocs avec article et genre', () => {
    expect(blockMeta(el('<table></table>'))).toEqual({ name: 'Tableau', art: 'le tableau', fem: false });
    expect(blockMeta(el('<h2>Titre</h2>'))).toEqual({ name: 'Titre', art: 'le titre', fem: false });
    expect(blockMeta(el('<ul><li>a</li></ul>')).fem).toBe(true);
    expect(blockMeta(el('<figure><img alt=""/></figure>')).name).toBe('Image');
    expect(blockMeta(el('<div class="faq-section"></div>')).name).toBe('FAQ');
    // Wrapper responsive d'un tableau → identifié comme tableau
    const wrapped = el(makeTablesResponsive('<table></table>'));
    expect(blockMeta(wrapped).name).toBe('Tableau');
  });

  it('accorde le participe passé au féminin', () => {
    expect(accord({ fem: true }, 'coupé')).toBe('coupée');
    expect(accord({ fem: false }, 'collé')).toBe('collé');
  });
});

describe('insertBlockHtml / topLevelBlockOf / blockAtRange', () => {
  const setup = () => {
    const container = document.createElement('div');
    container.innerHTML = '<h2>A</h2><p>B</p><p>C</p>';
    return container;
  };

  it('colle avant / après un élément de référence', () => {
    const c1 = setup();
    insertBlockHtml(c1, TABLE, c1.children[1], 'before');
    expect(Array.from(c1.children).map(e => e.tagName)).toEqual(['H2', 'TABLE', 'P', 'P']);

    const c2 = setup();
    insertBlockHtml(c2, TABLE, c2.children[1], 'after');
    expect(Array.from(c2.children).map(e => e.tagName)).toEqual(['H2', 'P', 'TABLE', 'P']);
  });

  it('colle en fin d\'article sans référence valide', () => {
    const c = setup();
    insertBlockHtml(c, TABLE, null, 'after');
    expect(c.lastElementChild.tagName).toBe('TABLE');
  });

  it('remonte au bloc top-level depuis un nœud imbriqué', () => {
    const c = setup();
    const b = document.createElement('b');
    c.children[1].appendChild(b);
    expect(topLevelBlockOf(c, b)).toBe(c.children[1]);
    expect(topLevelBlockOf(c, c)).toBeNull();
  });

  it('résout le bloc au point d\'un range (y compris entre deux blocs)', () => {
    const c = setup();
    document.body.appendChild(c);
    const range = document.createRange();
    range.setStart(c.children[1].firstChild, 1); // dans « B »
    expect(blockAtRange(c, range)).toBe(c.children[1]);
    const between = document.createRange();
    between.setStart(c, 2); // entre <p>B</p> et <p>C</p> → bloc suivant le caret
    expect(blockAtRange(c, between)).toBe(c.children[2]);
    c.remove();
  });
});
