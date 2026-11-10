-- ─────────────────────────────────────────────────────────────────────────────
-- ALTER — suivi du budget API Anthropic (recharges, alerte sous seuil,
-- coût du cache)
-- ─────────────────────────────────────────────────────────────────────────────
-- À exécuter UNE FOIS sur la base en ligne (phpMyAdmin → base eufcarqxft_stomos
-- → onglet SQL), AVANT de merger/déployer la PR « budget API ».
--
-- Pourquoi : l'API a été chargée de 600 $ le 10/11/2026 et RIEN dans l'outil ne
-- sait combien il en reste. `model_call_log` mesure déjà la consommation en
-- dollars (jamais purgée, jamais réinitialisée) — il manquait l'autre moitié de
-- la soustraction : ce qui a été chargé, et quand.
--
-- Sans risque : deux tables NEUVES et deux colonnes NEUVES nullables sur
-- model_call_log. Aucune ligne existante n'est modifiée, aucune lecture
-- existante ne change de forme.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Les recharges saisies à la main ───────────────────────────────────────
-- `recharged_on` est une DATE et pas un timestamp : une recharge se constate au
-- jour près (le relevé Anthropic est journalier), et une heure inventée pour
-- faire joli serait une précision mensongère. Le budget se calcule à partir du
-- DÉBUT du jour de la première recharge — voir premiereRechargeMs dans
-- src/utils/apiBudget.js.
--
-- `amount_usd` en DECIMAL et pas en DOUBLE : c'est de l'argent saisi à la main,
-- 600.00 doit rester 600.00. `model_call_log.cost_usd` est déjà en DECIMAL(10,6)
-- pour la même raison.
CREATE TABLE IF NOT EXISTS api_recharges (
  id            INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  amount_usd    DECIMAL(10,2) NOT NULL,
  recharged_on  DATE          NOT NULL,
  note          VARCHAR(255)  NULL,
  created_by    VARCHAR(128)  NULL,
  created_at    BIGINT        NOT NULL,
  PRIMARY KEY (id),
  KEY idx_api_recharges_date (recharged_on)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 2. Le JOURNAL des alertes — un envoi TENTÉ écrit une ligne ───────────────
-- PIÈGE CONNU ET DOCUMENTÉ DE CE PROJET : les envois SMTP échouent EN SILENCE
-- quand SMTP n'est pas configuré (sendTicketEmail, sendResetEmail, sendInviteEmail
-- se contentent d'un console.warn et d'un `return`). Une alerte budget qui ne
-- part jamais sans que personne ne le sache serait PIRE que pas d'alerte : on
-- croirait être prévenu.
--
-- D'où un journal, et pas un simple drapeau `alerte_envoyee` : CHAQUE tentative
-- écrit sa ligne avec son `status` — y compris `smtp_absent` et `echec`, qui
-- sont justement les cas qu'un drapeau booléen rendrait invisibles. La page
-- budget affiche la dernière ligne telle quelle.
--
-- C'est AUSSI la mémoire du réarmement : `kind` distingue le franchissement
-- (une fois, quand on passe sous le seuil) du rappel (une fois par semaine tant
-- qu'on reste sous le seuil sans recharge). Sans ce journal, le cron des 6 h
-- renverrait le même mail quatre fois par jour.
CREATE TABLE IF NOT EXISTS api_budget_alerts (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  sent_at       BIGINT       NOT NULL,
  kind          VARCHAR(16)  NOT NULL,   -- 'franchissement' | 'rappel'
  status        VARCHAR(16)  NOT NULL,   -- 'envoye' | 'echec' | 'smtp_absent'
  remaining_usd DECIMAL(12,4) NULL,
  threshold_usd DECIMAL(12,4) NULL,
  recipients    VARCHAR(512) NULL,
  error         VARCHAR(500) NULL,
  PRIMARY KEY (id),
  KEY idx_api_budget_alerts_date (sent_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 3. Les tokens de cache, jamais facturés jusqu'ici ────────────────────────
-- `calcCost` (agent.js) ne facture QUE input + output. Les tokens de cache
-- n'entrent dans AUCUN calcul — alors que le diagnostic laissé dans proxy.js
-- relève « cache_creation_input_tokens (9674) a chaque fois » sur des audits
-- réels, écriture facturée 1,25× et jamais relue. Le budget restant serait donc
-- systématiquement trop optimiste, et l'écart se creuserait article après
-- article sans que rien ne le trahisse.
--
-- `makeTokenTracker` compte déjà ces tokens (acc.cacheWrite / acc.cacheRead) :
-- ils étaient mesurés et jetés. Ces deux colonnes les gardent.
--
-- CE QUI N'EST PAS TOUCHÉ : `calcCost`, `stats.total_cost_usd`, le Dashboard et
-- `model_call_log.cost_usd` gardent leur définition à l'octet près. Seule la
-- page budget facture le cache, à partir de ces colonnes. Décision assumée
-- (Andrianina, 10/11/2026) : corriger calcCost ferait bouger un chiffre affiché
-- à toute l'équipe depuis des mois, pour une PR dont ce n'est pas le sujet.
--
-- NULL par défaut, et c'est voulu : les lignes antérieures à cette migration
-- n'ont pas la donnée. Un 0 mentirait (« pas de cache »), NULL dit « on ne sait
-- pas » — et la page budget compte ces lignes comme non mesurées plutôt que
-- comme gratuites.
ALTER TABLE model_call_log
  ADD COLUMN cache_write_tokens INT UNSIGNED NULL,
  ADD COLUMN cache_read_tokens  INT UNSIGNED NULL;

-- Vérifications :
-- SELECT COUNT(*) FROM api_recharges;
-- SELECT COUNT(*) FROM api_budget_alerts;
-- SHOW COLUMNS FROM model_call_log LIKE 'cache_%';
