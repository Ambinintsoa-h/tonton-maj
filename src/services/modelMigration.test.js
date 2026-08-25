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
import {
  selectModel, MODEL_PASSES, callClaudeStream, callClaude, extractTextBlocks, aggregateCallsByPass,
} from './agent';

jest.mock('axios');

const proxySrc = () => fs.readFileSync(path.join(__dirname, '..', '..', 'proxy.js'), 'utf8');
// `TOKEN_PRICING_FALLBACK` n'est pas exporté — on vérifie sur le texte source
// plutôt que d'élargir la surface publique du module pour la commodité d'un test.
const agentSrc    = () => fs.readFileSync(path.join(__dirname, 'agent.js'), 'utf8');
const settingsSrc = () => fs.readFileSync(path.join(__dirname, '..', 'store', 'slices', 'settingsSlice.js'), 'utf8');

describe('registre des passes IA (MODEL_PASSES)', () => {
  test('la refonte et l\'audit QAT passent par Sonnet 5', () => {
    expect(selectModel('refonte')).toBe('claude-sonnet-5');
    expect(selectModel('audit_qat')).toBe('claude-sonnet-5');
  });

  test("l'extraction de mots-clés reste sur Haiku (tâche courte, pas de raison de payer plus)", () => {
    expect(selectModel('query_extraction')).toBe('claude-haiku-4-5');
  });

  test('une passe non déclarée retombe sur Haiku ET le signale (jamais silencieux)', () => {
    const spy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    expect(selectModel('passe_qui_nexiste_pas')).toBe('claude-haiku-4-5');
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('passe_qui_nexiste_pas'));
    spy.mockRestore();
  });

  test('PANNE SILENCIEUSE — TOUS les modèles du registre sont dans la liste blanche du proxy', () => {
    // Sans son entrée dans MODEL_CASCADE, un modèle du registre ferait retomber
    // le proxy sur MODEL_FALLBACK (Haiku) sans le dire. On vérifie l'ensemble du
    // registre, pas une seule tâche — c'est tout l'intérêt d'un registre unique.
    const src = proxySrc();
    const manquants = Object.entries(MODEL_PASSES)
      .filter(([, { model }]) => !src.includes(`'${model}'`))
      .map(([pass, { model }]) => `${pass} → ${model}`);
    expect(manquants).toEqual([]);
  });
});

describe('overrides — choix du superadmin (settings.modelSelections)', () => {
  test('un override valide prime sur le défaut du registre', () => {
    expect(selectModel('audit_qat', { audit_qat: 'claude-opus-4-5' })).toBe('claude-opus-4-5');
  });

  test('sans override pour CETTE passe, le défaut du registre s\'applique — même si d\'autres passes sont surchargées', () => {
    expect(selectModel('refonte', { audit_qat: 'claude-opus-4-5' })).toBe('claude-sonnet-5');
  });

  test('overrides absent/null/vide → comportement identique à avant ce dispositif', () => {
    expect(selectModel('style')).toBe('claude-sonnet-5');
    expect(selectModel('style', null)).toBe('claude-sonnet-5');
    expect(selectModel('style', {})).toBe('claude-sonnet-5');
  });

  test('une passe absente du registre retombe sur Haiku même avec des overrides — la validité de la passe prime', () => {
    const spy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    expect(selectModel('passe_qui_nexiste_pas', { passe_qui_nexiste_pas: 'claude-opus-4-5' })).toBe('claude-haiku-4-5');
    spy.mockRestore();
  });

  test('GET /api/models existe et expose MODEL_CASCADE — le sélecteur ne doit JAMAIS proposer un modèle inconnu du serveur', () => {
    expect(proxySrc()).toMatch(/app\.get\('\/api\/models', requireAuth, \(req, res\) => \{\s*\n\s*res\.json\(\{ models: MODEL_CASCADE \}\);/);
  });

  test('POST /api/settings rejette un modèle absent de MODEL_CASCADE dans modelSelections', () => {
    const s = proxySrc();
    expect(s).toMatch(/if \(incoming\.modelSelections !== undefined\)/);
    expect(s).toMatch(/!MODEL_CASCADE\.includes\(model\)/);
  });

  test("'modelSelections' est whitelisté pour la sauvegarde des paramètres équipe", () => {
    expect(proxySrc()).toMatch(/SETTINGS_WHITELIST = \[[\s\S]{0,300}'modelSelections'/);
  });
});

describe('aggregateCallsByPass — détail du coût par passe pour UN article', () => {
  test('agrège plusieurs appels de la même passe et calcule le coût avec le tarif fourni', () => {
    const calls = [
      { model: 'claude-sonnet-5', pass: 'audit_qat', input: 1000, output: 500 },
      { model: 'claude-sonnet-5', pass: 'audit_qat', input: 200, output: 100 },
    ];
    const pricing = { 'claude-sonnet-5': { input: 3, output: 15 } };
    const result = aggregateCallsByPass(calls, pricing);
    expect(result.audit_qat.input).toBe(1200);
    expect(result.audit_qat.output).toBe(600);
    expect(result.audit_qat.model).toBe('claude-sonnet-5');
    // (1200/1e6)*3 + (600/1e6)*15 = 0.0036 + 0.009 = 0.0126
    expect(result.audit_qat.costUsd).toBeCloseTo(0.0126, 6);
  });

  test('sépare les passes différentes, même sur le même modèle', () => {
    const calls = [
      { model: 'claude-haiku-4-5', pass: 'query_extraction', input: 100, output: 50 },
      { model: 'claude-haiku-4-5', pass: 'seo_meta', input: 80, output: 40 },
    ];
    const result = aggregateCallsByPass(calls);
    expect(Object.keys(result).sort()).toEqual(['query_extraction', 'seo_meta']);
  });

  test('un appel SANS label de passe est ignoré, pas comptabilisé sous une clé "inconnu"', () => {
    const calls = [
      { model: 'claude-haiku-4-5', input: 100, output: 50 }, // pas de `pass` — article traité avant ce dispositif
      { model: 'claude-sonnet-5', pass: 'gras', input: 10, output: 5 },
    ];
    const result = aggregateCallsByPass(calls);
    expect(Object.keys(result)).toEqual(['gras']);
  });

  test('entrée dégénérée : jamais d\'exception', () => {
    expect(aggregateCallsByPass(null)).toEqual({});
    expect(aggregateCallsByPass(undefined)).toEqual({});
    expect(aggregateCallsByPass([])).toEqual({});
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

  test('Opus 4.5 est à 5.00/25.00 — 15.00/75.00 (tarif Opus 4.1) surestimait la facture de 3x', () => {
    expect(agentSrc()).toMatch(/'claude-opus-4-5':\s*\{\s*input:\s*5\.00,\s*output:\s*25\.00\s*\}/);
    expect(settingsSrc()).toMatch(/'claude-opus-4-5':\s*\{\s*input:\s*5\.00,\s*output:\s*25\.00\s*\}/);
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

describe('verrou de cascade — le repli sur Haiku ne doit plus être silencieux', () => {
  // Avant resolveRequestedModel, `MODEL_CASCADE.includes(model) ? model : MODEL_FALLBACK`
  // était dupliqué trois fois (executeClaudeCall, /api/claude-stream, /api/claude-tools)
  // et aucune des trois copies ne logguait la substitution.
  test('les TROIS voies passent par resolveRequestedModel — plus de ternaire dupliqué', () => {
    const s = proxySrc();
    expect((s.match(/const requestedModel = resolveRequestedModel\(model\);/g) || []).length).toBe(3);
    // La substitution silencieuse ne doit plus exister nulle part hors de la fonction elle-même.
    expect((s.match(/MODEL_CASCADE\.includes\(model\) \? model : MODEL_FALLBACK/g) || []).length).toBe(1);
  });

  test('resolveRequestedModel avertit en console quand elle substitue', () => {
    const s = proxySrc();
    expect(s).toMatch(/const resolveRequestedModel = \(model\) => \{/);
    expect(s).toMatch(/console\.warn\(`\[proxy\] Modèle/);
  });
});
