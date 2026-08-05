// ── Mode « Audit QAT + Refonte » ──────────────────────────────────────────────
// Second flux de mise à jour, sélectionnable au lancement (voir
// `src/constants/majMode.js`). Il NE remplace PAS le flux historique de
// `agent.js` : celui-ci reste intact et reste le mode par défaut.
//
// Étape A — audit : sortie JSON stricte (framework QAT), 2 recherches web max.
// Étape B — refonte : l'IA renvoie l'ARTICLE ENTIER (titre SEO, méta, H1, chapô,
//           intro, TL;DR, H2, FAQ, tableau), sécurisé par `sanitizeFullArticle`.
//
// Les deux étapes sont pilotées par le skill cerveau (SKILL.md) actif du menu
// SKILLS IA : la méthode et les gabarits vivent dans le skill, jamais ici.

import { searchWeb } from './search';
import { sanitizeFullArticle, listExternalLinks } from '../utils/diff';
import { DEFAULT_DEPTH } from '../constants/majDepth';
import {
  DEFAULT_ARTICLE_TYPE, DEFAULT_SEO_PLUGIN, DEFAULT_TARGET_WORDS,
  ARTICLE_TYPES, SEO_PLUGINS, cleanLinkRows,
} from '../constants/majMode';
import {
  callWpTool, selectModel, getDateContext, calcCost, callClaudeWithProgress,
  callClaude, dedupeByUrl, makeTokenTracker, buildSkillsBlock, analyzeLinks,
  getBrainSkills, buildKnowledgeBlock, stripHtml, scrapeSource,
} from './agent';

// Le skill impose 2 recherches web au maximum, pour maîtriser les coûts.
const MAX_QAT_SEARCHES = 2;
const MAX_SOURCES_INJECTED = 6;

/**
 * Extrait un objet JSON d'une réponse Claude, même entourée de texte ou de
 * backticks. Le skill impose « JSON uniquement », mais on ne fait jamais
 * confiance au format : une génération à 12k tokens qui casse sur une virgule
 * ne doit pas perdre tout l'audit.
 */
export const parseJsonLoose = (raw = '') => {
  const text = String(raw || '').trim();
  if (!text) return null;
  const fenced = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  const candidates = [fenced, text];
  for (const c of candidates) {
    try { return JSON.parse(c); } catch { /* on tente l'extraction */ }
    const start = c.indexOf('{');
    const end = c.lastIndexOf('}');
    if (start !== -1 && end > start) {
      const slice = c.slice(start, end + 1);
      try { return JSON.parse(slice); } catch { /* candidat suivant */ }
    }
  }
  return null;
};

/** Bloc « méthode du skill » : corps + ressources du (ou des) skill cerveau. */
const buildSkillMethodBlock = (brainSkills, { resources = true } = {}) => {
  const bodies = brainSkills.map(s => `### ${s.name}\n${s.body}`).join('\n\n───\n\n');
  if (!resources) return bodies;
  const res = brainSkills.flatMap(s => Array.isArray(s.resources) ? s.resources : []);
  const resBlock = res.length
    ? `\n\n## ═══ RESSOURCES DU SKILL (gabarits / références) ═══\n` +
      res.map(r => `### ${r.name}\n${r.content || ''}`).join('\n\n───\n\n')
    : '';
  return bodies + resBlock;
};

/** Contexte de lancement saisi par le rédacteur — prioritaire sur les défauts. */
const buildBriefBlock = ({
  targetKeyword = '', articleType = DEFAULT_ARTICLE_TYPE, seoPlugin = DEFAULT_SEO_PLUGIN,
  targetWords = DEFAULT_TARGET_WORDS, internalLinks = [], articleUrl = '',
}) => {
  const links = cleanLinkRows(internalLinks);
  const linkBlock = links.length
    ? links.map((l, i) => `${i + 1}. Ancre : « ${l.anchor} » → URL : ${l.url}`).join('\n')
    : 'Aucune paire ancre + URL fournie : n\'ajoute AUCUN lien.';
  return `## ═══ BRIEF DU RÉDACTEUR (prioritaire sur les valeurs par défaut des ressources) ═══
- Mot-clé cible (à respecter À LA LETTRE PRÈS) : « ${targetKeyword} »
- Type d'article : ${ARTICLE_TYPES[articleType]?.label || articleType} — ${ARTICLE_TYPES[articleType]?.description || ''}
- Plugin SEO du site : ${SEO_PLUGINS[seoPlugin]?.label || seoPlugin} (emploie sa terminologie exacte dans pre_pub_checklist)
- Longueur cible : ${targetWords} mots
- URL de l'article : ${articleUrl || 'non fournie'}

### Liens INTERNES à placer (les seuls liens que tu ajoutes)
${linkBlock}`;
};

// ── Étape A — Audit QAT (sortie JSON) ─────────────────────────────────────────

const buildAuditSystem = (brainSkills, skills, knowledge, brief) => {
  const { fr, cutoffIso } = getDateContext();
  return `Nous sommes le ${fr}. Tu es l'expert décrit par le skill ci-dessous.

Tu exécutes l'**ÉTAPE A — AUDIT** de ce skill, et RIEN d'autre : tu n'écris pas
l'article, tu produis l'audit. Applique sa méthode et son schéma de sortie à la
lettre : la réponse est un JSON valide, complet et bien fermé, sans texte ni
backticks avant ou après.

Toute donnée antérieure au ${cutoffIso} (seuil 6 mois) est suspecte et doit être
vérifiée ou signalée dans freshness_checks.

Renseigne IMPÉRATIVEMENT, en plus du reste : « ampleur » (la décision la plus
structurante), « keyword_repositioning » (ou null) et « a_supprimer » (ou []).

${brief}

## ═══ SKILL PRINCIPAL — MÉTHODE & CRITÈRES (à appliquer intégralement) ═══
${buildSkillMethodBlock(brainSkills)}${buildSkillsBlock(
    skills,
    'Règles éditées par l\'équipe dans le menu SKILLS IA. Vérifie chacune d\'elles et signale tout manquement dans priority_actions.',
    'RÈGLES D\'ÉQUIPE (menu SKILLS IA) — À AUDITER AUSSI'
  )}${buildKnowledgeBlock(knowledge, '', 'BASE DE CONNAISSANCES — À VÉRIFIER AUSSI')}`;
};

/**
 * Génère au maximum 2 requêtes de vérification de fraîcheur, puis les exécute.
 * Le skill limite volontairement la recherche à 2 appels.
 */
const gatherFreshnessSources = async (content, targetKeyword, onStep, trackCall) => {
  const { year } = getDateContext();
  let queries = [];
  try {
    const { text, usage } = await callClaude(null, {
      system: 'Tu génères des requêtes de recherche web courtes et ciblées. Réponds uniquement par un tableau JSON de chaînes.',
      max_tokens: 300,
      model: selectModel('query_extraction'),
      messages: [{
        role: 'user',
        content: `Article à vérifier (extrait) :\n${stripHtml(content).slice(0, 1500)}\n\nMot-clé cible : ${targetKeyword}\n\nDonne AU MAXIMUM ${MAX_QAT_SEARCHES} requêtes : la première sur les dernières actualités du sujet, la seconde sur le fait le plus susceptible d'être obsolète (prix, montant d'aide, norme, date). Inclus l'année ${year}. Format : ["requête 1", "requête 2"]`,
      }],
    });
    trackCall(usage);
    const parsed = parseJsonLoose(`{"q":${text}}`) || {};
    queries = Array.isArray(parsed.q) ? parsed.q.filter(q => typeof q === 'string') : [];
  } catch (e) {
    console.warn('[qat] extraction requêtes:', e.message);
  }
  queries = queries.slice(0, MAX_QAT_SEARCHES);
  if (!queries.length) queries = [`${targetKeyword} ${year}`].slice(0, MAX_QAT_SEARCHES);

  onStep(`Vérification de fraîcheur — ${queries.length} recherche(s) web...`);
  const batches = await Promise.allSettled(queries.map(q => searchWeb(q)));
  let sources = dedupeByUrl(
    batches.flatMap(b => (b.status === 'fulfilled' ? (b.value || []) : []))
  ).slice(0, MAX_SOURCES_INJECTED);

  // Sources sans contenu → scraping rapide (mêmes limites que le flux historique)
  const toScrape = sources.filter(s => !s.content && s.url).slice(0, 3);
  if (toScrape.length) {
    const scraped = await Promise.allSettled(toScrape.map(s => scrapeSource(s.url)));
    scraped.forEach((r, i) => {
      if (r.status === 'fulfilled' && r.value) toScrape[i].content = r.value;
    });
  }
  return { sources, queries };
};

const formatSourcesForPrompt = (sources) =>
  sources.length
    ? sources.map((s, i) => `### SOURCE ${i + 1} — ${s.title || 'sans titre'}\nURL : ${s.url}\n${(s.content || s.description || '').slice(0, 2000)}`).join('\n\n')
    : 'Aucune source web disponible : marque les vérifications de fraîcheur comme non vérifiables plutôt que d\'inventer.';

/**
 * Étape A — audit QAT. Retourne l'objet JSON de l'audit (ou null si illisible).
 */
export const runQatAudit = async ({
  content,
  contentHtml = '',
  skills = [],
  knowledge = [],
  articleUrl = '',
  targetKeyword = '',
  articleType = DEFAULT_ARTICLE_TYPE,
  seoPlugin = DEFAULT_SEO_PLUGIN,
  targetWords = DEFAULT_TARGET_WORDS,
  internalLinks = [],
  wpSites = [],
  existingWpData = null,
  modelPricing = null,
  onStep = () => {},
  onReplace = () => {},
  onProgress = () => {},
}) => {
  const { acc: tokenAcc, track: trackCall } = makeTokenTracker();
  const brainSkills = getBrainSkills(skills);
  if (!brainSkills.length) {
    throw new Error('Le mode « Audit QAT + Refonte » exige un skill cerveau (SKILL.md) actif dans le menu SKILLS IA.');
  }

  onStep('Audit QAT — préparation...');
  onProgress(6);

  // ── Phase 0 : données WordPress MCP (identique au flux historique) ──────────
  let wpData = existingWpData || null;
  if (!wpData && articleUrl && wpSites?.length) {
    try {
      const host = new URL(articleUrl).hostname.replace(/^www\./, '');
      const site = wpSites.find(s => {
        try { return new URL(s.url).hostname.replace(/^www\./, '') === host; } catch { return false; }
      });
      if (site) {
        onStep('Connexion WordPress MCP — lecture de l\'article...');
        const r = await callWpTool('wp_get_post', { site_id: site.id, post_url: articleUrl }, [site]);
        if (r?.post_id) {
          wpData = {
            siteId: site.id, siteName: site.name, postId: r.post_id,
            postType: r.post_type || 'posts',
            featuredMediaId: r.featured_media_id || null,
            featuredMediaUrl: r.featured_media_url || null,
            postLink: r.link || null,
          };
          onStep(`WordPress MCP OK — article ID ${wpData.postId}`);
        }
      }
    } catch (e) {
      console.warn('[qat] MCP wp_get_post:', e.message);
    }
  }

  // ── Recherche de fraîcheur (2 appels max) ──────────────────────────────────
  onProgress(15);
  const { sources, queries } = await gatherFreshnessSources(content, targetKeyword, onStep, trackCall);

  // ── Chiffres comptés côté code (fiables) ───────────────────────────────────
  const linkStats = analyzeLinks(contentHtml || content, articleUrl);
  const rawText = stripHtml(contentHtml || content || '').trim();
  const wordCount = rawText ? rawText.split(/\s+/).length : 0;

  const brief = buildBriefBlock({ targetKeyword, articleType, seoPlugin, targetWords, internalLinks, articleUrl });
  const system = buildAuditSystem(brainSkills, skills, knowledge, brief);
  const user = `## ARTICLE À AUDITER (HTML)
${content}

## DONNÉES FACTUELLES (comptées automatiquement — fiables, reprends-les telles quelles)
- Liens INTERNES (même site) : ${linkStats.internal}
- Liens EXTERNES (autres sites) : ${linkStats.external}
- Longueur actuelle : ~${wordCount} mots (cible du brief : ${targetWords} mots)

## SOURCES WEB (vérification de fraîcheur — ${queries.length} recherche(s))
${formatSourcesForPrompt(sources)}

Produis maintenant le JSON d'audit complet, conforme au schéma du skill. Rien d'autre que le JSON.`;

  onProgress(25);
  let audit = null;
  let rawAudit = '';
  for (let attempt = 1; attempt <= 3 && !audit; attempt++) {
    try {
      const { text, usage } = await callClaudeWithProgress(
        null,
        { system, max_tokens: 12000, model: selectModel('update_generation'), messages: [{ role: 'user', content: user }] },
        onStep,
        onReplace,
        attempt === 1 ? 'Audit QAT en cours' : `Audit QAT — nouvel essai (${attempt}/3)`
      );
      trackCall(usage);
      rawAudit = (text || '').trim();
      audit = parseJsonLoose(rawAudit);
      if (!audit) onStep(`⚠️ Audit — JSON illisible, nouvel essai (${attempt}/3)...`);
    } catch (e) {
      console.warn(`[qat audit] essai ${attempt}/3:`, e.message);
      if (attempt < 3) await new Promise(r => setTimeout(r, 1500 * attempt));
      else onStep(`⚠️ Audit indisponible après 3 essais (${e.message})`);
    }
  }

  onProgress(40);
  return {
    audit,
    auditRaw: rawAudit,
    parseFailed: !audit && !!rawAudit,
    wpData,
    sources,
    tokenUsage: { ...tokenAcc, costUsd: calcCost(tokenAcc.calls, modelPricing) },
  };
};

// ── Étape B — Refonte (article entier) ────────────────────────────────────────

/**
 * Résume l'audit pour le prompt de refonte : on n'injecte QUE ce qui pilote la
 * réécriture, pas les scores ni les justifications (économie de tokens, et le
 * modèle n'a pas à recopier un rapport dans l'article).
 */
const summarizeAuditForRewrite = (audit) => {
  if (!audit) return 'Audit indisponible : traite l\'article comme une refonte totale prudente.';
  const j = (v) => JSON.stringify(v ?? null);
  return `- ampleur : ${j(audit.ampleur)}
- keyword_repositioning : ${j(audit.keyword_repositioning)}
- a_supprimer : ${j(audit.a_supprimer)}
- priority_actions : ${j(audit.priority_actions)}
- recent_context : ${j(audit.recent_context)}
- seo_geo_gaps : ${j(audit.seo_geo_gaps)}
- eeat_recommendations : ${j(audit.eeat_recommendations)}
- strategic_recommendation : ${j(audit.strategic_recommendation)}
- tldr proposé par l'audit : ${j(audit.tldr)}
- sources_check (affirmations à sourcer ou à retirer) : ${j(audit.sources_check)}`;
};

/**
 * Profondeur effective. « auto » (défaut du mode QAT) laisse la décision à
 * l'audit — c'est l'arbitrage retenu : l'audit propose, le rédacteur tranche.
 * Un choix explicite du rédacteur PRIME toujours sur l'audit.
 */
export const resolveQatDepth = (depth, audit) => {
  // Trois ampleurs : le fond est en cause (refonte), le plan seul est en cause
  // (restructuration : on garde la matière et on refond la hiérarchie des H2),
  // ou tout tient (MAJ ciblée). Défaut prudent en l'absence d'audit : refonte.
  const decision = audit?.ampleur?.decision;
  const fromAudit = decision === 'maj_ciblee' ? 'ciblee'
    : decision === 'restructuration' ? 'restructuration'
    : 'refonte';
  if (!depth || depth === 'auto') return { depth: fromAudit, source: 'audit', overridden: false };
  // Le sélecteur du rédacteur ne propose que Ciblée et Refonte : la
  // restructuration reste une décision de l'audit (mode « Auto »).
  const chosen = depth === 'legere' || depth === 'ciblee' ? 'ciblee'
    : depth === 'restructuration' ? 'restructuration'
    : 'refonte';
  return { depth: chosen, source: 'redacteur', overridden: chosen !== fromAudit };
};

export const runQatRewrite = async ({
  content,
  contentHtml = '',
  audit = null,
  skills = [],
  knowledge = [],
  articleUrl = '',
  targetKeyword = '',
  articleType = DEFAULT_ARTICLE_TYPE,
  seoPlugin = DEFAULT_SEO_PLUGIN,
  targetWords = DEFAULT_TARGET_WORDS,
  internalLinks = [],
  sources = [],
  depth = 'auto',
  instruction = '',
  modelPricing = null,
  onStep = () => {},
  onReplace = () => {},
  onProgress = () => {},
}) => {
  const { acc: tokenAcc, track: trackCall } = makeTokenTracker();
  const brainSkills = getBrainSkills(skills);
  if (!brainSkills.length) {
    throw new Error('Le mode « Audit QAT + Refonte » exige un skill cerveau (SKILL.md) actif dans le menu SKILLS IA.');
  }
  const { fr } = getDateContext();
  const resolved = resolveQatDepth(depth, audit);
  const brief = buildBriefBlock({ targetKeyword, articleType, seoPlugin, targetWords, internalLinks, articleUrl });

  const depthBlock = resolved.depth === 'restructuration'
    ? `## ═══ AMPLEUR RETENUE : RESTRUCTURATION ═══
Le FOND de l'article tient : ne réécris RIEN sur le fond. Tu refais le PLAN.
Conserve chaque information, chiffre, norme et exemple de l'ancien texte — tu
peux les reformuler au style, jamais en changer le sens ni remplacer une donnée
exacte. Fusionne les H2 courts et redondants en 6 à 8 sections denses formulées
comme de vraies questions, réordonne du général au spécifique, fais descendre les
sujets secondaires en H3, et ajoute ce qui manque (TL;DR, FAQ, tableau, sections
de priorité haute). Le nombre de H2 peut BAISSER : c'est l'objectif. Tu renvoies
l'article ENTIER dans article_html.`
    : resolved.depth === 'ciblee'
    ? `## ═══ AMPLEUR RETENUE : MAJ CIBLÉE ═══
Tu ne réécris PAS tout. Conserve la structure et les sections qui fonctionnent, à
leur texte d'origine. Limite-toi à : corriger les données fausses ou obsolètes,
retirer ce que liste a_supprimer, ajouter le TL;DR, la FAQ, le tableau et les
sections manquantes signalées en priorité haute. Tu renvoies malgré tout
l'article ENTIER dans article_html (parties conservées incluses, à l'identique).`
    : `## ═══ AMPLEUR RETENUE : REFONTE TOTALE ═══
Réécris l'intégralité de l'article, en intégrant toutes les informations encore
valables de l'ancien texte. Aucune tournure générique conservée.`;

  const overrideNote = resolved.overridden
    ? `\n⚠️ Le rédacteur a IMPOSÉ cette ampleur, différente de celle recommandée par l'audit (${audit?.ampleur?.decision || 'non renseignée'}). Respecte le choix du rédacteur.`
    : '';

  const system = `Nous sommes le ${fr}. Tu es l'experte décrite par le skill ci-dessous.

Tu exécutes l'**ÉTAPE B — RÉFECTION** de ce skill. Applique intégralement la
ressource « refonte-integrale.md » et les autres ressources (gabarits de
longueur, TL;DR + FAQ, maillage et ancres).

Ta réponse est UN SEUL objet JSON valide, complet et bien fermé, sans texte ni
backticks avant ou après, au schéma défini par la ressource de refonte
(titre_seo, meta_description, h1, chapo_html, article_html, word_count,
ampleur_appliquee, mot_cle_retenu, elements_supprimes, mots_cles_secondaires,
ancres_placees, notes_redaction).

${depthBlock}${overrideNote}

## ═══ VERROU ABSOLU — LIENS EXTERNES (prioritaire sur toute autre consigne) ═══
Tu n'ajoutes AUCUN lien externe et tu n'en supprimes AUCUN. Chaque lien externe
présent dans l'article d'origine doit réapparaître À L'IDENTIQUE dans
article_html : même href, même texte d'ancre. Un lien externe manquant fait
REJETER toute la génération par le contrôle technique. Les seuls liens que tu
ajoutes sont les liens INTERNES du brief.

${brief}

## ═══ SKILL PRINCIPAL — MÉTHODE & GABARITS (à appliquer intégralement) ═══
${buildSkillMethodBlock(brainSkills)}${buildSkillsBlock(
    skills,
    'Règles éditées par l\'équipe dans le menu SKILLS IA — complémentaires à la méthode du skill principal.\nTu DOIS les respecter dans CHAQUE phrase écrite ou réécrite.',
    'RÈGLES D\'ÉQUIPE (menu SKILLS IA) — OBLIGATOIRES'
  )}${buildKnowledgeBlock(knowledge)}${instruction?.trim() ? `\n\n## ═══ INSTRUCTION SPÉCIFIQUE DE L'ÉQUIPE — PRIORITÉ HAUTE ═══\n${instruction.trim().slice(0, 1500)}\nElle prime sur les règles générales, sauf le verrou liens externes.` : ''}`;

  // Liens externes de l'article d'origine : listés explicitement dans le prompt
  // pour ÉVITER le rejet, plutôt que de le corriger par un nouvel essai (chaque
  // essai coûte plusieurs minutes sur un article de 2 500 mots).
  const externalLinks = listExternalLinks(contentHtml || content, articleUrl);
  const externalBlock = externalLinks.length
    ? `## ═══ LIENS EXTERNES À REPRODUIRE À L'IDENTIQUE (${externalLinks.length}) ═══
Chacun de ces liens DOIT figurer dans article_html avec le même href et le même
texte d'ancre. Il en manque un seul et toute la génération est rejetée.
${externalLinks.map((l, i) => `${i + 1}. <a href="${l.href}">${l.text}</a>`).join('\n')}`
    : '## ═══ LIENS EXTERNES ═══\nL\'article d\'origine n\'en contient aucun : n\'en ajoute aucun.';

  const user = `## ARTICLE D'ORIGINE (HTML — à réécrire)
${content}

${externalBlock}

## CONCLUSIONS DE L'AUDIT (elles pilotent la réécriture)
${summarizeAuditForRewrite(audit)}

## SOURCES WEB DISPONIBLES (pour les données récentes — ne cite jamais une source non listée ici)
${formatSourcesForPrompt(sources)}

Produis maintenant le JSON de l'article réécrit. Rien d'autre que le JSON.`;

  const AMPLEUR_LABEL = { ciblee: 'MAJ ciblée', restructuration: 'restructuration du plan', refonte: 'refonte totale' };
  onStep(`Réécriture de l'article (${AMPLEUR_LABEL[resolved.depth] || 'refonte totale'})...`);
  onProgress(55);

  let article = null;
  let raw = '';
  let sanitized = null;
  // Message utilisateur de l'essai courant : enrichi à chaque rejet du détail de
  // ce qui a manqué. Relancer un prompt IDENTIQUE reproduirait la même erreur.
  let currentUser = user;

  for (let attempt = 1; attempt <= 3 && !sanitized; attempt++) {
    try {
      const { text, usage } = await callClaudeWithProgress(
        null,
        { system, max_tokens: 32000, model: selectModel('update_generation'), messages: [{ role: 'user', content: currentUser }] },
        onStep,
        onReplace,
        attempt === 1 ? 'Rédaction en cours' : `Rédaction — nouvel essai (${attempt}/3)`
      );
      trackCall(usage);
      raw = (text || '').trim();
      article = parseJsonLoose(raw);
      if (!article?.article_html) {
        onStep(`⚠️ Réponse illisible ou article vide — nouvel essai (${attempt}/3)...`);
        currentUser = `${user}

## ═══ REPRISE — L'ESSAI PRÉCÉDENT A ÉCHOUÉ ═══
Ta réponse précédente n'était pas un JSON exploitable, ou son champ article_html
était vide. Réponds UNIQUEMENT par l'objet JSON du schéma, sans texte ni
backticks avant ou après, et vérifie que article_html contient bien l'article
complet.`;
        article = null;
        continue;
      }
      // Le chapô vit dans son propre champ côté skill, mais WordPress attend un
      // corps unique : on le replace en tête AVANT le contrôle, pour qu'il passe
      // lui aussi par le verrou liens externes et la sécurité structure.
      const chapo = String(article.chapo_html || '').trim();
      const composed = chapo ? `${chapo}\n${article.article_html}` : article.article_html;

      // ── Verrou liens externes + sécurité structure (règle 8, non négociable) ──
      const check = sanitizeFullArticle(contentHtml || content, composed, articleUrl);
      if (check.missing.length) {
        onStep(`⚠️ ${check.missing.length} lien(s) externe(s) d'origine perdu(s) — génération rejetée, nouvel essai (${attempt}/3)...`);
        if (attempt === 3) {
          throw new Error(`Verrou liens externes : ${check.missing.length} lien(s) externe(s) de l'article d'origine absent(s) de la réécriture après 3 essais (${check.missing.join(', ')}).`);
        }
        // Reprise INSTRUITE : on nomme les liens perdus et leur ancre d'origine.
        // Sans ce retour, l'essai suivant repartait du même prompt et échouait
        // de la même façon — trois fois 8 minutes pour rien.
        const lost = check.missing.map((href) => {
          const src = externalLinks.find(l => l.href === href);
          return `- <a href="${href}">${src?.text || 'ancre d\'origine'}</a>`;
        }).join('\n');
        currentUser = `${user}

## ═══ REPRISE — VERROU LIENS EXTERNES DÉCLENCHÉ ═══
Ta réécriture précédente a été REJETÉE : elle avait perdu ${check.missing.length} lien(s)
externe(s) de l'article d'origine. Reprends la rédaction et place OBLIGATOIREMENT
ces liens, avec exactement le même href et le même texte d'ancre, dans une phrase
naturelle du corps de l'article :
${lost}

Ne les mets ni dans un titre, ni dans le TL;DR, ni dans un tableau, ni dans la FAQ.
N'ajoute aucun AUTRE lien externe.`;
        article = null;
        continue;
      }
      sanitized = check;
    } catch (e) {
      console.warn(`[qat rewrite] essai ${attempt}/3:`, e.message);
      if (attempt >= 3) throw e;
      await new Promise(r => setTimeout(r, 1500 * attempt));
    }
  }

  onProgress(90);
  const finalHtml = sanitized.html;
  const words = stripHtml(finalHtml).trim().split(/\s+/).filter(Boolean).length;

  return {
    article: {
      titreSeo:        String(article.titre_seo || '').trim(),
      metaDescription: String(article.meta_description || '').trim(),
      h1:              String(article.h1 || '').trim(),
      chapoHtml:       String(article.chapo_html || '').trim(),
      html:            finalHtml,
      wordCount:       words,
      ampleurAppliquee: resolved.depth,
      ampleurSource:   resolved.source,
      ampleurOverridden: resolved.overridden,
      motCleRetenu:    String(article.mot_cle_retenu || targetKeyword || '').trim(),
      elementsSupprimes: Array.isArray(article.elements_supprimes) ? article.elements_supprimes : [],
      motsClesSecondaires: Array.isArray(article.mots_cles_secondaires) ? article.mots_cles_secondaires : [],
      ancresPlacees:   Array.isArray(article.ancres_placees) ? article.ancres_placees : [],
      notesRedaction:  String(article.notes_redaction || '').trim(),
      strippedExternalLinks: sanitized.stripped,
    },
    articleRaw: raw,
    tokenUsage: { ...tokenAcc, costUsd: calcCost(tokenAcc.calls, modelPricing) },
  };
};

// ── Orchestrateur : audit puis refonte ────────────────────────────────────────

/**
 * Enchaîne les deux étapes. `depth` vaut « auto » par défaut : l'audit décide de
 * l'ampleur, et un choix explicite du rédacteur prime (item 11 — l'audit
 * propose, le rédacteur tranche).
 */
export const runQatAgent = async (opts) => {
  const auditRes = await runQatAudit(opts);
  if (!auditRes.audit) {
    // L'audit est la BASE de la refonte : sans lui, on ne réécrit pas à l'aveugle.
    throw new Error('Audit QAT illisible après 3 essais — refonte annulée pour ne pas réécrire sans diagnostic.');
  }
  const rewriteRes = await runQatRewrite({
    ...opts,
    audit: auditRes.audit,
    sources: auditRes.sources,
    existingWpData: auditRes.wpData,
  });
  const calls = [...(auditRes.tokenUsage?.calls || []), ...(rewriteRes.tokenUsage?.calls || [])];
  return {
    mode: 'qat',
    audit: auditRes.audit,
    auditRaw: auditRes.auditRaw,
    article: rewriteRes.article,
    sources: auditRes.sources,
    wpData: auditRes.wpData,
    tokenUsage: {
      input:  (auditRes.tokenUsage?.input || 0) + (rewriteRes.tokenUsage?.input || 0),
      output: (auditRes.tokenUsage?.output || 0) + (rewriteRes.tokenUsage?.output || 0),
      calls,
      costUsd: calcCost(calls, opts?.modelPricing || null),
    },
  };
};

export { DEFAULT_DEPTH };
