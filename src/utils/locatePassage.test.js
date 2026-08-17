// ── Retrouver un passage cité malgré le BALISAGE INLINE ───────────────────────
//
// Piste d'Andrianina : « il y a des balises qui sont intégrées entre les textes
// ex : <em>, br etc. qui fait que des passages cités sont introuvables ».
// Vérifiée par exécution — chaque test ci-dessous ÉCHOUAIT avec l'ancien
// appariement (`includes` brut côté phase 4, `brut.indexOf(premierMot)` côté
// phase 3).
/* eslint-env jest */
import {
  passageSignature, findPassageInText, textContainsPassage,
  findBlockForPassage, LOCATABLE_BLOCK_SEL,
} from './locatePassage';

const dom = (html) => {
  const d = document.createElement('div');
  d.innerHTML = html;
  return d;
};

describe('signature — le balisage et la typographie ne comptent plus', () => {
  test('`<br>` COLLE les mots dans textContent, la signature les réconcilie', () => {
    // C'est le cas le plus vicieux : <br> ne produit AUCUN caractère.
    const dansLeDom = dom('<p>Ligne A<br>Ligne B</p>').textContent;
    expect(dansLeDom).toBe('Ligne ALigne B');            // mots collés, constaté
    expect(passageSignature(dansLeDom)).toBe(passageSignature('Ligne A Ligne B'));
  });

  test('espace fantôme laissée par le retrait d\'une balise inline', () => {
    // `texteDe` (stylePatterns.js) remplace chaque balise par UNE ESPACE :
    // "Tarif <strong>60 EUR</strong>/m2" devient "Tarif 60 EUR /m2".
    const dansLeDom = dom('<p>Tarif <strong>60 EUR</strong>/m2 pose</p>').textContent;
    expect(dansLeDom).toBe('Tarif 60 EUR/m2 pose');
    expect(textContainsPassage(dansLeDom, 'Tarif 60 EUR /m2 pose')).toBe(true);
  });

  test('espace insécable réelle contre espace ordinaire', () => {
    const dansLeDom = dom('<p>Comptez 60&nbsp;000&nbsp;EUR</p>').textContent;
    expect(dansLeDom).toContain(' ');
    expect(textContainsPassage(dansLeDom, 'Comptez 60 000 EUR')).toBe(true);
  });

  test('apostrophes et guillemets courbes, tirets longs', () => {
    expect(textContainsPassage("L’isolation « idéale » — vraiment", "L'isolation \" idéale \" - vraiment")).toBe(true);
  });

  test('retours à la ligne et indentation du HTML source', () => {
    const dansLeDom = dom('<p>\n    Le prix\n    monte\n  </p>').textContent;
    expect(textContainsPassage(dansLeDom, 'Le prix monte')).toBe(true);
  });
});

describe('findPassageInText — bornes dans le texte RÉEL', () => {
  test('rend des bornes utilisables pour surligner la portion exacte', () => {
    const brut = 'Avant. L’isolation  coûte 60 EUR. Après.';
    const b = findPassageInText(brut, "L'isolation coûte 60 EUR.");
    expect(b).not.toBeNull();
    expect(brut.slice(b.start, b.end)).toBe('L’isolation  coûte 60 EUR.');
  });

  test('passage absent → null (et non une position fausse)', () => {
    expect(findPassageInText('Le prix monte', 'Ce texte est ailleurs')).toBeNull();
  });

  test('passage vide → null, jamais un appariement à l\'index 0', () => {
    expect(findPassageInText('Le prix monte', '   ')).toBeNull();
    expect(findPassageInText('Le prix monte', '')).toBeNull();
  });
});

describe('findBlockForPassage — le bloc porteur, pas son conteneur', () => {
  test('un `div` d\'habillage ne rafle pas l\'appariement : le plus PETIT gagne', () => {
    // Ce cas justifie l'inclusion de `div` dans la liste : sans le choix du plus
    // petit, le conteroir envelopperait tout l'article et on surlignerait tout.
    const root = dom('<div><p>Intro sans rapport.</p><p>Le prix <em>moyen</em> atteint 60 EUR.</p></div>');
    const bloc = findBlockForPassage(root, 'Le prix moyen atteint 60 EUR.');
    expect(bloc.tagName).toBe('P');
    expect(bloc.textContent).toContain('60 EUR');
  });

  test('les blocs que l\'ancienne liste ignorait sont désormais atteignables', () => {
    // h1, th, figcaption, dd : un passage y vivant n'était localisable par AUCUNE
    // des deux phases.
    [
      ['<h1>Toiture en bac acier 2026</h1>', 'H1', 'Toiture en bac acier 2026'],
      ['<table><tr><th>Prix au metre carre</th></tr></table>', 'TH', 'Prix au metre carre'],
      ['<figure><figcaption>Vue de la charpente</figcaption></figure>', 'FIGCAPTION', 'Vue de la charpente'],
      ['<dl><dt>Zinc</dt><dd>Le zinc resiste bien</dd></dl>', 'DD', 'Le zinc resiste bien'],
    ].forEach(([html, tag, passage]) => {
      expect(findBlockForPassage(dom(html), passage).tagName).toBe(tag);
    });
  });

  test('le prédicat d\'exclusion est respecté', () => {
    const root = dom('<p class="deja">Le prix monte fort</p><p>Le prix monte fort</p>');
    const bloc = findBlockForPassage(root, 'Le prix monte fort', (b) => b.classList.contains('deja'));
    expect(bloc.classList.contains('deja')).toBe(false);
  });

  test('passage introuvable → null', () => {
    expect(findBlockForPassage(dom('<p>Rien ici</p>'), 'Autre chose entierement')).toBeNull();
  });

  test('racine absente ou invalide → null, jamais une exception', () => {
    expect(findBlockForPassage(null, 'x')).toBeNull();
    expect(findBlockForPassage({}, 'x')).toBeNull();
  });

  test('la liste de blocs couvre bien les conteneurs texte usuels', () => {
    ['p', 'li', 'h1', 'h6', 'td', 'th', 'blockquote', 'figcaption', 'dd', 'dt', 'div']
      .forEach((t) => expect(LOCATABLE_BLOCK_SEL).toContain(t));
  });
});
