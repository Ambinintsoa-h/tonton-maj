# Suivi des rédacteurs

Où lire le travail de l'équipe : combien d'articles, par qui, pour combien de dollars,
combien de temps Tonton AI a traité, combien de temps un humain a relu — et comment
sortir tout ça en Excel sur la période de son choix.

> Écrit le 15 septembre 2026, à la demande d'Andrianina.

---

## 1. Où ça se passe

Une seule page : **`/maj-en-attente` — « Mes MAJ »**.

Ce n'est plus un écran de lancement (le lancement vit sur `/lots`) : c'est le tableau de
bord de consultation de ce qui a déjà été traité.

| Rôle | Ce qu'il voit |
|---|---|
| `cq_ia` | ses propres lots uniquement — la restriction est appliquée **côté serveur**, jamais laissée au client |
| `manager` | toute l'équipe, **sauf** le temps de relecture |
| `super_admin` | tout, temps de relecture compris |

Le temps de relecture est réservé au super admin (route `GET /relecture-time`). Quand il
n'est pas lisible, l'écran écrit **« Réservé au super admin »** au lieu d'afficher `0 min` :
« personne n'a relu » et « je n'ai pas le droit de lire » ne doivent jamais se confondre.

---

## 2. Les quatre chiffres, et ce qu'ils mesurent vraiment

### Volume — combien d'articles, par qui, quel jour

Un article = une ligne `batch_items`, rattachée au lot qui l'a lancé. Le jour retenu est
celui de la **fin de traitement** (à défaut : le démarrage, puis le lancement), en **heure
locale du lecteur** — jamais UTC, sinon un article traité à 23 h 40 bascule au lendemain.

### Coût — combien en dollars

`costUsd` par article, cumulé. C'est le coût **API Anthropic réel** de l'article (audit +
génération + passes de style et de gras), pas une estimation.

### Temps Tonton — combien de temps la machine a traité

`completedAt − startedAt` du `batch_item`. C'est du **temps machine**, de bout en bout :
recherche web, audit, rédaction, vérification des liens.

### Temps de relecture — combien de temps l'humain a relu

Table `relecture_time`, alimentée par `relectureTimeTracker.js`. Deux compteurs, par
**jour** et par **personne** :

- **« hors Tonton »** — temps actif humain. Battement d'une minute, et une minute n'est
  comptée que s'il y a eu une action (clic, clavier, souris, défilement) dans les
  5 dernières minutes. **Une pause de plus de 5 minutes ne compte pas** : c'est du temps
  de travail réel, pas du calendaire.
- **« avec Tonton »** — le même total, **plus** la durée des appels IA déclenchés pendant
  cette fenêtre (passe de style, réécriture de passage ou de section, vérification
  d'obsolescence). Il est donc toujours **≥** « hors Tonton », rien n'est à soustraire.

L'export n'affiche **pas** ces deux totaux côte à côte : il montre la durée humaine, puis
l'**écart** entre les deux, sous le nom « dont attente IA (s) ». Mesuré le 16 septembre 2026
sur la table entière : 4 lignes sur 110 diffèrent, pour **18 secondes** d'écart cumulé — les
actions IA des phases 3 et 4 ne sont quasiment jamais déclenchées. Deux colonnes affichant le
même nombre n'informaient pas, elles faisaient douter du fichier entier. Un zéro dans la
colonne d'écart, lui, se lit tout de suite : aucune aide IA sur cette relecture.
L'instrumentation, elle, est complète et vérifiée — les cinq appels concernés sont branchés.

⚠️ **Périmètre** : uniquement les **phases 3 (Obsolescence) et 4 (Relecture)**. Ni l'audit,
ni la génération — c'est bien le temps de **relecture**, pas le temps passé sur l'article.

### Ce qu'il ne faut pas faire

**Ne jamais additionner « Tonton » et « Relecture ».** Pendant que Tonton traite un article,
le rédacteur en relit un autre : la somme ne correspondrait à aucune durée vécue.

**Le lanceur n'est pas toujours le relecteur.** Quelqu'un qui a seulement relu apparaît avec
`0` article et son temps de relecture ; quelqu'un qui a seulement lancé apparaît sans temps
de relecture. C'est la donnée telle qu'elle est, et elle n'est pas maquillée : fondre les
deux ferait croire à un lien qui n'existe pas.

---

## 3. Choisir une période

Deux façons, dans le bandeau de filtres :

- **les deux champs de date** (du … au …, bornes incluses) ;
- **les raccourcis** :
  - *glissants* : « Aujourd'hui », « 7 jours », « 30 jours » — pour suivre une tendance ;
  - *calendaires* : « Cette semaine » (lundi → aujourd'hui, semaine ISO), « Ce mois »,
    « Cette année » — pour produire un bilan.

Les filtres **Site** et **Statut** s'ajoutent à la période. Tout ce qui est affiché est
exactement ce qui sera exporté.

---

## 4. Exporter en Excel

Bouton **« Exporter en Excel »**, en haut à droite. Le fichier sort directement du
navigateur (aucun aller-retour serveur) et reflète **exactement** la période et les filtres
affichés à l'écran.

Nom du fichier : `tonton-suivi-redacteurs_2026-09-01_au_2026-09-30.xlsx`

### Feuille « Détail » — une ligne par article

| Colonne | Contenu |
|---|---|
| Article, Site, Mot-clé | identité de l'article |
| Lancé par | qui a lancé le lot |
| Lancé le · Démarré le · Terminé le | horodatages réels |
| Traitement Tonton (s) | temps machine |
| Relecture humaine (min) | temps humain cumulé sur cet article, tous jours et tous relecteurs |
| dont attente IA (s) | la part passée à attendre un appel IA |
| Relu par | qui a relu |
| Coût ($) | coût API réel |
| Statut | en clair : « Publié sur WordPress », « Traité par Tonton — en attente de relecture », « En attente de traitement par Tonton », « Erreur de traitement » |
| Publié le | horodatage de publication |

Le statut n'est pas la valeur brute de la base (`fait`, `erreur`) : « fait » veut dire
« Tonton a fini », pas « publié ». La colonne écrit l'état réel, celui que l'écran affiche
déjà — un fichier ouvert trois semaines plus tard doit se lire sans l'application à côté.

### Feuille « Par jour et par rédacteur » — **la réponse à la question posée**

Une ligne par couple (jour × personne) : Articles traités · Coût ($) · Traitement Tonton
(min) · Relecture humaine (min) · dont attente IA (s).

**Une seule colonne par durée** : une pour la machine, une pour l'humain. La moyenne par
article vit dans la feuille « Par utilisateur », elle n'a pas à encombrer celle-ci.

C'est la feuille à ouvrir pour « quel volume par jour par quel user, combien en $, combien
de temps Tonton traite, combien de temps l'utilisateur relit ».

### Feuille « Par utilisateur » — les mêmes agrégats sans le découpage par jour

Avec en plus le **taux d'erreur** et le **coût total**.

### Feuille « Par jour » — volume et coût de toute l'équipe, jour par jour

### Feuilles vides

Une feuille reste présente **même sans ligne**. Son absence se lirait « cette donnée
n'existe pas », alors qu'elle veut dire « rien sur la période » — ou « pas le droit de la
lire ». L'en-tête reste, les lignes non.

---

## 5. Les autres écrans de suivi (pour mémoire)

| Écran | Ce qu'on y trouve |
|---|---|
| `/equipe` → clic sur un membre | panneau `MemberStatsPanel` : onglet « MAJ fait » (temps par article, du lancement à la publication, table `article_time`), onglet « Liste absence » (jours ouvrés sans session sur 30 jours) |
| `/dashboard` | vue d'ensemble, selon le rôle |
| `/lots` | lancement et avancement des lots en cours |

`article_time` (durée globale lancement → publication) et `relecture_time` (phases 3 et 4,
par jour) sont **deux tables indépendantes** qui ne mesurent pas la même chose. Elles sont
volontairement séparées : `article_time` est un module sensible et éprouvé, et les fusionner
obligerait à revalider les deux à chaque ajustement de l'une.

---

## 6. Limites connues, à dire plutôt qu'à découvrir

- **Le temps de relecture n'existe que depuis la mise en place du tracker.** Avant, la table
  est vide — ce n'est pas zéro, c'est inconnu.
- **Un super admin de secours** (connexion locale via `settings.json`, sans session Firebase)
  n'est pas tracké : ses écritures sont refusées silencieusement.
- **Trou de données historique** : le suivi d'activité a été mort du 16 juin au 17 juillet
  2026. Aucune reconstitution n'est possible sur cette fenêtre.
- **`GET /relecture-time` renvoie toute la table**, sans filtre de date côté serveur. Le
  bornage à la période se fait dans le navigateur. Si le volume devient gênant, c'est là
  qu'il faudra ajouter un filtre serveur.
