-- ─────────────────────────────────────────────────────────────────────────────
-- RAPPORT — articles traités par un modèle donné depuis une date, coût total
-- et moyen. S'appuie sur `model_call_log` (voir alter-add-model-call-log.sql).
-- ─────────────────────────────────────────────────────────────────────────────
-- ⚠ Ne peut répondre qu'à partir du moment où model_call_log existe et
-- accumule des données (déploiement de la PR "journal permanent des coûts
-- IA"). Il ne peut PAS reconstituer l'historique du 24/08 au jour du
-- déploiement : cette période n'a jamais été journalisée durablement (voir
-- le commentaire en tête d'alter-add-model-call-log.sql) et n'est pas
-- récupérable depuis la base. Pour ce passé-là, la seule source possible est
-- la Console Anthropic (Usage), si la clé API de TONTON AI est dédiée.
--
-- Remplacer '2026-08-24 15:03:40' (24 août 2026, 18:03:40 +0300 → UTC) et
-- 'claude-haiku-4-5' selon le besoin. `model LIKE 'claude-haiku-4-5%'` attrape
-- aussi bien 'claude-haiku-4-5' que 'claude-haiku-4-5-20251001' (versions
-- datées de l'alias).
-- ─────────────────────────────────────────────────────────────────────────────

-- 1) Résumé : nombre de MAJ (articles distincts) touchées, appels, coût total
--    et coût moyen (par appel ET par article, un article pouvant déclencher
--    plusieurs appels au même modèle sur des passes différentes).
SELECT
  COUNT(DISTINCT article_id)              AS majs_distinctes,
  COUNT(*)                                AS appels_modele,
  SUM(input_tokens)                       AS tokens_entree_total,
  SUM(output_tokens)                      AS tokens_sortie_total,
  ROUND(SUM(cost_usd), 6)                 AS cout_total_usd,
  ROUND(SUM(cost_usd) / COUNT(*), 6)      AS cout_moyen_par_appel_usd,
  ROUND(SUM(cost_usd) / COUNT(DISTINCT article_id), 6) AS cout_moyen_par_maj_usd
FROM model_call_log
WHERE model LIKE 'claude-haiku-4-5%'
  AND logged_at >= UNIX_TIMESTAMP('2026-08-24 15:03:40') * 1000;

-- 2) Détail : liste des articles (MAJ) traités par ce modèle depuis cette
--    date, avec leur coût cumulé sur CE modèle uniquement (un article peut
--    aussi avoir des passes sur un autre modèle, non comptées ici).
SELECT
  article_id,
  MAX(article_title)                      AS titre,
  GROUP_CONCAT(DISTINCT sub_pass ORDER BY sub_pass SEPARATOR ', ') AS passes,
  COUNT(*)                                AS appels,
  SUM(input_tokens)                       AS tokens_entree,
  SUM(output_tokens)                      AS tokens_sortie,
  ROUND(SUM(cost_usd), 6)                 AS cout_usd,
  FROM_UNIXTIME(MIN(article_created_at) / 1000) AS premiere_passe,
  FROM_UNIXTIME(MAX(article_created_at) / 1000) AS derniere_passe
FROM model_call_log
WHERE model LIKE 'claude-haiku-4-5%'
  AND logged_at >= UNIX_TIMESTAMP('2026-08-24 15:03:40') * 1000
GROUP BY article_id
ORDER BY derniere_passe DESC;
