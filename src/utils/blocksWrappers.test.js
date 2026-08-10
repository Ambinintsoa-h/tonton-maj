// Défauts n°1 et n°4 : le corps de l'article enfermé dans des <div> sans attribut.
// Conséquences mesurées en production sur un article de 3 535 mots :
//   • la barre « Tableau » visait tout l'article → « Supprimer ce tableau ? »
//     effaçait 3 534 mots sur 3 535, les 14 titres et les 3 tableaux ;
//   • le navigateur de structure n'annonçait que « 1 sect. · 2 blocs ».
/* eslint-env jest */
import { tableBlockOf, unwrapTransparentDivs, topLevelBlockOf } from './blocks';

// Structure RÉELLE relevée dans l'éditeur : 2 enfants directs seulement —
// l'image à la une, puis un <div> nu contenant un second <div> nu avec tout le corps.
const editeurReel = () => {
  const ed = document.createElement('div');
  ed.innerHTML = '<figure data-featured="true"><img src="a.jpg" alt=""></figure>'
    + '<div><div>'
    + '<h2>Quel est le coût ?</h2>'
    + '<p>Comptez 60 EUR/m².</p>'
    + '<ul><li>Acier</li><li>Zinc</li></ul>'
    + '<div data-tt-table-wrap><table><tbody><tr><td>Acier</td><td>55</td></tr></tbody></table></div>'
    + '<h2>Conclusion</h2><p>Fin.</p>'
    + '</div></div>';
  return ed;
};

describe('tableBlockOf — ne jamais viser au-delà du tableau', () => {
  test('le défaut d\'origine : topLevelBlockOf remontait jusqu\'à TOUT l\'article', () => {
    const ed = editeurReel();
    const vise = topLevelBlockOf(ed, ed.querySelector('table'));
    expect(vise.tagName).toBe('DIV');
    expect(vise.querySelectorAll('h2')).toHaveLength(2);   // il emportait les titres
  });

  test('la cible est le wrapper responsive du tableau, et lui seul', () => {
    const ed = editeurReel();
    const vise = tableBlockOf(ed, ed.querySelector('table'));
    expect(vise.hasAttribute('data-tt-table-wrap')).toBe(true);
    expect(vise.querySelectorAll('h2')).toHaveLength(0);
    expect(vise.querySelectorAll('table')).toHaveLength(1);
  });

  test('supprimer la cible ne retire que le tableau', () => {
    const ed = editeurReel();
    tableBlockOf(ed, ed.querySelector('table')).remove();
    expect(ed.querySelectorAll('table')).toHaveLength(0);
    expect(ed.querySelectorAll('h2')).toHaveLength(2);     // titres intacts
    expect(ed.textContent).toContain('Comptez 60 EUR/m².');
  });

  test('tableau sans wrapper → la cible est le tableau lui-même', () => {
    const ed = document.createElement('div');
    ed.innerHTML = '<p>Avant.</p><table><tbody><tr><td>x</td></tr></tbody></table><p>Après.</p>';
    expect(tableBlockOf(ed, ed.querySelector('table')).tagName).toBe('TABLE');
  });

  test('on ne remonte pas dans un parent qui contient autre chose', () => {
    const ed = document.createElement('div');
    ed.innerHTML = '<section><h2>Prix</h2><table><tbody><tr><td>x</td></tr></tbody></table></section>';
    // La <section> contient AUSSI le titre → on s'arrête au tableau.
    expect(tableBlockOf(ed, ed.querySelector('table')).tagName).toBe('TABLE');
  });

  test('entrées dégénérées', () => {
    const ed = editeurReel();
    expect(tableBlockOf(null, ed)).toBeNull();
    expect(tableBlockOf(ed, null)).toBeNull();
    expect(tableBlockOf(ed, ed)).toBeNull();
    expect(tableBlockOf(ed, document.createElement('table'))).toBeNull(); // hors conteneur
  });
});

describe('unwrapTransparentDivs — rendre la structure lisible', () => {
  test('les div nus disparaissent, les blocs remontent au premier niveau', () => {
    const ed = editeurReel();
    expect(ed.children).toHaveLength(2);                   // avant : FIGURE + DIV
    const n = unwrapTransparentDivs(ed);
    expect(n).toBe(2);                                     // les deux div nus
    const tags = [...ed.children].map(e => e.tagName);
    expect(tags).toEqual(['FIGURE', 'H2', 'P', 'UL', 'DIV', 'H2', 'P']);
    expect(ed.children.length).toBeGreaterThan(2);
  });

  test('un div PORTANT un attribut est préservé — il peut être signifiant', () => {
    const ed = editeurReel();
    unwrapTransparentDivs(ed);
    expect(ed.querySelectorAll('[data-tt-table-wrap]')).toHaveLength(1);
  });

  test('aucune perte de contenu', () => {
    const ed = editeurReel();
    const avant = ed.textContent;
    const tableaux = ed.querySelectorAll('table').length;
    unwrapTransparentDivs(ed);
    expect(ed.textContent).toBe(avant);
    expect(ed.querySelectorAll('table')).toHaveLength(tableaux);
    expect(ed.querySelectorAll('h2')).toHaveLength(2);
    expect(ed.querySelectorAll('li')).toHaveLength(2);
  });

  test('idempotent : appelé après chaque accepter/rejeter, il ne fait plus rien', () => {
    const ed = editeurReel();
    unwrapTransparentDivs(ed);
    const html = ed.innerHTML;
    expect(unwrapTransparentDivs(ed)).toBe(0);
    expect(ed.innerHTML).toBe(html);
  });

  test('div nus imbriqués sur plusieurs niveaux', () => {
    const ed = document.createElement('div');
    ed.innerHTML = '<div><div><div><p>Profond.</p></div></div></div>';
    unwrapTransparentDivs(ed);
    expect([...ed.children].map(e => e.tagName)).toEqual(['P']);
  });

  test('les classes et styles empêchent le dépliage', () => {
    const ed = document.createElement('div');
    ed.innerHTML = '<div class="wp-block-group"><p>a</p></div><div style="display:flex"><p>b</p></div>';
    expect(unwrapTransparentDivs(ed)).toBe(0);
    expect(ed.children).toHaveLength(2);
  });

  test('les marqueurs de diff traversent le dépliage intacts', () => {
    const ed = document.createElement('div');
    ed.innerHTML = '<div><del class="deleted-content">vieux</del><mark class="updated-content">neuf</mark></div>';
    unwrapTransparentDivs(ed);
    expect(ed.querySelector('del.deleted-content')).not.toBeNull();
    expect(ed.querySelector('mark.updated-content')).not.toBeNull();
    // L'adjacence del+mark, sur laquelle reposent Accepter/Rejeter, est conservée
    expect(ed.querySelector('del').nextElementSibling.tagName).toBe('MARK');
  });

  test('entrée dégénérée', () => {
    expect(unwrapTransparentDivs(null)).toBe(0);
    expect(unwrapTransparentDivs({})).toBe(0);
  });
});
