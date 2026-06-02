# TONTON AI — Mémoire projet (article-updater)

## Index
- [Règles comportementales](#règles-comportementales) — Instructions permanentes de l'utilisateur
- [Workflow Git / Déploiement](#workflow-git--déploiement) — ⚠️ Règles commit/push CRITIQUES
- [Architecture technique](#architecture-technique) — Stack, déploiement, structure
- [Rôles et sécurité](#rôles-et-sécurité) — Système de rôles, auth, JWT
- [Fonctionnalités implémentées](#fonctionnalités-implémentées) — État complet du SaaS
- [Firebase / Firestore](#firebase--firestore) — Collections, structure des données
- [Fichiers clés](#fichiers-clés) — Carte des fichiers importants
- [Déploiement](#déploiement) — Infra, CI/CD, serveur

---

## Règles comportementales

> **IMPÉRATIVES — à respecter dans toutes les sessions**

1. **Terminer chaque intervention par `TERMINER SIR`**
2. **Poser les questions une par une** avant de coder si la demande n'est pas claire
3. **Toujours demander permission avant de déployer** (`Je peux déployer ?`)
4. **Ne jamais lancer `npm start`** — l'utilisateur le fait lui-même
5. **L'utilisateur a accès au terminal** — on peut lancer des commandes directement

---

## Workflow Git / Déploiement

> ⚠️ **CRITIQUE — lire avant tout commit ou PR**

### Règle absolue : push direct sur `main`
Ce repo utilise un **workflow push direct sur `main`** — PAS de branches feature, PAS de PR classiques.

```bash
git add <fichiers>
git commit -m "message"
git push origin main   # → GitHub Actions déploie automatiquement sur maj.stomos.net
```

### Quand `/create-pr-command` est demandé
- **NE PAS** réinitialiser `main` via l'API GitHub (`PATCH /git/refs/heads/main`) — ça casse le CI/CD
- **Faire** : commit + push sur main, puis fournir l'URL du commit :
  `https://github.com/Ambinintsoa-h/tonton-maj/commit/{SHA}`
- Les PRs GitHub ne sont pas adaptées à ce workflow — le code est déjà déployé avant qu'une PR puisse être créée

### Pourquoi le reset de main casse tout
GitHub Actions écoute les push sur `main`. Si on force-reset `main` à un commit antérieur via l'API GitHub pour créer un diff de PR, le CI/CD redéploie l'ancienne version en production.

### Token GitHub disponible (en session)
```
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
```
Récupéré avec : `printf "protocol=https\nhost=github.com\n" | git credential fill`

---

## Architecture technique

### Stack
- **Frontend** : React 19 + Redux Toolkit + React Router v7 + Framer Motion + Tailwind CSS + **Recharts** (charts)
- **Backend** : Express proxy (`proxy.js`) — Node.js, JWT, Firebase Admin SDK v13
- **Base de données** : Firebase Firestore + Firebase Storage (Firebase v12 client)
- **Auth** : JWT interne + Firebase Auth (pour manager/cq_ia) + admin local (super_admin)
- **Email** : Nodemailer (SMTP configurable)
- **Transcription** : Groq Whisper
- **Recherche** : Brave Search / Tavily / SearXNG / Jina (tous proxifiés côté serveur)
- **IA** : Claude API Anthropic (OAuth DPAPI ou clé API via settings.json)

### Déploiement
- **Prod** : `maj.stomos.net` sur N0C (node143-eu.n0c.com, port 5022, user eufcarqxft)
- **CI/CD** : GitHub Actions auto-deploy → push main → SCP → `npm install --omit=dev` → `cp build/ public/` → `touch tmp/restart.txt`
- **Repo** : `https://github.com/Ambinintsoa-h/tonton-maj.git`
- **Process** : `node proxy.js` (prod) / `npm start` (dev React) + `node proxy.js` (local)

### Variables d'environnement (.env — gitignorées)
- `JWT_SECRET` — obligatoire en prod (crashe si valeur par défaut)
- `ADMIN_PASSWORD` — obligatoire en prod (crashe si 'admin')
- `ADMIN_USERNAME` — défaut 'admin'
- `PORT` — défaut 3001
- `NODE_ENV=production` en prod

---

## Rôles et sécurité

### Rôles (3 niveaux)
| Rôle | Accès |
|------|-------|
| `super_admin` | Tout + Paramètres + création tous rôles |
| `manager` | Équipe (CQ IA seulement) + Tickets L1 + Dashboard équipe |
| `cq_ia` | Faire une MAJ + MAJ en attente + Historique (ses articles) + Tickets (ses tickets) |

### Auth flow
- **super_admin** : `POST /api/auth/login` → JWT (+ 2FA si activée)
- **manager/cq_ia** : Firebase Auth → `POST /api/auth/firebase-login` → JWT interne (+ 2FA si activée)
- **2FA** : TOTP (speakeasy) ou Email OTP — activable par chaque membre dans Mon compte
- **SAFE_USERNAME_RE** : `/^[a-zA-Z0-9._-]{1,64}$/` — les points sont autorisés (colonel.sanders)
- JWT expire en 8h, tempToken 2FA expire en 5m

### Sécurité proxy.js (fixes appliqués)
- Rate limiter (60/min global, 10/min auth) enregistré AVANT les routes auth
- assertSafeUrl async avec dns.lookup() (anti DNS rebinding)
- Brave/Tavily/SearXNG proxifiés côté serveur (clés jamais dans le navigateur)
- apiKey Anthropic jamais acceptée depuis le client (serveur lit settings.json)
- Mots de passe WordPress en sessionStorage uniquement (pas localStorage)
- OTP 2FA hashé HMAC-SHA256 avant stockage sur disque
- LiteLLM pricing : validation de plage 0 < prix < 200 $/MTok

---

## Fonctionnalités implémentées

### Pages / Routes
| Route | Composant | Rôles |
|-------|-----------|-------|
| `/` | Articles.jsx | Tous |
| `/maj-en-attente` | MajEnAttente.jsx | Tous |
| `/skills` | Skills.jsx | super_admin, manager |
| `/wordpress` | WordPress.jsx | super_admin, manager |
| `/historique` | Historique.jsx | Tous (CQ IA = ses articles seulement) |
| `/equipe` | Equipe.jsx | super_admin, manager |
| `/parametres` | Parametres.jsx | super_admin seulement |
| `/dashboard` | Dashboard.jsx | Tous (vue selon rôle) |
| `/tickets` | Tickets.jsx | Tous |
| `/login` | Login.jsx | Public |
| `/reset-password` | ResetPassword.jsx | Public |

### Ticketing (complet)
- Catégories : bug_app / article_issue / agent_issue / improvement / other
- Priorités : urgent / haute / normale / basse (modifiable par tous)
- Statuts : open → in_progress → resolved → closed (automatiques)
- Escalade L2 : Manager → Super Admin
- CQ IA crée → notifie l'assigné (manager désigné) uniquement
- Manager crée → notifie tous les super admins
- Prise en charge → notifie le créateur
- Commentaire → notifie créateur + assigné
- Résolu → notifie créateur
- Confirmer/rouvrir → notifie l'assigné
- Pièces jointes : photos + vidéos (Firebase Storage)
- Lien article depuis l'historique

### Notifications
- `NotificationPanel` dans le header (cloche + badge rouge)
- Dropdown max 360px, scroll interne
- Fond bleu = non lu, blanc = lu
- Bouton ✓ par notif + "Tout marquer lu"
- Clic → marque lu + ouvre le ticket directement
- Real-time Firestore onSnapshot

### Dashboard (3 vues)
- **super_admin** : CostWidget global + KPIs équipe + tableau productivité + **TeamActivityWidget** (tracking)
- **manager** : KPIs équipe + CQ IA performance
- **cq_ia** : Stats personnelles (filtré par assigneeId)

### Tracking activité (invisible — manager/cq_ia uniquement)
Système 100% transparent côté manager/cq_ia. Visible uniquement par le super_admin.

**`src/services/activityTracker.js`** — singleton initialisé dans App.js :
- Heartbeat Firestore toutes les **2 min** si activité détectée
- **Pause** détectée après **10 min** sans activité (souris/clavier/scroll)
- `trackAction(type)` appelé depuis Articles.jsx et Tickets.jsx pour compter les actions métier
- `init(uid, role, name)` → appelé uniquement pour roles `manager` et `cq_ia`
- `destroy()` → appelé au logout (useEffect cleanup)

**Dashboard super_admin — `TeamActivityWidget`** :
- Filtres : Aujourd'hui / Hier / Semaine / Mois / Période personnalisée (date pickers)
- Tableau par membre : Début · Fin · Temps actif · Actions · Articles · Tickets · Pauses · Statut live
- Actifs maintenant : badge vert animé si `lastActivityAt < 10 min`
- Heure affichée dans **le timezone du super_admin** (`new Date(ts)` = local automatique)

**Page Équipe — `MemberStatsPanel`** (slide depuis la droite) :
- Clic sur une carte membre (super_admin seulement, rôle manager ou cq_ia)
- Vue "Par jour" : KPIs + Timeline + Chart horaire + Absences
- Vue "7 derniers jours" : AreaChart + BarChart + tableau détaillé
- Absences = pauses inactivité (jaune) + périodes hors-ligne/navigateur fermé (gris)

**Actions métier trackées** :
- `articlesUpdated` → Articles.jsx, après traitement complet
- `ticketsCreated` → Tickets.jsx, après `createTicket()`
- `ticketsCommented` → Tickets.jsx, après `addComment()`
- `ticketsResolved` → Tickets.jsx, dans `handleResolve()`

### Mon compte
- Photo de profil (upload → Firebase Storage → base64 data URL)
- Prénom/Nom/Email auto-remplis depuis Firestore au premier login Firebase
- Sync Firestore à chaque mise à jour (firstName, lastName, avatarUrl → visible dans Équipe)
- 2FA TOTP + Email OTP

### Avatars
- Hiérarchie : photo uploadée → DiceBear Kawaii → initiales colorées
- `AccountAvatar` exporté depuis `MonComptePanel.jsx` — utilisé partout

### Tarification IA
- Prix Anthropic auto-chargés depuis LiteLLM (GitHub raw JSON) toutes les 6h
- Fallback hardcodé si LiteLLM inaccessible
- `GET /api/model-pricing` → Redux store → calcCost()

### Réinitialisation mot de passe
- Page `/reset-password` avec thème TONTON AI (glassmorphisme)
- Indicateur de force + show/hide + countdown 5s vers /login
- Firebase `confirmPasswordReset(auth, oobCode, newPassword)`
- Le lien d'invitation inclut `continueUrl` → `/reset-password`
- Pour flow 100% custom : configurer Firebase Console → Action URL → `https://maj.stomos.net/reset-password`

---

## Firebase / Firestore

### Collections
| Collection | Description |
|-----------|-------------|
| `skills` | Skills IA de l'agent |
| `knowledge` | Base de connaissances |
| `articles` | Historique des MAJ (HTML dans Storage) |
| `wordpress_sites` | Sites WP (sans password) |
| `users` | Membres de l'équipe (inclut avatarUrl, firstName, lastName) |
| `pending` | File d'attente partagée |
| `settings` | Config partagée (firebaseConfig) |
| `stats` | Statistiques globales |
| `tickets` | Tickets du système de ticketing |
| `ticket_comments` | Commentaires des tickets |
| `notifications` | Notifications in-app |
| `activity_sessions` | **Tracking activité** — 1 doc par user par jour |

### Collection `activity_sessions`
**ID doc** : `{userId}_{YYYY-MM-DD}` (ex: `abc123_2026-06-02`)

```js
{
  userId:             string,
  userName:           string,
  userRole:           'manager' | 'cq_ia',
  date:               string,          // 'YYYY-MM-DD' locale du membre
  firstActivityAt:    number,          // ⚠️ JAMAIS écrasé après création
  lastActivityAt:     number,          // mis à jour à chaque heartbeat
  totalActiveMinutes: number,          // incrémenté de +2 à chaque heartbeat actif
  connections: [{ at: number }],       // une entrée par connexion du jour (reconnexions incluses)
  pauses: [{ start: number, end: number }],  // inactivité > 10 min (navigateur ouvert)
  hourlyActivity: { "8": 5, "14": 12 },     // clé = heure locale du membre
  actions: {
    articlesUpdated:  number,
    ticketsCreated:   number,
    ticketsCommented: number,
    ticketsResolved:  number,
    total:            number,
  }
}
```

**Règle critique** : `saveActivitySession` fait un `getDoc` avant écriture :
- Doc inexistant → `setDoc` complet (firstActivityAt + connections[0])
- Doc existant → `updateDoc` uniquement (firstActivityAt JAMAIS écrasé)

**Périodes hors-ligne** : déduites des gaps entre `connections[i].at` précédent et `connections[i+1].at`.

**Requêtes** :
```js
// Range de dates (pas d'index composite — range sur champ unique `date`)
getActivitySessionsRange(startDate, endDate)  // where date >= X AND date <= Y

// Sessions d'un user (champ unique userId)
getUserActivitySessions(userId, days)          // where userId == X, tri client-side
```

### Règles importantes
- **Pas de `where` + `orderBy` sur champs différents** sans index composite → tri client-side
- Password WordPress JAMAIS dans Firestore (`const { password, ...safeData } = site`)
- Clés API JAMAIS dans Firestore (anthropicKey, groqKey, braveKey, tavilyKey)
- `avatarUrl` synced vers Firestore à chaque `PUT /api/account`

### Firestore queries (éviter les index composites)
```js
// ❌ Requiert un index composite
query(collection(db, 'tickets'), where('creatorId', '==', id), orderBy('createdAt', 'desc'))

// ✅ where seul + tri client-side
const q = query(collection(db, 'tickets'), where('creatorId', '==', id));
docs.sort((a, b) => b.createdAt - a.createdAt);
```

---

## Fichiers clés

```
article-updater/
├── proxy.js                          ← Backend Express complet (1800+ lignes)
├── src/
│   ├── App.js                        ← Routes + Bootstrap Firebase + ActivityTrackerInit
│   ├── store/
│   │   ├── index.js                  ← Store Redux + persistMiddleware
│   │   └── slices/
│   │       ├── authSlice.js          ← Auth + decodeJwt (uid, username, role, prenom, nom)
│   │       ├── settingsSlice.js      ← DEFAULT_MODEL_PRICING
│   │       ├── ticketsSlice.js       ← Tickets Redux
│   │       └── notificationsSlice.js ← Notifications Redux
│   ├── services/
│   │   ├── firebase.js               ← Toutes les fonctions Firestore + Storage + activity_sessions
│   │   ├── activityTracker.js        ← Singleton tracking invisible (manager/cq_ia)
│   │   ├── agent.js                  ← runAgent / runReviewAgent (search proxifié)
│   │   └── search.js                 ← searchWeb → /api/brave, /api/tavily, /api/searxng
│   ├── pages/
│   │   ├── Tickets.jsx               ← Ticketing complet + trackAction
│   │   ├── Dashboard.jsx             ← 3 vues + TeamActivityWidget (super_admin)
│   │   ├── Equipe.jsx                ← Gestion équipe + clic membre → MemberStatsPanel
│   │   ├── Articles.jsx              ← MAJ articles + trackAction('articlesUpdated')
│   │   └── ResetPassword.jsx         ← Page reset MDP branded
│   └── components/
│       ├── layout/
│       │   ├── Header.jsx            ← Cloche notifs + profil (zIndex: 100 ⚠️)
│       │   └── Sidebar.jsx           ← Nav + badges
│       ├── account/
│       │   └── MonComptePanel.jsx    ← AccountAvatar (exporté) + profil + 2FA
│       ├── notifications/
│       │   └── NotificationPanel.jsx ← Dropdown notifications
│       └── stats/
│           └── MemberStatsPanel.jsx  ← Slide panel stats membre (z-index: 200)
├── data/                             ← Gitignorés (settings.json, 2fa/, profiles/)
│   ├── settings.json                 ← Clés API équipe (Anthropic, Groq, Brave, Tavily, SMTP)
│   ├── firebase-service-account.json ← Service account Firebase Admin
│   ├── 2fa/{username}.json           ← Config 2FA par user (OTP haché HMAC-SHA256)
│   └── profiles/{username}.json      ← Profil local (nom, prénom, email, avatarUrl)
└── public/
    └── tonton.jpg                    ← Avatar TONTON AI (favicon généré via canvas)
```

> ⚠️ **Header zIndex: 100** — tout overlay doit utiliser `z-[200]` minimum pour passer au-dessus.

---

## Identifiants importants (NE PAS committer)
- **Serveur prod** : node143-eu.n0c.com, port 5022, user eufcarqxft
- **URL prod** : https://maj.stomos.net
- **Firebase project** : tonton-ai-c8196
- **GitHub repo** : https://github.com/Ambinintsoa-h/tonton-maj.git

---

## État actuel — dernière session (2 juin 2026)

### Commits récents (session tracking)
- `9fee628` — fix: préserver firstActivityAt + tracker reconnexions journée
- `6468334` — fix: timezone affichage heures — heure locale du super_admin
- `d85106d` — feat: TeamActivityWidget — filtre période + tableau détaillé par membre
- `ba92f4a` — fix: MemberStatsPanel — z-index header + fallback nom membre
- `fea49d9` — feat: système de tracking activité invisible (manager / cq_ia)
- `90e29cd` — chore: nettoyage — suppression boilerplate CRA + console.log navigateur

### Sessions précédentes
- Système de ticketing complet (Firestore, UI split-panel, notifications ciblées)
- Panneau notifications dans le header (cloche + dropdown)
- Fix SAFE_USERNAME_RE → autorise les points (colonel.sanders)
- Favicon TONTON AI via canvas crop
- Page reset-password branded
- 2FA universelle (manager + CQ IA)
- Tarification Anthropic auto depuis LiteLLM
- 20 correctifs sécurité

### À faire / idées futures
- Configurer Firebase Console : Action URL → `https://maj.stomos.net/reset-password` (flow 100% custom reset MDP)
- Règles Firestore à auditer (apiKey hardcodée dans bundle → sécurité dépend des rules)
- Rate limiter Map() réinitialisé au redémarrage → Redis ou persistance fichier (amélioration future)
- Modales avec `z-50` (< 100) passent SOUS le header → migrer vers `z-[200]` si nécessaire
