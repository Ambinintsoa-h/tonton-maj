// Tests d'intégration de l'étape B (réécriture) du mode « Audit QAT + Refonte ».
// Objectif : exercer la BOUCLE DE REPRISE et le VERROU LIENS EXTERNES de bout en
// bout, avec l'appel Claude simulé — c'est le seul endroit où l'on vérifie que le
// pipeline se comporte correctement quand le modèle répond mal.
/* eslint-env jest */
import { ReadableStream as NodeReadableStream } from 'stream/web';
import { TextEncoder as NodeTextEncoder, TextDecoder as NodeTextDecoder } from 'util';

if (typeof global.ReadableStream === 'undefined') global.ReadableStream = NodeReadableStream;
if (typeof global.TextEncoder === 'undefined') global.TextEncoder = NodeTextEncoder;
if (typeof global.TextDecoder === 'undefined') global.TextDecoder = NodeTextDecoder;

// Le streaming est simulé indisponible : le pipeline doit se rabattre sur
// callClaudeWithProgress, qui porte les réponses de test.
// ⚠️ react-scripts active `resetMocks: true` : les implémentations posées dans
// cette factory sont EFFACÉES avant chaque test. Elles sont donc (re)posées dans
// le beforeEach ci-dessous, sinon les mocks renvoient undefined.
jest.mock('./agent', () => {
  const actual = jest.requireActual('./agent');
  return {
    ...actual,
    callClaudeStream: jest.fn(),
    callClaudeWithProgress: jest.fn(),
    callClaude: jest.fn(),
    scrapeSource: jest.fn(),
  };
});

// eslint-disable-next-line import/first
import { runQatRewrite } from './agentQat';
// eslint-disable-next-line import/first
import { callClaudeWithProgress, callClaudeStream, callClaude, scrapeSource } from './agent';

const SKILLS = [{
  name: 'tonton', format: 'skillmd', active: true,
  body: '# Méthode\nAudit puis refonte.',
  resources: [{ name: 'refonte-integrale.md', content: 'Gabarits.' }],
}];

const AUDIT = {
  ampleur: { decision: 'refonte_totale', justification: 'contenu obsolète' },
  priority_actions: [], recent_context: {}, seo_geo_gaps: [],
};

const ARTICLE_URL = 'https://isolation-phonique.com/mon-article';

const reply = (obj) => ({ text: JSON.stringify(obj), usage: { model: 'claude-sonnet-4-5', input_tokens: 10, output_tokens: 20 } });

const baseArgs = (contentHtml) => ({
  content: contentHtml,
  contentHtml,
  audit: AUDIT,
  skills: SKILLS,
  articleUrl: ARTICLE_URL,
  targetKeyword: 'isolation phonique plafond',
  depth: 'auto',
});

beforeEach(() => {
  // Streaming indisponible → le pipeline passe par callClaudeWithProgress.
  callClaudeStream.mockRejectedValue(new Error('STREAM_UNAVAILABLE'));
  callClaude.mockResolvedValue({ text: '[]', usage: {} });
  scrapeSource.mockResolvedValue(null);
});

describe('runQatRewrite — cas nominal', () => {
  test('retourne l\'article assaini, avec le chapô replacé en tête du corps', async () => {
    callClaudeWithProgress.mockResolvedValueOnce(reply({
      titre_seo: 'Isolation phonique plafond : prix 2026',
      meta_description: 'Tarifs, techniques et aides pour isoler un plafond.',
      h1: 'Isolation phonique du plafond',
      chapo_html: '<p><strong><em>Le chapô.</em></strong></p>',
      article_html: '<h2>Tarifs</h2><p>Comptez 55 €/m².</p>',
      mot_cle_retenu: 'isolation phonique plafond',
      ancres_placees: [{ ancre: 'prix au m²', url: '/prix', section: 'Tarifs' }],
    }));

    const { article } = await runQatRewrite(baseArgs('<p>Ancien texte.</p>'));

    expect(article.titreSeo).toBe('Isolation phonique plafond : prix 2026');
    expect(article.h1).toBe('Isolation phonique du plafond');
    expect(article.html).toContain('Le chapô');            // chapô intégré au corps
    expect(article.html.indexOf('Le chapô')).toBeLessThan(article.html.indexOf('Tarifs'));
    expect(article.ampleurAppliquee).toBe('refonte');
    expect(article.wordCount).toBeGreaterThan(0);
    expect(article.ancresPlacees).toHaveLength(1);
    expect(callClaudeWithProgress).toHaveBeenCalledTimes(1);
  });

  test('l\'ampleur imposée par le rédacteur prime sur l\'audit et lève overridden', async () => {
    callClaudeWithProgress.mockResolvedValueOnce(reply({ article_html: '<p>Texte ciblé.</p>' }));
    const { article } = await runQatRewrite({ ...baseArgs('<p>x</p>'), depth: 'legere' });
    expect(article.ampleurAppliquee).toBe('ciblee');
    expect(article.ampleurSource).toBe('redacteur');
    expect(article.ampleurOverridden).toBe(true);
  });
});

describe('runQatRewrite — verrou liens externes', () => {
  const withLink = '<p>Voir <a href="https://ademe.fr/guide">le guide ADEME</a>.</p>';

  test('lien externe ajouté par l\'IA → retiré et signalé, la génération passe', async () => {
    callClaudeWithProgress.mockResolvedValueOnce(reply({
      article_html: '<p>Prix 2026 selon <a href="https://concurrent.com/x">cette étude</a>.</p>',
    }));
    const { article } = await runQatRewrite(baseArgs('<p>Ancien texte.</p>'));
    expect(article.html).not.toContain('concurrent.com');
    expect(article.html).toContain('cette étude');
    expect(article.strippedExternalLinks).toEqual(['https://concurrent.com/x']);
  });

  test('lien externe perdu → reprise INSTRUITE : le 2e prompt nomme le lien manquant', async () => {
    callClaudeWithProgress
      .mockResolvedValueOnce(reply({ article_html: '<p>Texte sans le lien.</p>' }))
      .mockResolvedValueOnce(reply({ article_html: `<p>Texte avec <a href="https://ademe.fr/guide">le guide ADEME</a>.</p>` }));

    const { article } = await runQatRewrite(baseArgs(withLink));

    expect(article.html).toContain('https://ademe.fr/guide');
    expect(callClaudeWithProgress).toHaveBeenCalledTimes(2);
    // Le second appel doit porter la consigne de reprise ET l'URL perdue.
    const secondPrompt = callClaudeWithProgress.mock.calls[1][1].messages[0].content;
    expect(secondPrompt).toContain('VERROU LIENS EXTERNES DÉCLENCHÉ');
    expect(secondPrompt).toContain('https://ademe.fr/guide');
  });

  test('lien externe perdu 3 fois → échec explicite, jamais un article amputé', async () => {
    callClaudeWithProgress.mockResolvedValue(reply({ article_html: '<p>Toujours sans le lien.</p>' }));
    await expect(runQatRewrite(baseArgs(withLink)))
      .rejects.toThrow(/Verrou liens externes/);
    expect(callClaudeWithProgress).toHaveBeenCalledTimes(3);
  });
});

describe('runQatRewrite — réponses non conformes', () => {
  test('3 réponses illisibles → message clair, et non une TypeError opaque', async () => {
    callClaudeWithProgress.mockResolvedValue({ text: 'Voilà votre article !', usage: {} });
    await expect(runQatRewrite(baseArgs('<p>x</p>')))
      .rejects.toThrow(/pas produit d'article exploitable après 3 essais/);
    expect(callClaudeWithProgress).toHaveBeenCalledTimes(3);
  });

  test('article_html vide → traité comme illisible, avec consigne de reprise', async () => {
    callClaudeWithProgress
      .mockResolvedValueOnce(reply({ article_html: '' }))
      .mockResolvedValueOnce(reply({ article_html: '<p>Cette fois-ci ça va.</p>' }));
    const { article } = await runQatRewrite(baseArgs('<p>x</p>'));
    expect(article.html).toContain('ça va');
    const secondPrompt = callClaudeWithProgress.mock.calls[1][1].messages[0].content;
    expect(secondPrompt).toContain("L'ESSAI PRÉCÉDENT A ÉCHOUÉ");
  });

  test('aucun skill cerveau actif → refus immédiat, sans appel à l\'IA', async () => {
    await expect(runQatRewrite({ ...baseArgs('<p>x</p>'), skills: [] }))
      .rejects.toThrow(/skill cerveau/);
    expect(callClaudeWithProgress).not.toHaveBeenCalled();
  });
});
