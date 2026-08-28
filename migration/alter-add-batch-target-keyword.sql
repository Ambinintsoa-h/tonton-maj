-- ─────────────────────────────────────────────────────────────────────────────
-- ALTER -- ajoute le mot-cle cible aux lignes de batch (chantier MAJ en masse,
-- Phase 5 -- orchestration)
-- ─────────────────────────────────────────────────────────────────────────────
-- A executer UNE FOIS sur la base en ligne (phpMyAdmin -> base eufcarqxft_stomos
-- -> onglet SQL), AVANT de merger/deployer la PR "orchestration batch Phase 5".
--
-- Pourquoi : runArticlePipeline() (src/server/pipeline.js) EXIGE un
-- targetKeyword -- sans lui il leve une erreur ("targetKeyword requis") avant
-- meme de scraper l'article. La table batch_items (Phase 2) n'avait pas cette
-- colonne : aucun batch n'aurait jamais pu etre traite par l'orchestrateur.
--
-- Sans risque : une seule colonne NEUVE, nullable, aucune ligne existante
-- modifiee. Les batches deja lances avant cette migration resteront bloques
-- sans mot-cle (l'orchestrateur les marquera 'erreur' -- voir
-- batchOrchestrator.js) ; ils devront etre relances.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE batch_items
  ADD COLUMN target_keyword VARCHAR(255) NULL AFTER article_url;

-- Verification :
-- DESCRIBE batch_items;
