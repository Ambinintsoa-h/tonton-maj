// Tests de la normalisation FAQ → accordéon (normalizeFaqToAccordion)
// et de la détection des formats dans l'éditeur (getQAGroups).
import { normalizeFaqToAccordion, findFaqBlock, getQAGroups } from './faq';

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
});
