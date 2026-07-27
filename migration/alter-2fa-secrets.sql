-- ─────────────────────────────────────────────────────────────────────────────
-- ALTER — élargir les colonnes de secrets TOTP (lot 7b-2)
-- ─────────────────────────────────────────────────────────────────────────────
-- À exécuter UNE FOIS sur la base en ligne (phpMyAdmin → base eufcarqxft_stomos
-- → onglet SQL), AVANT d'activer la 2FA en mode mysql.
--
-- Pourquoi : les secrets TOTP sont désormais chiffrés au repos (AES-256-GCM,
-- crypto-util.js). Le format "iv:tag:ct" en base64 fait ~86 caractères alors que
-- les colonnes étaient en VARCHAR(64) → l'écriture serait tronquée/refusée.
--
-- Sans risque : la table two_factor est vide tant que la 2FA n'a pas été importée
-- (l'ALTER ne touche aucune donnée existante).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE two_factor
  MODIFY totp_secret         VARCHAR(255) NULL,
  MODIFY pending_totp_secret VARCHAR(255) NULL;

-- Vérification (les deux lignes doivent afficher varchar(255)) :
-- SHOW COLUMNS FROM two_factor LIKE '%totp_secret';
