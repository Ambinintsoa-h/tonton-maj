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
import { sanitizeFullArticle, listExternalLinks, listInternalLinks, carryOverInternalLinks } from '../utils/diff';
import {
  weaveBriefLinks, countPlacedBriefLinks, briefLinkReportLine, promoteInlineRenvois,
  unwrapForbiddenInternalLinks,
} from '../utils/internalWeave';
import { listArticleImages, carryOverImages } from '../utils/imageCarry';
// R5 — le gras de l'article d'origine ne disparaît pas (module AUTONOME).
import { carryOverBold, constatGras, GRAS_MIN_PAR_H2, GRAS_MAX_MOTS } from '../utils/boldCarry';
import { runBoldPass } from './agentBold';
import {
  phrasesTropLongues, MOTS_MAX_PHRASE, MOTS_MAX_TITRE,
  VERBES_INTERDITS, PARTICIPES, CLICHES, META,
  suroptimisationMotCle, MAX_H2_AVEC_MOT_CLE, elisionsOrphelines,
} from '../utils/stylePatterns';
import { DEFAULT_DEPTH } from '../constants/majDepth';
import { auditAmpleurDecision } from '../constants/majPhases';
import { stripUncertaintyMarkers, uncertaintyReportLine } from '../utils/uncertaintyMarkers';
// Plafond de l'instruction — MÊME source que la saisie et le compteur
// (utils/generationPrompt.js). Trois copies, c'est trois divergences possibles.
// La coupure est déléguée pour ne pas amputer une ligne de consigne en silence.
import { couperInstruction } from '../utils/generationPrompt';
// Le filtrage de l'audit par les cases de la phase 2 vit dans UN SEUL module,
// partagé avec le textarea (utils/generationPrompt.js). Deux filtres, ce serait
// deux sélections divergentes — donc une case décochée qui part quand même.
import { filterAuditBySelection, isSelectionEmpty } from '../utils/auditSelection';
import {
  DEFAULT_ARTICLE_TYPE, DEFAULT_SEO_PLUGIN, DEFAULT_TARGET_WORDS,
  ARTICLE_TYPES, SEO_PLUGINS, cleanLinkRows,
} from '../constants/majMode';
import {
  callWpTool, selectModel, getDateContext, calcCost, callClaudeWithProgress, callClaudeStream,
  callClaude, dedupeByUrl, makeTokenTracker, buildSkillsBlock, analyzeLinks,
  getBrainSkills, buildKnowledgeBlock, stripHtml, scrapeSource,
} from './agent';

// Le skill impose 2 recherches web au maximum, pour maîtriser les coûts.
const MAX_QAT_SEARCHES = 2;
const MAX_SOURCES_INJECTED = 6;

/**
 * Plafond des liens internes SUGGÉRÉS par l'audit (`internal_linking.liens_entrants`).
 *
 * Pourquoi ici et pas dans le skill (règle habituelle : les règles rédactionnelles
 * s'éditent depuis le menu SKILLS IA) — ce n'est PAS une règle rédactionnelle mais
 * l'enveloppe technique de la réponse : au-delà, le JSON d'audit se fait tronquer
 * par `max_tokens` et devient illisible. Le plafond de 5 qui vivait dans le skill
 * a été levé le 2026-08-17 (« au moins 3 et pas de limite en nombre »), et
 * l'absence de borne a immédiatement produit des audits tronqués. Décision
 * Andrianina le même jour : 10, tenu côté code pour qu'une édition de skill ne
 * puisse pas le supprimer par inadvertance. Le plancher de 3, lui, reste la
 * demande métier — il est dit dans le même bloc de prompt.
 *
 * Sans rapport avec INTERNAL_LINK_ROWS_MAX (15) : celui-là borne ce que le
 * RÉDACTEUR peut saisir à la main, pas ce que l'IA propose.
 */
const MAX_LIENS_ENTRANTS = 10;

/**
 * PLANCHER des liens internes suggérés — décision Andrianina, 17 août 2026 :
 * « il faut en ajouter 6 nouveaux liens interne au minimum ».
 *
 * Passé de 3 à 6. C'est bien un plancher de MAILLAGE et pas seulement de
 * suggestion : les paires de l'audit pré-remplissent le brief de la phase 2
 * (`auditSuggestedLinkRows` + `mergeLinkRows`), et le forçage à 100 % de R2 place
 * ensuite TOUTES les paires validées. Suggérer 6 revient donc à en poser 6.
 *
 * Le plafond de 10 reste l'enveloppe technique (taille du JSON) ; ce plancher est
 * une exigence métier. Les deux sont dits dans le même bloc de prompt, et repris
 * dans le skill (`maillage-interne-ancres.md`).
 */
const MIN_LIENS_ENTRANTS = 6;

/**
 * CONTRAINTES RÉDACTIONNELLES TENUES EN DUR — demande explicite d'Andrianina,
 * 17 août 2026 : « il faut mettre en dur aussi ».
 *
 * Exception assumée à la règle « les règles rédactionnelles s'éditent dans SKILLS
 * IA ». Motif : ces deux-là étaient DÉJÀ écrites côté skill, mais trop molles pour
 * tenir, et le résultat se voyait dans les articles produits.
 *
 *   • 20 MOTS. Le skill disait « Majorité de phrases sous 20 mots, mais varie les
 *     rythmes » — une formulation qui autorise explicitement le dépassement. Le
 *     seuil n'existait durement QUE dans deux endroits inutiles ici : la détection
 *     APRÈS coup (`MOTS_MAX_PHRASE`, stylePatterns.js, phase 4) et le prompt de
 *     correction de style (agent.js), qui ne tourne que sur les passages déjà
 *     signalés. La GÉNÉRATION, elle, n'en portait aucune trace. On corrigeait donc
 *     à la main ce qu'on n'avait jamais demandé d'éviter.
 *   • GRAS SÉMANTIQUE. Nulle part dans le prompt de refonte.
 *
 * Le mot-clé est injecté pour que la consigne de gras soit ACTIONNABLE : « les mots
 * importants » sans dire de quoi ne guide rien.
 *
 * Ce bloc vit dans le message UTILISATEUR, jamais dans le socle système : celui-ci
 * porte `cache_control` et doit rester identique OCTET POUR OCTET entre l'audit et
 * la refonte, sinon le cache de préfixe est invalidé à chaque appel.
 */
const redactionConstraintsBlock = (targetKeyword = '') => `## ═══ CONTRAINTES RÉDACTIONNELLES — NON NÉGOCIABLES ═══

### 2. AUCUNE phrase de plus de ${MOTS_MAX_PHRASE} mots
C'est un PLAFOND, pas une moyenne. Compte les mots de chaque phrase avant de
passer à la suivante. Une phrase qui dépasse se coupe en deux — c'est toujours
possible, et le texte y gagne.

Ce n'est pas une préférence de style : les phrases longues sont le premier défaut
relevé sur les articles publiés, et elles sont corrigées à la main ensuite. Varie
les rythmes EN DESSOUS de ${MOTS_MAX_PHRASE} mots (5, 12, 18), jamais au-dessus.

### 1. PRIORITÉ HAUTE — mets en GRAS les mots importants liés au mot-clé
${targetKeyword
    ? `Mot-clé principal : « ${targetKeyword} ».`
    : 'Mot-clé principal : celui du brief ci-dessus.'}

Enveloppe dans \`<strong>\` les termes qui portent le sens pour ce mot-clé : ses
variantes, ses termes sémantiquement voisins, le vocabulaire technique du sujet,
et les données chiffrées décisives (prix, normes, délais, pourcentages).

Bornes, à respecter — un texte tout en gras ne met plus rien en avant :
- **2 à 4 passages en gras par section H2**, pas davantage ;
- un groupe de **1 à 4 mots** à la fois, JAMAIS une phrase entière ni un paragraphe ;
- **jamais** de gras dans un titre (h1-h6), ni à l'intérieur du texte d'un lien
  \`<a>\` — le lien a déjà son propre repère visuel ;
- le même terme n'est pas mis en gras à chacune de ses occurrences : la première
  fois qu'il compte, dans la section où il compte.

**REPRENDS LE GRAS DE L'ARTICLE D'ORIGINE.** Tout mot ou groupe de mots déjà
enveloppé dans \`<strong>\` ou \`<b>\` avant la réécriture doit le rester, même si
tu reformules la phrase autour. Ce balisage est un choix éditorial déjà validé :
le perdre est une régression silencieuse. Un contrôle technique le remet ensuite,
mais ne compte pas dessus — il ne sait pas replacer ce que tu as réécrit.

### 3. NE SUROPTIMISE PAS le mot-clé
${targetKeyword ? `Mot-clé : « ${targetKeyword} ».` : ''}
Sa forme exacte est obligatoire au titre SEO, au H1 et une fois dans le premier
paragraphe — et **c'est tout**. Ailleurs, tu emploies des variantes.

- **${MAX_H2_AVEC_MOT_CLE} titres H2 au MAXIMUM** peuvent contenir la forme exacte.
  Les autres H2 emploient une variante ou un angle différent. Mesuré sur un article
  réel : 8 H2 sur 9 portaient la forme exacte — un rédacteur humain ne fait jamais
  ça, et Google le voit.
- Varie avec les **voisins sémantiques**, les mots de la **même famille**, les
  **synonymes partiels** et les **termes techniques** du sujet. Sur « toiture en bac
  acier » : couverture, toit, bardage, tôle nervurée, panneau sandwich, profilé…
- Emploie **au moins 4 variantes distinctes** dans l'article.
- Une phrase ne contient jamais deux fois le mot-clé, et deux phrases voisines non
  plus.
- Le texte doit se lire comme écrit pour un lecteur, pas pour un moteur : si tu
  hésites entre répéter le mot-clé et écrire ce qu'un humain dirait, écris ce qu'un
  humain dirait.

### 4. Aucune élision orpheline
Quand tu places une ancre imposée, **adapte les mots autour**. L'ancre est
intouchable, la phrase qui l'accueille ne l'est pas : « face à l'ardoise » devient
« face à la toiture en ardoise », jamais « face à l' toiture en ardoise ». Relevé
deux fois sur un article réel — une apostrophe orpheline se voit à la lecture.

### 5. TOURNURES QUI SERONT COMPTÉES APRÈS — ne les écris pas
La relecture (phase 4) recense mécaniquement ce qui suit, et le rédacteur corrige
à la main, un point à la fois. Sur un article réel : **35 points sur 4 règles**.
Chaque occurrence évitée ici est une correction manuelle en moins.

- **Verbes vagues INTERDITS** — remplace par un verbe précis et concret :
  ${VERBES_INTERDITS.join(', ')}
- **Participe présent en tête de proposition** — conjugue le verbe (« qui permet »,
  « il évite ») plutôt que : ${PARTICIPES.join(', ')}
- **Adverbes en -ment** : aucun. Un mot plus précis, ou rien.
- **Voix passive avec agent** (« est indexée par Google ») → sujet en action.
- **Tirets cadratins et demi-cadratins** (— –) : virgule, deux points, ou deux phrases.
- **Titres de plus de ${MOTS_MAX_TITRE} mots** : raccourcis-les.
- **Une seule parenthèse par paragraphe** au maximum.
- **Clichés bannis** : ${CLICHES.map((c) => `« ${c} »`).join(', ')}
- **Méta-commentaires** — n'annonce ni l'article ni son plan :
  ${META.map((m) => `« ${m} »`).join(', ')}`;

/**
 * Extrait un objet JSON d'une réponse Claude, même entourée de texte ou de
 * backticks. Le skill impose « JSON uniquement », mais on ne fait jamais
 * confiance au format : une génération à 12k tokens qui casse sur une virgule
 * ne doit pas perdre tout l'audit.
 */
export const parseJsonLoose = (raw = '', { salvage = false } = {}) => {
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
  // Faute de syntaxe STRUCTURELLE (accolade fermante en trop) : réparable sans
  // perte, on tente toujours. Voir repairJsonStructure.
  const repaired = repairJsonStructure(fenced);
  if (repaired) return repaired;
  return salvage ? repairTruncatedJson(fenced) : null;
};

/**
 * Répare un JSON dont une accolade ou un crochet fermant EN TROP ferme
 * prématurément l'objet racine.
 *
 * Cas réellement observé en production sur un audit de 10 000 tokens (donc NON
 * tronqué) : le modèle a émis
 *     "executive_summary": "…"
 *     },                       ← ferme la racine au tiers du document
 *     "qat_assessment": { …
 * `JSON.parse` échoue, et l'extraction « du premier { au dernier } » renvoie le
 * même texte invalide. Deux tiers de l'audit étaient perdus pour une virgule
 * mal placée.
 *
 * On retire les fermetures qui ramènent la profondeur à zéro alors qu'il reste
 * du contenu derrière. Sans perte : tout le document est conservé.
 * Conservateur : ne retourne un objet que s'il porte au moins deux clés.
 */
export const repairJsonStructure = (raw = '') => {
  const from = String(raw || '').indexOf('{');
  if (from === -1) return null;
  const s = String(raw).slice(from);

  let out = '';
  let depth = 0;
  let inStr = false, esc = false, removed = 0;

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      out += c;
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; out += c; continue; }
    if (c === '{' || c === '[') { depth++; out += c; continue; }
    if (c === '}' || c === ']') {
      // Cette fermeture ramènerait la racine à zéro : est-ce la vraie fin ?
      if (depth === 1 && s.slice(i + 1).trim() !== '') {
        removed++;
        continue;                       // fermeture parasite → ignorée
      }
      depth--;
      out += c;
      continue;
    }
    out += c;
  }
  if (!removed) return null;            // rien de parasite : ce n'est pas ce cas

  // Refermer ce qui reste ouvert (le retrait a pu déséquilibrer la fin).
  while (depth > 0) { out += '}'; depth--; }

  try {
    const obj = JSON.parse(out);
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
    if (Object.keys(obj).length < 2) return null;
    console.warn(`[qat] JSON réparé — ${removed} fermeture(s) parasite(s) retirée(s), ${Object.keys(obj).length} champs récupérés`);
    return obj;
  } catch {
    return null;
  }
};

/**
 * Récupère un JSON TRONQUÉ (réponse coupée par la limite de tokens).
 *
 * Un audit interrompu à 95 % contient déjà l'ampleur, les scores et les actions
 * prioritaires : tout jeter serait absurde. On coupe au dernier élément COMPLET,
 * puis on referme les accolades et crochets restés ouverts. Les champs
 * postérieurs à la coupure sont simplement absents — l'affichage les ignore.
 *
 * Conservateur par construction : n'est utilisé qu'en dernier recours, et ne
 * retourne un objet que s'il porte au moins deux clés (sinon ce n'est pas un
 * audit exploitable, autant échouer franchement).
 */
export const repairTruncatedJson = (raw = '') => {
  const from = String(raw || '').indexOf('{');
  if (from === -1) return null;
  const s = String(raw).slice(from);

  // Dernière position où une valeur venait d'être TERMINÉE, hors chaîne.
  let inStr = false, esc = false, cut = -1;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === '}' || c === ']') cut = i + 1;   // juste APRÈS le bloc refermé
    else if (c === ',') cut = i;               // juste AVANT la virgule
  }
  if (cut <= 0) return null;

  // Brackets restés ouverts dans le fragment conservé.
  const head = s.slice(0, cut);
  const stack = [];
  inStr = false; esc = false;
  for (const c of head) {
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') stack.push('}');
    else if (c === '[') stack.push(']');
    else if (c === '}' || c === ']') stack.pop();
  }

  try {
    const obj = JSON.parse(head + stack.reverse().join(''));
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
    if (Object.keys(obj).length < 2) return null;
    console.warn(`[qat] audit tronqué récupéré — ${Object.keys(obj).length} champ(s) exploitable(s)`);
    return obj;
  } catch {
    return null;
  }
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

/**
 * Contexte de lancement saisi par le rédacteur — prioritaire sur les défauts.
 *
 * `redaction` — ce bloc est partagé par l'AUDIT et la REFONTE. L'appel d'audit ne
 * produit AUCUN `article_html` : lui envoyer les consignes de rédaction du
 * maillage (« EXHAUSTIVITÉ EXIGÉE », « le code place ensuite lui-même »…) est du
 * bruit de prompt payé à chaque audit, sur un appel qui n'écrit pas une ligne
 * d'article. L'audit reçoit donc la LISTE (il en a besoin pour recommander un
 * plan qui fasse une place aux ancres), sans les consignes d'exécution.
 */
const buildBriefBlock = ({
  targetKeyword = '', articleType = DEFAULT_ARTICLE_TYPE, seoPlugin = DEFAULT_SEO_PLUGIN,
  targetWords = DEFAULT_TARGET_WORDS, internalLinks = [], articleUrl = '',
  redaction = true,
}) => {
  // `articleUrl` branche le filtre de domaine (règle 8) : une URL d'un AUTRE site
  // saisie par erreur dans le maillage n'est même pas proposée au modèle, car
  // depuis R2 le code la placerait lui-même — ce serait un lien EXTERNE AJOUTÉ.
  const links = cleanLinkRows(internalLinks, articleUrl);
  const listeSeule = links.map((l, i) => `${i + 1}. Ancre : « ${l.anchor} » → URL : ${l.url}`).join('\n');
  // ⚠️ NE PAS écrire « n'ajoute AUCUN lien » tout court : ce serait contradictoire
  // avec l'obligation de REPRODUIRE les liens déjà présents dans l'article (R1).
  // Le chemin « file d'attente » force internalLinks: [] et tombe exactement dans
  // ce cas de figure.
  let linkBlock = 'Aucune paire ancre + URL fournie : n\'ajoute AUCUN lien NOUVEAU.';
  if (links.length) linkBlock = listeSeule;
  if (links.length && redaction) {
    linkBlock = `${listeSeule}

⚠️ EXHAUSTIVITÉ EXIGÉE — les ${links.length} paires ci-dessus, SANS EXCEPTION.
Chacune doit figurer dans article_html sous la forme <a href="URL">ancre</a>, dans
une phrase du corps de l'article. Pas « la plupart », pas « celles qui
s'intègrent naturellement » : les ${links.length}. Si une ancre ne trouve pas sa
place dans le plan que tu écris, c'est le PLAN qui doit lui faire une place —
prévois la phrase qui la porte pendant que tu rédiges la section concernée.
Une ancre par emplacement, jamais deux liens vers la même URL, et jamais dans un
titre, le TL;DR, le sommaire, un tableau ou la FAQ.
Ce que tu laisses de côté n'est PAS perdu : le code le place ensuite lui-même, en
RÉDIGEANT une clause d'appoint et en la marquant « à relire » pour le rédacteur.
Un texte de ton cru vaut mieux que cette rustine : c'est tout l'intérêt de les
placer toi-même.`;
  }
  return `## ═══ BRIEF DU RÉDACTEUR (prioritaire sur les valeurs par défaut des ressources) ═══
- Mot-clé cible : « ${targetKeyword} » — forme EXACTE obligatoire dans le titre SEO,
  le H1 et une fois dans le premier paragraphe. Ne le paraphrase JAMAIS à ces trois
  endroits : on ciblerait un autre terme. PARTOUT AILLEURS, varie (voir le bloc
  « suroptimisation » plus bas).
- Type d'article : ${ARTICLE_TYPES[articleType]?.label || articleType} — ${ARTICLE_TYPES[articleType]?.description || ''}
- Plugin SEO du site : ${SEO_PLUGINS[seoPlugin]?.label || seoPlugin} (emploie sa terminologie exacte dans pre_pub_checklist)
- Longueur cible : ${targetWords} mots
- URL de l'article : ${articleUrl || 'non fournie'}

### Liens INTERNES à AJOUTER (nouveaux liens — les seuls que tu es autorisée à créer)
${linkBlock}

⚠️ Cette liste encadre les liens NOUVEAUX. Elle ne te dispense JAMAIS de
REPRODUIRE les liens déjà présents dans l'article d'origine : reproduire
l'existant est obligatoire et sans exception, y compris quand cette liste est
vide. Voir les blocs « LIENS ... À REPRODUIRE » du message.`;
};

/** « 4 min 20 s » — durée écoulée, lisible par le rédacteur. */
const fmtElapsed = (ms) => {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`;
};

/**
 * Appel long avec RETOUR EN DIRECT.
 *
 * Tente le streaming SSE : le rédacteur voit le texte se construire et un
 * compteur de caractères RÉELS. Si la route est absente ou le flux bufferisé par
 * le proxy (`STREAM_UNAVAILABLE`), bascule sur le transport job + polling — dont
 * le compteur de tokens est simulé, d'où l'étiquette « estimation ».
 *
 * Une génération de refonte dure 8-9 minutes : sans ce retour, l'écran reste
 * muet et le rédacteur croit l'application bloquée.
 */
const callWithLiveText = async ({ params, label, pass, onStep, onReplace, onDelta, onProgress, trackCall, progressFrom = 0, progressTo = 0 }) => {
  const t0 = Date.now();
  const maxChars = (params.max_tokens || 32000) * 3.5;   // ~3,5 caractères par token
  try {
    onStep(`${label} — rédaction en direct...`);
    const res = await callClaudeStream(params, (text, chars) => {
      if (typeof onDelta === 'function') onDelta(text, chars);
      onReplace(`${label} — ${chars.toLocaleString('fr-FR')} caractères écrits · ${fmtElapsed(Date.now() - t0)}`);
      if (progressTo > progressFrom) {
        const ratio = Math.min(1, chars / maxChars);
        onProgress(Math.round(progressFrom + (progressTo - progressFrom) * ratio));
      }
    });
    trackCall(res.usage, pass);
    onReplace(`${label} — terminé en ${fmtElapsed(Date.now() - t0)}`);
    return res;
  } catch (e) {
    if (e.message !== 'STREAM_UNAVAILABLE') throw e;
    console.warn('[qat] streaming indisponible → repli job + polling');
    // Un flux interrompu APRÈS avoir produit du texte a déjà été facturé par
    // Anthropic. Sans cette estimation, le repli relançait la génération entière
    // et le coût affiché n'en comptait qu'une seule — sous-estimation silencieuse.
    if (e.charsReceived > 0) {
      trackCall({ model: params.model, input_tokens: 0, output_tokens: Math.round(e.charsReceived / 3.5) }, pass);
      console.warn(`[qat] ${e.charsReceived} caractères déjà produits avant l'échec du flux — comptés en estimation`);
    }
    onStep(`${label} — flux direct indisponible, bascule sur le transport classique...`);
    const res = await callClaudeWithProgress(null, params, onStep, onReplace, `${label} (estimation)`);
    trackCall(res.usage, pass);
    onReplace(`${label} — terminé en ${fmtElapsed(Date.now() - t0)}`);
    return res;
  }
};

// ── Étape A — Audit QAT (sortie JSON) ─────────────────────────────────────────

/**
 * Prompt système de l'AUDIT, en deux blocs pour le PROMPT CACHING.
 *
 * Le cache d'Anthropic est un appariement de PRÉFIXE : le moindre octet modifié
 * invalide tout ce qui suit. Le brief (type d'article, plugin SEO, longueur
 * cible, liens internes) change à CHAQUE article ; il était placé juste avant le
 * skill principal, les règles d'équipe et la base de connaissances — de loin la
 * plus grosse partie du prompt. Résultat : ces blocs volumineux étaient
 * retraités intégralement à chaque appel, y compris lors des 3 tentatives de
 * relance d'un même audit.
 *
 * On renvoie donc le SOCLE STABLE d'abord, marqué `cache_control`, puis le brief.
 * Le contenu envoyé à l'IA est identique — seul l'ordre change. Les dates
 * interpolées dans le socle (`fr`, `cutoffIso`) ne changent qu'une fois par
 * jour : elles restent stables à l'échelle de vie d'un cache.
 *
 * TTL 1 HEURE plutôt que le défaut 5 minutes. Diagnostiqué en production par
 * empreinte SHA-256 du socle : deux audits réels avaient un socle IDENTIQUE à
 * l'octet, et pourtant chacun ÉCRIVAIT le cache sans jamais le LIRE. Cause :
 * un audit n'est pas un appel isolé mais un PIPELINE (extraction de requêtes,
 * recherche web, rédaction) qui dure souvent plus de 5 minutes de bout en
 * bout — le TTL par défaut expirait avant même la fin du premier appel qui
 * l'utilise.
 *
 * Le socle mis en cache est le SKILL SEUL (`buildSkillMethodBlock`), pas les
 * règles d'équipe ni la base de connaissances : leur cadrage (« à auditer »
 * en phase 1, « à appliquer » en phase 2) diffère légitimement d'une phase à
 * l'autre, donc leurs octets ne coïncideraient jamais. Le skill, lui, est
 * OCTET POUR OCTET le même en phase 1 et en phase 2 (runQatRewrite reprend le
 * même `buildSkillMethodBlock(brainSkills)` en tête de son propre socle) :
 * c'est la seule portion pour laquelle un partage entre phases a un sens, et
 * c'est aussi la plus grosse (skill + ressources : ~19 000 caractères sur
 * l'article de référence testé).
 */
const buildAuditSystem = (brainSkills, skills, knowledge, brief) => {
  const { fr, cutoffIso } = getDateContext();
  const socle = buildSkillMethodBlock(brainSkills);

  const consigne = `Nous sommes le ${fr}. Tu es l'expert décrit par le skill fourni.

Tu exécutes l'**ÉTAPE A — AUDIT** de ce skill, et RIEN d'autre : tu n'écris pas
l'article, tu produis l'audit. Applique sa méthode et son schéma de sortie à la
lettre : la réponse est un JSON valide, complet et bien fermé, sans texte ni
backticks avant ou après.

Toute donnée antérieure au ${cutoffIso} (seuil 6 mois) est suspecte et doit être
vérifiée ou signalée dans freshness_checks.

Renseigne IMPÉRATIVEMENT, en plus du reste : « ampleur » (la décision la plus
structurante), « keyword_repositioning » (ou null) et « a_supprimer » (ou []).

## ═══ RÈGLES COMPLÉMENTAIRES ═══
${buildSkillsBlock(
    skills,
    'Règles éditées par l\'équipe dans le menu SKILLS IA. Vérifie chacune d\'elles et signale tout manquement dans priority_actions.',
    'RÈGLES D\'ÉQUIPE (menu SKILLS IA) — À AUDITER AUSSI'
  )}${buildKnowledgeBlock(knowledge, '', 'BASE DE CONNAISSANCES — À VÉRIFIER AUSSI')}`;

  const briefTexte = String(brief || '').trim();
  return [
    { type: 'text', text: socle, cache_control: { type: 'ephemeral', ttl: '1h' } },
    { type: 'text', text: consigne },
    ...(briefTexte ? [{ type: 'text', text: briefTexte }] : []),
  ];
};

/**
 * Génère au maximum 2 requêtes de vérification de fraîcheur, puis les exécute.
 * Le skill limite volontairement la recherche à 2 appels.
 */
const gatherFreshnessSources = async (content, targetKeyword, onStep, trackCall, modelSelections) => {
  const { year } = getDateContext();
  let queries = [];
  try {
    const { text, usage } = await callClaude(null, {
      system: 'Tu génères des requêtes de recherche web courtes et ciblées. Réponds uniquement par un tableau JSON de chaînes.',
      max_tokens: 300,
      model: selectModel('query_extraction', modelSelections),
      messages: [{
        role: 'user',
        content: `Article à vérifier (extrait) :\n${stripHtml(content).slice(0, 1500)}\n\nMot-clé cible : ${targetKeyword}\n\nDonne AU MAXIMUM ${MAX_QAT_SEARCHES} requêtes : la première sur les dernières actualités du sujet, la seconde sur le fait le plus susceptible d'être obsolète (prix, montant d'aide, norme, date). Inclus l'année ${year}. Format : ["requête 1", "requête 2"]`,
      }],
    });
    trackCall(usage, 'query_extraction');
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
  modelSelections = null, // choix de modèle par passe (settings.json) — null = défaut du registre
  onStep = () => {},
  onReplace = () => {},
  onProgress = () => {},
  onDelta = () => {},        // (texte, caractères) → affichage live de la rédaction
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
  const { sources, queries } = await gatherFreshnessSources(content, targetKeyword, onStep, trackCall, modelSelections);

  // ── Une seule source de vérité pour l'article ──────────────────────────────
  // Sur le chemin SCRAPING, Articles.jsx met le TEXTE BRUT dans `content` (les
  // balises <a> ont disparu) et le HTML dans `contentHtml`. Le verrou liens
  // externes travaille sur le HTML : si on envoyait `content` au modèle, il
  // devrait reproduire des liens qu'il ne voit nulle part → rejet systématique
  // des 3 essais sur tout site non connecté en WordPress MCP.
  const sourceHtml = contentHtml || content;

  // ── Chiffres comptés côté code (fiables) ───────────────────────────────────
  const linkStats = analyzeLinks(sourceHtml, articleUrl);
  const rawText = stripHtml(sourceHtml || '').trim();
  const wordCount = rawText ? rawText.split(/\s+/).length : 0;

  // `redaction: false` — l'audit ne produit aucun article_html (voir buildBriefBlock).
  const brief = buildBriefBlock({ targetKeyword, articleType, seoPlugin, targetWords, internalLinks, articleUrl, redaction: false });
  const system = buildAuditSystem(brainSkills, skills, knowledge, brief);
  const user = `## ARTICLE À AUDITER (HTML)
${sourceHtml}

## DONNÉES FACTUELLES (comptées automatiquement — fiables, reprends-les telles quelles)
- Liens INTERNES (même site) : ${linkStats.internal}
- Liens EXTERNES (autres sites) : ${linkStats.external}
- Longueur actuelle : ~${wordCount} mots (cible du brief : ${targetWords} mots)

## SOURCES WEB (vérification de fraîcheur — ${queries.length} recherche(s))
${formatSourcesForPrompt(sources)}

## ENVELOPPE DE TAILLE — internal_linking.liens_entrants
Donne **au moins ${MIN_LIENS_ENTRANTS}** paires ancre + URL, et **au maximum ${MAX_LIENS_ENTRANTS}**.
Ce plafond prime sur toute autre limite indiquée ailleurs : le JSON d'audit doit
tenir en une seule réponse, et une liste sans borne le faisait tronquer — audit
illisible, 3 essais facturés, phase 2 sans ampleur ni score. Mesuré en production
le 2026-08-17. Classe par valeur SEO décroissante et garde les ${MAX_LIENS_ENTRANTS}
meilleures plutôt que d'en lister davantage moins bonnes.

Produis maintenant le JSON d'audit complet, conforme au schéma du skill. Rien d'autre que le JSON.`;

  onProgress(25);
  let audit = null;
  let rawAudit = '';
  // Deux causes d'échec TRÈS différentes, à ne jamais confondre : l'appel à l'IA
  // qui échoue (compte désactivé, crédits épuisés, réseau) et la réponse reçue
  // mais illisible. Les présenter sous le même message envoyait le rédacteur
  // chercher un problème de format alors que le compte était simplement à
  // recharger. `apiError` retient le message réel de l'API.
  let apiError = null;
  let currentUser = user;

  for (let attempt = 1; attempt <= 3 && !audit; attempt++) {
    try {
      const { text } = await callWithLiveText({
        // Le schéma d'audit est volumineux ; 12 000 tokens tronquaient la réponse
        // sur les articles longs, et un JSON tronqué est illisible.
        // `thinking: disabled` — ÉTAPE 1 DE LA BASCULE SONNET 5, choix délibéré.
        // Sur Sonnet 4.5, ne rien passer signifiait « pas de raisonnement ». Sur
        // Sonnet 5, ne rien passer l'ACTIVE, et ce raisonnement partage le plafond
        // `max_tokens` avec le texte produit : un audit long se ferait tronquer.
        // On reproduit donc à l'identique l'enveloppe de fonctionnement actuelle.
        // Activer le raisonnement adaptatif est l'étape 2, APRÈS mesure du coût et
        // de la longueur réelle sur de vrais articles (le tokenizer de Sonnet 5
        // compte ~30 % de tokens en plus pour le même texte).
        //
        // 20 000 → 32 000 (2026-08-17). Ce plafond avait été calibré sur Sonnet
        // 4.5 ; le tokenizer de Sonnet 5 compte ~30 % de tokens en plus pour le
        // MÊME texte, et le même audit ne rentrait plus. Constaté en production
        // sur un article réel : 3 essais (17 450, 11 790 puis 12 096 tokens de
        // sortie), tous tronqués donc illisibles, 0,55 $ dépensés pour un
        // `auditJson` null. On s'aligne sur la refonte (32 000), très en dessous
        // du maximum du modèle.
        params: { system, max_tokens: 32000, model: selectModel('audit_qat', modelSelections), thinking: { type: 'disabled' }, messages: [{ role: 'user', content: currentUser }] },
        label: attempt === 1 ? 'Audit QAT' : `Audit QAT — essai ${attempt}/3`,
        pass: 'audit_qat',
        onStep, onReplace, onProgress, onDelta, trackCall,
        progressFrom: 25, progressTo: 40,
      });
      apiError = null;
      rawAudit = (text || '').trim();
      // Dernier essai : on accepte un audit tronqué mais exploitable plutôt que
      // de tout jeter (l'ampleur et les actions prioritaires arrivent en tête).
      audit = parseJsonLoose(rawAudit, { salvage: attempt === 3 });
      if (!audit) {
        onStep(`⚠️ Audit — réponse illisible, nouvel essai (${attempt}/3)...`);
        // Reprise INSTRUITE : sans ce retour, les 3 essais repartaient du même
        // prompt et échouaient de la même façon.
        currentUser = `${user}

## ═══ REPRISE — L'ESSAI PRÉCÉDENT A ÉCHOUÉ ═══
Ta réponse précédente n'était pas un JSON exploitable (probablement tronquée, ou
précédée de texte). Réponds UNIQUEMENT par l'objet JSON, sans texte ni backticks.
Pour tenir dans la limite : laisse "tldr", "comparative_table" et "faq" à null —
ils sont produits à l'étape de rédaction, pas dans l'audit — et respecte les
limites de taille par champ. Priorise "ampleur", "scores", "priority_actions",
"a_supprimer" et "recent_context".`;
      }
    } catch (e) {
      apiError = e;
      console.warn(`[qat audit] essai ${attempt}/3:`, e.message);
      if (attempt < 3) {
        onStep(`⚠️ Appel à l'IA en échec (${e.message}) — nouvel essai (${attempt}/3)...`);
        await new Promise(r => setTimeout(r, 1500 * attempt));
      } else {
        onStep(`⚠️ Appel à l'IA en échec après 3 essais : ${e.message}`);
      }
    }
  }

  onProgress(40);
  return {
    audit,
    auditRaw: rawAudit,
    apiError,
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
const summarizeAuditForRewrite = (audit, selection = null) => {
  if (!audit) return 'Audit indisponible : traite l\'article comme une refonte totale prudente.';
  const j = (v) => JSON.stringify(v ?? null);
  // Le rédacteur a tout décoché. Ne PAS servir le repli « audit indisponible »
  // ci-dessus : il déclencherait une refonte prudente alors que la demande est
  // l'inverse. Les deux champs de CADRAGE partent quand même — `ampleur` pilote
  // `resolveQatDepth` et `keyword_repositioning` porte le mot-clé : les taire
  // casserait la génération au lieu de la nuancer.
  if (isSelectionEmpty(selection)) {
    return `Le rédacteur a écarté toutes les catégories de l'audit pour cette génération.
N'applique QUE l'instruction de l'équipe ci-dessous. N'ajoute aucune recommandation de ton cru.
- ampleur : ${j(audit.ampleur)}
- keyword_repositioning : ${j(audit.keyword_repositioning)}`;
  }
  // MÊME sélection que le textarea de la phase 2 : sans ce filtre, une case
  // décochée disparaissait de l'écran et partait quand même par ce canal-ci.
  const retenu = filterAuditBySelection(audit, selection);
  // Une catégorie décochée est ABSENTE, pas vide : écrire « seo_geo_gaps : null »
  // se lit « l'audit n'a rien trouvé », ce qui est faux et invite le modèle à
  // combler de lui-même. On ne l'écrit donc pas du tout.
  const champ = (cle, libelle) => (cle in retenu ? `
- ${libelle} : ${j(retenu[cle])}` : '');
  return `- ampleur : ${j(audit.ampleur)}
- keyword_repositioning : ${j(audit.keyword_repositioning)}${champ('a_supprimer', 'a_supprimer')}${champ('priority_actions', 'priority_actions')}${champ('recent_context', 'recent_context')}${champ('seo_geo_gaps', 'seo_geo_gaps')}${champ('eeat_recommendations', 'eeat_recommendations')}${champ('strategic_recommendation', 'strategic_recommendation')}${champ('tldr', 'tldr proposé par l\'audit')}${champ('sources_check', 'sources_check (affirmations à sourcer ou à retirer)')}`;
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
  // `auditAmpleurDecision` et non `audit?.ampleur?.decision` : l'audit rend parfois
  // ce champ en TEXTE LIBRE (« Refonte structurelle prioritaire : … », constaté en
  // production le 2026-08-17), et la lecture directe donnait alors `undefined`.
  // C'est ici que ça comptait le plus : cette valeur décide COMMENT l'article est
  // réécrit, et on retombait sur « refonte » par défaut alors que l'audit avait
  // tranché — y compris quand il demandait une simple MAJ ciblée.
  const decision = auditAmpleurDecision(audit);
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
  // Cases cochées en phase 2. `null` = aucune sélection : l'audit part ENTIER,
  // exactement comme avant ce dispositif. Les appels hors phase 2 et les articles
  // audités avant ne changent donc pas de comportement.
  auditSelection = null,
  depth = 'auto',
  instruction = '',
  modelPricing = null,
  modelSelections = null, // choix de modèle par passe (settings.json) — null = défaut du registre
  onStep = () => {},
  onReplace = () => {},
  onProgress = () => {},
  onDelta = () => {},        // (texte, caractères) → affichage live de la rédaction
}) => {
  const { acc: tokenAcc, track: trackCall } = makeTokenTracker();
  const brainSkills = getBrainSkills(skills);
  if (!brainSkills.length) {
    throw new Error('Le mode « Audit QAT + Refonte » exige un skill cerveau (SKILL.md) actif dans le menu SKILLS IA.');
  }
  const { fr } = getDateContext();
  // ── PLAFOND DE L'INSTRUCTION : COUPÉ PROPREMENT, ET ANNONCÉ ────────────────
  // C'était un `slice()` nu au milieu du template : coupe au caractère près et
  // silence complet. Le pré-remplissage est désormais borné (`buildGenerationPrompt`),
  // mais le rédacteur peut coller plus long — et un plafond appliqué sans le dire
  // fait disparaître ses consignes sans qu'il l'apprenne jamais.
  const instr = couperInstruction(instruction);
  if (instr.coupe) onStep(`⚠️ ${instr.avertissement}`);
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

  // Prompt système en deux blocs pour le PROMPT CACHING.
  //
  // TTL 1 HEURE plutôt que le défaut 5 minutes : diagnostiqué en production, le
  // cache ecrivait a chaque appel sans jamais etre lu. Cause reelle — confirmee
  // par empreinte SHA-256 du bloc stable, identique entre deux audits reels et
  // pourtant jamais relu : un audit complet est un PIPELINE de plusieurs
  // appels (extraction de requetes, recherche web, redaction) qui dure souvent
  // plus de 5 minutes de bout en bout. Le TTL par defaut expirait donc avant
  // meme la fin du PREMIER appel qui l'utilise, et a fortiori avant le second.
  // Le socle mis en cache est le SKILL SEUL (`buildSkillMethodBlock`),
  // OCTET POUR OCTET identique à celui de l'audit (buildAuditSystem) — c'est
  // ce qui permet une lecture de cache CROISEE entre phases, pas seulement
  // entre relances d'un meme appel. Les regles d'equipe et la base de
  // connaissances restent dans le bloc volatil : leur cadrage differe
  // legitimement de l'audit (« a appliquer » ici, « a auditer » la-bas), donc
  // leurs octets ne coincideraient jamais.
  const socle = buildSkillMethodBlock(brainSkills);

  const consigne = `Nous sommes le ${fr}. Tu es l'experte décrite par le skill fourni.

Tu exécutes l'**ÉTAPE B — RÉFECTION** de ce skill. Applique intégralement la
ressource « refonte-integrale.md » et les autres ressources (gabarits de
longueur, TL;DR + FAQ, maillage et ancres).

Ta réponse est UN SEUL objet JSON valide, complet et bien fermé, sans texte ni
backticks avant ou après, au schéma défini par la ressource de refonte
(titre_seo, meta_description, h1, chapo_html, article_html, word_count,
ampleur_appliquee, mot_cle_retenu, elements_supprimes, mots_cles_secondaires,
ancres_placees, notes_redaction).

RAPPEL JSON : chapo_html et article_html contiennent du HTML riche en attributs
entre guillemets doubles (href="...", class="...", alt="..."). Chaque guillemet
double À L'INTÉRIEUR de ces chaînes DOIT être échappé (\\") pour rester un JSON
valide -- un seul guillemet non échappé casse tout l'objet et fait perdre
l'article entier.

${depthBlock}${overrideNote}

## ═══ VERROU ABSOLU — LIENS (prioritaire sur toute autre consigne) ═══
Deux obligations DISTINCTES, ne les confonds pas.

1. REPRODUIRE L'EXISTANT — obligatoire, toujours, sans exception.
   TOUT lien présent dans l'article d'origine, externe COMME interne, doit
   réapparaître dans article_html avec le même href et le même texte d'ancre,
   intégré dans une phrase du corps de l'article. Cette obligation vaut même si
   le brief ne demande aucun lien nouveau.
   • un lien EXTERNE manquant fait REJETER toute la génération par le contrôle
     technique ;
   • un lien INTERNE manquant est réparé automatiquement quand c'est possible, et
     signalé au rédacteur sinon — ne compte pas sur ce filet, place-les toi-même.

2. AJOUTER DU NEUF — strictement limité.
   Tu n'ajoutes AUCUN lien externe nouveau, jamais, sous aucun prétexte. Les
   seuls liens nouveaux que tu es autorisée à créer sont les liens INTERNES
   listés dans le brief.

## ═══ RÈGLES COMPLÉMENTAIRES ═══
${buildSkillsBlock(
    skills,
    'Règles éditées par l\'équipe dans le menu SKILLS IA — complémentaires à la méthode du skill principal.\nTu DOIS les respecter dans CHAQUE phrase écrite ou réécrite.',
    'RÈGLES D\'ÉQUIPE (menu SKILLS IA) — OBLIGATOIRES'
  )}${buildKnowledgeBlock(knowledge)}

${brief}${instr.texte ? `\n\n## ═══ INSTRUCTION SPÉCIFIQUE DE L'ÉQUIPE — PRIORITÉ HAUTE ═══\n${instr.texte}\nElle prime sur les règles générales, sauf le verrou liens externes.` : ''}`;

  const system = [
    { type: 'text', text: socle, cache_control: { type: 'ephemeral', ttl: '1h' } },
    { type: 'text', text: consigne },
  ];

  // Même source de vérité que le verrou : le HTML. Sur le chemin scraping,
  // `content` est du texte brut sans balises <a> — l'envoyer au modèle le
  // rendrait incapable de reproduire les liens que le verrou exige.
  const sourceHtml = contentHtml || content;

  // Liens externes de l'article d'origine : listés explicitement dans le prompt
  // pour ÉVITER le rejet, plutôt que de le corriger par un nouvel essai (chaque
  // essai coûte plusieurs minutes sur un article de 2 500 mots).
  const externalLinks = listExternalLinks(sourceHtml, articleUrl);
  const externalBlock = externalLinks.length
    ? `## ═══ LIENS EXTERNES À REPRODUIRE À L'IDENTIQUE (${externalLinks.length}) ═══
Chacun de ces liens DOIT figurer dans article_html avec le même href et le même
texte d'ancre. Il en manque un seul et toute la génération est rejetée.
${externalLinks.map((l, i) => `${i + 1}. <a href="${l.href}">${l.text}</a>`).join('\n')}`
    : '## ═══ LIENS EXTERNES ═══\nL\'article d\'origine n\'en contient aucun : n\'en ajoute aucun.';

  // Jumeau du bloc ci-dessus pour les liens INTERNES (R1). Même motif, qui a fait
  // ses preuves : les nommer un par un ÉVITE la perte, alors que la réparer coûte
  // soit une passe déterministe, soit un avertissement au rédacteur.
  // Les ancres purement locales (#sommaire) sont exclues par listInternalLinks.
  const existingInternalLinks = listInternalLinks(sourceHtml, articleUrl);
  const internalBlock = existingInternalLinks.length
    ? `## ═══ LIENS INTERNES DÉJÀ PRÉSENTS — À REPRODUIRE (${existingInternalLinks.length}) ═══
Ces liens existent DÉJÀ dans l'article : ce ne sont pas des liens nouveaux, et
les reproduire n'est pas facultatif. Chacun doit figurer dans article_html avec
le même href et le même texte d'ancre, dans une phrase du corps de l'article.
Ne les mets ni dans un titre, ni dans le TL;DR, ni dans la FAQ.
${existingInternalLinks.map((l, i) => `${i + 1}. <a href="${l.href}">${l.text}</a>`).join('\n')}`
    : '## ═══ LIENS INTERNES DÉJÀ PRÉSENTS ═══\nL\'article d\'origine n\'en contient aucun.';

  // ── R4 — IMAGES : bloc JUMEAU des deux précédents ───────────────────────────
  // Ce prompt ne disait RIEN des images : il détaillait longuement la reprise de
  // chaque lien externe et interne, et le modèle laissait tomber les <img> sans
  // qu'aucun verrou s'en aperçoive. Les nommer une par une ÉVITE la perte, alors
  // que la réparer coûte une passe déterministe dont le placement ne peut être
  // qu'approximatif (cf. src/utils/imageCarry.js).
  // Ce bloc vit dans le message UTILISATEUR : le socle du système est marqué
  // `cache_control` et doit rester identique OCTET POUR OCTET entre l'audit et la
  // refonte, sans quoi le cache de préfixe est invalidé à chaque appel.
  const originalImages = listArticleImages(sourceHtml);
  const imageList = originalImages
    .map((im, i) => `${i + 1}. ${im.html}${im.lead ? `\n   (dans l'article d'origine, elle vient après : « …${im.lead} »)` : ''}`)
    .join('\n');
  // Garde-fou de volume : un srcset WordPress complet fait plusieurs centaines de
  // caractères par image. Au-delà du seuil, on ne recopie plus les balises — le
  // HTML d'origine COMPLET est de toute façon déjà dans ce même message, juste
  // au-dessus : le modèle y prend les balises exactes.
  const IMAGE_BLOCK_MAX = 12000;
  const imageBody = imageList.length <= IMAGE_BLOCK_MAX
    ? imageList
    : originalImages.map((im, i) => `${i + 1}. src="${im.src}" alt="${im.alt}"${im.caption ? ` — légende : « ${im.caption} »` : ''}\n   (recopie la balise EXACTE depuis le HTML d'origine ci-dessus)`).join('\n');
  const imageBlock = originalImages.length
    ? `## ═══ MÉDIAS DE L'ARTICLE — À REPRODUIRE À L'IDENTIQUE (${originalImages.length}) ═══
Images, vidéos et iframes (YouTube, Vimeo, cartes) font PARTIE de l'article. Les
reproduire n'est pas facultatif, et tu n'en inventes aucun autre.
• Recopie chaque balise TELLE QUELLE : même src, même srcset, même sizes, même
  alt, même title, mêmes width, height et loading. Tu ne réécris ni le fichier,
  ni la description alternative.
• Une image dans un <figure> RESTE dans son <figure>, avec sa <figcaption> : la
  légende ne se sépare jamais de son image. Une <iframe> RESTE dans le <div> qui
  l'enveloppe : c'est son cadre responsive, l'en sortir le casse.
• Replace chaque média au même endroit du récit : même section, même
  enchaînement avec le texte qui l'entoure.
${imageBody}`
    : '## ═══ MÉDIAS ═══\nL\'article d\'origine n\'en contient aucun : n\'en ajoute aucun.';

  const user = `## ARTICLE D'ORIGINE (HTML — à réécrire)
${sourceHtml}

${externalBlock}

${internalBlock}

${imageBlock}

## CONCLUSIONS DE L'AUDIT (elles pilotent la réécriture)
${summarizeAuditForRewrite(audit, auditSelection)}

## SOURCES WEB DISPONIBLES (pour les données récentes — ne cite jamais une source non listée ici)
${formatSourcesForPrompt(sources)}

${redactionConstraintsBlock(targetKeyword)}

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
  // Diagnostic du DERNIER essai en échec, remonté dans l'erreur finale si les 3
  // essais échouent tous. Sans lui, "réponse non conforme au format JSON" ne dit
  // RIEN de ce que le modèle a réellement renvoyé -- même angle mort que la passe
  // de gras avant le 19/08 (règle 10), ici plus grave : contrairement au gras
  // cette erreur est BLOQUANTE, et jusqu'ici indiagnosticable après coup (le
  // process headless d'un lot ne laisse voir que la console, jamais persistée).
  let lastParseFailureDetail = '';

  // ── CE QUI PART RÉELLEMENT AU MODÈLE, DANS LA CONSOLE ─────────────────────
  // Demande d'Andrianina, 19 août 2026 : « l'ensemble des règles envoyées à l'IA
  // quand une génération est lancée — ça me permettra d'évaluer les résultats ».
  //
  // C'est le seul endroit où le prompt est CONNU EN ENTIER : skills du menu,
  // contraintes tenues en dur, audit filtré par les cases, directives du
  // rédacteur, brief. Le reconstituer de mémoire à partir du code est justement
  // ce qui fait croire qu'une consigne est envoyée alors qu'elle ne l'est pas —
  // on vient d'en corriger trois (gras jamais vérifié, `[à vérifier]` réintroduit,
  // maillage forcé sur zéro paire).
  //
  // Le contenu est SEULEMENT lu, jamais reconstruit : le socle système porte
  // `cache_control` et doit rester identique octet pour octet, sous peine
  // d'invalider le cache de préfixe à chaque article.
  try {
    /* eslint-disable no-console */
    console.groupCollapsed(
      `%c[TONTON] Règles envoyées à l'IA — génération (${system.reduce((n, b) => n + (b.text || '').length, 0) + currentUser.length} car.)`,
      'color:#6366f1;font-weight:bold',
    );
    system.forEach((bloc, i) => {
      console.groupCollapsed(`SYSTÈME ${i + 1}/${system.length} — ${(bloc.text || '').length} car.${bloc.cache_control ? ' (mis en cache)' : ''}`);
      console.log(bloc.text || '');
      console.groupEnd();
    });
    console.groupCollapsed(`UTILISATEUR — ${currentUser.length} car. (audit filtré + directives + brief)`);
    console.log(currentUser);
    console.groupEnd();
    console.groupEnd();
    /* eslint-enable no-console */
  } catch { /* la journalisation ne doit JAMAIS empêcher une génération */ }

  for (let attempt = 1; attempt <= 3 && !sanitized; attempt++) {
    try {
      const { text } = await callWithLiveText({
        // Voir le commentaire de l'audit : raisonnement désactivé pour la bascule,
        // sinon il mangerait le budget destiné à l'article.
        //
        // Relevé de 32 000 à 48 000 le 2 septembre 2026, même défaut que la
        // règle 11 (audit 20 000 -> 32 000) : Sonnet 5 compte ~30 % de tokens
        // en plus que Sonnet 4.5 pour un même texte, et ce plafond datait du
        // 5 août -- avant Sonnet 5, avant toutes les contraintes rédactionnelles
        // ajoutées depuis (règle des 20 mots, maillage à 100 %, reprise des
        // liens perdus...) qui rallongent mécaniquement le JSON attendu.
        // Constaté en production : "réponse illisible ou article vide" après
        // 3 essais -- ici, contrairement à l'audit, aucun `salvage` ne peut
        // récupérer un article_html coupé en plein milieu, donc une réponse
        // tronquée est un échec total, pas partiel. La marge doit être plus
        // large qu'ailleurs, pas ajustée au plus juste.
        params: { system, max_tokens: 48000, model: selectModel('refonte', modelSelections), thinking: { type: 'disabled' }, messages: [{ role: 'user', content: currentUser }] },
        label: attempt === 1 ? 'Rédaction de l\'article' : `Rédaction — essai ${attempt}/3`,
        pass: 'refonte',
        onStep, onReplace, onProgress, onDelta, trackCall,
        progressFrom: 55, progressTo: 88,
      });
      raw = (text || '').trim();
      article = parseJsonLoose(raw);
      if (!article?.article_html) {
        onStep(`⚠️ Réponse illisible ou article vide — nouvel essai (${attempt}/3)...`);
        // La FIN du texte est ce qui compte : une troncature par max_tokens se
        // voit à ce qu'elle s'arrête en plein milieu d'un objet JSON ; un
        // guillemet non échappé dans le HTML se voit à ce que la fin ne
        // ressemble à rien de JSON du tout. Écrasé à chaque essai : seul le
        // DERNIER compte si les 3 échouent.
        lastParseFailureDetail = raw
          ? `réponse de ${raw.length} car., non conforme au JSON attendu. Fin reçue : « …${raw.slice(-200)} »`
          : 'réponse vide.';
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
      const check = sanitizeFullArticle(sourceHtml, composed, articleUrl);
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

      // ── R1, volet INTERNE : reprise DÉTERMINISTE et NON BLOQUANTE ───────────
      // APRÈS sanitizeFullArticle, jamais avant : ré-envelopper des ancres en
      // amont ferait échouer silencieusement Range.surroundContents sur une ancre
      // à cheval sur des balises et augmenterait mécaniquement le taux de rejet
      // du verrou externe.
      // Champ SÉPARÉ (`missingInternal`) : la signature { html, stripped, missing }
      // de sanitizeFullArticle et ses tests restent intacts.
      // Sanction ASYMÉTRIQUE : on ne rejette JAMAIS sur un lien interne. Un 4e
      // motif de rejet écraserait `currentUser` et ferait perdre la consigne de
      // reprise du verrou externe — R1 affaiblirait alors la règle 8.
      const carried = carryOverInternalLinks(sourceHtml, check.html, articleUrl);
      if (carried.missing.length) {
        onStep(`⚠️ ${carried.missing.length} lien(s) interne(s) d'origine non repris (ancre disparue) — signalés, génération conservée.`);
      }
      // ── R2 — TOUTES les suggestions de lien interne sont intégrées ──────────
      // Même position et mêmes raisons que R1 : APRÈS sanitizeFullArticle (poser
      // des ancres avant le verrou externe augmenterait son taux de rejet), et
      // SANS jamais rejeter — un 4e motif de rejet écraserait `currentUser` et
      // ferait perdre la consigne de reprise du verrou externe (règle 8).
      //
      // FORÇAGE À 100 % (décision explicite d'Andrianina) : ce que l'IA n'a pas
      // placé, le code le place — en tissant l'ancre si son texte existe, sinon
      // en RÉDIGEANT une clause d'appoint marquée « à relire ».
      // ── R2a — les liens INTERNES posés dans une zone interdite sont DÉLIÉS ────
      // « Aucun lien dans la FAQ » est écrit trois fois dans le skill et le code
      // s'interdisait déjà ces emplacements pour SES liens — mais rien
      // n'empêchait le modèle d'en poser : on ne faisait que le constater.
      // Placé ICI, entre R1 et R2, pour une raison précise : le lien délié
      // redevient « absent » aux yeux de weaveBriefLinks juste en dessous, qui le
      // replace alors dans le corps. La violation devient un bon placement.
      // Ne touche QUE l'interne — délier un externe serait le supprimer (règle 8).
      const deloc = unwrapForbiddenInternalLinks(carried.html, articleUrl);
      if (deloc.unwrapped.length) {
        onStep(`🔗 ${deloc.unwrapped.length} lien(s) interne(s) posé(s) par l'IA dans une zone interdite (FAQ, titre, tableau, TL;DR) — délié(s), puis replacé(s) dans le corps.`);
      }
      const woven = weaveBriefLinks(deloc.html, internalLinks, articleUrl);

      // ── R6 — les renvois écrits PAR LE MODÈLE deviennent des encarts ─────────
      // APRÈS R2, jamais avant : le tissage doit voir la prose du modèle telle
      // qu'elle est, et un lien déjà placé reste placé — R6 le DÉPLACE, il ne le
      // retire pas, donc le constat de R2 juste en dessous est inchangé.
      // Le renvoi signalé par Andrianina n'était PAS une clause du code : « À lire
      // aussi LES … », sans deux-points et sans `data-lien-redige` nulle part dans
      // la page. C'est le modèle qui l'écrit, et corriger `writeClause` (18/08) ne
      // pouvait donc rien y faire — le renvoi restait collé en fin de phrase.
      const renvois = promoteInlineRenvois(woven.html, articleUrl);
      if (renvois.promoted.length) {
        onStep(`🔗 ${renvois.promoted.length} renvoi(s) « À lire aussi » collé(s) en fin de phrase par l'IA — déplacé(s) dans leur propre encart.`);
      }
      woven.html = renvois.html;

      // ── R7 — LES MARQUEURS DE DOUTE NE PARTENT JAMAIS EN LIGNE ───────────────
      // « Ne jamais mettre des : [à vérifier] etc. » (consigne d'Andrianina).
      // Mesuré le 19/08 : l'article produit en portait TROIS, alors que l'audit
      // avait mis en action P1 « Lever les mentions [à vérifier] » et que cette
      // action était COCHÉE. Le modèle a lu la consigne puis en a écrit trois de
      // plus — une consigne qu'on ne mesure jamais est une consigne dont on ne
      // sait rien (même leçon que le gras et le plafond de 20 mots).
      // On retire la MARQUE et on REMONTE la phrase : un `[à vérifier]` signale
      // une affirmation non sourcée, et l'effacer en silence rendrait le doute
      // invisible juste avant la publication.
      const douteux = stripUncertaintyMarkers(woven.html);
      if (douteux.removed.length) {
        woven.html = douteux.html;
        onStep(uncertaintyReportLine(douteux.removed));
      }

      // CONSTAT : on ne croit ni le modèle (`ancres_placees` est une
      // auto-déclaration jamais vérifiée) ni le rapport du tissage — on RECOMPTE
      // sur le HTML final.
      const briefConstat = countPlacedBriefLinks(woven.html, internalLinks, articleUrl);
      const reportLine = briefLinkReportLine(woven);
      if (reportLine) onStep(reportLine);

      // ── R4 — les IMAGES d'origine sont remises, DÉTERMINISTE et NON BLOQUANT ──
      // EN DERNIER, et pour une raison précise : R1 et R2 posent des liens dans
      // la PROSE, et ils doivent travailler sur celle du modèle, pas sur du HTML
      // que le code vient de réinjecter. Une <figure>/<figcaption> réinsérée est
      // de toute façon un emplacement interdit aux liens (linkZones.js), donc
      // l'ordre inverse ne changerait rien — mais l'invariant reste plus simple à
      // tenir ainsi.
      // Champs SÉPARÉS (`restoredImages`, `missingImages`) : la signature
      // { html, stripped, missing } de sanitizeFullArticle et ses tests restent
      // intacts, exactement comme pour R1.
      // JAMAIS un rejet : un 4e motif écraserait `currentUser` et ferait perdre la
      // consigne de reprise du verrou externe (règle 8).
      // ── CONSTAT — les phrases trop longues sont COMPTÉES, pas seulement interdites
      // Le prompt exige un plafond de 20 mots (voir redactionConstraintsBlock) ;
      // sans cette mesure, on ne saurait jamais s'il est respecté. Non bloquant :
      // un 4e motif de rejet écraserait `currentUser` et ferait perdre la consigne
      // de reprise du verrou externe (règle 8).
      const tropLongues = phrasesTropLongues(woven.html);
      if (tropLongues.length) {
        onStep(`✏️ ${tropLongues.length} phrase(s) de plus de ${MOTS_MAX_PHRASE} mots (la plus longue : ${tropLongues[0].mots} mots) — à couper en relecture.`);
      }
      // SUROPTIMISATION — le chiffre qui trahit, c'est le nombre de H2 portant la
      // forme exacte, pas la densité : 1,1 % passe inaperçu, 8 titres sur 9 non.
      const suropt = suroptimisationMotCle(woven.html, targetKeyword);
      if (suropt.excesH2 > 0) {
        onStep(`🔍 Mot-clé exact dans ${suropt.h2AvecMotCle} titres H2 sur ${suropt.h2Total} (maximum ${MAX_H2_AVEC_MOT_CLE}) — suroptimisation à corriger en relecture.`);
      }
      // ÉLISIONS ORPHELINES — signalées, jamais réparées : choisir entre « le » et
      // « la » demande le genre, et un code qui devine écrit « le toiture ».
      const elisions = elisionsOrphelines(woven.html);
      if (elisions.length) {
        onStep(`⚠️ ${elisions.length} élision(s) orpheline(s) — « ${elisions.slice(0, 2).join(' », « ')} ». À corriger à la main.`);
      }

      const withImages = carryOverImages(sourceHtml, woven.html);
      if (withImages.restored.length) {
        const approx = withImages.restored.filter((i) => i.how === 'section').length;
        onStep(`🖼️ ${withImages.restored.length} image(s) d'origine oubliée(s) par l'IA et réinsérée(s)${approx ? ` — dont ${approx} au niveau de la SECTION seulement, placement à vérifier` : ''}.`);
      }
      if (withImages.missing.length) {
        onStep(`⚠️ ${withImages.missing.length} image(s) d'origine non replacée(s) (le texte qui les entourait a disparu) — signalées, génération conservée.`);
      }

      // ── R5 — le GRAS d'origine est remis, DÉTERMINISTE et NON BLOQUANT ──────
      // EN DERNIER, après R1/R2/R4 : on baliserait sinon des mots que le code
      // s'apprête à réécrire. Un <strong> est un choix éditorial déjà validé —
      // le perdre à la réécriture est une régression que personne ne voit.
      // JAMAIS un rejet : un 4e motif écraserait `currentUser` et ferait perdre
      // la consigne de reprise du verrou externe (règle 8).
      const withBold = carryOverBold(sourceHtml, withImages.html);
      if (withBold.restored.length) {
        onStep(`🅱️ ${withBold.restored.length} terme(s) en gras de l'article d'origine remis en place.`);
      }
      if (withBold.missing.length) {
        onStep(`⚠️ ${withBold.missing.length} terme(s) en gras d'origine non replacé(s) (les mots ne figurent plus dans le texte) — signalés, génération conservée.`);
      }

      // ── PASSE DE GRAS — L'IA NOMME, LE CODE APPLIQUE ────────────────────────
      // Décision d'Andrianina : « une passe incontournable, très importante »,
      // automatique à chaque génération. Elle remplace DEUX tentatives ratées,
      // toutes deux mesurées sur le même article :
      //   • la consigne noyée dans le prompt de refonte → 19 puis 22 gras sur 29
      //     puis 33 étaient de purs chiffres, et 5 sections H2 n'en avaient aucun.
      //     Le modèle SAIT faire, mais une ligne parmi quarante dans un prompt de
      //     82 000 caractères ne pèse rien ;
      //   • la pose par le code (R8) → « War III », « jeu God » : des moitiés de
      //     noms propres. Le code ne sait pas juger.
      // Une passe, une tâche : même remède que les cases de l'audit.
      //
      // APRÈS R5 : la reprise du gras d'origine passe d'abord, sinon la passe
      // remplirait une section que R5 allait de toute façon compléter.
      // NON BLOQUANTE : un échec rend le HTML inchangé — perdre une génération
      // payée pour un gras manquant serait une très mauvaise affaire.
      const passeGras = await runBoldPass({
        html: withBold.html,
        targetKeyword,
        secondaires: Array.isArray(article.mots_cles_secondaires) ? article.mots_cles_secondaires : [],
        modelSelections,
        onStep, onReplace,
      });
      if (passeGras.posed.length) withBold.html = passeGras.html;
      if (passeGras.tokenUsage) trackCall(passeGras.tokenUsage, 'gras');

      // ── CONSTAT — le gras est COMPTÉ PAR SECTION, pas seulement demandé ──────
      // La reprise ci-dessus ne dit rien du gras NEUF : le prompt exige 2 à 4
      // passages par H2 (règle 10), et rien ne vérifiait que le modèle les
      // produisait. Même angle mort que la règle des 20 mots avant d'être mesurée.
      // Les DEUX sens de l'écart sont dits : sous le plancher, la section n'est pas
      // optimisée ; au-dessus du plafond, le gras ne met plus rien en avant.
      const gras = constatGras(withBold.html);
      // PLUS DE PLAFOND : le modèle juge le nombre (objection d'Andrianina, 19/08 —
      // « il comprend le mot-clé et le contenu de l'article »). Ce qu'on annonce
      // désormais, c'est le PLANCHER, qui reste structurel : une section H2 sans
      // gras est un fragment muet pour un moteur génératif.
      if (gras.sousPlancher) {
        const titres = gras.sections.filter((x) => x.ecart === 'sous').map((x) => x.titre);
        onStep(`🅰️ Gras : ${gras.sousPlancher} section(s) sous ${GRAS_MIN_PAR_H2} passage(s) sur ${gras.sections.length} — ${titres.slice(0, 2).join(', ')}${titres.length > 2 ? '…' : ''}`);
      }
      // COMPOSITION : le vrai défaut, celui que le plafond masquait. Une section à
      // 11 passages dont 6 chiffres n'a pas un problème de nombre.
      if (gras.sectionsChiffrees.length) {
        onStep(`🅰️ Gras majoritairement CHIFFRÉ dans ${gras.sectionsChiffrees.length} section(s) (${gras.partChiffres} % sur tout l'article) — ${gras.sectionsChiffrees.slice(0, 2).join(', ')}${gras.sectionsChiffrees.length > 2 ? '…' : ''}`);
      }
      // Fautes franches, distinctes d'un écart de densité : le prompt les interdit.
      if (gras.dansTitre || gras.dansLien || gras.tropLongs) {
        const f = [];
        if (gras.dansTitre) f.push(`${gras.dansTitre} dans un titre`);
        if (gras.dansLien)  f.push(`${gras.dansLien} dans le texte d'un lien`);
        if (gras.tropLongs) f.push(`${gras.tropLongs} de plus de ${GRAS_MAX_MOTS} mots`);
        onStep(`⚠️ Gras mal placé : ${f.join(', ')} — à retirer en relecture.`);
      }

      sanitized = {
        ...check,
        html: withBold.html,
        restoredBold: withBold.restored,
        missingBold: withBold.missing,
        // ── LES TROIS MESURES QUI DISPARAISSAIENT ───────────────────────────
        // Calculées plus haut, émises en `onStep`… et abandonnées là. Or `onStep`
        // meurt avec l'écran de génération : les étapes se replient et rien n'est
        // conservé. C'est le défaut déjà corrigé pour `constatGras` et `boldPass`,
        // et trois mesures avaient été oubliées dans ce geste.
        //
        // Le plafond de 20 mots est au moins RECALCULABLE en phase 4 (fonction
        // pure sur le HTML). La suroptimisation et les élisions, elles, étaient
        // perdues pour de bon : personne ne pouvait plus savoir, une heure ou
        // trois semaines plus tard, ce que la génération avait produit.
        //
        // Valeurs par défaut TOUJOURS posées, jamais `undefined` : la couche de
        // persistance refuse les champs indéfinis, et un article ne doit pas
        // échouer à s'enregistrer pour une mesure absente.
        phrasesLongues:  tropLongues || [],
        suroptimisation: suropt || null,
        elisions:        elisions || [],
        constatGras: gras,
        // RAPPORT DE LA PASSE DE GRAS, PERSISTÉ. Les messages `onStep` disparaissent
        // dès que la génération se termine — les étapes se replient et rien n'est
        // conservé. Impossible alors de savoir ce que la passe a proposé ni ce
        // qu'elle a rejeté : on pilotait à l'aveugle, exactement le travers qu'on
        // corrige partout ailleurs. Ce champ voyage avec l'article.
        boldPass: {
          posed: passeGras.posed,
          ecartes: passeGras.ecartes,
          echecs: passeGras.echecs,
          sansGras: passeGras.sansGras,
          report: passeGras.report,
        },
        restoredImages: withImages.restored,
        missingImages: withImages.missing,
        missingInternal: carried.missing,
        restoredInternal: carried.restored,
        briefConstat,
        briefWritten: woven.written,
        briefMissing: woven.missing,
        briefOffDomain: woven.offDomain,
        briefUnverifiable: woven.unverifiable,
        briefSelfLinks: woven.selfLinks,
        briefReport: reportLine,
      };
    } catch (e) {
      console.warn(`[qat rewrite] essai ${attempt}/3:`, e.message);
      if (attempt >= 3) throw e;
      await new Promise(r => setTimeout(r, 1500 * attempt));
    }
  }

  // Les 3 essais peuvent tous repartir en boucle SANS lever d'exception (JSON
  // illisible ou article_html vide à chaque fois) : sans cette garde, la sortie
  // de boucle laissait `sanitized` à null et l'accès à `sanitized.html` levait
  // une TypeError opaque, illisible pour le rédacteur.
  if (!sanitized) {
    // Diagnostic du dernier essai ajouté EN CLAIR dans le message -- il traverse
    // ensuite errorMessage (batchOrchestrator.js) et s'affiche derrière le
    // bouton "Voir l'erreur" (fix/lots-erreur-repliee-timeout) : c'est le seul
    // endroit où il reste consultable après coup pour un lot.
    const detail = lastParseFailureDetail ? ` Dernier essai — ${lastParseFailureDetail}` : '';
    throw new Error(`L'IA n'a pas produit d'article exploitable après 3 essais (réponse non conforme au format JSON attendu). Relancez la MAJ, ou vérifiez le skill actif dans le menu SKILLS IA.${detail}`);
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
      // ── R2 — CONSTAT, plus une auto-déclaration ─────────────────────────────
      // `ancresPlacees` valait jusqu'ici `article.ancres_placees`, c'est-à-dire ce
      // que le MODÈLE disait avoir fait, affiché au rédacteur sans le moindre
      // contrôle : il pouvait annoncer 7 ancres et n'en poser aucune. C'est
      // désormais le comptage RÉEL des paires du brief présentes dans le HTML
      // final. La déclaration du modèle est conservée à part, pour pouvoir
      // constater l'écart sans le confondre avec la réalité.
      ancresPlacees:   (sanitized.briefConstat || []).filter((l) => l.placed),
      ancresRedigees:  sanitized.briefWritten   || [],   // écrites par le CODE → à relire
      ancresManquantes: sanitized.briefMissing  || [],   // aucun emplacement autorisé
      ancresHorsDomaine: sanitized.briefOffDomain || [], // écartées (règle 8)
      // Écartées faute d'URL d'article (contenu collé) : ce n'est PAS « hors
      // domaine », et le dire ainsi enverrait le rédacteur chercher un problème
      // inexistant sur une URL de son propre site.
      ancresNonVerifiables: sanitized.briefUnverifiable || [],
      ancresAutoLien:  sanitized.briefSelfLinks || [],   // l'URL est celle de l'article
      ancresBrief:     sanitized.briefConstat   || [],   // le constat complet, placées ou non
      // Placées, mais dans un emplacement que la règle interdit (titre, tableau,
      // FAQ, TL;DR, citation) : le comptage ne doit pas valider ça en silence.
      ancresMalPlacees: (sanitized.briefConstat || []).filter((l) => l.placed && l.misplaced),
      ancresRapport:   sanitized.briefReport || '',      // la phrase de compte rendu, conservée
      // ── MESURES DU GRAS, RENDUES AVEC L'ARTICLE ─────────────────────────────
      // Elles vivaient sur `sanitized` et s'arrêtaient là : jamais renvoyées, donc
      // jamais persistées. Le seul canal était `onStep`, dont les messages
      // disparaissent dès la fin de la génération (les étapes se replient et rien
      // n'est conservé). Conséquence constatée le 19/08 : impossible de savoir
      // pourquoi la passe de gras n'avait rien posé — on pilotait à l'aveugle sur
      // la mesure censée nous éclairer.
      constatGras:     sanitized.constatGras || null,
      grasPasse:       sanitized.boldPass || null,
      ancresDeclareesIa: Array.isArray(article.ancres_placees) ? article.ancres_placees : [],
      notesRedaction:  String(article.notes_redaction || '').trim(),
      strippedExternalLinks: sanitized.stripped,
      // R1 — liens internes d'origine : ré-enveloppés automatiquement, ou non
      // repris (avertissement, jamais un rejet).
      restoredInternalLinks: sanitized.restoredInternal || [],
      missingInternalLinks:  sanitized.missingInternal  || [],
      // R4 — images d'origine : réinsérées automatiquement (`how` dit comment :
      // 'contexte' = place exacte retrouvée, 'section' = APPROXIMATIF), ou non
      // replacées (avertissement, jamais un rejet).
      restoredImages: sanitized.restoredImages || [],
      missingImages:  sanitized.missingImages  || [],
      // R5 — le gras d'origine. Ces deux champs étaient calculés puis ABANDONNÉS :
      // `sanitized.restoredBold` et `sanitized.missingBold` ne franchissaient pas
      // ce retour, donc n'étaient jamais persistés. Trouvé par le test de la
      // chaîne de verrous (`chaineVerrous.test.js`) : R5 était la QUATRIÈME mesure
      // oubliée dans le geste qui a persisté `constatGras` et `boldPass`.
      // Sans `missingBold`, on ne peut pas signaler à la publication le gras
      // d'origine perdu — faute de savoir lequel manquait.
      restoredBold: sanitized.restoredBold || [],
      missingBold:  sanitized.missingBold  || [],
      // ── LES TROIS MESURES DE STYLE, RENDUES AVEC L'ARTICLE ─────────────────
      // Une consigne qu'on ne mesure jamais est une consigne dont on ne sait
      // rien ; une mesure qu'on ne conserve pas revient au même.
      phrasesLongues:  sanitized.phrasesLongues  || [],
      suroptimisation: sanitized.suroptimisation || null,
      elisions:        sanitized.elisions        || [],
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
    // Le message doit nommer la VRAIE cause : un échec d'appel à l'IA (compte
    // désactivé, crédits épuisés, réseau) n'a rien à voir avec une réponse
    // illisible, et n'appelle pas du tout la même action.
    if (auditRes.apiError) {
      throw new Error(`Audit impossible — l'appel à l'IA a échoué après 3 essais : ${auditRes.apiError.message}`);
    }
    throw new Error("Audit impossible — l'IA a répondu mais sa réponse n'était pas exploitable après 3 essais. Refonte annulée pour ne pas réécrire sans diagnostic.");
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
