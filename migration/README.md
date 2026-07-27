# Migration Firestore → MySQL/MariaDB

Outils de migration de la persistance (Firestore → MariaDB 10.6 sur n0c).
Voir le schéma cible : `schema-mysql-v1.sql` *(ajouté à l'étape suivante)*.

## Étape 1 — Export Firestore (lecture seule)

`export-firestore.js` exporte **toutes** les collections Firestore en JSON,
**sans jamais rien écrire ni supprimer** côté Firestore.

### Prérequis
- `data/firebase-service-account.json` présent (la même clé que `proxy.js`),
  ou la variable d'env `FIREBASE_SERVICE_ACCOUNT` pointant vers un autre chemin.
- `npm install` effectué (dépendance `firebase-admin`, déjà au `package.json`).

### Lancer
```bash
node migration/export-firestore.js
```

### Sortie — dossier `migration/export/` (⚠️ GITIGNORÉ)
- `<collection>.json` — tableau `[{ id, ...data }]`, écrit en flux (pas de
  surcharge mémoire même sur les gros articles). Les `Timestamp` Firestore sont
  convertis en **millisecondes** (notre convention `BIGINT`).
- `_report.json` — statistiques par collection **sans valeurs** (aucune donnée
  sensible dans le rapport) : nombre de docs, champs et types rencontrés,
  **champs à types mixtes** (surtout les dates parfois stockées en chaîne ISO,
  parfois en nombre → à normaliser à l'import), tailles (docs > 900 Ko / 1 Mo).

> ⚠️ Le dossier `export/` contient des **données réelles** (dont les
> Application Passwords WordPress). Il est gitignoré : ne jamais le committer,
> ne jamais le sortir du poste/serveur.

## Étape 2 — Schéma + import MariaDB

### Variables `.env` (racine — gitignoré, jamais committé)
```
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=eufcarqxft_stomos
DB_PASSWORD=********
DB_NAME=eufcarqxft_stomos
DB_POOL=10
# Clé de chiffrement des Application Passwords WP (32 octets base64) :
#   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
APP_ENCRYPTION_KEY=********
```
> Pour la **répétition sur staging**, pointez `DB_NAME`/`DB_USER` vers une 2ᵉ base
> (cPanel) ou un MariaDB local — jamais la prod tant que tout n'est pas validé.

### Lancer (dans l'ordre)
```bash
npm install                                   # ajoute mysql2
mysql -u USER -p BASE < migration/schema-mysql-v1.sql   # 1. crée les ~25 tables
node migration/import-mysql.js                # 2. charge les données (npm run migrate:import)
```

`import-mysql.js` est **idempotent** (TRUNCATE + INSERT) : rejouable autant de
fois que voulu sur staging. Il :
- normalise les timestamps (ISO → ms), caste les IDs numériques ;
- éclate les `arrayUnion` (connections/pauses/closes/snapshots) en tables filles ;
- extrait `editingLock` / `seoTracking` dans leurs tables ;
- **chiffre** les Application Passwords WP (AES-256-GCM, `APP_ENCRYPTION_KEY`) ;
- **n'importe PAS** les mots de passe (`password_hash` NULL — reset forcé à la bascule) ;
- **supprime** `firebaseConfig` de `settings`.

Modules partagés (racine, réutilisés par `proxy.js` en Phase 2) :
`db.js` (pool mysql2 utf8mb4) · `crypto-util.js` (AES-256-GCM).

## Étape 3b — 2FA : fichiers → table `two_factor` (lot 7b-2)

La 2FA vivait dans `data/2fa/{username}.json` **sur le serveur** (jamais dans le
dépôt). En mode `mysql`, `proxy.js` lit/écrit la table `two_factor` à la place,
avec les **secrets TOTP chiffrés au repos** (`APP_ENCRYPTION_KEY`).

### À exécuter SUR n0c, dans l'ordre, AVANT la bascule
```bash
# 1. élargir les colonnes de secrets (chiffré ≈ 86 car. > VARCHAR(64))
#    → phpMyAdmin, onglet SQL : contenu de migration/alter-2fa-secrets.sql
node migration/import-2fa.js            # 2. DRY-RUN : liste ce qui serait importé
node migration/import-2fa.js --apply    # 3. écrit réellement dans two_factor
```

⚠️ **Étape critique de la bascule.** Sans cet import, un membre ayant activé la
2FA n'a aucun secret en base : au mieux il est verrouillé, au pire il se connecte
**sans second facteur** (une ligne absente se lit comme « 2FA désactivée », exactement
comme un fichier absent aujourd'hui). Le DRY-RUN signale les comptes **orphelins**
(fichier 2FA sans fiche `users`) — à traiter avant de basculer.

Clé de la table : l'`uid` de la fiche `users` ; `env:<username>` pour le
super_admin break-glass du `.env`, qui n'a pas de fiche `users`.

## Étapes suivantes
3. Couche REST du proxy (endpoints + autorisation par rôle serveur-side).
4. Réécriture de la façade `src/services/firebase.js` (mêmes signatures).
5. Répétition sur base de staging puis bascule prod (emails de reset).
