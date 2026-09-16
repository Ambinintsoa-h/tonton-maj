/* eslint-env jest */
/**
 * RÉESSAI DU SCRAPE — lot de 20 articles terminé à 9/20 le 16 septembre 2026.
 *
 * 9 des 11 erreurs tombaient sur la récupération de l'article, et TOUTES les
 * erreurs du lot sur les deux premières étapes du pipeline : la signature d'une
 * rafale de démarrage, pas d'une charge continue. Deux motifs, une même origine :
 * « HTTP 429 — Trop de requêtes » (notre limiteur, qui répond AVANT la route,
 * donc que seul l'appelant peut rattraper) et « timeout of 20000ms exceeded »
 * (boucle d'événements bloquée par les JSDOM concurrents).
 *
 * Ces tests vérifient qu'on réessaie CE QUI EST TRANSITOIRE, et rien d'autre :
 * retenter un 403 donnerait exactement la même réponse, une minute plus tard.
 */
import axios from 'axios';
import { scrapeUrl } from './scraper';

jest.mock('axios');

const OK = {
  data: {
    content: `<p>${'Un contenu d\'article suffisamment long pour passer le seuil des cent caractères. '.repeat(3)}</p>`,
    textContent: 'texte',
    title: 'Titre',
  },
};
const erreur = (status, error) => Object.assign(new Error('boom'), { response: { status, data: { error } } });

describe('scrapeUrl — réessai', () => {
  beforeEach(() => { jest.clearAllMocks(); jest.useFakeTimers(); });
  afterEach(() => { jest.useRealTimers(); });

  /**
   * Joue les attentes de réessai (4 s puis 12 s) sans les subir : on avance les
   * timers PAR PETITS PAS en laissant respirer la file de microtâches entre
   * chacun, sinon la promesse suivante n'est pas encore programmée quand on
   * avance, et le test attend pour de vrai.
   */
  const courir = async (p) => {
    for (let i = 0; i < 40; i++) {
      await Promise.resolve();
      await Promise.resolve();
      jest.advanceTimersByTime(1000);
    }
    return p;
  };

  it('réessaie un 429 de notre limiteur et finit par réussir', async () => {
    axios.post
      .mockRejectedValueOnce(erreur(429, 'Trop de requêtes — réessayez dans une minute.'))
      .mockResolvedValueOnce(OK);
    const res = await courir(scrapeUrl('https://site.fr/a'));
    expect((await res).success).toBe(true);
    expect(axios.post).toHaveBeenCalledTimes(2);
  });

  it('réessaie un 500 porteur d\'un timeout', async () => {
    axios.post
      .mockRejectedValueOnce(erreur(500, 'Erreur de récupération : timeout of 20000ms exceeded'))
      .mockResolvedValueOnce(OK);
    const res = await courir(scrapeUrl('https://site.fr/b'));
    expect((await res).success).toBe(true);
    expect(axios.post).toHaveBeenCalledTimes(2);
  });

  // Retenter ne changerait rien : le site bloque, il bloquera encore dans 12 s.
  it('ne réessaie PAS un 403 — le site bloque le scraping', async () => {
    axios.post.mockRejectedValue(erreur(403, 'Ce site bloque le scraping.'));
    const res = await courir(scrapeUrl('https://site.fr/c'));
    expect((await res).success).toBe(false);
    expect(axios.post).toHaveBeenCalledTimes(1);
  });

  it('ne réessaie PAS un 400 — URL invalide', async () => {
    axios.post.mockRejectedValue(erreur(400, 'URL manquante'));
    await courir(scrapeUrl('https://site.fr/d'));
    expect(axios.post).toHaveBeenCalledTimes(1);
  });

  // Après les deux attentes (4 s puis 12 s), on rend la MAIN avec le vrai motif :
  // l'appelant doit voir « Trop de requêtes », pas une erreur générique.
  it('abandonne après deux réessais et remonte le motif réel', async () => {
    axios.post.mockRejectedValue(erreur(429, 'Trop de requêtes — réessayez dans une minute.'));
    const res = await courir(scrapeUrl('https://site.fr/e'));
    expect(axios.post).toHaveBeenCalledTimes(3);      // 1 essai + 2 réessais
    expect((await res).error).toMatch(/Trop de requêtes/);
  });
});
