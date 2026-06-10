# Architecture technique

## Stack
- **Frontend** : React 19 · Redux Toolkit · React Router v7 · Framer Motion · Tailwind CSS · Recharts
- **Backend** : Express proxy (`proxy.js`, ~2600 lignes) — Node.js, JWT, Firebase Admin SDK v13
- **DB** : Firebase Firestore + Firebase Storage (client v12)
- **Auth** : JWT interne + Firebase Auth + admin local (super_admin)
- **Email** : Nodemailer (SMTP)
- **IA** : Claude API Anthropic · Groq Whisper · Brave/Tavily/SearXNG/Jina (proxifiés)

## Variables d'env (.env — gitignorées)
`JWT_SECRET`, `ADMIN_PASSWORD`, `ADMIN_USERNAME`, `PORT`, `NODE_ENV=production`
⚠️ Clés API (Anthropic, Groq, Brave, Tavily, Haloscan) → `data/settings.json` uniquement, jamais dans .env ni Firestore.

## Arborescence clés
```
article-updater/
├── proxy.js                          ← Backend Express (auth, IA, WP, search, tickets)
├── src/
│   ├── App.js                        ← Routes + ActivityTrackerInit
│   ├── store/slices/
│   │   ├── authSlice.js              ← uid, username, role, prenom, nom
│   │   ├── agentSlice.js             ← updatedContent, diff, sources, internalLinks, wpData
│   │   ├── settingsSlice.js          ← DEFAULT_MODEL_PRICING
│   │   ├── ticketsSlice.js           ← list, loading, removeTicket
│   │   └── notificationsSlice.js
│   ├── services/
│   │   ├── agent.js                  ← runAgent / runReviewAgent (pipeline IA complet)
│   │   ├── search.js                 ← searchWeb → Brave+Tavily en parallèle → SearXNG → Jina
│   │   ├── firebase.js               ← Toutes fonctions Firestore/Storage
│   │   ├── activityTracker.js        ← Singleton tracking invisible
│   │   ├── scraper.js                ← /api/scrape + /api/jina
│   │   └── wordpress.js              ← REST API WP via /api/wp-tool
│   ├── utils/
│   │   └── diff.js                   ← applyAllDiffs + moveFaqToEnd (déplace FAQ en fin d'article)
│   ├── pages/
│   │   ├── Articles.jsx              ← Passe 1 MAJ
│   │   ├── MajEnAttente.jsx          ← File partagée (Passe 1)
│   │   ├── Tickets.jsx               ← Kanban + liste + drawer
│   │   ├── Dashboard.jsx             ← Stats équipe (super_admin)
│   │   ├── Equipe.jsx                ← clic membre → MemberStatsPanel
│   │   └── Parametres.jsx            ← Clés API, modèles, Firebase config
│   └── components/
│       ├── layout/Header.jsx         ← ⚠️ zIndex: 100 inline — overlays = z-[200] min
│       ├── agent/ArticleResult.jsx   ← Passe 2, éditeur diff, publication WP
│       ├── agent/BubbleToolbar.jsx   ← Mise en forme + insertion YouTube
│       ├── account/MonComptePanel.jsx← AccountAvatar (exporté partout)
│       └── stats/MemberStatsPanel.jsx← Panel stats (z-[200])
├── data/                             ← Gitignorés
│   ├── settings.json                 ← Clés API + config
│   ├── firebase-service-account.json
│   ├── 2fa/{username}.json
│   └── profiles/{username}.json
└── public/tonton.jpg
```

## Points d'attention UI
- `Header.jsx` : `zIndex: 100` inline → tout overlay doit être `z-[200]` minimum
- Portals React pour les panels slide (`z-[200]` / `z-[201]`)
- `moveFaqToEnd` appliqué automatiquement après chaque passe de génération (Articles.jsx, ArticleResult.jsx, MajEnAttente.jsx)

## Routes proxy.js (principales)
| Route | Description |
|-------|-------------|
| `POST /api/claude` | Appel IA principal |
| `POST /api/claude-stream` | Streaming SSE |
| `POST /api/claude-tools` | Boucle agentique WP MCP |
| `GET /api/brave` | Brave Search |
| `POST /api/tavily` | Tavily Search |
| `POST /api/scrape` | Scraping Readability |
| `POST /api/wp-tool` | Outils WP directs |
| `POST /api/wordpress` | REST WP générique |
| `GET/POST /api/settings` | Paramètres (super_admin write) |
