-- ─────────────────────────────────────────────────────────────────────────────
-- CREATE TABLE -- verrou global pour la réclamation d'items "MAJ en lot"
-- ─────────────────────────────────────────────────────────────────────────────
-- A executer UNE FOIS sur la base en ligne (phpMyAdmin -> base eufcarqxft_stomos
-- -> onglet SQL), AVANT de merger/deployer la PR correspondante.
--
-- Pourquoi : incident du 28/09/2026, deuxième round. Le 1er correctif (verrou
-- mémoire `claiming` dans batchOrchestrator.js, PR #397) empêchait DEUX tick()
-- qui se chevauchent DANS LE MÊME PROCESSUS de sur-réclamer -- mais l'hébergement
-- mutualisé (cPanel/Passenger) fait tourner PLUSIEURS PROCESSUS Node pour cette
-- appli en même temps (confirmé en observant, après déploiement du 1er
-- correctif, plusieurs lots DIFFÉRENTS recevoir chacun leur propre lot de
-- nouveaux items "en_cours" au MÊME instant -- impossible si un seul processus
-- appliquait correctement la limite de concurrence). Chaque processus a SA
-- PROPRE instance d'orchestrateur, donc SON PROPRE compteur `active` en
-- mémoire, qui ne voit RIEN de ce qu'un autre processus a déjà réclamé --
-- chacun autorise donc sa propre marge de `concurrency`, et le total réel
-- explose (constaté : plusieurs dizaines d'articles en_cours simultanés pour
-- un réglage à 6).
--
-- Cette table ne sert QU'À ÇA : sa seule ligne est verrouillée
-- (SELECT ... FOR UPDATE) par TOUT processus, avant de compter les items
-- réellement 'en_cours' en base (source de vérité partagée, contrairement au
-- compteur mémoire) et de réclamer les prochains -- ce qui sérialise l'étape
-- "compter puis réclamer" entre TOUS les processus, quel que soit leur nombre.
-- Le reste (le SELECT ... FOR UPDATE SKIP LOCKED sur batch_items lui-même)
-- continue de fonctionner à l'identique.
--
-- Sans risque : table neuve, une seule ligne, aucune donnée existante touchée.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS batch_orchestrator_lock (
  id TINYINT NOT NULL PRIMARY KEY DEFAULT 1
) ENGINE=InnoDB;

INSERT IGNORE INTO batch_orchestrator_lock (id) VALUES (1);

-- Verification :
-- SELECT * FROM batch_orchestrator_lock;
