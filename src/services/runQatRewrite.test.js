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
    // R2 — `ancresPlacees` n'est PLUS l'auto-déclaration du modèle mais le
    // CONSTAT sur le HTML final. Ce cas ne passe AUCUN `internalLinks` : il n'y a
    // donc aucune paire de brief à constater, et le constat est vide — même si le
    // modèle prétend (`ancres_placees`) avoir posé une ancre. C'est exactement la
    // confusion que R2 supprime : ce que le modèle DIT est conservé à part.
    expect(article.ancresPlacees).toHaveLength(0);
    expect(article.ancresDeclareesIa).toHaveLength(1);
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

// R1 — volet INTERNE. Sanction ASYMÉTRIQUE : un lien interne perdu ne fait
// JAMAIS rejeter la génération (un 4e motif de rejet écraserait le message de
// reprise du verrou externe et affaiblirait la règle 8).
describe('runQatRewrite — R1 liens internes', () => {
  const withInternal = '<p>Voir <a href="/prix">nos prix</a> et <a href="https://isolation-phonique.com/faq">la FAQ</a>.</p>';

  test('les liens internes existants sont NOMMÉS dans le prompt (prévenir plutôt que réparer)', async () => {
    callClaudeWithProgress.mockResolvedValueOnce(reply({ article_html: withInternal }));
    await runQatRewrite(baseArgs(withInternal));
    const prompt = callClaudeWithProgress.mock.calls[0][1].messages[0].content;
    expect(prompt).toContain('LIENS INTERNES DÉJÀ PRÉSENTS — À REPRODUIRE (2)');
    expect(prompt).toContain('<a href="/prix">nos prix</a>');
    expect(prompt).toContain('la FAQ');
  });

  test('lien interne délié par l\'IA → ré-enveloppé, UN SEUL appel (aucun rejet)', async () => {
    callClaudeWithProgress.mockResolvedValueOnce(reply({
      article_html: '<h2>Tarifs</h2><p>Consultez nos prix et la FAQ avant travaux.</p>',
    }));
    const { article } = await runQatRewrite(baseArgs(withInternal));
    expect(article.html).toContain('href="/prix"');
    expect(article.html).toContain('href="https://isolation-phonique.com/faq"');
    expect(article.missingInternalLinks).toEqual([]);
    expect(article.restoredInternalLinks.map(l => l.href))
      .toEqual(['/prix', 'https://isolation-phonique.com/faq']);
    expect(callClaudeWithProgress).toHaveBeenCalledTimes(1);   // jamais de relance
  });

  test('ancre disparue → AVERTISSEMENT non bloquant : l\'article est livré quand même', async () => {
    callClaudeWithProgress.mockResolvedValueOnce(reply({
      article_html: '<h2>Tarifs 2026</h2><p>Comptez 55 €/m² pose comprise.</p>',
    }));
    const { article } = await runQatRewrite(baseArgs(withInternal));
    expect(article.html).toContain('55');
    expect(article.missingInternalLinks.map(l => l.href))
      .toEqual(['/prix', 'https://isolation-phonique.com/faq']);
    expect(callClaudeWithProgress).toHaveBeenCalledTimes(1);   // aucun rejet déclenché
  });

  test('brief de maillage VIDE : la consigne distingue reproduire l\'existant d\'ajouter du neuf', async () => {
    callClaudeWithProgress.mockResolvedValueOnce(reply({ article_html: '<p>Texte.</p>' }));
    await runQatRewrite({ ...baseArgs('<p>x</p>'), internalLinks: [] });
    const system = callClaudeWithProgress.mock.calls[0][1].system;
    const consigne = system.map(b => b.text).join('\n');
    expect(consigne).toContain('AUCUN lien NOUVEAU');
    expect(consigne).toContain('REPRODUIRE L\'EXISTANT');
    // L'ancienne formule, contradictoire avec R1, ne doit plus apparaître.
    expect(consigne).not.toContain('n\'ajoute AUCUN lien.');
    expect(consigne).not.toContain('les seuls liens que tu ajoutes sont les liens INTERNES du brief');
  });
});

// ── R2 — GARANTIE 100 % : toutes les suggestions du brief sont dans le HTML ────
// La garantie ne valait rien tant qu'elle n'était vérifiée que sur le prompt :
// `ancres_placees` était une auto-déclaration du modèle, jamais recomptée. Ces
// tests portent sur le HTML RÉELLEMENT produit.
describe('runQatRewrite — R2 : maillage interne garanti à 100 %', () => {
  const LIENS = [
    { anchor: 'prix au m²', url: '/prix-isolation' },      // ancre présente → tissage
    { anchor: 'aides MaPrimeRénov', url: '/aides' },        // ancre ABSENTE → forçage rédigé
  ];

  test('ancre présente → tissée sur place ; ancre absente → clause RÉDIGÉE et marquée', async () => {
    callClaudeWithProgress.mockResolvedValueOnce(reply({
      // Le modèle n'a posé AUCUN des deux liens, et n'en déclare aucun.
      article_html: '<h2>Tarifs</h2><p>Le prix au m² dépend de la technique retenue et du support.</p>',
    }));

    const { article } = await runQatRewrite({ ...baseArgs('<p>Ancien texte.</p>'), internalLinks: LIENS });

    // Les DEUX liens sont dans le HTML final — c'est la garantie R2.
    expect(article.html).toContain('href="/prix-isolation"');
    expect(article.html).toContain('href="/aides"');
    expect(article.ancresPlacees).toHaveLength(2);

    // Le premier a été TISSÉ : pas de clause rédigée, l'ancre existait.
    expect(article.html).toMatch(/<a href="\/prix-isolation">prix au m²<\/a>/);

    // Le second a été RÉDIGÉ par le code → marqué pour relecture.
    expect(article.ancresRedigees).toHaveLength(1);
    expect(article.ancresRedigees[0].url).toBe('/aides');
    expect(article.html).toContain('data-lien-redige');
  });

  test('une URL HORS DOMAINE du brief est écartée, jamais posée (règle 8)', async () => {
    callClaudeWithProgress.mockResolvedValueOnce(reply({ article_html: '<p>Un texte de corps assez long pour accueillir une clause.</p>' }));

    const { article } = await runQatRewrite({
      ...baseArgs('<p>x</p>'),
      internalLinks: [{ anchor: 'un concurrent', url: 'https://concurrent.com/page' }],
    });

    // Poser cette URL aurait été un LIEN EXTERNE AJOUTÉ — violation de la règle 8
    // par la porte du maillage, exactement ce que filterSameSiteLinks empêche.
    expect(article.html).not.toContain('concurrent.com');
    expect(article.ancresPlacees).toHaveLength(0);
    expect(article.ancresHorsDomaine).toHaveLength(1);
  });

  test('un lien du brief DÉJÀ posé par l\'IA n\'est pas dupliqué', async () => {
    callClaudeWithProgress.mockResolvedValueOnce(reply({
      article_html: '<h2>Tarifs</h2><p>Voir le <a href="/prix-isolation">prix au m²</a> selon la technique.</p>',
    }));

    const { article } = await runQatRewrite({
      ...baseArgs('<p>x</p>'),
      internalLinks: [{ anchor: 'prix au m²', url: '/prix-isolation' }],
    });

    expect((article.html.match(/href="\/prix-isolation"/g) || [])).toHaveLength(1);
    expect(article.ancresPlacees).toHaveLength(1);
    expect(article.ancresRedigees).toHaveLength(0);   // rien à rédiger, l'IA l'avait fait
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
