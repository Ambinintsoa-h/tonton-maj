// Tests de repairStructureEl — réparation des imbrications cassées
/* eslint-env jest */
import { repairStructureEl, absorbOrphanDeterminers, applyAllDiffs } from './diff';

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

describe('absorbOrphanDeterminers — suppressions sans mots orphelins', () => {
  const delText = (html) => {
    const div = document.createElement('div');
    div.innerHTML = html;
    return div.querySelector('del')?.textContent;
  };

  it('absorbe le déterminant devant une suppression pure', () => {
    const out = absorbOrphanDeterminers('<p>Voici les <del class="deleted-content">chats noirs</del>.</p>');
    expect(delText(out)).toBe('les chats noirs');
    expect(out).not.toMatch(/les <del/);
  });

  it('absorbe en chaîne (« et le », « de la »)', () => {
    const out = absorbOrphanDeterminers('<p>Un chien et le <del class="deleted-content">chat</del></p>');
    expect(delText(out)).toBe('et le chat');
    const out2 = absorbOrphanDeterminers('<p>Le prix de la <del class="deleted-content">maison</del></p>');
    expect(delText(out2)).toBe('de la maison');
  });

  it('absorbe une élision l’/d’ et une virgule de liste', () => {
    const out = absorbOrphanDeterminers('<p>Le poids de l’<del class="deleted-content">armoire</del></p>');
    expect(delText(out)).toBe('de l’armoire');
    const out2 = absorbOrphanDeterminers('<p>rapide, <del class="deleted-content">efficace</del>, fiable</p>');
    expect(delText(out2)).toBe(', efficace');
  });

  it('ne touche PAS aux remplacements (del suivi de mark)', () => {
    const src = '<p>Voici le <del class="deleted-content">chat</del><mark class="updated-content">chien</mark>.</p>';
    expect(absorbOrphanDeterminers(src)).toBe(src);
  });

  it('ne mange pas la fin d\'un mot (« Tesla », « recul »)', () => {
    const src = '<p>La Tesla <del class="deleted-content">Model S</del></p>';
    const out = absorbOrphanDeterminers(src);
    expect(delText(out)).toBe('Model S');
    expect(out).toContain('La Tesla ');
  });

  it('est branchée dans applyAllDiffs (type suppression)', () => {
    const html = '<p>Voici les chats noirs du quartier.</p>';
    const { html: out, updates } = applyAllDiffs(html, [
      { type: 'suppression', original: 'chats noirs', reason: 'test' },
    ]);
    expect(updates[0].applied).toBe(true);
    const div = document.createElement('div');
    div.innerHTML = out;
    expect(div.querySelector('del').textContent).toBe('les chats noirs');
  });
});
