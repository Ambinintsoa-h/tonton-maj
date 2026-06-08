# Firebase / Firestore

## Collections
| Collection | Description |
|-----------|-------------|
| `skills` | Skills IA |
| `knowledge` | Base de connaissances |
| `articles` | Historique MAJ (HTML dans Storage) |
| `wordpress_sites` | Sites WP (sans password) |
| `users` | Membres (avatarUrl, firstName, lastName) |
| `pending` | File d'attente partagée |
| `settings` | Config partagée |
| `stats` | Statistiques globales |
| `tickets` | Tickets |
| `ticket_comments` | Commentaires tickets |
| `notifications` | Notifications in-app |
| `activity_sessions` | Tracking — 1 doc par user par jour |

## `activity_sessions` — ID : `{userId}_{YYYY-MM-DD}`
```js
{
  userId, userName, userRole, date,
  firstActivityAt: number,   // ⚠️ JAMAIS écrasé (getDoc avant write)
  lastActivityAt:  number,
  totalActiveMinutes: number,
  connections: [{ at: number }],             // reconnexions
  closes: [number],                          // timestamps fermeture onglet
  pauses: [{ start: number, end: number }],  // inactivité > 10 min
  hourlyActivity: { "8": 5, "14": 12 },
  actions: { articlesUpdated, ticketsCreated, ticketsCommented, ticketsResolved, total }
}
```

**Règle `saveActivitySession`** : `getDoc` avant écriture → `setDoc` si nouveau, `updateDoc` si existant (`firstActivityAt` jamais touché).

## Règles Firestore
- `where` + `orderBy` sur champs différents = index composite requis → **tri client-side**
- Range de dates OK sur champ unique : `where('date', '>=', X) AND where('date', '<=', Y)`
- Clés API (Anthropic/Groq/Brave/Tavily/Haloscan) **jamais** dans Firestore
- Application Passwords WP **oui** (révocables)
- Firebase Console : Action URL → `https://maj.stomos.net/reset-password`
