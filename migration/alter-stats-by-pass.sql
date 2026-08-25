-- ─────────────────────────────────────────────────────────────────────────────
-- ALTER — ajoute le cumul par passe du registre IA à la table stats
-- ─────────────────────────────────────────────────────────────────────────────
-- À exécuter UNE FOIS sur la base en ligne (phpMyAdmin → base eufcarqxft_stomos
-- → onglet SQL), AVANT de merger/déployer la PR "registre des passes IA —
-- fondations des overrides".
--
-- Pourquoi : le panneau superadmin (lot suivant) affiche le coût moyen réel de
-- chaque passe (audit QAT, refonte, gras, style…) mesuré sur les articles
-- traités. Cette donnée est calculée côté client (aggregateCallsByPass,
-- agent.js) puis accumulée dans stats.totalByPass — mais data-api.js mappe la
-- table stats en colonnes fixes (pas de blob JSON générique), donc une
-- colonne manquante ferait échouer l'INSERT ... ON DUPLICATE KEY UPDATE en
-- ENTIER : plus seulement le nouveau détail, mais la sauvegarde des stats de
-- TOUTE L'ÉQUIPE (total_articles, total_cost_usd, history...).
--
-- Sans risque : NULL par défaut, aucune ligne existante n'est modifiée.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE stats
  ADD COLUMN total_by_pass JSON NULL AFTER history;

-- Vérification (doit afficher la colonne "total_by_pass", type json) :
-- SHOW COLUMNS FROM stats LIKE 'total_by_pass';
