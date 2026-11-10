-- ─────────────────────────────────────────────────────────────────────────────
-- ALTER — cache des historiques de position Haloscan (dashboard « Effet des MAJ »)
-- ─────────────────────────────────────────────────────────────────────────────
-- A executer UNE FOIS sur la base en ligne (phpMyAdmin -> base eufcarqxft_stomos
-- -> onglet SQL), AVANT de merger/deployer la PR "dashboard effet des MAJ".
--
-- POURQUOI UNE TABLE ET PAS UN APPEL DIRECT
-- Le dashboard compare la position d'une page AVANT et APRES ses MAJ. La source
-- n'est pas `seo_snapshots` : mesure en prod le 09/11/2026, 97 positions
-- trouvees sur 988 relevs (9,8 %) -- un bilan calcule la-dessus porterait sur
-- une poignee d'articles tout en ayant l'air d'un bilan. La source est
-- /keywords/serp/pageEvolution, qui renvoie la COURBE complete d'une URL sur un
-- mot-cle : plusieurs points avant la MAJ, plusieurs apres, donc une mediane au
-- lieu d'un releve unique.
--
-- Mais pageEvolution coute un credit par appel. 225 couples URL+mot-cle recalcules
-- a chaque ouverture de page = le budget mensuel en quelques jours. Cette table
-- garde l'historique brut ; le cron le rafraichit au plus une fois par semaine
-- (~900 credits/mois, 9 % du budget). Rien ne se perd a espacer : chaque appel
-- renvoie l'historique ENTIER, pas le dernier point.
--
-- POURQUOI L'HISTORIQUE BRUT ET PAS LE RESULTAT CALCULE
-- Les regles d'agregation (fenetres avant/apres, seuil de stabilite) vont bouger
-- a l'usage. Stocker le brut rend chaque reglage gratuit ; stocker le calcul
-- obligerait a racheter 225 credits a chaque ajustement.
--
-- SANS RISQUE : une table NEUVE, aucune ligne existante touchee, aucune FK.
-- Tant qu'elle est vide, le dashboard affiche « pas encore de donnees » et le
-- reste de l'outil ne la regarde jamais.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS seo_position_cache (
  -- SHA-256 de `article_url + '|' + keyword` : une URL peut depasser la taille
  -- indexable d'une cle MySQL (767 o / 3072 o selon le format de ligne), un
  -- hash de longueur fixe ne le peut pas.
  couple_hash    CHAR(64)     NOT NULL,
  article_url    TEXT         NOT NULL,
  keyword        VARCHAR(255) NOT NULL,

  -- position_history brut d'Haloscan : [{ search_date: 'YYYY-MM-DD', position: '12'|'NA' }]
  history        JSON         NULL,
  volume_history JSON         NULL,

  -- Date du dernier appel ABOUTI ou RATE : c'est elle qui pilote le
  -- rafraichissement, sinon un couple en erreur serait rappele a chaque passe
  -- du cron et brulerait le budget en boucle.
  fetched_at     BIGINT       NOT NULL,

  -- Message du dernier echec, NULL si le dernier appel a reussi. Distingue
  -- « Haloscan ne connait pas cette page » (history = [], error = NULL) de
  -- « l'appel a rate » (error renseigne) -- confusion exacte qui rend
  -- `seo_snapshots` illisible aujourd'hui, ou un timeout et une page hors SERP
  -- s'ecrivent tous les deux `position: null`.
  error          TEXT         NULL,

  PRIMARY KEY (couple_hash),
  KEY idx_seo_cache_fetched (fetched_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Verification :
-- DESCRIBE seo_position_cache;
-- SELECT COUNT(*) FROM seo_position_cache;
