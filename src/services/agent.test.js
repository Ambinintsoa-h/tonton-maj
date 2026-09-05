/* eslint-env jest */
/**
 * Tests ciblés sur les trois helpers ajoutés pour le chantier "fiabilité des
 * liens injectés" (septembre 2026) : extraction des liens internes existants,
 * récupération du sitemap réel du site, vérification de statut d'une liste
 * de liens. Le reste de agent.js (analyzeLinks, scrapeSource, l'appel Claude…)
 * n'a pas de fichier de test dédié dans ce projet — hors périmètre ici.
 */
import axios from 'axios';
import { extractInternalLinks, fetchSiteUrls, checkLinksLive } from './agent';

jest.mock('axios');

describe('extractInternalLinks', () => {
  const ARTICLE_URL = 'https://site.fr/mon-article/';

  it('extrait href absolu + texte d\'ancre des liens internes', () => {
    const html = '<p>Voir <a href="/autre-page/">cette page</a> et '
      + '<a href="https://site.fr/troisieme/">celle-ci</a>.</p>';
    expect(extractInternalLinks(html, ARTICLE_URL)).toEqual([
      { href: 'https://site.fr/autre-page/', anchor: 'cette page' },
      { href: 'https://site.fr/troisieme/', anchor: 'celle-ci' },
    ]);
  });

  it('ignore les liens EXTERNES — jamais touchés par ce mécanisme (règle 8)', () => {
    const html = '<a href="https://autresite.com/page/">lien externe</a>';
    expect(extractInternalLinks(html, ARTICLE_URL)).toEqual([]);
  });

  it('ignore les ancres # / mailto: / tel:', () => {
    const html = '<a href="#section">ancre</a><a href="mailto:x@y.fr">mail</a><a href="tel:0102030405">tel</a>';
    expect(extractInternalLinks(html, ARTICLE_URL)).toEqual([]);
  });

  it('sans articleUrl exploitable, renvoie [] plutôt que de risquer un faux interne', () => {
    const html = '<a href="/page/">page</a>';
    expect(extractInternalLinks(html, '')).toEqual([]);
    expect(extractInternalLinks(html, 'pas-une-url')).toEqual([]);
  });

  it('HTML vide → []', () => {
    expect(extractInternalLinks('', ARTICLE_URL)).toEqual([]);
  });
});

describe('fetchSiteUrls', () => {
  beforeEach(() => { axios.post = jest.fn(); });

  it('renvoie les URLs reçues du serveur', async () => {
    axios.post.mockResolvedValue({ data: { urls: ['https://site.fr/a/', 'https://site.fr/b/'] } });
    const urls = await fetchSiteUrls('https://site.fr/article/');
    expect(urls).toEqual(['https://site.fr/a/', 'https://site.fr/b/']);
    expect(axios.post).toHaveBeenCalledWith('/api/site-urls', { articleUrl: 'https://site.fr/article/' }, expect.anything());
  });

  it('échec réseau → [] jamais une exception (non bloquant)', async () => {
    axios.post.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(fetchSiteUrls('https://site.fr/article/')).resolves.toEqual([]);
  });

  it('réponse malformée (pas un tableau) → []', async () => {
    axios.post.mockResolvedValue({ data: { urls: 'pas-un-tableau' } });
    await expect(fetchSiteUrls('https://site.fr/article/')).resolves.toEqual([]);
  });
});

describe('checkLinksLive', () => {
  beforeEach(() => { axios.post = jest.fn(); });

  it('liste vide → {} sans appel réseau', async () => {
    expect(await checkLinksLive([])).toEqual({});
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('renvoie le statut par URL reçu du serveur', async () => {
    axios.post.mockResolvedValue({ data: { results: { 'https://site.fr/a/': 'live', 'https://site.fr/b/': 'dead' } } });
    const results = await checkLinksLive(['https://site.fr/a/', 'https://site.fr/b/']);
    expect(results).toEqual({ 'https://site.fr/a/': 'live', 'https://site.fr/b/': 'dead' });
  });

  it('échec réseau → {} (l\'appelant doit alors traiter chaque URL comme "unknown")', async () => {
    axios.post.mockRejectedValue(new Error('timeout'));
    await expect(checkLinksLive(['https://site.fr/a/'])).resolves.toEqual({});
  });
});
