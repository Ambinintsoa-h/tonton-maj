# TONTON AI — Mémoire projet (article-updater)

## Index
- [Règles comportementales](#règles-comportementales) — Instructions permanentes
- [Workflow Git / Déploiement](#workflow-git--déploiement) — ⚠️ CRITIQUE
- [Architecture technique](#architecture-technique) — Stack, infra
- [Rôles et sécurité](#rôles-et-sécurité) — Auth, JWT, sécurité
- [Fonctionnalités implémentées](#fonctionnalités-implémentées) — État du SaaS
- [Firebase / Firestore](#firebase--firestore) — Collections, schémas, règles
- [Fichiers clés](#fichiers-clés) — Carte des fichiers importants
- [À faire](#à-faire) — Tâches futures

---

## Règles comportementales

> **IMPÉRATIVES — toutes les sessions**

1. Terminer chaque intervention par **`TERMINER SIR`**
2. Poser les questions **une par une** avant de coder
3. **Toujours demander permission avant de déployer** (`Je peux déployer ?`)
4. **Ne jamais lancer `npm start`** — l'utilisateur le fait lui-même
5. L'utilisateur a accès au terminal — commandes directes OK

---

## Workflow Git / Déploiement

> ⚠️ **CRITIQUE — lire avant tout commit**

### Règle absolue : push direct sur `main`
```bash
git add <fichiers>
git commit -m "message"
git push origin main   # → GitHub Actions déploie automatiquement sur maj.stomos.net
```

### Interdictions absolues
- **Ne JAMAIS reset `main` via l'API GitHub** — casse le CI/CD (redéploie l'ancien code)
- **Ne JAMAIS créer de branches/PR via reset de main** — même pour un "joli diff"
- Si `/create-pr-command` demandé : commit + push main → fournir URL commit : `https://github.com/Ambinintsoa-h/tonton-maj/commit/{SHA}`

### Token GitHub
Récupérer en session avec : `printf "protocol=https\nhost=github.com\n" | git credential fill`
⚠️ Ne jamais hardcoder le token dans ce fichier.

---

## Architecture technique

### Stack
- **Frontend** : React 19 · Redux Toolkit · React Router v7 · Framer Motion · Tailwind CSS · **Recharts**
- **Backend** : Express proxy (`proxy.js`) — Node.js, JWT, Firebase Admin SDK v13
- **DB** : Firebase Firestore + Firebase Storage (client v12)
- **Auth** : JWT interne + Firebase Auth (manager/cq_ia) + admin local (super_admin)
- **Email** : Nodemailer (SMTP)
- **IA** : Claude API Anthropic · Groq Whisper · Brave/Tavily/SearXNG/Jina (proxifiés)

### Infra
- **Prod** : `maj.stomos.net` — N0C (node143-eu.n0c.com, port 5022, user eufcarqxft)
- **CI/CD** : push main → GitHub Actions → SCP → `npm install --omit=dev` → `cp build/ public/` → `touch tmp/restart.txt`
- **Repo** : `https://github.com/Ambinintsoa-h/tonton-maj.git`
- **Firebase project** : `tonton-ai-c8196`

### Variables d'env (.env — gitignorées)
`JWT_SECRET`, `ADMIN_PASSWORD` (crashe si valeurs par défaut), `ADMIN_USERNAME`, `PORT`, `NODE_ENV=production`

---

## Rôles et sécurité

| Rôle | Accès |
|------|-------|
| `super_admin` | Tout + Paramètres + création tous rôles |
| `manager` | Équipe (CQ IA) + Tickets L1 + Dashboard équipe |
| `cq_ia` | MAJ + MAJ en attente + Historique (ses articles) + Tickets (ses tickets) |

- **super_admin** : login local JWT (+ 2FA si activée)
- **manager/cq_ia** : Firebase Auth → `POST /api/firebase-login` → JWT interne (+ 2FA si activée)
- **2FA** : TOTP (speakeasy) ou Email OTP — activable dans Mon compte
- **SAFE_USERNAME_RE** : `/^[a-zA-Z0-9._-]{1,64}$/` — points autorisés (colonel.sanders)
- JWT 8h · tempToken 2FA 5m

### Sécurité proxy.js (fixes appliqués)
- Rate limiter AVANT les routes auth (60/min global, 10/min auth)
- `assertSafeUrl` async + `dns.lookup()` (anti DNS rebinding)
- Clés API (Brave/Tavily/Anthropic/Groq) jamais exposées au client
- Application Passwords WordPress **persistés dans Firestore** (token révocable ≠ mot de passe admin)
- OTP 2FA hashé HMAC-SHA256 avant stockage disque
- LiteLLM pricing : validation 0 < prix < 200 $/MTok

---

## Fonctionnalités implémentées

### Pages / Routes
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
| `/login` | Login.jsx | Public |
| `/reset-password` | ResetPassword.jsx | Public |

### Tracking activité invisible (manager/cq_ia)
Système 100% transparent côté manager/cq_ia. Visible uniquement par le super_admin.

**`activityTracker.js`** — singleton, initialisé dans `App.js` :
- Heartbeat Firestore toutes les **2 min** si activité détectée
- Pause détectée après **10 min** sans activité
- `trackAction(type)` appelé depuis Articles.jsx et Tickets.jsx
- Initié uniquement pour `manager` et `cq_ia`

**Dashboard `TeamActivityWidget`** (super_admin) :
- Filtres : Aujourd'hui / Hier / Semaine / Mois / Période personnalisée
- Tableau par membre : Début · Fin · Temps actif · Actions · Articles · Tickets · Pauses · Statut live
- Badge vert animé si `lastActivityAt < 10 min`
- Heure = **timezone du super_admin** (`new Date(ts)` → local auto)

**Page Équipe `MemberStatsPanel`** (slide droite) :
- Clic sur carte membre (super_admin uniquement, rôles manager/cq_ia)
- Vue "Par jour" : KPIs + Timeline + Chart horaire + Absences
- Vue "7 derniers jours" : AreaChart + BarChart + tableau détaillé
- `z-[200]` — passe au-dessus du header (zIndex: 100)

**Actions trackées** : `articlesUpdated` · `ticketsCreated` · `ticketsCommented` · `ticketsResolved`

### Autres fonctionnalités clés
- **Ticketing complet** : catégories/priorités/statuts/escalade L2/pièces jointes/notifications ciblées
- **Notifications** : cloche header, dropdown real-time (Firestore onSnapshot), clic → ouvre ticket
- **Mon compte** : photo profil (Storage), 2FA, prénom/nom sync Firestore
- **Avatars** : photo uploadée → DiceBear Kawaii → initiales colorées (`AccountAvatar` depuis MonComptePanel.jsx)
- **Tarification IA** : prix Anthropic auto depuis LiteLLM toutes les 6h, fallback hardcodé
- **Reset MDP** : page branded `/reset-password`, `confirmPasswordReset` Firebase
- **Dashboard** : 3 vues selon rôle (super_admin / manager / cq_ia)

---

## Firebase / Firestore

### Collections
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
| `activity_sessions` | **Tracking** — 1 doc par user par jour |

### `activity_sessions` — ID : `{userId}_{YYYY-MM-DD}`
```js
{
  userId, userName, userRole, date,
  firstActivityAt: number,   // ⚠️ JAMAIS écrasé (getDoc avant write)
  lastActivityAt:  number,
  totalActiveMinutes: number,
  connections: [{ at: number }],              // une entrée par reconnexion du jour
  pauses: [{ start: number, end: number }],  // inactivité > 10 min
  hourlyActivity: { "8": 5, "14": 12 },
  actions: { articlesUpdated, ticketsCreated, ticketsCommented, ticketsResolved, total }
}
```

**Règle `saveActivitySession`** : `getDoc` avant écriture → `setDoc` si nouveau, `updateDoc` si existant (firstActivityAt jamais touché).

**Périodes hors-ligne** : déduites des gaps entre `connections[i]` et `connections[i+1]`.

### Règles Firestore
- `where` + `orderBy` sur champs différents = index composite requis → **tri client-side**
- Range de dates OK sur champ unique : `where('date', '>=', X) AND where('date', '<=', Y)`
- Clés API (Anthropic/Groq/Brave/Tavily/Haloscan) **jamais** dans Firestore — Application Passwords WP **oui** (révocables)

---

## Fichiers clés

```
article-updater/
├── proxy.js                          ← Backend Express (1800+ lignes)
├── src/
│   ├── App.js                        ← Routes + ActivityTrackerInit
│   ├── store/slices/
│   │   ├── authSlice.js              ← uid, username, role, prenom, nom
│   │   ├── settingsSlice.js          ← DEFAULT_MODEL_PRICING
│   │   ├── ticketsSlice.js
│   │   └── notificationsSlice.js
│   ├── services/
│   │   ├── firebase.js               ← Toutes fonctions Firestore/Storage + activity_sessions
│   │   ├── activityTracker.js        ← Singleton tracking invisible
│   │   ├── agent.js                  ← runAgent / runReviewAgent
│   │   └── search.js                 ← searchWeb → /api/brave, /api/tavily, /api/searxng
│   ├── pages/
│   │   ├── Articles.jsx              ← trackAction('articlesUpdated')
│   │   ├── Tickets.jsx               ← trackAction(ticketsCreated/Commented/Resolved)
│   │   ├── Dashboard.jsx             ← TeamActivityWidget (super_admin)
│   │   ├── Equipe.jsx                ← clic membre → MemberStatsPanel
│   │   └── ResetPassword.jsx
│   └── components/
│       ├── layout/Header.jsx         ← ⚠️ zIndex: 100 (inline) — overlays = z-[200] min
│       ├── account/MonComptePanel.jsx ← AccountAvatar (exporté partout)
│       └── stats/MemberStatsPanel.jsx ← Slide panel stats (z-[200])
├── data/                             ← Gitignorés
│   ├── settings.json                 ← Clés API (Anthropic, Groq, Brave, Tavily, SMTP)
│   ├── firebase-service-account.json
│   ├── 2fa/{username}.json
│   └── profiles/{username}.json
└── public/tonton.jpg
```

---

## À faire

- **Firebase Console** : Action URL → `https://maj.stomos.net/reset-password` (reset MDP 100% custom)
- **Firestore rules** : auditer (apiKey dans le bundle → sécurité dépend des rules)
- **Rate limiter** : `Map()` reset au redémarrage → Redis ou fichier (amélioration future)
- **Modales** : vérifier que tous les overlays utilisent `z-[200]` (pas `z-50`)
