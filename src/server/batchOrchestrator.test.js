const { createBatchOrchestrator, DEFAULT_CONCURRENCY } = require('./batchOrchestrator');

const ITEM_A = { id: 'i1', batch_id: 'b1', article_url: 'https://x.test/a', target_keyword: 'kw a', consigne: null, retry_count: 0, launched_by: 'u1', launched_by_name: 'Alice' };
const ITEM_B = { id: 'i2', batch_id: 'b1', article_url: 'https://x.test/b', target_keyword: 'kw b', consigne: 'Ajoute un H2', retry_count: 0, launched_by: 'u1', launched_by_name: 'Alice' };

function makeConn(claimRows = [], activeCount = 0, staleRepaired = 0) {
  return {
    beginTransaction: jest.fn().mockResolvedValue(),
    // Ordre des query() dans claimNext() : 1) verrou `batch_orchestrator_lock`
    // (contenu ignoré) -- 2) remise en file des orphelins (UPDATE, voir
    // "orphelins" plus bas) -- 3) COUNT(*) des en_cours (source du calcul de
    // `limit`, `activeCount` par défaut à 0 = comportement d'avant ce
    // verrou : `limit` == la concurrence demandée) -- 4) le SELECT ... FOR
    // UPDATE SKIP LOCKED qui réclame (claimRows) -- 5+) les UPDATE.
    query: jest.fn()
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([{ affectedRows: staleRepaired }])
      .mockResolvedValueOnce([[{ total: activeCount }]])
      .mockResolvedValueOnce([claimRows])
      .mockResolvedValue([{}]),
    commit: jest.fn().mockResolvedValue(),
    rollback: jest.fn().mockResolvedValue(),
    release: jest.fn(),
  };
}

function makeDeps({
  claimRows = [], activeCount = 0, spawnPipelineFn, httpPut, httpPost, concurrency, onBatchDone,
  getConcurrency, getMaxEssaisIA, getTimeoutMs, getRetryOnError,
} = {}) {
  const conn = makeConn(claimRows, activeCount);
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
    // Réglages "Traitement en lot" (settings.json batchTuning) -- optionnels,
    // seuls les tests qui les exercent explicitement les fournissent.
    ...(getConcurrency ? { getConcurrency } : {}),
    ...(getMaxEssaisIA ? { getMaxEssaisIA } : {}),
    ...(getTimeoutMs ? { getTimeoutMs } : {}),
    ...(getRetryOnError ? { getRetryOnError } : {}),
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
    expect(conn.query).toHaveBeenCalledTimes(4); // verrou + orphelins + COUNT + le SELECT (0 ligne)
  });

  it('réclame via FOR UPDATE SKIP LOCKED puis passe les items en_cours', async () => {
    const { deps, conn } = makeDeps({ claimRows: [ITEM_A] });
    const orch = createBatchOrchestrator(deps);
    await orch.tick();
    // calls[0] = verrou batch_orchestrator_lock, calls[1] = remise en file
    // des orphelins, calls[2] = COUNT(*) en_cours -- voir "verrou global
    // inter-processus" ci-dessus -- calls[3] est le
    // SELECT de réclamation proprement dit.
    const [selectSql] = conn.query.mock.calls[3];
    expect(selectSql).toMatch(/FOR UPDATE SKIP LOCKED/);
    expect(selectSql).toMatch(/status = 'en_attente'/);
    // retry_count sélectionné (décide requeue vs erreur définitive dans
    // processItem) et tri qui fait passer tout item réessayé (requeued_at
    // posé) après tout item jamais réessayé -- `bi.id` seul (UUID aléatoire)
    // ne représente aucun ordre d'arrivée.
    expect(selectSql).toMatch(/bi\.retry_count/);
    expect(selectSql).toMatch(/ORDER BY \(bi\.requeued_at IS NOT NULL\), bi\.requeued_at, bi\.id/);
    const [updateItemsSql, updateItemsParams] = conn.query.mock.calls[4];
    expect(updateItemsSql).toMatch(/UPDATE batch_items SET status='en_cours'/);
    expect(updateItemsParams).toEqual(expect.arrayContaining(['i1']));
    const [updateBatchSql] = conn.query.mock.calls[5];
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
    // Compteur DB simulé (le vrai COUNT(*) que verrait N'IMPORTE QUEL
    // processus) -- distinct du compteur mémoire `active`, qui n'existe que
    // dans CE processus. Après le 1er tick, ITEM_A est en_cours EN BASE, donc
    // ce compteur passe à 1 -- exactement ce que verrait un 2e processus.
    let dbActiveCount = 0;
    const conn = {
      beginTransaction: jest.fn().mockResolvedValue(),
      query: jest.fn((sql) => {
        if (sql.includes('batch_orchestrator_lock')) return Promise.resolve([[]]);
        if (sql.includes('COUNT(*)')) return Promise.resolve([[{ total: dbActiveCount }]]);
        if (sql.includes('FOR UPDATE SKIP LOCKED')) return Promise.resolve([dbActiveCount === 0 ? [ITEM_A] : []]);
        return Promise.resolve([{}]);
      }),
      commit: jest.fn().mockResolvedValue(),
      rollback: jest.fn().mockResolvedValue(),
      release: jest.fn(),
    };
    const getPool = jest.fn(() => ({ getConnection: jest.fn().mockResolvedValue(conn) }));
    const deps = {
      getPool, jwt: { sign: jest.fn(() => 'fake-jwt') }, jwtSecret: 'secret',
      fetchModelPricing: jest.fn().mockResolvedValue(null),
      apiBaseUrl: 'https://maj.stomos.net/api',
      httpClientFactory: jest.fn(() => ({ put: jest.fn().mockResolvedValue({ data: { ok: true } }), post: jest.fn().mockResolvedValue({ data: { ok: true } }) })),
      onLog: jest.fn(),
      spawnPipelineFn,
      concurrency: 1,
    };
    const orch = createBatchOrchestrator(deps);

    await orch.tick(); // réclame ITEM_A, spawnPipelineFn ne résout jamais encore
    dbActiveCount = 1; // reflète l'UPDATE que le vrai claimNext vient de faire
    // tick() ne raccroche pas sur processItem (fire-and-forget) : laisse les
    // microtasks internes (fetchModelPricing, buildAuthToken) atteindre
    // spawnPipelineFn avant de vérifier l'état.
    await new Promise((r) => setTimeout(r, 10));
    expect(orch.getActiveCount()).toBe(1);
    expect(spawnPipelineFn).toHaveBeenCalledTimes(1);

    getPool.mockClear();
    await orch.tick(); // le COUNT global montre déjà 1/1 -- rien à réclamer
    // Contrairement à l'ancien garde-fou mémoire (qui évitait même d'appeler
    // getPool), le tick VÉRIFIE maintenant toujours la base -- seule source
    // de vérité fiable avec plusieurs processus -- mais ne réclame rien de
    // plus.
    expect(getPool).toHaveBeenCalledTimes(1);
    expect(spawnPipelineFn).toHaveBeenCalledTimes(1);

    resolveSpawn({ articleId: 'art-1' });
    while (orch.getActiveCount() > 0) await new Promise((r) => setTimeout(r, 0));
  });

  it("deux tick() qui se chevauchent (claimNext() du 1er encore en vol) : le 2e ne réclame RIEN -- garde anti-recouvrement (voir commentaire `claiming`, incident du 28/09/2026)", async () => {
    let resolveGetConnection;
    const conn = makeConn([ITEM_A]);
    const getPool = jest.fn(() => ({
      // getConnection() ne se résout jamais tant que le test ne le décide pas
      // -- simule un SELECT ... FOR UPDATE qui traîne (base sous charge).
      getConnection: jest.fn(() => new Promise((r) => { resolveGetConnection = r; })),
    }));
    const deps = {
      getPool,
      jwt: { sign: jest.fn(() => 'fake-jwt') },
      jwtSecret: 'secret',
      fetchModelPricing: jest.fn().mockResolvedValue(null),
      apiBaseUrl: 'https://maj.stomos.net/api',
      httpClientFactory: jest.fn(() => ({ put: jest.fn().mockResolvedValue({ data: { ok: true } }), post: jest.fn().mockResolvedValue({ data: { ok: true } }) })),
      onLog: jest.fn(),
      // Stub explicite -- sans lui, processItem() appellerait le VRAI
      // spawnPipeline.js (spawn d'un vrai process enfant), inutile et
      // dangereux dans un test unitaire qui ne teste que la garde `claiming`.
      spawnPipelineFn: jest.fn().mockResolvedValue({ articleId: 'noop' }),
    };
    const orch = createBatchOrchestrator(deps);

    const firstTick = orch.tick(); // reste bloqué sur getConnection()
    await Promise.resolve(); // laisse le 1er tick atteindre claimNext() -> getPool()
    await Promise.resolve();
    expect(getPool).toHaveBeenCalledTimes(1);

    await orch.tick(); // chevauche le 1er : doit être un no-op immédiat (return anticipé)
    expect(getPool).toHaveBeenCalledTimes(1); // toujours 1 -- pas de 2e réclamation

    resolveGetConnection(conn);
    await firstTick;
    expect(getPool).toHaveBeenCalledTimes(1); // le 1er tick n'a réclamé qu'une fois lui-même
  });

  describe("verrou global inter-processus (batch_orchestrator_lock -- incident du 28/09/2026, 2e round : plusieurs processus Passenger tournent en même temps sur l'hébergement mutualisé)", () => {
    it("verrouille batch_orchestrator_lock puis COMPTE les en_cours EN BASE avant de réclamer -- pas seulement le compteur mémoire `active` (qui ne voit rien des AUTRES processus)", async () => {
      const { deps, conn } = makeDeps({ claimRows: [ITEM_A], concurrency: 6 });
      const orch = createBatchOrchestrator(deps);
      await orch.tick();
      const calls = conn.query.mock.calls.map((c) => c[0]);
      expect(calls[0]).toMatch(/batch_orchestrator_lock/);
      expect(calls[0]).toMatch(/FOR UPDATE/);
      expect(calls[2]).toMatch(/COUNT\(\*\)/);
      expect(calls[2]).toMatch(/en_cours/);
    });

    it("un autre processus a déjà 4 items en_cours (activeCount=4) et la concurrence est réglée à 6 -- ce tick ne réclame QUE 2 items, jamais 6", async () => {
      const { deps, conn } = makeDeps({ claimRows: [ITEM_A, ITEM_B], activeCount: 4, concurrency: 6 });
      const orch = createBatchOrchestrator(deps);
      await orch.tick();
      // La requête de réclamation (4e query, après le verrou, les orphelins et le COUNT) doit
      // demander LIMIT 2 (6 - 4), jamais LIMIT 6 -- sinon deux processus qui
      // tournent chacun avec `active` local à 0 mais 4 en_cours posés par
      // l'AUTRE processus repousseraient le total réel à 4+6=10.
      const claimCall = conn.query.mock.calls[3];
      expect(claimCall[1]).toEqual([2]);
    });

    it("un autre processus a DÉJÀ atteint (ou dépassé) la concurrence réglée -- ce tick ne réclame RIEN, sans même tenter le SELECT ... FOR UPDATE SKIP LOCKED", async () => {
      const { deps, conn } = makeDeps({ claimRows: [ITEM_A], activeCount: 6, concurrency: 6 });
      const orch = createBatchOrchestrator(deps);
      await orch.tick();
      expect(orch.getActiveCount()).toBe(0); // rien claimé PAR CE processus
      expect(conn.query).toHaveBeenCalledTimes(3); // verrou + orphelins + COUNT -- jamais le SELECT de réclamation
      expect(conn.commit).toHaveBeenCalledTimes(1); // sortie propre, pas un rollback
    });
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

// ── Réglages "Traitement en lot" dynamiques (Paramètres -> settings.json
// batchTuning) -- lus à chaque tick/item, jamais figés au démarrage du
// process (voir JSDoc de createBatchOrchestrator). Chaque getter est
// optionnel : sans lui, le comportement historique (déjà couvert par les
// tests ci-dessus) ne change pas.
describe('réglages "Traitement en lot" dynamiques (settings.json batchTuning)', () => {
  it('getConcurrency() est consulté à CHAQUE tick, pas seulement à la création', async () => {
    let current = 1;
    const getConcurrency = jest.fn(() => current);
    const spawnPipelineFn = jest.fn(() => new Promise((r) => { resolvers.push(r); }));
    // dbActiveCount simule le COUNT(*) réel -- ITEM_A réclamé au 1er tick
    // reste en_cours (spawnPipelineFn ne résout jamais encore) tant qu'on ne
    // le met pas à jour explicitement, exactement comme le ferait le vrai
    // claimNext() via son UPDATE.
    let dbActiveCount = 0;
    const resolvers = [];
    const claimQueue = [[ITEM_A], [{ ...ITEM_A, id: 'i2' }, { ...ITEM_A, id: 'i3' }]];
    const conn = {
      beginTransaction: jest.fn().mockResolvedValue(),
      query: jest.fn((sql) => {
        if (sql.includes('batch_orchestrator_lock')) return Promise.resolve([[]]);
        if (sql.includes('COUNT(*)')) return Promise.resolve([[{ total: dbActiveCount }]]);
        if (sql.includes('FOR UPDATE SKIP LOCKED')) return Promise.resolve([claimQueue.shift() || []]);
        return Promise.resolve([{}]);
      }),
      commit: jest.fn().mockResolvedValue(),
      rollback: jest.fn().mockResolvedValue(),
      release: jest.fn(),
    };
    const getPool = jest.fn(() => ({ getConnection: jest.fn().mockResolvedValue(conn) }));
    const deps = {
      getPool, jwt: { sign: jest.fn(() => 'fake-jwt') }, jwtSecret: 'secret',
      fetchModelPricing: jest.fn().mockResolvedValue(null),
      apiBaseUrl: 'https://maj.stomos.net/api',
      httpClientFactory: jest.fn(() => ({ put: jest.fn().mockResolvedValue({ data: { ok: true } }), post: jest.fn().mockResolvedValue({ data: { ok: true } }) })),
      onLog: jest.fn(),
      spawnPipelineFn,
      getConcurrency,
    };
    const orch = createBatchOrchestrator(deps);

    await orch.tick();
    dbActiveCount = 1; // ITEM_A est maintenant en_cours EN BASE
    await new Promise((r) => setTimeout(r, 10));
    expect(getConcurrency).toHaveBeenCalled();
    expect(orch.getActiveCount()).toBe(1);

    // Créneau unique (current=1) déjà occupé : un admin qui remonte la
    // concurrence à 3 EN COURS DE ROUTE doit être vu au tick suivant, sans
    // recréer l'orchestrateur ni redémarrer le process -- 2 créneaux de
    // libres maintenant (3 - 1 actif EN BASE), donc 2 nouveaux items réclamés.
    current = 3;
    getPool.mockClear();
    await orch.tick();
    expect(getPool).toHaveBeenCalled();
    await new Promise((r) => setTimeout(r, 10));
    expect(orch.getActiveCount()).toBe(3); // 1 (déjà en cours) + 2 (nouvellement réclamés)

    resolvers.forEach((r) => r({ articleId: 'art-1' }));
    while (orch.getActiveCount() > 0) await new Promise((r) => setTimeout(r, 0));
  });

  it('une erreur dans getConcurrency() retombe sur la valeur figée `concurrency`, sans planter le tick', async () => {
    const getConcurrency = jest.fn(() => { throw new Error('settings.json illisible'); });
    const { deps, conn } = makeDeps({ claimRows: [ITEM_A], concurrency: 1, getConcurrency });
    const orch = createBatchOrchestrator(deps);
    await expect(orch.tick()).resolves.toBeUndefined();
    expect(conn.commit).toHaveBeenCalled();
  });

  it('transmet getMaxEssaisIA() et getTimeoutMs() à spawnPipelineFn (entrée + options)', async () => {
    const spawnPipelineFn = jest.fn().mockResolvedValue({ articleId: 'art-1' });
    const getMaxEssaisIA = jest.fn(() => 3);
    const getTimeoutMs = jest.fn(() => 25 * 60 * 1000);
    const { deps } = makeDeps({ claimRows: [ITEM_A], spawnPipelineFn, getMaxEssaisIA, getTimeoutMs });
    const orch = createBatchOrchestrator(deps);
    await orch.tick();
    while (orch.getActiveCount() > 0) await new Promise((r) => setTimeout(r, 0));

    expect(spawnPipelineFn).toHaveBeenCalledWith(
      expect.objectContaining({ maxEssaisIA: 3 }),
      expect.objectContaining({ timeoutMs: 25 * 60 * 1000 }),
    );
  });

  it('sans getMaxEssaisIA/getTimeoutMs, transmet `undefined` -- spawnPipeline.js/agentQat.js gardent leurs propres défauts', async () => {
    const spawnPipelineFn = jest.fn().mockResolvedValue({ articleId: 'art-1' });
    const { deps } = makeDeps({ claimRows: [ITEM_A], spawnPipelineFn });
    const orch = createBatchOrchestrator(deps);
    await orch.tick();
    while (orch.getActiveCount() > 0) await new Promise((r) => setTimeout(r, 0));

    expect(spawnPipelineFn).toHaveBeenCalledWith(
      expect.objectContaining({ maxEssaisIA: undefined }),
      expect.objectContaining({ timeoutMs: undefined }),
    );
  });

  it('getRetryOnError() === false désactive le réessai -- erreur définitive dès le 1er échec', async () => {
    const spawnPipelineFn = jest.fn().mockRejectedValue(new Error('Audit illisible'));
    const getRetryOnError = jest.fn(() => false);
    const { deps, put, post } = makeDeps({
      claimRows: [{ ...ITEM_A, retry_count: 0 }], spawnPipelineFn, getRetryOnError,
    });
    const orch = createBatchOrchestrator(deps);
    await orch.tick();
    while (orch.getActiveCount() > 0) await new Promise((r) => setTimeout(r, 0));

    expect(post).not.toHaveBeenCalled();
    expect(put).toHaveBeenCalledWith('/data/batches/b1/items/i1', expect.objectContaining({
      status: 'erreur', errorMessage: 'Audit illisible',
    }));
  });

  it('getRetryOnError() absent (défaut) préserve le réessai unique existant', async () => {
    const spawnPipelineFn = jest.fn().mockRejectedValue(new Error('Audit illisible'));
    const { deps, put, post } = makeDeps({ claimRows: [{ ...ITEM_A, retry_count: 0 }], spawnPipelineFn });
    const orch = createBatchOrchestrator(deps);
    await orch.tick();
    while (orch.getActiveCount() > 0) await new Promise((r) => setTimeout(r, 0));

    expect(post).toHaveBeenCalledWith('/data/batches/b1/items/i1/requeue', expect.anything());
    expect(put).not.toHaveBeenCalled();
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

// ── Incident du 01/10/2026 : lot de 8 à 0/8 pendant 4 h ─────────────────────
// Des items "en_cours" orphelins (pipeline mort avec son processus, ou bloqué
// au-delà du délai) occupaient les places de concurrence sans que rien ne les
// libère avant repairZombies (30 min, et seulement au démarrage / toutes les
// 30 min). Chaque réclamation commence maintenant par les remettre en file.
describe('orphelins remis en file à chaque réclamation', () => {
  // Fausse base minimale : interprète les quelques requêtes de claimNext /
  // heartbeat sur un tableau de lignes en mémoire -- assez pour rejouer le
  // scénario de bout en bout (processus mort -> autre processus qui reprend).
  function makeFakeDb(rows) {
    const query = jest.fn(async (sql, params = []) => {
      if (sql.includes('batch_orchestrator_lock')) return [[]];
      if (sql.startsWith('UPDATE batch_items SET status=\'en_attente\'')) {
        const [requeuedAt, cutoff] = params;
        let affectedRows = 0;
        for (const r of rows) {
          if (r.status !== 'en_cours') continue;
          const ref = sql.includes('COALESCE(heartbeat_at')
            ? (r.heartbeat_at ?? r.started_at ?? 0)
            : r.started_at;
          if (ref != null && ref < cutoff) {
            r.status = 'en_attente'; r.started_at = null; r.heartbeat_at = null; r.requeued_at = requeuedAt;
            affectedRows += 1;
          }
        }
        return [{ affectedRows }];
      }
      if (sql.includes('COUNT(*)')) return [[{ total: rows.filter((r) => r.status === 'en_cours').length }]];
      if (sql.includes('FOR UPDATE SKIP LOCKED')) {
        const limit = params[0];
        // Même tri que la vraie requête : jamais réessayé d'abord, puis par requeued_at.
        const waiting = rows.filter((r) => r.status === 'en_attente')
          .sort((a, b) => ((a.requeued_at != null) - (b.requeued_at != null)) || ((a.requeued_at || 0) - (b.requeued_at || 0)));
        return [waiting.slice(0, limit).map((r) => ({ ...r }))];
      }
      if (sql.startsWith('UPDATE batch_items SET status=\'en_cours\'')) {
        const withHb = sql.includes('heartbeat_at');
        const now = params[0];
        const ids = params.slice(withHb ? 2 : 1);
        for (const r of rows) {
          if (ids.includes(r.id)) { r.status = 'en_cours'; r.started_at = now; if (withHb) r.heartbeat_at = params[1]; }
        }
        return [{ affectedRows: ids.length }];
      }
      if (sql.startsWith('UPDATE batch_items SET heartbeat_at')) {
        const now = params[0];
        const ids = params.slice(1);
        let affectedRows = 0;
        for (const r of rows) {
          if (r.status === 'en_cours' && ids.includes(r.id)) { r.heartbeat_at = now; affectedRows += 1; }
        }
        return [{ affectedRows }];
      }
      return [{}];
    });
    const conn = {
      beginTransaction: jest.fn().mockResolvedValue(),
      query,
      commit: jest.fn().mockResolvedValue(),
      rollback: jest.fn().mockResolvedValue(),
      release: jest.fn(),
    };
    const getPool = jest.fn(() => ({ getConnection: jest.fn().mockResolvedValue(conn), query }));
    return { rows, conn, query, getPool };
  }

  const baseDeps = (getPool, extra = {}) => ({
    getPool,
    jwt: { sign: jest.fn(() => 'fake-jwt') },
    jwtSecret: 'secret',
    fetchModelPricing: jest.fn().mockResolvedValue(null),
    apiBaseUrl: 'https://maj.stomos.net/api',
    httpClientFactory: jest.fn(() => ({ put: jest.fn().mockResolvedValue({ data: { ok: true } }), post: jest.fn().mockResolvedValue({ data: { ok: true } }) })),
    onLog: jest.fn(),
    spawnPipelineFn: jest.fn(() => new Promise(() => {})), // pipelines longs, jamais terminés ici
    concurrency: 6,
    ...extra,
  });

  const item = (n, extra = {}) => ({
    id: `x${n}`, batch_id: 'b1', article_url: `https://x.test/${n}`, target_keyword: 'kw',
    consigne: null, retry_count: 0, launched_by: 'u1', launched_by_name: 'Alice',
    status: 'en_attente', started_at: null, heartbeat_at: null, requeued_at: null, ...extra,
  });

  it('avec battement de cœur : 6 orphelins (processus mort il y a 5 min) sont remis en file puis réclamés par un AUTRE processus au tick suivant', async () => {
    const now = Date.now();
    const rows = [
      ...[1, 2, 3, 4, 5, 6].map((n) => item(n, { status: 'en_cours', started_at: now - 10 * 60000, heartbeat_at: now - 5 * 60000 })),
      item(7), item(8),
    ];
    const { getPool } = makeFakeDb(rows);
    const onLog = jest.fn();
    const orch = createBatchOrchestrator(baseDeps(getPool, { getUseHeartbeat: () => true, onLog }));
    await orch.tick();
    await new Promise((r) => setTimeout(r, 10));
    // Les 6 orphelins + les 2 jamais démarrés sont en file ; 6 places -> 6 réclamés.
    expect(rows.filter((r) => r.status === 'en_cours')).toHaveLength(6);
    expect(orch.getActiveCount()).toBe(6);
    expect(onLog).toHaveBeenCalledWith(expect.stringContaining('6 article(s) "en_cours" orphelin(s)'));
    // Les items jamais démarrés passent AVANT les orphelins remis en file (requeued_at posé).
    expect(rows.find((r) => r.id === 'x7').status).toBe('en_cours');
    expect(rows.find((r) => r.id === 'x8').status).toBe('en_cours');
  });

  it('avec battement de cœur : un item qui bat encore (autre processus vivant) n\'est JAMAIS repris', async () => {
    const now = Date.now();
    const rows = [
      item(1, { status: 'en_cours', started_at: now - 40 * 60000, heartbeat_at: now - 20000 }),
      item(2),
    ];
    const { getPool } = makeFakeDb(rows);
    const orch = createBatchOrchestrator(baseDeps(getPool, { getUseHeartbeat: () => true, concurrency: 1 }));
    await orch.tick();
    expect(rows.find((r) => r.id === 'x1').status).toBe('en_cours');
    expect(rows.find((r) => r.id === 'x1').heartbeat_at).toBe(now - 20000);
    // La seule place est prise par x1 (vivant) -> x2 attend.
    expect(rows.find((r) => r.id === 'x2').status).toBe('en_attente');
  });

  it('la réclamation pose le premier battement (heartbeat_at) en même temps que started_at', async () => {
    const rows = [item(1)];
    const { getPool } = makeFakeDb(rows);
    const orch = createBatchOrchestrator(baseDeps(getPool, { getUseHeartbeat: () => true }));
    const before = Date.now();
    await orch.tick();
    expect(rows[0].status).toBe('en_cours');
    expect(rows[0].heartbeat_at).toBeGreaterThanOrEqual(before);
    expect(rows[0].heartbeat_at).toBe(rows[0].started_at);
  });

  it('heartbeat() rafraîchit heartbeat_at des items que CE processus fait tourner -- et seulement ceux-là', async () => {
    const now = Date.now();
    const rows = [item(1), item(9, { status: 'en_cours', started_at: now - 60000, heartbeat_at: now - 60000 })];
    const { getPool } = makeFakeDb(rows);
    const orch = createBatchOrchestrator(baseDeps(getPool, { getUseHeartbeat: () => true, concurrency: 6 }));
    await orch.tick(); // réclame x1 (x9 appartient à un autre processus, encore vivant)
    await new Promise((r) => setTimeout(r, 10));
    const hbBefore = rows[0].heartbeat_at;
    await new Promise((r) => setTimeout(r, 5));
    const updated = await orch.heartbeat();
    expect(updated).toBe(1);
    expect(rows[0].heartbeat_at).toBeGreaterThan(hbBefore);
    expect(rows[1].heartbeat_at).toBe(now - 60000); // pas touché
    expect(orch.getDiagnostics().lastHeartbeat).toMatchObject({ items: 1, updated: 1 });
  });

  it('heartbeat() ne fait rien sans la colonne (getUseHeartbeat absent) ou sans item en cours, et ne lève jamais', async () => {
    const { getPool, query } = makeFakeDb([]);
    const orch = createBatchOrchestrator(baseDeps(getPool));
    await expect(orch.heartbeat()).resolves.toBe(0);
    expect(query).not.toHaveBeenCalled();

    const failing = jest.fn(() => ({ getConnection: jest.fn(), query: jest.fn().mockRejectedValue(new Error('DB down')) }));
    const rows = [item(1)];
    const db = makeFakeDb(rows);
    const orch2 = createBatchOrchestrator(baseDeps(db.getPool, { getUseHeartbeat: () => true }));
    await orch2.tick();
    await new Promise((r) => setTimeout(r, 10));
    // On remplace getPool par une base en panne pour le battement.
    const orch3 = createBatchOrchestrator(baseDeps(failing, { getUseHeartbeat: () => true }));
    await expect(orch3.heartbeat()).resolves.toBe(0); // aucun item actif dans orch3
    await expect(orch2.heartbeat()).resolves.toBe(1);
  });

  it('sans battement de cœur (migration pas encore passée) : orphelin = démarré depuis plus que le délai du pipeline + 5 min', async () => {
    const now = Date.now();
    const rows = [
      item(1, { status: 'en_cours', started_at: now - 26 * 60000 }), // > 20 + 5 min -> orphelin
      item(2, { status: 'en_cours', started_at: now - 10 * 60000 }), // peut encore tourner -> intouché
    ];
    const { getPool, query } = makeFakeDb(rows);
    const orch = createBatchOrchestrator(baseDeps(getPool, { getTimeoutMs: () => 20 * 60000 }));
    await orch.tick();
    const repairCall = query.mock.calls.find(([sql]) => sql.startsWith('UPDATE batch_items SET status=\'en_attente\''));
    expect(repairCall[0]).not.toMatch(/heartbeat_at/);
    const cutoff = repairCall[1][1];
    expect(cutoff).toBeLessThanOrEqual(Date.now() - 25 * 60000);
    expect(cutoff).toBeGreaterThan(now - 25 * 60000 - 1000);
    expect(rows.find((r) => r.id === 'x2').status).toBe('en_cours');
    // x1 remis en file puis aussitôt re-réclamé (place libre).
    expect(rows.find((r) => r.id === 'x1').status).toBe('en_cours');
    expect(rows.find((r) => r.id === 'x1').requeued_at).not.toBeNull();
  });
});

describe('report HTTP avec nouveaux essais (reportRetryDelaysMs)', () => {
  it('un 503 au report "fait" est réessayé, puis réussit -- l\'item n\'est jamais laissé "en_cours"', async () => {
    const put = jest.fn()
      .mockRejectedValueOnce(Object.assign(new Error('Service Unavailable'), { response: { status: 503, data: {} } }))
      .mockResolvedValueOnce({ data: { ok: true } });
    const spawnPipelineFn = jest.fn().mockResolvedValue({ articleId: 'art-1' });
    const sleepFn = jest.fn().mockResolvedValue();
    const { deps, post } = makeDeps({ claimRows: [ITEM_A], spawnPipelineFn, httpPut: put });
    const orch = createBatchOrchestrator({ ...deps, reportRetryDelaysMs: [3000, 10000], sleepFn });
    await orch.tick();
    while (orch.getActiveCount() > 0) await new Promise((r) => setTimeout(r, 0));
    expect(put).toHaveBeenCalledTimes(2);
    expect(sleepFn).toHaveBeenCalledWith(3000);
    expect(put.mock.calls[1][1]).toMatchObject({ status: 'fait', articleId: 'art-1' });
    expect(post).not.toHaveBeenCalled();
  });

  it('une coupure réseau pure (pas de réponse) est aussi réessayée', async () => {
    const put = jest.fn()
      .mockRejectedValueOnce(Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }))
      .mockResolvedValueOnce({ data: { ok: true } });
    const spawnPipelineFn = jest.fn().mockResolvedValue({ articleId: 'art-1' });
    const { deps } = makeDeps({ claimRows: [ITEM_A], spawnPipelineFn, httpPut: put });
    const orch = createBatchOrchestrator({ ...deps, reportRetryDelaysMs: [1], sleepFn: jest.fn().mockResolvedValue() });
    await orch.tick();
    while (orch.getActiveCount() > 0) await new Promise((r) => setTimeout(r, 0));
    expect(put).toHaveBeenCalledTimes(2);
  });

  it('une erreur applicative (400) n\'est PAS réessayée', async () => {
    const put = jest.fn().mockRejectedValue(Object.assign(new Error('Bad Request'), { response: { status: 400, data: {} } }));
    const spawnPipelineFn = jest.fn().mockResolvedValue({ articleId: 'art-1' });
    const sleepFn = jest.fn().mockResolvedValue();
    const { deps } = makeDeps({ claimRows: [{ ...ITEM_A, retry_count: 1 }], spawnPipelineFn, httpPut: put });
    const orch = createBatchOrchestrator({ ...deps, reportRetryDelaysMs: [3000, 10000], sleepFn });
    await orch.tick();
    while (orch.getActiveCount() > 0) await new Promise((r) => setTimeout(r, 0));
    expect(sleepFn).not.toHaveBeenCalled();
  });

  it('un 409 à la remise en file n\'est pas réessayé (déjà réessayé ailleurs) -- bascule sur l\'erreur définitive', async () => {
    const spawnPipelineFn = jest.fn().mockRejectedValue(new Error('Audit illisible'));
    const post = jest.fn().mockRejectedValue(Object.assign(new Error('Conflict'), { response: { status: 409 } }));
    const sleepFn = jest.fn().mockResolvedValue();
    const { deps, put } = makeDeps({ claimRows: [{ ...ITEM_A, retry_count: 0 }], spawnPipelineFn, httpPost: post });
    const orch = createBatchOrchestrator({ ...deps, reportRetryDelaysMs: [3000], sleepFn });
    await orch.tick();
    while (orch.getActiveCount() > 0) await new Promise((r) => setTimeout(r, 0));
    expect(post).toHaveBeenCalledTimes(1);
    expect(sleepFn).not.toHaveBeenCalled();
    expect(put).toHaveBeenCalledWith('/data/batches/b1/items/i1', expect.objectContaining({ status: 'erreur' }));
  });
});

describe('getDiagnostics()', () => {
  it('expose chaque item en cours avec sa dernière étape de pipeline et le dernier bilan de réclamation', async () => {
    let stepCb;
    const spawnPipelineFn = jest.fn((input, opts) => { stepCb = opts.onStep; return new Promise(() => {}); });
    const { deps } = makeDeps({ claimRows: [ITEM_A], spawnPipelineFn, concurrency: 6, activeCount: 2 });
    const orch = createBatchOrchestrator(deps);
    await orch.tick();
    await new Promise((r) => setTimeout(r, 10));
    stepCb('Audit QAT -- essai 1/2');
    const d = orch.getDiagnostics();
    expect(d.activeCount).toBe(1);
    expect(d.lastClaim).toMatchObject({ concurrency: 6, enCours: 2, limit: 4, claimed: 1, staleRepaired: 0 });
    expect(d.items).toHaveLength(1);
    expect(d.items[0]).toMatchObject({ id: 'i1', phase: 'pipeline', lastStep: 'Audit QAT -- essai 1/2' });
    expect(typeof d.items[0].elapsedS).toBe('number');
    expect(d.lastTickAt).toEqual(expect.any(Number));
  });

  it('garde la trace d\'un échec de réclamation', async () => {
    const conn = {
      beginTransaction: jest.fn().mockResolvedValue(),
      query: jest.fn().mockRejectedValue(new Error("Table 'batch_orchestrator_lock' doesn't exist")),
      commit: jest.fn(), rollback: jest.fn().mockResolvedValue(), release: jest.fn(),
    };
    const getPool = jest.fn(() => ({ getConnection: jest.fn().mockResolvedValue(conn) }));
    const orch = createBatchOrchestrator({
      getPool, jwt: { sign: jest.fn() }, jwtSecret: 's', fetchModelPricing: jest.fn(), apiBaseUrl: 'x', onLog: jest.fn(),
    });
    await orch.tick();
    expect(orch.getDiagnostics().lastClaimError).toMatchObject({ message: expect.stringContaining('batch_orchestrator_lock') });
  });
});

describe('panne réseau passagère (incident du 01/10/2026, juste après un déploiement)', () => {
  it('un pipeline qui échoue sur "read ECONNRESET" ne consomme PAS le réessai : ni requeue, ni erreur -- laissé à la reprise des orphelins', async () => {
    const spawnPipelineFn = jest.fn().mockRejectedValue(new Error('read ECONNRESET'));
    const { deps, put, post, onLog } = makeDeps({ claimRows: [{ ...ITEM_A, retry_count: 0, requeued_at: null }], spawnPipelineFn });
    const orch = createBatchOrchestrator(deps);
    await orch.tick();
    while (orch.getActiveCount() > 0) await new Promise((r) => setTimeout(r, 0));
    expect(post).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
    expect(onLog).toHaveBeenCalledWith(expect.stringContaining('réessai non consommé'));
  });

  it('une passerelle 503 est traitée pareil', async () => {
    const spawnPipelineFn = jest.fn().mockRejectedValue(Object.assign(new Error('Service Unavailable'), { response: { status: 503 } }));
    const { deps, put, post } = makeDeps({ claimRows: [{ ...ITEM_A, requeued_at: null }], spawnPipelineFn });
    const orch = createBatchOrchestrator(deps);
    await orch.tick();
    while (orch.getActiveCount() > 0) await new Promise((r) => setTimeout(r, 0));
    expect(post).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });

  it('au plus 3 fois par item : à la 4e panne réseau consécutive du MÊME item, chemin normal (pas de boucle infinie)', async () => {
    const spawnPipelineFn = jest.fn().mockRejectedValue(new Error('read ECONNRESET'));
    // 4 réclamations successives du même item par le même orchestrateur.
    const conns = [1, 2, 3, 4].map(() => makeConn([{ ...ITEM_A, retry_count: 0 }]));
    let call = 0;
    const getPool = jest.fn(() => ({ getConnection: jest.fn().mockResolvedValue(conns[Math.min(call++, 3)]) }));
    const post = jest.fn().mockResolvedValue({ data: { ok: true } });
    const put = jest.fn().mockResolvedValue({ data: { ok: true } });
    const onLog = jest.fn();
    const orch = createBatchOrchestrator({
      getPool, jwt: { sign: jest.fn(() => 'fake-jwt') }, jwtSecret: 's',
      fetchModelPricing: jest.fn().mockResolvedValue(null), apiBaseUrl: 'https://x/api',
      httpClientFactory: jest.fn(() => ({ put, post })), onLog, spawnPipelineFn,
    });
    for (let k = 0; k < 3; k += 1) {
      await orch.tick();
      while (orch.getActiveCount() > 0) await new Promise((r) => setTimeout(r, 0));
    }
    expect(post).not.toHaveBeenCalled();
    expect(onLog).toHaveBeenCalledWith(expect.stringContaining('(3/3)'));
    await orch.tick();
    while (orch.getActiveCount() > 0) await new Promise((r) => setTimeout(r, 0));
    expect(post).toHaveBeenCalledWith('/data/batches/b1/items/i1/requeue', expect.anything());
  });

  it('un item déjà remis en file une fois (requeued_at posé) bénéficie quand même du report : cas réel après chaque redémarrage', async () => {
    const spawnPipelineFn = jest.fn().mockRejectedValue(new Error('read ECONNRESET'));
    const { deps, post, put } = makeDeps({ claimRows: [{ ...ITEM_A, retry_count: 0, requeued_at: 1790000000000 }], spawnPipelineFn });
    const orch = createBatchOrchestrator(deps);
    await orch.tick();
    while (orch.getActiveCount() > 0) await new Promise((r) => setTimeout(r, 0));
    expect(post).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });

  it('une erreur propre à l\'article (audit illisible) suit toujours le chemin normal', async () => {
    const spawnPipelineFn = jest.fn().mockRejectedValue(new Error('Audit illisible ou échoué'));
    const { deps, post } = makeDeps({ claimRows: [{ ...ITEM_A, requeued_at: null }], spawnPipelineFn });
    const orch = createBatchOrchestrator(deps);
    await orch.tick();
    while (orch.getActiveCount() > 0) await new Promise((r) => setTimeout(r, 0));
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('la réclamation sélectionne requeued_at (nécessaire pour ne reprendre qu\'une fois)', async () => {
    const { deps, conn } = makeDeps({ claimRows: [ITEM_A] });
    const orch = createBatchOrchestrator(deps);
    await orch.tick();
    expect(conn.query.mock.calls[3][0]).toMatch(/bi\.requeued_at/);
  });
});

describe('journal : compteurs de progression non journalisés un par un', () => {
  it('"Mise en gras — ~3 186 tokens" met à jour la dernière étape mais n\'est pas envoyé à onLog', async () => {
    let stepCb;
    const spawnPipelineFn = jest.fn((input, opts) => { stepCb = opts.onStep; return new Promise(() => {}); });
    const { deps, onLog } = makeDeps({ claimRows: [ITEM_A], spawnPipelineFn });
    const orch = createBatchOrchestrator(deps);
    await orch.tick();
    await new Promise((r) => setTimeout(r, 10));
    onLog.mockClear();
    stepCb('Mise en gras — ~3,186 tokens');
    stepCb('Audit QAT (estimation) — ~153 tokens');
    expect(onLog).not.toHaveBeenCalled();
    expect(orch.getDiagnostics().items[0].lastStep).toBe('Audit QAT (estimation) — ~153 tokens');
    stepCb('Génération de l\'article...');
    expect(onLog).toHaveBeenCalledWith(expect.stringContaining('Génération de l\'article...'));
  });
});

describe('report en base directe (updateItemFn / requeueItemFn) -- plus d\'appel HTTP vers le serveur lui-même', () => {
  it('un succès est enregistré via updateItemFn, sans aucun appel HTTP', async () => {
    const updateItemFn = jest.fn().mockResolvedValue({ batchStatus: 'running', shouldNotify: false });
    const spawnPipelineFn = jest.fn().mockResolvedValue({ articleId: 'art-1', tokenUsage: { costUsd: 0.2, input: 10, output: 5 } });
    const { deps, put, post, httpClientFactory } = makeDeps({ claimRows: [ITEM_A], spawnPipelineFn });
    const orch = createBatchOrchestrator({ ...deps, updateItemFn, requeueItemFn: jest.fn() });
    await orch.tick();
    while (orch.getActiveCount() > 0) await new Promise((r) => setTimeout(r, 0));
    expect(updateItemFn).toHaveBeenCalledWith(expect.objectContaining({ id: 'i1', batch_id: 'b1' }), expect.objectContaining({ status: 'fait', articleId: 'art-1', costUsd: 0.2 }));
    expect(put).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  });

  it('shouldNotify renvoyé par updateItemFn déclenche onBatchDone (email de fin de lot)', async () => {
    const updateItemFn = jest.fn().mockResolvedValue({ batchStatus: 'done', shouldNotify: true });
    const onBatchDone = jest.fn().mockResolvedValue();
    const spawnPipelineFn = jest.fn().mockResolvedValue({ articleId: 'art-1' });
    const { deps } = makeDeps({ claimRows: [ITEM_A], spawnPipelineFn, onBatchDone });
    const orch = createBatchOrchestrator({ ...deps, updateItemFn });
    await orch.tick();
    while (orch.getActiveCount() > 0) await new Promise((r) => setTimeout(r, 0));
    expect(onBatchDone).toHaveBeenCalledWith('b1');
  });

  it('un 1er échec passe par requeueItemFn ; false (déjà réessayé) bascule sur l\'erreur définitive via updateItemFn', async () => {
    const updateItemFn = jest.fn().mockResolvedValue({ batchStatus: 'running', shouldNotify: false });
    const requeueItemFn = jest.fn().mockResolvedValue(false);
    const spawnPipelineFn = jest.fn().mockRejectedValue(new Error('Audit illisible'));
    const { deps, put, post } = makeDeps({ claimRows: [{ ...ITEM_A, retry_count: 0 }], spawnPipelineFn });
    const orch = createBatchOrchestrator({ ...deps, updateItemFn, requeueItemFn });
    await orch.tick();
    while (orch.getActiveCount() > 0) await new Promise((r) => setTimeout(r, 0));
    expect(requeueItemFn).toHaveBeenCalledWith(expect.objectContaining({ id: 'i1' }), expect.stringContaining('Audit illisible'));
    expect(updateItemFn).toHaveBeenCalledWith(expect.objectContaining({ id: 'i1' }), expect.objectContaining({ status: 'erreur' }));
    expect(put).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  });

  it('une erreur base passagère pendant le report est réessayée (reportRetryDelaysMs)', async () => {
    const updateItemFn = jest.fn()
      .mockRejectedValueOnce(new Error('Lock wait timeout exceeded'))
      .mockResolvedValueOnce({ batchStatus: 'running', shouldNotify: false });
    const sleepFn = jest.fn().mockResolvedValue();
    const spawnPipelineFn = jest.fn().mockResolvedValue({ articleId: 'art-1' });
    const { deps } = makeDeps({ claimRows: [ITEM_A], spawnPipelineFn });
    const orch = createBatchOrchestrator({ ...deps, updateItemFn, reportRetryDelaysMs: [3000], sleepFn });
    await orch.tick();
    while (orch.getActiveCount() > 0) await new Promise((r) => setTimeout(r, 0));
    expect(updateItemFn).toHaveBeenCalledTimes(2);
    expect(sleepFn).toHaveBeenCalledWith(3000);
  });
});
