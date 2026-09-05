/**
 * src/server/pipeline.js — orchestrateur HEADLESS du pipeline QAT complet.
 *
 * Rejoue exactement ce que fait `ArticleResult.jsx` en cliquant Audit →
 * Génération → Obsolescence → Relecture, SANS AUCUN clic — pour un traitement
 * par lot (Google Sheet, à venir) sans navigateur ouvert.
 *
 * PRINCIPE : ce fichier ne réimplémente RIEN du métier IA. Il appelle les MÊMES
 * fonctions que l'UI (`runQatAudit`, `runQatRewrite`, `runReviewAgent`,
 * `runStyleFixAgent`) et les MÊMES fonctions de décision automatique
 * (`scopeProposedByAudit`, `defaultAuditSelection`, `auditSuggestedLinkRows`)
 * — jamais une réécriture parallèle qui dériverait du comportement réel de
 * l'UI avec le temps. Voir .claude/CLAUDE.md : « une seule source de vérité ».
 *
 * PLACÉ SOUS `src/` pour hériter du test runner (`react-scripts test` ne
 * découvre que `src/**`), mais N'EST JAMAIS IMPORTÉ PAR L'APP REACT — aucun
 * fichier de `index.js`/`App.js` ne le référence, donc webpack ne l'inclut
 * jamais dans le bundle client (CRA ne bundle que ce qui est réellement
 * importé depuis le point d'entrée).
 *
 * Ce module est PUR côté logique : aucune lecture de `document`/`window`/
 * `sessionStorage` ici. Ces globales n'existent QUE parce que les modules
 * importés ci-dessous (agentQat.js → diff.js/internalWeave.js, agent.js) les
 * utilisent en interne — c'est `pipelineCli.js` (racine du repo) qui les
 * simule avant d'appeler ce fichier depuis un process Node nu (jamais depuis
 * proxy.js lui-même, pour ne jamais polluer son axios partagé — voir le
 * commentaire de pipelineCli.js).
 *
 * Sous Jest, ces globales existent déjà (jest-environment-jsdom, config CRA
 * par défaut) : aucune simulation n'est nécessaire pour les tests.
 */

const axios = require('axios');
const { runQatAudit, runQatRewrite } = require('../services/agentQat');
const { runReviewAgent, calcCost, aggregateCallsByPass } = require('../services/agent');
const { runStyleFixAgent } = require('../services/agentStyle');
const { detectStylePatterns } = require('../utils/stylePatterns');
const { defaultAuditSelection } = require('../utils/auditSelection');
const { auditSuggestedLinkRows } = require('../utils/auditSuggestions');
const { cleanLinkRows } = require('../constants/majMode');
const { stripNonEditorialLinks } = require('../utils/scrapeClean');
const { buildGenerationPrompt, DEFAULT_VERIFICATION_TEMPLATE } = require('../utils/generationPrompt');
const { SCOPE_SIMPLE, scopeProposedByAudit } = require('../constants/majPhases');
const statsReducer = require('../store/slices/statsSlice').default;
const { addArticleStat } = require('../store/slices/statsSlice');

/**
 * Fusionne deux accumulateurs de tokens EXACTEMENT comme `mergedTokenUsage`
 * dans ArticleResult.jsx : le total AFFICHÉ (miroir de l'écran) cumule toutes
 * les phases, mais CHAQUE dispatch de stats ne porte que sa PROPRE phase (voir
 * le commentaire de `dispatchPhaseStat` plus bas) — sinon audit_qat et
 * query_extraction seraient comptés deux fois dans totalByPass.
 */
const mergeTokenUsage = (a, b) => ({
  input: (a?.input || 0) + (b?.input || 0),
  output: (a?.output || 0) + (b?.output || 0),
  costUsd: (a?.costUsd || 0) + (b?.costUsd || 0),
  calls: [...(a?.calls || []), ...(b?.calls || [])],
});

/**
 * PUT /api/data/stats — lit l'état courant, applique le MÊME reducer Redux
 * que le client (aucune logique de fusion dupliquée), écrit le résultat.
 * Non bloquant : une panne stats ne doit jamais faire échouer un article dont
 * le contenu a déjà coûté de l'argent à produire.
 */
const dispatchPhaseStat = async (http, { articleId, title, tokenUsage, pass, modelPricing }) => {
  if (!articleId || !tokenUsage) return;
  try {
    const current = (await http.get('/data/stats')).data || {};
    const next = statsReducer(current, addArticleStat({
      id: articleId,
      title,
      inputTokens: tokenUsage.input,
      outputTokens: tokenUsage.output,
      costUsd: tokenUsage.costUsd,
      createdAt: new Date().toISOString(),
      pass,
      byPass: aggregateCallsByPass(tokenUsage.calls, modelPricing || null),
    }));
    await http.put('/data/stats', next);
  } catch (e) {
    console.warn(`[runner] échec dispatch stats (pass ${pass}) — coût réel non affecté :`, e.message);
  }
};

/**
 * Exécute le pipeline complet (Audit → Génération → Obsolescence → Style) sur
 * UN article, du scraping à la persistance, avec les défauts déterministes
 * qui remplacent les clics manuels de l'UI (voir Phase 1 du chantier batch) :
 *   - sélection des cases d'audit  → `defaultAuditSelection(scope)`
 *   - liens internes               → `auditSuggestedLinkRows(audit)` tels quels
 *   - ampleur / depth              → `scopeProposedByAudit(audit)`, jamais 'auto'
 *     manuel : ce sont EXACTEMENT les valeurs que l'UI calcule elle-même avant
 *     de les proposer au rédacteur (ArticleResult.jsx:2301) — pas une nouvelle
 *     règle inventée pour le runner.
 *
 * S'ARRÊTE À LA RELECTURE. Ne publie jamais : la relecture humaine reste le
 * dernier geste avant `handlePublish`, exactement comme pour un article lancé
 * depuis l'UI (voir la question de conception posée avant ce chantier).
 *
 * @param {object} input
 * @param {string} input.articleUrl
 * @param {string} input.targetKeyword
 * @param {string} [input.instruction]      consigne libre (future colonne GSheet) —
 *   si absente, reconstruite via `buildGenerationPrompt` comme le fait l'UI par défaut
 * @param {object} [input.modelSelections]
 * @param {object} [input.modelPricing]
 * @param {Array}  [input.skills]           déjà chargés par l'appelant (GET /api/data/skills)
 * @param {Array}  [input.knowledge]        déjà chargés par l'appelant (GET /api/data/knowledge)
 * @param {Array}  [input.wpSites]
 * @param {string} input.launchedByUid      identité de l'auteur du batch → assigneeId/lastModifiedBy
 * @param {string} input.launchedByName     nom affiché → lastModifiedBy
 * @param {string} input.apiBaseUrl         ex. http://127.0.0.1:3001/api
 * @param {string} input.authToken          JWT interne miné par l'appelant (proxy.js), jamais par ce fichier
 * @param {function} [input.onStep]         log de progression (une ligne par étape)
 */
const runArticlePipeline = async (input) => {
  const {
    articleUrl, targetKeyword, instruction = '',
    modelSelections = null, modelPricing = null,
    skills: skillsInput = null, knowledge: knowledgeInput = null,
    wpSites = [], existingWpData = null,
    launchedByUid = null, launchedByName = 'Batch',
    apiBaseUrl, authToken,
    onStep = () => {},
  } = input;

  if (!articleUrl) throw new Error('articleUrl requis');
  if (!targetKeyword) throw new Error('targetKeyword requis');
  if (!apiBaseUrl || !authToken) throw new Error('apiBaseUrl et authToken requis (transport HTTP interne)');

  const http = axios.create({
    baseURL: apiBaseUrl,
    headers: { Authorization: `Bearer ${authToken}` },
    timeout: 30000,
  });

  // Skills/knowledge sont chargés UNE FOIS par l'appelant du batch (identiques
  // pour tous les articles du lot) ; en Phase 1 (vérification manuelle), on
  // les charge ici directement — même endpoint que le bootstrap Redux de l'UI.
  //
  // /skills et /knowledge n'existent QUE sous /data (data-api.js) -- jamais à
  // la racine /api. Sans le préfixe, la requête tombait sur le catch-all SPA
  // de proxy.js qui renvoie du HTML (200, donc jamais rejeté), et ce HTML
  // (une chaîne, tronquée par `?? []` seulement si null/undefined -- pas si
  // "juste truthy") finissait tel quel dans getBrainSkills() :
  // `(skills || []).filter is not a function`. Constaté sur 3/3 articles
  // réels le 30 août 2026, jamais vu avant faute d'avoir déjà atteint ce
  // point du pipeline en prod (les deux pannes précédentes bloquaient plus
  // tôt). La vérification `Array.isArray` fait échouer fort toute nouvelle
  // dérive de ces routes, plutôt que de continuer sans skills en silence.
  const fetchDataArray = async (path) => {
    const { data } = await http.get(path);
    if (!Array.isArray(data)) {
      throw new Error(`GET ${path} n'a pas renvoyé un tableau (reçu ${typeof data}) -- route API cassée ou déplacée`);
    }
    return data;
  };
  const skills = skillsInput ?? (await fetchDataArray('/data/skills'));
  const knowledge = knowledgeInput ?? (await fetchDataArray('/data/knowledge'));

  // ── Étape 0 — récupération du contenu, MÊME endpoint que l'UI (Articles.jsx)
  onStep('Récupération du contenu de l\'article...');
  const scraped = (await http.post('/scrape', { url: articleUrl })).data;
  const scrapedHtml = scraped?.content || scraped?.html || '';
  if (!scrapedHtml.trim()) throw new Error('Contenu de l\'article vide après scraping');
  const title = scraped?.title || '';

  // Même point de nettoyage que le flux interactif (Articles.jsx, "point de
  // passage unique" des trois sources) -- jamais appliqué ici jusqu'à
  // présent : les boutons de suivi Google captés par le scraping (Discover,
  // "Ajouter comme source préférée") passaient tels quels dans sourceHtml
  // pour tout article de LOT, le verrou liens externes forçant alors l'IA à
  // les reproduire dans la prose ou à rejeter la génération. `document` est
  // simulé par pipelineCli.js avant ce require -- la fonction fonctionne
  // hors navigateur exactement comme sous Jest.
  const ingestion = stripNonEditorialLinks(scrapedHtml);
  if (ingestion.removed.length) {
    onStep(`${ingestion.removed.length} bouton(s) de suivi Google retiré(s) du contenu scrapé`);
  }
  const contentHtml = ingestion.html;

  let tokenUsage = { input: 0, output: 0, costUsd: 0, calls: [] };
  let articleId = null;

  // ── Étape 1 — Audit QAT ──────────────────────────────────────────────────
  onStep('Audit QAT...');
  const auditRes = await runQatAudit({
    content: contentHtml,
    contentHtml,
    skills, knowledge, articleUrl, targetKeyword,
    wpSites, existingWpData,
    modelPricing, modelSelections,
    onStep,
  });
  if (!auditRes.audit) {
    throw new Error(`Audit illisible ou échoué${auditRes.apiError ? ` — ${auditRes.apiError}` : ''}`);
  }
  const auditJson = auditRes.audit;
  tokenUsage = mergeTokenUsage(tokenUsage, auditRes.tokenUsage);

  // ── Défauts déterministes (remplacent les clics manuels de la phase 2) ──
  const scope = scopeProposedByAudit(auditJson);
  const depth = scope === SCOPE_SIMPLE ? 'ciblee' : 'refonte';
  const auditSelection = defaultAuditSelection(scope);
  const internalLinks = cleanLinkRows(auditSuggestedLinkRows(auditJson), articleUrl);
  const finalInstruction = instruction || buildGenerationPrompt({
    audit: auditJson, scope, targetKeyword, selection: auditSelection,
  });

  // ── Étape 2 — Génération (inclut la passe de gras, voir agentQat.js) ─────
  onStep('Génération de l\'article...');
  const genRes = await runQatRewrite({
    content: contentHtml, contentHtml,
    audit: auditJson,
    skills, knowledge, articleUrl, targetKeyword,
    internalLinks, auditSelection, depth,
    instruction: finalInstruction,
    modelPricing, modelSelections,
    onStep, onReplace: onStep,
  });
  const rawHtml = genRes.article?.html || '';
  if (!rawHtml.trim()) throw new Error('Article vide renvoyé par la génération');
  tokenUsage = mergeTokenUsage(tokenUsage, genRes.tokenUsage);

  // ── Persistance — MÊME appel que ArticleResult.jsx (saveArticle) ────────
  // /articles n'existe QUE sous /data (data-api.js) -- jamais à la racine
  // /api, exactement comme /skills et /knowledge plus haut (même bug, même
  // symptôme : la requête tombait sur le catch-all SPA de proxy.js, qui
  // répond 200 avec du HTML, donc jamais rejetée par axios -- `saved.id`
  // valait `undefined` en silence. Conséquence réelle : AUCUN article batch
  // n'était jamais enregistré, malgré un statut "Fait" -- rien à relire.
  // Repéré le 31 août 2026 en cherchant pourquoi aucun lien de relecture
  // n'était possible depuis /lots ni depuis l'email de fin de lot.
  onStep('Enregistrement de l\'article...');
  const saved = (await http.post('/data/articles', {
    title: title || genRes.article.titreSeo || targetKeyword,
    url: articleUrl,
    updatedContent: rawHtml,
    assigneeId: launchedByUid,
    lastModifiedBy: launchedByName,
    majMode: 'qat',
    auditJson,
    // Même transformation que ArticleResult.jsx (`qatArticle.html` est retiré :
    // c'est déjà `updatedContent`) -- SANS ce champ, derivePhaseStatus()
    // (src/constants/majPhases.js) ne peut pas savoir que la génération a eu
    // lieu : elle ne marque la phase 2 "terminée" que sur qatArticle ou des
    // diffs, jamais sur updatedContent seul (qui porte aussi l'article
    // D'ORIGINE juste après l'audit). Constaté le 31 août 2026 : un article
    // batch réellement généré rouvrait sur "Audit terminé, Génération à
    // faire", alors que le contenu réécrit était bien là.
    qatArticle: (({ html: _html, ...rest }) => rest)(genRes.article),
    qatBrief: { targetKeyword, internalLinks, auditSelection },
    majDepth: depth,
  })).data;
  articleId = saved?.id;
  // Même garde-fou que fetchDataArray() ci-dessus (forme de réponse) : sans
  // lui, un id manquant continuait la pipeline en silence jusqu'à "Fait" --
  // un article payé, généré, jamais réellement enregistré ni relisable.
  if (!articleId) {
    throw new Error(`POST /data/articles n'a pas renvoyé d'id (reçu ${JSON.stringify(saved).slice(0, 200)}) -- article non enregistré`);
  }

  await dispatchPhaseStat(http, {
    articleId, title,
    tokenUsage: auditRes.tokenUsage, pass: 1, modelPricing,
  });
  await dispatchPhaseStat(http, {
    articleId, title,
    tokenUsage: genRes.tokenUsage, pass: 2, modelPricing,
  });

  // ── Étape 3 — Obsolescence (même moteur que la "passe 2" historique) ────
  onStep('Vérification de l\'obsolescence...');
  let currentHtml = rawHtml;
  const obsoRes = await runReviewAgent({
    content: currentHtml,
    firstPassUpdates: [],
    firstPassAnalysis: '',
    skills, knowledge,
    modelPricing, modelSelections,
    depth,
    instruction: DEFAULT_VERIFICATION_TEMPLATE,
    onStep,
  });
  tokenUsage = mergeTokenUsage(tokenUsage, obsoRes.tokenUsage);
  // Même forme que le dispatch normal (ArticleResult.jsx, ligne ~2068) --
  // sans elle, derivePhaseStatus() ne marque jamais la phase 3 "terminée"
  // (aUneVerif ne regarde que rec.obsolescenceReport), et les suggestions
  // payées par cette passe étaient jusqu'ici invisibles au relecteur : nulle
  // part enregistrées, malgré le coût réel engagé pour les produire.
  // POST /data/articles avec un id existant fait un MERGE (voir data-api.js),
  // jamais un écrasement des autres champs déjà posés au premier appel.
  await http.post('/data/articles', {
    id: articleId,
    obsolescenceReport: {
      suggestions: Array.isArray(obsoRes.updates) ? obsoRes.updates : [],
      texteVerifie: currentHtml,
      at: Date.now(),
    },
  });
  await dispatchPhaseStat(http, {
    articleId, title,
    tokenUsage: obsoRes.tokenUsage, pass: 3, modelPricing,
  });

  // ── Étape 4 — Style (Relecture) ──────────────────────────────────────────
  onStep('Correction de style...');
  const { findings } = detectStylePatterns(currentHtml);
  let styleRes = { tokenUsage: null };
  if (findings.length) {
    styleRes = await runStyleFixAgent({
      findings, modelSelections, modelPricing, onStep,
    });
    if (styleRes.tokenUsage) tokenUsage = mergeTokenUsage(tokenUsage, styleRes.tokenUsage);
  }
  await dispatchPhaseStat(http, {
    articleId, title,
    tokenUsage: styleRes.tokenUsage, pass: 4, modelPricing,
  });

  // ── Mise à jour finale du HTML (verrou identique à updateArticleHtml) ───
  if (currentHtml !== rawHtml) {
    await http.put(`/data/articles/${encodeURIComponent(articleId)}/html`, {
      updatedContent: currentHtml,
      editorMeta: launchedByName,
    });
  }

  onStep('Terminé — en attente de relecture humaine.');
  return {
    articleId,
    articleUrl,
    scope, depth,
    tokenUsage,
    obsolescenceSuggestions: Array.isArray(obsoRes?.updates) ? obsoRes.updates : [],
    styleFindingsCount: findings.length,
    stylePropositionsCount: (styleRes.proposals || []).length,
  };
};

module.exports = { runArticlePipeline, mergeTokenUsage };
