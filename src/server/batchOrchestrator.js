/**
 * src/server/batchOrchestrator.js — file d'exécution des batches (Phase 5).
 *
 * Ce module ne réimplémente RIEN du métier : il réclame les `batch_items` en
 * attente puis délègue chaque article au runner headless de la Phase 1
 * (`spawnPipeline` → `pipelineCli.js` → `runArticlePipeline`), exactement
 * comme le fait déjà `POST /api/internal/run-article-pipeline` pour un seul
 * article. Trois responsabilités, rien d'autre :
 *
 *   1. RÉCLAMER — `SELECT ... FOR UPDATE SKIP LOCKED` : sûr même si plusieurs
 *      process Passenger tournent en même temps sur le même serveur (aucun
 *      verrou applicatif ne protégerait ça, seul MySQL le peut).
 *   2. LANCER — borné par `concurrency`, un pipeline par item réclamé.
 *   3. REPORTER — `PUT /api/data/batches/:id/items/:itemId`, l'endpoint qui
 *      recalcule déjà les compteurs/statut du batch parent (Phase 2) : cette
 *      logique ne doit exister qu'à UN endroit, jamais dupliquée ici.
 *
 * L'échec d'UN article ne bloque jamais les autres : chaque item tourne dans
 * sa propre promesse, capturée individuellement (voir Phase 1, même règle
 * pour les passes IA à l'intérieur d'un seul article).
 *
 * Jamais de publication : le pipeline s'arrête à la relecture (voir
 * pipeline.js), un humain publie ensuite depuis l'écran habituel.
 */
const crypto = require('crypto');
const axios = require('axios');
const {
  spawnPipeline: defaultSpawnPipeline,
  DEFAULT_TIMEOUT_MS: DEFAULT_PIPELINE_TIMEOUT_MS,
} = require('./spawnPipeline');
const { describeHttpError } = require('./httpErrorDetail');

// Passé de 2 à 4 le 1er septembre 2026, puis de 4 à 8 le 24 septembre 2026,
// puis REDESCENDU à 6 le 28 septembre 2026 (décision Andrianina à chaque
// fois) : le passage à 8 a bien fait constater le ralentissement redouté par
// le commentaire d'origine -- le limiteur interne 60 req/min (proxy.js,
// partagé avec le reste de l'équipe) encaisse mal 2x le trafic instantané
// vers l'API Anthropic, et la contention qui en résulte (retries, files
// d'attente internes) finit par coûter plus de temps qu'elle n'en fait gagner
// en parallélisme. 6 est un compromis délibéré entre les 4 d'origine et les 8
// qui ont ralenti -- pas encore mesuré sur la durée, à réajuster si la
// lenteur persiste ou si la RAM du serveur mutualisé (n0c) devient à son tour
// le goulot.
// REVENU à 4 le 1er octobre 2026 : retour à la configuration d'avant le 24/09
// (décision Andrianina, "la seule utilisable").
const DEFAULT_CONCURRENCY = 4;
const DEFAULT_TOKEN_TTL = '20m';
// Orphelins (voir claimNext) : un item 'en_cours' sans battement de cœur
// depuis 3 min (6 battements manqués, un toutes les 30 s) est considéré mort.
const HEARTBEAT_INTERVAL_MS = 30 * 1000;
const MAX_INFRA_DEFERRALS = 3;
const PROGRESS_TICK_RE = /—\s*~[\d\s,.\u202f\u00a0]+tokens\s*$/;
const HEARTBEAT_STALE_MS = 3 * 60 * 1000;
// Sans colonne heartbeat_at : marge au-delà du délai dur du pipeline.
const LEGACY_STALE_MARGIN_MS = 5 * 60 * 1000;

// Panne d'infrastructure passagère (et non un problème propre à l'article) :
// connexion coupée/refusée/expirée, ou passerelle 502/503/504.
const TRANSIENT_INFRA_RE = /ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|EAI_AGAIN|socket hang up|HTTP 50[234]\b|status code 50[234]\b/i;
const isTransientInfraError = (e) => {
  if (!e) return false;
  if (['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE', 'EAI_AGAIN'].includes(e.code)) return true;
  const status = e.response && e.response.status;
  if ([502, 503, 504].includes(status)) return true;
  return TRANSIENT_INFRA_RE.test(String(e.message || ''));
};

// Lecture défensive d'un réglage injecté : une fonction absente ou qui lève
// ne doit jamais faire planter un tick.
const safeCall = (fn, fallback) => {
  if (typeof fn !== 'function') return fallback;
  try {
    const v = fn();
    return v === undefined ? fallback : v;
  } catch {
    return fallback;
  }
};

/**
 * @param {object} deps
 * @param {function} deps.getPool          () => pool mysql2/promise (voir db.js)
 * @param {object} deps.jwt                module `jsonwebtoken` (injecté pour les tests)
 * @param {string} deps.jwtSecret
 * @param {function} deps.fetchModelPricing () => Promise<object|null>
 * @param {function} [deps.getModelSelections] () => object|null — choix de modèle par
 *   passe (settings.modelSelections, data/settings.json). SANS ÇA, chaque item batch
 *   retombait silencieusement sur le modèle PAR DÉFAUT du registre (MODEL_PASSES,
 *   agent.js -- Sonnet 5 pour audit_qat/refonte/gras/style/obsolescence/réécriture),
 *   en ignorant totalement les modèles choisis dans Paramètres -- constaté le
 *   23/09/2026 (394 $ de coût réel Sonnet 5 sur la période, alors que TOUTES les
 *   passes étaient réglées sur Haiku 4.5 dans l'UI). Défaut `() => null` : même
 *   comportement qu'avant si le déploiement ne fournit pas cette dépendance.
 * @param {string} deps.apiBaseUrl         ex. https://maj.stomos.net/api
 * @param {number} [deps.concurrency]     valeur figée -- dépassée par getConcurrency
 *   si fourni (lu à CHAQUE tick, voir Paramètres -> Traitement en lot).
 * @param {function} [deps.getConcurrency]     () => number -- settings.json
 *   batchTuning.concurrency. Défaut : renvoie `concurrency` (comportement figé,
 *   inchangé pour les tests existants qui ne fournissent que `concurrency`).
 * @param {function} [deps.getMaxEssaisIA]     () => number|undefined --
 *   settings.json batchTuning.maxEssaisIA, transmis à runQatAudit/runQatRewrite
 *   (agentQat.js) via spawnPipelineFn. `undefined` = leur défaut (MAX_ESSAIS_IA).
 * @param {function} [deps.getTimeoutMs]       () => number|undefined --
 *   settings.json batchTuning.timeoutMinutes*60000, transmis à spawnPipelineFn.
 *   `undefined` = son défaut (spawnPipeline.js, DEFAULT_TIMEOUT_MS).
 * @param {function} [deps.getRetryOnError]    () => boolean -- settings.json
 *   batchTuning.retryOnError. Défaut `() => true` : UN réessai automatique avant
 *   erreur définitive (comportement du 28/09/2026, voir handleFailure). `false`
 *   restaure l'ancien comportement -- erreur définitive dès le premier échec.
 * @param {function} [deps.spawnPipelineFn] injecté pour les tests
 * @param {string} [deps.cliPath]          transmis à spawnPipelineFn (tests)
 * @param {function} [deps.httpClientFactory] (authToken) => instance axios (tests)
 * @param {function} [deps.onLog]
 */
function createBatchOrchestrator(deps) {
  const {
    getPool,
    jwt,
    jwtSecret,
    fetchModelPricing,
    getModelSelections = () => null,
    apiBaseUrl,
    concurrency = DEFAULT_CONCURRENCY,
    getConcurrency = () => concurrency,
    getMaxEssaisIA = () => undefined,
    getTimeoutMs = () => undefined,
    getRetryOnError = () => true,
    spawnPipelineFn = defaultSpawnPipeline,
    cliPath,
    httpClientFactory,
    onLog = () => {},
    onBatchDone = async () => {},
    // Battement de cœur (colonne batch_items.heartbeat_at, migration
    // alter-add-batch-item-heartbeat.sql) -- `() => false` par défaut : sans la
    // colonne, on retombe sur la détection par started_at (voir claimNext).
    // proxy.js vérifie la présence de la colonne et renvoie true une fois la
    // migration passée.
    getUseHeartbeat = () => false,
    // Délais entre nouveaux essais du report HTTP (PUT résultat / POST
    // requeue) quand le serveur ne répond pas ou renvoie 429/5xx. Vide par
    // défaut (aucun nouvel essai -- comportement historique, tests rapides) ;
    // proxy.js passe [3 s, 10 s, 30 s] en production.
    reportRetryDelaysMs = [],
    // Écriture DIRECTE en base du résultat d'un item (src/server/batchItemStore.js),
    // sans passer par l'API HTTP de ce même serveur -- dont l'URL publique est
    // injoignable plusieurs minutes après chaque redémarrage (incident du
    // 01/10/2026, "read ECONNRESET"). Absentes (tests historiques) : repli sur
    // les routes HTTP PUT .../items/:itemId et POST .../requeue, comme avant.
    //   updateItemFn(item, patch)          -> { shouldNotify } | { notFound: true }
    //   requeueItemFn(item, errorMessage)  -> boolean (false = déjà réessayé)
    updateItemFn,
    requeueItemFn,
    sleepFn = (ms) => new Promise((r) => setTimeout(r, ms)),
  } = deps;

  let active = 0;
  // ── Diagnostic (incident du 01/10/2026) ─────────────────────────────────
  // État visible depuis GET /api/internal/batch-diagnostics (super_admin) :
  // jusqu'ici, impossible de savoir OÙ un article "en_cours" était bloqué sans
  // accès au stderr.log du serveur. Chaque item en cours garde sa dernière
  // étape de pipeline et l'heure à laquelle elle est arrivée.
  const activeItems = new Map();
  // Pannes d'infrastructure déjà "absorbées" par item (voir processItem).
  const infraDeferrals = new Map();
  const diag = {
    lastTickAt: null,
    lastClaim: null,
    lastClaimError: null,
    lastHeartbeat: null,
  };
  // Un SEUL claimNext() en vol à la fois DANS CE PROCESSUS -- sans ce
  // verrou, un tick (toutes les 15s) dont le SELECT ... FOR UPDATE traîne
  // (base sous charge, lot de 40 items, verrous concurrents) peut encore
  // tourner quand le tick SUIVANT démarre dans le MÊME processus. Insuffisant
  // À LUI SEUL : cet hébergement mutualisé (Passenger/cPanel) fait tourner
  // PLUSIEURS PROCESSUS Node pour cette appli, chacun avec sa PROPRE instance
  // d'orchestrateur et donc son PROPRE `claiming`/`active` -- ce verrou ne
  // protège que contre le chevauchement DANS un processus donné. La
  // protection inter-processus (la vraie source du dépassement constaté en
  // prod, ~29 articles "en_cours" pour une concurrence réglée à 6, y compris
  // APRÈS ce premier correctif) vit dans claimNext() : voir le verrou DB
  // `batch_orchestrator_lock` plus bas.
  let claiming = false;

  // Jeton interne, jamais stocké, ne sert qu'au temps du run de CET item — même
  // forme que celui miné par la route /run-article-pipeline (Phase 1). Le rôle
  // est fixé à super_admin : ce jeton ne quitte jamais le serveur et les
  // endpoints qu'il appelle (skills/knowledge/articles/stats) ne sont pas
  // eux-mêmes restreints par rôle, mais la route de vérification manuelle qui a
  // servi de modèle l'était — même niveau d'accès, par cohérence.
  const buildAuthToken = (item) => jwt.sign(
    {
      uid: item.launched_by || 'batch-orchestrator',
      username: item.launched_by_name || 'Batch',
      role: 'super_admin',
      jti: crypto.randomUUID(),
    },
    jwtSecret,
    { expiresIn: DEFAULT_TOKEN_TTL },
  );

  const httpFor = (authToken) => (httpClientFactory
    ? httpClientFactory(authToken)
    : axios.create({ baseURL: apiBaseUrl, headers: { Authorization: `Bearer ${authToken}` }, timeout: 15000 }));

  // Réclame jusqu'à `limit` items en_attente et les fait passer en_cours dans
  // LA MÊME transaction verrouillée -- entre le SELECT et l'UPDATE, aucun
  // autre process ne peut voir ces lignes (SKIP LOCKED les lui masque plutôt
  // que de le faire attendre, donc deux ticks concurrents se partagent le
  // travail au lieu de se marcher dessus).
  const claimNext = async (concurrencyTarget) => {
    const conn = await getPool().getConnection();
    try {
      await conn.beginTransaction();
      // Verrou global (voir migration create-batch-orchestrator-lock.sql) --
      // cet hébergement mutualisé fait tourner PLUSIEURS PROCESSUS Node pour
      // cette appli (Passenger/cPanel) en même temps : chacun a SA PROPRE
      // instance d'orchestrateur, donc SON PROPRE compteur `active` en
      // mémoire, qui ne voit RIEN de ce qu'un AUTRE processus a déjà réclamé.
      // Sans ce verrou, chaque processus autorise sa propre marge de
      // `concurrency` -- le total réel explose (constaté en prod le
      // 28/09/2026 : plusieurs dizaines d'articles en_cours simultanés pour un
      // réglage à 6, alors même que le correctif "un seul tick à la fois PAR
      // PROCESSUS" -- voir `claiming` ci-dessus -- était déjà en place). Ce
      // verrou sérialise l'étape "compter les en_cours puis réclamer" entre
      // TOUS les processus, quel que soit leur nombre : la source de vérité
      // devient la base (comptage live), plus le compteur mémoire d'un seul
      // processus.
      await conn.query('SELECT 1 FROM batch_orchestrator_lock FOR UPDATE');

      // ── Orphelins (incident du 01/10/2026) ──────────────────────────────
      // Le comptage global ci-dessous compte TOUT item 'en_cours' en base --
      // y compris ceux dont le pipeline est mort avec son processus serveur
      // (recyclage Passenger, arrêt, mémoire...). Constaté en production : un
      // lot de 8 à 0/8 pendant 4 heures, ses 6 "en_cours" orphelins occupant
      // les 6 places sans que rien ne les libère avant la réparation à 30 min
      // de repairZombies() -- qui elle-même ne tourne qu'au démarrage ou toutes
      // les 30 min. Désormais, CHAQUE réclamation commence par remettre en
      // file les items morts, sous le même verrou :
      //   - avec battement de cœur (heartbeat_at, rafraîchi toutes les 30 s par
      //     le processus qui fait tourner l'item) : mort = plus de battement
      //     depuis HEARTBEAT_STALE_MS (3 min) ;
      //   - sans (migration pas encore passée) : mort = démarré depuis plus que
      //     le délai dur du pipeline + 5 min -- un processus vivant a forcément
      //     réglé l'item avant (voir spawnPipeline.js, délai dur).
      // `requeued_at` les fait passer après les items jamais démarrés : un
      // article qui ferait tomber le processus à chaque essai ne monopolise
      // pas la file.
      const nowRepair = Date.now();
      const useHeartbeat = safeCall(getUseHeartbeat, false) === true;
      let repairResult;
      if (useHeartbeat) {
        [repairResult] = await conn.query(
          `UPDATE batch_items SET status='en_attente', started_at=NULL, heartbeat_at=NULL, requeued_at=?
            WHERE status='en_cours' AND COALESCE(heartbeat_at, started_at, 0) < ?`,
          [nowRepair, nowRepair - HEARTBEAT_STALE_MS],
        );
      } else {
        const pipelineTimeout = safeCall(getTimeoutMs, undefined) || DEFAULT_PIPELINE_TIMEOUT_MS;
        [repairResult] = await conn.query(
          `UPDATE batch_items SET status='en_attente', started_at=NULL, requeued_at=?
            WHERE status='en_cours' AND started_at IS NOT NULL AND started_at < ?`,
          [nowRepair, nowRepair - pipelineTimeout - LEGACY_STALE_MARGIN_MS],
        );
      }
      const staleRepaired = (repairResult && repairResult.affectedRows) || 0;
      if (staleRepaired > 0) {
        onLog(`[batch] ${staleRepaired} article(s) "en_cours" orphelin(s) (${useHeartbeat ? 'plus de battement de cœur' : 'délai dépassé'}) remis en file`);
      }

      const [countRows] = await conn.query(
        `SELECT COUNT(*) AS total FROM batch_items WHERE status = 'en_cours'`,
      );
      const enCours = Number(countRows[0].total) || 0;
      const limit = Math.max(0, concurrencyTarget - enCours);
      diag.lastClaim = { at: Date.now(), concurrency: concurrencyTarget, enCours, limit, claimed: 0, staleRepaired };
      if (limit <= 0) {
        await conn.commit();
        return [];
      }
      // Tri : `bi.id` est un UUID aléatoire (crypto.randomUUID(), data-api.js)
      // -- il n'a JAMAIS représenté un ordre d'arrivée, réessai ou pas. Ce qui
      // compte ici, c'est de faire passer un item réessayé (`requeued_at` posé
      // par POST .../requeue) APRÈS tout item jamais réessayé
      // (`requeued_at IS NULL`), quel que soit son id -- pas de reconstituer
      // un FIFO qui n'a jamais existé.
      const [rows] = await conn.query(
        `SELECT bi.id, bi.batch_id, bi.article_url, bi.target_keyword, bi.consigne,
                bi.retry_count, bi.requeued_at, b.launched_by, b.launched_by_name
           FROM batch_items bi
           JOIN batches b ON b.id = bi.batch_id
          WHERE bi.status = 'en_attente'
          ORDER BY (bi.requeued_at IS NOT NULL), bi.requeued_at, bi.id
          LIMIT ?
          FOR UPDATE SKIP LOCKED`,
        [limit],
      );
      if (!rows.length) {
        await conn.commit();
        return [];
      }
      const now = Date.now();
      const ids = rows.map((r) => r.id);
      if (useHeartbeat) {
        // Premier battement posé dès la réclamation : un processus qui meurt
        // entre ce commit et le lancement des pipelines laisse quand même un
        // horodatage exploitable par la réparation des orphelins.
        await conn.query(
          `UPDATE batch_items SET status='en_cours', started_at=?, heartbeat_at=? WHERE id IN (${ids.map(() => '?').join(',')})`,
          [now, now, ...ids],
        );
      } else {
        await conn.query(
          `UPDATE batch_items SET status='en_cours', started_at=? WHERE id IN (${ids.map(() => '?').join(',')})`,
          [now, ...ids],
        );
      }
      // Le batch passe à 'running' dès qu'un item démarre. Jamais l'inverse :
      // un batch déjà 'done'/'error' n'a par construction plus d'item
      // en_attente (voir la clause WHERE ci-dessus), donc cette mise à jour ne
      // peut pas le faire régresser depuis un état terminal.
      const batchIds = [...new Set(rows.map((r) => r.batch_id))];
      await conn.query(
        `UPDATE batches SET status='running' WHERE status='pending' AND id IN (${batchIds.map(() => '?').join(',')})`,
        batchIds,
      );
      await conn.commit();
      if (diag.lastClaim) diag.lastClaim.claimed = rows.length;
      return rows;
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  };

  // Report HTTP vers l'API du MÊME serveur, via son URL publique : si le
  // processus web redémarre ou sature au même moment (429/502/503/504/508),
  // un seul échec suffisait à laisser l'item "en_cours" pour toujours (voir
  // handleFailure). Quelques nouveaux essais espacés avant d'abandonner --
  // jamais sur une erreur applicative (400/401/404/409...), qui ne
  // changerait pas en réessayant.
  const RETRYABLE_HTTP_STATUSES = [429, 502, 503, 504, 508];
  const withReportRetry = async (label, fn) => {
    const delays = Array.isArray(reportRetryDelaysMs) ? reportRetryDelaysMs : [];
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await fn();
      } catch (e) {
        const status = e && e.response && e.response.status;
        const retryable = !(e && e.response) || RETRYABLE_HTTP_STATUSES.includes(status);
        if (!retryable || attempt >= delays.length) throw e;
        onLog(`[batch] ${label} en échec (${describeHttpError(e)}) -- nouvel essai dans ${Math.round(delays[attempt] / 1000)} s`);
        await sleepFn(delays[attempt]);
      }
    }
  };

  const reportOutcome = async (item, patch) => {
    let shouldNotify = false;
    if (typeof updateItemFn === 'function') {
      const r = await withReportRetry(`Report de l'item ${item.id}`, () => updateItemFn(item, patch));
      if (r && r.notFound) {
        onLog(`[batch] Item ${item.id} introuvable au moment du report (supprimé entre-temps ?)`);
        return;
      }
      shouldNotify = !!(r && r.shouldNotify);
    } else {
      const http = httpFor(buildAuthToken(item));
      const res = await withReportRetry(
        `Report de l'item ${item.id}`,
        () => http.put(`/data/batches/${encodeURIComponent(item.batch_id)}/items/${encodeURIComponent(item.id)}`, patch),
      );
      shouldNotify = !!res?.data?.shouldNotify;
    }
    // `shouldNotify` vient de la réclamation atomique (batchItemStore.js) : un
    // seul item déclencheur par lot, jamais un doublon même si deux items
    // terminent au même instant.
    if (shouldNotify) {
      try {
        await onBatchDone(item.batch_id);
      } catch (e) {
        onLog(`[batch] Notification de fin échouée pour le lot ${item.batch_id} : ${e.message}`);
      }
    }
  };

  // POST .../requeue (data-api.js) : remet l'item 'en_attente', vidé de son
  // started_at/completed_at, retry_count 0->1, À LA FIN de la file. Renvoie
  // `false` sur un 409 (déjà réessayé entre-temps par un autre tick -- course
  // rarissime, jamais une vraie erreur) : l'appelant doit alors basculer sur
  // l'erreur définitive plutôt que de considérer le réessai posé.
  const requeueItem = async (item, errorMessage) => {
    if (typeof requeueItemFn === 'function') {
      return withReportRetry(`Remise en file de l'item ${item.id}`, () => requeueItemFn(item, errorMessage));
    }
    const http = httpFor(buildAuthToken(item));
    try {
      await withReportRetry(
        `Remise en file de l'item ${item.id}`,
        () => http.post(`/data/batches/${encodeURIComponent(item.batch_id)}/items/${encodeURIComponent(item.id)}/requeue`, { errorMessage }),
      );
      return true;
    } catch (e) {
      if (e.response?.status === 409) return false;
      throw e;
    }
  };

  // Un SEUL réessai automatique après échec (décision Andrianina, 28
  // septembre 2026), quelle que soit la cause -- scraping, IA, WordPress,
  // donnée manquante sur la ligne... AVANT de marquer l'item en erreur
  // définitive. `item.retry_count` vient de claimNext (SELECT bi.retry_count) :
  // 0 -> on tente un réessai (fin de file, voir requeueItem) ; déjà 1 (ou le
  // réessai a échoué à se poser, 409 ou HTTP down) -> erreur définitive,
  // jamais une 3e tentative. `getRetryOnError()` (settings.json batchTuning,
  // Paramètres -> Traitement en lot) permet de désactiver ENTIÈREMENT ce
  // réessai -- toujours au plus UN, jamais un compteur réglable (voir le
  // commentaire de getBatchTuning, proxy.js, pour pourquoi).
  const handleFailure = async (item, errorMessage) => {
    let retryOnError = true;
    try { retryOnError = getRetryOnError() !== false; } catch { retryOnError = true; }
    if (retryOnError && !item.retry_count) {
      try {
        const requeued = await requeueItem(item, errorMessage);
        if (requeued) {
          onLog(`[batch] Item ${item.id} en échec (${errorMessage}) -- remis en fin de file pour un 2e essai`);
          return;
        }
        onLog(`[batch] Item ${item.id} -- déjà réessayé entre-temps (409), passage en erreur définitive`);
      } catch (e) {
        onLog(`[batch] Item ${item.id} -- échec de la remise en file (${describeHttpError(e)}), passage en erreur définitive`);
      }
    }
    try {
      await reportOutcome(item, { status: 'erreur', errorMessage, completedAt: Date.now() });
    } catch (e2) {
      // Le report échoue aussi (DB/HTTP down) : l'item reste 'en_cours'.
      // Non rattrapable ici sans dupliquer la logique de recomptage du
      // batch parent -- il sera visible comme bloqué dans l'historique et
      // devra être relancé, comme n'importe quel crash serveur en cours de
      // traitement.
      onLog(`[batch] Item ${item.id} -- impossible de reporter l'échec : ${describeHttpError(e2)}`);
    }
  };

  const processItem = async (item) => {
    active += 1;
    const track = {
      id: item.id,
      batchId: item.batch_id,
      articleUrl: item.article_url,
      targetKeyword: item.target_keyword || null,
      startedAt: Date.now(),
      phase: 'démarrage',
      lastStep: null,
      lastStepAt: null,
    };
    activeItems.set(item.id, track);
    try {
      // Ligne posée avant la migration qui ajoute target_keyword, ou saisie
      // vide échappée à la validation de l'écran /lots : on le dit clairement
      // plutôt que de laisser runArticlePipeline lever une erreur générique
      // ("targetKeyword requis") qui ne dirait pas QUOI corriger.
      if (!item.target_keyword) {
        await handleFailure(item, 'Mot-clé cible manquant sur cette ligne -- impossible de lancer l\'audit.');
        return;
      }

      onLog(`[batch] Démarrage item ${item.id} (${item.article_url})`);
      const modelPricing = await fetchModelPricing().catch(() => null);
      // Même choix de modèle par passe que l'UI (Paramètres) -- sans ça, ce chemin
      // (headless, séparé de Articles.jsx/ArticleResult.jsx) retombait sur les
      // défauts du registre au lieu des modèles réellement configurés.
      let modelSelections = null;
      try { modelSelections = getModelSelections() || null; } catch { modelSelections = null; }
      // Réglages "Traitement en lot" (Paramètres) -- lus à CHAQUE item, jamais
      // figés au démarrage du process : un changement dans l'admin s'applique
      // dès le prochain item réclamé, sans redémarrage (même logique que
      // getModelSelections ci-dessus). `undefined` en cas d'échec de lecture ou
      // de valeur non fournie -- spawnPipelineFn/agentQat.js retombent alors sur
      // leurs propres défauts, comportement inchangé.
      let maxEssaisIA;
      try { maxEssaisIA = getMaxEssaisIA(); } catch { maxEssaisIA = undefined; }
      let timeoutMs;
      try { timeoutMs = getTimeoutMs(); } catch { timeoutMs = undefined; }
      const authToken = buildAuthToken(item);
      track.phase = 'pipeline';
      const outcome = await spawnPipelineFn({
        articleUrl: item.article_url,
        targetKeyword: item.target_keyword,
        instruction: item.consigne || '',
        modelPricing,
        modelSelections,
        maxEssaisIA,
        launchedByUid: item.launched_by,
        launchedByName: item.launched_by_name || 'Batch',
        apiBaseUrl,
        authToken,
      }, {
        cliPath,
        timeoutMs,
        onStep: (s) => {
          track.lastStep = s;
          track.lastStepAt = Date.now();
          // Compteurs de progression ("Mise en gras — ~3 186 tokens", émis
          // toutes les 700 ms) : gardés comme dernière étape pour le
          // diagnostic, mais pas journalisés un par un -- ils noyaient le
          // journal récent (500 lignes) en quelques minutes.
          if (PROGRESS_TICK_RE.test(s)) return;
          onLog(`[batch ${item.id}] ${s}`);
        },
      });

      track.phase = 'report';
      await reportOutcome(item, {
        status: 'fait',
        articleId: outcome.articleId,
        completedAt: Date.now(),
        // Supervision (Phase 8) : coût/tokens réels de CET article, cumulés
        // côté data-api.js sur le batch parent. Absents en cas d'échec -- le
        // pipeline rejette sans renvoyer de tokenUsage partiel, donc le coût
        // d'un run raté n'est pas tracé ici (limite connue, pas un oubli).
        costUsd: outcome.tokenUsage?.costUsd ?? null,
        inputTokens: outcome.tokenUsage?.input ?? null,
        outputTokens: outcome.tokenUsage?.output ?? null,
      });
      onLog(`[batch] Item ${item.id} terminé -- article ${outcome.articleId}`);
    } catch (e) {
      // `e` vient soit de spawnPipelineFn (déjà enrichi côté pipelineCli.js,
      // voir httpErrorDetail.js -- describeHttpError() n'y touche alors pas,
      // pas de .response dessus), soit d'un échec du PUT de reportOutcome
      // lui-même (erreur axios brute de CE process, elle) -- un seul appel
      // couvre les deux cas. La dernière étape atteinte et un extrait du
      // stderr du runner (crash non capturé en Error propre) complètent le
      // message : sans eux, "Audit illisible" ou un timeout HTTP ne dit rien
      // de OÙ dans les 4 passes IA le lot s'est arrêté.
      const lastStep = Array.isArray(e.steps) && e.steps.length ? e.steps[e.steps.length - 1] : null;
      const stderrTail = e.stderr ? String(e.stderr).trim().slice(-500) : null;
      const errorMessage = [
        describeHttpError(e) || 'Erreur inconnue',
        lastStep ? `(dernière étape : ${lastStep})` : null,
        stderrTail ? `\nstderr: ${stderrTail}` : null,
      ].filter(Boolean).join(' ').slice(0, 2000);
      onLog(`[batch] Item ${item.id} en échec : ${errorMessage}`);
      track.phase = 'échec';
      // Panne d'infrastructure (connexion coupée/refusée, passerelle 502-504)
      // plutôt qu'un problème de l'article : constaté le 01/10/2026 juste après
      // un déploiement, 3 articles passés en "Erreur" définitive en 45 s sur des
      // "read ECONNRESET" -- ils n'avaient jamais vraiment tourné, et la remise
      // en file elle-même échouait pour la même raison. Plutôt que de consommer
      // l'unique réessai (voire l'erreur définitive), on laisse l'item tel quel :
      // il ne bat plus, la réclamation suivante le remet en file (orphelin) sans
      // toucher à retry_count. Au plus MAX_INFRA_DEFERRALS fois par item (compté
      // en mémoire, par processus) : au-delà, chemin normal, pour ne jamais
      // tourner en boucle sur un site qui coupe toutes nos connexions. (Pas sur
      // `requeued_at` comme dans la 1re version : il est aussi posé par la
      // reprise des orphelins et par le réessai normal, et a renvoyé 3 articles
      // en "Erreur" sur la coupure qui suit chaque redémarrage.)
      if (isTransientInfraError(e)) {
        const deferrals = (infraDeferrals.get(item.id) || 0) + 1;
        if (deferrals <= MAX_INFRA_DEFERRALS) {
          infraDeferrals.set(item.id, deferrals);
          onLog(`[batch] Item ${item.id} -- panne réseau/serveur passagère (${deferrals}/${MAX_INFRA_DEFERRALS}), laissé en attente de reprise automatique (réessai non consommé)`);
          return;
        }
      }
      await handleFailure(item, errorMessage);
    } finally {
      active -= 1;
      activeItems.delete(item.id);
    }
  };

  // Battement de cœur des items que CE processus fait tourner -- appelé
  // toutes les 30 s par proxy.js. S'il meurt, ses items cessent de battre et
  // le prochain claimNext() de N'IMPORTE QUEL processus les remet en file au
  // bout de HEARTBEAT_STALE_MS (au lieu de les laisser occuper les places
  // jusqu'à repairZombies, 30 min plus tard au mieux). Ne lève jamais.
  const heartbeat = async () => {
    if (!activeItems.size) return 0;
    if (safeCall(getUseHeartbeat, false) !== true) return 0;
    const ids = [...activeItems.keys()];
    try {
      const [result] = await getPool().query(
        `UPDATE batch_items SET heartbeat_at=? WHERE status='en_cours' AND id IN (${ids.map(() => '?').join(',')})`,
        [Date.now(), ...ids],
      );
      diag.lastHeartbeat = { at: Date.now(), items: ids.length, updated: (result && result.affectedRows) || 0 };
      return diag.lastHeartbeat.updated;
    } catch (e) {
      diag.lastHeartbeat = { at: Date.now(), items: ids.length, error: e.message };
      onLog(`[batch] Battement de cœur en échec : ${e.message}`);
      return 0;
    }
  };

  const getDiagnostics = () => {
    const now = Date.now();
    return {
      activeCount: active,
      claiming,
      useHeartbeat: safeCall(getUseHeartbeat, false) === true,
      concurrency: safeCall(getConcurrency, concurrency) || concurrency,
      ...diag,
      items: [...activeItems.values()].map((t) => ({
        ...t,
        elapsedS: Math.round((now - t.startedAt) / 1000),
        sinceLastStepS: t.lastStepAt ? Math.round((now - t.lastStepAt) / 1000) : null,
      })),
    };
  };

  // Un tick réclame ce qu'il peut et lance chaque item SANS attendre qu'il
  // termine (fire-and-forget) : le tick suivant peut réclamer d'autres items
  // dès qu'un créneau se libère, au lieu d'attendre le plus lent du lot.
  const tick = async () => {
    // Un tick qui arrive pendant qu'un claimNext() précédent tourne ENCORE
    // DANS CE PROCESSUS repart les mains vides plutôt que de lancer une 2e
    // transaction concurrente pour rien -- le tick SUIVANT (15s plus tard)
    // refera l'appel, sans rien perdre : les items en_attente restent
    // en_attente, ils seront réclamés au prochain passage. La protection
    // contre le dépassement de concurrence, elle, vit dans claimNext() (verrou
    // DB `batch_orchestrator_lock` + comptage global), pas ici.
    if (claiming) return;
    diag.lastTickAt = Date.now();
    let currentConcurrency = concurrency;
    try { currentConcurrency = getConcurrency() || concurrency; } catch { currentConcurrency = concurrency; }
    claiming = true;
    let claimed;
    try {
      // Le cap réel est appliqué DANS claimNext (comptage global verrouillé,
      // voir plus haut) -- `active` reste un compteur local utile pour
      // l'observabilité (getActiveCount()) mais n'est plus ce qui borne la
      // concurrence : avec plusieurs processus, un `active` local à 0 ne veut
      // pas dire qu'il n'y a AUCUN item en_cours ailleurs.
      claimed = await claimNext(currentConcurrency);
    } catch (e) {
      diag.lastClaimError = { at: Date.now(), message: e.message };
      onLog(`[batch] Échec de la réclamation d'items : ${e.message}`);
      return;
    } finally {
      claiming = false;
    }
    claimed.forEach((item) => { processItem(item); });
  };

  // ── Réparation des « en_cours » zombies ─────────────────────────────────
  // `active` (le compteur de créneaux occupés) vit UNIQUEMENT en mémoire du
  // process -- un redémarrage serveur (déploiement, crash, recyclage
  // Passenger) le remet à 0, mais les lignes `batch_items` déjà réclamées par
  // l'ancien process restent 'en_cours' en base pour toujours : `claimNext`
  // ne réclame que 'en_attente', jamais 'en_cours'. Constaté en production le
  // 2 septembre 2026 : un lot à 1/9 terminé, 8 items bloqués 'en_cours' sans
  // qu'aucun ne progresse, après un redémarrage du serveur.
  //
  // Seuil identique à STALE_RUN_MS de l'ancien MajEnAttente.jsx (30 min) --
  // largement au-delà de la durée d'une passe la plus longue (~9 min, voir
  // agent-pipeline.md) même en tenant compte d'une attente derrière d'autres
  // items. Ne touche QUE les items dont started_at date d'avant ce seuil :
  // un item réellement en train de tourner (redémarrage pendant qu'un item
  // tournait déjà, ou tick concurrent) n'est jamais repris en route.
  const STALE_RUN_MS = 30 * 60 * 1000;
  const repairZombies = async () => {
    const cutoff = Date.now() - STALE_RUN_MS;
    const [result] = await getPool().query(
      `UPDATE batch_items SET status='en_attente', started_at=NULL
         WHERE status='en_cours' AND started_at IS NOT NULL AND started_at < ?`,
      [cutoff],
    );
    const repaired = result.affectedRows || 0;
    if (repaired > 0) {
      onLog(`[batch] ${repaired} article(s) "en cours" bloqué(s) depuis plus de 30 min remis en attente (probable redémarrage serveur)`);
    }
    return repaired;
  };

  return {
    tick,
    repairZombies,
    heartbeat,
    getDiagnostics,
    getActiveCount: () => active,
  };
}

module.exports = {
  createBatchOrchestrator,
  DEFAULT_CONCURRENCY,
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_STALE_MS,
};
