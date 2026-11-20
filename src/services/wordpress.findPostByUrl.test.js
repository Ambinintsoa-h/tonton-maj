/**
 * Verrou : retrouver un post depuis son URL, y compris quand le permalien se
 * termine par l'ID (`/actus-2/slug/4063/`, las-motorsport.com) au lieu du slug.
 * Avant : `?slug=4063` → liste vide → « Publication annulée : aucun article… ».
 */
import axios from 'axios';
import { findPostByUrl, extractNumericId } from './wordpress';

jest.mock('axios');

const SITE = { url: 'https://fr.las-motorsport.com', username: 'u', password: 'p' };

// Simule WordPress : table path → réponse ; 404 sinon.
const wp = (routes) => {
  axios.post.mockImplementation(async (_proxy, { path }) => {
    if (path in routes) return { data: { data: routes[path] } };
    const err = new Error('404'); err.response = { data: { error: 'rest_post_invalid_id' } };
    throw err;
  });
};
const appels = () => axios.post.mock.calls.map((c) => c[1].path);

beforeEach(() => axios.post.mockReset());

describe('extractNumericId', () => {
  it('lit l\'ID en fin de permalien', () => {
    expect(extractNumericId('https://fr.las-motorsport.com/actus-2/apex-en-f1/4063/')).toBe('4063');
    expect(extractNumericId('https://x.fr/a/b/4063')).toBe('4063');
  });
  it('rend null pour un slug ordinaire, un segment unique ou une URL invalide', () => {
    expect(extractNumericId('https://x.fr/mon-article/')).toBeNull();
    expect(extractNumericId('https://x.fr/2026/')).toBeNull();
    expect(extractNumericId('pas une url')).toBeNull();
  });
});

describe('findPostByUrl — permalien terminé par l\'ID', () => {
  const URL_ART = 'https://fr.las-motorsport.com/actus-2/apex-en-f1-comprendre-le-point-de-coupure/4063/';
  const POST = {
    id: 4063, slug: 'apex-en-f1-comprendre-le-point-de-coupure', status: 'publish',
    link: 'https://fr.las-motorsport.com/actus-2/apex-en-f1-comprendre-le-point-de-coupure/4063/',
  };

  it('trouve le post par ID', async () => {
    wp({ '/wp-json/wp/v2/posts/4063?_fields=id,link,title,slug,status,type': POST });
    const r = await findPostByUrl(SITE, URL_ART);
    expect(r.success).toBe(true);
    expect(r.post.id).toBe(4063);
    expect(r.post.postType).toBe('posts');
  });

  it('accepte un autre sous-domaine : seul le chemin compte', async () => {
    wp({ '/wp-json/wp/v2/posts/4063?_fields=id,link,title,slug,status,type': { ...POST, link: 'https://las-motorsport.com/actus-2/apex-en-f1-comprendre-le-point-de-coupure/4063/' } });
    expect((await findPostByUrl(SITE, URL_ART)).success).toBe(true);
  });

  it('refuse un post dont le lien n\'est pas celui de l\'URL (pas de mauvais article)', async () => {
    wp({
      '/wp-json/wp/v2/posts/4063?_fields=id,link,title,slug,status,type': { ...POST, link: 'https://fr.las-motorsport.com/autre/rubrique/un-autre-article/4063/' },
    });
    const r = await findPostByUrl(SITE, URL_ART);
    expect(r.success).toBe(false);
  });

  it('retombe sur la recherche par slug quand l\'ID ne correspond à rien', async () => {
    wp({ '/wp-json/wp/v2/posts?slug=4063&_fields=id,link,title,slug,status,type': [{ id: 9, slug: '4063', link: 'x' }] });
    const r = await findPostByUrl(SITE, URL_ART);
    expect(r.success).toBe(true);
    expect(r.post.id).toBe(9);
  });
});

describe('findPostByUrl — sites à slug (comportement inchangé)', () => {
  it('un slug ordinaire ne déclenche AUCUNE requête par ID', async () => {
    wp({ '/wp-json/wp/v2/posts?slug=mon-article&_fields=id,link,title,slug,status,type': [{ id: 5, slug: 'mon-article', link: 'x' }] });
    const r = await findPostByUrl(SITE, 'https://monsite.fr/mon-article/');
    expect(r.success).toBe(true);
    expect(appels().some((p) => /\/posts\/\d+/.test(p))).toBe(false);
  });
});
