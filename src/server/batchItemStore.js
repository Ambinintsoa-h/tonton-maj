'use strict';
/**
 * src/server/batchItemStore.js — écriture du résultat d'un article "MAJ en lot"
 * (fait / erreur / remise en file), en base, à UN SEUL endroit.
 *
 * Jusqu'ici cette logique vivait uniquement dans les routes
 * PUT /api/data/batches/:id/items/:itemId et POST .../requeue (data-api.js),
 * et l'orchestrateur (batchOrchestrator.js) les appelait en HTTP… sur l'URL
 * PUBLIQUE de son propre serveur. Constaté le 01/10/2026 avec le panneau
 * Diagnostic : après chaque redémarrage, ces appels du serveur vers lui-même
 * échouent plusieurs minutes en "read ECONNRESET" -- résultat, des articles
 * marqués "Erreur" définitive sans avoir jamais tourné, ou restés "en_cours"
 * faute d'avoir pu enregistrer leur résultat. L'orchestrateur appelle
 * désormais ces fonctions DIRECTEMENT (même processus, même base) ; les
 * routes HTTP les appellent aussi, pour que la règle de recomptage du lot et
 * la réclamation de l'email de fin n'existent qu'une fois.
 */

// Un lot passe à 'done' quand tous ses items sont dans l'un de ces états.
const TERMINAL_STATUSES = ['fait', 'erreur', 'a_revoir'];

/**
 * Met à jour UN item et recalcule les compteurs/statut du lot parent. Jamais
 * l'inverse : un lot 'done' ne redevient pas 'running' ici.
 *
 * @returns {Promise<{notFound: true} | {batchStatus: string, shouldNotify: boolean}>}
 */
async function updateBatchItem(pool, batchId, itemId, patch = {}) {
  const {
    status, articleId, errorMessage, startedAt, completedAt,
    costUsd, inputTokens, outputTokens,
  } = patch || {};
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [existing] = await conn.query('SELECT id, started_at FROM batch_items WHERE id=? AND batch_id=?', [itemId, batchId]);
    if (!existing.length) { await conn.rollback(); return { notFound: true }; }
    await conn.query(
      `UPDATE batch_items SET
         status=COALESCE(?, status), article_id=COALESCE(?, article_id),
         error_message=COALESCE(?, error_message), started_at=COALESCE(?, started_at),
         completed_at=COALESCE(?, completed_at), cost_usd=COALESCE(?, cost_usd),
         input_tokens=COALESCE(?, input_tokens), output_tokens=COALESCE(?, output_tokens)
       WHERE id=?`,
      [status ?? null, articleId ?? null, errorMessage ?? null, startedAt ?? null, completedAt ?? null,
       costUsd ?? null, inputTokens ?? null, outputTokens ?? null, itemId]);

    // Cumul coût/durée sur le lot parent -- pour la supervision (Phase 8).
    // La durée ne se déduit QUE si l'item avait bien un started_at (posé par
    // l'orchestrateur au moment de la réclamation) : jamais négative, jamais
    // fantaisiste si completedAt arrive seul.
    const startedAtExisting = existing[0].started_at ?? startedAt ?? null;
    const durationMs = (completedAt != null && startedAtExisting != null) ? (completedAt - startedAtExisting) : null;
    const [[counts]] = await conn.query(
      `SELECT COUNT(*) AS total,
         SUM(status='fait') AS done_ct,
         SUM(status='erreur') AS error_ct,
         SUM(status IN (${TERMINAL_STATUSES.map(() => '?').join(',')})) AS terminal_ct
       FROM batch_items WHERE batch_id=?`,
      [...TERMINAL_STATUSES, batchId]);
    const batchStatus = Number(counts.terminal_ct) >= Number(counts.total) ? 'done' : 'running';
    await conn.query(
      `UPDATE batches SET completed_count=?, error_count=?, status=?,
         completed_at=CASE WHEN ?='done' THEN ? ELSE completed_at END,
         total_cost_usd=COALESCE(total_cost_usd,0) + COALESCE(?,0),
         total_duration_ms=COALESCE(total_duration_ms,0) + COALESCE(?,0)
       WHERE id=?`,
      [counts.done_ct || 0, counts.error_ct || 0, batchStatus, batchStatus, Date.now(),
       costUsd ?? null, durationMs, batchId]);

    // Réclamation ATOMIQUE du droit d'envoyer l'email de fin de lot : deux
    // items peuvent terminer au même instant et arriver TOUS LES DEUX ici avec
    // batchStatus='done' -- sans ce verrou, chacun enverrait l'email. La ligne
    // `batches` est déjà verrouillée par la transaction en cours (l'UPDATE
    // juste au-dessus), donc un seul des deux appels peut faire passer
    // email_sent de 0 à 1.
    let shouldNotify = false;
    if (batchStatus === 'done') {
      const [claim] = await conn.query('UPDATE batches SET email_sent=1 WHERE id=? AND email_sent=0', [batchId]);
      shouldNotify = claim.affectedRows === 1;
    }

    await conn.commit();
    return { batchStatus, shouldNotify };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

/**
 * UN SEUL réessai automatique après échec (décision Andrianina, 28/09/2026) :
 * remet l'item 'en_attente', vide started_at/completed_at pour de vrai,
 * retry_count 0 -> 1, et le place À LA FIN de la file (requeued_at). Ne touche
 * ni aux compteurs ni au statut du lot (un item remis en file n'est pas un
 * état terminal -- jamais d'email de fin en avance).
 *
 * @returns {Promise<boolean>} false si l'item est introuvable ou a déjà été
 *   réessayé une fois (retry_count != 0).
 */
async function requeueBatchItem(pool, batchId, itemId, errorMessage) {
  const [result] = await pool.query(
    `UPDATE batch_items
        SET status='en_attente', started_at=NULL, completed_at=NULL,
            error_message=COALESCE(?, error_message),
            retry_count=retry_count+1, requeued_at=?
      WHERE id=? AND batch_id=? AND retry_count=0`,
    [errorMessage ?? null, Date.now(), itemId, batchId],
  );
  return !!(result && result.affectedRows);
}

module.exports = { updateBatchItem, requeueBatchItem, TERMINAL_STATUSES };
