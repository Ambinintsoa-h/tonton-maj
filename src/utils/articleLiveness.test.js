/**
 * articleLiveness.test.js — le pré-contrôle 404 avant analyse.
 *
 * `dead` doit bloquer, `unknown` (panne de vérification, pas de destination)
 * doit laisser l'analyse continuer — même garde-fou que /api/check-links et
 * le tissage de liens (agentQat.js) : on ne pénalise jamais un lien, ni ici
 * une analyse entière, pour un problème de VÉRIFICATION.
 */
jest.mock('../services/agent', () => ({ checkLinksLive: jest.fn() }));
import { checkLinksLive } from '../services/agent';
import { withNocache, isArticleUrlDead, ARTICLE_INTROUVABLE_MESSAGE } from './articleLiveness';

describe('withNocache', () => {
  it('ajoute ?nocache=<timestamp> à une URL simple', () => {
    const u = withNocache('https://exemple.fr/article');
    expect(u).toMatch(/^https:\/\/exemple\.fr\/article\?nocache=\d+$/);
  });

  it('préserve une query string existante', () => {
    const u = withNocache('https://exemple.fr/article?utm_source=x');
    expect(u).toContain('utm_source=x');
    expect(u).toMatch(/nocache=\d+/);
  });

  it('une URL invalide est renvoyée telle quelle plutôt que de faire planter l\'appelant', () => {
    expect(withNocache('pas-une-url')).toBe('pas-une-url');
  });
});

describe('isArticleUrlDead', () => {
  beforeEach(() => { checkLinksLive.mockReset(); });

  it('vrai UNIQUEMENT sur un 404 confirmé (\'dead\')', async () => {
    checkLinksLive.mockImplementation(async (urls) => ({ [urls[0]]: 'dead' }));
    expect(await isArticleUrlDead('https://exemple.fr/article')).toBe(true);
  });

  it('ne bloque jamais sur une incertitude (\'unknown\')', async () => {
    checkLinksLive.mockImplementation(async (urls) => ({ [urls[0]]: 'unknown' }));
    expect(await isArticleUrlDead('https://exemple.fr/article')).toBe(false);
  });

  it('ne bloque pas quand la page est bien vivante (\'live\')', async () => {
    checkLinksLive.mockImplementation(async (urls) => ({ [urls[0]]: 'live' }));
    expect(await isArticleUrlDead('https://exemple.fr/article')).toBe(false);
  });

  it('aucune URL → aucun appel réseau, jamais bloquant', async () => {
    expect(await isArticleUrlDead('')).toBe(false);
    expect(await isArticleUrlDead(null)).toBe(false);
    expect(checkLinksLive).not.toHaveBeenCalled();
  });

  it('interroge bien l\'URL cache-cassée (avec ?nocache), pas l\'URL brute', async () => {
    checkLinksLive.mockImplementation(async (urls) => ({ [urls[0]]: 'dead' }));
    await isArticleUrlDead('https://exemple.fr/article');
    const urlAppelee = checkLinksLive.mock.calls[0][0][0];
    expect(urlAppelee).toMatch(/nocache=\d+/);
  });
});

describe('ARTICLE_INTROUVABLE_MESSAGE', () => {
  it('propose le repli « Copier-coller »', () => {
    expect(ARTICLE_INTROUVABLE_MESSAGE).toMatch(/copier-coller/i);
    expect(ARTICLE_INTROUVABLE_MESSAGE).toMatch(/404/);
  });
});
