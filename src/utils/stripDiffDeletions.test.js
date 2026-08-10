// Défaut n°2 : le bouton « Barré » de la barre de mise en forme SUPPRIMAIT le texte
// à la publication. Reproduit dans un vrai navigateur, dans les deux variantes que
// produit execCommand selon styleWithCSS :
//   <strike>de 60 eur</strike>                              (styleWithCSS = false)
//   <span style="text-decoration-line: line-through">…</span> (styleWithCSS = true)
// Dans les deux cas l'ancien filtre effaçait l'élément entier :
//   « Le prix etait de 60 euros hors pose. » → « Le prix etait os hors pose. »
/* eslint-env jest */
import { stripDiffDeletions, DIFF_DELETED_BG } from './diff';

const dom = (html) => { const d = document.createElement('div'); d.innerHTML = html; return d; };

describe('ce qui doit être RETIRÉ — les suppressions du diff', () => {
  test('un <del class="deleted-content"> disparaît avec son texte', () => {
    const d = dom('<p>Comptez <del class="deleted-content">40</del><mark class="updated-content">60</mark> EUR.</p>');
    expect(stripDiffDeletions(d)).toBe(1);
    expect(d.textContent).toBe('Comptez 60 EUR.');
  });

  test('tout élément portant .deleted-content, quelle que soit sa balise', () => {
    const d = dom('<p>a<span class="deleted-content">supprimé</span>b</p>');
    stripDiffDeletions(d);
    expect(d.textContent).toBe('ab');
  });

  test('résidu d\'un <del> « inliné » par Chrome : fond rouge du marqueur', () => {
    const d = dom(`<p>a<span style="background-color: ${DIFF_DELETED_BG[0]}; text-decoration: line-through">vieux</span>b</p>`);
    expect(stripDiffDeletions(d)).toBe(1);
    expect(d.textContent).toBe('ab');
  });

  test('le fond de survol du marqueur compte aussi', () => {
    const d = dom(`<p>a<strike style="background-color: ${DIFF_DELETED_BG[1]}">vieux</strike>b</p>`);
    stripDiffDeletions(d);
    expect(d.textContent).toBe('ab');
  });
});

describe('ce qui doit être CONSERVÉ — le barré volontaire du rédacteur', () => {
  test('la régression exacte constatée : plus aucun mot perdu', () => {
    // Ce que produit le bouton « Barré » avec styleWithCSS = false
    const d = dom('<p>Le prix etait <strike>de 60 eur</strike>os hors pose.</p>');
    expect(stripDiffDeletions(d)).toBe(0);
    expect(d.textContent).toBe('Le prix etait de 60 euros hors pose.');
    expect(d.querySelector('strike')).not.toBeNull();      // le barré reste visible
  });

  test('variante styleWithCSS = true : le <span> à text-decoration survit', () => {
    const d = dom('<p>Le prix etait <span style="text-decoration-line: line-through">de 60 eur</span>os hors pose.</p>');
    expect(stripDiffDeletions(d)).toBe(0);
    expect(d.textContent).toBe('Le prix etait de 60 euros hors pose.');
  });

  test('un <s> sémantique venu de l\'article WordPress d\'origine', () => {
    const d = dom('<p>Ancien tarif : <s>49 EUR</s> désormais 39 EUR.</p>');
    stripDiffDeletions(d);
    expect(d.textContent).toBe('Ancien tarif : 49 EUR désormais 39 EUR.');
  });

  test('un barré portant un fond QUI N\'EST PAS celui du diff est conservé', () => {
    const d = dom('<p>a<strike style="background-color: rgb(255,255,0)">jaune</strike>b</p>');
    expect(stripDiffDeletions(d)).toBe(0);
    expect(d.textContent).toBe('ajauneb');
  });
});

describe('robustesse', () => {
  test('barré imbriqué DANS une suppression : pas de double traitement ni de crash', () => {
    const d = dom('<p>a<del class="deleted-content">vieux <strike>très vieux</strike></del>b</p>');
    stripDiffDeletions(d);
    expect(d.textContent).toBe('ab');
  });

  test('document sans rien à retirer', () => {
    const d = dom('<h2>Titre</h2><p>Texte normal.</p>');
    expect(stripDiffDeletions(d)).toBe(0);
    expect(d.innerHTML).toBe('<h2>Titre</h2><p>Texte normal.</p>');
  });

  test('entrées dégénérées', () => {
    expect(stripDiffDeletions(null)).toBe(0);
    expect(stripDiffDeletions(undefined)).toBe(0);
    expect(stripDiffDeletions({})).toBe(0);
  });
});
