-- ─────────────────────────────────────────────────────────────────────────────
-- ALTER — ajoute la colonne d'attribution aux lignes détectées depuis le
-- Google Sheet (widget "MAJ en attente" du tableau de bord "Mes MAJ")
-- ─────────────────────────────────────────────────────────────────────────────
-- À exécuter en prod AVANT le merge (phpMyAdmin -> base eufcarqxft_stomos ->
-- onglet SQL).
--
-- Pourquoi : le Sheet de suivi porte désormais une colonne "Attribué à"
-- (nom/pseudo du rédacteur visé) -- src/server/gsheetRowParser.js et
-- src/server/googleSheetSync.js l'écrivent dès le prochain déploiement.
-- Sans cette colonne, l'INSERT échoue en boucle dès le premier tick du cron
-- (même leçon que les migrations précédentes de ce chantier : une colonne
-- manquante casse tout ce qui l'écrit, pas seulement ce qui la lit).
--
-- Sans risque : une seule colonne NEUVE, nullable, aucune ligne existante
-- modifiée.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE gsheet_staged_items
  ADD COLUMN assigned_to VARCHAR(190) NULL AFTER consigne;

-- Vérification :
-- DESCRIBE gsheet_staged_items;
