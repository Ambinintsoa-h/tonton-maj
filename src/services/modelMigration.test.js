/* eslint-env jest */
/**
 * Bascule Sonnet 5 — verrous contre les DEUX pannes silencieuses de cette chaîne.
 *
 * Le corps de requête est reconstruit champ par champ à trois endroits (client,
 * proxy API, proxy streaming). Un paramètre absent d'une seule de ces listes est
 * perdu SANS ERREUR. Et un modèle absent de `MODEL_CASCADE` (proxy.js) retombe
 * SANS ERREUR sur Haiku : les articles seraient générés par le mauvais modèle,
 * sans qu'aucun test ni aucun log ne le signale. D'où ces assertions.
 */
import fs from 'fs';
import path from 'path';
import { selectModel, callClaudeStream } from './agent';

const proxySrc = () => fs.readFileSync(path.join(__dirname, '..', '..', 'proxy.js'), 'utf8');
// `TOKEN_PRICING_FALLBACK` n'est pas exporté — on vérifie sur le texte source
// plutôt que d'élargir la surface publique du module pour la commodité d'un test.
const agentSrc    = () => fs.readFileSync(path.join(__dirname, 'agent.js'), 'utf8');
const settingsSrc = () => fs.readFileSync(path.join(__dirname, '..', 'store', 'slices', 'settingsSlice.js'), 'utf8');

describe('modèle utilisé pour générer les articles', () => {
  test('la génération passe par Sonnet 5', () => {
    expect(selectModel('update_generation')).toBe('claude-sonnet-5');
  });

  test("l'extraction de mots-clés reste sur Haiku (tâche courte, pas de raison de payer plus)", () => {
    expect(selectModel('query_extraction')).toBe('claude-haiku-4-5');
  });

  test('PANNE SILENCIEUSE — le modèle généré est dans la liste blanche du proxy', () => {
    // Sans cette ligne dans MODEL_CASCADE, `MODEL_CASCADE.includes(model)` est
    // faux et le proxy retombe sur MODEL_FALLBACK (Haiku) sans le dire.
    expect(proxySrc()).toContain(`'${selectModel('update_generation')}'`);
  });
});

describe('tarifs — le suivi de coûts ne doit pas mentir', () => {
  test('Sonnet 5 est tarifé des deux côtés (repli codé ET valeurs par défaut du store)', () => {
    expect(agentSrc()).toMatch(/'claude-sonnet-5':\s*\{\s*input:\s*3\.00,\s*output:\s*15\.00\s*\}/);
    expect(settingsSrc()).toMatch(/'claude-sonnet-5':\s*\{\s*input:\s*3\.00,\s*output:\s*15\.00\s*\}/);
  });

  test('Haiku 4.5 est à 1.00/5.00 — 0.80/4.00 sous-estimait la facture', () => {
    expect(agentSrc()).toMatch(/'claude-haiku-4-5':\s*\{\s*input:\s*1\.00,\s*output:\s*5\.00\s*\}/);
    expect(settingsSrc()).toMatch(/'claude-haiku-4-5':\s*\{\s*input:\s*1\.00,\s*output:\s*5\.00\s*\}/);
  });
});

describe('PANNE SILENCIEUSE — `thinking` doit traverser toute la chaîne', () => {
  test('le client transmet `thinking` dans le corps envoyé au proxy', async () => {
    let corps = null;
    global.fetch = jest.fn(async (_url, init) => {
      corps = JSON.parse(init.body);
      return { ok: false, status: 500, text: async () => 'stop' };  // on n'a besoin que du corps
    });
    await callClaudeStream(
      { system: 's', messages: [{ role: 'user', content: 'x' }], model: 'claude-sonnet-5', thinking: { type: 'disabled' } },
      () => {},
    ).catch(() => {});
    expect(corps).not.toBeNull();
    expect(corps.thinking).toEqual({ type: 'disabled' });
    expect(corps.model).toBe('claude-sonnet-5');
  });

  test('le proxy recopie `thinking` sur la voie STREAMING (celle réellement empruntée)', () => {
    const s = proxySrc();
    expect(s).toMatch(/const \{ system, messages, max_tokens = 32000, model, thinking, output_config \} = req\.body;/);
    expect(s).toMatch(/if \(thinking\) requestBody\.thinking = thinking;/);
  });

  test('le proxy recopie `thinking` sur les voies non streaming', () => {
    // Deux constructeurs (clé API et OAuth) partagent la même ligne.
    expect((proxySrc().match(/if \(bodyObj\.thinking\) requestBody\.thinking = bodyObj\.thinking;/g) || []).length).toBe(2);
  });
});
