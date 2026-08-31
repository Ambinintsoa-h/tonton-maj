-- ─────────────────────────────────────────────────────────────────────────────
-- ALTER — ajoute la table de mise en attente des lignes détectées sur le
-- Google Sheet (synchronisation automatique, chantier MAJ en lot)
-- ─────────────────────────────────────────────────────────────────────────────
-- À exécuter en prod AVANT le merge (phpMyAdmin -> base eufcarqxft_stomos ->
-- onglet SQL).
--
-- Pourquoi : le cron de synchronisation (src/server/googleSheetSync.js,
-- proxy.js) et les nouvelles routes GET/POST /api/data/gsheet-staged
-- lisent/écrivent cette table dès le démarrage -- sans elle, le premier tick
-- du cron échoue en boucle et les routes répondent 500 (même leçon que
-- alter-add-batches.sql : une table manquante casse tout ce qui la lit).
--
-- Décision Andrianina, août 2026 : la détection est automatique (cron 5 min)
-- mais le LANCEMENT reste manuel -- une ligne détectée est seulement STAGÉE
-- ici, jamais transformée en `batches`/`batch_items` toute seule. Le clic sur
-- "Lancer" (écran /lots) crée le batch normalement et marque la ligne
-- 'lance' avec son batch_id.
--
-- Sans risque : une table NEUVE, aucune colonne existante touchée.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE gsheet_staged_items (
  id             VARCHAR(64)  NOT NULL,
  spreadsheet_id VARCHAR(128) NOT NULL,
  row_ref        VARCHAR(64)  NOT NULL,   -- colonne "N°" du Sheet -- clé de dédoublonnage
  site           VARCHAR(190) NULL,
  article_url    TEXT         NULL,
  target_keyword VARCHAR(255) NULL,
  maj_type       VARCHAR(16)  NULL,       -- 'maj' | 'refonte'
  consigne       TEXT         NULL,
  status         VARCHAR(16)  NOT NULL DEFAULT 'nouveau',  -- nouveau | lance | ignore
  batch_id       VARCHAR(64)  NULL,       -- rempli une fois lancé (voir table batches)
  detected_at    BIGINT       NOT NULL,
  updated_at     BIGINT       NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_gsheet_staged_row (spreadsheet_id, row_ref),
  KEY idx_gsheet_staged_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Vérification :
-- DESCRIBE gsheet_staged_items;
