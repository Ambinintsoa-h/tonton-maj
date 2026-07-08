// Tests des utilitaires de blocs : tableaux responsives + presse-papiers de blocs
/* eslint-env jest */
import {
  makeTablesResponsive, TABLE_WRAP_ATTR,
  blockMeta, accord, insertBlockHtml, topLevelBlockOf, blockAtRange,
  isDiffWrapper, unwrapDiffWrapper, normalizeTableStructure,
} from './blocks';

const TABLE = '<table><tbody><tr><td>Prix</td><td>120 €</td></tr></tbody></table>';

describe('normalizeTableStructure', () => {
  const norm = (html) => {
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    normalizeTableStructure(tmp);
    return tmp;
  };

  it('sort un tableau piégé dans un <h2> et déballe les cellules noyées', () => {
    const dirty = '<h2 class="wp-block-heading"><table><thead><tr><th><p><span style="font-weight: normal;">Matériau</span></p></th></tr></thead><tbody><tr><td><p><span style="font-weight: normal;">Zinc</span></p></td></tr></tbody></table></h2>';
    const tmp = norm(dirty);
    const table = tmp.querySelector('table');
    expect(table).not.toBeNull();
    // le tableau n'est plus DANS le heading
    expect(table.closest('h2')).toBeNull();
    // cellules déballées : plus de <p>/<span>, texte direct
    expect(tmp.querySelector('th').innerHTML).toBe('Matériau');
    expect(tmp.querySelector('td').innerHTML).toBe('Zinc');
    expect(tmp.querySelector('span')).toBeNull();
  });

  it('supprime les <thead>/<tbody>/lignes vides et les <thead> en double', () => {
    const dirty = '<table><thead><tr><th></th></tr></thead><thead><tr><th></th></tr></thead>'
      + '<thead><tr><th>H</th></tr></thead>'
      + '<tbody><tr><td>A</td></tr></tbody>'
      + '<tbody><tr><td></td></tr></tbody></table>';
    const tmp = norm(dirty);
    expect(tmp.querySelectorAll('thead').length).toBe(1);
    expect(tmp.querySelector('thead th').textContent).toBe('H');
    // la ligne vide et son tbody fantôme ont disparu
    expect(tmp.querySelectorAll('tbody').length).toBe(1);
    expect(tmp.querySelectorAll('tr').length).toBe(2); // 1 header + 1 data
  });

  it('retire les styles de police inline des cellules (format standard)', () => {
    const dirty = '<table><tbody><tr><td style="font-size:20px;color:#f00;padding:4px">X</td></tr></tbody></table>';
    const td = norm(dirty).querySelector('td');
    expect(td.getAttribute('style')).toBe('padding:4px'); // police/couleur retirées, padding conservé
  });
});

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

  it('retire les <br> parasites accumulés dans un conteneur déjà enveloppé', () => {
    const dirty = '<figure><div data-tt-table-wrap="1" style="overflow-x:auto"><br><br><br><table style="width:100%"><tbody><tr><td>x</td></tr></tbody></table></div></figure>';
    const out = makeTablesResponsive(dirty);
    expect(out).not.toContain('<br>');
    const tmp = document.createElement('div');
    tmp.innerHTML = out;
    const wrap = tmp.querySelector(`[${TABLE_WRAP_ATTR}]`);
    expect(wrap.querySelectorAll('br').length).toBe(0);
    expect(wrap.querySelector('table')).not.toBeNull();
    expect(tmp.querySelectorAll(`[${TABLE_WRAP_ATTR}]`).length).toBe(1); // pas de double-wrap
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
    expect(blockMeta(el('<h2>Titre</h2>'))).toEqual({ name: 'Titre H2', art: 'le titre H2', fem: false });
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

  it('voit à travers les marqueurs de diff <ins>/<mark> (bloc ajouté)', () => {
    const ins = el('<ins class="added-content"><h2>Nouvelle section</h2></ins>');
    expect(isDiffWrapper(ins)).toBe(true);
    expect(unwrapDiffWrapper(ins).tagName).toBe('H2');
    // typé comme un vrai H2, pas comme « ins » générique
    expect(blockMeta(ins).name).toBe('Titre H2');

    const insTable = el('<ins class="added-content"><table></table></ins>');
    expect(blockMeta(insTable).name).toBe('Tableau');

    // wrapper enveloppant PLUSIEURS blocs → non déplié (reste le wrapper)
    const multi = el('<ins class="added-content"><p>a</p><p>b</p></ins>');
    expect(unwrapDiffWrapper(multi).tagName).toBe('INS');

    // un élément normal n'est pas un wrapper
    expect(isDiffWrapper(el('<p>x</p>'))).toBe(false);
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
