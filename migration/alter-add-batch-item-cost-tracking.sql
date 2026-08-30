-- ─────────────────────────────────────────────────────────────────────────────
-- ALTER -- ajoute le suivi cout/tokens par article de batch (Phase 8 --
-- supervision admin : temps passe par article, tokens et prix consommes)
-- ─────────────────────────────────────────────────────────────────────────────
-- A executer UNE FOIS sur la base en ligne (phpMyAdmin -> base eufcarqxft_stomos
-- -> onglet SQL), AVANT de merger/deployer la PR correspondante.
--
-- Pourquoi : `batches.total_cost_usd` / `total_duration_ms` existent depuis la
-- Phase 2 mais n'ont JAMAIS ete alimentes -- l'orchestrateur (Phase 5) ne les
-- ecrivait pas. Le temps par article se deduit deja de started_at/completed_at
-- (colonnes existantes), mais le cout/les tokens ne se deduisent de RIEN :
-- sans ces colonnes, aucune vue de supervision ne peut jamais les afficher.
--
-- Sans risque : trois colonnes NEUVES, nullable, aucune ligne existante
-- modifiee.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE batch_items
  ADD COLUMN cost_usd DOUBLE NULL,
  ADD COLUMN input_tokens INT NULL,
  ADD COLUMN output_tokens INT NULL;

-- Verification :
-- DESCRIBE batch_items;
