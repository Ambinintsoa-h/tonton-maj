# Firebase / Firestore

## Collections
| Collection | Description |
|-----------|-------------|
| `users` | Membres (avatarUrl, prenom, nom, role) |
| `skills` | Skills IA actifs |
| `knowledge` | Base de connaissances |
| `articles` | Historique MAJ (HTML dans Storage) |
| `wordpress_sites` | Sites WP (Application Passwords) |
| `pending` | File d'attente partagée |
| `settings` | Config partagée (lecture tous, écriture super_admin) |
| `stats` | Statistiques globales |
| `tickets` | Tickets — voir `.claude/tickets.md` |
| `ticket_comments` | Commentaires tickets |
| `notifications` | Notifications in-app |
| `activity_sessions` | Tracking — 1 doc par user par jour |
| `article_time` | Temps actif par article×éditeur — doc `{articleId}_{userId}`, increment 1 min, `publishedAt` à la publication ; list réservée super_admin |

## `activity_sessions` — ID : `{userId}_{YYYY-MM-DD}`
```js
{
  userId, userName, userRole, date,
  firstActivityAt: number,   // ⚠️ JAMAIS écrasé (getDoc avant write)
  lastActivityAt:  number,
  totalActiveMinutes: number,
  connections: [{ at: number }],
  closes: [number],
  pauses: [{ start: number, end: number }],
  hourlyActivity: { "8": 5, "14": 12 },
  actions: { articlesUpdated, ticketsCreated, ticketsCommented, ticketsResolved, total }
}
```

**Règle `saveActivitySession`** : `getDoc` avant écriture → `setDoc` si nouveau doc, `updateDoc` si existant (`firstActivityAt` jamais touché).

## Règles Firestore importantes
- `where` + `orderBy` sur champs différents → index composite requis → **préférer tri client-side**
- Range dates OK sur champ unique : `where('date', '>=', X)` + `where('date', '<=', Y)`
- Clés API (Anthropic/Groq/Brave/Tavily) **jamais** dans Firestore → `data/settings.json`
- Application Passwords WP **oui** dans Firestore (révocables indépendamment)

## Firebase Console
- Action URL reset MDP → `https://maj.stomos.net/reset-password`
- Project ID : `tonton-ai-c8196`
