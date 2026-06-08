# Architecture technique

## Stack
- **Frontend** : React 19 · Redux Toolkit · React Router v7 · Framer Motion · Tailwind CSS · Recharts
- **Backend** : Express proxy (`proxy.js`) — Node.js, JWT, Firebase Admin SDK v13
- **DB** : Firebase Firestore + Firebase Storage (client v12)
- **Auth** : JWT interne + Firebase Auth (manager/cq_ia) + admin local (super_admin)
- **Email** : Nodemailer (SMTP)
- **IA** : Claude API Anthropic · Groq Whisper · Brave/Tavily/SearXNG/Jina (proxifiés)

## Variables d'env (.env — gitignorées)
`JWT_SECRET`, `ADMIN_PASSWORD` (crashe si valeurs par défaut), `ADMIN_USERNAME`, `PORT`, `NODE_ENV=production`

## Fichiers clés
```
article-updater/
├── proxy.js                          ← Backend Express (2000+ lignes)
├── src/
│   ├── App.js                        ← Routes + ActivityTrackerInit
│   ├── store/slices/
│   │   ├── authSlice.js              ← uid, username, role, prenom, nom
│   │   ├── agentSlice.js             ← updatedContent, diff, sources, internalLinks, wpData
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
│   │   ├── MajEnAttente.jsx          ← Panels slide droite (AddManualPanel, ImportPanel)
│   │   ├── Dashboard.jsx             ← TeamActivityWidget (super_admin)
│   │   ├── Equipe.jsx                ← clic membre → MemberStatsPanel
│   │   └── ResetPassword.jsx
│   └── components/
│       ├── layout/Header.jsx         ← ⚠️ zIndex: 100 (inline) — overlays = z-[200] min
│       ├── agent/ArticleResult.jsx   ← Éditeur diff, liens internes, publication WP
│       ├── agent/BubbleToolbar.jsx   ← Barre mise en forme + insertion vidéo YouTube
│       ├── account/MonComptePanel.jsx ← AccountAvatar (exporté partout)
│       └── stats/MemberStatsPanel.jsx ← Slide panel stats (z-[200])
├── data/                             ← Gitignorés
│   ├── settings.json                 ← Clés API (Anthropic, Groq, Brave, Tavily, SMTP)
│   ├── firebase-service-account.json
│   ├── 2fa/{username}.json
│   └── profiles/{username}.json
└── public/tonton.jpg
```

## Points d'attention UI
- `Header.jsx` : `zIndex: 100` inline → tout overlay doit être `z-[200]` minimum
- Portals React pour les panels slide (z-[200]/z-[201])
