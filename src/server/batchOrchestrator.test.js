const { createBatchOrchestrator, DEFAULT_CONCURRENCY } = require('./batchOrchestrator');

const ITEM_A = { id: 'i1', batch_id: 'b1', article_url: 'https://x.test/a', target_keyword: 'kw a', consigne: null, launched_by: 'u1', launched_by_name: 'Alice' };
const ITEM_B = { id: 'i2', batch_id: 'b1', article_url: 'https://x.test/b', target_keyword: 'kw b', consigne: 'Ajoute un H2', launched_by: 'u1', launched_by_name: 'Alice' };

function makeConn(claimRows = []) {
  return {
    beginTransaction: jest.fn().mockResolvedValue(),
    query: jest.fn()
      .mockResolvedValueOnce([claimRows])
      .mockResolvedValue([{}]),
    commit: jest.fn().mockResolvedValue(),
    rollback: jest.fn().mockResolvedValue(),
    release: jest.fn(),
  };
}

function makeDeps({ claimRows = [], spawnPipelineFn, httpPut, concurrency } = {}) {
  const conn = makeConn(claimRows);
  const getPool = jest.fn(() => ({ getConnection: jest.fn().mockResolvedValue(conn) }));
  const jwt = { sign: jest.fn(() => 'fake-jwt') };
  const put = httpPut || jest.fn().mockResolvedValue({ data: { ok: true, batchStatus: 'running' } });
  const httpClientFactory = jest.fn(() => ({ put }));
  const fetchModelPricing = jest.fn().mockResolvedValue(null);
  const onLog = jest.fn();
  const deps = {
    getPool, jwt, jwtSecret: 'secret', fetchModelPricing,
    apiBaseUrl: 'https://maj.stomos.net/api',
    httpClientFactory, onLog,
    ...(spawnPipelineFn ? { spawnPipelineFn } : {}),
    ...(concurrency ? { concurrency } : {}),
  };
  return { deps, conn, put, httpClientFactory, getPool, onLog };
}

describe('createBatchOrchestrator', () => {
  it('exporte une concurrence par défaut raisonnable', () => {
    expect(DEFAULT_CONCURRENCY).toBeGreaterThan(0);
  });

  it('un tick sans item en_attente ne fait rien (commit sans update)', async () => {
    const { deps, conn } = makeDeps({ claimRows: [] });
    const orch = createBatchOrchestrator(deps);
    await orch.tick();
    expect(conn.commit).toHaveBeenCalledTimes(1);
    expect(conn.query).toHaveBeenCalledTimes(1); // uniquement le SELECT
  });

  it('réclame via FOR UPDATE SKIP LOCKED puis passe les items en_cours', async () => {
    const { deps, conn } = makeDeps({ claimRows: [ITEM_A] });
    const orch = createBatchOrchestrator(deps);
    await orch.tick();
    const [selectSql] = conn.query.mock.calls[0];
    expect(selectSql).toMatch(/FOR UPDATE SKIP LOCKED/);
    expect(selectSql).toMatch(/status = 'en_attente'/);
    const [updateItemsSql, updateItemsParams] = conn.query.mock.calls[1];
    expect(updateItemsSql).toMatch(/UPDATE batch_items SET status='en_cours'/);
    expect(updateItemsParams).toEqual(expect.arrayContaining(['i1']));
    const [updateBatchSql] = conn.query.mock.calls[2];
    expect(updateBatchSql).toMatch(/UPDATE batches SET status='running'/);
  });

  it('lance le pipeline avec les bons champs puis reporte "fait" avec l\'articleId', async () => {
    const spawnPipelineFn = jest.fn().mockResolvedValue({ articleId: 'art-1' });
    const { deps, put } = makeDeps({ claimRows: [ITEM_A], spawnPipelineFn });
    const orch = createBatchOrchestrator(deps);
    await orch.tick();
    while (orch.getActiveCount() > 0) await new Promise((r) => setTimeout(r, 0));

    expect(spawnPipelineFn).toHaveBeenCalledWith(
      expect.objectContaining({
        articleUrl: 'https://x.test/a',
        targetKeyword: 'kw a',
        launchedByUid: 'u1',
        launchedByName: 'Alice',
        apiBaseUrl: 'https://maj.stomos.net/api',
      }),
      expect.anything(),
    );
    expect(put).toHaveBeenCalledWith('/data/batches/b1/items/i1', expect.objectContaining({ status: 'fait', articleId: 'art-1' }));
  });

  it('l\'échec d\'UN item ne bloque pas les autres -- chacun est reporté indépendamment', async () => {
    const spawnPipelineFn = jest.fn()
      .mockResolvedValueOnce({ articleId: 'art-a' })
      .mockRejectedValueOnce(new Error('Audit illisible'));
    const { deps, put } = makeDeps({ claimRows: [ITEM_A, ITEM_B], spawnPipelineFn, concurrency: 2 });
    const orch = createBatchOrchestrator(deps);
    await orch.tick();
    while (orch.getActiveCount() > 0) await new Promise((r) => setTimeout(r, 0));

    expect(put).toHaveBeenCalledWith('/data/batches/b1/items/i1', expect.objectContaining({ status: 'fait', articleId: 'art-a' }));
    expect(put).toHaveBeenCalledWith('/data/batches/b1/items/i2', expect.objectContaining({ status: 'erreur', errorMessage: 'Audit illisible' }));
  });

  it('un item sans mot-clé cible est reporté en erreur SANS jamais lancer le pipeline', async () => {
    const spawnPipelineFn = jest.fn();
    const noKeyword = { ...ITEM_A, target_keyword: null };
    const { deps, put } = makeDeps({ claimRows: [noKeyword], spawnPipelineFn });
    const orch = createBatchOrchestrator(deps);
    await orch.tick();
    while (orch.getActiveCount() > 0) await new Promise((r) => setTimeout(r, 0));

    expect(spawnPipelineFn).not.toHaveBeenCalled();
    expect(put).toHaveBeenCalledWith('/data/batches/b1/items/i1', expect.objectContaining({
      status: 'erreur',
      errorMessage: expect.stringMatching(/mot-clé cible manquant/i),
    }));
  });

  it('ne réclame rien de plus quand tous les créneaux de concurrence sont occupés', async () => {
    let resolveSpawn;
    const spawnPipelineFn = jest.fn(() => new Promise((r) => { resolveSpawn = r; }));
    const { deps, getPool } = makeDeps({ claimRows: [ITEM_A], spawnPipelineFn, concurrency: 1 });
    const orch = createBatchOrchestrator(deps);

    await orch.tick(); // réclame ITEM_A, spawnPipelineFn ne résout jamais encore
    // tick() ne raccroche pas sur processItem (fire-and-forget) : laisse les
    // microtasks internes (fetchModelPricing, buildAuthToken) atteindre
    // spawnPipelineFn avant de vérifier l'état.
    await new Promise((r) => setTimeout(r, 10));
    expect(orch.getActiveCount()).toBe(1);
    expect(spawnPipelineFn).toHaveBeenCalledTimes(1);

    getPool.mockClear();
    await orch.tick(); // aucun créneau libre
    expect(getPool).not.toHaveBeenCalled();

    resolveSpawn({ articleId: 'art-1' });
    while (orch.getActiveCount() > 0) await new Promise((r) => setTimeout(r, 0));
  });

  it('une erreur pendant la réclamation (transaction) fait un rollback et ne plante pas le tick', async () => {
    const conn = {
      beginTransaction: jest.fn().mockResolvedValue(),
      query: jest.fn().mockRejectedValue(new Error('deadlock')),
      commit: jest.fn().mockResolvedValue(),
      rollback: jest.fn().mockResolvedValue(),
      release: jest.fn(),
    };
    const getPool = jest.fn(() => ({ getConnection: jest.fn().mockResolvedValue(conn) }));
    const deps = {
      getPool, jwt: { sign: jest.fn() }, jwtSecret: 's',
      fetchModelPricing: jest.fn(), apiBaseUrl: 'https://x/api',
      onLog: jest.fn(),
    };
    const orch = createBatchOrchestrator(deps);
    await expect(orch.tick()).resolves.toBeUndefined();
    expect(conn.rollback).toHaveBeenCalledTimes(1);
    expect(conn.commit).not.toHaveBeenCalled();
  });

  it('si même le report d\'échec échoue, processItem ne lève pas (capturé jusqu\'au bout)', async () => {
    const spawnPipelineFn = jest.fn().mockRejectedValue(new Error('boum'));
    const put = jest.fn().mockRejectedValue(new Error('HTTP 500'));
    const { deps, onLog } = makeDeps({ claimRows: [ITEM_A], spawnPipelineFn, httpPut: put });
    const orch = createBatchOrchestrator(deps);
    await expect(orch.tick()).resolves.toBeUndefined();
    while (orch.getActiveCount() > 0) await new Promise((r) => setTimeout(r, 0));
    expect(onLog).toHaveBeenCalledWith(expect.stringContaining('impossible de reporter l\'échec'));
  });
});
