-- ─────────────────────────────────────────────────────────────────────────────
-- ALTER -- ajoute le verrou d'envoi de l'email de fin de lot (chantier MAJ en
-- masse, notification de fin -- suite Phase 5)
-- ─────────────────────────────────────────────────────────────────────────────
-- A executer UNE FOIS sur la base en ligne (phpMyAdmin -> base eufcarqxft_stomos
-- -> onglet SQL), AVANT de merger/deployer la PR correspondante.
--
-- Pourquoi : quand un lot termine, PUT /batches/:id/items/:itemId doit
-- reclamer ATOMIQUEMENT le droit d'envoyer l'email de fin -- sinon deux items
-- qui terminent au meme instant (concurrence de l'orchestrateur) enverraient
-- CHACUN l'email, dupliquant la notification.
--
-- Sans risque : une seule colonne NEUVE, valeur par defaut 0, aucune ligne
-- existante modifiee.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE batches
  ADD COLUMN email_sent TINYINT(1) NOT NULL DEFAULT 0;

-- Verification :
-- DESCRIBE batches;
