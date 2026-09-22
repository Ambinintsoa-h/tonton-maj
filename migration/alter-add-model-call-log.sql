-- ─────────────────────────────────────────────────────────────────────────────
-- ALTER — journal PERMANENT des appels modèle (jamais purgé, jamais réinitialisé)
-- ─────────────────────────────────────────────────────────────────────────────
-- À exécuter UNE FOIS sur la base en ligne (phpMyAdmin → base eufcarqxft_stomos
-- → onglet SQL), AVANT de merger/déployer la PR "journal permanent des coûts IA".
--
-- Pourquoi : `stats` (id='main') est un SINGLETON écrasé à chaque PUT et remis à
-- zéro par le bouton « Réinitialiser les stats » (resetStats, statsSlice.js).
-- Son détail par passe (`history`) est en plus plafonné à 200 entrées côté
-- client (state.history.length > 200 → pop()) : avec 150+ articles traités
-- depuis le dernier changement de modèle, la fenêtre tournait déjà plusieurs
-- fois avant même un reset. Résultat vérifié le 22/09/2026 : impossible de
-- répondre à « combien de MAJ ont tourné sur Haiku 4.5 depuis le changement du
-- 24/08 » — la donnée n'existe plus nulle part.
--
-- Cette table ne remplace PAS `stats` (qui reste le compteur d'équipe affiché
-- au Dashboard) : elle journalise EN PLUS, en écriture seule (jamais de DELETE,
-- jamais de reset), une ligne par (article, passe, sous-passe) — le "sous-passe"
-- vient de `byPass` (agent.js → MODEL_PASSES : audit_qat, refonte, gras,
-- obsolescence, style, query_extraction, seo_meta, commentaire_*), puisqu'une
-- seule passe numérotée (1 à 4) peut appeler PLUSIEURS modèles différents (ex.
-- passe 1 = query_extraction sur Haiku + audit_qat sur Sonnet).
--
-- Clé (article_id, pass, sub_pass) : un ré-essai de la même passe sur le même
-- article MET À JOUR sa ligne (ON DUPLICATE KEY UPDATE) au lieu de dupliquer —
-- même règle que le "retrait de l'ancien avant ajout du nouveau" déjà en place
-- pour stats.totalByPass (voir migration/alter-stats-by-pass.sql).
--
-- Sans risque : table neuve, n'affecte aucune donnée existante.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS model_call_log (
  article_id    VARCHAR(64)     NOT NULL,
  pass          TINYINT         NOT NULL,
  sub_pass      VARCHAR(32)     NOT NULL,
  article_title VARCHAR(255)    NULL,
  model         VARCHAR(64)     NOT NULL,
  input_tokens  INT UNSIGNED    NOT NULL DEFAULT 0,
  output_tokens INT UNSIGNED    NOT NULL DEFAULT 0,
  cost_usd      DECIMAL(10,6)   NOT NULL DEFAULT 0,
  article_created_at BIGINT     NULL,
  logged_at     BIGINT          NOT NULL,
  PRIMARY KEY (article_id, pass, sub_pass),
  KEY idx_model_call_log_model_date (model, logged_at),
  KEY idx_model_call_log_date (logged_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Vérification (doit afficher la table, vide) :
-- SELECT COUNT(*) FROM model_call_log;
