-- ─────────────────────────────────────────────────────────────────────────────
-- ALTER — ajoute le modele de donnees "Batch" (chantier MAJ en masse via GSheet, Phase 2)
-- ─────────────────────────────────────────────────────────────────────────────
-- A executer UNE FOIS sur la base en ligne (phpMyAdmin -> base eufcarqxft_stomos
-- -> onglet SQL), AVANT de merger/deployer la PR "modele de donnees Batch".
--
-- Pourquoi : data-api.js expose desormais GET/POST /batches et
-- PUT /batches/:id/items/:itemId -- sans ces deux tables, ces routes
-- echoueraient en 500 des le premier appel (meme lecon que
-- alter-stats-by-pass.sql : une table manquante casse la route qui la lit,
-- pas seulement la fonctionnalite qui l'ecrit).
--
-- Sans risque : deux tables NEUVES, aucune colonne existante touchee, aucune
-- ligne existante modifiee.
-- ─────────────────────────────────────────────────────────────────────────────

-- Un batch = un lancement (import GSheet ou manuel) regroupant plusieurs articles.
CREATE TABLE batches (
  id                VARCHAR(64)  NOT NULL,
  source            VARCHAR(16)  NOT NULL DEFAULT 'manual',   -- 'gsheet' | 'manual'
  status            VARCHAR(16)  NOT NULL DEFAULT 'pending',  -- pending | running | done | error
  launched_by       VARCHAR(64)  NULL,                        -- uid de l'auteur
  launched_by_name  VARCHAR(190) NULL,                        -- nom affiche (email notif, supervision)
  launched_at       BIGINT       NOT NULL,
  completed_at      BIGINT       NULL,
  row_count         INT          NOT NULL DEFAULT 0,
  completed_count   INT          NOT NULL DEFAULT 0,
  error_count       INT          NOT NULL DEFAULT 0,
  total_cost_usd    DOUBLE       NULL,
  total_duration_ms BIGINT       NULL,
  data              JSON         NULL,                        -- reglages du lancement (modelSelections...)
  PRIMARY KEY (id),
  KEY idx_batches_launched (launched_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Une ligne = un article du batch (correspond a une ligne du GSheet une fois cable).
CREATE TABLE batch_items (
  id            VARCHAR(64)  NOT NULL,
  batch_id      VARCHAR(64)  NOT NULL,
  row_ref       VARCHAR(64)  NULL,      -- reference ligne GSheet (Phase 3)
  site          VARCHAR(190) NULL,
  article_url   TEXT         NULL,
  maj_type      VARCHAR(16)  NULL,      -- 'maj' | 'refonte'
  consigne      TEXT         NULL,      -- consigne libre pour TONTON (colonne GSheet)
  status        VARCHAR(16)  NOT NULL DEFAULT 'en_attente',  -- en_attente|en_cours|fait|erreur|a_revoir
  article_id    VARCHAR(64)  NULL,      -- rempli une fois l'article cree (voir table articles)
  error_message TEXT         NULL,
  started_at    BIGINT       NULL,
  completed_at  BIGINT       NULL,
  PRIMARY KEY (id),
  KEY idx_batch_items_batch (batch_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Verification (doit lister les deux tables) :
-- SHOW TABLES LIKE 'batch%';
