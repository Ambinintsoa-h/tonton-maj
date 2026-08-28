import { listBatches, getBatch, createBatch, updateBatchItem } from './batches';
import { resetSessionExpiry, isSessionExpired } from './sessionExpiry';

const jsonResponse = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: () => 'application/json' },
  json: async () => body,
  text: async () => JSON.stringify(body),
});

beforeEach(() => {
  resetSessionExpiry();
  sessionStorage.setItem('tonton_auth_token', 'jeton-de-test');
  global.fetch = jest.fn();
});

describe('listBatches', () => {
  it('appelle GET /api/data/batches avec la limite en query', async () => {
    global.fetch.mockResolvedValue(jsonResponse([{ id: 'b1' }]));
    const out = await listBatches(50);
    expect(global.fetch).toHaveBeenCalledWith('/api/data/batches?limit=50', expect.objectContaining({ method: 'GET' }));
    expect(out).toEqual([{ id: 'b1' }]);
  });

  it('utilise 20 par défaut', async () => {
    global.fetch.mockResolvedValue(jsonResponse([]));
    await listBatches();
    expect(global.fetch).toHaveBeenCalledWith('/api/data/batches?limit=20', expect.anything());
  });
});

describe('getBatch', () => {
  it('appelle GET /api/data/batches/:id', async () => {
    global.fetch.mockResolvedValue(jsonResponse({ id: 'b1', items: [] }));
    const out = await getBatch('b1');
    expect(global.fetch).toHaveBeenCalledWith('/api/data/batches/b1', expect.objectContaining({ method: 'GET' }));
    expect(out).toEqual({ id: 'b1', items: [] });
  });
});

describe('createBatch', () => {
  it('poste le payload en JSON, jamais launchedBy/launchedByName -- c\'est le serveur qui les fixe', async () => {
    global.fetch.mockResolvedValue(jsonResponse({ id: 'b2' }));
    const payload = { source: 'manual', items: [{ articleUrl: 'https://x.test/a', majType: 'maj' }] };
    const out = await createBatch(payload);
    expect(global.fetch).toHaveBeenCalledWith('/api/data/batches', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify(payload),
      headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
    }));
    expect(out).toEqual({ id: 'b2' });
  });
});

describe('updateBatchItem', () => {
  it('appelle PUT /api/data/batches/:batchId/items/:itemId', async () => {
    global.fetch.mockResolvedValue(jsonResponse({ ok: true, batchStatus: 'running' }));
    await updateBatchItem('b1', 'i1', { status: 'fait' });
    expect(global.fetch).toHaveBeenCalledWith('/api/data/batches/b1/items/i1', expect.objectContaining({
      method: 'PUT',
      body: JSON.stringify({ status: 'fait' }),
    }));
  });
});

describe('erreurs', () => {
  it('un 401 signale la session expirée et lève', async () => {
    global.fetch.mockResolvedValue(jsonResponse({ error: 'nope' }, 401));
    await expect(listBatches()).rejects.toThrow(/session expirée/);
    expect(isSessionExpired()).toBe(true);
  });

  it('un statut non-ok lève avec le corps de la réponse', async () => {
    global.fetch.mockResolvedValue(jsonResponse({ error: 'items requis' }, 400));
    await expect(createBatch({ items: [] })).rejects.toThrow(/HTTP 400/);
  });
});
