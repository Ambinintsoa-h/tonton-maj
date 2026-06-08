import axios from 'axios';
import { searchWeb } from './search';
import { scrapeUrl } from './scraper';

const LOCAL_PROXY    = '/api/claude';
const WP_TOOL_PROXY  = '/api/wp-tool';

// ── Définitions des outils MCP WordPress ─────────────────────────────────────
export const WP_MCP_TOOLS = [
  {
    name: 'wp_get_post',
    description: 'Lit un article WordPress directement via l\'API REST. Retourne l\'ID du post, le statut, le lien, l\'ID et l\'URL de l\'image à la une (featured_media).',
    input_schema: {
      type: 'object',
      properties: {
        site_id:  { type: 'string',  description: 'ID du site WordPress configuré dans l\'application' },
        post_url: { type: 'string',  description: 'URL complète de l\'article WordPress' },
      },
      required: ['site_id', 'post_url'],
    },
  },
  {
    name: 'wp_upload_media',
    description: 'Télécharge une image depuis une URL et l\'upload dans la médiathèque WordPress. Retourne l\'ID du média (media_id) à utiliser pour changer l\'image à la une.',
    input_schema: {
      type: 'object',
      properties: {
        site_id:   { type: 'string', description: 'ID du site WordPress' },
        image_url: { type: 'string', description: 'URL de l\'image source à uploader' },
        alt_text:  { type: 'string', description: 'Texte alternatif de l\'image' },
      },
      required: ['site_id', 'image_url'],
    },
  },
  {
    name: 'wp_update_post',
    description: 'Met à jour le contenu d\'un article WordPress. Ne modifie jamais le titre, l\'auteur ni les champs SEO.',
    input_schema: {
      type: 'object',
      properties: {
        site_id:           { type: 'string',  description: 'ID du site WordPress' },
        post_id:           { type: 'integer', description: 'ID de l\'article WordPress' },
        content:           { type: 'string',  description: 'Nouveau contenu HTML' },
        featured_media_id: { type: 'integer', description: 'ID de la nouvelle image à la une dans la médiathèque' },
        status:            { type: 'string',  enum: ['publish', 'draft', 'pending'] },
      },
      required: ['site_id', 'post_id'],
    },
  },
];

// ── Appel direct d'un outil WordPress MCP (sans passer par Claude) ────────────
const callWpTool = async (toolName, toolInput, wpSites) => {
  const resp = await axios.post(
    WP_TOOL_PROXY,
    { toolName, toolInput, wpSites },
    { timeout: 25000 }
  );
  if (!resp.data.success) throw new Error(resp.data.error || 'Outil WP échoué');
  return resp.data.result;
};

// ── Catalogue de modèles ──────────────────────────────────────────────────────
const MODELS = {
  FAST: 'claude-haiku-4-5',
  SMART: 'claude-sonnet-4-5',
  BEST: 'claude-opus-4-5',
};

const selectModel = (task) => {
  switch (task) {
    case 'query_extraction': return MODELS.FAST;
    case 'update_generation': return MODELS.SMART;
    default: return MODELS.FAST;
  }
};

// ── Helpers date ──────────────────────────────────────────────────────────────
const getDateContext = () => {
  const now = new Date();
  const iso = now.toISOString().split('T')[0];                          // 2026-05-17
  const fr  = now.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }); // 17 mai 2026
  const year = now.getFullYear();                                        // 2026
  const prevYear = year - 1;                                             // 2025
  const month = now.toLocaleString('en-US', { month: 'long' });         // May
  // Seuil : 6 mois en arrière
  const cutoff = new Date(now);
  cutoff.setMonth(cutoff.getMonth() - 6);
  const cutoffIso = cutoff.toISOString().split('T')[0];                 // 2025-11-17
  return { iso, fr, year, prevYear, month, cutoffIso };
};

// ── Pricing tokens ────────────────────────────────────────────────────────────
// Valeurs de fallback (écrasées par modelPricing depuis settings.json via Redux).
const TOKEN_PRICING_FALLBACK = {
  'claude-haiku-4-5':  { input: 0.80,  output: 4.00  }, // USD/MTok
  'claude-sonnet-4-5': { input: 3.00,  output: 15.00 }, // USD/MTok
  'claude-opus-4-5':   { input: 15.00, output: 75.00 }, // USD/MTok
};
// pricing : objet { 'claude-xxx': { input, output } } — vient du Redux store settings.modelPricing
const calcCost = (calls, pricing = TOKEN_PRICING_FALLBACK) => calls.reduce((t, c) => {
  const table = pricing || TOKEN_PRICING_FALLBACK;
  const p = table[c.model] || table['claude-haiku-4-5'] || TOKEN_PRICING_FALLBACK['claude-haiku-4-5'];
  return t + (c.input / 1_000_000) * p.input + (c.output / 1_000_000) * p.output;
}, 0);

// ── Appel Claude avec compteur de tokens simulé ───────────────────────────────
// Lance callClaude normalement (sans SSE) et met à jour onStep toutes les 700ms
// avec un compteur qui s'incrémente pour donner un retour visuel de progression.
// onStep    : callback pour AJOUTER un nouveau step (premier tick)
// onReplace : callback pour REMPLACER le dernier step (ticks suivants)
// Retourne { text, usage } — même interface que callClaude.
const callClaudeWithProgress = async (apiKey, params, onStep, onReplace, stepLabel) => {
  let fakeTokens = 0;
  let firstTick = true;
  // Incrément aléatoire : ~90-160 tokens/700ms ≈ vitesse Sonnet réelle
  const timer = setInterval(() => {
    fakeTokens += Math.round(90 + Math.random() * 70);
    const text = `${stepLabel} — ~${fakeTokens.toLocaleString()} tokens`;
    if (firstTick) { onStep(text); firstTick = false; }
    else            { onReplace(text); }
  }, 700);

  try {
    const result = await callClaude(apiKey, params);
    clearInterval(timer);
    return result;
  } catch (e) {
    clearInterval(timer);
    throw e;
  }
};

// ── Pré-filtrage des sources par Haiku ────────────────────────────────────────
// Si > 5 sources, demande à Haiku de scorer chacune (0-10) pour n'envoyer
// que les 7 plus pertinentes à Sonnet → contexte plus court, génération plus rapide.
// Silencieux en cas d'erreur (fallback = toutes les sources).
const filterSourcesWithHaiku = async (articleContent, sources, apiKey) => {
  if (sources.length <= 5 || !apiKey) return sources;

  const articlePreview = articleContent
    .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 500);

  const payload = sources.map((s, i) => ({
    i,
    title:   (s.title   || '').substring(0, 80),
    preview: (s.content || '').substring(0, 200),
  }));

  try {
    const { text } = await callClaude(apiKey, {
      model: MODELS.FAST,
      max_tokens: 350,
      system: 'Tu scores des sources web selon leur pertinence pour mettre à jour un article. Réponds UNIQUEMENT avec le JSON demandé.',
      messages: [{
        role: 'user',
        content: `Article (extrait) :\n${articlePreview}\n\nSources à scorer (0-10 selon pertinence) :\n${JSON.stringify(payload)}\n\nRéponds UNIQUEMENT : {"scores":[{"i":0,"score":8},{"i":1,"score":3},...]}`,
      }],
    });

    const { scores = [] } = parseJsonResponse(text, { scores: [] }, '[filter-haiku]');
    const top = scores
      .filter(s => s && typeof s.i === 'number' && sources[s.i])
      .sort((a, b) => (b.score || 0) - (a.score || 0))
      .slice(0, 7)
      .map(s => sources[s.i]);

    return top.length >= 3 ? top : sources; // fallback si trop peu de résultats
  } catch {
    return sources; // jamais bloquer sur une erreur de filtrage
  }
};

// ── Appel Claude ──────────────────────────────────────────────────────────────
const callClaude = async (_apiKey, { system, messages, max_tokens = 2048, model = MODELS.FAST }) => {
  // _apiKey ignoré — le proxy lit la clé depuis data/settings.json côté serveur.
  // La clé n'est plus jamais transmise dans le body HTTP (invisible dans DevTools).
  try {
    const response = await axios.post(
      LOCAL_PROXY,
      { model, max_tokens, system, messages },
      { headers: { 'content-type': 'application/json' }, timeout: 300000 }
    );
    const data = response.data;
    const actualModel = data.modelUsed || data.model || model;
    return {
      text: data.content[0].text,
      usage: {
        input_tokens: data.usage?.input_tokens || 0,
        output_tokens: data.usage?.output_tokens || 0,
        model: actualModel,
      },
    };
  } catch (err) {
    const serverMsg = err.response?.data?.error;
    if (serverMsg) throw new Error(serverMsg);
    if (err.code === 'ECONNREFUSED') throw new Error('Proxy local non joignable — relance npm start');
    throw err;
  }
};

// ── Génération automatique du texte ALT via Claude Vision ────────────────────
/**
 * Génère un texte ALT SEO pour une image à partir de son URL.
 * Utilise Claude vision (Haiku — rapide et économique).
 * Retourne "" en cas d'échec (pas d'interruption de l'UI).
 */
export const generateAltText = async (imageUrl, apiKey) => {
  if (!imageUrl || !apiKey) return '';
  try {
    const { text } = await callClaude(apiKey, {
      system: 'Tu génères uniquement du texte ALT SEO pour des images web. Réponds avec SEULEMENT le texte ALT, sans guillemets, sans ponctuation finale, sans explication. Maximum 125 caractères.',
      model: MODELS.FAST,
      max_tokens: 80,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'url', url: imageUrl } },
          { type: 'text',  text: 'Génère un texte ALT SEO concis et descriptif pour cette image, en français.' },
        ],
      }],
    });
    return text.trim().replace(/^["']|["']$/g, '');
  } catch {
    return '';
  }
};

// ── Vérification de cohérence (Haiku) ────────────────────────────────────────
/**
 * Passe de validation automatique : vérifie que chaque update proposé est cohérent.
 * Critères : original présent dans l'article, remplacement non-dupliqué, pas de contradiction.
 * Retourne les updates enrichis d'un flag `coherent` et d'un champ `coherenceIssue`.
 * Silencieux en cas d'erreur — ne bloque jamais l'affichage des résultats.
 */
const checkCoherence = async (articleHtml, updates, apiKey) => {
  if (!updates?.length || !apiKey) return updates;

  // Texte brut de l'article (2000 chars suffisent pour le contexte)
  const articleText = articleHtml
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 2000);

  // Envoyer uniquement les champs utiles pour économiser les tokens
  const payload = updates.slice(0, 25).map((u, i) => ({
    i,
    original: (u.original || '').substring(0, 180),
    updated:  (u.updated  || '').substring(0, 250),
    reason:   (u.reason   || '').substring(0, 80),
    type:     u.type || 'replacement',
  }));

  const { text } = await callClaude(apiKey, {
    system: `Tu valides des modifications d'article proposées par un agent IA. Pour chaque update :
- "valid": true si la modification semble correcte et cohérente avec l'article
- "valid": false si : le texte "original" ne semble pas issu de l'article, le "updated" introduit un doublon évident, ou la modification est incohérente / contra-factuelle
- "issue": courte raison (max 60 chars) si invalid
Réponds UNIQUEMENT avec le JSON : {"results":[{"i":0,"valid":true},{"i":1,"valid":false,"issue":"raison"},...]}`,
    model: MODELS.FAST,
    max_tokens: 800,
    messages: [{
      role: 'user',
      content: `Article (extrait) :\n${articleText}\n\nModifications à valider :\n${JSON.stringify(payload)}`,
    }],
  });

  const { results = [] } = parseJsonResponse(text, { results: [] }, '[coherence]');
  const byIndex = new Map(results.map(r => [r.i, r]));

  return updates.map((u, i) => {
    const check = byIndex.get(i);
    if (!check) return u;
    return check.valid
      ? { ...u, coherent: true }
      : { ...u, coherent: false, coherenceIssue: check.issue || 'Incohérence détectée' };
  });
};

// ── Helpers partagés ─────────────────────────────────────────────────────────

/** Déduplique un tableau d'objets par la propriété `url`. */
const dedupeByUrl = (items) => {
  const seen = new Set();
  return items.filter(r => {
    if (!r.url || seen.has(r.url)) return false;
    seen.add(r.url); return true;
  });
};

/** Parse une réponse JSON avec fallback ; renvoie `fallback` si tout échoue. */
const parseJsonResponse = (text, fallback = {}, warnLabel = '') => {
  // Stratégie 1 : extraction directe {…}
  try {
    const m = text.match(/\{[\s\S]*\}/);
    return JSON.parse(m ? m[0] : text);
  } catch {}

  // Stratégie 2 : slice entre premier { et dernier }
  try {
    const start = text.indexOf('{');
    const end   = text.lastIndexOf('}');
    if (start !== -1 && end !== -1) return JSON.parse(text.slice(start, end + 1));
  } catch {}

  // Stratégie 3 : réparation du JSON tronqué (max_tokens atteint en plein milieu)
  // Parcourt les positions de } à rebours et tente de fermer le JSON proprement
  // pour récupérer les updates déjà générées avant la coupure.
  try {
    const start = text.indexOf('{');
    if (start !== -1) {
      const partial = text.slice(start);
      for (let i = partial.length - 1; i >= 0; i--) {
        if (partial[i] !== '}') continue;
        for (const suffix of [']}', '], "sources": []}']) {
          try {
            const candidate = partial.slice(0, i + 1) + suffix;
            const parsed = JSON.parse(candidate);
            if (parsed.updates?.length > 0) {
              if (warnLabel) console.warn(warnLabel + ' [réparé]', `${parsed.updates.length} updates récupérés sur réponse tronquée`);
              return parsed; // _parseFailed absent → pas d'alerte UI
            }
          } catch {}
        }
      }
    }
  } catch {}

  if (warnLabel) console.warn(warnLabel, text.substring(0, 300));
  return fallback;
};

/** Crée un accumulateur de tokens avec sa fonction de suivi. */
const makeTokenTracker = () => {
  const acc = { input: 0, output: 0, calls: [] };
  const track = (usage) => {
    if (!usage) return;
    acc.input += usage.input_tokens || 0;
    acc.output += usage.output_tokens || 0;
    acc.calls.push({ model: usage.model, input: usage.input_tokens || 0, output: usage.output_tokens || 0 });
  };
  return { acc, track };
};

/** Construit le bloc Skills pour le system prompt. */
const buildSkillsBlock = (skills, intro = 'Ces instructions définissent TON style, ta méthode et tes contraintes rédactionnelles.\nTu DOIS les respecter intégralement dans TOUTES tes modifications.') => {
  const active = skills.filter(s => s.content);
  if (!active.length) return '';
  return `\n\n## ═══ SKILLS ACTIFS — RÈGLES D'ÉCRITURE OBLIGATOIRES ═══\n${intro}\n\n` +
    active.map((s, i) => {
      const text = s.content?.trimStart().startsWith('<') ? stripHtml(s.content) : (s.content || '');
      return `### SKILL ${i + 1} — ${s.name}\n${text}`;
    }).join('\n\n');
};

/** Construit le bloc Base de connaissances pour le system prompt. */
const buildKnowledgeBlock = (knowledge, intro = '', label = 'CHECKLIST OBLIGATOIRE') => {
  const active = knowledge.filter(k => k.content);
  if (!active.length) return '';
  const defaultIntro = `⚠️ PROTOCOLE STRICT : Tu DOIS lire chacun des ${active.length} documents ci-dessous,\nligne par ligne, et vérifier si l'article le respecte ou en a besoin.\nPour chaque élément applicable : ajoute une entrée dans "updates" avec\nreason = "Base de connaissances n°X — [Nom du document]".`;
  return `\n\n## ═══ BASE DE CONNAISSANCES — ${label} (${active.length} documents) ═══\n${intro || defaultIntro}\n\n` +
    active.map((k, i) => {
      const isHtml = k.isHtml || k.source === 'manual' || k.content?.trimStart().startsWith('<');
      const text = isHtml ? stripHtml(k.content) : (k.content || '');
      const srcLabel = k.source === 'transcript' ? '[Transcription vidéo]'
        : k.source === 'manual' ? '[Saisie manuelle]'
        : '[Fichier importé]';
      return `### DOCUMENT ${i + 1} — ${k.name} ${srcLabel}\n${text}`;
    }).join('\n\n---\n\n');
};

// ── Strip HTML → texte lisible pour le prompt ─────────────────────────────────
const stripHtml = (html = '') =>
  html
    .replace(/<\/?(h[1-6]|p|li|tr|td|th|br|div|blockquote)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();

// ── Scraping rapide d'une source (timeout 12s, max 3000 chars) ────────────────
// Utilise AbortController pour annuler proprement la requête axios si le timeout
// expire — évite les unhandled rejection sur les requêtes abandonnées.
const scrapeSource = async (url) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12000);
  try {
    const result = await scrapeUrl(url, controller.signal);
    // Utiliser textContent (texte brut) pour les sources envoyées à Claude
    const text = result?.textContent || result?.content || '';
    if (result?.success && text.length > 150) {
      return text.substring(0, 3000);
    }
  } catch {
    // AbortError (timeout 12s) ou erreur réseau — ignoré silencieusement
  } finally {
    clearTimeout(timeoutId);
  }
  return null;
};

// ── Prompt système ────────────────────────────────────────────────────────────
const buildSystemPrompt = (skills, knowledge = []) => {
  const { fr, year, prevYear, cutoffIso } = getDateContext();

  const skillsBlock   = buildSkillsBlock(skills);
  const knowledgeBlock = buildKnowledgeBlock(knowledge);

  return `Tu es un expert SEO/GEO (Search Engine Optimization & Generative Engine Optimization) spécialisé dans la mise à jour d'articles de blog, dossiers comparatifs et actualités.

**Date du jour : ${fr} (${cutoffIso} = seuil 6 mois)**
Toute donnée antérieure au ${cutoffIso} est OBLIGATOIREMENT suspecte et doit être vérifiée ou mise à jour.${skillsBlock}${knowledgeBlock}

## ═══ RÈGLES SEO STANDARD ═══

### Règle fondamentale — Ne jamais rendre un tableau vide
Il est statistiquement impossible qu'un article de plus de 6 mois ne contienne AUCUNE information à actualiser.
**Un tableau "updates: []" n'est JAMAIS acceptable** sauf si l'article a moins de 3 mois.

Si les sources web ne couvrent pas un sujet, utilise tes connaissances d'entraînement (jusqu'à début ${prevYear}) :
- Identifier ce qui a PROBABLEMENT changé
- Indiquer [à vérifier en ${year}] dans le champ "reason"

### Ce que tu DOIS systématiquement vérifier
1. **Prix & tarifs** — abonnements, forfaits, prix unitaires
2. **Statistiques & chiffres** — parts de marché, CA, nombre d'utilisateurs
3. **Dates & périodes** — données antérieures à ${cutoffIso}
4. **Versions & produits** — numéros de version, nouvelles fonctionnalités, discontinués
5. **Noms d'entreprises & produits** — rebrandings, acquisitions
6. **Tendances marché** — contexte ${prevYear}-${year}
7. **"récent", "nouveau", "actuel"** — si > 6 mois → obsolète

## ═══ RÈGLES DE FORMATAGE JSON ═══

### Règle n°1 — "original" = copie EXACTE caractère par caractère
Phrase entière ou groupe sémantique complet. Ne jamais paraphraser.

### Règle n°2 — "updated" = substitution directe uniquement
Ne pas ajouter de contexte déjà présent dans l'article autour du segment.

INCORRECT : "original": "se distingue par sa stabilité et sa"
           "updated":  "se distingue par sa stabilité et sa sécurité. La formule débute à 14,99 USD"
→ "sécurité. La formule..." existait déjà après → duplication.

CORRECT :  "original": "La formule d'entrée débute à 12,40 EUR par mois."
           "updated":  "La formule d'entrée débute à 14,99 USD par mois (${prevYear}-${year})."

### Règle n°3 — Cohérence tableau/texte
Si un tableau reprend les mêmes données que le texte, mettre à jour les deux.

## Format de réponse — JSON valide UNIQUEMENT, sans markdown ni texte autour

### Type par défaut : remplacement d'un segment existant
\`\`\`
{ "original": "copie EXACTE mot-pour-mot", "updated": "texte actualisé", "reason": "...", "source": "..." }
\`\`\`

### Type "addition" — Nouveau paragraphe (actualité absente de l'article)
Utilise ce type UNIQUEMENT quand les sources web scrapées révèlent une information VRAIMENT nouvelle sur le sujet, non encore présente dans l'article (ex : annonce récente, nouveau produit, chiffre de marché ${prevYear}-${year}).
- \`"type": "addition"\`
- \`"anchor"\` : copie EXACTE d'une courte phrase de l'article (20-40 mots) identifiant le paragraphe APRÈS lequel insérer
- \`"updated"\` : contenu HTML du nouveau paragraphe (enveloppé dans \`<p>...</p>\`)
- \`"original"\` : laisser vide \`""\`

⚠️ **INTERDIT pour les additions** : ne jamais créer un bloc "actualité récente", "Dernières actualités" ou similaire en te basant sur tes connaissances d'entraînement.
Ton entraînement s'arrête en début ${prevYear} — soit plus de 12 mois avant aujourd'hui (${fr}). Ces informations sont PÉRIMÉES.
**Une addition ne peut exister QUE si une source web scrapée avec URL réelle la confirme.**
Si aucune source web récente disponible → pas d'addition, pas de bloc actualité inventé.

{
  "analysis": "Synthèse : état de l'article + skills appliqués + documents de la base de connaissances consultés + impact SEO",
  "updates": [
    {
      "original": "copie EXACTE mot-pour-mot du segment à remplacer",
      "updated": "texte de remplacement avec données actualisées",
      "reason": "justification — citer le document source si issu de la base de connaissances",
      "source": "URL ou nom de la source ou 'Base de connaissances n°X'"
    },
    {
      "type": "addition",
      "anchor": "courte phrase EXACTE de l'article après laquelle insérer le nouveau paragraphe",
      "original": "",
      "updated": "<p>Nouveau contenu avec actualité récente.</p>",
      "reason": "Nouvelle information absente de l'article : ...",
      "source": "URL de la source"
    }
  ],
  "sources": [
    { "title": "Titre", "url": "https://...", "relevance": "Apport pour les mises à jour" }
  ]
}`;
};

// ── Agent principal ───────────────────────────────────────────────────────────
export const runAgent = async ({
  content,
  skills,
  knowledge      = [],
  articleUrl     = '',
  wpSites        = [],
  existingWpData = null,  // déjà récupéré par Articles.jsx — évite un 2e appel MCP
  modelPricing   = null,  // tarifs depuis settings.json — null = fallback hardcodé
  onStep,
  onReplace,
  onProgress,
}) => {
  const { iso, fr, year, prevYear, month, cutoffIso } = getDateContext();

  onStep('Analyse de l\'article en cours...');
  onProgress(8);

  // ── Accumulateur de tokens ─────────────────────────────────────────────────
  const { acc: tokenAcc, track: trackCall } = makeTokenTracker();

  // ── Phase 0 : Données WordPress MCP ──────────────────────────────────────
  // Si Articles.jsx a déjà récupéré les données WP lors du chargement de l'article,
  // on les réutilise directement — pas de deuxième appel MCP wp_get_post.
  let wpData = existingWpData || null;
  if (!wpData && articleUrl && wpSites?.length) {
    try {
      const articleHostname = new URL(articleUrl).hostname.replace(/^www\./, '');
      const matchingSite = wpSites.find(site => {
        try { return new URL(site.url).hostname.replace(/^www\./, '') === articleHostname; }
        catch { return false; }
      });

      if (matchingSite) {
        onStep('Connexion WordPress MCP — lecture de l\'article...');
        const result = await callWpTool(
          'wp_get_post',
          { site_id: matchingSite.id, post_url: articleUrl },
          [matchingSite]
        );
        if (result?.post_id) {
          wpData = {
            siteId:           matchingSite.id,
            siteName:         matchingSite.name,
            postId:           result.post_id,
            postType:         result.post_type || 'posts',
            featuredMediaId:  result.featured_media_id   || null,
            featuredMediaUrl: result.featured_media_url  || null,
            postLink:         result.link || null,
          };
          const mediaInfo = wpData.featuredMediaId
            ? ` · image à la une ID ${wpData.featuredMediaId}`
            : ' · pas d\'image à la une';
          onStep(`WordPress MCP ✓ — article ID ${wpData.postId}${mediaInfo}`);
        }
      }
    } catch (e) {
      console.warn('[agent] MCP wp_get_post:', e.message);
    }
  }

  // ── Étape 1 : Identifier les requêtes de recherche ────────────────────────────
  let queries = [];
  try {
    const { text: step1Text, usage: u1 } = await callClaude(null, {
      system: `Tu es un assistant expert SEO qui génère des requêtes de recherche Google ciblées pour trouver des informations récentes.`,
      max_tokens: 800,
      model: selectModel('query_extraction'),
      messages: [{
        role: 'user',
        content: `Nous sommes le ${fr}. Génère entre 4 et 7 requêtes de recherche Google en ANGLAIS (autant que nécessaire selon la complexité du sujet) pour trouver les informations les plus récentes (${prevYear}-${year}) permettant de vérifier et mettre à jour les données de cet article.

Chaque requête DOIT :
- Contenir l'année ${prevYear} ou ${year} pour cibler du contenu récent
- Cibler un fait précis : prix, version, statistique, annonce officielle, rapport
- Être orientée vers des SOURCES FIABLES : pages officielles des entreprises, grands médias US (TechCrunch, The Verge, Forbes, Reuters, Bloomberg, Wired, Ars Technica), communiqués de presse, rapports d'analystes

SOURCES CIBLES PRIORITAIRES (inclure dans les requêtes quand pertinent) :
- Newsrooms officiels : "site:newsroom.microsoft.com", "site:blog.google.com", "site:newsroom.zoom.us", etc.
- Médias tech US : techcrunch.com, theverge.com, wired.com, arstechnica.com, venturebeat.com, forbes.com, reuters.com, bloomberg.com
- Pages de tarification officielles : "[produit] pricing site:[domaine officiel]"
- Rapports officiels : "[entreprise] annual report ${year}", "[sujet] market report ${year}"

Types de requêtes à générer :
- "[produit] pricing ${year} official" → page tarifs officielle
- "[produit] price increase ${prevYear} ${year} techcrunch OR reuters OR bloomberg"
- "[logiciel] new features ${month} ${year} OR release notes ${year}"
- "[entreprise] news announcement ${year} OR press release ${year}"
- "[sujet] statistics report ${prevYear} ${year} site:*.com -site:youtube.com -site:reddit.com"
- "[domaine] market share ${year} analyst report"

IMPORTANT : NE PAS générer de requêtes qui mèneraient à YouTube, Reddit, Quora ou réseaux sociaux.
Génère UNIQUEMENT le nombre de requêtes réellement utiles pour ce sujet (pas besoin d'en forcer 7 si 4 suffisent).

Réponds UNIQUEMENT avec un JSON : {"queries": ["...", "..."]}

Article (extrait) :
${content.substring(0, 5000)}`,
      }],
    });
    trackCall(u1);

    queries = (parseJsonResponse(step1Text, {}, '[agent] Query extraction failed:').queries) || [];
  } catch (e) {
    console.warn('[agent] Query extraction failed:', e.message);
  }

  // Fallback : si extraction échoue, construire des queries génériques à partir du titre
  if (queries.length === 0) {
    const firstLine = content.replace(/<[^>]+>/g, '').split('\n').find(l => l.trim().length > 10) || 'article topic';
    queries = [
      `${firstLine.substring(0, 60)} ${year}`,
      `${firstLine.substring(0, 60)} pricing ${year}`,
      `${firstLine.substring(0, 60)} update ${prevYear} ${year}`,
    ];
  }

  onStep(`${queries.length} requête${queries.length > 1 ? 's' : ''} générée${queries.length > 1 ? 's' : ''} — lancement des recherches...`);
  onProgress(20);

  // ── Étape 2 : Recherche web + scraping ───────────────────────────────────────
  const searchResults = [];
  const scrapedSources = [];

  // Brave/Tavily/SearXNG sélectionnés automatiquement côté serveur selon les clés configurées
  onStep(`Recherche web sur ${queries.length} requête${queries.length > 1 ? 's' : ''}...`);
  onProgress(28);

  // Recherche parallèle — limité à 5 requêtes simultanées pour réduire
  // le nombre de connexions réseau en vol et les AbortError de timeout
  const allSearches = await Promise.allSettled(
    queries.slice(0, 5).map(q => searchWeb(q))
  );
  for (const r of allSearches) {
    if (r.status === 'fulfilled') searchResults.push(...r.value);
  }

  // Dédupliquer par URL
  const uniqueResults = dedupeByUrl(searchResults).slice(0, 15);
  searchResults.length = 0;
  searchResults.push(...uniqueResults);

  onStep(`${searchResults.length} résultat${searchResults.length > 1 ? 's' : ''} web trouvé${searchResults.length > 1 ? 's' : ''} — lecture des sources...`);
  onProgress(42);

  // Sources avec contenu déjà présent (Tavily / Jina) — cap explicite à 15, 3000 chars/source
  const resultsWithContent = searchResults.filter(r => r.content && r.content.length > 100).slice(0, 15);
  for (const r of resultsWithContent) {
    scrapedSources.push({ url: r.url, title: r.title, content: r.content.substring(0, 3000) });
  }

  // Scraping des top URLs sans contenu (Brave, SearXNG)
  const urlsToScrape = searchResults
    .filter(r => !r.content || r.content.length < 100)
    .slice(0, 3)   // max 3 pages scrapées pour limiter les connexions en vol
    .map(r => r.url);

  if (urlsToScrape.length > 0) {
    onStep(`Lecture de ${urlsToScrape.length} source${urlsToScrape.length > 1 ? 's' : ''} supplémentaire${urlsToScrape.length > 1 ? 's' : ''}...`);
    const scraped = await Promise.allSettled(urlsToScrape.map(url => scrapeSource(url)));
    for (let i = 0; i < scraped.length; i++) {
      if (scraped[i].status === 'fulfilled' && scraped[i].value) {
        const match = searchResults.find(r => r.url === urlsToScrape[i]);
        scrapedSources.push({
          url: urlsToScrape[i],
          title: match?.title || urlsToScrape[i],
          content: scraped[i].value,
        });
        onStep(`✓ ${match?.title?.substring(0, 55) || urlsToScrape[i]}...`);
      }
    }
  }

  const hasWebData = scrapedSources.length > 0 || searchResults.length > 0;
  if (!hasWebData) {
    onStep('Aucune source web — analyse basée sur les connaissances du modèle...');
  } else {
    onStep(`${scrapedSources.length} source${scrapedSources.length > 1 ? 's' : ''} analysée${scrapedSources.length > 1 ? 's' : ''} sur ${searchResults.length} résultat${searchResults.length > 1 ? 's' : ''} — sélection des meilleures sources...`);
  }

  onProgress(56);

  // ── Pré-filtrage Haiku — garde les 7 sources les plus pertinentes ─────────────
  // Réduit le contexte envoyé à Sonnet → génération plus rapide, même qualité.
  let filteredScraped = scrapedSources;
  if (scrapedSources.length > 5) {
    try {
      filteredScraped = await filterSourcesWithHaiku(content, scrapedSources, null);
    } catch { /* silencieux — on garde toutes les sources */ }
  }
  onProgress(60);

  // ── Étape 3 : Génération des mises à jour (Sonnet streaming) ─────────────────
  const model3 = selectModel('update_generation');
  const modelLabel = model3.includes('sonnet') ? 'Sonnet' : model3.includes('opus') ? 'Opus' : 'Haiku';
  onStep(`Analyse et rédaction des mises à jour (${modelLabel})...`);
  onProgress(65);

  const sourcesSnippets = searchResults.slice(0, 12).map(s =>
    `- [${s.title}](${s.url})${s.age ? ` — ${s.age}` : ''}\n  ${s.description || ''}`
  ).join('\n');

  const scrapedContext = filteredScraped.map(s =>
    `### ${s.title}\nURL : ${s.url}\n${s.content}`
  ).join('\n\n---\n\n');

  // Message utilisateur pour l'étape 3
  const noSourcesNote = !hasWebData
    ? `\n## NOTE IMPORTANTE\nLes recherches web n'ont pas retourné de résultats pour cet article. Tu DOIS quand même proposer des mises à jour en utilisant tes connaissances d'entraînement. Tout prix, version, statistique ou fait daté dans l'article doit être signalé comme potentiellement obsolète en ${year}, avec la mention [à vérifier en ${year}] dans le champ "reason".\n`
    : '';

  // Résumé de la base de connaissances pour rappel dans le user message
  const activeKnowlCount = knowledge.filter(k => k.content).length;
  const knowlReminder = activeKnowlCount > 0
    ? `\n## RAPPEL — BASE DE CONNAISSANCES (${activeKnowlCount} documents dans le system prompt)\n` +
      `Tu as ${activeKnowlCount} document(s) dans ta base de connaissances. ` +
      `AVANT d'analyser les sources web, parcours-les un par un et vérifie si chacun s'applique à cet article.\n` +
      knowledge.filter(k => k.content).map((k, i) =>
        `- Document ${i + 1} : ${k.name}`
      ).join('\n') + '\n'
    : '';

  const skillsCount = skills.filter(s => s.content).length;
  const skillsReminder = skillsCount > 0
    ? `\n## RAPPEL — SKILLS ACTIFS (${skillsCount} dans le system prompt)\n` +
      `Tes ${skillsCount} skill(s) définissent tes règles d'écriture. Chaque modification doit les respecter.\n`
    : '';

  const userMessage = `Nous sommes le ${fr} (${iso}).
${skillsReminder}${knowlReminder}
## ÉTAPES DE TRAVAIL OBLIGATOIRES

**ÉTAPE 1 — Relire les Skills et la base de connaissances**
Avant toute analyse, relis chaque document du system prompt (Skills + Base de connaissances) et mémorise leurs exigences.

**ÉTAPE 2 — Appliquer la base de connaissances ligne par ligne**
Pour chaque document de la base de connaissances, vérifie si l'article respecte son process ou si une correction est nécessaire. Si oui → ajoute un "update" avec source = "Base de connaissances n°X".

**ÉTAPE 3 — Analyser les sources web**
Compare chaque prix, chiffre, version et date de l'article avec les sources ci-dessous.
${noSourcesNote}
**ÉTAPE 4 — Produire le JSON**
Retourne le JSON final avec TOUTES les modifications identifiées (issues de la base de connaissances ET des sources web).

---
${scrapedContext ? `## CONTENU DES SOURCES RÉCENTES (${prevYear}-${year})\n${scrapedContext}\n\n---\n\n` : ''}${sourcesSnippets ? `## RÉSULTATS DE RECHERCHE WEB\n${sourcesSnippets}\n\n---\n\n` : ''}## ARTICLE À ANALYSER
${content}

## Règles finales
- Tout ce qui date d'avant ${cutoffIso || prevYear} est OBLIGATOIREMENT suspect
- "original" = copie EXACTE mot-pour-mot du texte de l'article
- Réponds UNIQUEMENT avec le JSON valide, sans markdown ni texte autour`;

  // Génération avec compteur de tokens simulé (feedback visuel temps réel)
  const { text: finalText, usage: u3 } = await callClaudeWithProgress(
    null,
    { system: buildSystemPrompt(skills, knowledge), max_tokens: 32000, model: model3, messages: [{ role: 'user', content: userMessage }] },
    onStep,
    onReplace,
    `Génération en cours (${modelLabel})`
  );
  trackCall(u3);

  onStep('Finalisation des résultats...');
  onProgress(88);

  // ── Parse JSON ───────────────────────────────────────────────────────────────
  const result = parseJsonResponse(
    finalText,
    { analysis: '', updates: [], sources: [], _parseFailed: true },
    '[agent] JSON parse failed — réponse brute:'
  );

  // ── Étape 4 : Vérification de cohérence ──────────────────────────────────────
  if ((result.updates || []).length > 0) {
    onStep('Vérification de cohérence des modifications...');
    onProgress(93);
    try {
      result.updates = await checkCoherence(content, result.updates, null);
    } catch (e) {
      console.warn('[coherence] Échec de la vérification :', e.message);
    }
  }

  onProgress(100);
  onStep('Analyse terminée !');

  // Fusionner et dédupliquer les sources
  const allSources = [
    ...(result.sources || []),
    ...scrapedSources.map(s => ({ title: s.title, url: s.url, relevance: 'Contenu extrait' })),
    ...searchResults.slice(0, 8).map(s => ({ title: s.title, url: s.url, relevance: s.description || '' })),
  ];

  // ── Phase finale : suggestions liens internes ──────────────────────────────
  // Nécessite un site WP connecté pour récupérer les articles du site
  let internalLinks = [];
  if (wpData?.siteId && wpSites?.length) {
    try {
      onStep('Recherche de liens internes...');
      onProgress(88);

      // 1. Extraire 3 mots-clés principaux depuis le titre / premier paragraphe
      const articleText = stripHtml(content).substring(0, 800);
      const { text: kwText } = await callClaude(null, {
        model: selectModel('query_extraction'),
        max_tokens: 80,
        system: 'Tu extrais des mots-clés. Réponds UNIQUEMENT avec un JSON : {"keywords":["mot1","mot2","mot3"]}',
        messages: [{ role: 'user', content: `Extrais 3 mots-clés principaux (en français) de ce texte :\n${articleText}` }],
      });
      trackCall('kw_extraction', kwText);
      const { keywords = [] } = parseJsonResponse(kwText, { keywords: [] }, '[internal-links-kw]');

      if (keywords.length) {
        // 2. Chercher des articles liés via l'API WordPress
        const resp = await axios.post('/api/wp-related-posts', {
          siteId:     wpData.siteId,
          wpSites,
          queries:    keywords.slice(0, 3),
          excludeUrl: articleUrl,
        });
        const relatedPosts = resp.data?.posts || [];

        if (relatedPosts.length >= 2) {
          // 3. Demander à Claude de suggérer 2-4 liens internes
          const postsList = relatedPosts.map((p, i) => `${i + 1}. "${p.title}" — ${p.url}`).join('\n');
          const articlePreviewText = stripHtml(content).substring(0, 2000);

          const { text: linksText } = await callClaude(null, {
            model:      selectModel('query_extraction'),
            max_tokens: 600,
            system:     `Tu es un expert SEO. Tu suggères des liens internes pertinents pour un article. Réponds UNIQUEMENT avec un JSON valide.`,
            messages: [{
              role: 'user',
              content: `Article à enrichir (extrait) :
${articlePreviewText}

Articles disponibles sur le même site :
${postsList}

Suggère 2 à 4 liens internes pertinents. Pour chaque lien :
- "anchor" : une expression EXACTE présente dans l'article (2-5 mots, riche en mots-clés)
- "url" : l'URL de l'article lié
- "title" : le titre de l'article lié
- "reason" : pourquoi ce lien est pertinent (1 phrase)

Réponds UNIQUEMENT : {"links":[{"anchor":"...","url":"...","title":"...","reason":"..."}]}`,
            }],
          });
          trackCall('internal_links', linksText);
          const { links = [] } = parseJsonResponse(linksText, { links: [] }, '[internal-links]');
          internalLinks = links.filter(l => l.anchor && l.url && l.title).slice(0, 4);
        }
      }
    } catch (e) {
      // Liens internes non bloquants — on continue sans
      console.warn('[internal-links] erreur:', e.message);
    }
  }

  const costUsd = calcCost(tokenAcc.calls, modelPricing);
  return {
    ...result,
    sources: dedupeByUrl(allSources).slice(0, 12),
    tokenUsage: { ...tokenAcc, costUsd },
    parseFailed: result._parseFailed === true,
    // Données WordPress MCP (null si l'URL ne correspond à aucun site configuré)
    wpData,
    internalLinks,
  };
};

// ── Prompt système — Deuxième passe ──────────────────────────────────────────
const buildReviewSystemPrompt = (skills, knowledge = []) => {
  const { fr, year, prevYear } = getDateContext();

  const skillsBlock = buildSkillsBlock(
    skills,
    'Vérifie que l\'article (après passe 1) respecte chacune de ces instructions.'
  );
  const active = knowledge.filter(k => k.content);
  const knowledgeBlock = buildKnowledgeBlock(
    knowledge,
    active.length > 0
      ? `⚠️ PROTOCOLE PASSE 2 : La passe 1 a peut-être manqué certains documents.\nRelis chacun des ${active.length} documents ci-dessous et vérifie s'il a bien été appliqué.\nSi non → ajoute l'entrée manquante avec reason = "Base de connaissances n°X — [Nom] (non traité en passe 1)".`
      : '',
    'CHECKLIST PASSE 2'
  );

  return `Tu es un expert SEO/GEO effectuant la DEUXIÈME PASSE d'enrichissement d'un article déjà partiellement mis à jour.

**Date : ${fr}**${skillsBlock}${knowledgeBlock}

## ═══ OBJECTIFS DE LA DEUXIÈME PASSE ═══

1. **Vérification Skills ligne par ligne** — chaque rule de chaque skill doit être respectée
2. **Vérification Base de connaissances ligne par ligne** — chaque document doit avoir été appliqué
3. **Complétude SEO** — repérer ce que la passe 1 n'a pas couvert (prix, tendances, contexte)
4. **Zéro doublon** — ne re-proposer AUCUNE modification déjà faite en passe 1

## Règles de formatage
- "original" = copie EXACTE du texte ACTUEL (après passe 1)
- "updated" = substitution directe
- Mieux vaut [à vérifier en ${year}] que rien
- "updates: []" acceptable SEULEMENT si tout est parfait et à jour

## Format — JSON valide UNIQUEMENT

### Type par défaut : remplacement
\`\`\`
{ "original": "copie EXACTE", "updated": "texte actualisé", "reason": "...", "source": "..." }
\`\`\`

### Type "addition" — Nouveau paragraphe (actualité absente de l'article)
Utilise ce type quand les sources web scrapées révèlent une information vraiment nouvelle, non présente dans l'article.
- \`"type": "addition"\`, \`"anchor"\` : phrase EXACTE de l'article indiquant où insérer, \`"updated"\` : HTML \`<p>...</p>\`, \`"original"\` : \`""\`

⚠️ **INTERDIT** : ne jamais créer une addition basée sur tes connaissances d'entraînement (qui s'arrêtent en début ${prevYear}, soit 12+ mois de retard). Source web réelle obligatoire.

{
  "analysis": "Ce que la passe 2 a ajouté : skills vérifiés, documents base de connaissances appliqués, compléments SEO",
  "updates": [
    {
      "original": "copie EXACTE du texte actuel",
      "updated": "texte de remplacement",
      "reason": "justification — citer le document si issu de la base de connaissances",
      "source": "URL ou 'Base de connaissances n°X'"
    }
  ],
  "sources": [{ "title": "...", "url": "...", "relevance": "..." }]
}`;
};

// ── Agent de relecture / deuxième passe ───────────────────────────────────────
export const runReviewAgent = async ({
  content,
  firstPassUpdates = [],
  firstPassAnalysis = '',
  skills,
  knowledge = [],
  manualSources = [],   // sources fournies manuellement par le CQ IA (déjà scrapées)
  modelPricing  = null, // tarifs depuis settings.json — null = fallback hardcodé
  onStep,
  onProgress,
}) => {
  const { fr, year, prevYear } = getDateContext();

  onStep('Deuxième passe — analyse de complétude...');
  onProgress(5);

  // ── Accumulateur de tokens ─────────────────────────────────────────────────
  const { acc: tokenAcc, track: trackCall } = makeTokenTracker();

  // Résumé passe 1 pour éviter les doublons
  const alreadyDone = firstPassUpdates
    .filter(u => u.applied !== false)
    .slice(0, 12)
    .map(u => `- "${u.original?.substring(0, 60)}..." → "${u.updated?.substring(0, 60)}..."`)
    .join('\n') || 'Aucune modification appliquée en passe 1.';

  // ── Étape 1 : Requêtes complémentaires ──────────────────────────────────────
  let queries = [];
  try {
    const { text: step1Text, usage: u1 } = await callClaude(null, {
      system: `Tu es un expert SEO générant des requêtes de recherche complémentaires pour enrichir un article déjà partiellement mis à jour.`,
      max_tokens: 600,
      model: selectModel('query_extraction'),
      messages: [{
        role: 'user',
        content: `Nous sommes le ${fr}. Une première passe a déjà mis à jour cet article.

Première passe — ce qui a été modifié :
${alreadyDone}

Génère entre 3 et 6 requêtes Google en ANGLAIS pour trouver des informations COMPLÉMENTAIRES non couvertes.
Cible des aspects différents : autres produits cités, tendances marché ${prevYear}-${year}, données manquantes.
Génère uniquement les requêtes réellement utiles (pas besoin de forcer 6 si 3 suffisent).

Réponds UNIQUEMENT : {"queries": ["...", "..."]}

Article (extrait) :
${content.substring(0, 3000)}`,
      }],
    });
    trackCall(u1);
    queries = (parseJsonResponse(step1Text, {}, '[review] Query extraction failed:').queries) || [];
  } catch (e) {
    console.warn('[review] Query extraction failed:', e.message);
  }

  onStep(`${queries.length} requête${queries.length > 1 ? 's' : ''} complémentaire${queries.length > 1 ? 's' : ''} — recherches en cours...`);
  onProgress(18);

  // ── Étape 2 : Recherche web ──────────────────────────────────────────────────
  const searchResults = [];
  const scrapedSources = [];

  if (queries.length > 0) {
    const allSearches = await Promise.allSettled(
      queries.map(q => searchWeb(q))
    );
    for (const r of allSearches) {
      if (r.status === 'fulfilled') searchResults.push(...r.value);
    }
    const unique = dedupeByUrl(searchResults).slice(0, 10);
    searchResults.length = 0;
    searchResults.push(...unique);

    onStep(`${searchResults.length} résultat${searchResults.length > 1 ? 's' : ''} complémentaire${searchResults.length > 1 ? 's' : ''} trouvé${searchResults.length > 1 ? 's' : ''}...`);

    const withContent = searchResults.filter(r => r.content && r.content.length > 100);
    for (const r of withContent) {
      scrapedSources.push({ url: r.url, title: r.title, content: r.content.substring(0, 3000) });
    }

    const toScrape = searchResults
      .filter(r => !r.content || r.content.length < 100)
      .slice(0, 3).map(r => r.url);

    if (toScrape.length > 0) {
      onStep(`Lecture de ${toScrape.length} source${toScrape.length > 1 ? 's' : ''} complémentaire${toScrape.length > 1 ? 's' : ''}...`);
      const scraped = await Promise.allSettled(toScrape.map(url => scrapeSource(url)));
      for (let i = 0; i < scraped.length; i++) {
        if (scraped[i].status === 'fulfilled' && scraped[i].value) {
          const match = searchResults.find(r => r.url === toScrape[i]);
          scrapedSources.push({
            url: toScrape[i],
            title: match?.title || toScrape[i],
            content: scraped[i].value,
          });
        }
      }
    }
  }

  onProgress(48);

  // ── Étape 3 : Génération de l'enrichissement ─────────────────────────────────
  const model3 = selectModel('update_generation');
  const modelLabel = model3.includes('sonnet') ? 'Sonnet' : model3.includes('opus') ? 'Opus' : 'Haiku';
  onStep(`Enrichissement et vérification Skills/Knowledge (${modelLabel})...`);
  onProgress(58);

  const scrapedContext = scrapedSources
    .map(s => `### ${s.title}\nURL : ${s.url}\n${s.content}`)
    .join('\n\n---\n\n');
  const snippetsCtx = searchResults.slice(0, 8)
    .map(s => `- [${s.title}](${s.url})\n  ${s.description || ''}`)
    .join('\n');
  const manualCtx = manualSources.filter(s => s.content).length > 0
    ? `## ⭐ SOURCES FOURNIES PAR LE CQ IA — À INTÉGRER EN PRIORITÉ\n${
        manualSources
          .filter(s => s.content)
          .map(s => `### ${s.title || s.url}\nURL : ${s.url}\n\n${s.content.substring(0, 4000)}`)
          .join('\n\n---\n\n')
      }\n\n`
    : '';

  const userMsg = `Nous sommes le ${fr} — DEUXIÈME PASSE d'enrichissement.

## Ce qui a déjà été modifié en passe 1 (ne pas re-proposer)
${alreadyDone}

${manualCtx}${scrapedContext ? `## NOUVELLES SOURCES COMPLÉMENTAIRES\n${scrapedContext}\n\n---\n\n` : ''}${snippetsCtx ? `## RÉSULTATS DE RECHERCHE\n${snippetsCtx}\n\n---\n\n` : ''}## ARTICLE APRÈS PASSE 1
${content}

## Instructions
- NE PAS re-proposer ce qui a déjà été changé en passe 1${manualSources.filter(s => s.content).length > 0 ? '\n- Intégrer EN PRIORITÉ les informations des sources fournies par le CQ IA (section ⭐ ci-dessus)' : ''}
- Vérifier que chaque instruction des Skills est bien appliquée dans l'article
- Intégrer les données de la base de connaissances absentes ou mal représentées
- Identifier ce que la passe 1 n'a pas couvert (autres produits, tendances, contexte)
- Si une donnée semble ancienne : la signaler même sans source confirmée [à vérifier en ${year}]
- "original" = copie EXACTE du texte ACTUEL de l'article (tel qu'il est après passe 1)
- Réponds UNIQUEMENT avec le JSON valide, sans markdown`;

  const { text: finalText, usage: u3 } = await callClaude(null, {
    system: buildReviewSystemPrompt(skills, knowledge),
    max_tokens: 24000,
    model: model3,
    messages: [{ role: 'user', content: userMsg }],
  });
  trackCall(u3);

  onStep('Finalisation de la deuxième passe...');
  onProgress(90);

  const result = parseJsonResponse(
    finalText,
    { analysis: '', updates: [], sources: [] },
    '[review] JSON parse failed:'
  );

  onProgress(100);
  onStep('Deuxième passe terminée !');

  const allSources = [
    ...manualSources.map(s => ({ title: s.title || s.url, url: s.url, relevance: '⭐ Source CQ IA' })),
    ...(result.sources || []),
    ...scrapedSources.map(s => ({ title: s.title, url: s.url, relevance: 'Passe 2' })),
    ...searchResults.slice(0, 5).map(s => ({ title: s.title, url: s.url, relevance: s.description || '' })),
  ];

  const costUsd = calcCost(tokenAcc.calls, modelPricing);
  return { ...result, sources: dedupeByUrl(allSources).slice(0, 10), tokenUsage: { ...tokenAcc, costUsd } };
};
