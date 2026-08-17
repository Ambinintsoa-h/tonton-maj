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
import axios from 'axios';
import { selectModel, callClaudeStream, callClaude, extractTextBlocks } from './agent';

jest.mock('axios');

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

  // ⚠️ Ce test s'intitulait « la voie STREAMING (celle réellement empruntée) ».
  // C'ÉTAIT FAUX, et c'est ce qui a laissé passer la panne : en production le
  // proxy n0c bufferise le SSE, `callClaudeStream` lève STREAM_UNAVAILABLE et
  // TOUT retombe sur le transport job + polling. Les tests verrouillaient donc
  // précisément le chemin qui ne sert pas.
  test('le proxy recopie `thinking` sur la voie streaming (secours en production)', () => {
    const s = proxySrc();
    expect(s).toMatch(/const \{ system, messages, max_tokens = 32000, model, thinking, output_config \} = req\.body;/);
    expect(s).toMatch(/if \(thinking\) requestBody\.thinking = thinking;/);
  });

  test('le proxy recopie `thinking` sur les voies non streaming', () => {
    // Deux constructeurs (clé API et OAuth) partagent la même ligne.
    expect((proxySrc().match(/if \(bodyObj\.thinking\) requestBody\.thinking = bodyObj\.thinking;/g) || []).length).toBe(2);
  });

  test('LE CHEMIN DE PRODUCTION — le client transmet `thinking` dans le corps du job', async () => {
    // La voie job + polling est celle qu'emprunte chaque appel en production.
    // `callClaude` filtrait `thinking` hors de sa destructuration, puis
    // `callClaudeViaJob` l'omettait de son corps : deux portes fermées avant même
    // d'atteindre le proxy. Aucun test ne couvrait ce chemin.
    let corpsJob = null;
    axios.post.mockImplementation(async (_url, body) => { corpsJob = body; return { data: { jobId: 'j1' } }; });
    axios.get.mockResolvedValue({ data: { status: 'done', content: [{ type: 'text', text: '{}' }], usage: {} } });

    await callClaude(null, {
      system: 's',
      messages: [{ role: 'user', content: 'x' }],
      model: 'claude-sonnet-5',
      max_tokens: 32000,
      thinking: { type: 'disabled' },
    });

    expect(corpsJob).not.toBeNull();
    expect(corpsJob.thinking).toEqual({ type: 'disabled' });
    expect(corpsJob.model).toBe('claude-sonnet-5');
  });

  test('les routes du proxy ne filtrent plus `thinking` hors de req.body', () => {
    const s = proxySrc();
    // /api/claude et /api/claude-job : la destructuration de req.body EST le filtre.
    expect((s.match(/const \{ system, messages, max_tokens = 4096, model, thinking, output_config \} = req\.body;/g) || []).length).toBe(2);
    // executeClaudeCall doit ensuite le porter jusqu'aux DEUX stratégies.
    expect(s).toMatch(/const executeClaudeCall = async \(\{ system, messages, max_tokens = 4096, model, thinking, output_config \}\)/);
  });
});

describe('CAUSE RACINE — un bloc de raisonnement ne doit plus vider la réponse', () => {
  // Sonnet 5 raisonne par défaut : `content[0]` est alors un bloc `thinking` dont
  // `.text` est undefined. Lu en dur, il rendait '' — et 100 % des audits ont été
  // perdus du 14 au 17/08/2026, chacun facturé trois fois.
  test('le texte est extrait même quand le raisonnement arrive en premier', () => {
    const reponse = [
      { type: 'thinking', thinking: 'Je réfléchis longuement...' },
      { type: 'text', text: '{"ampleur":{"decision":"refonte_totale"}}' },
    ];
    expect(extractTextBlocks(reponse)).toBe('{"ampleur":{"decision":"refonte_totale"}}');
  });

  test('les blocs de texte multiples sont concaténés, le reste ignoré', () => {
    expect(extractTextBlocks([
      { type: 'redacted_thinking', data: 'xxx' },
      { type: 'text', text: '{"a":1,' },
      { type: 'text', text: '"b":2}' },
    ])).toBe('{"a":1,"b":2}');
  });

  test('entrées dégénérées : jamais undefined, toujours une chaîne', () => {
    expect(extractTextBlocks(null)).toBe('');
    expect(extractTextBlocks(undefined)).toBe('');
    expect(extractTextBlocks([{ type: 'thinking', thinking: 'que ça' }])).toBe('');
    expect(extractTextBlocks('déjà du texte')).toBe('déjà du texte');
  });

  test('le proxy ne lit plus content[0].text en dur — sur AUCUNE des deux voies', () => {
    // C'est le vrai correctif : le serveur aplatit la réponse pour le client, donc
    // s'il perd le texte ici, il est perdu partout en aval.
    // Cible la FORME DE CODE (`const text = …content?.[0]?.text`) et non la
    // chaîne nue, qui figure aussi — volontairement — dans le commentaire
    // expliquant la panne juste au-dessus de textFromAnthropic.
    expect(proxySrc()).not.toMatch(/=\s*\w*\.?content\?\.\[0\]\?\.text/);
    // Exactement DEUX appels : la voie clé API et la voie OAuth. Les deux doivent
    // y passer — corriger une seule laissait la panne intacte en production.
    expect((proxySrc().match(/textFromAnthropic\(/g) || []).length).toBe(2);
  });
});
