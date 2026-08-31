const { describeHttpError } = require('./httpErrorDetail');

describe('describeHttpError', () => {
  it('déplie une erreur axios avec un corps JSON {error}', () => {
    const e = {
      message: 'Request failed with status code 500',
      config: { method: 'post', url: '/api/claude-job' },
      response: { status: 500, data: { error: 'ANTHROPIC_API_KEY manquante' } },
    };
    expect(describeHttpError(e)).toBe('HTTP 500 sur POST /api/claude-job — ANTHROPIC_API_KEY manquante');
  });

  it('retombe sur {detail} si {error} est absent', () => {
    const e = { config: { method: 'get', url: '/api/brave' }, response: { status: 502, data: { detail: 'Timeout amont' } } };
    expect(describeHttpError(e)).toBe('HTTP 502 sur GET /api/brave — Timeout amont');
  });

  it('nettoie un corps HTML (fallback SPA / page d\'erreur Express par défaut)', () => {
    const e = {
      config: { method: 'post', url: '/api/api/tavily' },
      response: { status: 500, data: '<html><body><h1>Internal Server Error</h1></body></html>' },
    };
    expect(describeHttpError(e)).toBe('HTTP 500 sur POST /api/api/tavily — Internal Server Error');
  });

  it('sans corps exploitable, garde au moins statut + méthode + URL', () => {
    const e = { config: { method: 'get', url: '/api/data/articles' }, response: { status: 503, data: null } };
    expect(describeHttpError(e)).toBe('HTTP 503 sur GET /api/data/articles');
  });

  it('sans config (erreur axios minimale), affiche "?" plutôt que de planter', () => {
    const e = { response: { status: 500, data: { error: 'x' } } };
    expect(describeHttpError(e)).toBe('HTTP 500 sur ? ? — x');
  });

  it('erreur non-axios (pas de e.response) -- retombe sur e.message tel quel', () => {
    expect(describeHttpError(new Error('Contenu de l\'article vide après scraping')))
      .toBe('Contenu de l\'article vide après scraping');
  });

  it('erreur réseau (pas de réponse du tout) -- retombe sur e.message', () => {
    const e = { message: 'connect ECONNREFUSED 127.0.0.1:3001', code: 'ECONNREFUSED' };
    expect(describeHttpError(e)).toBe('connect ECONNREFUSED 127.0.0.1:3001');
  });

  it('entrée vide/nulle ne plante jamais', () => {
    expect(describeHttpError(null)).toBe('Erreur inconnue');
    expect(describeHttpError(undefined)).toBe('Erreur inconnue');
  });

  it('tronque un corps JSON sans champ reconnu à 300 caractères', () => {
    const bigObj = { foo: 'x'.repeat(400) };
    const e = { config: { method: 'get', url: '/api/x' }, response: { status: 500, data: bigObj } };
    const result = describeHttpError(e);
    expect(result.startsWith('HTTP 500 sur GET /api/x — ')).toBe(true);
    expect(result.length).toBeLessThan(350);
  });
});
