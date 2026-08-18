/**
 * Formats de FAQ réellement produits par le modèle.
 *
 * Mesuré avant correction : sur sept formes plausibles, DEUX seulement étaient
 * normalisées en accordéon. Les cinq autres restaient en titres bruts dans
 * l'éditeur — la FAQ « ne se mettait pas en forme », sans que rien ne le dise.
 *
 * Les trois causes étaient distinctes, et se re-cassent indépendamment :
 *   • questions écrites au MÊME niveau que le titre de la FAQ ;
 *   • FAQ enfermée dans un <section>/<div> sans classe « faq » ;
 *   • titre hors du vocabulaire reconnu (« Questions et réponses »).
 *
 * Tous les assouplissements sont gardés par le POINT D'INTERROGATION : c'est ce
 * qui empêche de découper en accordéon une section légitime. Les tests I, J et K
 * verrouillent précisément ce garde-fou — les supprimer rouvrirait la porte.
 */
import { normalizeFaqToAccordion } from './faq';

const compte = (html, rx) => (html.match(rx) || []).length;
const normalise = (html) => {
  const out = normalizeFaqToAccordion(html);
  return { out, change: out !== html, details: compte(out, /<details/g), h2: compte(out, /<h2/g) };
};

describe('FAQ — formats que le modèle produit, tous normalisés', () => {
  test('questions en h3 sous un titre h2 (format canonique)', () => {
    const r = normalise('<h2>Intro</h2><p>Texte.</p><h2>FAQ</h2><h3>Combien ça coûte ?</h3><p>30 euros.</p><h3>Quelle épaisseur ?</h3><p>100 mm.</p>');
    expect(r.details).toBe(2);
  });

  test('questions au MÊME niveau que le titre (tout en h2)', () => {
    const r = normalise('<h2>Intro</h2><p>Texte.</p><h2>FAQ</h2><h2>Combien ça coûte ?</h2><p>30 euros.</p><h2>Quelle épaisseur ?</h2><p>100 mm.</p>');
    expect(r.details).toBe(2);
  });

  test('FAQ enfermée dans un <section> sans classe « faq »', () => {
    const r = normalise('<h2>Intro</h2><p>Texte.</p><section><h2>FAQ</h2><h3>Combien ça coûte ?</h3><p>30 euros.</p></section>');
    expect(r.details).toBe(1);
  });

  test('titre « Questions et réponses »', () => {
    expect(normalise('<h2>Intro</h2><p>T.</p><h2>Questions et réponses</h2><h3>Combien ça coûte ?</h3><p>30 euros.</p>').details).toBe(1);
  });

  test('titre « Vos questions les plus courantes »', () => {
    expect(normalise('<h2>Intro</h2><p>T.</p><h2>Vos questions les plus courantes</h2><h3>Combien ça coûte ?</h3><p>30 euros.</p>').details).toBe(1);
  });

  test('titre INVENTÉ par le modèle → détecté par la STRUCTURE (2 questions)', () => {
    const r = normalise('<h2>Intro</h2><p>T.</p><h2>Ce qu\'on nous demande le plus</h2><h3>Combien ça coûte ?</h3><p>30 euros.</p><h3>Quelle épaisseur ?</h3><p>100 mm.</p>');
    expect(r.details).toBe(2);
  });

  test('ancien format WordPress <p><strong>Q ?</strong></p><p>R</p>', () => {
    expect(normalise('<h2>FAQ</h2><p><strong>Combien ça coûte ?</strong></p><p>30 euros.</p>').details).toBe(1);
  });
});

describe('FAQ — le garde-fou du « ? », à ne jamais retirer', () => {
  test('une section légitime à sous-titres n\'est PAS transformée', () => {
    // « Questions à poser à votre artisan » : titre plausible, sous-titres qui ne
    // sont pas des questions. La convertir en accordéon casserait l'article.
    const r = normalise('<h2>Questions à poser à votre artisan</h2><h3>Son assurance</h3><p>Vérifiez la décennale.</p><h3>Ses références</h3><p>Demandez trois chantiers.</p>');
    expect(r.change).toBe(false);
    expect(r.details).toBe(0);
  });

  test('un H2 rédactionnel placé après la FAQ reste DEHORS', () => {
    const r = normalise('<h2>FAQ</h2><h3>Combien ça coûte ?</h3><p>30 euros.</p><h2>Faut-il un pro</h2><p>Oui, pour la garantie décennale.</p>');
    expect(r.details).toBe(1);
    expect(r.h2).toBe(2);
    expect(r.out).toContain('<h2>Faut-il un pro</h2>');
  });

  test('un H2 INTERROGATIF placé après la FAQ reste DEHORS aussi', () => {
    // Le cas piège : il finit par « ? », donc le seul test du point
    // d'interrogation ne suffit pas. C'est le niveau des questions déjà vu
    // (h3 ici) qui en fait une frontière.
    const r = normalise('<h2>FAQ</h2><h3>Combien ça coûte ?</h3><p>30 euros.</p><h2>Faut-il un pro ?</h2><p>Oui, pour la garantie décennale et les normes.</p>');
    expect(r.details).toBe(1);
    expect(r.out).toContain('<h2>Faut-il un pro ?</h2>');
    // Vérification sur le DOM, pas au regex : `[\s\S]*` traverserait le
    // </details> fermant et matcherait un HTML pourtant correct.
    const d = document.createElement('div'); d.innerHTML = r.out;
    const dansUnDetails = Array.from(d.querySelectorAll('details'))
      .some(el => /Faut-il un pro/.test(el.textContent || ''));
    expect(dansUnDetails).toBe(false);
  });

  test('un seul titre interrogatif ne suffit pas à inventer une FAQ', () => {
    // La détection structurelle exige DEUX questions : un article dont un seul
    // H2 est une question n'est pas une FAQ.
    const r = normalise('<h2>Faut-il isoler par le plafond ?</h2><p>Cela dépend de la hauteur disponible sous plafond.</p>');
    expect(r.change).toBe(false);
  });
});
