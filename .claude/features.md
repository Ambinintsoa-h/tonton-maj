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
| `/archives` | Archives.jsx | super_admin — articles archivés (restaurer / suppression définitive) |

## Temps par article (article_time)
- `articleTimeTracker.js` — singleton mono-article : `begin()` au lancement d'analyse (Articles.jsx, buffer avant l'id) et à l'ouverture dans l'éditeur (ArticleResult), heartbeat 1 min (inactivité > 5 min = pause), `markPublished()` à la publication WP
- Doc Firestore `article_time/{articleId}_{userId}` — increment atomique
- Affiché dans le popup membre de `/equipe` (MemberStatsPanel, super_admin) : onglet « MAJ fait » (temps par article, du « Lancer la MAJ » à la publication) + onglet « Liste absence » (jours ouvrés sans session sur 30 jours). L'ancienne page `/temps` a été supprimée.

## Archivage Historique
- Bouton Archiver (super_admin) dans Historique → flag `archived` sur le doc article → disparaît de l'Historique, visible dans `/archives` (Restaurer / Supprimer définitivement)

## Pagination
- 50 éléments max par page (composant commun `Pagination.jsx` + `pageSlice`) : Historique, MAJ en attente, Archives

## Pipeline MAJ article
1. **Passe 1** (`runAgent`) : extraction requêtes → Brave+Tavily parallèle → scraping → Claude Sonnet → JSON updates → `applyAllDiffs` → `moveFaqToEnd`
2. **Passe 2** (`runReviewAgent`) : requêtes complémentaires → recherche → Claude Sonnet → JSON updates → `applyAllDiffs` → `moveFaqToEnd`
3. **FAQ** : `moveFaqToEnd(html)` détecte et déplace la section FAQ en fin d'article automatiquement (classe/id "faq" ou heading "FAQ / Questions fréquentes")
4. **Liens internes** : 2-4 suggestions via WP REST API + Claude (si site WP connecté)
5. **Titre** : `titleDirty` flag — titre envoyé à WP seulement si l'utilisateur le modifie manuellement ; sinon initialisé depuis `wpTitle` → H1 de l'article original

## Recherche web (search.js)
- **Brave + Tavily en parallèle** (`Promise.allSettled`) — résultats fusionnés, dédupliqués
- Tavily : `days: 365`, `search_depth: advanced` → contenu complet par source (~3000 chars)
- Brave : `freshness: 'pm'` puis `'py'` → URLs récentes
- Fallback : SearXNG → Jina si Brave et Tavily échouent tous les deux
- Clés lues côté serveur (`data/settings.json`) — jamais exposées au client

## Ticketing
→ Voir `.claude/tickets.md` pour le détail complet

## Tracking activité (tous les rôles)
- Tous les rôles trackés (cq_ia, manager, support, super_admin) — sauf le super_admin de SECOURS (login local settings.json, sans session Firebase : écritures Firestore refusées silencieusement)
- Historique : tracking mort du 16 juin au 17 juillet 2026 → trou de données définitif. Deux bugs successifs : (1) règles du 16/06 — get refusé sur doc inexistant → cq_ia morts, managers survivants via isAdmin() ; (2) « réparation » du 13/07 — updateDoc sans userId dans le patch → 'permission-denied' (jamais 'not-found') sur doc inexistant → repli setDoc jamais exécuté → PERSONNE tracké. Corrigé le 17/07 : userId toujours dans le patch + repli tolérant aux deux codes (même correctif pour article_time / ensureArticleTimeDoc)
- `activityTracker.js` — singleton, heartbeat 2 min, pause après 10 min sans activité
- `closes[]` dans Firestore : enregistré via `beforeunload`/`pagehide` + localStorage backup
- KPI "Absent" = `sessionWindowMin - totalActiveMinutes`

## Autres
- **Notifications** : cloche header, real-time Firestore onSnapshot
- **Mon compte** : photo profil (Storage), 2FA, prénom/nom
- **Avatars** : `AccountAvatar` — photo → DiceBear → initiales
- **Tarification IA** : prix Anthropic auto depuis LiteLLM, cache 6h
- **Reset MDP** : `/reset-password` branded, Firebase confirmPasswordReset
- **Vidéo YouTube** : export → URL brute `<p>` (WP oEmbed) — pas d'iframe (strippé par wp_kses)
