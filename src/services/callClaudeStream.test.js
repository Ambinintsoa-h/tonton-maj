// Tests du client de STREAMING (SSE) — POST /api/claude-stream.
// L'enjeu principal est le REPLI : si le flux est absent, bufferisé ou coupé par
// le proxy, l'appel doit lever `STREAM_UNAVAILABLE` pour que le caller bascule
// sur le transport job + polling, sans jamais perdre la génération.
/* eslint-env jest */
// jsdom (CRA 5) n'expose ni ReadableStream ni TextEncoder/TextDecoder, alors que
// tous les navigateurs visés les fournissent nativement. On les injecte depuis
// Node pour pouvoir tester le vrai chemin de lecture du flux.
import { ReadableStream as NodeReadableStream } from 'stream/web';
import { TextEncoder as NodeTextEncoder, TextDecoder as NodeTextDecoder } from 'util';

if (typeof global.ReadableStream === 'undefined') global.ReadableStream = NodeReadableStream;
if (typeof global.TextEncoder === 'undefined') global.TextEncoder = NodeTextEncoder;
if (typeof global.TextDecoder === 'undefined') global.TextDecoder = NodeTextDecoder;

// eslint-disable-next-line import/first
import { callClaudeStream } from './agent';

const sse = (events) => {
  const body = events.map(e => `data: ${JSON.stringify(e)}\n\n`).join('');
  return new ReadableStream({
    start(controller) {
      // Découpé en deux morceaux, dont un qui coupe une ligne en plein milieu :
      // le client doit savoir recoller les fragments SSE.
      const cut = Math.floor(body.length / 2);
      controller.enqueue(new TextEncoder().encode(body.slice(0, cut)));
      controller.enqueue(new TextEncoder().encode(body.slice(cut)));
      controller.close();
    },
  });
};

const mockFetch = (impl) => { global.fetch = jest.fn(impl); };

afterEach(() => { delete global.fetch; });

describe('callClaudeStream — cas nominal', () => {
  test('assemble les deltas, retourne le texte de « done » et notifie onDelta', async () => {
    mockFetch(async () => ({
      ok: true,
      body: sse([
        { type: 'delta', chars: 5, text: 'Bonjo' },
        { type: 'delta', chars: 10, text: 'ur les ' },
        { type: 'done', text: 'Bonjour les amis', usage: { input_tokens: 12, output_tokens: 4, model: 'claude-sonnet-4-5' } },
      ]),
    }));
    const seen = [];
    const { text, usage } = await callClaudeStream(
      { messages: [{ role: 'user', content: 'x' }] },
      (t, c) => seen.push([t, c]),
    );
    expect(text).toBe('Bonjour les amis');       // « done » fait foi
    expect(usage.output_tokens).toBe(4);
    expect(seen).toEqual([['Bonjo', 5], ['Bonjour les ', 10]]);
  });

  test('accents non corrompus quand un fragment est coupé en deux', async () => {
    mockFetch(async () => ({
      ok: true,
      body: sse([
        { type: 'delta', chars: 20, text: 'Réglementation à jour, éligibilité' },
        { type: 'done', text: 'Réglementation à jour, éligibilité', usage: {} },
      ]),
    }));
    const { text } = await callClaudeStream({ messages: [] }, () => {});
    expect(text).toBe('Réglementation à jour, éligibilité');
  });
});

describe('callClaudeStream — repli sur le transport classique', () => {
  test('route absente (404) → STREAM_UNAVAILABLE', async () => {
    mockFetch(async () => ({ ok: false, status: 404, body: null }));
    await expect(callClaudeStream({ messages: [] })).rejects.toThrow('STREAM_UNAVAILABLE');
  });

  test('passerelle en erreur (502) → STREAM_UNAVAILABLE', async () => {
    mockFetch(async () => ({ ok: false, status: 502, body: null }));
    await expect(callClaudeStream({ messages: [] })).rejects.toThrow('STREAM_UNAVAILABLE');
  });

  test('fetch qui échoue (réseau coupé) → STREAM_UNAVAILABLE', async () => {
    mockFetch(async () => { throw new Error('Failed to fetch'); });
    await expect(callClaudeStream({ messages: [] })).rejects.toThrow('STREAM_UNAVAILABLE');
  });

  test('flux vide (bufferisé par le proxy, aucun événement) → STREAM_UNAVAILABLE', async () => {
    mockFetch(async () => ({ ok: true, body: sse([]) }));
    await expect(callClaudeStream({ messages: [] })).rejects.toThrow('STREAM_UNAVAILABLE');
  });
});

describe('callClaudeStream — erreur applicative', () => {
  test('événement error → erreur marquée isAppError (pas de repli, message conservé)', async () => {
    mockFetch(async () => ({
      ok: true,
      body: sse([{ type: 'error', error: 'Crédit Anthropic épuisé' }]),
    }));
    await expect(callClaudeStream({ messages: [] })).rejects.toMatchObject({
      message: 'Crédit Anthropic épuisé',
      isAppError: true,
    });
  });
});
