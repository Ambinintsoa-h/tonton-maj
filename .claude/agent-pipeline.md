# Agent IA — Pipeline détaillé

## runAgent (passe 1)

| Étape | Description |
|-------|-------------|
| Phase 0 | `wp_get_post` MCP — récupère postId, featuredMediaId (si site WP connecté) |
| Étape 1 | Haiku extrait 4-7 requêtes Google en anglais avec année courante |
| Étape 2 | `searchWeb` : Brave+Tavily parallèle → scraping ≤5 URLs sans contenu |
| Étape 2b | Haiku filtre les 7 sources les plus pertinentes si > 5 sources |
| Étape 3 | Sonnet génère le JSON `{analysis, updates[], sources[]}` |
| Étape 4 | Haiku vérifie la cohérence de chaque update |
| Final | Suggestions liens internes (WP REST + Claude) si site connecté |

## runReviewAgent (passe 2)

| Étape | Description |
|-------|-------------|
| Étape 1 | Haiku génère 3-6 requêtes COMPLÉMENTAIRES (différentes de la passe 1) |
| Étape 2 | `searchWeb` → scraping ≤5 URLs |
| Étape 3 | Sonnet génère le JSON avec uniquement les updates non couverts en passe 1 |

## Modèles
- `query_extraction` → `claude-haiku-4-5` (rapide, économique)
- `update_generation` → `claude-sonnet-4-5` (principal)
- Vision (ALT text) → `claude-haiku-4-5`

## Contexte date (getDateContext)
Injecté dans TOUS les prompts système :
- `fr` : "10 juin 2026"
- `year` : 2026, `prevYear` : 2025
- `cutoffIso` : date J-6mois — tout contenu antérieur est "suspect"

## Transport des appels Claude (job + polling)
Le proxy n0c coupe les connexions HTTP/2 silencieuses (~30 s sans octet) → l'ancien POST `/api/claude` bloquant (1-5 min d'attente Anthropic) mourait en `ERR_HTTP2_PROTOCOL_ERROR`. `callClaude` (agent.js) passe par `POST /api/claude-job` (réponse immédiate `{jobId}`) puis `GET /api/claude-job/:id` toutes les 2 s. Jobs en mémoire serveur (perdus au restart → 404 → `JOB_LOST` → retry client). `/api/claude` legacy conservé (secours + comments.js). Polls sous limiteur dédié (600/min/IP — toute l'équipe partage l'IP bureau). Timeout Anthropic côté serveur : **10 min** (`600000` dans proxy.js) ; deadline client `JOB_MAX_WAIT_MS` : **12 min** (doit rester > serveur). Une génération Refonte (32k tokens) peut approcher 8-9 min.

## Fragments HTML des updates (anti-imbrication)
`updated` est inséré par **concaténation de chaînes** (applyDiff/applyAddition) : une balise de bloc restée ouverte (Refonte : sections entières, wrapper `<div>` reproduit, HTML tronqué) fuit dans le document → le navigateur imbrique tout ce qui suit → cascade d'indentation. Garde-fou : `balanceFragment` (diff.js) re-sérialise chaque `updated` via un nœud DOM détaché AVANT insertion (après le verrou liens externes) → aucune balise ouverte ne peut fuir. Le prompt Refonte impose en plus : 1 update = 1 bloc, `original` court (~300 c. max, jamais multi-paragraphe), `updated` autonome sans `<div>`/`<section>`.

## Profondeur de MAJ (depth)
`runAgent`/`runReviewAgent` acceptent `depth` : `legere` (~30 % — corrections factuelles seules, PAS de TL;DR/FAQ/nouveaux H2), `standard` (~60 % — défaut, comportement historique, aucun bloc injecté), `refonte` (100 % — réécriture section par section). Constantes : `src/constants/majDepth.js`. Choix utilisateur : page Articles (sélecteur sous le mot-clé) et MAJ en attente (picker par ligne, champ `depth` de l'item). Transmis à la passe 2 via `agent.majDepth` (Redux) et persisté dans `majResult.majDepth` / `articleData.majDepth`.

## Règles prompt critiques
- **Skills classiques (menu SKILLS IA)** injectés dans TOUS les modes — y compris en mode cerveau (bloc « RÈGLES D'ÉQUIPE ») : audit, génération, passe 2 et contrôle de conformité. L'équipe édite ses règles rédactionnelles dans le menu sans ré-importer le SKILL.md.
- **Additions** interdites sans source web scrapée réelle (jamais depuis training data)
- `"original"` = copie EXACTE mot-pour-mot du texte de l'article
- `"updates: []"` inacceptable sauf article < 3 mois
- Fallback si 0 résultat web : utiliser training data avec mention `[à vérifier en {year}]`

## Format JSON attendu
```json
{
  "analysis": "...",
  "updates": [
    { "original": "copie exacte", "updated": "texte actualisé", "reason": "...", "source": "URL" },
    { "type": "addition", "anchor": "phrase exacte après laquelle insérer", "original": "", "updated": "<p>...</p>", "reason": "...", "source": "URL" }
  ],
  "sources": [{ "title": "...", "url": "...", "relevance": "..." }]
}
```

## search.js — stratégie
```
searchWeb(query)
  ├── Promise.allSettled([searchBrave, searchTavily])  ← toujours les deux
  │   ├── Brave  : title + url + description (150 chars), freshness pm→py
  │   └── Tavily : title + url + content (3000 chars), days=365, depth=advanced
  ├── fusion + déduplication par URL
  └── fallback si merged vide : SearXNG → Jina
```

## Coût tokens (fallback hardcodé si settings absent)
| Modèle | Input $/MTok | Output $/MTok |
|--------|-------------|--------------|
| claude-haiku-4-5 | 0.80 | 4.00 |
| claude-sonnet-4-5 | 3.00 | 15.00 |
| claude-opus-4-5 | 15.00 | 75.00 |
