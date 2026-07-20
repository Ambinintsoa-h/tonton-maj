// Tests de findFaqBlock — un marqueur tt-faq résiduel ne détourne pas la barre FAQ
/* eslint-env jest */
import { findFaqBlock, dedupeFaqHeading } from './faq';

const build = (html) => { const d = document.createElement('div'); d.innerHTML = html; return d; };

describe('findFaqBlock — ins.tt-faq sans vraie FAQ ignoré', () => {
  it('ignore un ins.tt-faq qui ne contient que des puces (TL;DR) et trouve la vraie FAQ par heading', () => {
    const container = build(
      '<p>Intro.</p>'
      + '<ins class="added-content tt-faq"><ul><li>Prix 2026</li></ul></ins>'
      + '<h2>FAQ — Questions fréquentes</h2>'
      + '<details><summary>Q1</summary><p>R1</p></details>'
      + '<details><summary>Q2</summary><p>R2</p></details>'
    );
    const block = findFaqBlock(container);
    expect(block).not.toBeNull();
    expect(block.heading?.textContent).toContain('FAQ');
    // le bloc retourné n'est PAS l'ins du TL;DR
    const ins = container.querySelector('ins');
    expect(block.nodes.includes(ins)).toBe(false);
  });

  it('retient un ins.tt-faq qui contient un accordéon <details>', () => {
    const container = build(
      '<p>Intro.</p>'
      + '<ins class="added-content tt-faq"><h2>Vos questions</h2><details><summary>Q</summary><p>R</p></details></ins>'
    );
    const block = findFaqBlock(container);
    expect(block).not.toBeNull();
    expect(block.kind).toBe('container');
    expect(block.root).toBe(container.querySelector('ins'));
  });

  it('retient un conteneur d\'auteur div.schema-faq (comportement historique inchangé)', () => {
    const container = build('<p>Intro.</p><div class="schema-faq"><p>Q : a ? R : b.</p></div>');
    const block = findFaqBlock(container);
    expect(block).not.toBeNull();
    expect(block.kind).toBe('container');
    expect(block.root).toBe(container.querySelector('.schema-faq'));
  });
});

describe('dedupeFaqHeading — mention FAQ doublée dans le titre', () => {
  it('retire un « (FAQ) » final quand le titre commence déjà par FAQ', () => {
    const c = build('<h2>FAQ — Questions fréquentes (FAQ)</h2><p>t</p>');
    dedupeFaqHeading(c);
    expect(c.querySelector('h2').textContent).toBe('FAQ — Questions fréquentes');
  });

  it('retire la parenthèse même quand elle vit dans une balise interne (mark de diff)', () => {
    const c = build('<h2>FAQ — <mark class="updated-content">Questions fréquentes (FAQ)</mark></h2>');
    dedupeFaqHeading(c);
    expect(c.querySelector('h2').textContent).toBe('FAQ — Questions fréquentes');
    expect(c.querySelector('mark')).not.toBeNull(); // la balise de diff survit
  });

  it('conserve « (FAQ) » quand il n\'est PAS redondant', () => {
    const c = build('<h2>Vos questions les plus posées (FAQ)</h2>');
    dedupeFaqHeading(c);
    expect(c.querySelector('h2').textContent).toBe('Vos questions les plus posées (FAQ)');
  });

  it('ne touche pas aux autres titres', () => {
    const c = build('<h2>Comparatif 2026</h2><h3>FAQ</h3>');
    dedupeFaqHeading(c);
    expect(c.querySelector('h2').textContent).toBe('Comparatif 2026');
    expect(c.querySelector('h3').textContent).toBe('FAQ');
  });
});
