// Tests de la normalisation FAQ → accordéon (normalizeFaqToAccordion),
// de la détection des formats dans l'éditeur (getQAGroups) et du collage
// au caret (insertFaqHtmlAtCaret — presse-papiers de blocs).
import { normalizeFaqToAccordion, findFaqBlock, getQAGroups, insertFaqHtmlAtCaret } from './faq';

// Ancien format WordPress : <p><b>Question ?</b></p><br><p>réponse</p>
const OLD_FORMAT = `<p>Intro article</p><h2>FAQ toit en bac acier</h2><br><p><b>Quelle est la durée de vie moyenne d’une toiture en bac acier ?</b></p><br><p>La durée de vie varie selon le type de matériau.</p><br><p><b>Combien coûte une toiture en bac acier en 2026 ?</b></p><br><p>En 2026, le coût d’installation se situe entre 5,50 et 16,50 EUR par m².</p><br><p><b>Le bac acier nécessite-t-il un entretien particulier ?</b></p><br><p>Non, très peu exigeante en entretien.</p>`;

describe('normalizeFaqToAccordion', () => {
  test('ancien format <p><b>Q</b></p> + <br> → un <details> par question, sans <br> parasites', () => {
    const out = normalizeFaqToAccordion(OLD_FORMAT);
    expect((out.match(/<details>/g) || []).length).toBe(3);
    expect((out.match(/<summary>/g) || []).length).toBe(3);
    // Le titre FAQ est conservé, l'intro hors FAQ est intacte
    expect(out).toContain('<h2>FAQ toit en bac acier</h2>');
    expect(out).toContain('<p>Intro article</p>');
    // Les questions sont dans les <summary> (sans le <b>)
    expect(out).toContain('<summary>Quelle est la durée de vie moyenne d’une toiture en bac acier ?</summary>');
    // Les réponses sont dans les <details>
    expect(out).toContain('La durée de vie varie selon le type de matériau.');
    // Plus de <br> parasites après le titre FAQ
    expect(out.split('</h2>')[1]).not.toContain('<br>');
  });

  test('format h3/p (généré par TONTON) → converti en <details>', () => {
    const input = `<h2>Questions fréquentes</h2><h3>Q1 ?</h3><p>Réponse 1</p><h3>Q2 ?</h3><p>Réponse 2</p><ul><li>point</li></ul>`;
    const out = normalizeFaqToAccordion(input);
    expect((out.match(/<details>/g) || []).length).toBe(2);
    expect(out).toContain('<summary>Q1 ?</summary>');
    // La liste qui suit la réponse 2 reste dans le 2e details
    expect(out).toContain('<ul><li>point</li></ul>');
  });

  test('déjà en <details> → idempotent (inchangé)', () => {
    const input = `<h2>FAQ</h2><details><summary>Q ?</summary><p>A</p></details>`;
    expect(normalizeFaqToAccordion(input)).toBe(input);
  });

  test('marques de diff (<mark>/<ins>) préservées dans questions et réponses', () => {
    const input = `<h2>FAQ</h2><p><b>Q avec <mark class="updated-content">2026</mark> ?</b></p><br><p>Réponse <ins class="added-content">ajoutée</ins>.</p>`;
    const out = normalizeFaqToAccordion(input);
    expect(out).toContain('updated-content');
    expect(out).toContain('added-content');
    expect((out.match(/<details>/g) || []).length).toBe(1);
  });

  test('pas de FAQ → HTML inchangé', () => {
    const input = `<h2>Section</h2><p>Texte</p>`;
    expect(normalizeFaqToAccordion(input)).toBe(input);
  });

  test('question en <strong> également reconnue', () => {
    const input = `<h2>FAQ</h2><p><strong>Ma question ?</strong></p><p>Ma réponse.</p>`;
    const out = normalizeFaqToAccordion(input);
    expect(out).toContain('<summary>Ma question ?</summary>');
  });
});

describe('getQAGroups — détection dans l’éditeur', () => {
  test('reconnaît le format p>b (ancien WP) pour les barres de manipulation', () => {
    const c = document.createElement('div');
    c.innerHTML = OLD_FORMAT;
    const block = findFaqBlock(c);
    expect(block).not.toBeNull();
    const qa = getQAGroups(block);
    expect(qa.format).toBe('pb');
    expect(qa.groups.length).toBe(3);
    expect(qa.groups[0].question.textContent).toContain('durée de vie');
  });

  test('reconnaît le format details (FAQ normalisées)', () => {
    const c = document.createElement('div');
    c.innerHTML = `<h2>FAQ</h2><details><summary>Q1 ?</summary><p>A1</p></details><details><summary>Q2 ?</summary><p>A2</p></details>`;
    const qa = getQAGroups(findFaqBlock(c));
    expect(qa.format).toBe('details');
    expect(qa.groups.length).toBe(2);
  });

  test('stratégie 3 : titre SANS mot-clé « faq » + suite de <details> → bloc détecté avec son titre', () => {
    const c = document.createElement('div');
    c.innerHTML = `<p>Corps</p><h2>Les questions des lecteurs</h2><details><summary>Q1 ?</summary><p>A1</p></details><details><summary>Q2 ?</summary><p>A2</p></details>`;
    const block = findFaqBlock(c);
    expect(block).not.toBeNull();
    // Le titre (texte libre) fait partie du bloc → sélectionnable/coupable avec la FAQ
    expect(block.heading?.textContent).toBe('Les questions des lecteurs');
    expect(block.nodes.length).toBe(3);
    const qa = getQAGroups(block);
    expect(qa.format).toBe('details');
    expect(qa.groups.length).toBe(2);
  });

  test('stratégie 3 : <details> sans titre (FAQ décapitée) → bloc détecté, toutes les questions', () => {
    const c = document.createElement('div');
    c.innerHTML = `<p>Intro</p><details><summary>Q1 ?</summary><p>A1</p></details><details><summary>Q2 ?</summary><p>A2</p></details>`;
    const block = findFaqBlock(c);
    expect(block).not.toBeNull();
    expect(block.heading).toBeNull();
    const qa = getQAGroups(block);
    expect(qa.format).toBe('details');
    expect(qa.groups.length).toBe(2); // slice(0) : la 1re question n'est pas avalée comme « titre »
  });
});

describe('insertFaqHtmlAtCaret — collage au caret', () => {
  // Paire de diff en attente : le collage ne doit JAMAIS s'insérer entre le
  // <del> et le <mark> (leur adjacence porte les boutons Accepter/Rejeter).
  const setup = () => {
    const c = document.createElement('div');
    c.innerHTML =
      '<p>Intro</p>'
      + '<del class="deleted-content"><h2>Ancien</h2></del>'
      + '<mark class="updated-content"><h2>Nouveau</h2></mark>'
      + '<p>Fin</p>';
    document.body.appendChild(c);
    return c;
  };
  const setCaret = (node, offset) => {
    const r = document.createRange();
    r.setStart(node, offset);
    r.collapse(true);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
  };

  afterEach(() => { document.body.innerHTML = ''; window.getSelection().removeAllRanges(); });

  test('caret dans le <del> d\'une paire → collé APRÈS la paire entière', () => {
    const c = setup();
    setCaret(c.children[1].querySelector('h2').firstChild, 2); // dans « Ancien »
    insertFaqHtmlAtCaret(c, '<p>X</p>');
    expect(Array.from(c.children).map(e => e.tagName)).toEqual(['P', 'DEL', 'MARK', 'P', 'P']);
    expect(c.children[3].textContent).toBe('X');
  });

  test('caret entre les deux moitiés de la paire → collé AVANT la paire entière', () => {
    const c = setup();
    setCaret(c, 2); // offset 2 = entre <del> et <mark>
    insertFaqHtmlAtCaret(c, '<p>Y</p>');
    expect(Array.from(c.children).map(e => e.tagName)).toEqual(['P', 'P', 'DEL', 'MARK', 'P']);
    expect(c.children[1].textContent).toBe('Y');
  });

  test('sans caret dans l\'article → collé en fin d\'article', () => {
    const c = setup();
    window.getSelection().removeAllRanges();
    const first = insertFaqHtmlAtCaret(c, '<p>Z</p>');
    expect(c.lastElementChild.textContent).toBe('Z');
    expect(first).toBe(c.lastElementChild);
  });
});
