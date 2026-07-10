import axios from 'axios';
import { searchWeb } from './search';
import { scrapeUrl } from './scraper';

const LOCAL_PROXY    = '/api/claude';
const WP_TOOL_PROXY  = '/api/wp-tool';

// Une entrée Skill/BDC est active sauf si explicitement désactivée dans le menu
// SKILLS IA (champ `active: false`). Rétro-compat : champ absent = active.
const isActiveEntry = (e) => e?.active !== false;

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
  // Guards : le flux MajEnAttente ne fournit pas onReplace → sans garde, chaque
  // tick levait « TypeError: onReplace is not a function » (spam console).
  const timer = setInterval(() => {
    fakeTokens += Math.round(90 + Math.random() * 70);
    const text = `${stepLabel} — ~${fakeTokens.toLocaleString()} tokens`;
    if (firstTick) { if (typeof onStep === 'function') onStep(text); firstTick = false; }
    else if (typeof onReplace === 'function') { onReplace(text); }
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
// Une erreur est REJOUABLE si la réponse n'est jamais arrivée (coupure de
// connexion : redémarrage du serveur pendant un déploiement, reset HTTP/2,
// réseau) ou si la passerelle a répondu 502/503/504 (Passenger en cours de
// restart). Le timeout client (ECONNABORTED, 5 min) et les erreurs applicatives
// (4xx/5xx avec message serveur) ne sont PAS retentés.
const isRetryableClaudeError = (err) => {
  if (err.code === 'ECONNABORTED') return false;         // timeout client
  if (!err.response) return true;                        // coupure réseau pure
  return [502, 503, 504].includes(err.response.status);  // passerelle en restart
};

const sleepMs = (ms) => new Promise(r => setTimeout(r, ms));
const CLAUDE_RETRY_DELAYS_MS = [2000, 5000]; // 2 relances max, backoff court

const callClaude = async (_apiKey, { system, messages, max_tokens = 2048, model = MODELS.FAST }) => {
  // _apiKey ignoré — le proxy lit la clé depuis data/settings.json côté serveur.
  // La clé n'est plus jamais transmise dans le body HTTP (invisible dans DevTools).
  for (let attempt = 0; ; attempt++) {
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
      // Relance automatique sur coupure de connexion (ex. redéploiement du
      // serveur pendant une analyse) → le pipeline survit au lieu de mettre
      // l'article en « Erreur ».
      if (attempt < CLAUDE_RETRY_DELAYS_MS.length && isRetryableClaudeError(err)) {
        await sleepMs(CLAUDE_RETRY_DELAYS_MS[attempt]);
        continue;
      }
      const serverMsg = err.response?.data?.error;
      if (serverMsg) throw new Error(serverMsg);
      if (err.code === 'ECONNREFUSED') throw new Error('Proxy local non joignable — relance npm start');
      if (!err.response && err.code !== 'ECONNABORTED') {
        throw new Error('Connexion au serveur interrompue pendant l\'appel IA (déploiement ou réseau) — relancez l\'analyse');
      }
      throw err;
    }
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
const checkCoherence = async (articleHtml, updates) => {
  if (!updates?.length) return updates;

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

  const { text } = await callClaude(null, {
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
    if (u.type === 'suppression') return u;   // suppression : rien à valider (pas de "updated")
    const check = byIndex.get(i);
    if (!check) return u;
    return check.valid
      ? { ...u, coherent: true }
      : { ...u, coherent: false, coherenceIssue: check.issue || 'Incohérence détectée' };
  });
};

/**
 * Vérifie que chaque skill et document de la base de connaissances a bien été
 * appliqué dans les updates générés. Retourne les updates manquants à ajouter.
 * Silencieux en cas d'erreur — ne bloque jamais.
 */
const checkSkillsCompliance = async (articleContent, updates, skills, knowledge) => {
  const activeSkills = skills.filter(s => s.content && isActiveEntry(s));
  const activeDocs   = knowledge.filter(k => k.content && isActiveEntry(k));
  if (!activeSkills.length && !activeDocs.length) return [];

  const articleText = stripHtml(articleContent).substring(0, 3000);

  const updatesJson = JSON.stringify(
    updates.slice(0, 30).map(u => ({
      original: (u.original || '').substring(0, 100),
      updated:  (u.updated  || '').substring(0, 100),
      reason:   u.reason   || '',
      source:   u.source   || '',
    }))
  );

  const skillsList = activeSkills.map((s, i) => {
    const text = s.content?.trimStart().startsWith('<') ? stripHtml(s.content) : (s.content || '');
    return `### SKILL ${i + 1} — ${s.name}\n${text.substring(0, 600)}`;
  }).join('\n\n');

  const docsList = activeDocs.map((k, i) => {
    const isHtml = k.isHtml || k.source === 'manual' || k.content?.trimStart().startsWith('<');
    const text   = isHtml ? stripHtml(k.content) : (k.content || '');
    return `### DOCUMENT ${i + 1} — ${k.name}\n${text.substring(0, 600)}`;
  }).join('\n\n');

  const { text } = await callClaude(null, {
    model:      MODELS.FAST,
    max_tokens: 4000,
    system: `Tu es un auditeur de conformité SEO. Tu vérifie que les modifications générées respectent bien chaque skill et chaque document de la base de connaissances.
Pour chaque règle NON respectée ou insuffisamment couverte, tu génères la modification manquante.
Réponds UNIQUEMENT avec un JSON valide :
{"missing_updates":[{"original":"texte exact présent dans l'article","updated":"texte corrigé","reason":"Skill N — [nom] : explication","source":"Conformité skills"}]}
Si tout est respecté : {"missing_updates":[]}`,
    messages: [{
      role: 'user',
      content: `## SKILLS À VÉRIFIER
${skillsList || '(aucun)'}

## BASE DE CONNAISSANCES À VÉRIFIER
${docsList || '(aucune)'}

## MODIFICATIONS DÉJÀ GÉNÉRÉES
${updatesJson}

## ARTICLE (extrait — 3000 premiers caractères)
${articleText}

Vérifie si chaque skill et chaque document a été appliqué dans les modifications existantes.
Pour chaque élément ignoré ou insuffisamment traité : génère la modification manquante avec le texte EXACT de l'article dans "original".
Ne génère PAS de doublons avec les modifications déjà présentes.`,
    }],
  });

  const { missing_updates = [] } = parseJsonResponse(text, { missing_updates: [] }, '[compliance]');
  return missing_updates.filter(u => u.original && u.updated && u.reason);
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

/**
 * Lit la directive `liens_internes: N` dans les skills actifs.
 * Syntaxe tolérée : "liens_internes: 6", "liens internes : 3", etc.
 * Retourne { min, max, exact } — défaut { min:2, max:4, exact:false } si aucune directive.
 * exact:true → le prompt dira "exactement N liens" au lieu d'une plage.
 */
const extractIlCount = (skills) => {
  const RE = /liens[_\s-]*internes\s*:\s*(\d+)/i;
  for (const s of skills.filter(isActiveEntry)) {
    const text = s.content ? (s.content.trimStart().startsWith('<') ? stripHtml(s.content) : s.content) : '';
    const m = text.match(RE);
    if (m) {
      const n = Math.max(1, Math.min(10, parseInt(m[1], 10)));
      return { min: n, max: n, exact: true };
    }
  }
  return { min: 3, max: 5, exact: false };
};

/** Construit le bloc Skills pour le system prompt. */
const buildSkillsBlock = (skills, intro = 'Ces instructions définissent TON style, ta méthode et tes contraintes rédactionnelles.\nTu DOIS les respecter intégralement dans TOUTES tes modifications.', label = 'SKILLS ACTIFS — RÈGLES D\'ÉCRITURE OBLIGATOIRES') => {
  const active = skills.filter(s => s.content && isActiveEntry(s));
  if (!active.length) return '';
  return `\n\n## ═══ ${label} ═══\n${intro}\n\n` +
    active.map((s, i) => {
      const text = s.content?.trimStart().startsWith('<') ? stripHtml(s.content) : (s.content || '');
      return `### SKILL ${i + 1} — ${s.name}\n${text}`;
    }).join('\n\n');
};

/**
 * Compte les liens de l'article (maillage) : INTERNES (même domaine que l'article,
 * ou lien relatif) vs EXTERNES (autre domaine). Ignore ancres #, mailto:, tel:.
 * Comptage fiable côté code (le modèle ne compte pas) → chiffres injectés dans l'audit.
 */
const analyzeLinks = (html = '', articleUrl = '') => {
  const src = String(html);
  const hrefs = [
    ...[...src.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi)].map(m => m[1]),  // HTML <a href>
    ...[...src.matchAll(/\[[^\]]+\]\(\s*(https?:\/\/[^\s)]+|\/[^\s)]+)/gi)].map(m => m[1]), // markdown [txt](url)
  ].map(h => h.trim());
  let host = '';
  try { host = articleUrl ? new URL(articleUrl).hostname.replace(/^www\./, '') : ''; } catch { /* url invalide */ }
  let internal = 0, external = 0;
  for (const h of hrefs) {
    if (!h || /^(#|mailto:|tel:|javascript:)/i.test(h)) continue;
    if (/^https?:\/\//i.test(h)) {
      let lh = '';
      try { lh = new URL(h).hostname.replace(/^www\./, ''); } catch { /* ignore */ }
      if (host && lh === host) internal++;
      else if (lh) external++;
    } else {
      internal++; // lien relatif (/page, ../x) → interne
    }
  }
  return { internal, external, total: internal + external };
};

/**
 * Skills au format Claude (SKILL.md) actifs → pilotent l'agent en « mode cerveau ».
 * Ils portent { description, body, resources[] } (pas de `content`).
 */
const getBrainSkills = (skills = []) => {
  const active = (skills || []).filter(s => s?.format === 'skillmd' && s.body && isActiveEntry(s));
  // Dédoublonnage : une ré-importation de SKILL.md crée un NOUVEAU doc Firestore (addDoc,
  // pas d'upsert) → plusieurs cerveaux de MÊME nom peuvent coexister et injecteraient deux
  // versions du skill dans l'audit. On ne garde que le plus RÉCENT par nom.
  const byName = new Map();
  for (const s of active) {
    const key = (s.name || '').trim().toLowerCase();
    const ts = s.updatedAt || s.createdAt || 0;
    const prev = byName.get(key);
    if (!prev || ts >= (prev.updatedAt || prev.createdAt || 0)) byName.set(key, s);
  }
  return [...byName.values()];
};

/**
 * Bloc « cerveau » : un skill SKILL.md (méthode complète) pilote l'agent.
 * On injecte son corps + ses ressources, puis un PONT qui force la sortie au format
 * JSON d'updates du pipeline (hybride : audit → corrections concrètes).
 */
const buildBrainBlock = (brainSkills) => {
  const bodies = brainSkills.map(s => `### ${s.name}\n${s.body}`).join('\n\n───\n\n');
  const resources = brainSkills.flatMap(s => Array.isArray(s.resources) ? s.resources : []);
  const resBlock = resources.length
    ? `\n\n## ═══ RESSOURCES DU SKILL (gabarits / références — à appliquer quand le skill le demande) ═══\n` +
      resources.map(r => `### ${r.name}\n${r.content || ''}`).join('\n\n───\n\n')
    : '';
  return `\n\n## ═══ SKILL PRINCIPAL — MÉTHODE & EXPERTISE (à appliquer intégralement) ═══
Ce skill définit ton rôle, ta méthode d'analyse et tes critères. Applique-le à la lettre.

${bodies}${resBlock}

## ═══ PONT MÉTHODE → SORTIE PIPELINE (IMPÉRATIF — prioritaire sur tout « format de sortie » décrit par le skill) ═══
Utilise la méthode ci-dessus pour DÉCIDER quoi améliorer dans l'article, mais ta réponse
reste STRICTEMENT le JSON d'updates défini plus bas — jamais un rapport texte.
Traduis les conclusions de l'audit en modifications concrètes :
- Données obsolètes, prix/chiffres/dates erronés, manque de fraîcheur → updates (remplacement du segment EXACT).
- Éléments à ajouter (TL;DR, FAQ, paragraphe d'actualité, tableau comparatif) → updates "type":"addition".
- Tableau comparatif pertinent → une addition contenant le bloc HTML du gabarit de la ressource.
- NE supprime PAS un contenu au SEUL motif qu'il est « générique » : juge selon le CONTEXTE. Garde (et enrichis) les conseils génériques PERTINENTS pour le sujet et utiles au lecteur (sur un article produit/service : guide d'achat, comment choisir, entretien, usage, FAQ). Ne corrige/remplace/retire QUE le FAUX, l'OBSOLÈTE, ou le contenu RÉELLEMENT hors-sujet / remplissage qui dilue le sujet. Une recommandation d'audit du type « séparer infos marque et conseils » = RÉORGANISER/clarifier, pas supprimer ce qui est utile.
- Scores, audit EEAT, recommandations stratégiques, manquements → à résumer dans le champ "analysis" (PAS dans le contenu de l'article).
- IMPACT RÉEL UNIQUEMENT : n'émets une update QUE si elle change le FOND — corrige une donnée fausse/obsolète, ou ajoute un fait/chiffre/précision NOUVEAUX et utiles au lecteur. N'émets PAS d'update purement cosmétique : reformulation à sens égal, ou simple ajout d'une date/année ou d'une mention de source sur une information dont la valeur ne change pas. Dans le doute « est-ce un vrai apport pour le lecteur ? » → si non, n'émets rien. Mieux vaut 3 updates à fort impact que 10 retouches mineures.
N'insère JAMAIS dans l'article les titres de rapport (« Score global », « Tableau d'audit AIO », « Audit EEAT »…).`;
};

/** Construit le bloc Base de connaissances pour le system prompt. */
const buildKnowledgeBlock = (knowledge, intro = '', label = 'CHECKLIST OBLIGATOIRE') => {
  const active = knowledge.filter(k => k.content && isActiveEntry(k));
  if (!active.length) return '';
  const defaultIntro = `ATTENTION - PROTOCOLE STRICT : Tu DOIS lire chacun des ${active.length} documents ci-dessous,\nligne par ligne, et vérifier si l'article le respecte ou en a besoin.\nPour chaque élément applicable : ajoute une entrée dans "updates" avec\nreason = "Base de connaissances n°X — [Nom du document]".`;
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
const buildSystemPrompt = (skills, knowledge = [], auditReport = '') => {
  const { fr, year, prevYear, cutoffIso } = getDateContext();

  // Mode cerveau : si un skill SKILL.md est actif, il pilote l'agent et le socle + skills
  // legacy ne sont PAS injectés (le skill principal porte déjà rôle/méthode/critères).
  // Si un audit a déjà été réalisé (passe d'audit), on ne réinjecte PAS le corps du skill
  // (l'audit le résume) : on demande seulement de transformer l'audit en corrections.
  const brainSkills = getBrainSkills(skills);
  let skillsBlock;
  if (brainSkills.length && auditReport) {
    skillsBlock = `\n\n## ═══ MODE CORRECTION — un audit complet a été réalisé ═══\nUn audit détaillé de l'article t'est fourni dans le message utilisateur. Ton rôle ici : transformer ses conclusions ACTIONNABLES en corrections concrètes, au format JSON d'updates défini plus bas. Corrige les données fausses/obsolètes (updates) et ajoute TOUS les éléments recommandés — TL;DR, FAQ, tableau comparatif, paragraphe d'actualité, sections normatives/réglementaires (DTU, RE2020, codes, lois…), données ou angles manquants signalés — via "type":"addition".\nSi l'audit signale un article trop court ou recommande de nouveaux H2 : chaque H2 ajouté doit apporter un contenu NOUVEAU et informatif (exemples concrets, normes, données chiffrées, cas d'usage, comparatifs) — JAMAIS une reformulation du contenu existant pour gonfler artificiellement la longueur.\nAGIS COMME UN RÉDACTEUR WEB SEO SENIOR : au-delà des corrections factuelles, traque les REDONDANCES et RÉPÉTITIONS (même information répétée, paragraphe de remplissage qui n'apporte rien de neuf) et RETIRE-les via "type":"suppression" en gardant la meilleure occurrence ; assure la cohérence (un concept = un seul endroit). Ne supprime JAMAIS une information unique/nuancée, une donnée chiffrée, ni (sujet santé/YMYL) une information de sécurité — en cas de doute, ne supprime pas.\nRAISONNE LA STRUCTURE en partant du rapport d'audit ci-fourni (déjà fiable) : comme un éditeur SEO senior, DÉDUIS la logique idéale de CET article précis — intention de recherche (ce que veut vraiment l'internaute) → complétude (les sections/angles que le lecteur ET Google attendent sur ce sujet) → ordre logique (du général au spécifique, du "quoi" au "comment") → hiérarchie H2/H3 cohérente. AUCUN plan figé ni gabarit : le plan se DÉDUIT du sujet et de l'intention (deux articles différents = deux plans différents). Concrètement : (a) ajoute via "type":"addition" les sections logiques MANQUANTES que ce raisonnement révèle (contenu réel et utile, jamais du remplissage) ; (b) dans "analysis", propose le PLAN DE RÉDACTION recommandé — liste ordonnée des H2/H3 idéaux pour cet article — comme guide interne pour l'équipe ; (c) si des sections EXISTANTES sont mal ordonnées, signale-le dans "analysis" (le réordonnancement automatique n'est pas encore appliqué, c'est une reco).\nN'insère JAMAIS le rapport d'audit (scores, tableaux d'audit, EEAT…) dans le contenu de l'article ; ces éléments + les recommandations vont dans le champ "analysis".`;
  } else if (brainSkills.length) {
    skillsBlock = buildBrainBlock(brainSkills);
  } else {
    skillsBlock = buildSkillsBlock(skills);
  }
  // Règles d'équipe : les skills CLASSIQUES du menu SKILLS IA restent injectés
  // EN COMPLÉMENT du skill cerveau — l'équipe peut ainsi éditer ses règles
  // rédactionnelles dans le menu sans ré-importer le SKILL.md principal.
  if (brainSkills.length) {
    skillsBlock += buildSkillsBlock(
      skills,
      'Règles éditées par l\'équipe dans le menu SKILLS IA — complémentaires à la méthode du skill principal.\nTu DOIS les respecter intégralement dans TOUTES tes modifications.',
      'RÈGLES D\'ÉQUIPE (menu SKILLS IA) — OBLIGATOIRES'
    );
  }
  const knowledgeBlock = buildKnowledgeBlock(knowledge);

  return `Tu es un expert SEO/GEO (Search Engine Optimization & Generative Engine Optimization) spécialisé dans la mise à jour d'articles de blog, dossiers comparatifs et actualités.

**Date du jour : ${fr} (${cutoffIso} = seuil 6 mois)**
Toute donnée antérieure au ${cutoffIso} est OBLIGATOIREMENT suspecte et doit être vérifiée ou mise à jour.${skillsBlock}${knowledgeBlock}

## ═══ RÈGLES SEO STANDARD ═══

### RÈGLE ABSOLUE — LIENS EXTERNES INTOUCHABLES
Tu ne dois JAMAIS ajouter ni supprimer de lien EXTERNE (balise <a href> vers un autre domaine que celui de l'article).
- Si un passage à réécrire contient un lien externe, le lien (href ET texte d'ancre) doit apparaître À L'IDENTIQUE dans "updated".
- N'insère JAMAIS de nouveau <a href> externe dans "updated" — cite la source dans "source", pas dans le texte.
(Un verrou technique rejette toute update qui viole cette règle : elle serait perdue.)

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

ATTENTION - **INTERDIT pour les additions** : ne jamais créer un bloc "actualité récente", "Dernières actualités" ou similaire en te basant sur tes connaissances d'entraînement.
Ton entraînement s'arrête en début ${prevYear} — soit plus de 12 mois avant aujourd'hui (${fr}). Ces informations sont PÉRIMÉES.
**Une addition ne peut exister QUE si une source web scrapée avec URL réelle la confirme.**
Si aucune source web récente disponible → pas d'addition, pas de bloc actualité inventé.

### Type "suppression" — Retirer un contenu redondant/répétitif
Utilise ce type pour SUPPRIMER un passage qui répète une information déjà présente ailleurs dans l'article, ou un paragraphe de remplissage qui n'apporte rien de neuf.
- \`"type": "suppression"\`
- \`"original"\` : copie EXACTE mot-pour-mot du passage à retirer
- PAS de champ \`"updated"\`
- \`"reason"\` : ex. "Redondant : répète le paragraphe sur X déjà présent plus haut"
Règles : garde la MEILLEURE occurrence, supprime le doublon (jamais les deux). Ne supprime JAMAIS une information unique, une nuance, une donnée chiffrée, ni (sujet santé/YMYL) une information de sécurité. En cas de doute, ne supprime pas.

### Résumé de l'article (TL;DR) — OBLIGATOIRE, INSÉRÉ DANS L'ARTICLE (jamais dans "analysis")
Tu DOIS toujours produire un résumé de l'article, sous forme d'**addition** placée tout EN HAUT (juste après l'introduction) :
- \`"type": "addition"\`
- \`"anchor"\` : copie EXACTE de la 1re phrase de l'introduction (pour insérer juste après)
- \`"updated"\` : \`<h2>Résumé de l'article</h2><ul><li>…</li><li>…</li><li>…</li></ul>\` — 3 à 5 puces synthétisant les points clés (prix, durabilité, points forts…)
- \`"original"\` : \`""\`
- \`"reason"\` : \`"Résumé de l'article (TL;DR)"\`
EXCEPTION à la règle des sources : ce résumé synthétise le CONTENU DÉJÀ PRÉSENT dans l'article (il n'invente aucune info nouvelle) → il ne nécessite PAS de source web.
**NE METS JAMAIS ce résumé dans le champ "analysis".** Il est destiné au LECTEUR → il va DANS l'article (addition). Le champ "analysis" = synthèse INTERNE (audit/scores/skills), JAMAIS publiée.

### FAQ — OBLIGATOIRE, FORMAT ACCORDÉON (HTML natif, SANS couleur ni style)
Ajoute TOUJOURS une FAQ (3 questions/réponses), idéalement à partir des **questions PAA** de l'audit. Fais-le **MÊME si l'article contient déjà une FAQ** : propose alors de NOUVELLES questions complémentaires (ne duplique pas les questions déjà présentes). Produis-la comme UNE SEULE addition, en accordéon natif HTML :
- \`"type": "addition"\`
- \`"anchor"\` : copie EXACTE d'une phrase située vers la FIN de l'article (la FAQ se place en fin)
- \`"updated"\` : un titre \`<h2>FAQ</h2>\` suivi d'UN \`<details>\` par question. Chaque question = le \`<summary>\`, la réponse (50-60 mots) dans un \`<p>\` :
  \`<h2>FAQ</h2><details><summary>Question 1 ?</summary><p>Réponse courte.</p></details><details><summary>Question 2 ?</summary><p>Réponse courte.</p></details>\`
- N'utilise NI couleur, NI emoji, NI classe CSS, NI style inline, NI \`<ul>\`/\`<li>\` : uniquement \`<details>\`/\`<summary>\`/\`<p>\` bruts (l'apparence est gérée par le thème et l'éditeur).
- \`"original"\` : \`""\`
- \`"reason"\` : \`"FAQ"\`

{
  "analysis": "Synthèse INTERNE (NON publiée) : état de l'article + skills appliqués + base de connaissances + impact SEO — JAMAIS le résumé lecteur",
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
    },
    {
      "type": "suppression",
      "original": "copie EXACTE du passage redondant/répétitif à retirer",
      "reason": "Redondant : répète l'information déjà donnée plus haut"
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
  contentHtml    = '',    // HTML d'origine (avec les <a href>) — pour l'analyse du maillage (le texte brut perd les liens)
  skills,
  knowledge      = [],
  articleUrl     = '',
  targetKeyword  = '',    // mot-clé cible saisi par l'utilisateur dans Articles.jsx
  wpSites        = [],
  existingWpData = null,  // déjà récupéré par Articles.jsx — évite un 2e appel MCP
  modelPricing   = null,  // tarifs depuis settings.json — null = fallback hardcodé
  onStep,
  onReplace,
  onProgress,
}) => {
  const { iso, fr, year, prevYear, cutoffIso } = getDateContext();

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
          onStep(`WordPress MCP OK — article ID ${wpData.postId}${mediaInfo}`);
        }
      }
    } catch (e) {
      console.warn('[agent] MCP wp_get_post:', e.message);
    }
  }

  // ── Audit (mode cerveau) — AVANT la recherche de sources ──────────────────────
  // L'audit « style GEMS » porte sur l'ARTICLE SEUL (contenu + méta déjà récupérés
  // en Phase 0) : cohérence du sujet, normes, seuils/plafonds exacts, complétude
  // (TL;DR, FAQ, liens internes…). C'est la BASE de la proposition de MAJ. La
  // confrontation des chiffres aux sources fraîches se fait ensuite, à la rédaction.
  const brainSkills = getBrainSkills(skills);
  const brainMode   = brainSkills.length > 0;
  const model3      = selectModel('update_generation');
  const modelLabel  = model3.includes('sonnet') ? 'Sonnet' : model3.includes('opus') ? 'Opus' : 'Haiku';

  // Longueur & maillage comptés côté code (chiffres fiables) — utilisés par
  // l'audit ET par l'étape de rédaction (règles de longueur des skills d'équipe).
  const linkStats = analyzeLinks(contentHtml || content, articleUrl);
  const rawText   = stripHtml(contentHtml || content || '').trim();
  const wordCount = rawText ? rawText.split(/\s+/).length : 0;

  let auditReport = '';
  if (brainMode) {
    onStep('Audit approfondi de l\'article (méthode du skill)...');
    onProgress(15);

    const auditBodies = brainSkills.map(s => `### ${s.name}\n${s.body}`).join('\n\n───\n\n');
    const auditResources = brainSkills.flatMap(s => Array.isArray(s.resources) ? s.resources : []);
    const auditResBlock = auditResources.length
      ? `\n\n## RESSOURCES DU SKILL\n` + auditResources.map(r => `### ${r.name}\n${r.content || ''}`).join('\n\n───\n\n')
      : '';
    const auditSystem = `Nous sommes le ${fr}. Tu es l'expert décrit par le skill ci-dessous. Applique INTÉGRALEMENT sa méthode ET son « format de sortie » : produis le RAPPORT D'AUDIT COMPLET en markdown (scores, rapport de fraîcheur, tableau d'audit AIO, recommandations & actions prioritaires [UNE seule section consolidée], questions PAA, audit EEAT, analyse du maillage (liens internes/externes), tableau comparatif si pertinent, manquements).

## ORDRE D'ANALYSE IMPÉRATIF (avant tout le reste)
1. **COHÉRENCE DU SUJET D'ABORD.** Vérifie que l'article traite UN concept clairement défini, sans confusion entre notions voisines (ex. ne pas confondre un élément porteur de bâtiment avec une structure d'aménagement extérieur). Si l'article amalgame des concepts techniquement DISTINCTS ou décrit des matériaux/techniques VRAIMENT hors-sujet, c'est le DÉFAUT N°1 : signale-le en tête du résumé exécutif et pénalise fortement la citabilité et le score global. POUR LES CONTENUS « GÉNÉRIQUES », JUGE selon le CONTEXTE — le fait qu'un passage soit générique ne suffit NI à le condamner NI à le blanchir : un conseil générique PERTINENT pour le sujet et utile à l'intention de recherche (ex. sur un article climatiseur : comment choisir la puissance, entretien, usage, FAQ) est une VALEUR attendue → ne le compte PAS comme une incohérence. En revanche, du générique VRAIMENT hors-sujet, du remplissage qui dilue le sujet ou des digressions sans rapport avec l'intention de CET article = à signaler. Décide au cas par cas selon la pertinence pour CE sujet précis, jamais par une règle aveugle « générique = mauvais ».
2. **PRÉCISION NORMATIVE & ENTITÉS.** Exige les normes applicables (DTU, NF, RE2020, Code de l'urbanisme/PLU…), les bonnes UNITÉS (ex. pente en % et non en degrés si la norme l'exige), et la présence des entités expertes du domaine (signale celles qui manquent).
3. **PRÉCISION DES SEUILS, PLAFONDS ET CONDITIONS (anti-généralisation).** Pour toute donnée réglementaire (montant d'aide, plafond, seuil technique, éligibilité), donne la valeur EXACTE **par cas/par barème AVEC ses conditions** — jamais un chiffre rond généreux ni un « jusqu'à X » sans condition. Exemples du domaine : éco-PTZ = 7 000 € (parois vitrées seules) / **15 000 € (une action seule, dont isolation de toiture)** / 25 000 € (2 travaux) / 30 000 € (3+) / 50 000 € (rénovation globale uniquement) — donc « jusqu'à 50 000 € » est FAUX pour une action isolée. Pente DTU 43.1 = 0 à 5 %, **minimum 1 % (inaccessible) / 1,5 % (accessible)** — pas « 2 % ». MaPrimeRénov' 2026 = distinguer **Parcours par geste** et **Parcours Accompagné** (rénovation d'ampleur, gain ≥ 2 classes DPE, **Mon Accompagnateur Rénov' obligatoire**). Signale tout chiffre de l'article qui gomme ces conditions.
4. Ensuite seulement : repère les chiffres/prix/dates À VÉRIFIER (fraîcheur) et liste-les comme « à confronter aux sources » — la vérification factuelle contre des sources web datées se fait à l'étape de RÉDACTION (les sources ne sont pas encore disponibles ici).

Pour les questions PAA, donne SEULEMENT les questions (pas de réponses rédigées) — le TL;DR et les réponses FAQ sont produits dans la proposition de MAJ (vue APRÈS), pas dans l'audit.

## MAILLAGE (liens) — section dédiée OBLIGATOIRE
Analyse le maillage existant de l'article : indique le NOMBRE de liens INTERNES (même site) et EXTERNES (autres sites) — utilise les chiffres fournis dans le message utilisateur, ils sont fiables, reprends-les tels quels. Évalue si c'est suffisant pour le sujet et l'intention de recherche. Recommande EXPLICITEMENT d'en ajouter si trop peu : liens INTERNES vers des pages piliers pertinentes (propose les sujets/ancres) et liens EXTERNES vers des sources d'autorité (sites officiels, normes). Précise combien et de quels types.

## FORMAT MARKDOWN
- Le TL;DR, les actions, les réponses de FAQ et tout texte rédigé : en **markdown normal** (gras/italique/listes) — JAMAIS dans un bloc de code (pas de triple backtick).
- Réserve les blocs de code UNIQUEMENT au code destiné au copier-coller (HTML de tableau, balisage schema.org/JSON-LD) et précise le langage après les backticks (ex. \`\`\`html).

## EXHAUSTIVITÉ
Produis TOUTES les sections du format, sans en omettre ni les tronquer (le tableau comparatif peut rester en tableau markdown classique). NE PRODUIS PAS de « version HTML prête à copier-coller » (bloc ③ de la ressource) — inutile pour l'instant. N'inclus PAS de composant React ni d'artifact séparé (l'aperçu passe par la vue avant/après native). Ne produis QUE le rapport markdown, rien d'autre.

## CONCISION (prioritaire sur le format du skill — 2 parties à raccourcir)
- **Section « Tableau comparatif prix / performance »** : dans le rapport, écris UNIQUEMENT **une phrase de recommandation claire et lisible pour le lecteur**, du type « **Recommandation** : ajouter un tableau comparant 3-4 modèles sur prix / performance / garantie » ou « refondre le tableau existant en ajoutant une colonne X ». NE RECOPIE JAMAIS la consigne méta dans le rapport (« ne pas produire de tableau », « mentionner simplement », « la refonte se fera dans la vue après »… : ça, c'est pour TOI, pas pour le lecteur — c'est illisible dans un audit). Pas de tableau détaillé ni de données ligne par ligne ici ; le tableau réel est construit dans la vue Après.
- **Recommandations — UNE SEULE SECTION (impératif, PRIORITAIRE sur le format du skill)** : il est INTERDIT de produire à la fois une section « Actions prioritaires » ET une section « Recommandations stratégiques ». MÊME SI le skill liste les deux séparément, tu n'en produis qu'**UNE seule**, intitulée « Recommandations & actions prioritaires », qui regroupe TOUT (FAQ, sourcing des données, séparation des concepts, schema.org, maillage, etc.) **sans rien répéter**, ordonnée par priorité (haute / moyenne / faible). Zéro doublon : ne redonne pas la même reco (ex. « ajouter une FAQ », « sourcer les chiffres ») à deux endroits différents.
- **Questions PAA (People Also Ask)** : limite-toi aux **3 questions les plus pertinentes**, pas plus.
- **Section « Éléments prêts à copier-coller » (TL;DR rédigé + FAQ avec réponses)** : NE PAS la produire dans l'audit. Recommande seulement (ex. liste des 3 questions PAA à ajouter). Le contenu rédigé (TL;DR, FAQ) est produit dans la proposition de MAJ (vue APRÈS), où il figure déjà.
- **Section « Publication » / proposition de canal** (« mettre à jour en live ou enregistrer en brouillon ? »…) : NE PAS la produire. Le choix de publication est géré par l'interface de TONTON AI, pas par le rapport d'audit.

${auditBodies}${auditResBlock}${buildSkillsBlock(
      skills,
      'Règles éditées par l\'équipe dans le menu SKILLS IA. Intègre-les à ton audit : vérifie chacune d\'elles et signale tout manquement dans les recommandations & actions prioritaires.',
      'RÈGLES D\'ÉQUIPE (menu SKILLS IA) — À AUDITER AUSSI'
    )}`;
    const auditUser = `## ARTICLE À AUDITER\n${content}\n\n## DONNÉES FACTUELLES (comptées automatiquement — chiffres fiables, reprends-les tels quels)\n- Liens INTERNES (même site) : ${linkStats.internal}\n- Liens EXTERNES (autres sites) : ${linkStats.external}\n- Longueur article : ~${wordCount} mots (cible SEO minimale : 800-1 500 mots)\n\nProduis le rapport d'audit complet en markdown, dans le format exact imposé par le skill. IMPORTANT : analyse systématiquement la longueur de l'article. Si < 800 mots, signale-le en priorité haute et propose des H2 à ajouter. Chaque H2 suggéré doit apporter un contenu NOUVEAU et informatif (exemples concrets, normes, cas d'usage, comparatifs, données chiffrées) — JAMAIS une simple reformulation du contenu existant pour gonfler artificiellement la longueur.`;

    for (let attempt = 1; attempt <= 3 && !auditReport; attempt++) {
      try {
        const { text: auditText, usage: uA } = await callClaudeWithProgress(
          null,
          { system: auditSystem, max_tokens: 12000, model: model3, messages: [{ role: 'user', content: auditUser }] },
          onStep,
          onReplace,
          attempt === 1 ? 'Audit en cours' : `Audit en cours — nouvel essai (${attempt}/3)`
        );
        trackCall(uA);
        auditReport = (auditText || '').trim();
      } catch (e) {
        console.warn(`[audit] essai ${attempt}/3:`, e.message);
        if (attempt < 3) {
          onStep(`Audit — erreur transitoire, nouvel essai (${attempt}/3)…`);
          await new Promise(r => setTimeout(r, 1500 * attempt));
        } else {
          onStep(`⚠️ Audit indisponible après 3 essais (${e.message})`);
        }
      }
    }
  }

  // ── Étape 1 : Identifier les requêtes de recherche ────────────────────────────
  // searchLocale : marché ciblé par les recherches (langue + pays). Défaut FR
  // (app francophone) ; l'agent peut basculer en US/EN pour les sujets internationaux.
  let queries = [];
  let searchLocale = { lang: 'fr', country: 'fr' };
  try {
    const { text: step1Text, usage: u1 } = await callClaude(null, {
      system: `Tu es un assistant expert SEO qui génère des requêtes de recherche ciblées, ADAPTÉES AU MARCHÉ de l'article (langue, pays, devise).`,
      max_tokens: 800,
      model: selectModel('query_extraction'),
      messages: [{
        role: 'user',
        content: `Nous sommes le ${fr}. Génère entre 4 et 7 requêtes (selon la complexité) pour vérifier et mettre à jour les données récentes (${prevYear}-${year}) de cet article.

ÉTAPE A — Détecter le MARCHÉ de l'article :
- Sujet LOCAL (rénovation, travaux, services, immobilier, droit, santé, démarches, prix dans une devise nationale comme l'euro…) → marché = pays de l'article (le plus souvent la FRANCE). Recherche DANS LA LANGUE de l'article, vers des SOURCES LOCALES, avec la DEVISE de l'article (€).
- Sujet INTERNATIONAL (jeux vidéo, logiciels/tech mondiaux, science, actualité mondiale) → sources anglophones/US pertinentes et logiques.

ÉTAPE B — Générer les requêtes en conséquence :
- LOCAL (FR) → requêtes EN FRANÇAIS, cibler sources officielles et médias FR, sites en .fr, et des prix en EUROS. NE JAMAIS chercher des prix en USD ni des sources US pour un sujet franco-français.
  Ex : "[sujet] prix moyen au m² ${year} France", "[produit] tarif ${year} site:.fr", "[sujet] guide ${year} France"
- INTERNATIONAL → requêtes en anglais vers officiels/médias internationaux (TechCrunch, The Verge, Reuters, Bloomberg, pages de tarification officielles, rapports).

Chaque requête DOIT :
- Contenir l'année ${prevYear} ou ${year} pour cibler du contenu récent
- Cibler un fait précis : prix, version, statistique, annonce officielle, rapport
- NE PAS mener à YouTube, Reddit, Quora ou réseaux sociaux

Génère UNIQUEMENT le nombre de requêtes réellement utiles (pas besoin d'en forcer 7 si 4 suffisent).

Réponds UNIQUEMENT avec un JSON :
{"lang": "fr|en (langue des requêtes)", "country": "fr|us|… (code pays 2 lettres du marché)", "queries": ["...", "..."]}

Article (extrait) :
${content.substring(0, 5000)}`,
      }],
    });
    trackCall(u1);

    const parsed = parseJsonResponse(step1Text, {}, '[agent] Query extraction failed:');
    queries = parsed.queries || [];
    const code = (v) => (typeof v === 'string' && /^[a-z]{2}$/i.test(v.trim())) ? v.trim().toLowerCase() : null;
    searchLocale = { lang: code(parsed.lang) || 'fr', country: code(parsed.country) || 'fr' };
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
  const marketLabel = searchLocale.country === 'fr' ? 'marché FR (€)' : `marché ${searchLocale.country.toUpperCase()}`;
  onStep(`Recherche web sur ${queries.length} requête${queries.length > 1 ? 's' : ''} — ${marketLabel}...`);
  onProgress(28);

  // Recherche parallèle — limité à 5 requêtes simultanées pour réduire
  // le nombre de connexions réseau en vol et les AbortError de timeout
  // searchLocale oriente Brave/SearXNG vers le bon pays/langue (sources locales).
  const allSearches = await Promise.allSettled(
    queries.slice(0, 5).map(q => searchWeb(q, searchLocale))
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
    .slice(0, 5)   // max 5 pages scrapées (Tavily fournit déjà le contenu — ces URLs viennent surtout de Brave)
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
        onStep(`OK ${match?.title?.substring(0, 55) || urlsToScrape[i]}...`);
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
  // model3 / modelLabel sont calculés en amont (bloc d'audit, après la Phase 0).
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
  const activeKnowlCount = knowledge.filter(k => k.content && isActiveEntry(k)).length;
  const knowlReminder = activeKnowlCount > 0
    ? `\n## RAPPEL — BASE DE CONNAISSANCES (${activeKnowlCount} documents dans le system prompt)\n` +
      `Tu as ${activeKnowlCount} document(s) dans ta base de connaissances. ` +
      `AVANT d'analyser les sources web, parcours-les un par un et vérifie si chacun s'applique à cet article.\n` +
      knowledge.filter(k => k.content && isActiveEntry(k)).map((k, i) =>
        `- Document ${i + 1} : ${k.name}`
      ).join('\n') + '\n'
    : '';

  // Mode cerveau : brainSkills/brainMode sont calculés en amont (bloc d'audit).
  // Les skills CLASSIQUES (règles d'équipe du menu SKILLS IA) restent injectés
  // en complément du cerveau — rappel dans tous les modes.
  const legacyActiveSkills = skills.filter(s => s.content && isActiveEntry(s));
  const legacyList = legacyActiveSkills.map((s, i) => `- Skill ${i + 1} : **${s.name}**`).join('\n');
  const skillsReminder = brainMode
    ? `\n## RAPPEL — SKILL PRINCIPAL\nApplique INTÉGRALEMENT la méthode du skill « ${brainSkills.map(s => s.name).join(', ')} » (décrit dans le system prompt), puis produis le JSON d'updates demandé — jamais un rapport texte.\n` +
      (legacyActiveSkills.length > 0
        ? `Respecte AUSSI les ${legacyActiveSkills.length} règle(s) d'équipe du menu SKILLS IA (system prompt) :\n${legacyList}\n`
        : '')
    : (legacyActiveSkills.length > 0
        ? `\n## RAPPEL — SKILLS ACTIFS (${legacyActiveSkills.length} règles obligatoires dans le system prompt)\n` +
          `Chaque modification DOIT respecter ces ${legacyActiveSkills.length} skill(s) :\n` +
          legacyList + '\n'
        : '');

  // ── Audit déjà réalisé en amont (juste après la Phase 0, AVANT la recherche) ──
  // auditReport est déjà disponible ici : il alimente l'onglet AUDIT et sert de base
  // aux corrections. La confrontation aux sources fraîches se fait dans cette étape de
  // rédaction (sources web ci-dessous), pas dans l'audit.

  const kwBlock = targetKeyword
    ? `## MOT-CLÉ CIBLE\n**"${targetKeyword}"** — Priorise ce mot-clé dans toutes tes modifications : H1/H2, introduction, densité sémantique naturelle, balises title/meta si présentes.\n\n`
    : '';

  const auditBlock = auditReport
    ? `## AUDIT DÉJÀ RÉALISÉ — base de tes corrections\nTransforme les conclusions ACTIONNABLES de cet audit en updates/additions concrètes (corrige les données fausses/obsolètes, ajoute TOUS les contenus recommandés : TL;DR, FAQ, tableaux, sections normatives/réglementaires, données ou angles manquants…). Ne recopie PAS le rapport dans l'article ; scores/EEAT/recommandations → champ "analysis".\n\n${auditReport}\n\n---\n\n`
    : '';

  const userMessage = `Nous sommes le ${fr} (${iso}).
${kwBlock}${skillsReminder}${knowlReminder}${auditBlock}
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
${scrapedContext ? `## CONTENU DES SOURCES RÉCENTES (${prevYear}-${year})\n${scrapedContext}\n\n---\n\n` : ''}${sourcesSnippets ? `## RÉSULTATS DE RECHERCHE WEB\n${sourcesSnippets}\n\n---\n\n` : ''}## ARTICLE À ANALYSER (~${wordCount} mots — compté côté code, chiffre fiable · cible SEO : 800-1 500 mots)
${content}

## Règles finales
- Tout ce qui date d'avant ${cutoffIso || prevYear} est OBLIGATOIREMENT suspect
- "original" = copie EXACTE mot-pour-mot du texte de l'article
- Réponds UNIQUEMENT avec le JSON valide, sans markdown ni texte autour`;

  // Génération avec compteur de tokens simulé (feedback visuel temps réel).
  // Retry x3 (comme l'audit) : une erreur transitoire d'Anthropic (529 « overloaded »,
  // 5xx, timeout) sur cette grosse génération ne doit pas faire échouer toute la MAJ.
  let finalText = '', u3 = null, genOk = false;
  for (let attempt = 1; attempt <= 3 && !genOk; attempt++) {
    try {
      const r = await callClaudeWithProgress(
        null,
        { system: buildSystemPrompt(skills, knowledge, auditReport), max_tokens: 32000, model: model3, messages: [{ role: 'user', content: userMessage }] },
        onStep,
        onReplace,
        attempt === 1 ? `Génération en cours (${modelLabel})` : `Génération — nouvel essai (${attempt}/3)`
      );
      finalText = r.text || '';
      u3 = r.usage;
      genOk = true;
    } catch (e) {
      console.warn(`[generation] essai ${attempt}/3:`, e.message);
      if (attempt < 3) {
        onStep(`Génération — erreur transitoire, nouvel essai (${attempt}/3)…`);
        await new Promise(r => setTimeout(r, 1500 * attempt));
      } else {
        throw e; // après 3 échecs → la MAJ remonte en erreur (avec le message)
      }
    }
  }
  if (u3) trackCall(u3);

  onStep('Finalisation des résultats...');
  onProgress(88);

  // ── Parse JSON ───────────────────────────────────────────────────────────────
  const result = parseJsonResponse(
    finalText,
    { analysis: '', updates: [], sources: [], _parseFailed: true },
    '[agent] JSON parse failed — réponse brute:'
  );

  // Mode cerveau mais audit échoué → ne PAS faire passer la MAJ pour normale :
  // on signale clairement (non-silencieux) que les corrections ont été produites
  // sans rapport d'audit, et on invite à relancer (l'audit est la base — priorité n°1).
  if (brainMode && !auditReport) {
    result._auditFailed = true;
    result.analysis = `⚠️ AUDIT INDISPONIBLE — le rapport d'audit complet n'a pas pu être généré (erreur API après 3 essais). Les corrections ci-dessous sont issues de la méthode du skill mais SANS rapport d'audit détaillé. Relance la MAJ pour obtenir l'audit complet.\n\n${result.analysis || ''}`;
  }

  // ── Étape 4 : Conformité skills + base de connaissances ──────────────────────
  if (legacyActiveSkills.length > 0 || knowledge.filter(k => k.content && isActiveEntry(k)).length > 0) {
    onStep('Vérification de conformité skills et base de connaissances...');
    onProgress(90);
    try {
      // Les skills classiques (règles d'équipe) sont contrôlés dans TOUS les modes ;
      // le skill SKILL.md n'a pas de `content` → exclu naturellement du contrôle.
      const complianceUpdates = await checkSkillsCompliance(
        content, result.updates || [], skills, knowledge
      );
      if (complianceUpdates.length > 0) {
        result.updates = [...(result.updates || []), ...complianceUpdates];
        onStep(`Conformité : ${complianceUpdates.length} correction(s) ajoutée(s)`);
      }
    } catch (e) {
      console.warn('[compliance] Échec de la vérification :', e.message);
    }
  }

  // ── Étape 5 : Vérification de cohérence ──────────────────────────────────────
  if ((result.updates || []).length > 0) {
    onStep('Vérification de cohérence des modifications...');
    onProgress(95);
    try {
      result.updates = await checkCoherence(content, result.updates);
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
  // Fonctionne si wpData est disponible OU si articleUrl correspond à un site configuré
  let internalLinks = [];
  // Explication affichée à l'utilisateur quand 0 lien n'est proposé.
  let ilReason = '';
  // Liens internes DÉJÀ présents dans l'article d'origine (comptage fiable).
  const existingInternal = analyzeLinks(contentHtml || content, articleUrl).internal;
  // Seuil de FREINAGE : au-delà, on n'ajoute plus de lien interne — SAUF dans un
  // paragraphe entièrement réécrit par la MAJ (texte neuf).
  const IL_THROTTLE_AT = 5;
  const ilThrottled = existingInternal >= IL_THROTTLE_AT;
  // Texte NEUF de cette MAJ (additions + remplacements) → seule zone où l'on
  // s'autorise de nouveaux liens quand on freine. Minuscule pour matcher l'ancre.
  const newText = ((result.updates || [])
    .map(u => (u.type === 'suppression' ? '' : (u.updated || '')))
    .join(' \n ') || '')
    .replace(/<[^>]+>/g, ' ')
    .toLowerCase();

  const ilSiteId = wpData?.siteId || (() => {
    if (!articleUrl || !wpSites?.length) return null;
    try {
      const h = new URL(articleUrl).hostname.replace(/^www\./, '');
      const s = wpSites.find(site => {
        try { return new URL(site.url).hostname.replace(/^www\./, '') === h; }
        catch { return false; }
      });
      return s?.id || null;
    } catch { return null; }
  })();
  if (!ilSiteId) {
    ilReason = "Aucune URL d'article ou site WordPress configuré → suggestions de liens internes indisponibles (renseignez l'URL du post pour les activer).";
  }
  if (ilSiteId && wpSites?.length) {
    // Limite configurable via skills — directive "liens_internes: N" dans le contenu d'un skill
    const { min: ilMin, max: ilMax, exact: ilExact } = extractIlCount(skills);
    try {
      onStep(`Recherche de liens internes (${ilExact ? ilMax : `${ilMin}–${ilMax}`})...`);
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
          siteId:     ilSiteId,
          wpSites,
          queries:    keywords.slice(0, 3),
          excludeUrl: articleUrl,
        });
        const relatedPosts = resp.data?.posts || [];

        if (relatedPosts.length >= 1) {
          // 3. Demander à Claude de suggérer N liens internes (paramétré via skills)
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

Suggère ${ilExact ? `exactement ${ilMax}` : `${ilMin} à ${ilMax}`} lien(s) interne(s).
${ilExact ? '' : `Tu DOIS proposer ${ilMin} liens : choisis les ${ilMin} articles les PLUS proches thématiquement parmi la liste ci-dessus.`}

RÈGLE DE PERTINENCE ABSOLUE — l'ancre et l'article lié doivent porter sur le MÊME sujet précis :
- Ne relie JAMAIS deux sujets différents. Exemple interdit : une ancre "isolation des fenêtres" reliée à un article sur "l'isolation des murs" — ce sont deux sujets distincts.
- Avant de retenir un lien, vérifie que le titre de l'article cible traite bien du sujet exact de l'ancre. Si aucun article ne correspond vraiment à une ancre, choisis une autre ancre dont le sujet a, lui, un article correspondant.
- Mieux vaut une ancre un peu plus générale qui correspond à un article que deux sujets précis mal appariés.

Pour chaque lien :
- "anchor" : une expression COURTE (2-5 mots) présente EXACTEMENT mot-pour-mot dans l'article, riche en mots-clés, et dont le SUJET correspond à l'article lié. Choisis une expression simple et certaine d'exister, pas une longue phrase.
- "url" : l'URL de l'article lié
- "title" : le titre de l'article lié
- "reason" : en quoi l'article lié approfondit précisément le sujet de l'ancre (1 phrase)

Réponds UNIQUEMENT : {"links":[{"anchor":"...","url":"...","title":"...","reason":"..."}]}`,
            }],
          });
          trackCall('internal_links', linksText);
          const { links = [] } = parseJsonResponse(linksText, { links: [] }, '[internal-links]');
          let valid = links.filter(l => l.anchor && l.url && l.title);
          // FREINAGE : l'article a déjà ≥ IL_THROTTLE_AT liens internes → on ne
          // garde que les liens dont l'ancre tombe dans un paragraphe RÉÉCRIT
          // (texte neuf de la MAJ). Sinon aucun nouveau lien.
          if (ilThrottled) {
            valid = valid.filter(l => newText.includes((l.anchor || '').toLowerCase()));
          }
          internalLinks = valid.slice(0, ilMax);
          if (internalLinks.length === 0) {
            ilReason = ilThrottled
              ? `L'article contient déjà ${existingInternal} liens internes (seuil ${IL_THROTTLE_AT}) : de nouveaux liens ne sont proposés que dans un paragraphe entièrement réécrit — aucun ici.`
              : "Aucune ancre pertinente trouvée pour un article lié du même site (les sujets ne correspondaient pas assez précisément).";
          }
        } else {
          ilReason = "Aucun article lié pertinent trouvé sur le site pour ce sujet.";
        }
      } else {
        ilReason = "Impossible d'extraire des mots-clés pour rechercher des articles liés.";
      }
    } catch (e) {
      // Liens internes non bloquants — on continue sans
      console.warn('[internal-links] erreur:', e.message);
      ilReason = 'Recherche de liens internes indisponible (erreur réseau/API).';
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
    // Contexte des liens internes (affiché dans l'UI quand 0 suggestion)
    internalLinksInfo: {
      reason: internalLinks.length === 0 ? ilReason : '',
      existingInternal,
      throttled: ilThrottled,
    },
    audit: auditReport,   // rapport d'audit complet (mode cerveau) → onglet AUDIT
  };
};

// ── Prompt système — Deuxième passe ──────────────────────────────────────────
const buildReviewSystemPrompt = (skills, knowledge = []) => {
  const { fr, year, prevYear } = getDateContext();

  // Mode cerveau : le skill SKILL.md pilote aussi la passe 2 — les skills
  // classiques (règles d'équipe du menu) restent injectés en complément.
  const brainSkills = getBrainSkills(skills);
  const skillsBlock = brainSkills.length
    ? buildBrainBlock(brainSkills) + buildSkillsBlock(
        skills,
        'Règles éditées par l\'équipe dans le menu SKILLS IA. Vérifie que l\'article (après passe 1) respecte chacune d\'elles.',
        'RÈGLES D\'ÉQUIPE (menu SKILLS IA) — OBLIGATOIRES'
      )
    : buildSkillsBlock(skills, 'Vérifie que l\'article (après passe 1) respecte chacune de ces instructions.');
  const active = knowledge.filter(k => k.content && isActiveEntry(k));
  const knowledgeBlock = buildKnowledgeBlock(
    knowledge,
    active.length > 0
      ? `ATTENTION - PROTOCOLE PASSE 2 : La passe 1 a peut-être manqué certains documents.\nRelis chacun des ${active.length} documents ci-dessous et vérifie s'il a bien été appliqué.\nSi non → ajoute l'entrée manquante avec reason = "Base de connaissances n°X — [Nom] (non traité en passe 1)".`
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
- RÈGLE ABSOLUE : ne JAMAIS ajouter ni supprimer de lien EXTERNE (<a href> vers un autre domaine) — un lien externe présent dans "original" doit rester À L'IDENTIQUE dans "updated"

## Format — JSON valide UNIQUEMENT

### Type par défaut : remplacement
\`\`\`
{ "original": "copie EXACTE", "updated": "texte actualisé", "reason": "...", "source": "..." }
\`\`\`

### Type "addition" — Nouveau paragraphe (actualité absente de l'article)
Utilise ce type quand les sources web scrapées révèlent une information vraiment nouvelle, non présente dans l'article.
- \`"type": "addition"\`, \`"anchor"\` : phrase EXACTE de l'article indiquant où insérer, \`"updated"\` : HTML \`<p>...</p>\`, \`"original"\` : \`""\`

ATTENTION - **INTERDIT** : ne jamais créer une addition basée sur tes connaissances d'entraînement (qui s'arrêtent en début ${prevYear}, soit 12+ mois de retard). Source web réelle obligatoire.

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
  let searchLocale = { lang: 'fr', country: 'fr' };
  try {
    const { text: step1Text, usage: u1 } = await callClaude(null, {
      system: `Tu es un expert SEO générant des requêtes de recherche complémentaires, ADAPTÉES AU MARCHÉ de l'article (langue, pays, devise), pour enrichir un article déjà partiellement mis à jour.`,
      max_tokens: 600,
      model: selectModel('query_extraction'),
      messages: [{
        role: 'user',
        content: `Nous sommes le ${fr}. Une première passe a déjà mis à jour cet article.

Première passe — ce qui a été modifié :
${alreadyDone}

Détecte le MARCHÉ de l'article :
- Sujet LOCAL (travaux, services, immobilier, prix en euros…) → requêtes EN FRANÇAIS, sources LOCALES (officiels/médias FR, sites .fr), devise = € (jamais d'USD ni de sources US pour un sujet franco-français).
- Sujet INTERNATIONAL (jeux vidéo, tech mondiale, science…) → requêtes en anglais, sources internationales/US.

Génère entre 3 et 6 requêtes pour trouver des informations COMPLÉMENTAIRES non couvertes.
Cible des aspects différents : autres produits/options cités, tendances marché ${prevYear}-${year}, données manquantes.
Génère uniquement les requêtes réellement utiles (pas besoin de forcer 6 si 3 suffisent).

Réponds UNIQUEMENT :
{"lang": "fr|en", "country": "fr|us|… (code pays 2 lettres)", "queries": ["...", "..."]}

Article (extrait) :
${content.substring(0, 3000)}`,
      }],
    });
    trackCall(u1);
    const parsed = parseJsonResponse(step1Text, {}, '[review] Query extraction failed:');
    queries = parsed.queries || [];
    const code = (v) => (typeof v === 'string' && /^[a-z]{2}$/i.test(v.trim())) ? v.trim().toLowerCase() : null;
    searchLocale = { lang: code(parsed.lang) || 'fr', country: code(parsed.country) || 'fr' };
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
      queries.map(q => searchWeb(q, searchLocale))
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
      .slice(0, 5).map(r => r.url);

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
    ? `## SOURCES FOURNIES PAR LE CQ IA — À INTÉGRER EN PRIORITÉ\n${
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
- NE PAS re-proposer ce qui a déjà été changé en passe 1${manualSources.filter(s => s.content).length > 0 ? '\n- Intégrer EN PRIORITÉ les informations des sources fournies par le CQ IA (section ci-dessus)' : ''}
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
    ...manualSources.map(s => ({ title: s.title || s.url, url: s.url, relevance: 'Source CQ IA' })),
    ...(result.sources || []),
    ...scrapedSources.map(s => ({ title: s.title, url: s.url, relevance: 'Passe 2' })),
    ...searchResults.slice(0, 5).map(s => ({ title: s.title, url: s.url, relevance: s.description || '' })),
  ];

  const costUsd = calcCost(tokenAcc.calls, modelPricing);
  return { ...result, sources: dedupeByUrl(allSources).slice(0, 10), tokenUsage: { ...tokenAcc, costUsd } };
};

// ── Génération des meta SEO (Yoast / SEOPress) ────────────────────────────────
/**
 * Génère un meta title (≤60 chars) et une meta description (≤155 chars) optimisés SEO
 * à partir du HTML final de l'article. Utilise Haiku (rapide, économique).
 * Retourne { seoTitle, seoDescription } — chaînes vides en cas d'échec.
 */
export const generateSeoMeta = async (articleHtml = '', articleTitle = '') => {
  const { fr } = getDateContext();
  const articleText = stripHtml(articleHtml).substring(0, 3000);

  try {
    const { text } = await callClaude(null, {
      model: MODELS.FAST,
      max_tokens: 250,
      system: 'Tu génères des balises SEO optimisées pour des articles de blog français. Réponds UNIQUEMENT avec le JSON demandé, sans texte autour.',
      messages: [{
        role: 'user',
        content: `Date : ${fr}
Titre de l'article : ${articleTitle || '(non renseigné)'}

Contenu (extrait) :
${articleText}

Génère :
- "seoTitle" : meta title SEO optimisé, 50-60 caractères, mot-clé principal en début, en français
- "seoDescription" : meta description engageante, 140-155 caractères, call-to-action, en français

Réponds UNIQUEMENT : {"seoTitle":"...","seoDescription":"..."}`,
      }],
    });

    const parsed = parseJsonResponse(text, {}, '[generateSeoMeta]');
    return {
      seoTitle:       (parsed.seoTitle       || '').trim().substring(0, 70),
      seoDescription: (parsed.seoDescription || '').trim().substring(0, 165),
    };
  } catch {
    return { seoTitle: '', seoDescription: '' };
  }
};

/**
 * Suggère LA catégorie la plus pertinente parmi les catégories existantes du site,
 * pour un article qui n'en a pas. Utilise Haiku (rapide). Retourne l'id ou null.
 * Ne crée jamais de catégorie : choisit uniquement dans la liste fournie.
 */
export const suggestCategory = async (articleHtml = '', categories = []) => {
  const list = (categories || []).filter(c => c && c.id != null && c.name);
  if (!articleHtml || list.length === 0) return null;
  const articleText = stripHtml(articleHtml).substring(0, 1500);
  try {
    const { text } = await callClaude(null, {
      model: MODELS.FAST,
      max_tokens: 30,
      system: 'Tu classes un article dans UNE seule catégorie existante. Réponds UNIQUEMENT avec le JSON {"id": <id>} de la catégorie la plus pertinente de la liste.',
      messages: [{
        role: 'user',
        content: `Catégories disponibles :\n${list.map(c => `- ${c.id} : ${c.name}`).join('\n')}\n\nArticle (extrait) :\n${articleText}\n\nRéponds UNIQUEMENT : {"id": <id de la meilleure catégorie>}`,
      }],
    });
    const { id } = parseJsonResponse(text, {}, '[suggestCategory]');
    return list.some(c => String(c.id) === String(id)) ? id : null;
  } catch {
    return null;
  }
};
