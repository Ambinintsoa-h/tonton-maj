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

## Règles prompt critiques
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
