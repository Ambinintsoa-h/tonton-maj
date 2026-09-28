-- ─────────────────────────────────────────────────────────────────────────────
-- ALTER -- ajoute le réessai automatique d'un article en échec dans "MAJ en
-- lot" (un seul réessai, renvoyé en fin de file ; erreur définitive au 2e échec)
-- ─────────────────────────────────────────────────────────────────────────────
-- A executer UNE FOIS sur la base en ligne (phpMyAdmin -> base eufcarqxft_stomos
-- -> onglet SQL), AVANT de merger/deployer la PR correspondante.
--
-- Pourquoi : décision Andrianina, 28 septembre 2026. Jusqu'ici, un article qui
-- échouait (scraping, IA, WordPress...) passait directement en statut 'erreur'
-- DÉFINITIF -- seul un humain pouvait le relancer, dans un NOUVEAU lot. `PUT
-- /batches/:id/items/:itemId` (data-api.js) ne peut pas servir à remettre un
-- item en file : ses colonnes se mettent à jour via COALESCE(?, colonne), donc
-- un NULL explicite (vider started_at/completed_at) ne fait RIEN -- il faut une
-- route dédiée (`POST /batches/:id/items/:itemId/requeue`) qui, elle, écrit ces
-- colonnes SANS COALESCE.
--
-- `retry_count` distingue le premier échec (0 -> on réessaie) du second (déjà
-- 1 -> erreur définitive, jamais une 3e tentative). `requeued_at` fait passer
-- l'item À LA FIN de la file : `batch_items.id` est un UUID aléatoire
-- (crypto.randomUUID(), data-api.js) qui n'a jamais représenté un ordre
-- d'arrivée, donc `ORDER BY bi.id` seul ne peut pas définir de "fin" -- le tri
-- de claimNext (batchOrchestrator.js) devient
-- `ORDER BY (requeued_at IS NOT NULL), requeued_at, id` : tout item jamais
-- réessayé (requeued_at NULL) passe avant tout item réessayé, quel que soit
-- son id.
--
-- Sans risque : deux colonnes NEUVES, nullable/à défaut 0, aucune ligne
-- existante modifiée (les lots déjà terminés ne repasseront jamais par
-- claimNext, qui ne réclame que 'en_attente').
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE batch_items
  ADD COLUMN retry_count INT NOT NULL DEFAULT 0,
  ADD COLUMN requeued_at BIGINT NULL;

-- Verification :
-- DESCRIBE batch_items;
