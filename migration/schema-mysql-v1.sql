-- =====================================================================
-- TONTON AI — Schéma MySQL/MariaDB (migration Firestore -> MariaDB 10.6)
-- Cible : MariaDB 10.6.21 (n0c), base eufcarqxft_stomos
-- Modèle : HYBRIDE (colonnes réelles pour filtres/tris/increments/joins
--          + colonne `data` JSON pour le reste du document
--          + LONGTEXT pour les gros HTML)
-- Conventions : InnoDB · utf8mb4 / utf8mb4_unicode_ci · timestamps BIGINT ms
--               (= Date.now()) · IDs Firestore/uid conservés en VARCHAR PK
--               · tables filles pour arrayUnion · col=col+n pour increment
--               · PAS de FK dures en v1 (index seulement) — cascade gérée
--                 côté application, tolère les orphelins hérités du NoSQL
-- Validé contre l'export réel (migration/export/_report.json, 15 collections) :
--   plus gros doc = 191 Ko (aucun > 900 Ko) ; ENUM confirmés ; pièges relevés
--   ci-dessous (articles.created_at ISO/ms, tickets.level numérique, etc.).
-- =====================================================================

-- La base est en latin1 : on la bascule en utf8mb4 (on a ALL PRIVILEGES).
-- La connexion Node (mysql2) DOIT aussi être en charset:'utf8mb4'.
ALTER DATABASE `eufcarqxft_stomos`
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

-- =====================================================================
-- 1) AUTH / IDENTITÉ  (remplace Firebase Auth + Firestore users + data/*.json)
-- =====================================================================

-- Export : 13 users (roles réels : cq_ia, manager, super_admin ; support absent
-- mais gardé dans l'ENUM). ⚠ ETL : 3 docs portent un champ legacy `password` ->
-- IGNORÉ (reset forcé pour tous) ; 1 doc sans `username` -> dériver de l'email.
CREATE TABLE users (
  uid           VARCHAR(64)  NOT NULL,           -- uid Firebase conservé (PK)
  username      VARCHAR(64)  NOT NULL,
  email         VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NULL,               -- bcrypt/argon2 (défini au reset)
  password_algo VARCHAR(16)  NOT NULL DEFAULT 'bcrypt',
  first_name    VARCHAR(120) NOT NULL DEFAULT '',
  last_name     VARCHAR(120) NOT NULL DEFAULT '',
  role          ENUM('super_admin','manager','cq_ia','support') NOT NULL DEFAULT 'cq_ia',
  status        ENUM('active','disabled') NOT NULL DEFAULT 'active',
  avatar_url    MEDIUMTEXT   NULL,               -- data URL base64 possible
  note          TEXT         NULL,
  created_at    BIGINT       NULL,
  updated_at    BIGINT       NULL,
  data          JSON         NULL,               -- champs résiduels (phone...)
  PRIMARY KEY (uid),
  UNIQUE KEY uq_users_username (username),
  UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE password_reset_tokens (
  token_hash CHAR(64)    NOT NULL,               -- SHA-256 du token envoyé (jamais en clair)
  user_id    VARCHAR(64) NOT NULL,
  expires_at BIGINT      NOT NULL,
  used       TINYINT(1)  NOT NULL DEFAULT 0,
  created_at BIGINT      NOT NULL,
  PRIMARY KEY (token_hash),
  KEY idx_prt_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE two_factor (
  user_id              VARCHAR(64) NOT NULL,     -- (ancien: clé par username en fichier)
  enabled              TINYINT(1)  NOT NULL DEFAULT 0,
  method               ENUM('none','totp','email') NOT NULL DEFAULT 'none',
  totp_secret          VARCHAR(64) NULL,         -- base32 speakeasy (chiffrement au repos conseillé)
  email                VARCHAR(255) NULL,
  email_code_hash      CHAR(64)    NULL,         -- HMAC-SHA256
  email_code_expiry    BIGINT      NULL,
  pending_totp_secret  VARCHAR(64) NULL,
  pending_email        VARCHAR(255) NULL,
  pending_email_code   CHAR(64)    NULL,
  pending_email_expiry BIGINT      NULL,
  PRIMARY KEY (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================================
-- 2) ARTICLES & CONTENU
-- =====================================================================

-- Export : 284 articles, ~13 Mo, plus gros 191 Ko (aucun > 900 Ko -> les
-- anciennes gardes 1 Mo ne se sont JAMAIS déclenchées ; LONGTEXT largement OK).
CREATE TABLE articles (
  id               VARCHAR(64) NOT NULL,
  title            TEXT        NULL,
  url              TEXT        NULL,
  original_content LONGTEXT    NULL,             -- HTML inline (Storage désactivé)
  updated_content  LONGTEXT    NULL,
  archived         TINYINT(1)  NOT NULL DEFAULT 0,
  archived_at      BIGINT      NULL,
  archived_by      VARCHAR(64) NULL,
  last_modified_at BIGINT      NULL,
  last_modified_by VARCHAR(64) NULL,
  -- assignee_id : Historique.jsx filtre les articles du cq_ia par ce champ
  -- (comparé à l'uid OU au username) -> colonne INDEXÉE (filtrage serveur-side).
  assignee_id      VARCHAR(64) NULL,
  created_at       BIGINT      NULL,             -- ⚠ ETL : 90 docs en chaîne ISO, 63 en nombre ms, 131 absents -> normaliser en ms
  updated_at       BIGINT      NULL,
  data             JSON        NULL,             -- updates/audit/analysis/seoMeta/instruction/editedTitle/publishDate/sources/keyword/priority/publishedAt(ISO)/majDepth...
  -- Reproduit le tri client getArticles = max(lastModifiedAt,updatedAt,createdAt)
  sort_at          BIGINT AS (GREATEST(COALESCE(last_modified_at,0),
                                       COALESCE(updated_at,0),
                                       COALESCE(created_at,0))) PERSISTENT,
  PRIMARY KEY (id),
  KEY idx_articles_sort (sort_at),
  KEY idx_articles_archived (archived),
  KEY idx_articles_assignee (assignee_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Verrou d'édition SÉPARÉ des articles : évite de réécrire un article de ~200 Ko
-- à chaque heartbeat (30 s). Acquisition atomique = UPDATE ... WHERE conditionnel.
-- Export : 4 articles portaient un editingLock au moment du dump.
CREATE TABLE article_editing_locks (
  article_id VARCHAR(64) NOT NULL,
  uid        VARCHAR(64) NOT NULL,
  name       VARCHAR(190) NOT NULL DEFAULT '',
  since      BIGINT      NOT NULL,
  heartbeat  BIGINT      NOT NULL,
  PRIMARY KEY (article_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- SEO : métadonnées requêtables par le cron (WHERE next_snapshot_at<=? AND completed=0)
-- Export : 226 articles portaient un sous-objet seoTracking.
CREATE TABLE seo_tracking (
  article_id       VARCHAR(64) NOT NULL,
  enabled          TINYINT(1)  NOT NULL DEFAULT 1,
  keywords         JSON        NULL,
  article_url      TEXT        NULL,
  completed        TINYINT(1)  NOT NULL DEFAULT 0,
  next_snapshot_type VARCHAR(16) NULL,           -- before | after_7d | after_30d | NULL
  next_snapshot_at BIGINT      NULL,
  last_snapshot_at BIGINT      NULL,
  created_at       BIGINT      NULL,
  PRIMARY KEY (article_id),
  KEY idx_seo_due (completed, next_snapshot_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Remplace arrayUnion(seoTracking.snapshots) : 1 ligne par snapshot (append = INSERT)
CREATE TABLE seo_snapshots (
  article_id  VARCHAR(64) NOT NULL,
  type        VARCHAR(16) NOT NULL,              -- before | after_7d | after_30d
  captured_at BIGINT      NOT NULL,
  data        JSON        NULL,                  -- kwResults & co.
  PRIMARY KEY (article_id, type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Brouillon d'autosave : 1 ligne par utilisateur (id = userId). Export : 6 docs.
CREATE TABLE article_drafts (
  user_id    VARCHAR(64) NOT NULL,
  draft      JSON        NULL,                   -- html/originalContent/diff/sources/analysis/audit/wpData...
  updated_at BIGINT      NULL,                   -- (= savedAt côté doc)
  PRIMARY KEY (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- File d'attente partagée « MAJ en attente »
CREATE TABLE pending (
  id          VARCHAR(64) NOT NULL,
  status      VARCHAR(32) NULL,
  assignee_id VARCHAR(64) NULL,
  priority    VARCHAR(16) NULL,
  title       TEXT        NULL,
  url         TEXT        NULL,
  added_at    BIGINT      NULL,
  created_at  BIGINT      NULL,
  data        JSON        NULL,                  -- majResult allégé + source/keyword/depth/notes/startedBy/startedAt
  PRIMARY KEY (id),
  KEY idx_pending_added (added_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================================
-- 3) CONFIG / RÉFÉRENCES
-- =====================================================================

-- Export : 4 skills.
CREATE TABLE skills (
  id         VARCHAR(64) NOT NULL,
  name       VARCHAR(255) NULL,
  active     TINYINT(1)  NULL,
  created_at BIGINT      NULL,
  updated_at BIGINT      NULL,
  data       JSON        NULL,                   -- content/description/body/resources/format
  PRIMARY KEY (id),
  KEY idx_skills_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Export : collection VIDE au moment du dump (aucun doc) — table conservée
-- (la fonctionnalité existe), rien à migrer.
CREATE TABLE knowledge (
  id         VARCHAR(64) NOT NULL,
  title      VARCHAR(255) NULL,
  created_at BIGINT      NULL,
  updated_at BIGINT      NULL,
  data       JSON        NULL,
  PRIMARY KEY (id),
  KEY idx_knowledge_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Export : 15 sites. Le champ Firestore `password` = Application Password WP
-- -> colonne app_password, CHIFFRÉE au repos (AES-256-GCM) à l'import.
CREATE TABLE wordpress_sites (
  id           VARCHAR(64) NOT NULL,
  name         VARCHAR(255) NULL,
  url          TEXT        NULL,
  username     VARCHAR(190) NULL,
  app_password TEXT        NULL,                 -- chiffré (AES-256-GCM, clé .env)
  fonts        JSON        NULL,
  created_at   BIGINT      NULL,
  data         JSON        NULL,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Cache d'analyse IA des commentaires WP (id composite siteId__commentId).
-- Export : 188 docs. ⚠ ETL : commentId parfois numérique (3 docs) -> CAST en string.
CREATE TABLE comment_ai (
  site_id     VARCHAR(64) NOT NULL,
  comment_id  VARCHAR(64) NOT NULL,              -- string OU number à la source -> normalisé string
  category    VARCHAR(64) NULL,
  sentiment   VARCHAR(32) NULL,
  priority    VARCHAR(16) NULL,
  summary     TEXT        NULL,
  draft_reply TEXT        NULL,                  -- (= draftReply)
  updated_at  BIGINT      NULL,
  data        JSON        NULL,                  -- confidence/lang/translationFr
  PRIMARY KEY (site_id, comment_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Export : 2 docs.
CREATE TABLE comment_settings (
  site_id    VARCHAR(64) NOT NULL,
  auto_spam  TINYINT(1)  NOT NULL DEFAULT 0,
  updated_at BIGINT      NULL,
  data       JSON        NULL,
  PRIMARY KEY (site_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Singleton (id='main'). ⚠ ETL : le doc contient smtpPass + haloscanKey (secrets,
-- déjà persistés aujourd'hui) -> conservés (iso-comportement) ; firebaseConfig
-- SUPPRIMÉ (plus de Firebase). Les clés Anthropic/Brave/Tavily/Groq restent
-- STRIPPÉES par l'API (jamais en base).
CREATE TABLE settings (
  id         VARCHAR(16) NOT NULL DEFAULT 'main',
  data       JSON        NULL,
  updated_at BIGINT      NULL,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Singleton (id='main').
CREATE TABLE stats (
  id                  VARCHAR(16)   NOT NULL DEFAULT 'main',
  total_articles      BIGINT        NOT NULL DEFAULT 0,
  total_input_tokens  BIGINT        NOT NULL DEFAULT 0,
  total_output_tokens BIGINT        NOT NULL DEFAULT 0,
  total_cost_usd      DECIMAL(16,6) NOT NULL DEFAULT 0,
  history             JSON          NULL,
  updated_at          BIGINT        NULL,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================================
-- 4) TICKETS / COLLABORATION
-- =====================================================================

-- Export : 114 tickets. Statuts réels : open/testing/resolved/closed (in_progress
-- gardé dans l'ENUM). Priorités : normale/haute/urgent. ⚠ level est NUMÉRIQUE (1/2).
CREATE TABLE tickets (
  id                 VARCHAR(64) NOT NULL,
  creator_id         VARCHAR(64) NOT NULL,
  creator_username   VARCHAR(64) NULL,
  creator_role       VARCHAR(16) NULL,
  assignee_id        VARCHAR(64) NULL,
  assignee_username  VARCHAR(64) NULL,
  status             ENUM('open','in_progress','testing','resolved','closed') NOT NULL DEFAULT 'open',
  priority           VARCHAR(16) NULL,           -- normale | haute | urgent
  level              TINYINT     NULL,           -- 1 = L1, 2 = L2 (stocké en nombre)
  comment_count      INT         NOT NULL DEFAULT 0,
  title              TEXT        NULL,
  created_at         BIGINT      NULL,
  updated_at         BIGINT      NULL,
  resolved_at        BIGINT      NULL,
  closed_at          BIGINT      NULL,
  data               JSON        NULL,           -- description/category/interventionType/attachments/linkedArticle*
  PRIMARY KEY (id),
  KEY idx_tickets_creator (creator_id),
  KEY idx_tickets_status (status),
  KEY idx_tickets_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Export : 117 commentaires.
CREATE TABLE ticket_comments (
  id              VARCHAR(64) NOT NULL,
  ticket_id       VARCHAR(64) NOT NULL,
  author_id       VARCHAR(64) NULL,
  author_username VARCHAR(64) NULL,
  author_role     VARCHAR(16) NULL,
  content         TEXT        NULL,
  attachments     JSON        NULL,
  created_at      BIGINT      NULL,
  PRIMARY KEY (id),
  KEY idx_comments_ticket (ticket_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- `read` est un mot réservé -> colonne `is_read` (l'API la remappe en `read`).
-- Export : 513 notifs.
CREATE TABLE notifications (
  id         VARCHAR(64) NOT NULL,
  to_user_id VARCHAR(64) NOT NULL,
  type       VARCHAR(32) NULL,
  message    TEXT        NULL,
  is_read    TINYINT(1)  NOT NULL DEFAULT 0,
  created_at BIGINT      NULL,
  data       JSON        NULL,                   -- fromUsername/ticketId/ticketTitle/majItemId
  PRIMARY KEY (id),
  KEY idx_notif_user_read (to_user_id, is_read),
  KEY idx_notif_user_created (to_user_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================================
-- 5) TRACKING D'ACTIVITÉ & TEMPS PAR ARTICLE
-- =====================================================================

-- id composite {userId}_{date} -> PK composite. Increments = col=col+n.
-- Export : 45 sessions. ⚠ date/hour = HEURE LOCALE utilisateur (jamais serveur).
CREATE TABLE activity_sessions (
  user_id                   VARCHAR(64) NOT NULL,
  date                      CHAR(10)    NOT NULL,   -- 'YYYY-MM-DD' (heure locale user)
  user_role                 VARCHAR(16) NULL,
  user_name                 VARCHAR(190) NULL,
  first_activity_at         BIGINT      NULL,       -- figé à la création (INSERT-only)
  last_activity_at          BIGINT      NULL,
  total_active_minutes      INT         NOT NULL DEFAULT 0,
  actions_articles_updated  INT         NOT NULL DEFAULT 0,
  actions_tickets_created   INT         NOT NULL DEFAULT 0,
  actions_tickets_commented INT         NOT NULL DEFAULT 0,
  actions_tickets_resolved  INT         NOT NULL DEFAULT 0,
  actions_total             INT         NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, date),
  KEY idx_sessions_date (date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Remplace hourlyActivity.${hour} (increment sur clé dynamique) -> UPSERT count+1
CREATE TABLE activity_hourly (
  user_id        VARCHAR(64) NOT NULL,
  date           CHAR(10)    NOT NULL,
  hour           TINYINT     NOT NULL,             -- 0..23 (heure locale user)
  activity_count INT         NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, date, hour)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Remplacent arrayUnion(connections/pauses/closes) : append = INSERT (atomique)
CREATE TABLE activity_connections (
  id           BIGINT      NOT NULL AUTO_INCREMENT,
  user_id      VARCHAR(64) NOT NULL,
  date         CHAR(10)    NOT NULL,
  connected_at BIGINT      NOT NULL,
  PRIMARY KEY (id),
  KEY idx_conn_user_date (user_id, date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE activity_pauses (
  id          BIGINT      NOT NULL AUTO_INCREMENT,
  user_id     VARCHAR(64) NOT NULL,
  date        CHAR(10)    NOT NULL,
  pause_start BIGINT      NOT NULL,               -- `start`/`end` réservés -> renommés
  pause_end   BIGINT      NOT NULL,
  PRIMARY KEY (id),
  KEY idx_pause_user_date (user_id, date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE activity_closes (
  id         BIGINT      NOT NULL AUTO_INCREMENT,
  user_id    VARCHAR(64) NOT NULL,
  date       CHAR(10)    NOT NULL,
  close_time BIGINT      NOT NULL,
  PRIMARY KEY (id),
  KEY idx_close_user_date (user_id, date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Temps par article×éditeur : id composite {articleId}_{userId} -> PK composite.
-- Export : 7 docs.
CREATE TABLE article_time (
  article_id           VARCHAR(64) NOT NULL,
  user_id              VARCHAR(64) NOT NULL,
  user_name            VARCHAR(190) NULL,
  user_role            VARCHAR(16) NULL,
  title                TEXT        NULL,
  url                  TEXT        NULL,
  total_active_minutes INT         NOT NULL DEFAULT 0,
  started_at           BIGINT      NULL,          -- figé à la création (INSERT-only)
  last_activity_at     BIGINT      NULL,
  published_at         BIGINT      NULL,
  PRIMARY KEY (article_id, user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================================
-- NOTES
-- - revoked_tokens (jti) et login_failures (lockout IP) RESTENT en mémoire
--   dans proxy.js (comportement actuel : fenêtre de 8 h perdue au restart —
--   acceptable pour un outil interne mono-process).
-- - Pas de FK dures : la cascade de deleteArticle (seo_tracking, seo_snapshots,
--   article_editing_locks, article_time) est gérée par l'endpoint DELETE.
-- =====================================================================
