/**
 * htmlText.test.js — deux défauts relevés en production le 18 août 2026, avec les
 * chaînes EXACTES qui ont lâché sur l'article God of War.
 */
import { htmlToText, decodeEntities } from './htmlText';
import { markSuggestions } from './markSuggestions';

describe('titre : les entités WordPress sont décodées', () => {
  it('« l&rsquo;ordre » redevient « l’ordre »', () => {
    expect(decodeEntities('God of War : découvrez l&rsquo;ordre de jeu complet'))
      .toBe('God of War : découvrez l’ordre de jeu complet');
  });

  it('décode le numérique et le nommé, sans double passage', () => {
    expect(decodeEntities('Prix &amp; d&eacute;lais &#8211; guide &#x20AC;'))
      .toBe('Prix & délais – guide €');
    // `&#38;` donne `&` et le décodage ne repart PAS de là : « &#38;lt; » ne doit
    // pas finir en « < », sinon une entité de données deviendrait du balisage.
    expect(decodeEntities('&#38;lt;script&#38;gt;')).toBe('&lt;script&gt;');
  });

  it('ne mange pas un titre qui ressemble à du balisage', () => {
    // La raison d'être de `decodeEntities` face à `htmlToText` : un titre est du
    // TEXTE, on n'y interprète aucune balise. `<10 kW` survit aux deux (ce n'est
    // pas un début de balise valide), mais dès que la séquence RESSEMBLE à une
    // balise, `htmlToText` la mange — et un titre y perdrait un mot en silence.
    expect(decodeEntities('Comparatif <10 kW pour 2026')).toBe('Comparatif <10 kW pour 2026');
    expect(decodeEntities('Guide <b>2026</b> du poêle')).toBe('Guide <b>2026</b> du poêle');
    expect(htmlToText('Guide <b>2026</b> du poêle')).toBe('Guide 2026 du poêle');
  });

  it('htmlToText retire les balises ET décode', () => {
    expect(htmlToText('<p>Le <strong>bilan</strong> : 94/100 &amp; plus</p>'))
      .toBe('Le bilan : 94/100 & plus');
  });
});

describe('suggestions : un passage balisé n\'est plus « introuvable »', () => {
  // Les deux suggestions réelles, citées par l'audit AVEC leur balisage.
  const ARTICLE = [
    '<ul><li><strong>Le bilan</strong> : plusieurs dizaines de millions de ventes ',
    'cumulées et trois jeux à 94/100 sur Metacritic.</li></ul>',
    '<p>Le volet nordique de 2018 cumule de nombreuses récompenses Game of the Year, ',
    'un palmarès qui mériterait une vérification directe via Metacritic ou OpenCritic.</p>',
  ].join('');

  it('repère un passage cité avec ses balises', () => {
    const suggs = [
      { original: '<li><strong>Le bilan</strong> : plusieurs dizaines de millions de ventes cumulées et trois jeux à 94/100 sur Metacritic.</li>', updated: 'x' },
      { original: '<p>Le volet nordique de 2018 cumule de nombreuses récompenses Game of the Year, un palmarès qui mériterait une vérification directe via Metacritic ou OpenCritic.</p>', updated: 'y' },
    ];
    const r = markSuggestions(ARTICLE, suggs);
    expect(r.missed).toEqual([]);
    expect(r.marked).toEqual([1, 2]);
  });

  it('un passage cité SANS balise marche toujours', () => {
    // La correction ne doit pas se payer sur le cas qui fonctionnait déjà.
    const r = markSuggestions(ARTICLE, [{ original: 'trois jeux à 94/100 sur Metacritic', updated: 'z' }]);
    expect(r.missed).toEqual([]);
    expect(r.marked).toEqual([1]);
  });

  it('un passage réellement absent reste signalé', () => {
    // Le but n'est pas de faire taire l'avertissement : un passage introuvable
    // pour de bon doit continuer à remonter au rédacteur.
    const r = markSuggestions(ARTICLE, [{ original: '<p>Kratos affronte Odin en 2022.</p>', updated: 'z' }]);
    expect(r.missed).toEqual([1]);
    expect(r.marked).toEqual([]);
  });

  it('une entité dans le passage cité n\'empêche plus l\'appariement', () => {
    const html = '<p>Le prix &amp; les délais varient selon la région.</p>';
    const r = markSuggestions(html, [{ original: '<p>Le prix &amp; les délais varient</p>', updated: 'z' }]);
    expect(r.missed).toEqual([]);
  });
});

/**
 * DOUBLE ÉCHAPPEMENT — le defaut que le correctif du 18/08 laissait passer.
 *
 * Constate en production le 19 aout 2026 : le champ Titre affichait encore
 * « God of War : decouvrez l&rsquo;ordre... » APRES le correctif. La cause n'est
 * pas `decodeEntities`, qui marche, mais le NOMBRE DE COUCHES a retirer.
 *
 * `wpTitle` et le titre enregistre sont des CHAINES : `decodeEntities` leur est
 * applique explicitement. Les deux autres sources du titre passent par le DOM
 * (`innerHTML` puis `textContent`), qui retire UNE couche implicitement — et on
 * s'arretait la. Sur un HTML doublement echappe, il en restait donc une.
 *
 * C'est le cas d'un article COLLE : `wpTitle` est absent, donc c'est justement le
 * chemin H1 qui sert. Le plus frequent des trois etait le seul non couvert.
 */
describe('titre : HTML doublement echappe (article colle)', () => {
  /** Ce que fait `extractH1FromHtml` : le DOM retire UNE couche d'entites. */
  const viaDom = (html) => {
    const d = document.createElement('div');
    d.innerHTML = html;
    return (d.querySelector('h1')?.textContent || '').trim();
  };

  it('le DOM seul ne suffit pas : il reste une couche', () => {
    const html = '<h1>God of War : découvrez l&amp;rsquo;ordre de jeu complet</h1>';
    // Exactement la chaine vue a l'ecran, entite en clair dans le champ Titre.
    expect(viaDom(html)).toBe('God of War : découvrez l&rsquo;ordre de jeu complet');
  });

  it('DOM + decodeEntities donne le titre propre', () => {
    const html = '<h1>God of War : découvrez l&amp;rsquo;ordre de jeu complet</h1>';
    expect(decodeEntities(viaDom(html)))
      .toBe('God of War : découvrez l’ordre de jeu complet');
  });

  it('un HTML SIMPLEMENT echappe n\'est pas abime par la seconde passe', () => {
    // La correction ne doit rien casser sur le cas qui marchait deja : apres le
    // DOM il n'y a plus d'entite, et `decodeEntities` n'a rien a faire.
    const html = '<h1>God of War : découvrez l&rsquo;ordre de jeu complet</h1>';
    expect(decodeEntities(viaDom(html)))
      .toBe('God of War : découvrez l’ordre de jeu complet');
  });

  it('une esperluette LITTERALE survit aux deux passes', () => {
    // Le vrai risque d'un second decodage : abimer un titre qui contient « & ».
    // `&` seul n'est pas une entite, il traverse intact.
    const html = '<h1>Marks &amp; Spencer : le comparatif</h1>';
    expect(decodeEntities(viaDom(html))).toBe('Marks & Spencer : le comparatif');
  });

  it('un chevron ne perd pas la fin du titre', () => {
    // Raison pour laquelle c'est `decodeEntities` et non `htmlToText` : passer un
    // titre par innerHTML lui ferait perdre « <10 kW » en silence.
    expect(decodeEntities('Comparatif &lt;10 kW')).toBe('Comparatif <10 kW');
  });
});
