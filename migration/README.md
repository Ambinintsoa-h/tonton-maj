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

## Étapes suivantes (à venir)
2. Import MySQL (normalisation des timestamps, éclatement des tableaux en tables
   filles, préservation des IDs/uid, reset des mots de passe par email).
3. Couche REST du proxy (endpoints + autorisation par rôle serveur-side).
4. Réécriture de la façade `src/services/firebase.js` (mêmes signatures).
5. Répétition sur base de staging puis bascule prod.
