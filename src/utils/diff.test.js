// Tests de repairStructureEl — réparation des imbrications cassées
/* eslint-env jest */
import { repairStructureEl, absorbOrphanDeterminers, applyAllDiffs, applyAddition, moveFaqToEnd } from './diff';

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

describe('applyAddition — jamais d\'<ins> enfant direct de liste/tableau', () => {
  const parse = (html) => { const d = document.createElement('div'); d.innerHTML = html; return d; };

  it('anchor dans un <li> → insertion APRÈS la liste, pas dedans', () => {
    const html = '<p>Intro.</p><ul><li>alpha beta gamma delta</li><li>autre item</li></ul><p>Suite.</p>';
    const { html: out, matched } = applyAddition(html, 'alpha beta gamma delta', '<p>Nouveau bloc</p>');
    expect(matched).toBe(true);
    const div = parse(out);
    const ins = div.querySelector('ins.added-content');
    expect(ins).not.toBeNull();
    expect(['UL', 'OL']).not.toContain(ins.parentElement.tagName);
    expect(div.querySelector('ul').nextElementSibling).toBe(ins);
    // la liste est intacte : toujours 2 items
    expect(div.querySelector('ul').children.length).toBe(2);
  });

  it('listes imbriquées : sort au niveau valide le plus proche (jamais entre deux <li>)', () => {
    const html = '<ul><li>parent <ul><li>enfant unique cible profonde</li></ul></li><li>frère</li></ul>';
    const { html: out, matched } = applyAddition(html, 'enfant unique cible profonde', '<p>Bloc</p>');
    expect(matched).toBe(true);
    const ins = parse(out).querySelector('ins.added-content');
    expect(ins).not.toBeNull();
    expect(['UL', 'OL']).not.toContain(ins.parentElement.tagName);
  });

  it('anchor dans un <td> → insertion APRÈS le tableau', () => {
    const html = '<table><tbody><tr><td>cellule avec texte cible ici</td></tr></tbody></table><p>Suite.</p>';
    const { html: out, matched } = applyAddition(html, 'cellule avec texte cible ici', '<p>Bloc</p>');
    expect(matched).toBe(true);
    const div = parse(out);
    const ins = div.querySelector('ins.added-content');
    expect(ins).not.toBeNull();
    expect(ins.closest('table')).toBeNull();
    expect(div.querySelector('table').nextElementSibling).toBe(ins);
  });
});

describe('applyAllDiffs — addition dont l\'anchor a disparu', () => {
  it('place le bloc au plus fort recouvrement lexical au lieu de le perdre', () => {
    const html = '<p>Les chiens aboient fort.</p><p>Les chats miaulent doucement la nuit.</p>';
    const { html: out, updates } = applyAllDiffs(html, [{
      type: 'addition',
      anchor: 'passage disparu introuvable xyz',
      updated: '<p>Les chats domestiques dorment beaucoup.</p>',
      reason: 'chats miaulent nuit',
    }]);
    expect(updates[0].applied).toBe(true);
    expect(updates[0].placed).toBe('fuzzy');
    const div = document.createElement('div');
    div.innerHTML = out;
    // inséré après le paragraphe des chats (meilleur recouvrement), pas perdu
    expect(div.children[2].tagName).toBe('INS');
    expect(div.children[1].textContent).toContain('chats miaulent');
  });
});

describe('moveFaqToEnd — sections spéciales jamais imbriquées dans une addition', () => {
  const parse = (html) => { const d = document.createElement('div'); d.innerHTML = html; return d; };

  it('scinde une addition « section + FAQ + résumé » : chacun son ins, FAQ en fin, TL;DR après l\'intro', () => {
    const html =
      '<p>Intro de l\'article.</p>'
      + '<h2>Section existante</h2><p>Texte.</p>'
      + '<ins class="added-content">'
      +   '<h2>Entretien et durée de vie</h2><p>Nouveau contenu.</p>'
      +   '<h2>FAQ — Toiture</h2><p>Q/R.</p>'
      +   '<h2>Résumé de l\'article</h2><ul><li>Point.</li></ul>'
      + '</ins>'
      + '<p>Fin.</p>';
    const div = parse(moveFaqToEnd(html));
    const inses = div.querySelectorAll('ins.added-content');
    expect(inses.length).toBe(3); // section, FAQ et TL;DR chacun dans son propre ins
    // FAQ = dernier élément du document
    const last = div.lastElementChild;
    expect(last.classList.contains('tt-faq')).toBe(true);
    expect(last.textContent).toContain('FAQ');
    // TL;DR remonté avant le premier H2 (après l'intro)
    const tldr = div.querySelector('ins.tt-tldr');
    expect(tldr).not.toBeNull();
    expect(tldr.nextElementSibling?.textContent).toContain('Section existante');
    // L'addition d'origine ne contient plus ni FAQ ni Résumé
    const orig = Array.from(inses).find(i => i.textContent.includes('Entretien'));
    expect(orig.textContent).not.toMatch(/FAQ|Résumé/);
  });

  it('une addition entièrement FAQ est marquée et envoyée en fin', () => {
    const html = '<p>Intro.</p><ins class="added-content"><h2>FAQ</h2><p>Q/R.</p></ins><h2>Suite</h2><p>Texte.</p>';
    const div = parse(moveFaqToEnd(html));
    const last = div.lastElementChild;
    expect(last.tagName).toBe('INS');
    expect(last.textContent).toContain('FAQ');
  });

  it('FAQ en section directe (comportement historique) toujours déplacée en fin', () => {
    const html = '<p>Intro.</p><h2>FAQ</h2><p>Q/R.</p><h2>Autre section</h2><p>Texte final.</p>';
    const div = parse(moveFaqToEnd(html));
    const headings = Array.from(div.querySelectorAll('h2')).map(h => h.textContent);
    expect(headings[headings.length - 1]).toBe('FAQ');
  });

  it('TL;DR égaré en fin d\'article remonte après l\'intro', () => {
    const html = '<p>Intro.</p><h2>Section A</h2><p>Texte.</p><h2>Résumé de l\'article</h2><ul><li>Point.</li></ul>';
    const div = parse(moveFaqToEnd(html));
    expect(div.children[1].tagName).toBe('H2');
    expect(div.children[1].textContent).toContain('Résumé');
  });

  it('document déjà conforme → HTML inchangé', () => {
    const html = '<p>Intro.</p><h2>Résumé de l\'article</h2><ul><li>x</li></ul><h2>Section</h2><p>t</p><h2>FAQ</h2><p>q</p>';
    expect(moveFaqToEnd(html)).toBe(html);
  });
});
