-- ─────────────────────────────────────────────────────────────────────────────
-- ALTER — ajoute le suivi du temps de RELECTURE (phases 3 Obsolescence + 4
-- Relecture uniquement), par jour, separe hors Tonton / avec Tonton
-- ─────────────────────────────────────────────────────────────────────────────
-- A executer UNE FOIS sur la base en ligne (phpMyAdmin -> base eufcarqxft_stomos
-- -> onglet SQL), AVANT de merger/deployer la PR "temps de relecture".
--
-- Pourquoi : data-api.js expose desormais POST /relecture-time/ensure|record|
-- record-ai et GET /relecture-time -- sans cette table, ces routes
-- echoueraient en 500 des le premier appel (meme lecon que
-- alter-add-batches.sql).
--
-- Sans risque : une table NEUVE, completement independante d'article_time --
-- aucune colonne existante touchee, aucune ligne existante modifiee.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE relecture_time (
  article_id          VARCHAR(64)  NOT NULL,
  user_id             VARCHAR(64)  NOT NULL,
  date                CHAR(10)     NOT NULL,   -- YYYY-MM-DD, LOCAL au redacteur (jamais recalculee serveur)
  user_name           VARCHAR(190) NULL,
  user_role           VARCHAR(16)  NULL,
  title               TEXT         NULL,
  url                 TEXT         NULL,
  hors_tonton_seconds INT          NOT NULL DEFAULT 0,  -- temps actif humain, idle-gate
  avec_tonton_seconds INT          NOT NULL DEFAULT 0,  -- hors_tonton_seconds + duree des appels IA
  started_at          BIGINT       NULL,
  last_activity_at    BIGINT       NULL,
  published_at        BIGINT       NULL,   -- annotation optionnelle, pas la cle de regroupement
  PRIMARY KEY (article_id, user_id, date),
  KEY idx_relecture_time_user_date (user_id, date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Verification :
-- SHOW TABLES LIKE 'relecture_time';
-- DESCRIBE relecture_time;
