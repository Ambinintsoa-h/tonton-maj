// Tests de findFaqBlock — un marqueur tt-faq résiduel ne détourne pas la barre FAQ
/* eslint-env jest */
import { findFaqBlock } from './faq';

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
