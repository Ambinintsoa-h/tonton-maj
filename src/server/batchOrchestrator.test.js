const { createBatchOrchestrator, DEFAULT_CONCURRENCY } = require('./batchOrchestrator');

const ITEM_A = { id: 'i1', batch_id: 'b1', article_url: 'https://x.test/a', target_keyword: 'kw a', consigne: null, retry_count: 0, launched_by: 'u1', launched_by_name: 'Alice' };
const ITEM_B = { id: 'i2', batch_id: 'b1', article_url: 'https://x.test/b', target_keyword: 'kw b', consigne: 'Ajoute un H2', retry_count: 0, launched_by: 'u1', launched_by_name: 'Alice' };

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

function makeDeps({ claimRows = [], spawnPipelineFn, httpPut, httpPost, concurrency, onBatchDone } = {}) {
  const conn = makeConn(claimRows);
  const getPool = jest.fn(() => ({ getConnection: jest.fn().mockResolvedValue(conn) }));
  const jwt = { sign: jest.fn(() => 'fake-jwt') };
  const put = httpPut || jest.fn().mockResolvedValue({ data: { ok: true, batchStatus: 'running' } });
  // Défaut : requeue toujours accepté (POST .../requeue, voir data-api.js) --
  // un test qui veut simuler un 409 (déjà réessayé entre-temps) ou une panne
  // passe son propre `httpPost`.
  const post = httpPost || jest.fn().mockResolvedValue({ data: { ok: true } });
  const httpClientFactory = jest.fn(() => ({ put, post }));
  const fetchModelPricing = jest.fn().mockResolvedValue(null);
  const onLog = jest.fn();
  const deps = {
    getPool, jwt, jwtSecret: 'secret', fetchModelPricing,
    apiBaseUrl: 'https://maj.stomos.net/api',
    httpClientFactory, onLog,
    ...(spawnPipelineFn ? { spawnPipelineFn } : {}),
    ...(concurrency ? { concurrency } : {}),
    ...(onBatchDone ? { onBatchDone } : {}),
  };
  return { deps, conn, put, post, httpClientFactory, getPool, onLog };
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
    // retry_count sélectionné (décide requeue vs erreur définitive dans
    // processItem) et tri qui fait passer tout item réessayé (requeued_at
    // posé) après tout item jamais réessayé -- `bi.id` seul (UUID aléatoire)
    // ne représente aucun ordre d'arrivée.
    expect(selectSql).toMatch(/bi\.retry_count/);
    expect(selectSql).toMatch(/ORDER BY \(bi\.requeued_at IS NOT NULL\), bi\.requeued_at, bi\.id/);
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

  it('reporte le coût/tokens réels sur un succès -- supervision Phase 8', async () => {
    const spawnPipelineFn = jest.fn().mockResolvedValue({
      articleId: 'art-1',
      tokenUsage: { input: 12000, output: 3000, costUsd: 0.087 },
    });
    const { deps, put } = makeDeps({ claimRows: [ITEM_A], spawnPipelineFn });
    const orch = createBatchOrchestrator(deps);
    await orch.tick();
    while (orch.getActiveCount() > 0) await new Promise((r) => setTimeout(r, 0));

    expect(put).toHaveBeenCalledWith('/data/batches/b1/items/i1', expect.objectContaining({
      costUsd: 0.087, inputTokens: 12000, outputTokens: 3000,
    }));
  });

  it('ne reporte AUCUN coût sur un échec définitif -- le pipeline ne renvoie pas de tokenUsage partiel', async () => {
    // retry_count: 1 -- déjà réessayé une fois, CET échec est définitif
    // (sinon le premier échec part en requeue/POST, jamais en PUT).
    const spawnPipelineFn = jest.fn().mockRejectedValue(new Error('Audit illisible'));
    const { deps, put } = makeDeps({ claimRows: [{ ...ITEM_A, retry_count: 1 }], spawnPipelineFn });
    const orch = createBatchOrchestrator(deps);
    await orch.tick();
    while (orch.getActiveCount() > 0) await new Promise((r) => setTimeout(r, 0));

    const [, patch] = put.mock.calls[0];
    expect(patch).not.toHaveProperty('costUsd');
    expect(patch).not.toHaveProperty('inputTokens');
  });

  it('l\'échec d\'UN item ne bloque pas les autres -- chacun est reporté indépendamment', async () => {
    // ITEM_B à retry_count: 1 -- son échec ici est le SECOND (définitif),
    // pour tester le report PUT/erreur indépendamment du requeue (testé
    // séparément ci-dessous).
    const spawnPipelineFn = jest.fn()
      .mockResolvedValueOnce({ articleId: 'art-a' })
      .mockRejectedValueOnce(new Error('Audit illisible'));
    const { deps, put } = makeDeps({ claimRows: [ITEM_A, { ...ITEM_B, retry_count: 1 }], spawnPipelineFn, concurrency: 2 });
    const orch = createBatchOrchestrator(deps);
    await orch.tick();
    while (orch.getActiveCount() > 0) await new Promise((r) => setTimeout(r, 0));

    expect(put).toHaveBeenCalledWith('/data/batches/b1/items/i1', expect.objectContaining({ status: 'fait', articleId: 'art-a' }));
    expect(put).toHaveBeenCalledWith('/data/batches/b1/items/i2', expect.objectContaining({ status: 'erreur', errorMessage: 'Audit illisible' }));
  });

  it('un item sans mot-clé cible (déjà réessayé) est reporté en erreur SANS jamais lancer le pipeline', async () => {
    const spawnPipelineFn = jest.fn();
    const noKeyword = { ...ITEM_A, target_keyword: null, retry_count: 1 };
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

  it('un item sans mot-clé cible (1er essai) est remis en file plutôt que reporté en erreur tout de suite', async () => {
    // Décision Andrianina, 28 septembre 2026 : le réessai unique s'applique à
    // TOUTE cause d'échec, y compris une ligne mal saisie -- pas de cas
    // particulier qui court-circuiterait handleFailure.
    const spawnPipelineFn = jest.fn();
    const noKeyword = { ...ITEM_A, target_keyword: null, retry_count: 0 };
    const { deps, put, post } = makeDeps({ claimRows: [noKeyword], spawnPipelineFn });
    const orch = createBatchOrchestrator(deps);
    await orch.tick();
    while (orch.getActiveCount() > 0) await new Promise((r) => setTimeout(r, 0));

    expect(spawnPipelineFn).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
    expect(post).toHaveBeenCalledWith(
      '/data/batches/b1/items/i1/requeue',
      expect.objectContaining({ errorMessage: expect.stringMatching(/mot-clé cible manquant/i) }),
    );
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
    // retry_count: 1 -- échec définitif, passe par reportOutcome/PUT (pas
    // par le requeue, testé séparément plus bas).
    const spawnPipelineFn = jest.fn().mockRejectedValue(new Error('boum'));
    const put = jest.fn().mockRejectedValue(new Error('HTTP 500'));
    const { deps, onLog } = makeDeps({ claimRows: [{ ...ITEM_A, retry_count: 1 }], spawnPipelineFn, httpPut: put });
    const orch = createBatchOrchestrator(deps);
    await expect(orch.tick()).resolves.toBeUndefined();
    while (orch.getActiveCount() > 0) await new Promise((r) => setTimeout(r, 0));
    expect(onLog).toHaveBeenCalledWith(expect.stringContaining('impossible de reporter l\'échec'));
  });

  it('appelle onBatchDone quand le report renvoie shouldNotify:true (dernier item du lot)', async () => {
    const spawnPipelineFn = jest.fn().mockResolvedValue({ articleId: 'art-1' });
    const put = jest.fn().mockResolvedValue({ data: { ok: true, batchStatus: 'done', shouldNotify: true } });
    const onBatchDone = jest.fn().mockResolvedValue();
    const { deps } = makeDeps({ claimRows: [ITEM_A], spawnPipelineFn, httpPut: put, onBatchDone });
    const orch = createBatchOrchestrator(deps);
    await orch.tick();
    while (orch.getActiveCount() > 0) await new Promise((r) => setTimeout(r, 0));
    expect(onBatchDone).toHaveBeenCalledWith('b1');
  });

  it('n\'appelle PAS onBatchDone quand shouldNotify est absent -- pas le dernier item', async () => {
    const spawnPipelineFn = jest.fn().mockResolvedValue({ articleId: 'art-1' });
    const put = jest.fn().mockResolvedValue({ data: { ok: true, batchStatus: 'running' } });
    const onBatchDone = jest.fn().mockResolvedValue();
    const { deps } = makeDeps({ claimRows: [ITEM_A], spawnPipelineFn, httpPut: put, onBatchDone });
    const orch = createBatchOrchestrator(deps);
    await orch.tick();
    while (orch.getActiveCount() > 0) await new Promise((r) => setTimeout(r, 0));
    expect(onBatchDone).not.toHaveBeenCalled();
  });

  it('un onBatchDone qui échoue ne fait pas planter processItem', async () => {
    const spawnPipelineFn = jest.fn().mockResolvedValue({ articleId: 'art-1' });
    const put = jest.fn().mockResolvedValue({ data: { ok: true, batchStatus: 'done', shouldNotify: true } });
    const onBatchDone = jest.fn().mockRejectedValue(new Error('SMTP down'));
    const { deps, onLog } = makeDeps({ claimRows: [ITEM_A], spawnPipelineFn, httpPut: put, onBatchDone });
    const orch = createBatchOrchestrator(deps);
    await expect(orch.tick()).resolves.toBeUndefined();
    while (orch.getActiveCount() > 0) await new Promise((r) => setTimeout(r, 0));
    expect(onLog).toHaveBeenCalledWith(expect.stringContaining('Notification de fin échouée'));
  });

  // ── Réessai automatique après échec (décision Andrianina, 28 septembre 2026) ─
  describe('réessai automatique après échec (retry_count)', () => {
    it('un 1er échec (retry_count=0) est remis en file via POST .../requeue, jamais reporté en erreur', async () => {
      const spawnPipelineFn = jest.fn().mockRejectedValue(new Error('Audit illisible'));
      const { deps, put, post } = makeDeps({ claimRows: [{ ...ITEM_A, retry_count: 0 }], spawnPipelineFn });
      const orch = createBatchOrchestrator(deps);
      await orch.tick();
      while (orch.getActiveCount() > 0) await new Promise((r) => setTimeout(r, 0));

      expect(post).toHaveBeenCalledWith(
        '/data/batches/b1/items/i1/requeue',
        expect.objectContaining({ errorMessage: expect.stringContaining('Audit illisible') }),
      );
      expect(put).not.toHaveBeenCalled();
    });

    it('un 2e échec (retry_count=1, déjà réessayé) est reporté en erreur DÉFINITIVE, sans nouveau requeue', async () => {
      const spawnPipelineFn = jest.fn().mockRejectedValue(new Error('Audit illisible, encore'));
      const { deps, put, post } = makeDeps({ claimRows: [{ ...ITEM_A, retry_count: 1 }], spawnPipelineFn });
      const orch = createBatchOrchestrator(deps);
      await orch.tick();
      while (orch.getActiveCount() > 0) await new Promise((r) => setTimeout(r, 0));

      expect(post).not.toHaveBeenCalled();
      expect(put).toHaveBeenCalledWith('/data/batches/b1/items/i1', expect.objectContaining({
        status: 'erreur', errorMessage: 'Audit illisible, encore',
      }));
    });

    it('un 409 au requeue (déjà réessayé entre-temps par un autre tick) bascule sur l\'erreur définitive', async () => {
      const spawnPipelineFn = jest.fn().mockRejectedValue(new Error('Audit illisible'));
      const post = jest.fn().mockRejectedValue(Object.assign(new Error('Conflict'), { response: { status: 409 } }));
      const { deps, put } = makeDeps({ claimRows: [{ ...ITEM_A, retry_count: 0 }], spawnPipelineFn, httpPost: post });
      const orch = createBatchOrchestrator(deps);
      await orch.tick();
      while (orch.getActiveCount() > 0) await new Promise((r) => setTimeout(r, 0));

      expect(post).toHaveBeenCalledTimes(1);
      expect(put).toHaveBeenCalledWith('/data/batches/b1/items/i1', expect.objectContaining({ status: 'erreur' }));
    });

    it('un requeue qui échoue pour de bon (HTTP down, pas un 409) bascule aussi sur l\'erreur définitive', async () => {
      const spawnPipelineFn = jest.fn().mockRejectedValue(new Error('Audit illisible'));
      const post = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
      const { deps, put, onLog } = makeDeps({ claimRows: [{ ...ITEM_A, retry_count: 0 }], spawnPipelineFn, httpPost: post });
      const orch = createBatchOrchestrator(deps);
      await orch.tick();
      while (orch.getActiveCount() > 0) await new Promise((r) => setTimeout(r, 0));

      expect(put).toHaveBeenCalledWith('/data/batches/b1/items/i1', expect.objectContaining({ status: 'erreur' }));
      expect(onLog).toHaveBeenCalledWith(expect.stringContaining('échec de la remise en file'));
    });
  });
});

describe('repairZombies', () => {
  function makeRepairDeps(queryResult) {
    const query = jest.fn().mockResolvedValue([queryResult]);
    const getPool = jest.fn(() => ({ query, getConnection: jest.fn() }));
    const onLog = jest.fn();
    const deps = {
      getPool, jwt: { sign: jest.fn() }, jwtSecret: 'secret',
      fetchModelPricing: jest.fn().mockResolvedValue(null),
      apiBaseUrl: 'https://maj.stomos.net/api',
      httpClientFactory: jest.fn(() => ({ put: jest.fn() })),
      onLog,
    };
    return { deps, query, onLog };
  }

  it('remet en_attente les items en_cours bloqués depuis plus de 30 min et journalise', async () => {
    const { deps, query, onLog } = makeRepairDeps({ affectedRows: 8 });
    const orch = createBatchOrchestrator(deps);
    const repaired = await orch.repairZombies();
    expect(repaired).toBe(8);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/UPDATE batch_items SET status='en_attente', started_at=NULL/);
    expect(sql).toMatch(/WHERE status='en_cours' AND started_at IS NOT NULL AND started_at < \?/);
    expect(params).toHaveLength(1);
    expect(typeof params[0]).toBe('number');
    expect(onLog).toHaveBeenCalledWith(expect.stringContaining('8 article(s)'));
    expect(onLog).toHaveBeenCalledWith(expect.stringContaining('redémarrage serveur'));
  });

  it('ne journalise rien quand aucun item n\'est réparé', async () => {
    const { deps, onLog } = makeRepairDeps({ affectedRows: 0 });
    const orch = createBatchOrchestrator(deps);
    const repaired = await orch.repairZombies();
    expect(repaired).toBe(0);
    expect(onLog).not.toHaveBeenCalled();
  });

  it('calcule le cutoff sur un seuil de 30 minutes', async () => {
    const { deps, query } = makeRepairDeps({ affectedRows: 0 });
    const before = Date.now();
    const orch = createBatchOrchestrator(deps);
    await orch.repairZombies();
    const after = Date.now();
    const [, params] = query.mock.calls[0];
    const cutoff = params[0];
    expect(cutoff).toBeGreaterThanOrEqual(before - 30 * 60 * 1000);
    expect(cutoff).toBeLessThanOrEqual(after - 30 * 60 * 1000);
  });
});
