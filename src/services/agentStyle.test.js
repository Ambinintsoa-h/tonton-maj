/* eslint-env jest */
/**
 * agentStyle.test.js — la passe de style doit chiffrer son coût.
 *
 * Trouvé en testant en réel (25/08/2026) : runStyleFixAgent renvoyait
 * `tokenUsage: acc` SANS `costUsd` — fmtUsd(undefined) affiche "$0.0000" à
 * l'écran quel que soit le coût réel. Un article traité en entier (audit,
 * génération, obsolescence, style) affichait un total final de $0.0000 alors
 * que ~44 000 tokens avaient réellement été facturés.
 */
import { runStyleFixAgent } from './agentStyle';

jest.mock('./agent', () => {
  const actual = jest.requireActual('./agent');
  return { ...actual, callClaudeWithProgress: jest.fn() };
});

// eslint-disable-next-line import/first
import { callClaudeWithProgress } from './agent';

const FINDING = {
  id: 'verbes',
  exemples: [{ terme: 'offre', extrait: 'Ce VPN offre une bonne protection.' }],
};

describe('runStyleFixAgent — costUsd', () => {
  beforeEach(() => { callClaudeWithProgress.mockReset(); });

  test('calcule costUsd avec le tarif fourni (jamais undefined)', async () => {
    callClaudeWithProgress.mockResolvedValue({
      text: '{"propositions":[]}',
      usage: { model: 'claude-haiku-4-5', input_tokens: 1000, output_tokens: 500 },
    });
    const pricing = { 'claude-haiku-4-5': { input: 1, output: 5 } };
    const { tokenUsage } = await runStyleFixAgent({ findings: [FINDING], modelPricing: pricing });
    // (1000/1e6)*1 + (500/1e6)*5 = 0.001 + 0.0025 = 0.0035
    expect(tokenUsage.costUsd).toBeCloseTo(0.0035, 6);
  });

  test('sans modelPricing fourni, retombe sur le tarif par défaut (pas 0, pas undefined)', async () => {
    callClaudeWithProgress.mockResolvedValue({
      text: '{"propositions":[]}',
      usage: { model: 'claude-haiku-4-5', input_tokens: 1000, output_tokens: 500 },
    });
    const { tokenUsage } = await runStyleFixAgent({ findings: [FINDING] });
    expect(tokenUsage.costUsd).not.toBeUndefined();
    expect(tokenUsage.costUsd).toBeGreaterThan(0);
  });

  test('aucune occurrence IA → aucun appel, tokenUsage null (pas de costUsd fantôme)', async () => {
    const { tokenUsage } = await runStyleFixAgent({ findings: [] });
    expect(tokenUsage).toBeNull();
    expect(callClaudeWithProgress).not.toHaveBeenCalled();
  });
});
