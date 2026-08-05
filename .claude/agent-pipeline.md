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

## Mode « Audit QAT + Refonte » (double flux, août 2026)

Second flux **sélectionnable au lancement** (`src/constants/majMode.js`). Le flux
historique décrit ci-dessus reste **intact et par défaut** : rien ne change tant
que l'utilisateur ne choisit pas `qat`. Décision équipe : double flux temporaire,
le temps que l'équipe valide le nouveau sur de vrais articles.

| Étape | Description |
|-------|-------------|
| Phase 0 | `wp_get_post` MCP (identique au flux historique) |
| Fraîcheur | Haiku génère **2 requêtes max**, `searchWeb` + scraping ≤3 URLs |
| Étape A | Sonnet produit l'**audit JSON** (framework QAT) — `scores`, `ampleur`, `keyword_repositioning`, `a_supprimer`, `priority_actions` P1/P2/P3, `pre_pub_checklist`, `freshness_checks`, `sources_check`, `recent_context`, EEAT, gaps. 3 essais si JSON illisible |
| Étape B | Sonnet réécrit l'**article entier** (32k tokens) : `titre_seo`, `meta_description`, `h1`, `chapo_html`, `article_html`, `ancres_placees` |
| Sécurité | `sanitizeFullArticle` (diff.js) — verrou liens externes + `balanceFragment` + `moveFaqToEnd` à l'échelle de l'article. Un lien externe d'origine introuvable ⇒ **génération rejetée**, 3 essais, puis erreur |

- **Ampleur** : `resolveQatDepth` — trois valeurs. `refonte_totale` (le fond est
  en cause), `restructuration` (le fond tient, seul le plan est refait : paragraphes
  conservés, H2 fusionnés en 6 à 8 sections, réordonnés), `maj_ciblee` (tout tient).
  `auto` (défaut) laisse l'audit décider ; un choix explicite du rédacteur PRIME et
  lève `overridden`. Le sélecteur n'expose que Ciblée et Refonte : la
  restructuration reste une décision de l'audit, via « Auto ».
  choix explicite du rédacteur PRIME et lève `overridden` (affiché dans l'UI).
- **Champs de lancement** : type d'article (Dossier/Actus), plugin SEO, longueur
  cible (**2 500 mots** par défaut — médiane réelle de l'équipe, contre 1 500 dans
  le prompt d'origine), paires ancre + URL (3 lignes, jusqu'à 15).
- **Le chapô est replacé en tête du corps** avant le contrôle : WordPress attend
  un corps unique, et il doit passer par le verrou comme le reste.
- **Titre SEO, méta-description et H1** sont repris du skill (pas de second appel
  `generateSeoMeta`), et le H1 est marqué `titleDirty` pour partir réellement à WP.
- Le mode exige un **skill cerveau actif** (SKILL.md) : bouton bloqué sinon.
- Onglet AUDIT : `QatAuditPanel.jsx` rend le JSON (ampleur en tête). Le rapport
  markdown historique reste affiché quand `auditJson` est absent.
- Pas d'`updates[]` en mode QAT : la validation modif par modif n'existe pas, la
  comparaison se fait entre les onglets « Avant » et « Après — article réécrit ».
- **Non couvert** : le lancement depuis `/maj-en-attente` reste en mode classique.

## Retour en direct pendant les appels longs (mode QAT)

Une refonte dure 8-9 min : sans retour visible, le rédacteur croit l'application
bloquée. Le mode QAT passe donc par `callClaudeStream` (agent.js) →
**`POST /api/claude-stream`** (SSE, proxy.js) au lieu du transport job + polling.

- Le serveur envoie `{type:'delta', chars, text}` tous les ~120 caractères (le
  champ `text` a été **ajouté** : la route n'envoyait que le compteur, donc le
  client ne pouvait rien afficher du contenu avant `done`), puis
  `{type:'done', text, usage}`.
- `callWithLiveText` (agentQat.js) affiche le nom de la phase, les **caractères
  réels** et le temps écoulé, et fait avancer la barre de progression au prorata.
- **Repli** : `STREAM_UNAVAILABLE` (route absente, 502/504, flux vide car
  bufferisé) → bascule automatique sur `callClaudeWithProgress`, dont le compteur
  de tokens est SIMULÉ — d'où l'étiquette « (estimation) » à l'écran.
- `AgentThinking` affiche `LiveTyping` : queue du texte (600 derniers caractères
  conservés dans Redux, `liveTail`/`liveChars`) avec un curseur clignotant.
- Bénéfice annexe : un flux SSE n'est jamais muet, donc il échappe à la coupure
  n0c à ~30 s qui avait imposé le transport job + polling.
- ⚠️ `proxy.js` est modifié → un déploiement du serveur est nécessaire, sinon le
  client tombera systématiquement dans le repli (compteur estimé, pas de texte).
