-- ─────────────────────────────────────────────────────────────────────────────
-- ALTER -- battement de cœur des articles "MAJ en lot" (batch_items.heartbeat_at)
-- ─────────────────────────────────────────────────────────────────────────────
-- A executer UNE FOIS sur la base en ligne (phpMyAdmin -> base eufcarqxft_stomos
-- -> onglet SQL). Peut passer AVANT ou APRÈS le déploiement de la PR : tant que
-- la colonne manque, le serveur la détecte et retombe sur l'ancienne détection
-- des orphelins (par started_at), sans jamais planter -- il bascule tout seul
-- sur le battement de cœur dans les 10 min qui suivent la migration.
--
-- Pourquoi : incident du 01/10/2026. Un lot de 8 articles est resté à 0/8
-- pendant 4 heures : ses 6 articles "en_cours" n'avançaient plus (pipeline
-- mort ou bloqué) mais occupaient les 6 places de concurrence, et rien ne les
-- libérait avant la réparation à 30 min (qui ne tournait qu'au démarrage du
-- serveur ou toutes les 30 min). Le processus qui fait tourner un article
-- rafraîchit désormais `heartbeat_at` toutes les 30 s ; un article qui ne
-- bat plus depuis 3 min est remis en file au tick suivant, par n'importe quel
-- processus -- au lieu de bloquer le lot pendant des heures.
--
-- Sans risque : colonne NEUVE, nullable, aucune ligne existante modifiée.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE batch_items
  ADD COLUMN heartbeat_at BIGINT NULL;

-- Verification :
-- SHOW COLUMNS FROM batch_items LIKE 'heartbeat_at';
