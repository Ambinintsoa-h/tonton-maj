/* eslint-env jest */
/**
 * LES OCTETS DE L'IMAGE, PAS SON ADRESSE — correctif du 16 septembre 2026.
 *
 * `generateImageMeta` / `generateAltText` envoyaient à l'API Vision une `source`
 * de type `url` : c'était alors ANTHROPIC qui allait chercher l'image sur le
 * site du client, et elle répondait « Unable to download the file » quand
 * l'hébergeur bloquait son robot. On télécharge désormais nous-mêmes.
 *
 * Ces tests vérifient les trois comportements qui comptent, à travers l'appel
 * réel de la fonction (axios mocké) : les octets passent, le repli fonctionne,
 * et le motif d'échec remonte à l'écran.
 */
import axios from 'axios';
import { generateImageMeta, generateAltText } from './agent';

jest.mock('axios');

const IMG = 'https://circuits-culture.com/wp-content/uploads/2026/09/Heliosol®-2-scaled.jpg';
const IMG_ENCODEE = 'https://circuits-culture.com/wp-content/uploads/2026/09/Heliosol%C2%AE-2-scaled.jpg';

/** Réponse de l'API Claude, forme minimale attendue par callClaude. */
const reponseClaude = (texte) => ({
  data: { content: [{ type: 'text', text: texte }], usage: {}, modelUsed: 'claude-haiku-4-5' },
});

describe('source image envoyée à Vision', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('télécharge l\'image et transmet les OCTETS (base64), pas l\'URL', async () => {
    axios.post.mockImplementation((url) => {
      if (url === '/api/image-base64') {
        return Promise.resolve({ data: { success: true, media_type: 'image/jpeg', data: 'QUJD' } });
      }
      return Promise.resolve(reponseClaude('{"alt":"Feuilles de vigne","caption":"Vignoble sous la pluie"}'));
    });

    const res = await generateImageMeta(IMG, 'sk-test');
    expect(res).toMatchObject({ alt: 'Feuilles de vigne', caption: 'Vignoble sous la pluie' });

    // L'URL part au PROXY, encodée — pas à Anthropic.
    const appelProxy = axios.post.mock.calls.find((c) => c[0] === '/api/image-base64');
    expect(appelProxy[1]).toEqual({ url: IMG_ENCODEE });

    // Et le message Claude porte bien les octets.
    const appelClaude = axios.post.mock.calls.find((c) => c[0] !== '/api/image-base64');
    const source = appelClaude[1].messages[0].content[0].source;
    expect(source).toEqual({ type: 'base64', media_type: 'image/jpeg', data: 'QUJD' });
  });

  // REPLI ASSUMÉ : perdre une suggestion parce que NOTRE téléchargement a raté
  // serait une régression. On retente par l'ancien chemin.
  it('retombe sur la source `url` quand notre téléchargement échoue', async () => {
    axios.post.mockImplementation((url) => {
      if (url === '/api/image-base64') {
        return Promise.reject({ response: { data: { error: 'Téléchargement de l\'image refusé par le site (HTTP 403).' } } });
      }
      return Promise.resolve(reponseClaude('{"alt":"A","caption":"B"}'));
    });

    const res = await generateImageMeta(IMG, 'sk-test');
    expect(res).toMatchObject({ alt: 'A', caption: 'B' });

    const appelClaude = axios.post.mock.calls.find((c) => c[0] !== '/api/image-base64');
    expect(appelClaude[1].messages[0].content[0].source).toEqual({ type: 'url', url: IMG_ENCODEE });
  });

  // Le silence de ce chemin a coûté une enquête entière : « Suggestion
  // impossible — réessayez » à l'écran pendant que le serveur savait tout.
  it('remonte le MOTIF de l\'échec à l\'appelant', async () => {
    axios.post.mockImplementation((url) => {
      if (url === '/api/image-base64') return Promise.resolve({ data: { success: false, error: 'indisponible' } });
      return Promise.reject({ response: { data: { error: 'Unable to download the file.' } } });
    });

    const res = await generateImageMeta(IMG, 'sk-test');
    expect(res.alt).toBe('');
    expect(res.error).toBe('Unable to download the file.');
  });

  it('generateAltText passe lui aussi par les octets', async () => {
    axios.post.mockImplementation((url) => {
      if (url === '/api/image-base64') {
        return Promise.resolve({ data: { success: true, media_type: 'image/webp', data: 'WkRF' } });
      }
      return Promise.resolve(reponseClaude('Feuilles de vigne mouillées'));
    });

    await expect(generateAltText(IMG, 'sk-test')).resolves.toBe('Feuilles de vigne mouillées');
    const appelClaude = axios.post.mock.calls.find((c) => c[0] !== '/api/image-base64');
    expect(appelClaude[1].messages[0].content[0].source.type).toBe('base64');
  });

  it('ne tente rien sans URL ni clé API', async () => {
    await expect(generateImageMeta('', 'sk-test')).resolves.toEqual({ alt: '', caption: '' });
    await expect(generateAltText(IMG, '')).resolves.toBe('');
    expect(axios.post).not.toHaveBeenCalled();
  });
});
