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
const { spawnPipeline: defaultSpawnPipeline } = require('./spawnPipeline');
const { describeHttpError } = require('./httpErrorDetail');

// Passé de 2 à 4 le 1er septembre 2026 (décision Andrianina), après vérification
// des freins réels : le limiteur interne 60 req/min (proxy.js, partagé avec le
// reste de l'équipe) est le premier goulot, la RAM du serveur mutualisé (n0c)
// le second -- ni l'un ni l'autre n'a de plafond documenté permettant de
// justifier un chiffre plus haut sans le mesurer en conditions réelles.
// Une hausse ultérieure doit être suivie d'une surveillance des erreurs
// "trop de requêtes" et d'un redémarrage inattendu de l'application avant
// d'aller plus loin.
const DEFAULT_CONCURRENCY = 4;
const DEFAULT_TOKEN_TTL = '20m';

/**
 * @param {object} deps
 * @param {function} deps.getPool          () => pool mysql2/promise (voir db.js)
 * @param {object} deps.jwt                module `jsonwebtoken` (injecté pour les tests)
 * @param {string} deps.jwtSecret
 * @param {function} deps.fetchModelPricing () => Promise<object|null>
 * @param {string} deps.apiBaseUrl         ex. https://maj.stomos.net/api
 * @param {number} [deps.concurrency]
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
    apiBaseUrl,
    concurrency = DEFAULT_CONCURRENCY,
    spawnPipelineFn = defaultSpawnPipeline,
    cliPath,
    httpClientFactory,
    onLog = () => {},
    onBatchDone = async () => {},
  } = deps;

  let active = 0;

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
  const claimNext = async (limit) => {
    if (limit <= 0) return [];
    const conn = await getPool().getConnection();
    try {
      await conn.beginTransaction();
      const [rows] = await conn.query(
        `SELECT bi.id, bi.batch_id, bi.article_url, bi.target_keyword, bi.consigne,
                b.launched_by, b.launched_by_name
           FROM batch_items bi
           JOIN batches b ON b.id = bi.batch_id
          WHERE bi.status = 'en_attente'
          ORDER BY bi.id
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
      await conn.query(
        `UPDATE batch_items SET status='en_cours', started_at=? WHERE id IN (${ids.map(() => '?').join(',')})`,
        [now, ...ids],
      );
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
      return rows;
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  };

  const reportOutcome = async (item, patch) => {
    const http = httpFor(buildAuthToken(item));
    const res = await http.put(`/data/batches/${encodeURIComponent(item.batch_id)}/items/${encodeURIComponent(item.id)}`, patch);
    // `shouldNotify` vient de la réclamation atomique côté data-api.js : un
    // seul item déclencheur par lot, jamais un doublon même si deux items
    // terminent au même instant.
    if (res?.data?.shouldNotify) {
      try {
        await onBatchDone(item.batch_id);
      } catch (e) {
        onLog(`[batch] Notification de fin échouée pour le lot ${item.batch_id} : ${e.message}`);
      }
    }
  };

  const processItem = async (item) => {
    active += 1;
    try {
      // Ligne posée avant la migration qui ajoute target_keyword, ou saisie
      // vide échappée à la validation de l'écran /lots : on le dit clairement
      // plutôt que de laisser runArticlePipeline lever une erreur générique
      // ("targetKeyword requis") qui ne dirait pas QUOI corriger.
      if (!item.target_keyword) {
        await reportOutcome(item, {
          status: 'erreur',
          errorMessage: 'Mot-clé cible manquant sur cette ligne -- impossible de lancer l\'audit.',
          completedAt: Date.now(),
        });
        return;
      }

      onLog(`[batch] Démarrage item ${item.id} (${item.article_url})`);
      const modelPricing = await fetchModelPricing().catch(() => null);
      const authToken = buildAuthToken(item);
      const outcome = await spawnPipelineFn({
        articleUrl: item.article_url,
        targetKeyword: item.target_keyword,
        instruction: item.consigne || '',
        modelPricing,
        launchedByUid: item.launched_by,
        launchedByName: item.launched_by_name || 'Batch',
        apiBaseUrl,
        authToken,
      }, { cliPath, onStep: (s) => onLog(`[batch ${item.id}] ${s}`) });

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
      try {
        await reportOutcome(item, {
          status: 'erreur',
          errorMessage,
          completedAt: Date.now(),
        });
      } catch (e2) {
        // Le report échoue aussi (DB/HTTP down) : l'item reste 'en_cours'.
        // Non rattrapable ici sans dupliquer la logique de recomptage du
        // batch parent -- il sera visible comme bloqué dans l'historique et
        // devra être relancé, comme n'importe quel crash serveur en cours de
        // traitement.
        onLog(`[batch] Item ${item.id} -- impossible de reporter l'échec : ${describeHttpError(e2)}`);
      }
    } finally {
      active -= 1;
    }
  };

  // Un tick réclame ce qu'il peut et lance chaque item SANS attendre qu'il
  // termine (fire-and-forget) : le tick suivant peut réclamer d'autres items
  // dès qu'un créneau se libère, au lieu d'attendre le plus lent du lot.
  const tick = async () => {
    const slots = concurrency - active;
    if (slots <= 0) return;
    let claimed;
    try {
      claimed = await claimNext(slots);
    } catch (e) {
      onLog(`[batch] Échec de la réclamation d'items : ${e.message}`);
      return;
    }
    claimed.forEach((item) => { processItem(item); });
  };

  return { tick, getActiveCount: () => active };
}

module.exports = { createBatchOrchestrator, DEFAULT_CONCURRENCY };
