// Le `reason` généré par l'IA est injecté dans title="…" : il DOIT être échappé
// (<, >, & ) pour ne pas malformer le HTML ni fausser le comptage de balises
// (escapeEnclosingIns) lors d'une addition ultérieure.
/* eslint-env jest */
import { applyDiff, applyAddition, escapeAttr } from './diff';

describe('escapeAttr', () => {
  it('échappe &, <, > et " dans l\'ordre correct', () => {
    expect(escapeAttr('a & b < c > d "e"')).toBe('a &amp; b &lt; c &gt; d &quot;e&quot;');
  });
  it('chaîne vide / null → chaîne vide', () => {
    expect(escapeAttr('')).toBe('');
    expect(escapeAttr(null)).toBe('');
  });
});

describe('applyDiff — reason échappé dans title', () => {
  it('n\'injecte jamais de < brut depuis le reason', () => {
    const { html } = applyDiff('<p>Le score est bas.</p>', 'Le score est bas.', 'Le score est correct.', 'score < 3/10 → refonte');
    expect(html).toContain('title="score &lt; 3/10');
    expect(html).not.toContain('title="score < 3/10');
  });
});

describe('applyAddition — un reason contenant "<ins" ne casse pas escapeEnclosingIns', () => {
  it('l\'addition suivante s\'insère au bon endroit malgré un <ins littéral dans un title', () => {
    // 1re modif : reason contient littéralement "<ins" (cas pathologique)
    let html = applyDiff('<p>Phrase une.</p><p>Phrase deux.</p>', 'Phrase une.', 'Phrase une bis.', 'retire le <ins parasite').html;
    // 2e : addition ancrée sur la 2e phrase (hors de tout vrai <ins>)
    const out = applyAddition(html, 'Phrase deux.', '<h2>Nouvelle section</h2><p>Contenu.</p>').html;
    const d = document.createElement('div'); d.innerHTML = out;
    // l'addition ne doit PAS être nichée dans le <mark> de la 1re modif
    expect(d.querySelectorAll('mark ins, del ins')).toHaveLength(0);
    expect(d.querySelector('ins.added-content h2').textContent).toBe('Nouvelle section');
  });
});
