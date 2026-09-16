import { constatFaq, FAQ_MIN_QUESTIONS, FAQ_MAX_QUESTIONS } from './faq';

const accordeon = (n) => Array.from({ length: n }, (_, i) =>
  `<details><summary>Question ${i + 1} ?</summary><p>Réponse ${i + 1}.</p></details>`).join('');

describe('constatFaq', () => {
  // Le cas qui a motivé la mesure : quatre articles publiés SANS FAQ en
  // septembre 2026, sur des refontes complètes, sans que rien ne le signale.
  it('dit ABSENTE sur un article sans FAQ', () => {
    const html = '<h2>Les ratios à surveiller</h2><p>Du texte.</p><h2>La trésorerie</h2><p>Du texte.</p>';
    expect(constatFaq(html)).toMatchObject({ presente: false, questions: 0 });
  });

  it('compte les questions d\'une FAQ en accordéon', () => {
    const html = `<h2>Intro</h2><p>Texte.</p><h2>FAQ</h2>${accordeon(5)}`;
    const c = constatFaq(html);
    expect(c.presente).toBe(true);
    expect(c.questions).toBe(5);
    expect(c.tropCourte).toBe(false);
    expect(c.tropLongue).toBe(false);
  });

  it('compte une FAQ en titres H3, pas seulement en accordéon', () => {
    const html = '<h2>Questions fréquentes</h2>'
      + '<h3>Combien ça coûte ?</h3><p>Environ 40 €.</p>'
      + '<h3>Quel délai ?</h3><p>Deux semaines.</p>'
      + '<h3>Pour qui ?</h3><p>Les artisans.</p>'
      + '<h3>Où se renseigner ?</h3><p>En chambre de métiers.</p>';
    expect(constatFaq(html)).toMatchObject({ presente: true, questions: 4, tropCourte: false });
  });

  it('signale une FAQ trop courte sous le plancher du skill', () => {
    const html = `<h2>FAQ</h2>${accordeon(FAQ_MIN_QUESTIONS - 1)}`;
    expect(constatFaq(html)).toMatchObject({ presente: true, tropCourte: true, tropLongue: false });
  });

  it('signale une FAQ trop longue au-dessus du plafond du skill', () => {
    const html = `<h2>FAQ</h2>${accordeon(FAQ_MAX_QUESTIONS + 1)}`;
    expect(constatFaq(html)).toMatchObject({ presente: true, tropCourte: false, tropLongue: true });
  });

  // Un titre « FAQ » sans aucune question n'est pas une FAQ : l'annoncer présente
  // enverrait le rédacteur chercher ce qui n'existe pas.
  it('ne compte pas un titre FAQ orphelin comme une FAQ', () => {
    expect(constatFaq('<h2>Introduction</h2><p>Texte.</p><h2>FAQ</h2>')).toMatchObject({ presente: false });
  });

  it('ne plante pas sur une entrée vide', () => {
    expect(constatFaq('')).toMatchObject({ presente: false, questions: 0 });
    expect(constatFaq()).toMatchObject({ presente: false, questions: 0 });
  });

  // Les bornes viennent du skill d'équipe « TL;DR, FAQ & maillage interne »
  // (« 4-6 questions ») : la consigne du prompt et la mesure lisent le même
  // littéral, sinon on signalerait une FAQ qu'on n'a jamais demandée.
  it('porte les bornes du skill d\'équipe', () => {
    expect(FAQ_MIN_QUESTIONS).toBe(4);
    expect(FAQ_MAX_QUESTIONS).toBe(6);
  });
});
