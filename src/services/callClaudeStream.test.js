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

describe('callClaudeStream — authentification', () => {
  test('envoie le header Authorization depuis sessionStorage', async () => {
    sessionStorage.setItem('tonton_auth_token', 'jeton-de-test');
    mockFetch(async () => ({ ok: true, body: sse([{ type: 'done', text: 'ok', usage: {} }]) }));
    await callClaudeStream({ messages: [] }, () => {});
    const [, init] = global.fetch.mock.calls[0];
    expect(init.headers.Authorization).toBe('Bearer jeton-de-test');
    sessionStorage.removeItem('tonton_auth_token');
  });

  test('sans token, aucun header Authorization (et non « Bearer null »)', async () => {
    sessionStorage.removeItem('tonton_auth_token');
    mockFetch(async () => ({ ok: true, body: sse([{ type: 'done', text: 'ok', usage: {} }]) }));
    await callClaudeStream({ messages: [] }, () => {});
    const [, init] = global.fetch.mock.calls[0];
    expect(init.headers.Authorization).toBeUndefined();
  });

  test('401 → STREAM_UNAVAILABLE avec le statut, pour que le repli axios gère la redirection', async () => {
    mockFetch(async () => ({ ok: false, status: 401, body: null }));
    await expect(callClaudeStream({ messages: [] })).rejects.toMatchObject({
      message: 'STREAM_UNAVAILABLE',
      status: 401,
    });
  });
});

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

  test('flux coupé AVANT « done » → réponse tronquée, donc repli et non un JSON amputé', async () => {
    mockFetch(async () => ({
      ok: true,
      body: sse([
        { type: 'delta', chars: 12, text: '{"scores":{' },
        { type: 'delta', chars: 24, text: '"ia":7,"geo":' },
      ]),
    }));
    await expect(callClaudeStream({ messages: [] }, () => {})).rejects.toMatchObject({
      message: 'STREAM_UNAVAILABLE',
      truncated: true,
    });
  });

  test('lecture qui échoue en cours de route → STREAM_UNAVAILABLE (pas de texte partiel rendu)', async () => {
    mockFetch(async () => ({
      ok: true,
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('data: {"type":"delta","chars":3,"text":"abc"}\n\n'));
          controller.error(new Error('connexion réinitialisée'));
        },
      }),
    }));
    await expect(callClaudeStream({ messages: [] }, () => {})).rejects.toThrow('STREAM_UNAVAILABLE');
  });

  test('annulation par l\'appelant (signal) → STREAM_UNAVAILABLE', async () => {
    const ac = new AbortController();
    ac.abort();
    mockFetch(async (_url, init) => {
      if (init?.signal?.aborted) throw new Error('The operation was aborted');
      return { ok: true, body: sse([{ type: 'done', text: 'x', usage: {} }]) };
    });
    await expect(callClaudeStream({ messages: [] }, () => {}, ac.signal)).rejects.toThrow('STREAM_UNAVAILABLE');
  });
});

describe('callClaudeStream — classification des erreurs du flux', () => {
  // DÉFINITIVES : le repli sur job + polling échouerait à l'identique en coûtant
  // plusieurs minutes. On remonte le message, il est actionnable tel quel.
  const definitives = [
    ['crédits épuisés',        'Crédits Anthropic épuisés — le compte doit être rechargé.'],
    ['compte désactivé',       "Erreur lors de l'appel à l'IA — This organization has been disabled."],
    ['clé invalide',           'Clé API Anthropic invalide ou expirée — prévenez un administrateur.'],
    ['article trop volumineux', 'Article trop volumineux pour le modèle — réduisez le contenu.'],
    ['délai dépassé',          'Délai dépassé (analyse > 10 min) — réessayez.'],
  ];

  test.each(definitives)('%s → isAppError, message conservé, pas de repli', async (_l, message) => {
    mockFetch(async () => ({ ok: true, body: sse([{ type: 'error', error: message }]) }));
    await expect(callClaudeStream({ messages: [] })).rejects.toMatchObject({ message, isAppError: true });
  });

  // TRANSPORT : le transport job + polling porte ses propres relances et a de
  // bonnes chances d'aboutir — il FAUT se rabattre.
  const transports = [
    ['socket hang up',      "Erreur lors de l'appel à l'IA — socket hang up"],
    ['connexion coupée',    "Erreur lors de l'appel à l'IA — ECONNRESET"],
    ['IA surchargée',       "L'IA (Anthropic) est momentanément surchargée — réessayez dans quelques instants."],
  ];

  test.each(transports)('%s → STREAM_UNAVAILABLE, repli déclenché', async (_l, message) => {
    mockFetch(async () => ({ ok: true, body: sse([{ type: 'error', error: message }]) }));
    await expect(callClaudeStream({ messages: [] })).rejects.toMatchObject({
      message: 'STREAM_UNAVAILABLE',
      streamError: message,
    });
  });
});
