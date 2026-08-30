/* eslint-env jest */
/**
 * pipeline.test.js — le runner headless doit rejouer EXACTEMENT les défauts
 * automatiques que l'UI calcule elle-même (scope/depth/sélection/liens), et
 * ne jamais appeler une passe IA que son propre résultat ne justifie pas
 * (ex. la passe de style quand `detectStylePatterns` ne trouve rien).
 *
 * Seules les fonctions qui APPELLENT CLAUDE et le transport HTTP sont
 * mockées — tout le reste (scopeProposedByAudit, defaultAuditSelection,
 * auditSuggestedLinkRows, cleanLinkRows, buildGenerationPrompt,
 * detectStylePatterns, le reducer statsSlice) est le VRAI code : c'est
 * justement leur enchaînement correct qu'on vérifie.
 */
jest.mock('../services/agentQat', () => ({
  runQatAudit: jest.fn(),
  runQatRewrite: jest.fn(),
}));
jest.mock('../services/agent', () => {
  const actual = jest.requireActual('../services/agent');
  return { ...actual, runReviewAgent: jest.fn() };
});
jest.mock('../services/agentStyle', () => ({
  runStyleFixAgent: jest.fn(),
}));
jest.mock('axios');

// eslint-disable-next-line import/first
const axios = require('axios');
// eslint-disable-next-line import/first
const { runQatAudit, runQatRewrite } = require('../services/agentQat');
// eslint-disable-next-line import/first
const { runReviewAgent } = require('../services/agent');
// eslint-disable-next-line import/first
const { runStyleFixAgent } = require('../services/agentStyle');
// eslint-disable-next-line import/first
const { runArticlePipeline } = require('./pipeline');

const usage = (input, output, pass) => ({
  input, output, costUsd: input / 1e6 + output / 1e6,
  calls: [{ model: 'claude-sonnet-5', pass, input, output }],
});

// Audit MAJ CIBLÉE (`maj_ciblee`) → scope SIMPLE → depth 'ciblee'. Une seule
// paire de maillage suggérée, pour vérifier qu'elle est reprise TELLE QUELLE.
const AUDIT_SIMPLE = {
  ampleur: { decision: 'maj_ciblee' },
  scores: { global: 8 },
  internal_linking: { liens_entrants: [{ ancre: 'guide complet', url: 'https://site.fr/guide' }] },
};

const fakeHttp = () => ({
  get: jest.fn(async (url) => {
    if (url === '/data/skills') return { data: [{ id: 's1', brainMode: true }] };
    if (url === '/data/knowledge') return { data: [] };
    if (url === '/data/stats') return { data: { totalArticles: 0, history: [], totalByPass: {} } };
    throw new Error(`GET inattendu: ${url}`);
  }),
  post: jest.fn(async (url) => {
    if (url === '/scrape') return { data: { content: '<p>Article original.</p>', title: 'Titre original' } };
    if (url === '/articles') return { data: { id: 'art-123' } };
    throw new Error(`POST inattendu: ${url}`);
  }),
  put: jest.fn(async () => ({ data: { ok: true } })),
});

const baseInput = () => ({
  articleUrl: 'https://site.fr/article',
  targetKeyword: 'mot cle',
  launchedByUid: 'uid-1',
  launchedByName: 'Andrianina',
  apiBaseUrl: 'http://127.0.0.1:3001/api',
  authToken: 'jwt-de-test',
});

describe('runArticlePipeline — validation d\'entrée', () => {
  test('rejette sans articleUrl', async () => {
    await expect(runArticlePipeline({ ...baseInput(), articleUrl: '' }))
      .rejects.toThrow('articleUrl');
  });

  test('rejette sans targetKeyword', async () => {
    await expect(runArticlePipeline({ ...baseInput(), targetKeyword: '' }))
      .rejects.toThrow('targetKeyword');
  });

  test('rejette sans apiBaseUrl/authToken — jamais de requête HTTP à l\'aveugle', async () => {
    await expect(runArticlePipeline({ ...baseInput(), authToken: '' }))
      .rejects.toThrow('apiBaseUrl et authToken');
  });
});

describe('runArticlePipeline — chemin complet', () => {
  let http;

  beforeEach(() => {
    jest.clearAllMocks();
    http = fakeHttp();
    axios.create = jest.fn(() => http);

    runQatAudit.mockResolvedValue({ audit: AUDIT_SIMPLE, tokenUsage: usage(1000, 500, 'audit_qat') });
    runQatRewrite.mockResolvedValue({
      article: { html: '<p>Article réécrit, correct et sobre.</p>', titreSeo: 'Titre SEO' },
      tokenUsage: usage(2000, 1000, 'refonte'),
    });
    runReviewAgent.mockResolvedValue({ updates: [], tokenUsage: usage(500, 200, 'obsolescence') });
  });

  test('déduit scope=simple / depth=ciblee depuis un audit "maj_ciblee", et reprend le maillage suggéré tel quel', async () => {
    await runArticlePipeline(baseInput());

    expect(runQatRewrite).toHaveBeenCalledTimes(1);
    const args = runQatRewrite.mock.calls[0][0];
    expect(args.depth).toBe('ciblee');
    expect(args.internalLinks).toEqual([{ anchor: 'guide complet', url: 'https://site.fr/guide' }]);
    // MAJ simple → sélection = recent_context seul (defaultAuditSelection).
    expect(args.auditSelection).toMatchObject({ recent_context: true, a_supprimer: false, sources_check: false });
  });

  test('déduit scope=refonte / depth=refonte depuis un audit sans ampleur mais score global bas', async () => {
    runQatAudit.mockResolvedValue({
      audit: { scores: { global: 3 }, internal_linking: {} },
      tokenUsage: usage(1000, 500, 'audit_qat'),
    });
    await runArticlePipeline(baseInput());
    const args = runQatRewrite.mock.calls[0][0];
    expect(args.depth).toBe('refonte');
    expect(args.auditSelection).toMatchObject({ a_supprimer: true, sources_check: true, priority_actions: ['P1'] });
  });

  test('persiste l\'article avec assigneeId/lastModifiedBy = auteur du batch, jamais un champ Redux inexistant en headless', async () => {
    await runArticlePipeline(baseInput());
    expect(http.post).toHaveBeenCalledWith('/articles', expect.objectContaining({
      assigneeId: 'uid-1',
      lastModifiedBy: 'Andrianina',
      majMode: 'qat',
    }));
  });

  test('dispatche les 4 passes vers /data/stats via le VRAI reducer — jamais de double comptage sur audit_qat', async () => {
    // 18 mots, aucun motif détecté par detectStylePatterns → pas de findings → pas de passe de style.
    await runArticlePipeline(baseInput());
    const statPuts = http.put.mock.calls.filter(([url]) => url === '/data/stats');
    // pass 1 (audit) + pass 2 (génération) + pass 3 (obsolescence) — pas de pass 4 (aucun finding de style).
    expect(statPuts).toHaveLength(3);
    expect(runStyleFixAgent).not.toHaveBeenCalled();
  });

  test('lance la passe de style UNIQUEMENT si detectStylePatterns trouve des anomalies', async () => {
    runQatRewrite.mockResolvedValue({
      // Phrase de plus de 20 mots à dessein, pour déclencher un finding réel.
      article: {
        html: '<p>Cette phrase est volontairement bien plus longue que vingt mots afin de déclencher une détection réelle du motif de longueur excessive par le détecteur de style existant du projet.</p>',
        titreSeo: 'Titre SEO',
      },
      tokenUsage: usage(2000, 1000, 'refonte'),
    });
    runStyleFixAgent.mockResolvedValue({ proposals: [{ n: 1 }], occurrences: [], tokenUsage: usage(50, 20, 'style') });

    const result = await runArticlePipeline(baseInput());

    expect(runStyleFixAgent).toHaveBeenCalledTimes(1);
    expect(result.stylePropositionsCount).toBe(1);
    const statPuts = http.put.mock.calls.filter(([url]) => url === '/data/stats');
    expect(statPuts).toHaveLength(4);
  });

  test('audit illisible (audit=null) — arrête tout avant génération, jamais d\'appel Claude payé pour rien', async () => {
    runQatAudit.mockResolvedValue({ audit: null, apiError: null, tokenUsage: usage(100, 50, 'audit_qat') });
    await expect(runArticlePipeline(baseInput())).rejects.toThrow('Audit illisible');
    expect(runQatRewrite).not.toHaveBeenCalled();
  });

  test('une panne du dispatch stats ne fait PAS échouer le run — le contenu payé est déjà produit', async () => {
    http.get.mockImplementation(async (url) => {
      if (url === '/data/skills') return { data: [{ id: 's1', brainMode: true }] };
      if (url === '/data/knowledge') return { data: [] };
      if (url === '/data/stats') throw new Error('stats indisponibles');
      throw new Error(`GET inattendu: ${url}`);
    });
    await expect(runArticlePipeline(baseInput())).resolves.toMatchObject({ articleId: 'art-123' });
  });

  // Régression du 30 août 2026 : /skills et /knowledge appelés SANS le préfixe
  // /data tombaient sur le catch-all SPA de proxy.js, qui renvoie du HTML
  // (200 -- jamais rejeté par axios). `(skills || []).filter` explosait alors
  // sur cette chaîne dans getBrainSkills(). Reproduit ici en simulant le même
  // symptôme : la route renvoie quelque chose qui n'est PAS un tableau.
  test('une route /data/skills qui ne renvoie pas un tableau échoue fort, jamais en silence', async () => {
    http.get.mockImplementation(async (url) => {
      if (url === '/data/skills') return { data: '<!doctype html><html>...</html>' };
      if (url === '/data/knowledge') return { data: [] };
      throw new Error(`GET inattendu: ${url}`);
    });
    await expect(runArticlePipeline(baseInput())).rejects.toThrow(/data\/skills.*tableau/);
    expect(runQatAudit).not.toHaveBeenCalled();
  });

  test('une route /data/knowledge qui ne renvoie pas un tableau échoue fort', async () => {
    http.get.mockImplementation(async (url) => {
      if (url === '/data/skills') return { data: [] };
      if (url === '/data/knowledge') return { data: { knowledge: [] } };
      throw new Error(`GET inattendu: ${url}`);
    });
    await expect(runArticlePipeline(baseInput())).rejects.toThrow(/data\/knowledge.*tableau/);
    expect(runQatAudit).not.toHaveBeenCalled();
  });
});
