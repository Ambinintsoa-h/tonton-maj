// Tests de repairStructureEl — réparation des imbrications cassées
/* eslint-env jest */
import { repairStructureEl } from './diff';

const run = (html) => {
  const div = document.createElement('div');
  div.innerHTML = html;
  repairStructureEl(div);
  return div;
};

describe('repairStructureEl — blocs non-<li> sortis des listes', () => {
  it('sort un <h2>/<p> glissés dans une <ul> et les place APRÈS la liste', () => {
    const div = run('<ul><li>A</li><li>B</li><h2>Titre</h2><p>Texte</p></ul>');
    const ul = div.querySelector('ul');
    // la liste ne contient plus que ses <li>
    expect(Array.from(ul.children).every(c => c.tagName === 'LI')).toBe(true);
    expect(ul.children.length).toBe(2);
    // le h2 et le p sont ressortis, dans l'ordre, juste après la liste
    expect(div.children[0].tagName).toBe('UL');
    expect(div.children[1].tagName).toBe('H2');
    expect(div.children[2].tagName).toBe('P');
  });

  it('laisse une liste correcte intacte', () => {
    const div = run('<ul><li>A</li><li>B</li></ul>');
    expect(div.querySelector('ul').children.length).toBe(2);
    expect(div.children.length).toBe(1);
  });

  it('sort aussi un bloc bloc d\'une <ol>', () => {
    const div = run('<ol><li>1</li><table><tbody><tr><td>x</td></tr></tbody></table></ol>');
    const ol = div.querySelector('ol');
    expect(ol.children.length).toBe(1);
    expect(ol.querySelector('table')).toBeNull();
    expect(div.querySelector('table')).not.toBeNull();
  });
});
