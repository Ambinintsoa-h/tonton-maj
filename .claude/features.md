# Fonctionnalités

## Pages / Routes
| Route | Composant | Rôles |
|-------|-----------|-------|
| `/` | Articles.jsx | Tous |
| `/maj-en-attente` | MajEnAttente.jsx | Tous |
| `/skills` | Skills.jsx | super_admin, manager |
| `/wordpress` | WordPress.jsx | super_admin, manager |
| `/historique` | Historique.jsx | Tous (CQ IA = ses articles) |
| `/equipe` | Equipe.jsx | super_admin, manager |
| `/parametres` | Parametres.jsx | super_admin |
| `/dashboard` | Dashboard.jsx | Tous (vue selon rôle) |
| `/tickets` | Tickets.jsx | Tous |

## Agent IA (agent.js)
- `runAgent` : passe 1 — recherche web + scraping + analyse Claude + suggestions liens internes
- `runReviewAgent` : passe 2 — complétion SEO + vérification skills/base de connaissances
- `getDateContext()` : injecte date du jour + seuil 6 mois dans tous les prompts
- **Additions** : interdites sans source web scrapée (pas d'inventions depuis training data)
- **Liens internes** : 2-4 suggestions par MAJ via WP REST API + Claude (si site WP connecté)
- **Vidéo YouTube** : export → URL brute `<p>` (WordPress oEmbed) — pas d'iframe (strippé par wp_kses)

## Tracking activité (manager/cq_ia uniquement)
- `activityTracker.js` — singleton, heartbeat 2 min, pause après 10 min sans activité
- `closes[]` dans Firestore : enregistré via `beforeunload`/`pagehide` + localStorage backup
- KPI "Absent" = `sessionWindowMin - totalActiveMinutes` (toujours mathématiquement exact)
- `MemberStatsPanel.jsx` : barre récap Actif + Absent = Total session

## Autres
- **Ticketing** : catégories/priorités/statuts/escalade L2/pièces jointes/notifications
- **Notifications** : cloche header, real-time Firestore onSnapshot
- **Mon compte** : photo profil (Storage), 2FA, prénom/nom sync Firestore
- **Avatars** : `AccountAvatar` (MonComptePanel.jsx) — photo → DiceBear → initiales
- **Tarification IA** : prix Anthropic auto depuis LiteLLM toutes les 6h
- **Reset MDP** : `/reset-password` branded, Firebase confirmPasswordReset
