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
  findBlockForPassage, LOCATABLE_BLOCK_SEL, replacePassageInDom,
  highlightPassage, FOCUS_ATTR, FOCUS_CLASS,
} from './locatePassage';
import { exportAsHtml } from './export';

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

// ── Appliquer une correction de style sur une phrase QUI PORTE DU BALISAGE ─────
// C'est ce qui bloquait les corrections des phrases de plus de 20 mots : elles
// sont les plus longues, donc les plus susceptibles de contenir un <em> ou un
// <br>, et `innerHTML.includes(extraitNu)` ne les trouvait jamais.
describe('replacePassageInDom — corriger malgré les balises inline', () => {
  const COURTE = 'Le prix moyen atteint 60 EUR.';
  const CORRIGEE = 'Le prix moyen atteint 60 EUR au metre carre.';

  test('remplace un passage coupé par un `<em>`', () => {
    const root = dom(`<p>Le prix <em>moyen</em> atteint 60 EUR.</p>`);
    expect(replacePassageInDom(root, COURTE, CORRIGEE)).toEqual({ ok: true });
    expect(root.textContent).toBe(CORRIGEE);
    expect(root.querySelector('em')).toBeNull();   // balise vidée, donc retirée
  });

  test('remplace un passage coupé par un `<br>`', () => {
    const root = dom('<p>Le prix moyen<br>atteint 60 EUR.</p>');
    expect(replacePassageInDom(root, COURTE, CORRIGEE)).toEqual({ ok: true });
    expect(root.textContent).toBe(CORRIGEE);
    expect(root.querySelector('br')).toBeNull();   // le <br> était DANS la plage
  });

  test('RÈGLE 8 — un passage contenant un LIEN est REFUSÉ, jamais mutilé', () => {
    // Supprimer le lien serait irréversible et invisible : ce chemin ne passe par
    // aucun verrou liens.
    const html = '<p>Le prix <a href="/prix">moyen</a> atteint 60 EUR.</p>';
    const root = dom(html);
    expect(replacePassageInDom(root, COURTE, CORRIGEE)).toEqual({ ok: false, reason: 'protege' });
    expect(root.innerHTML).toBe(html);             // rien n'a bougé
  });

  test('une IMAGE dans la plage est protégée de la même façon', () => {
    const root = dom('<p>Le prix moyen <img src="a.jpg" alt="x"> atteint 60 EUR.</p>');
    expect(replacePassageInDom(root, COURTE, CORRIGEE).reason).toBe('protege');
    expect(root.querySelector('img')).not.toBeNull();
  });

  test('le texte AUTOUR du passage est preservé', () => {
    const root = dom(`<p>Avant. Le prix <em>moyen</em> atteint 60 EUR. Apres.</p>`);
    expect(replacePassageInDom(root, COURTE, CORRIGEE).ok).toBe(true);
    expect(root.textContent).toBe(`Avant. ${CORRIGEE} Apres.`);
  });

  test('le gras HORS du passage remplacé survit', () => {
    const root = dom('<p><strong>Titre.</strong> Le prix <em>moyen</em> atteint 60 EUR.</p>');
    expect(replacePassageInDom(root, COURTE, CORRIGEE).ok).toBe(true);
    expect(root.querySelector('strong')).not.toBeNull();
    expect(root.querySelector('strong').textContent).toBe('Titre.');
  });

  test('passage absent → introuvable, et le DOM est intact', () => {
    const html = '<p>Rien de tel ici.</p>';
    const root = dom(html);
    expect(replacePassageInDom(root, COURTE, CORRIGEE)).toEqual({ ok: false, reason: 'introuvable' });
    expect(root.innerHTML).toBe(html);
  });

  test('entrées dégénérées → introuvable, jamais une exception', () => {
    expect(replacePassageInDom(null, 'a', 'b').ok).toBe(false);
    expect(replacePassageInDom(dom('<p>x</p>'), '', 'b').ok).toBe(false);
    expect(replacePassageInDom(dom('<p>x</p>'), 'x', null).ok).toBe(false);
  });
});

// ── Surligner LE MOT, pas tout le paragraphe ──────────────────────────────────
// Le clic sur un pattern amenait au bon endroit mais entourait le bloc entier :
// sur un paragraphe de 60 mots, il restait à chercher quoi remplacer.
describe('highlightPassage — le terme fautif est surligné', () => {
  const PHRASE = 'La toiture en bac acier reste competitive face aux tuiles.';
  const P = `<p>Un premier paragraphe sans rapport. ${PHRASE}</p>`;

  test('surligne le TERME quand il est connu, pas la phrase entière', () => {
    const root = dom(P);
    const { el, cleanup } = highlightPassage(root, PHRASE, 'reste');
    expect(el).not.toBeNull();
    expect(el.tagName).toBe('MARK');
    expect(el.textContent).toBe('reste');            // le mot seul
    expect(el.getAttribute(FOCUS_ATTR)).toBe('1');
    expect(el.className).toBe(FOCUS_CLASS);
    cleanup();
  });

  test('sans terme, surligne le passage repéré', () => {
    const root = dom(P);
    const { el, cleanup } = highlightPassage(root, PHRASE);
    expect(el.textContent).toBe(PHRASE);
    cleanup();
  });

  test('le terme est cherché DANS le passage — pas ailleurs dans le bloc', () => {
    // « reste » apparaît AVANT dans le bloc : on doit surligner celui de la phrase
    // repérée, sinon on envoie le rédacteur sur la mauvaise occurrence.
    const root = dom(`<p>Il reste un point. ${PHRASE}</p>`);
    const { el, cleanup } = highlightPassage(root, PHRASE, 'reste');
    const avant = root.textContent.indexOf('Il reste');
    const marque = root.textContent.indexOf(el.textContent, avant + 8);
    expect(marque).toBeGreaterThan(avant);
    cleanup();
  });

  test('cleanup RESTAURE le texte exactement — aucun <mark> oublié', () => {
    const root = dom(P);
    const avant = root.innerHTML;
    const { cleanup } = highlightPassage(root, PHRASE, 'reste');
    expect(root.querySelector('mark')).not.toBeNull();
    cleanup();
    expect(root.querySelector('mark')).toBeNull();
    expect(root.textContent).toBe(dom(avant).textContent);
  });

  test('cleanup est idempotent — le rappeler ne casse rien', () => {
    const root = dom(P);
    const { cleanup } = highlightPassage(root, PHRASE, 'reste');
    cleanup(); cleanup();
    expect(root.querySelector('mark')).toBeNull();
  });

  test('fonctionne malgré une balise inline dans la phrase', () => {
    const root = dom('<p>La toiture en <em>bac acier</em> reste competitive face aux tuiles.</p>');
    const { el, cleanup } = highlightPassage(root, PHRASE, 'reste');
    expect(el).not.toBeNull();
    expect(el.textContent).toBe('reste');
    cleanup();
  });

  test('CEINTURE — un surlignage capté par un autosave ne part JAMAIS à la publication', () => {
    const root = dom(P);
    highlightPassage(root, PHRASE, 'reste');          // volontairement SANS cleanup
    const publie = exportAsHtml(root.innerHTML);
    expect(publie).not.toContain(FOCUS_ATTR);
    expect(publie).not.toContain(FOCUS_CLASS);
    expect(publie).toContain('reste');                // le TEXTE survit
  });

  test('passage introuvable ou racine invalide → aucun surlignage, aucune exception', () => {
    expect(highlightPassage(dom('<p>Rien.</p>'), 'Autre chose entierement').el).toBeNull();
    expect(highlightPassage(null, 'x').el).toBeNull();
    expect(() => highlightPassage(dom('<p>x</p>'), '').cleanup()).not.toThrow();
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
