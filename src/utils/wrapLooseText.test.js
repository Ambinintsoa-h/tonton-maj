// Tests de wrapLooseTextIntoParagraphs — structure <p> des articles collés en texte brut
/* eslint-env jest */
import { wrapLooseTextIntoParagraphs } from './diff';

const wrap = (html) => {
  const div = document.createElement('div');
  div.innerHTML = html;
  wrapLooseTextIntoParagraphs(div);
  return div;
};

describe('wrapLooseTextIntoParagraphs — texte brut', () => {
  it('convertit chaque ligne d\'un texte nu en <p> (même granularité que la vue Avant)', () => {
    const div = wrap('Titre de l\'article\nPremier paragraphe.\nDeuxième paragraphe.');
    const ps = div.querySelectorAll(':scope > p');
    expect(ps).toHaveLength(3);
    expect(ps[0].textContent).toBe('Titre de l\'article');
    expect(ps[2].textContent).toBe('Deuxième paragraphe.');
    expect(div.innerHTML).not.toMatch(/^[^<]/); // plus de texte nu à la racine
  });

  it('ignore les lignes blanches (pas de <p> vide)', () => {
    const div = wrap('Un\n\n\nDeux');
    const ps = div.querySelectorAll(':scope > p');
    expect(ps).toHaveLength(2);
    expect([...ps].every(p => p.textContent.trim())).toBe(true);
  });

  it('garde les éléments INLINE (<strong>, <a>) dans le paragraphe courant', () => {
    const div = wrap('Avant <strong>gras</strong> après\nLigne 2');
    const ps = div.querySelectorAll(':scope > p');
    expect(ps).toHaveLength(2);
    expect(ps[0].innerHTML).toBe('Avant <strong>gras</strong> après');
  });
});

describe('wrapLooseTextIntoParagraphs — contenu mixte et HTML pur', () => {
  it('enveloppe le texte lâche SANS toucher aux blocs existants, ordre conservé', () => {
    const div = wrap('Intro texte nu\n<h2>Section</h2><p>Déjà en p</p>Suite nue');
    const tags = [...div.children].map(c => c.tagName);
    expect(tags).toEqual(['P', 'H2', 'P', 'P']);
    expect(div.children[0].textContent).toBe('Intro texte nu');
    expect(div.children[3].textContent).toBe('Suite nue');
  });

  it('est un no-op pour un article déjà structuré en HTML', () => {
    const src = '<h1>T</h1><p>Un <a href="/x">lien</a></p><table><tbody><tr><td>c</td></tr></tbody></table><ul><li>i</li></ul>';
    const div = wrap(src);
    expect(div.innerHTML).toBe(src);
  });

  it('supprime les blancs d\'indentation entre blocs sans créer de <p>', () => {
    const div = wrap('<p>Un</p>\n  \n<p>Deux</p>');
    expect(div.querySelectorAll(':scope > p')).toHaveLength(2);
  });
});
