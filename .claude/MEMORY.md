# TONTON AI — Mémoire projet (article-updater)

## Index
- [Règles comportementales](#règles-comportementales) — Instructions permanentes de l'utilisateur
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

## Architecture technique

### Stack
- **Frontend** : React 19 + Redux Toolkit + React Router v7 + Framer Motion + Tailwind CSS
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
- **super_admin** : CostWidget global + KPIs équipe + tableau productivité
- **manager** : KPIs équipe + CQ IA performance
- **cq_ia** : Stats personnelles (filtré par assigneeId)

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
│   ├── App.js                        ← Routes + Bootstrap Firebase + Loaders
│   ├── store/
│   │   ├── index.js                  ← Store Redux + persistMiddleware
│   │   └── slices/
│   │       ├── authSlice.js          ← Auth + decodeJwt au refresh
│   │       ├── settingsSlice.js      ← DEFAULT_MODEL_PRICING
│   │       ├── ticketsSlice.js       ← Tickets Redux
│   │       └── notificationsSlice.js ← Notifications Redux
│   ├── services/
│   │   ├── firebase.js               ← Toutes les fonctions Firestore + Storage
│   │   ├── agent.js                  ← runAgent / runReviewAgent (search proxifié)
│   │   └── search.js                 ← searchWeb → /api/brave, /api/tavily, /api/searxng
│   ├── pages/
│   │   ├── Tickets.jsx               ← Ticketing complet (1100+ lignes)
│   │   ├── Dashboard.jsx             ← 3 vues selon rôle
│   │   ├── Equipe.jsx                ← Gestion équipe
│   │   └── ResetPassword.jsx         ← Page reset MDP branded
│   └── components/
│       ├── layout/
│       │   ├── Header.jsx            ← Cloche notifs + profil
│       │   └── Sidebar.jsx           ← Nav + badges
│       ├── account/
│       │   └── MonComptePanel.jsx    ← AccountAvatar (exporté) + profil + 2FA
│       └── notifications/
│           └── NotificationPanel.jsx ← Dropdown notifications
├── data/                             ← Gitignorés (settings.json, 2fa/, profiles/)
│   ├── settings.json                 ← Clés API équipe (Anthropic, Groq, Brave, Tavily, SMTP)
│   ├── firebase-service-account.json ← Service account Firebase Admin
│   ├── 2fa/{username}.json           ← Config 2FA par user (OTP haché HMAC-SHA256)
│   └── profiles/{username}.json      ← Profil local (nom, prénom, email, avatarUrl)
└── public/
    └── tonton.jpg                    ← Avatar TONTON AI (favicon généré via canvas)
```

---

## Identifiants importants (NE PAS committer)
- **Serveur prod** : node143-eu.n0c.com, port 5022, user eufcarqxft
- **URL prod** : https://maj.stomos.net
- **Firebase project** : tonton-ai-c8196
- **GitHub repo** : https://github.com/Ambinintsoa-h/tonton-maj.git

---

## État actuel — dernière session (29 mai 2026)

### Derniers commits
- Système de ticketing complet (Firestore, UI split-panel, notifications ciblées)
- Panneau notifications dans le header (cloche + dropdown)
- Ciblage précis des notifications (assigné uniquement, pas broadcast de rôle)
- Fix SAFE_USERNAME_RE → autorise les points (colonel.sanders)
- Fix Firestore index composite (where+orderBy → tri client-side)
- Favicon TONTON AI via canvas crop (objectPosition 50% 18%)
- Page reset-password branded
- 2FA universelle (manager + CQ IA)
- Tarification Anthropic auto depuis LiteLLM
- 20 correctifs sécurité (path traversal, DNS rebinding, CSP, OTP hash, etc.)

### À faire / idées futures
- Configurer Firebase Console : Action URL → `https://maj.stomos.net/reset-password` (flow 100% custom reset MDP)
- Règles Firestore à auditer (apiKey hardcodée dans bundle → sécurité dépend des rules)
- Rate limiter Map() réinitialisé au redémarrage → Redis ou persistance fichier (amélioration future)
- Index Firestore composite à créer si les requêtes where+orderBy deviennent nécessaires
