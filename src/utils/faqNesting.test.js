// Régression : additions <ins> imbriquées (poupées russes) → plus de tableau
// marqué FAQ, plus de TL;DR séparé de ses puces, plus de <ins> vides (bug 20/07).
// La fixture est la donnée RÉELLE d'une analyse TONTON (originalContent + diff)
// qui déclenchait le défaut : plusieurs additions ancrées sur du texte ajouté
// par une addition précédente → applyAllDiffs les nichait les unes dans les autres.
/* eslint-env jest */
import { applyAllDiffs, moveFaqToEnd, applyAddition } from './diff';
import { normalizeFaqToAccordion } from './faq';
import fixture from './faqNesting.fixture.json';

const build = (html) => { const d = document.createElement('div'); d.innerHTML = html; return d; };

describe('additions imbriquées — pipeline complet sur donnée réelle', () => {
  const assembled = applyAllDiffs(fixture.originalContent, fixture.diff).html;
  const final = normalizeFaqToAccordion(moveFaqToEnd(assembled));
  const d = build(final);

  it('assemble les additions en SŒURS, jamais imbriquées', () => {
    expect(d.querySelectorAll('ins.added-content ins.added-content')).toHaveLength(0);
  });

  it('aucun marqueur tt-faq sur un bloc sans vraie FAQ (ex. le tableau)', () => {
    const bad = [...d.querySelectorAll('ins.tt-faq')].filter(
      el => !el.querySelector('details') && ![...el.querySelectorAll('h1,h2,h3,h4')].some(h => /faq|questions fr/i.test(h.textContent))
    );
    expect(bad).toHaveLength(0);
  });

  it('aucun <ins> spécial vide (résidu de découpe)', () => {
    const empties = [...d.querySelectorAll('ins.tt-faq, ins.tt-tldr')].filter(el => !el.textContent.trim());
    expect(empties).toHaveLength(0);
  });

  it('le TL;DR garde ses puces juste sous son titre', () => {
    const resume = [...d.querySelectorAll('h2')].find(h => /résumé de l'article/i.test(h.textContent));
    expect(resume).toBeTruthy();
    expect(resume.nextElementSibling?.tagName).toBe('UL');
    expect(resume.nextElementSibling.textContent).toMatch(/Prix abris 2026/);
  });

  it('le tableau comparatif reste dans sa propre section (pas dans la FAQ ni le TL;DR)', () => {
    const table = d.querySelector('table');
    expect(table).toBeTruthy();
    expect(table.closest('ins.tt-faq')).toBeNull();
    expect(table.closest('ins.tt-tldr')).toBeNull();
  });

  it('la vraie FAQ (accordéon) est le dernier bloc d\'addition', () => {
    const faq = [...d.querySelectorAll('ins.tt-faq')].find(el => el.querySelector('details'));
    expect(faq).toBeTruthy();
    expect(faq.querySelectorAll('details').length).toBeGreaterThanOrEqual(5);
  });
});

describe('applyAddition — une addition ne s\'insère jamais DANS une autre', () => {
  it('ressort de l\'<ins> englobant quand l\'anchor est du texte déjà ajouté', () => {
    // 1re addition : section A. 2e addition ancrée sur une phrase DE la section A.
    let html = '<p>Texte original.</p>';
    html = applyAddition(html, 'Texte original.', '<h2>Section A</h2><p>Phrase ajoutée par A.</p>').html;
    const out = applyAddition(html, 'Phrase ajoutée par A.', '<h2>Section B</h2><p>Contenu B.</p>').html;
    const d = build(out);
    // B ne doit pas être niché dans l'<ins> de A
    expect(d.querySelectorAll('ins.added-content ins.added-content')).toHaveLength(0);
    expect(d.querySelectorAll('ins.added-content').length).toBe(2);
  });
});
