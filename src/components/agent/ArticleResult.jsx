import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import axios from 'axios';
import { useSelector, useDispatch } from 'react-redux';
import { motion, AnimatePresence } from 'framer-motion';
import toast from 'react-hot-toast';
import {
  Copy, Code, FileText, Globe, ExternalLink,
  ChevronDown, CheckCircle2, AlertTriangle, Info,
  RefreshCw, ArrowRight, Link, ChevronUp,
  Clipboard, ClipboardCheck, Sparkles, Loader, ShieldCheck,
  Plus, Link2, X, Tag, Search, Image,
  Undo2, Redo2, Scissors, Trash2, Lock, CheckCheck, Crosshair, Gauge, XCircle, Save,
} from 'lucide-react';
import { exportAsText, exportAsHtml, exportAsMarkdown, copyToClipboard, stripParasiticFontSize } from '../../utils/export';
import { publishToWordPress, updatePost, findPostByUrl } from '../../services/wordpress';
import BubbleToolbar from './BubbleToolbar';
import TableToolbar from './TableToolbar';
import DocNavigator from './DocNavigator';
import { runReviewAgent, generateAltText, generateSeoMeta, suggestCategory, aggregateCallsByPass } from '../../services/agent';
import { scrapeUrl } from '../../services/scraper';
import { applyAllDiffs, applyDiff, applyAddition, applyReplacementFuzzy, insertNearClosestParagraph, repairStructureEl, stripDiffDeletions, wrapLooseTextIntoParagraphs, moveFaqToEnd, normalizeText, enforceExternalLinkPolicy, balanceFragment, carryOverInternalLinks } from '../../utils/diff';
import { weaveBriefLinks } from '../../utils/internalWeave';
import { carryOverImages } from '../../utils/imageCarry';
import { analyzeSeo } from '../../utils/seoCheck';
import { editorMetaForArticle } from '../../utils/editorMeta';
import {
  findFaqBlock, isInsideFaq, getQAGroups, findQAIndex, moveQAGroup, deleteQAGroup,
  insertQAAfter, serializeFaqBlock, removeFaqBlock, moveFaqBlockBySection,
  insertFaqHtmlAtCaret, rectOfNodes, normalizeFaqToAccordion, dedupeFaqHeading,
} from '../../utils/faq';
import { blockMeta, accord, blockAtRange, insertBlockHtml, makeTablesResponsive, tableBlockOf, unwrapTransparentDivs, normalizeTableStructure, diffClusterOf, cleanBlocksHtml } from '../../utils/blocks';
import { scrollBlockIntoView, flashBlock } from '../../utils/scrollBlock';
import { findBlockForPassage, replacePassageInDom, highlightPassage } from '../../utils/locatePassage';
import { resetAgent, setUpdatedContent, setDiff, setSources, setTokenUsage, setWpData, setDraftStatus, setCurrentArticleId,
  setQatArticle, setPhase, setPhaseStatus, setMajScope, setObsolescenceReport, appliquerSuggestionObsolescence,
  setAuditJson, setAnalysis, setTargetKeyword } from '../../store/slices/agentSlice';
import { runQatRewrite, runQatAudit } from '../../services/agentQat';
import { runStyleFixAgent } from '../../services/agentStyle';
import {
  PHASE_AUDIT, PHASE_GENERATION, PHASE_OBSOLESCENCE, PHASE_RELECTURE,
  TODO, DONE, RUNNING, ERROR, SCOPE_SIMPLE, scopeProposedByAudit,
} from '../../constants/majPhases';
import { cleanLinkRows, emptyLinkRow } from '../../constants/majMode';
import { auditSuggestedLinkRows, mergeLinkRows } from '../../utils/auditSuggestions';
import { buildGenerationPrompt, DEFAULT_GENERATION_TEMPLATE, DEFAULT_VERIFICATION_TEMPLATE } from '../../utils/generationPrompt';
import { defaultAuditSelection, unselectedFactualFields, isDefaultSelection } from '../../utils/auditSelection';
import { decodeEntities } from '../../utils/htmlText';
import { setProfile } from '../../store/slices/authSlice';
import PhaseStepper from './PhaseStepper';
import PhaseAudit from './PhaseAudit';
import PhaseGeneration from './PhaseGeneration';
import PhaseObsolescence from './PhaseObsolescence';
import PhaseRelecture from './PhaseRelecture';
import RewritePanel from './RewritePanel';
import ImageAltCaptionPanel from './ImageAltCaptionPanel';
import SectionRewritePanel from './SectionRewritePanel';
import { updateInHistory, addToHistory } from '../../store/slices/articlesSlice';
import { addArticleStat } from '../../store/slices/statsSlice';
import { removePendingItem } from '../../store/slices/pendingSlice';
import {
  saveArticle, updateArticleHtml,
  acquireEditLock, heartbeatEditLock, releaseEditLock, watchEditLock, isLockActive, LOCK_HEARTBEAT_MS,
} from '../../services/firebase';
import { saveDraft, flushDraftRemote, onDraftStatus, clearDraft } from '../../services/articleDraft';
import articleTimeTracker from '../../services/articleTimeTracker';
import { renderMarkdown, emojiToIcons, unwrapProseFences, trimAuditForDisplay } from '../../utils/markdown';
import { validateImageFile } from '../../utils/uploadLimits';
import { useNavigate } from 'react-router-dom';

import QatAuditPanel from './QatAuditPanel';

/**
 * Hauteur de la barre du haut (celle de « Vider le cache »), MESURÉE dans le
 * navigateur. Elle sert à deux endroits — le seuil de bascule du stepper flottant
 * et son `top` — et deux littéraux séparés auraient fini par diverger : le stepper
 * se serait alors collé un pixel trop haut ou trop bas, sans que rien ne le dise.
 */
const TOPBAR_HEIGHT = 62;

const TAB_AUDIT = 'audit';
const TAB_AVANT = 'avant';
const TAB_APRES = 'apres';

// Ajoute un paramètre anti-cache à l'URL de l'article publié : la fenêtre
// ouverte après publication montre la version fraîche, jamais celle du cache
// WordPress/CDN (l'équipe croyait la MAJ non appliquée).
const withNoCache = (url) => {
  try {
    const u = new URL(url);
    u.searchParams.set('nocache', String(Date.now()));
    return u.toString();
  } catch { return url; }
};

// ── Nettoyage du contenu collé dans la vue diff ──────────────────────────────
// Règle : aucun style collé. On conserve la STRUCTURE (paragraphes, titres,
// listes, liens, tableaux) et le GRAS (b/strong — bonne pratique SEO : les
// mots-clés en gras doivent le rester), mais on retire tout le reste de la
// mise en forme de caractère (couleurs, fonds, polices, italique, souligné…).
const PASTE_KEEP_TAGS = new Set([
  'P', 'BR', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'UL', 'OL', 'LI', 'A', 'BLOCKQUOTE',
  'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'TD', 'TH', 'HR',
  'B', 'STRONG',
]);
// Balises supprimées intégralement (média / non-texte / scripts)
const PASTE_DROP_TAGS = new Set([
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'IMG', 'PICTURE', 'SOURCE', 'IFRAME', 'VIDEO',
  'AUDIO', 'SVG', 'CANVAS', 'OBJECT', 'EMBED', 'FORM', 'INPUT', 'BUTTON', 'SELECT',
  'TEXTAREA', 'HEAD', 'META', 'LINK', 'TITLE',
]);
// Toute autre balise (SPAN, I, EM, U, S, FONT, MARK, DIV…) est "débalisée" :
// on garde son contenu mais on supprime la balise de mise en forme.
// Cas particulier : un élément débalisé portant un gras INLINE
// (style="font-weight:bold/600+" — collages Google Docs/Word) est converti en
// <strong> pour que le gras SEO survive au nettoyage.

const hasInlineBold = (el) => {
  const fw = (el.getAttribute?.('style') || '').match(/font-weight\s*:\s*([a-z0-9]+)/i)?.[1];
  if (!fw) return false;
  return fw.toLowerCase() === 'bold' || fw.toLowerCase() === 'bolder' || parseInt(fw, 10) >= 600;
};

const sanitizePastedHtml = (html) => {
  const root = document.createElement('div');
  root.innerHTML = html;

  const walk = (node) => {
    // Snapshot : on mute l'arbre pendant l'itération
    Array.from(node.childNodes).forEach((child) => {
      if (child.nodeType === 3) return;           // texte : conservé tel quel
      if (child.nodeType !== 1) { child.remove(); return; } // commentaires, etc.

      const tag = child.tagName;
      if (PASTE_DROP_TAGS.has(tag)) { child.remove(); return; }

      // Gras exprimé en style inline (Google Docs/Word collent <span
      // style="font-weight:700">) → converti en <strong> AVANT le nettoyage
      // des enfants, pour préserver le gras des mots-clés (SEO).
      if (!PASTE_KEEP_TAGS.has(tag) && hasInlineBold(child)) {
        const strong = document.createElement('strong');
        while (child.firstChild) strong.appendChild(child.firstChild);
        child.parentNode.replaceChild(strong, child);
        walk(strong);
        return;
      }

      walk(child); // nettoyer les enfants AVANT de décider du sort du parent

      if (PASTE_KEEP_TAGS.has(tag)) {
        // Conserver la balise mais retirer TOUS les attributs (style, class,
        // color, bgcolor, align, font…) — seul href des liens est gardé.
        Array.from(child.attributes).forEach((attr) => {
          if (tag === 'A' && attr.name.toLowerCase() === 'href') return;
          child.removeAttribute(attr.name);
        });
        if (tag === 'A') {
          child.setAttribute('target', '_blank');
          child.setAttribute('rel', 'noopener noreferrer');
        }
      } else {
        // Débaliser : remonter les enfants à la place de l'élément
        const parent = child.parentNode;
        while (child.firstChild) parent.insertBefore(child.firstChild, child);
        parent.removeChild(child);
      }
    });
  };

  walk(root);
  return root.innerHTML;
};

export default function ArticleResult() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const agent = useSelector(s => s.agent);
  const settings = useSelector(s => s.settings);
  const skills = useSelector(s => s.skills.list);
  // Le chargement serveur des skills a-t-il abouti ? Voir skillsSlice : à
  // l'ouverture, `skills` n'est que le cache local, qui peut ne pas porter le
  // cerveau. Sans cette distinction, l'audit était REFUSÉ pendant la seconde qui
  // précède l'arrivée de la liste, avec un message qui envoyait chercher un skill
  // pourtant présent. Constaté en production le 2026-08-17.
  const skillsBootstrapped = useSelector(s => s.skills.bootstrapped);
  const knowledge = useSelector(s => s.knowledge.list);
  const authUser = useSelector(s => s.auth);
  const firebaseReady   = useSelector(s => s.settings.firebaseReady);
  const wpSites         = useSelector(s => s.wordpress.sites);
  const articlesHistory = useSelector(s => s.articles.history);
  const pendingItems    = useSelector(s => s.pending.list);
  const authUid         = useSelector(s => s.auth.uid);
  const authUsername    = useSelector(s => s.auth.username);
  const draftUserId     = authUid || authUsername || null;  // clé du brouillon autosave
  const historyList     = useSelector(s => s.articles.history) || []; // pour savoir si l'article est déjà archivé
  const wpMcpData       = agent.wpData || null;  // données MCP WordPress (post ID, featured_media…)

  // Mode validation CQ : l'item pending avec cet ID est en statut 'a_valider'
  const cqItem = pendingItems.find(i => i.id === agent.currentArticleId && i.status === 'a_valider') || null;

  // Rapport d'audit (mode cerveau) — depuis le state agent ou la review rouverte
  const auditReport = agent.audit || cqItem?.majResult?.audit || '';
  // Mode « Audit QAT + Refonte » : l'audit est un OBJET (schéma QAT) et l'article
  // a été réécrit d'un bloc. Les deux flux coexistent (double flux temporaire) :
  // `auditJson` présent = mode QAT, sinon rapport markdown historique.
  const auditJson  = agent.auditJson  || cqItem?.majResult?.auditJson  || null;
  const qatArticle = agent.qatArticle || cqItem?.majResult?.qatArticle || null;
  const isQat      = !!auditJson || !!qatArticle;
  // Parcours en quatre phases. L'avancement vit dans le store et est PERSISTE par
  // l'autosave existant : on ne tient pas un second compteur en parallele.
  const phase       = agent.phase || PHASE_AUDIT;
  const phaseStatus = agent.phaseStatus || {};
  // ── STEPPER : EN PLACE, PUIS FLOTTANT DÈS QU'IL SORT DE L'ÉCRAN ────────────
  //
  // Corrigé le 19 août 2026 : la première version le rendait `fixed` en
  // permanence, et il MASQUAIT le titre « Articles » et le bouton « Nouvel
  // article », qui vivent tout en haut de la page — au-dessus de ce composant,
  // donc impossibles à décaler d'ici. Un bandeau qui cache le titre est pire que
  // pas de bandeau.
  //
  // Le stepper reste donc DANS LE FLUX à sa place d'origine, et une copie
  // `fixed` prend le relais uniquement quand l'original passe sous la barre du
  // haut. Aucune réserve de place n'est nécessaire : l'original occupe toujours sa
  // place dans le document, il est simplement hors écran quand la copie s'affiche.
  // Deux avantages sur la version précédente : rien n'est jamais masqué, et il n'y
  // a aucun décalage de mise en page au premier rendu.
  const stepperRef = useRef(null);
  const [stepperFlottant, setStepperFlottant] = useState(false);
  useEffect(() => {
    const el = stepperRef.current;
    if (!el) return undefined;
    // `IntersectionObserver` avec une marge haute de -62 px : l'original cesse
    // d'« intersecter » exactement quand il passe sous la barre du haut. Plus sobre
    // qu'un écouteur de défilement, qui se déclencherait à chaque pixel.
    if (typeof IntersectionObserver === 'undefined') return undefined;
    const io = new IntersectionObserver(
      ([e]) => setStepperFlottant(!e.isIntersecting),
      { rootMargin: `-${TOPBAR_HEIGHT}px 0px 0px 0px`, threshold: 0 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  // Vrai si un skill SKILL.md est actif → l'onglet Audit est attendu (affiché même vide).
  const hasBrainSkill = (skills || []).some(s => s?.format === 'skillmd' && s.active !== false && s.body);

  // URL de l'article courant (pour retrouver le post WP à mettre à jour)
  const currentArticle = articlesHistory.find(a => a.id === agent.currentArticleId);
  const articleUrl     = cqItem?.url || currentArticle?.url || '';

  // ── Tracking du temps de travail sur l'article ouvert dans l'éditeur ────────
  // Démarre quand un article est chargé (CQ depuis MajEnAttente, réouverture
  // Historique, ou après analyse — begin() est idempotent sur le même article),
  // s'arrête au changement d'article / démontage. Singleton mono-article : pas
  // de double comptage avec le begin() du lancement d'analyse (Articles.jsx).
  useEffect(() => {
    const id = agent.currentArticleId;
    if (!id || !draftUserId) return undefined;
    articleTimeTracker.begin({
      articleId: id,
      title:     currentArticle?.title || cqItem?.title || '',
      url:       articleUrl,
      userId:    draftUserId,
      userName:  [authUser?.prenom, authUser?.nom].filter(Boolean).join(' ') || authUser?.username || '',
      userRole:  authUser?.role || '',
    });
    return () => articleTimeTracker.end();
    // title/url volontairement hors deps : leur chargement async ne doit pas
    // relancer begin/end (le doc temps est déjà créé avec les bonnes métas)
  }, [agent.currentArticleId, draftUserId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Polices proposées dans la barre d'outils :
  //  • analyse fraîche → wpMcpData.siteFonts (récupéré via MCP)
  //  • réouverture historique (wpMcpData null) → cache du site correspondant à l'URL
  //    (renseigné lors d'une analyse précédente, persisté en localStorage) — aucune requête
  const resolvedSiteFonts = useMemo(() => {
    if (wpMcpData?.siteFonts?.length) return wpMcpData.siteFonts;
    if (!articleUrl) return [];
    try {
      const h = new URL(articleUrl).hostname.replace(/^www\./, '');
      const site = wpSites.find(s => {
        try { return new URL(s.url).hostname.replace(/^www\./, '') === h; }
        catch { return false; }
      });
      return site?.fonts || [];
    } catch { return []; }
  }, [wpMcpData, articleUrl, wpSites]);

  // Site WordPress connecté correspondant à l'article : par correspondance d'hôte
  // avec l'URL de l'article — SOURCE DE VÉRITÉ (couvre la réouverture depuis
  // l'historique). Le wpData mémorisé (MCP) ne sert de repli que si l'article n'a
  // pas d'URL : il peut être périmé (article précédent) → les médias partaient
  // dans la médiathèque du MAUVAIS site. Sert à savoir si on peut téléverser une
  // image à la une dans la médiathèque WP.
  const resolvedSite = useMemo(() => {
    if (articleUrl) {
      try {
        const h = new URL(articleUrl).hostname.replace(/^www\./, '');
        return wpSites.find(s => {
          try { return new URL(s.url).hostname.replace(/^www\./, '') === h; }
          catch { return false; }
        }) || null;
      } catch { return null; }
    }
    if (wpMcpData?.siteId) {
      return wpSites.find(x => x.id === wpMcpData.siteId) || null;
    }
    return null;
  }, [wpMcpData, articleUrl, wpSites]);

  // Téléverse un fichier local (image OU vidéo) vers la médiathèque WP du site de
  // l'article et renvoie l'URL du média (ou '' en cas d'échec). Réutilise l'endpoint
  // /api/wp-upload-file (déjà utilisé pour l'image à la une). Passé à la barre d'édition.
  const uploadMediaToWp = useCallback(async (file) => {
    if (!resolvedSite) { toast.error('Aucun site WordPress connecté pour cet article'); return ''; }
    if (!file) return '';
    try {
      const formData = new FormData();
      formData.append('file', file, file.name);
      formData.append('site', JSON.stringify({ url: resolvedSite.url, username: resolvedSite.username, password: resolvedSite.password }));
      const resp = await axios.post('/api/wp-upload-file', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 180000,   // les vidéos peuvent être lourdes
      });
      if (resp.data?.success && resp.data.url) {
        toast.success('Fichier téléversé dans la médiathèque WordPress');
        return resp.data.url;
      }
      toast.error(resp.data?.error || 'Téléversement impossible');
      return '';
    } catch (e) {
      toast.error(e.response?.data?.error || 'Téléversement impossible');
      return '';
    }
  }, [resolvedSite]);

  // Atterrissage sur l'AUDIT quand il est attendu (priorité produit) ; sinon APRÈS.
  const [activeTab, setActiveTab] = useState((auditReport || hasBrainSkill) ? TAB_AUDIT : TAB_APRES);
  const [showExport, setShowExport] = useState(false);
  const [showWP, setShowWP] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [wpFoundPost, setWpFoundPost] = useState(null);         // post WP trouvé par URL
  const [wpSearching, setWpSearching] = useState(false);
  const [wpNotFoundReason, setWpNotFoundReason] = useState(''); // raison si non trouvé
  const [hasContent, setHasContent] = useState(false);
  const [diffMode, setDiffMode] = useState(true);

  // Bascule « code | rendu » des blocs HTML de l'audit (délégation de clic, car le
  // contenu est injecté via dangerouslySetInnerHTML — voir enhanceCodePreviews).
  const handleAuditToggle = (e) => {
    const btn = e.target.closest('[data-cp]');
    if (!btn) return;
    const block = btn.closest('[data-cp-block]');
    if (!block) return;
    const wantRender = btn.getAttribute('data-cp') === 'render';
    block.querySelectorAll('[data-cp]').forEach((b) =>
      b.classList.toggle('cp-active', (b.getAttribute('data-cp') === 'render') === wantRender),
    );
    const codePane = block.querySelector('.cp-pane-code');
    const renderPane = block.querySelector('.cp-pane-render');
    if (codePane) codePane.hidden = wantRender;
    if (renderPane) renderPane.hidden = !wantRender;
  };

  // ── Sections repliables (repliées par défaut) — focus sur la vue diff ───────
  const [showMissed, setShowMissed]   = useState(true);   // Suggestions à appliquer — déplié par défaut (action mise en évidence)
  const [showDetails, setShowDetails] = useState(false);  // Détail des modifications
  const [showSources, setShowSources] = useState(false);  // Sources vérifiées
  const [showAnalysis, setShowAnalysis] = useState(false); // Synthèse de l'agent — repliée : les onglets Audit/Avant/Après restent visibles directement
  const [showCatsBlock, setShowCatsBlock] = useState(false); // Catégories WordPress — repliées par défaut (bloc volumineux, rarement modifié)
  // ── TROIS BLOCS DÉPLIABLES, DÉPLIÉS PAR DÉFAUT (demande d'Andrianina, 19/08) ──
  // L'objectif est nommé : « pouvoir accéder rapidement à la Vue diff / Vue finale ».
  // Sur un article long, ces trois blocs repoussaient l'éditeur loin sous la ligne
  // de flottaison. Dépliés par défaut parce qu'ils portent des informations qu'on
  // veut voir au premier coup d'œil — c'est le REPLI qui est l'option, pas
  // l'affichage : replier par défaut aurait caché le bilan de l'analyse.
  const [showStats, setShowStats]     = useState(true);   // bandeau « Analyse terminée »
  const [showSeoMeta, setShowSeoMeta] = useState(true);   // SEO Meta (Yoast / SEOPress)
  const [showAmpleur, setShowAmpleur] = useState(true);   // Ampleur de la mise à jour
  // Titre éditable de l'article
  const [editedTitle, setEditedTitle] = useState('');
  // titleDirty = true uniquement si l'utilisateur a tapé dans le champ
  // → le titre n'est envoyé à WordPress QUE si l'utilisateur l'a modifié
  const [titleDirty, setTitleDirty]   = useState(false);

  // ── SEO Meta (Yoast / SEOPress) ───────────────────────────────────────────────
  const [seoTitle,       setSeoTitle]       = useState('');
  const [seoDescription, setSeoDescription] = useState('');

  // ── MÉTAS DÉJÀ VALIDÉES, quelle que soit leur provenance ───────────────────
  // Deux sources portent les métas SEO retouchées à la main :
  //   • `agent.editorMeta` — le brouillon PRIVÉ du membre (un par membre, local
  //     puis distant) ;
  //   • l'ARTICLE lui-même — `seoMeta` / `publishDate` / `editedTitle`, écrits
  //     par `updateArticleHtml(..., extraFields)` à chaque enregistrement.
  // Seule la première était lue sur le parcours « Faire une MAJ » : cache vidé,
  // autre poste ou autre membre, et `agent.editorMeta` arrivait NUL — l'effet
  // `qatArticle` ci-dessous réécrivait alors les champs avec les métas GÉNÉRÉES,
  // effaçant en silence la retouche du rédacteur. Elle était pourtant bien en
  // base : c'est la RELECTURE qui manquait, pas l'écriture.
  //
  // ── ET IL DOIT ÊTRE LE BROUILLON DE CET ARTICLE ────────────────────────────
  // `agent.editorMeta` est un brouillon par MEMBRE, pas par article, et il est lu
  // en PRIORITÉ juste en dessous. Une réouverture qui ne le redispatchait pas
  // laissait donc les métas du DERNIER article travaillé gagner contre celles de
  // l'article ouvert. Constaté en production le 20 août 2026 : un article de
  // terrassier.net rouvert depuis l'Historique affichait le titre, le meta title,
  // la meta description et le mot-clé cible d'un article de fosseseptique.fr.
  // Ce n'était pas cosmétique — ces métas partent dans `postData.seoMeta` à la
  // publication, donc le meta title d'un autre site était publiable.
  //
  // Six champs avaient déjà reçu ce correctif UN PAR UN (wpData, auditJson,
  // qatArticle, targetKeyword, briefLinkRows, auditSelection), chacun avec son
  // commentaire « dispatché même à vide ». Le rappel ne tient pas à l'échelle :
  // on change le PORTEUR. Le brouillon dit désormais à quel article il appartient,
  // et celui d'un autre article est écarté EN ENTIER — pas seulement ses métas
  // SEO : `editedTitle`, `publishDate`, l'ALT de l'image à la une et les
  // catégories fuyaient par le même trou (et une catégorie change le permalien).
  //
  // `articleId` absent = brouillon écrit avant ce correctif, ou article encore
  // jamais enregistré : accepté, exactement comme avant. Le prochain autosave le
  // datera. La garde ne se déclenche que sur une NON-CORRESPONDANCE constatée.
  const metaValidee = useMemo(() => {
    // La règle vit dans `utils/editorMeta.js`, pour être VERROUILLÉE PAR UN TEST :
    // ce trou s'est déjà rouvert six fois, chaque fois sur un champ différent.
    const m = editorMetaForArticle(agent.editorMeta, agent.currentArticleId);
    if (m && (m.seoTitle || m.seoDescription)) return m;   // le brouillon est le plus frais
    const src = currentArticle || cqItem?.majResult || null;
    const sm = src?.seoMeta;
    if (sm && (sm.seoTitle || sm.seoDescription)) {
      return {
        ...(m || {}),
        seoTitle:       sm.seoTitle       || '',
        seoDescription: sm.seoDescription || '',
        publishDate:    src.publishDate   || m?.publishDate  || '',
        editedTitle:    src.editedTitle   || m?.editedTitle  || '',
        titleDirty:     !!src.editedTitle || !!m?.titleDirty,
      };
    }
    return m || null;
  }, [agent.editorMeta, agent.currentArticleId, currentArticle, cqItem]);
  const [seoGenerating,  setSeoGenerating]  = useState(false);
  // Date de publication de la MAJ (optionnelle) — format input datetime-local
  // « YYYY-MM-DDTHH:mm ». Vide = WordPress garde la date existante du post.
  const [publishDate,    setPublishDate]    = useState('');
  // Ref pour n'auto-générer qu'une seule fois par analyse (évite les re-runs)
  const seoGeneratedRef = useRef(false);

  // Extrait le premier H1 d'un HTML brut (même logique qu'Articles.jsx)
  const extractH1FromHtml = (html) => {
    if (!html) return '';
    try {
      const div = document.createElement('div');
      div.innerHTML = html;
      return div.querySelector('h1')?.textContent?.trim() || '';
    } catch { return ''; }
  };

  // Priorité 3 : article collé en TEXTE BRUT (aucun H1, pas de titre WP) — la
  // première ligne non vide du texte fait office de titre (tronquée à 90 car.
  // sur un mot). Sans ce repli, le champ Titre restait vide et l'article
  // finissait « (Sans titre) » dans l'Historique et les Archives.
  const firstLineAsTitle = (content) => {
    if (!content) return '';
    try {
      const div = document.createElement('div');
      div.innerHTML = content;
      const line = (div.textContent || '').split('\n').map(l => l.trim()).find(Boolean) || '';
      if (line.length <= 90) return line;
      return `${line.slice(0, 90).replace(/\s+\S*$/, '')}…`;
    } catch { return ''; }
  };

  useEffect(() => {
    setTitleDirty(false);
    // Priorité 1 : titre WP réel (API REST) — source la plus fiable
    // DÉCODÉ : `title.rendered` de l'API REST WordPress porte les ENTITÉS
    // (« découvrez l&rsquo;ordre de jeu »). Poussé tel quel dans un <input>, React
    // les affiche littéralement — et c'est cette chaîne-là qui repartait à la
    // publication. Le titre n'était pas seulement laid, il était faux à la source.
    // `decodeEntities` et non `htmlToText` : un titre est du TEXTE, et
    // « Comparatif <10 kW » passé par innerHTML perdrait sa fin en silence.
    const wpTitle = decodeEntities(wpMcpData?.wpTitle || '');
    if (wpTitle) { setEditedTitle(wpTitle); return; }
    // Priorité 2 : H1 de l'article original — jamais le slug d'URL
    //
    // DÉCODÉ, comme les deux autres sources. Le correctif du 18/08 traitait
    // `wpTitle` et le titre enregistré, mais pas les deux chemins qui passent par
    // le DOM : ceux-là ne retirent qu'UNE couche d'entités, celle de `textContent`.
    // Sur un HTML DOUBLEMENT ÉCHAPPÉ (`l&amp;rsquo;ordre`, cas d'un article collé)
    // il en reste donc une : le champ Titre affichait « découvrez l&rsquo;ordre »
    // en clair, et c'est cette chaîne qui repartait à la publication.
    // Constaté en production le 19 août 2026, sur le chemin H1 — précisément celui
    // qui sert quand aucune URL n'est renseignée, donc le plus fréquent des trois.
    const h1 = decodeEntities(extractH1FromHtml(agent.originalContent));
    // Priorité 3 : titre déjà enregistré pour cet article (file d'attente puis
    // historique). Il vient du relevé WordPress fait au lancement de la MAJ, donc
    // il est fiable — contrairement à la première ligne du contenu, qui sur un
    // article RÉCUPÉRÉ PAR SCRAPING capte volontiers un titre de widget de la
    // page (« Suivez … », « Articles récents »…). Ce titre parasite n'était pas
    // publié (protégé par titleDirty) mais il était archivé dans l'Historique
    // via handleTerminer, et affiché au rédacteur comme s'il était correct.
    // Même origine WordPress que wpTitle, donc mêmes entités à décoder.
    const enregistre = decodeEntities(cqItem?.title || currentArticle?.title || '');
    // Priorité 4 : première ligne du texte brut collé (dernier recours)
    // Le dernier recours passe par le DOM lui aussi : même couche manquante.
    setEditedTitle(h1 || enregistre || decodeEntities(firstLineAsTitle(agent.originalContent)));
  }, [wpMcpData?.wpTitle, agent.originalContent, cqItem?.title, currentArticle?.title]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset SEO fields + état catégories quand on passe à un nouvel article.
  // Réinitialiser catsDirty/selectedCategories/catSuggestedRef évite d'hériter d'un
  // état « dirty » d'un article précédent (sinon on pourrait publier des catégories
  // non désirées → changement de permalien → 404).
  const qatMetaRef = useRef(false);
  useEffect(() => {
    seoGeneratedRef.current = false;
    qatMetaRef.current = false;   // symétrie : sans ça, un 2e article QAT ouvert
                                  // sans démontage ne reprenait pas ses métas
    setSeoTitle('');
    setSeoDescription('');
    setCatsDirty(false);
    setSelectedCategories([]);
    catSuggestedRef.current = false;
  }, [agent.currentArticleId]);

  // Génération SEO — utilisée par l'auto-génération ET le bouton manuel.
  // Réessaie une fois en cas d'échec ou de réponse vide, puis signale l'erreur
  // (sans ce retour visible, un échec laissait les champs vides sans explication).
  const runSeoGeneration = useCallback(async () => {
    if (!agent.updatedContent) return;
    setSeoGenerating(true);
    const title = wpMcpData?.wpTitle || extractH1FromHtml(agent.originalContent) || '';
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        const { seoTitle: t, seoDescription: d } = await generateSeoMeta(agent.updatedContent, title, settings.modelSelections || null);
        if (t || d) {
          if (t) setSeoTitle(t);
          if (d) setSeoDescription(d);
          return;
        }
      }
      toast.error('Génération SEO vide — réessayez avec le bouton Régénérer.');
    } catch {
      toast.error('Génération SEO impossible — réessayez avec le bouton Régénérer.');
    } finally {
      setSeoGenerating(false);
    }
  }, [agent.updatedContent, agent.originalContent, wpMcpData?.wpTitle]); // eslint-disable-line react-hooks/exhaustive-deps

  // Mode QAT : le skill produit déjà le titre SEO, la méta-description et le H1
  // aux bonnes longueurs. On les reprend tels quels au lieu de relancer un appel
  // generateSeoMeta, et on marque le titre « dirty » pour qu'il soit RÉELLEMENT
  // envoyé à WordPress (sans ça, le H1 réécrit ne partait jamais).
  useEffect(() => {
    if (!qatArticle || qatMetaRef.current) return;
    // Des métas déjà validées sont du travail humain : on ne les écrase pas.
    // `metaValidee`, et non `agent.editorMeta` : les métas persistées sur
    // l'ARTICLE doivent compter autant que celles du brouillon privé.
    const m = metaValidee;
    if (m && (m.seoTitle || m.seoDescription)) { qatMetaRef.current = true; return; }
    qatMetaRef.current = true;
    seoGeneratedRef.current = true;   // neutralise l'auto-génération du flux historique
    if (qatArticle.titreSeo)        setSeoTitle(qatArticle.titreSeo);
    if (qatArticle.metaDescription) setSeoDescription(qatArticle.metaDescription);
    if (qatArticle.h1 && !titleDirty) { setEditedTitle(qatArticle.h1); setTitleDirty(true); }
  }, [qatArticle, metaValidee]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-génération SEO dès que la MAJ est prête (une seule fois par analyse)
  useEffect(() => {
    if (!agent.updatedContent || seoGeneratedRef.current) return;
    // Des métas RESTAURÉES (brouillon autosave / archive via « MAJ en attente »)
    // arrivent dans le même lot Redux que le contenu : ne JAMAIS les écraser
    // par une régénération automatique — c'est le travail déjà validé de
    // l'équipe. Le bouton « Régénérer » reste disponible pour forcer.
    const m = metaValidee;
    if (m && (m.seoTitle || m.seoDescription)) {
      seoGeneratedRef.current = true;
      return;
    }
    seoGeneratedRef.current = true;
    runSeoGeneration();
  }, [agent.updatedContent, metaValidee, runSeoGeneration]);

  // ── Catégories WordPress ──────────────────────────────────────────────────────
  const [wpCategories, setWpCategories]       = useState([]);
  const [selectedCategories, setSelectedCategories] = useState([]);
  // true UNIQUEMENT si l'utilisateur modifie la sélection à la main : sinon on ne
  // réécrit JAMAIS les catégories du post à la publication (préserve son permalien → pas de 404).
  const [catsDirty, setCatsDirty] = useState(false);
  const [catLoading, setCatLoading]           = useState(false);
  const [catSearch, setCatSearch]             = useState('');
  const [showCatPanel, setShowCatPanel]       = useState(false);

  // Décode les entités HTML côté client (sécurité double avec le serveur)
  const decodeHtml = (str) => {
    if (!str) return str;
    try {
      const txt = document.createElement('textarea');
      txt.innerHTML = str;
      return txt.value;
    } catch { return str; }
  };

  // ── Image à la une — remplacement inline ──────────────────────────────────────
  const [featuredImgUrl, setFeaturedImgUrl] = useState('');
  const [showImgReplace, setShowImgReplace] = useState(false);
  // Alt/légende de l'image à la une — mémorisés côté session (la légende n'est
  // jamais affichée dans le corps : c'est la caption WP de la médiathèque).
  const [featuredImgMeta, setFeaturedImgMeta] = useState({ alt: '', caption: '' });
  const [showFeaturedImgPanel, setShowFeaturedImgPanel] = useState(false);
  const [newImgInput, setNewImgInput] = useState('');

  // ── Réhydratation des métadonnées d'édition depuis le brouillon autosave ─────
  // Après un rechargement, applyDraft (Articles.jsx) restaure le brouillon dans
  // Redux, y compris editorMeta (titre édité, SEO Meta, date MAJ, image à la
  // une, catégories) — états LOCAUX de ce composant, perdus au démontage.
  // Déclaré APRÈS les effets d'initialisation/reset ci-dessus pour être appliqué
  // en dernier dans le même commit React (l'ordre de déclaration fait foi).
  const editorMetaAppliedRef = useRef(null);
  useEffect(() => {
    const m = metaValidee;
    if (!m || editorMetaAppliedRef.current === m) return;
    editorMetaAppliedRef.current = m;
    if (m.editedTitle) { setEditedTitle(m.editedTitle); setTitleDirty(!!m.titleDirty); }
    if (m.seoTitle || m.seoDescription) {
      // Valeurs restaurées (potentiellement retouchées à la main) → ne pas les
      // écraser par la régénération SEO automatique
      seoGeneratedRef.current = true;
      if (m.seoTitle)       setSeoTitle(m.seoTitle);
      if (m.seoDescription) setSeoDescription(m.seoDescription);
    }
    if (m.publishDate) setPublishDate(m.publishDate);
    // featuredImgUrl : PAS restauré ici — toujours re-dérivé du HTML restauré /
    // wpData par l'effet dédié (déclaré plus bas, il gagnerait de toute façon)
    if (m.featuredImgMeta && (m.featuredImgMeta.alt || m.featuredImgMeta.caption)) {
      setFeaturedImgMeta({ alt: m.featuredImgMeta.alt || '', caption: m.featuredImgMeta.caption || '' });
    }
    if (Array.isArray(m.selectedCategories) && m.selectedCategories.length) {
      setSelectedCategories(m.selectedCategories);
      setCatsDirty(!!m.catsDirty);
    }
  }, [metaValidee]);
  const articleRef = useRef(null);      // pointe sur le div contentEditable
  const contentRef = useRef('');        // stocke le HTML édité SANS re-render React
  const changeIdxRef = useRef(-1);
  const isRestoringRef  = useRef(false); // vrai pendant une restauration undo/redo (n'empile pas)
  const commitHistoryRef = useRef(null); // assigné plus bas — évite une dépendance circulaire avec doSave
  const fileImgInputRef = useRef(null); // input file caché pour l'upload image à la une
  const [articleEl, setArticleEl] = useState(null); // exposé à BubbleToolbar (déclenche re-render quand le div monte)

  // Vue finale : supprime les <del> et débalise les <mark>
  //
  // On utilise la manipulation DOM (pas des regex sur string) car :
  //   - contentRef.current peut contenir des balises HTML déséquilibrées
  //     (ex: une </strong> capturée dans un <del> par la stratégie 3b du diff)
  //   - Le navigateur normalise automatiquement ces déséquilibres quand on
  //     définit innerHTML (c'est ce qui rend la Vue diff correcte visuellement)
  //   - Les regex sur string ignorent ce contexte et laissent des <strong>
  //     non fermés → tout ce qui suit s'affiche en gras dans la Vue finale
  // pendingChanges :
  //   'reject' (défaut — vue finale, exports, publication, archive) : les diffs
  //     ENCORE EN ATTENTE (ni acceptés ✓ ni rejetés ✗) ne sont PAS retenus →
  //     le texte ORIGINAL est restauré (del débalisé, mark/ins supprimés).
  //     Ce qui n'a pas été explicitement accepté ne sort jamais de l'éditeur.
  //   'accept' (passe 2 IA uniquement) : comportement historique — les diffs en
  //     attente sont considérés comme intégrés (Claude analyse l'article enrichi
  //     et ne re-propose pas les mêmes mises à jour).
  const getFinalHtml = useCallback(({ pendingChanges = 'reject' } = {}) => {
    // 1. Laisser le navigateur parser et normaliser le HTML
    const tmp = document.createElement('div');
    tmp.innerHTML = contentRef.current || '';

    // 1b. Réparer une structure cassée par un déplacement/collage (#2) avant
    //     d'extraire le HTML final → la vue finale et la publication restent valides.
    repairStructureEl(tmp);

    // 2. Résoudre les diffs EN ATTENTE selon le mode
    if (pendingChanges === 'accept') {
      // Historique : la suppression proposée est appliquée (le <del> disparaît)
      tmp.querySelectorAll('del').forEach(el => el.remove());
    } else {
      // Sécurité : un remplacement en attente = paire <del>ancien</del><mark>nouveau</mark>
      // (insérée adjacente par applyDiff) → on restaure l'ANCIEN : le <mark> jumeau
      // est supprimé, le <del> débalisé. Un <del> seul (suppression pure en attente)
      // est débalisé aussi : son texte est conservé.
      tmp.querySelectorAll('del').forEach(del => {
        const twin = del.nextElementSibling;
        if (twin && twin.tagName === 'MARK' && !twin.classList.contains('manual-highlight')) twin.remove();
        const frag = document.createDocumentFragment();
        while (del.firstChild) frag.appendChild(del.firstChild);
        if (del.parentNode) del.parentNode.replaceChild(frag, del);
      });
      // Les blocs AJOUTÉS en attente ne sont pas retenus
      tmp.querySelectorAll('ins.added-content').forEach(el => el.remove());
    }

    // 2b. Résidu de SUPPRESSION ≠ BARRÉ VOLONTAIRE — deux choses à ne pas confondre.
    //     Un <del class="deleted-content"> dont Chrome a « inliné » le style lors
    //     d'une édition manuelle dans le contentEditable doit bien disparaître :
    //     c'est du texte supprimé. Mais le bouton « Barré » de la barre de mise en
    //     forme produit lui aussi du line-through (<strike> ou un <span> avec
    //     text-decoration selon styleWithCSS) : le retirer EFFAÇAIT le texte du
    //     rédacteur, en coupant les mots voisins —
    //       « Le prix etait de 60 euros hors pose. » → « Le prix etait os hors pose. »
    //     On ne supprime donc que ce qui porte la marque du diff : la classe
    //     .deleted-content, ou le fond rouge du marqueur recopié en style inline.
    //     Tout autre barré est intentionnel et reste publié tel quel.
    stripDiffDeletions(tmp);

    // 3. Débaliser les <mark> de diff : conserver le contenu, ignorer les surlignages manuels
    //    Les <mark class="manual-highlight"> sont des surlignages intentionnels de l'utilisateur
    //    et doivent survivre jusqu'à la publication WordPress.
    tmp.querySelectorAll('mark:not(.manual-highlight)').forEach(el => {
      const frag = document.createDocumentFragment();
      while (el.firstChild) frag.appendChild(el.firstChild);
      if (el.parentNode) el.parentNode.replaceChild(frag, el);
    });
    tmp.querySelectorAll('ins.added-content').forEach(el => {
      const frag = document.createDocumentFragment();
      while (el.firstChild) frag.appendChild(el.firstChild);
      if (el.parentNode) el.parentNode.replaceChild(frag, el);
    });

    // 3b. Neutraliser les COULEURS de diff recopiées en style inline par Chrome
    //     (vert « modifié », rouge « supprimé », bleu « ajouté » + variantes hover).
    //     On retire le fond, la couleur de texte et la taille propres au marqueur,
    //     sans toucher au reste du style → plus de surlignage résiduel publié.
    const DIFF_BG = [
      'rgb(187,247,208)', 'rgb(134,239,172)',  // vert updated + hover (#bbf7d0 / #86efac)
      'rgb(254,226,226)', 'rgb(254,202,202)',  // rouge deleted + hover (#fee2e2 / #fecaca)
      'rgb(219,234,254)', 'rgb(191,219,254)',  // bleu added + hover   (#dbeafe / #bfdbfe)
    ];
    // Les <mark class="manual-highlight"> sont exclus : leur couleur est intentionnelle
    // même si elle coïncide avec une couleur de diff (ex: vert #bbf7d0).
    tmp.querySelectorAll('[style]:not(.manual-highlight)').forEach(el => {
      const bg = (el.style.backgroundColor || '').replace(/\s/g, '').toLowerCase();
      if (bg && DIFF_BG.includes(bg)) {
        el.style.removeProperty('background-color');
        el.style.removeProperty('background');
        el.style.removeProperty('color');      // couleur de texte du marqueur (vert/rouge foncé)
        el.style.removeProperty('font-size');  // taille 0.8125rem propre au marqueur
        if (!el.getAttribute('style')?.trim()) el.removeAttribute('style');
      }
    });

    // 3c. Article importé en TEXTE BRUT : une fois les diffs résolus, les passages
    //     originaux sont des nœuds texte nus → sans ce passage, la vue finale (et
    //     l'export/publication) perd les sauts de ligne et affiche un seul pavé.
    //     Chaque ligne redevient un <p>, à l'identique de la vue « Avant ».
    //     No-op pour un article déjà structuré en HTML.
    wrapLooseTextIntoParagraphs(tmp);

    // 3d. Titre FAQ redondant (« FAQ — Questions fréquentes (FAQ) ») : la mention
    //     doublée ne sort jamais de l'éditeur (vue finale, export, publication).
    dedupeFaqHeading(tmp);

    // 4. Filet de sécurité regex — capture les <del>/<mark>/<ins> résiduels que le DOM
    //    n'aurait pas rattrapés (ex: balises cassées par une édition dans contentEditable,
    //    HTML encodé différemment, attributs inattendus…)
    let html = tmp.innerHTML;
    // Supprimer tout <del …>…</del> résiduel (contenu texte simple, pas de <del> imbriqués)
    html = html.replace(/<del\b[^>]*>[\s\S]*?<\/del>/gi, '');
    // PAS de filet regex sur <s>/<strike> : ces balises sont exactement ce que
    // produit le bouton « Barré » de la barre de mise en forme. Les supprimer
    // effaçait le texte volontairement barré par le rédacteur (et coupait les
    // mots voisins). Les vrais résidus de suppression sont traités plus haut,
    // à l'étape 2b, sur le DOM et sur un critère précis : la classe
    // .deleted-content ou le fond rouge du marqueur de diff.
    // Débaliser tout <mark> résiduel de diff (sans "manual-highlight") — garder le contenu interne.
    // Les <mark class="manual-highlight"> (surlignages manuels) sont exclus et préservés.
    // Boucle pour gérer les marks éventuellement imbriqués (ex: édition manuelle)
    let prev = '';
    while (prev !== html) {
      prev = html;
      html = html.replace(/<mark\b(?![^>]*manual-highlight)[^>]*>([\s\S]*?)<\/mark>/gi, '$1');
    }
    // <ins class="added-content"> résiduel : intégré en mode 'accept', supprimé
    // en mode 'reject' (un ajout non accepté ne sort jamais)
    html = html.replace(/<ins\b[^>]*class="added-content"[^>]*>([\s\S]*?)<\/ins>/gi, pendingChanges === 'accept' ? '$1' : '');

    // 5. Nettoyage cosmétique sur le HTML résultant
    return html
      .replace(/(<br\s*\/?>){3,}/gi, '<br><br>')
      .replace(/\s{2,}/g, ' ');
  }, []);

  // Rend les médias non-éditables dans le contentEditable (images, iframes, vidéos).
  // Appelé après chaque injection d'HTML dans le div diff pour éviter qu'un clic
  // ou un backspace dans l'éditeur ne supprime accidentellement une image/vidéo.
  const lockMedia = useCallback((el) => {
    if (!el) return;
    // WYSIWYG : retirer les tailles de police parasites (0.8125rem) pour que l'éditeur
    // reflète le rendu publié (taille uniforme du thème). Les tailles px volontaires
    // (barre d'outils) sont conservées.
    stripParasiticFontSize(el);
    // Déplier les <div> sans aucun attribut : sur un article issu d'un scraping,
    // le corps arrive enveloppé dans de tels div, ce qui réduisait le navigateur
    // de structure à 2 blocs et faisait porter la barre « Tableau » sur l'article
    // entier. Idempotent : dès la première passe il n'en reste plus, donc les
    // appels suivants (après chaque accepter/rejeter) ne touchent à rien.
    unwrapTransparentDivs(el);
    // Réparer une structure cassée par un déplacement/collage (#2) : blocs sortis
    // d'un <p>, marqueurs de diff vides, <p> vidés. Préserve l'identité des nœuds.
    repairStructureEl(el);
    // Le texte AJOUTÉ (vert, mark.updated-content) ne doit jamais être barré : on sort
    // tout <mark> hors d'un <del> ancêtre (auto-réparation des diffs déjà rendus).
    let liftGuard = 0;
    let nestedMarks = el.querySelectorAll('del mark, del .updated-content');
    while (nestedMarks.length && liftGuard++ < 300) {
      nestedMarks.forEach(m => { const d = m.closest('del'); if (d?.parentNode) d.parentNode.insertBefore(m, d.nextSibling); });
      nestedMarks = el.querySelectorAll('del mark, del .updated-content');
    }
    // Robustesse tableaux : l'IA / le scraping produisent parfois des <span>/<font>
    // mal placés DANS la structure du tableau (directement sous table/thead/tbody/tr,
    // ou enveloppant des tr/td/th) → casse l'affichage. On les déballe (contenu préservé),
    // et on retire les <br>/<p> vides directement enfants de la structure.
    const STRUCT_PARENTS = new Set(['TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR']);
    let tblGuard = 0;
    let strayWrap = el.querySelectorAll('table span, table font');
    while (strayWrap.length && tblGuard++ < 200) {
      let didUnwrap = false;
      strayWrap.forEach((sp) => {
        const invalidPos  = STRUCT_PARENTS.has(sp.parentElement?.tagName);
        const wrapsStruct = !!sp.querySelector('tr, td, th, thead, tbody, tfoot');
        if (invalidPos || wrapsStruct) {
          while (sp.firstChild) sp.parentNode.insertBefore(sp.firstChild, sp);
          sp.remove();
          didUnwrap = true;
        }
      });
      if (!didUnwrap) break;
      strayWrap = el.querySelectorAll('table span, table font');
    }
    el.querySelectorAll('table > br, thead > br, tbody > br, tfoot > br, tr > br').forEach(n => n.remove());
    // <br> parasites que Chrome injecte dans le conteneur responsive du tableau
    // au fil des éditions (grand vide au-dessus du tableau sur le site publié)
    el.querySelectorAll('[data-tt-table-wrap] > br').forEach(n => n.remove());
    // Normalisation structurelle des tableaux (lignes/sections vides, table
    // piégée dans un heading, cellules noyées dans <p><span font-weight>…) →
    // format standard qui SURVIT à la sauvegarde/réouverture (persisté par
    // l'autosave qui suit chaque resynchro de l'éditeur).
    normalizeTableStructure(el);

    el.querySelectorAll('img, [data-media="iframe-wrapper"], iframe, video').forEach(m => {
      m.contentEditable = 'false';
    });
    // Les iframes (vidéos de l'article scrapé) absorbent les clics souris → sans
    // calque, impossible de les sélectionner pour les supprimer. On pose un overlay
    // transparent au-dessus (comme pour les vidéos YouTube insérées via la barre),
    // ce qui rend la vidéo cliquable → bouton corbeille. Idempotent (1 seul overlay).
    el.querySelectorAll('[data-media="iframe-wrapper"]').forEach(wrap => {
      if (wrap.querySelector(':scope > [data-media-overlay]')) return;
      const overlay = document.createElement('div');
      overlay.setAttribute('data-media-overlay', '');
      overlay.setAttribute('contenteditable', 'false');
      overlay.setAttribute('title', 'Cliquer pour sélectionner — supprimer via le bouton corbeille');
      overlay.style.cssText = 'position:absolute;inset:0;cursor:pointer;z-index:1;';
      wrap.appendChild(overlay);
    });
    // Vignettes vidéo : en production la CSP bloque les iframes (frame-src 'none')
    // → cadre noir vide dans l'éditeur, impossible de vérifier la miniature.
    // On pose la vraie vignette YouTube (img.youtube.com — autorisé par img-src)
    // SOUS l'overlay de sélection. Décor éditeur uniquement : marqué
    // data-media-overlay, donc retiré à l'export/publication comme les overlays.
    el.querySelectorAll('[data-media-type="video"], [data-media="iframe-wrapper"]').forEach(wrap => {
      if (wrap.querySelector(':scope > [data-media-overlay="thumb"]')) return;
      const ifr = wrap.querySelector('iframe');
      if (!ifr) return;
      const src = ifr.getAttribute('src') || '';
      const yt = src.match(/(?:youtube(?:-nocookie)?\.com\/embed\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
      if (!wrap.style.position) wrap.style.position = 'relative';
      const thumb = document.createElement('div');
      thumb.setAttribute('data-media-overlay', 'thumb');
      thumb.setAttribute('contenteditable', 'false');
      thumb.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:#111;overflow:hidden;z-index:0;pointer-events:none;';
      if (yt) {
        thumb.innerHTML =
          `<img src="https://img.youtube.com/vi/${yt[1]}/hqdefault.jpg" alt="" style="width:100%;height:100%;object-fit:cover;opacity:0.92;">` +
          `<span style="position:absolute;display:flex;align-items:center;justify-content:center;width:56px;height:40px;border-radius:10px;background:rgba(0,0,0,0.72);color:#fff;font-size:17px;font-family:sans-serif;">▶</span>`;
      } else {
        let host = '';
        try { host = new URL(src).hostname.replace(/^www\./, ''); } catch { /* URL relative — pas de domaine à afficher */ }
        thumb.innerHTML = `<span style="color:#9ca3af;font-size:12px;font-family:sans-serif;">Vidéo${host ? ` — ${host}` : ''} (aperçu indisponible dans l'éditeur)</span>`;
      }
      wrap.appendChild(thumb);
    });
    // Image à la une : la <figure data-featured> a line-height:0 (pour coller l'image).
    // 1) La rendre non-éditable → empêche le navigateur d'y fusionner du texte lors
    //    d'une suppression de média voisin (sinon les lignes se chevauchent).
    // 2) Réparer : sortir tout contenu non-image qui aurait déjà fusionné dans la figure.
    el.querySelectorAll('figure[data-featured]').forEach(fig => {
      fig.contentEditable = 'false';
      const img = fig.querySelector('img');
      const strays = Array.from(fig.childNodes).filter(
        n => n !== img && !(n.nodeType === 1 && n.tagName === 'IMG')
      );
      let ref = fig;
      strays.forEach(n => { fig.parentNode.insertBefore(n, ref.nextSibling); ref = n; });
    });
  }, []);

  // Extrait l'URL de l'image à la une :
  // 1. Depuis figure[data-featured] dans le HTML de l'article
  // 2. Fallback : depuis wpData.featuredMediaUrl retourné par le MCP
  useEffect(() => {
    // Priorité à l'image à la une choisie/uploadée (wpData.featuredMediaUrl = URL
    // réelle dans la médiathèque WP). Sinon, fallback sur l'image du contenu.
    // (Évite que l'URL d'origine — ex. lien Discord — réécrase l'URL WP après upload.)
    let url = wpMcpData?.featuredMediaUrl || '';
    if (!url && agent.updatedContent) {
      const tmp = document.createElement('div');
      tmp.innerHTML = agent.updatedContent;
      url = tmp.querySelector('figure[data-featured] img')?.getAttribute('src') || '';
    }
    setFeaturedImgUrl(url);
  }, [agent.updatedContent, wpMcpData]);

  // Nombre d'images DANS LE CORPS de l'article, image à la une exclue.
  //
  // Sert uniquement à ne plus mentir dans le panneau : « Aucune image définie »
  // laissait croire que l'article n'avait aucune image, alors que 9 des 222
  // articles archivés portent de 1 à 9 images sans `figure[data-featured]`. On
  // n'affiche PAS une de ces images comme si elle était l'image à la une — ce
  // serait publier la mauvaise — on dit seulement qu'elles existent.
  const nbImagesCorps = useMemo(() => {
    const h = agent.updatedContent || '';
    if (!h) return 0;
    try {
      const tmp = document.createElement('div');
      tmp.innerHTML = h;
      tmp.querySelectorAll('figure[data-featured]').forEach(f => f.remove());
      return tmp.querySelectorAll('img').length;
    } catch { return 0; }
  }, [agent.updatedContent]);

  // Remplace l'image à la une :
  // 1. Upload vers la médiathèque WP via MCP (si site connecté) → met à jour featured_media
  // 2. Met à jour la preview dans le diff (figure data-featured)
  const [uploadingImg, setUploadingImg] = useState(false);
  const handleReplaceFeaturedImage = useCallback(async () => {
    const url = newImgInput.trim();
    if (!url) return;

    // URL effectivement affichée/stockée : devient l'URL de la médiathèque WP après upload
    // (et non l'URL d'entrée, ex. lien Discord temporaire).
    let displayUrl = url;

    // ── Upload médiathèque WP — REQUIS pour que l'image à la une soit publiée ──
    const matchingSite = resolvedSite;
    if (matchingSite) {
      setUploadingImg(true);
      try {
        const resp = await axios.post('/api/wp-tool', {
          toolName: 'wp_upload_media',
          toolInput: { site_id: matchingSite.id, image_url: url, alt_text: '' },
          wpSites: [matchingSite],
        }, { timeout: 60000 });
        if (resp.data.success && resp.data.result?.media_id) {
          // L'URL WP (source_url médiathèque) remplace l'URL d'entrée
          displayUrl = resp.data.result.url || url;
          // Mettre à jour le featured_media_id dans Redux pour la publication
          dispatch(setWpData({ ...(wpMcpData || {}), siteId: matchingSite.id, siteName: matchingSite.name, featuredMediaId: resp.data.result.media_id, featuredMediaUrl: displayUrl }));
          toast.success(`Image uploadée dans la médiathèque WP (ID ${resp.data.result.media_id})`);
        } else {
          // Échec d'upload → l'image à la une ne sera PAS publiée. On n'update PAS la
          // preview pour ne pas laisser croire que c'est bon.
          toast.error(
            'Image à la une NON enregistrée : ' + (resp.data.error
              || "l'URL n'est pas une image téléchargeable. Téléversez le fichier, ou utilisez une URL d'image directe (Unsplash, Pexels, Pixabay…). Les liens Discord ne fonctionnent pas."),
            { duration: 9000 }
          );
          setUploadingImg(false);
          return;
        }
      } catch (e) {
        toast.error('Image à la une NON enregistrée : ' + (e.response?.data?.error || e.message), { duration: 9000 });
        setUploadingImg(false);
        return;
      }
      setUploadingImg(false);
    } else {
      // Pas de site WordPress connecté → impossible de déposer en médiathèque →
      // l'image n'apparaîtra QUE dans l'aperçu et ne sera PAS publiée comme image à la une.
      toast(
        "Aucun site WordPress connecté : l'image ne sera visible que dans l'aperçu et NE sera PAS publiée comme image à la une.",
        { icon: '⚠️', duration: 8000 }
      );
    }

    // ── Mise à jour de la preview dans le diff ────────────────────────────────
    if (articleRef.current) {
      const fig = articleRef.current.querySelector('figure[data-featured]');
      if (fig) {
        const img = fig.querySelector('img');
        if (img) img.src = displayUrl;
      }
      contentRef.current = articleRef.current.innerHTML;
    }
    setFeaturedImgUrl(displayUrl);
    setShowImgReplace(false);
    setNewImgInput('');

    // Génération automatique du texte ALT via Claude Vision
    if (settings.anthropicKey) {
      generateAltText(displayUrl, settings.anthropicKey).then(altText => {
        if (!altText || !articleRef.current) return;
        const img = articleRef.current.querySelector('figure[data-featured] img');
        if (img) { img.alt = altText; contentRef.current = articleRef.current.innerHTML; }
      }).catch(() => {});
    }
  }, [newImgInput, wpMcpData, resolvedSite, dispatch, settings.anthropicKey]);

  // « Valider » du panneau Alt/Légende de l'image à la une : alt appliqué en
  // local (preview) + poussé sur le média WP (featured_media_id) si l'image a
  // déjà été téléversée dans la médiathèque — sinon avertissement (preview seule).
  // La légende ici est la caption WP (jamais affichée dans le corps de l'article,
  // contrairement à la légende d'une image du corps → figcaption visible).
  const applyFeaturedImgMeta = useCallback(async ({ alt, caption }) => {
    setFeaturedImgMeta({ alt, caption });
    if (articleRef.current) {
      const img = articleRef.current.querySelector('figure[data-featured] img');
      if (img) { img.alt = alt; contentRef.current = articleRef.current.innerHTML; }
    }
    const mediaId = wpMcpData?.featuredMediaId;
    if (!mediaId || !wpMcpData?.siteId) {
      toast('Alt/légende enregistrés dans l\'aperçu — image pas encore dans la médiathèque WP, ils ne seront pas publiés.', { icon: '⚠️', duration: 7000 });
      return;
    }
    try {
      const resp = await axios.post('/api/wp-update-media', {
        site_id: wpMcpData.siteId, wpSites, media_id: mediaId, alt_text: alt, caption,
      });
      if (resp.data.success) toast.success('Alt / légende enregistrés sur la médiathèque WordPress.');
      else toast.error('Alt / légende NON enregistrés côté WordPress : ' + (resp.data.error || 'erreur inconnue'));
    } catch (e) {
      toast.error('Alt / légende NON enregistrés côté WordPress : ' + (e.response?.data?.error || e.message));
    }
  }, [wpMcpData, wpSites]);

  // Upload fichier local → médiathèque WP → met à jour featured_media
  const handleFileUpload = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = ''; // reset input pour permettre re-sélection du même fichier
    if (!validateImageFile(file)) return;   // images > 1 Mo refusées

    const matchingSite = resolvedSite;
    if (!matchingSite) {
      toast.error('Aucun site WordPress connecté pour cet article');
      return;
    }

    setUploadingImg(true);
    try {
      const formData = new FormData();
      formData.append('file', file, file.name);
      formData.append('site', JSON.stringify({ url: matchingSite.url, username: matchingSite.username, password: matchingSite.password }));

      const resp = await axios.post('/api/wp-upload-file', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 60000,
      });

      if (resp.data.success && resp.data.media_id) {
        const newUrl = resp.data.url || '';
        dispatch(setWpData({ ...(wpMcpData || {}), siteId: matchingSite.id, siteName: matchingSite.name, featuredMediaId: resp.data.media_id, featuredMediaUrl: newUrl }));
        // Mise à jour preview
        if (articleRef.current) {
          const fig = articleRef.current.querySelector('figure[data-featured]');
          if (fig && newUrl) { const img = fig.querySelector('img'); if (img) img.src = newUrl; }
          contentRef.current = articleRef.current.innerHTML;
        }
        if (newUrl) setFeaturedImgUrl(newUrl);
        toast.success(`Image téléversée (ID ${resp.data.media_id})`);

        // Génération automatique du texte ALT via Claude Vision
        if (newUrl && settings.anthropicKey) {
          generateAltText(newUrl, settings.anthropicKey).then(altText => {
            if (!altText || !articleRef.current) return;
            const img = articleRef.current.querySelector('figure[data-featured] img');
            if (img) { img.alt = altText; contentRef.current = articleRef.current.innerHTML; }
          }).catch(() => {});
        }
      } else {
        toast.error('Upload échoué : ' + (resp.data.error || 'erreur inconnue'));
      }
    } catch (err) {
      toast.error('Erreur upload : ' + (err.response?.data?.error || err.message));
    }
    setUploadingImg(false);
  }, [wpMcpData, resolvedSite, dispatch, settings.anthropicKey]);

  // Sync DOM quand une nouvelle analyse arrive — pas de re-render sur les frappes
  useEffect(() => {
    if (agent.updatedContent) {
      contentRef.current = agent.updatedContent;
      setHasContent(true);
      // Mettre à jour le div s'il est déjà monté
      if (articleRef.current) {
        articleRef.current.innerHTML = agent.updatedContent;
        lockMedia(articleRef.current);
      }
      changeIdxRef.current = -1;
    }
  }, [agent.updatedContent, lockMedia]);

  // Callback ref : initialise innerHTML dès que le div monte (après toggle diff/final)
  // setArticleEl déclenche un re-render → BubbleToolbar reçoit l'élément DOM réel
  const setArticleRef = useCallback((el) => {
    articleRef.current = el;
    setArticleEl(el);
    if (el && contentRef.current) {
      el.innerHTML = contentRef.current;
      lockMedia(el);
    }
  }, [lockMedia]);

  // ── Trace « dernière modification » (Historique) ─────────────────────────────
  // humanEditRef ne passe à true QUE sur une modification humaine (frappe,
  // barres FAQ/blocs, accepter/rejeter, navigateur de structure) — jamais sur
  // les synchronisations automatiques de fin d'analyse. editorNameRef : nom
  // affichable du membre courant (réassigné à chaque render, comme draftDataRef).
  //
  // openedHtmlRef = « photo » du HTML au premier enregistrement SANS édition
  // (état d'ouverture, après lockMedia). On ne signe « modifié par X » que si le
  // contenu DIFFÈRE réellement de cette photo : une simple CONSULTATION — clic
  // dans le texte, correcteur orthographique, couper/coller annulé par Ctrl+Z —
  // ne doit jamais écraser le nom du vrai dernier modificateur.
  const humanEditRef = useRef(false);
  const openedHtmlRef = useRef(null);
  const editorNameRef = useRef('');
  editorNameRef.current = [authUser?.prenom, authUser?.nom].filter(Boolean).join(' ')
    || authUser?.username || '';
  // Contenu réellement modifié depuis l'ouverture ? (baseline nulle + édition
  // humaine = édité avant le premier enregistrement → vraie modification)
  const reallyEdited = useCallback((html) =>
    humanEditRef.current && (openedHtmlRef.current === null || html !== openedHtmlRef.current), []);
  // Nouvel article ouvert → réinitialiser le suivi (le composant reste monté
  // quand on enchaîne les articles : les refs ne doivent pas fuiter de l'un à l'autre)
  useEffect(() => {
    humanEditRef.current = false;
    openedHtmlRef.current = null;
  }, [agent.currentArticleId]);

  // ── Autosave (façon Google Docs) ───────────────────────────────────────────
  // Construit le brouillon à partir du HTML édité en direct (contentRef) + état agent.
  // Un ref évite les closures périmées dans les handlers stables.
  const draftDataRef = useRef({ userId: null, build: null });
  draftDataRef.current = {
    userId: draftUserId,
    build: () => ({
      html:            contentRef.current || agent.updatedContent || '',
      originalContent: agent.originalContent || '',
      diff:            agent.diff || [],
      sources:         agent.sources || [],
      analysis:        agent.analysis || '',
      wpData:          agent.wpData || null,
      internalLinks:   agent.internalLinks || [],
      audit:           agent.audit || '',
      // MOT-CLÉ CIBLE — prérequis de l'audit (voir `motCleAudit` plus bas). Il ne
      // vivait QUE dans Redux, saisi à l'écran de lancement : un simple F5 le
      // perdait et « Relancer l'audit » se grisait avec « mot-clé cible manquant »
      // alors que l'enregistrement en base le porte. Les replis
      // (currentArticle.keyword) ne rattrapaient rien tant que les centaines
      // d'articles de l'historique n'étaient pas chargés — c'est-à-dire
      // précisément pendant les premières secondes après le rechargement.
      // Constaté en production le 2026-08-17 : plus aucune analyse lançable.
      // On enregistre la valeur RÉSOLUE, pas `agent.targetKeyword` brut : un
      // article rouvert depuis la file porte son mot-clé dans `cqItem`.
      targetKeyword:   (agent.targetKeyword || currentArticle?.keyword || cqItem?.keyword || '').trim(),
      // Avancement du parcours. Sans lui, un simple rechargement de page ramenait
      // le stepper à « phase 1 à faire » sur un article déjà généré, et
      // VERROUILLAIT les phases suivantes — le rédacteur ne pouvait plus rien
      // faire. Constaté en test fonctionnel sur un article de 37 modifications.
      phaseStatus:     agent.phaseStatus || null,
      // Artefacts des phases 1 à 3. Sans eux, un vidage de cache rouvrait le
      // parcours sur des panneaux VIDES : l'audit consultable, l'ampleur
      // appliquée et les suggestions d'obsolescence ne vivaient qu'en mémoire.
      // Ils servent aussi de preuve d'avancement à derivePhaseStatus, qui
      // reconstitue les phases faites à partir de ce que le brouillon contient.
      // `qatArticle.html` est écarté : c'est un doublon de `html` ci-dessus, et
      // le brouillon a un plafond d'écriture distante (MAX_REMOTE_HTML).
      // Valeurs RÉSOLUES (agent.* avec repli sur cqItem), pas les valeurs brutes
      // du store : un article rouvert depuis la file d'attente porte ses artefacts
      // dans `cqItem`, et `agent.qatArticle` y est nul. Relevé sur le brouillon
      // réel en production : `qatArticle` et `auditJson` absents alors que la
      // phase 2 était bel et bien terminée.
      auditJson:       auditJson || null,
      qatArticle:      qatArticle ? (({ html, ...rest }) => rest)(qatArticle) : null,
      obsolescenceReport: agent.obsolescenceReport || null,
      majScope:        agent.majScope || null,
      currentArticleId: agent.currentArticleId || null,
      tokenUsage:      agent.tokenUsage || null,
      instruction:     agent.instruction || '',
      // Métadonnées d'édition (états locaux du composant) : perdues au
      // rechargement sans ça — restaurées via agent.editorMeta (applyDraft).
      editorMeta: {
        // À QUEL ARTICLE CE BROUILLON APPARTIENT. Le brouillon est unique par
        // membre : sans cette marque, rien ne permet à la relecture de voir qu'il
        // vient d'un AUTRE article (voir `metaValidee`).
        articleId: agent.currentArticleId || null,
        editedTitle, titleDirty,
        seoTitle, seoDescription,
        publishDate,
        featuredImgMeta,
        selectedCategories, catsDirty,
      },
    }),
  };

  // Métadonnées persistées AVEC l'article (doc articles/{id} + Historique
  // Redux) : contrairement au brouillon (privé, un seul par membre), elles
  // survivent à la réouverture depuis « MAJ en attente » sur n'importe quel
  // poste et par n'importe quel membre (handleViewDiff les restaure).
  const articleMetaRef = useRef(() => ({}));
  articleMetaRef.current = () => ({
    ...(seoTitle || seoDescription ? { seoMeta: { seoTitle, seoDescription } } : {}),
    ...(publishDate ? { publishDate } : {}),
    ...(agent.instruction ? { instruction: agent.instruction } : {}),
    ...(titleDirty && editedTitle ? { editedTitle } : {}),
    // AVANCEMENT DU PARCOURS — écrit à CHAQUE enregistrement, plus seulement au
    // « Terminer ». C'était la cause du grisage : entre la génération (phase 2)
    // et le clic sur « Terminer », `phaseStatus` ne vivait QUE dans Redux et le
    // brouillon. Cache vidé (le brouillon local disparaît) ou réouverture depuis
    // l'Historique, et l'article revenait avec un avancement vide : toutes les
    // phases retombaient à « à faire », donc obsolescence ET relecture grisées
    // (canEnterPhase s'arrête à la première phase non DONE).
    // Aucun changement de backend nécessaire : `PUT /articles/:id/html` fusionne
    // dans `data` tout champ qui n'est pas une colonne (data-api.js), et
    // `articleToObj` réétale `data` à la lecture — le champ fait donc
    // l'aller-retour MySQL intact. Volontairement limité à deux valeurs
    // MINUSCULES : ce bloc part à chaque autosave, y mettre `auditJson` ou
    // `qatArticle` pousserait tout l'article à chaque frappe.
    ...(agent.phaseStatus ? { phaseStatus: agent.phaseStatus } : {}),
    ...(agent.majScope ? { majScope: agent.majScope } : {}),
    // CIBLE WORDPRESS — dont `featuredMediaUrl`, la SEULE source fiable de l'image
    // à la une. Elle ne vivait que dans Redux et le brouillon (privé, un seul par
    // membre) : rouvrir l'article depuis l'Historique, ou depuis un autre poste,
    // rendait `wpData` nul. Le panneau « Image à la une » retombait alors sur la
    // seule `figure[data-featured]` du HTML — et affichait « Aucune image définie »
    // sur les 9 articles qui portent des images sans cette figure. Relevé sur les
    // 332 articles réels : `wpData` était absent de 100 % des enregistrements.
    // Même mécanique que `phaseStatus` ci-dessus : `PUT /articles/:id/html` fusionne
    // dans `data` tout champ qui n'est pas une colonne, et `articleToObj` le
    // réétale à la lecture. Objet PLAT d'une dizaine de scalaires — le bloc part à
    // chaque autosave, il doit rester minuscule.
    ...(agent.wpData ? { wpData: agent.wpData } : {}),
  });

  // Abonnement au statut d'enregistrement → reflété dans le header (Enregistrement…/Enregistré)
  useEffect(() => {
    onDraftStatus((status, at) => dispatch(setDraftStatus({ status, savedAt: at || undefined })));
    return () => onDraftStatus(null);
  }, [dispatch]);

  // Planification de l'autosave : enregistre après une PAUSE de frappe (1 s d'inactivité),
  // OU immédiatement après une rafale (≥ 30 frappes) pour les saisies continues sans pause.
  // → évite de saturer le serveur (le throttle Firestore est géré dans articleDraft).
  const autosaveTimer = useRef(null);
  const keystrokesRef = useRef(0);
  const AUTOSAVE_IDLE_MS = 1000;
  const AUTOSAVE_BURST = 30;
  const doSave = useCallback(() => {
    clearTimeout(autosaveTimer.current);
    keystrokesRef.current = 0;
    const { userId, build } = draftDataRef.current;
    if (!build) return;
    const draft = build();
    saveDraft(userId, draft);
    // Photo de référence de l'état d'ouverture (premier enregistrement sans édition)
    if (openedHtmlRef.current === null && !humanEditRef.current) openedHtmlRef.current = draft.html;
    // Historique undo/redo du contenu : enregistre l'état (ignoré pendant une restauration)
    if (!isRestoringRef.current && commitHistoryRef.current) commitHistoryRef.current(draft.html);
    // Mettre à jour l'entrée existante dans l'historique Redux/localStorage
    if (draft.currentArticleId) {
      dispatch(updateInHistory({
        id: draft.currentArticleId,
        updatedContent: draft.html,
        updatedAt: Date.now(),
        // Métadonnées d'édition (SEO Meta, date MAJ, instruction, titre) —
        // suivent l'article dans l'Historique pour la réouverture en session
        ...articleMetaRef.current(),
        // Dernière modification HUMAINE (affichée + triée dans l'Historique) —
        // uniquement si le contenu diffère vraiment de l'état d'ouverture
        ...(reallyEdited(draft.html)
          ? { lastModifiedAt: Date.now(), lastModifiedBy: editorNameRef.current }
          : {}),
      }));
    }
  }, [dispatch, reallyEdited]);
  const triggerAutosave = useCallback((isKeystroke = false) => {
    if (isKeystroke && ++keystrokesRef.current >= AUTOSAVE_BURST) { doSave(); return; }
    clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(doSave, AUTOSAVE_IDLE_MS);
  }, [doSave]);

  // ── Undo / Redo du CONTENU de l'article (Ctrl+Z / Ctrl+Y + boutons) ──────────
  // Historique d'instantanés du HTML édité (contentRef). Couvre frappe, accepter/
  // rejeter, insertion média/lien — que l'undo natif du navigateur ne gère pas.
  const MAX_HISTORY = 100;
  const historyRef = useRef({ past: [], present: null, future: [] });
  // Pile PARALLÈLE de la liste des suggestions (agent.diff), empilée et dépilée
  // aux mêmes instants que les instantanés HTML — donc synchrone par construction.
  // Sans elle, appliquer une suggestion puis Ctrl+Z restaurait le texte mais
  // laissait la suggestion consommée : applyMissed marque `applied:true` dans
  // Redux, et l'historique ne mémorisait que du HTML. Mesuré avant correction :
  // 33 appliquée / 7 non localisée au lieu de 32 / 8, y compris après un
  // rechargement de la page. Une entrée `null` = état inconnu (historique
  // restauré du localStorage, où seul le HTML est persisté) → on ne rejoue rien.
  const updatesHistRef = useRef({ past: [], present: null, future: [] });
  const [histState, setHistState] = useState({ canUndo: false, canRedo: false });
  const syncHist = useCallback(() => {
    const h = historyRef.current;
    setHistState({ canUndo: h.past.length > 0, canRedo: h.future.length > 0 });
  }, []);
  // Persistance de l'historique undo/redo dans localStorage (par article) → survit au
  // Ctrl+F5. Plafond d'octets : les instantanés HTML sont lourds ; on retire les plus
  // anciens jusqu'à tenir dans le budget (en session la profondeur reste MAX_HISTORY).
  const UNDO_MAX_BYTES = 800_000;   // marge sous le quota (payload.length ≈ UTF-16, octets réels ≥)
  const UNDO_PERSIST_PAST = 40;      // profondeur persistée (bornée pour le coût de sérialisation)
  const UNDO_PERSIST_FUTURE = 20;
  const undoStoreKey = draftUserId ? `tonton_undo_${draftUserId}` : null;
  const persistHistory = useCallback(() => {
    const aid = agent.currentArticleId || cqItem?.id || null;
    if (!aid || !undoStoreKey) return;
    const h = historyRef.current;
    // Borne d'abord par NOMBRE d'entrées (limite le coût de JSON.stringify), puis par octets.
    let past = h.past.slice(-UNDO_PERSIST_PAST);
    let future = h.future.slice(0, UNDO_PERSIST_FUTURE);
    const build = () => JSON.stringify({ articleId: aid, past, present: h.present, future });
    let payload = build();
    while (payload.length > UNDO_MAX_BYTES && past.length)   { past = past.slice(1);        payload = build(); }
    while (payload.length > UNDO_MAX_BYTES && future.length) { future = future.slice(0, -1); payload = build(); }
    try { localStorage.setItem(undoStoreKey, payload); }
    catch { try { localStorage.removeItem(undoStoreKey); } catch { /* quota — on abandonne */ } }
  }, [agent.currentArticleId, cqItem, undoStoreKey]);
  // Enregistre l'état courant (dédupliqué). Assigné au ref → appelable depuis doSave.
  commitHistoryRef.current = (html) => {
    const h = historyRef.current;
    const uh = updatesHistRef.current;
    const snap = html != null ? html : (contentRef.current || '');
    // Réassigné à chaque rendu → `agent.diff` est toujours l'état courant de la
    // liste des suggestions, apparié au HTML qu'on enregistre ici.
    const suggestions = agent.diff || null;
    if (h.present == null) { h.present = snap; uh.present = suggestions; return; } // 1er état = référence
    if (snap === h.present) { uh.present = suggestions; return; }                  // contenu inchangé
    h.past.push(h.present);
    uh.past.push(uh.present);
    if (h.past.length > MAX_HISTORY) h.past.shift();
    if (uh.past.length > MAX_HISTORY) uh.past.shift();
    h.present = snap;
    uh.present = suggestions;
    h.future = [];
    uh.future = [];
    syncHist();
    persistHistory();
  };
  // Applique un instantané dans l'éditeur (sans ré-empiler) + persiste.
  const applyHistorySnap = useCallback((html) => {
    isRestoringRef.current = true;
    if (articleRef.current) { articleRef.current.innerHTML = html; lockMedia(articleRef.current); }
    contentRef.current = html;
    setTimeout(() => { isRestoringRef.current = false; }, 0);
    triggerAutosave(); // persiste l'état restauré (no-op côté historique : snap === present)
  }, [lockMedia, triggerAutosave]);
  // Rejoue l'état de la liste des suggestions apparié à l'instantané restauré.
  // `null` (historique venu du localStorage) → on ne touche à rien.
  const restaurerSuggestions = useCallback((liste) => {
    if (Array.isArray(liste)) dispatch(setDiff(liste));
  }, [dispatch]);
  const undo = useCallback(() => {
    const h = historyRef.current;
    const uh = updatesHistRef.current;
    if (!h.past.length) return;
    h.future.unshift(h.present);
    h.present = h.past.pop();
    uh.future.unshift(uh.present);
    uh.present = uh.past.length ? uh.past.pop() : null;
    syncHist();
    persistHistory();
    applyHistorySnap(h.present);
    restaurerSuggestions(uh.present);
  }, [syncHist, persistHistory, applyHistorySnap, restaurerSuggestions]);
  const redo = useCallback(() => {
    const h = historyRef.current;
    const uh = updatesHistRef.current;
    if (!h.future.length) return;
    h.past.push(h.present);
    h.present = h.future.shift();
    uh.past.push(uh.present);
    uh.present = uh.future.length ? uh.future.shift() : null;
    syncHist();
    persistHistory();
    applyHistorySnap(h.present);
    restaurerSuggestions(uh.present);
  }, [syncHist, persistHistory, applyHistorySnap, restaurerSuggestions]);
  // Changement d'article : restaure l'historique persisté (localStorage) s'il correspond
  // à CET article (→ undo survit au Ctrl+F5), sinon repart propre ancré sur le contenu courant.
  useEffect(() => {
    const aid = agent.currentArticleId || cqItem?.id || null;
    let restored = null;
    if (aid && undoStoreKey) {
      try {
        const p = JSON.parse(localStorage.getItem(undoStoreKey) || 'null');
        if (p && p.articleId === aid) restored = p;
      } catch { /* ignore */ }
    }
    const current = contentRef.current || agent.updatedContent || null;
    historyRef.current = restored
      ? { past: Array.isArray(restored.past) ? restored.past : [],
          present: restored.present ?? current,
          future: Array.isArray(restored.future) ? restored.future : [] }
      : { past: [], present: current, future: [] };
    // Aligner la pile des suggestions sur la MÊME profondeur. Le localStorage ne
    // persiste que le HTML : les entrées héritées valent donc `null` (état
    // inconnu) — l'undo du contenu fonctionne toujours, il ne rejoue simplement
    // pas la liste des suggestions au-delà de la session courante.
    const h0 = historyRef.current;
    updatesHistRef.current = {
      past: h0.past.map(() => null),
      present: agent.diff || null,
      future: h0.future.map(() => null),
    };
    setHistState({ canUndo: historyRef.current.past.length > 0, canRedo: historyRef.current.future.length > 0 });
  }, [agent.currentArticleId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Frappe clavier : mise à jour du ref uniquement, SANS setState → pas de re-render
  // (couvre aussi la mise en forme BubbleToolbar : execCommand déclenche 'input')
  const handleInput = useCallback((e) => {
    contentRef.current = e.currentTarget.innerHTML;
    humanEditRef.current = true;
    triggerAutosave(true);
  }, [triggerAutosave]);

  // Autosave sur changements d'état non clavier (image à la une, diff, liens,
  // sources) et sur les métadonnées d'édition (titre, SEO Meta, date MAJ,
  // instruction, alt/légende de l'image à la une, catégories)
  useEffect(() => {
    if (!hasContent) return;
    triggerAutosave();
  }, [agent.wpData, agent.diff, agent.sources, agent.internalLinks, featuredImgUrl, hasContent, triggerAutosave,
      editedTitle, seoTitle, seoDescription, publishDate, agent.instruction, featuredImgMeta, selectedCategories]);

  // Flush au démontage (navigation vers Tickets, etc.) → ne rien perdre
  useEffect(() => {
    return () => {
      clearTimeout(autosaveTimer.current);
      const { userId, build } = draftDataRef.current;
      const d = build ? build() : null;
      if (d && d.html) { saveDraft(userId, d); flushDraftRemote(userId, d); }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Synchronisation Firestore articles/{id} après chaque remote save réussi.
  // draftStatus passe à 'saved' après l'écriture Firestore du brouillon (throttlée ≥12 s).
  // On profite de ce signal pour mettre à jour updatedContent dans la collection articles.
  const lastSyncedHtmlRef = useRef(null);
  const lastSyncedMetaRef = useRef('');
  useEffect(() => {
    if (agent.draftStatus !== 'saved') return;
    const articleId = agent.currentArticleId;
    if (!articleId) return;
    const html = contentRef.current || '';
    const metaFields = articleMetaRef.current();
    const metaJson = JSON.stringify(metaFields);
    // HTML inchangé ET métas inchangées → rien à pousser. (Avant : seul le HTML
    // était comparé → une édition des SEULES métas — Meta Title/Desc, date,
    // instruction — n'était JAMAIS écrite dans le doc article.)
    if (!html || (html === lastSyncedHtmlRef.current && metaJson === lastSyncedMetaRef.current)) return;
    lastSyncedHtmlRef.current = html;
    lastSyncedMetaRef.current = metaJson;
    updateArticleHtml(articleId, html, reallyEdited(html)
      ? { lastModifiedAt: Date.now(), lastModifiedBy: editorNameRef.current }
      : null, metaFields).catch(() => {});
  }, [agent.draftStatus, agent.currentArticleId, agent.draftSavedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Verrou d'édition collaboratif (façon WordPress « Prendre la main ») ─────
  // Un seul membre à la fois sur un article : à l'ouverture on tente de prendre
  // le verrou articles/{id}.editingLock ; s'il est tenu par un AUTRE membre, un
  // écran bloque l'accès avec « Prendre la main » (force) ou retour. onSnapshot
  // en temps réel : si quelqu'un prend la main pendant que j'édite, l'écran
  // apparaît immédiatement chez moi. Un heartbeat prolonge le verrou ; une
  // session fermée brutalement expire toute seule (LOCK_STALE_MS).
  const [editLockedBy, setEditLockedBy] = useState(null); // { name, uid } | null
  const takeOverRef = useRef(null);
  useEffect(() => {
    const articleId = agent.currentArticleId;
    if (!articleId || !firebaseReady || !authUid) { setEditLockedBy(null); return; }
    let disposed = false;
    let acquiring = false;

    const tryAcquire = async (force = false) => {
      if (disposed || acquiring) return;
      acquiring = true;
      try {
        const r = await acquireEditLock(articleId, { uid: authUid, name: editorNameRef.current }, { force });
        if (!disposed) setEditLockedBy(r.ok ? null : { name: r.lock?.name || '', uid: r.lock?.uid });
      } catch { /* erreur réseau — ne jamais bloquer l'édition là-dessus */ }
      finally { acquiring = false; }
    };
    takeOverRef.current = () => tryAcquire(true);
    tryAcquire();

    // Temps réel : prise de main par un autre membre / libération du verrou
    const unsub = watchEditLock(articleId, (lock) => {
      if (disposed) return;
      if (isLockActive(lock)) {
        if (lock.uid !== authUid) setEditLockedBy({ name: lock.name || '', uid: lock.uid });
        else setEditLockedBy(null);
      } else {
        tryAcquire(); // verrou libéré/périmé (ou doc créé par l'archivage) → prendre la main
      }
    });

    const hb = setInterval(() => { heartbeatEditLock(articleId, authUid).catch(() => {}); }, LOCK_HEARTBEAT_MS);
    const onUnload = () => { releaseEditLock(articleId, authUid); }; // best-effort (sinon expiration auto)
    window.addEventListener('beforeunload', onUnload);
    return () => {
      disposed = true;
      takeOverRef.current = null;
      unsub();
      clearInterval(hb);
      window.removeEventListener('beforeunload', onUnload);
      releaseEditLock(articleId, authUid).catch(() => {});
    };
  }, [agent.currentArticleId, firebaseReady, authUid]);

  // Collage dans la vue diff : on retire tout style copié d'un autre site et on
  // ne garde que la structure + le style par défaut (cf. sanitizePastedHtml).
  // Insère une image collée/déposée : téléversement dans la médiathèque WP puis
  // <img> au point voulu (caret ou point de drop). ALT généré automatiquement,
  // même circuit que l'insertion via la barre d'outils.
  const insertImageFileAt = useCallback(async (file, range) => {
    if (!resolvedSite) { toast.error('Connectez un site WordPress à l\'article pour téléverser des images.'); return; }
    if (!validateImageFile(file)) return;   // > 1 Mo refusé (même règle que la barre)
    const tId = toast.loading('Téléversement de l\'image…');
    const url = await uploadMediaToWp(file);
    toast.dismiss(tId);
    if (!url || !articleRef.current) return;
    const img = document.createElement('img');
    img.src = url;
    img.alt = '';
    img.style.maxWidth = '100%';
    try {
      if (range && articleRef.current.contains(range.commonAncestorContainer)) {
        range.collapse(false);
        range.insertNode(img);
      } else {
        articleRef.current.appendChild(img);
      }
    } catch { articleRef.current.appendChild(img); }
    lockMedia(articleRef.current);
    contentRef.current = articleRef.current.innerHTML;
    humanEditRef.current = true;
    triggerAutosave();
    img.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (settings.anthropicKey) {
      generateAltText(url, settings.anthropicKey).then(altText => {
        if (altText && img.isConnected && articleRef.current) {
          img.alt = altText;
          contentRef.current = articleRef.current.innerHTML;
          toast.success('Texte ALT généré automatiquement', { duration: 2500 });
        }
      }).catch(() => {});
    }
  }, [resolvedSite, uploadMediaToWp, lockMedia, triggerAutosave, settings.anthropicKey]);

  const handlePaste = useCallback((e) => {
    const cd = e.clipboardData || window.clipboardData;
    if (!cd) return;
    // Image dans le presse-papiers (capture d'écran, fichier copié) → upload WP
    // + insertion au caret, comme dans WordPress.
    const imgFile = Array.from(cd.files || []).find(f => f.type?.startsWith('image/'))
      || Array.from(cd.items || [])
           .filter(i => i.kind === 'file' && i.type?.startsWith('image/'))
           .map(i => i.getAsFile())
           .find(Boolean);
    if (imgFile) {
      e.preventDefault();
      const sel = window.getSelection();
      const range = sel && sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
      insertImageFileAt(imgFile, range);
      return;
    }
    e.preventDefault();
    const html = cd.getData('text/html');
    if (html && html.trim()) {
      const clean = sanitizePastedHtml(html);
      // insertHTML conserve la structure nettoyée (paragraphes, listes, liens…)
      document.execCommand('insertHTML', false, clean);
    } else {
      // Pas de HTML dans le presse-papiers → insertion en texte brut
      const text = cd.getData('text/plain') || '';
      document.execCommand('insertText', false, text);
    }
    if (articleRef.current) contentRef.current = articleRef.current.innerHTML;
  }, [insertImageFileAt]);

  // Navigation entre les modifications dans l'article
  const jumpToChange = useCallback((dir) => {
    if (!articleRef.current) return;
    const marks = Array.from(articleRef.current.querySelectorAll('mark.updated-content, del.deleted-content, ins.added-content'));
    // Naviguer sur les mark (remplacement) et ins (addition), pas les del
    const targets = marks.filter(el => el.tagName === 'MARK' || el.tagName === 'INS');
    if (!targets.length) return;
    changeIdxRef.current = (changeIdxRef.current + dir + targets.length) % targets.length;
    const target = targets[changeIdxRef.current];

    // Le défilement passe par scrollBlockIntoView : l'ancienne version appelait
    // container.scrollTo() sur l'éditeur, qui n'est PAS un conteneur défilant
    // (scrollHeight === clientHeight, ~13 000 px) → l'appel ne faisait rien et
    // ces deux flèches ne déplaçaient jamais rien. L'utilitaire corrige l'éditeur
    // s'il défile, sinon ses ancêtres défilants, sinon la fenêtre.
    scrollBlockIntoView(articleRef.current, target);
    flashBlock(target);
  }, []);

  // ── Deuxième passe ────────────────────────────────────────────────────────
  const [reviewing, setReviewing] = useState(false);
  const [reviewStep, setReviewStep] = useState('');
  const [reviewProgress, setReviewProgress] = useState(0);

  // ── PHASE 2 — GENERATION ────────────────────────────────────────────────────
  // L'audit a tourne en phase 1. Ici on ne fait QUE la reecriture, avec l'ampleur
  // tranchee par le redacteur. Le brief de lancement (type d'article, plugin SEO,
  // longueur cible, maillage) est repris de l'enregistrement : il ne vit plus dans
  // l'etat de la page Articles, qui est demontee a ce stade.
  // L'enregistrement passe par triggerAutosave, le meme mecanisme que toute
  // edition — aucune persistance supplementaire n'est introduite.
  // Prompt de generation : Tonton le PRE-REMPLIT depuis le modele personnel du
  // redacteur et l'audit de cet article ; le redacteur l'ajuste. C'est ce texte
  // exact qui part dans `instruction`.
  const monModele = authUser?.prompts?.generation || DEFAULT_GENERATION_TEMPLATE;
  const [prompt, setPrompt]           = useState('');
  const [promptTouche, setPromptTouche] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);

// ── CASES DE L'AUDIT — source de verite de la session ────────────────────
  // MEME patron que briefLinkRows, et pour la meme raison : la generation et le
  // filet de publication doivent lire la MEME selection. Sinon l'avertissement
  // de publication porterait sur un audit different de celui qui est parti.
  // `null` tant que rien n'est amorce : `filterAuditBySelection` traite ce cas
  // comme « aucun filtre », donc exactement le comportement d'avant.
  const [auditSelection, setAuditSelection] = useState(null);
  const [selectionTouchee, setSelectionTouchee] = useState(false);

  const ampleurRetenue = agent.majScope || scopeProposedByAudit(auditJson);

  const reconstruirePrompt = useCallback(() => {
    setPrompt(buildGenerationPrompt({
      audit: auditJson,
      template: monModele,
      scope: ampleurRetenue,
      targetKeyword: agent.targetKeyword || '',
      // MEME selection que `summarizeAuditForRewrite` : decocher une categorie
      // doit la faire disparaitre de CE texte aussi, sinon le redacteur relit
      // une consigne qu'il vient d'ecarter.
      selection: auditSelection,
    }));
    setPromptTouche(false);
  }, [auditJson, monModele, ampleurRetenue, agent.targetKeyword, auditSelection]);

  // Reconstruction automatique tant que le redacteur n'a pas retouche le texte :
  // changer d'ampleur doit se refleter dans les directives. Des qu'il y a touche,
  // on ne l'ecrase plus — ses retouches primen sur toute regeneration.
  useEffect(() => {
    if (!promptTouche) reconstruirePrompt();
  }, [reconstruirePrompt, promptTouche]);

  const handleSaveTemplate = () => enregistrerModele('generation', prompt, setSavingTemplate);

  // ── PHASE 3 — VERIFICATION D'OBSOLESCENCE ──────────────────────────────────
  // Reutilise runReviewAgent (l'ancienne passe 2), reoriente par le prompt du
  // redacteur. Difference essentielle : les suggestions ne sont PAS fusionnees
  // dans l'article. Elles s'affichent a cote, pretes a etre copiees — c'est le
  // redacteur qui decide de ce qu'il reprend.
  const monModeleVerif = authUser?.prompts?.verification || DEFAULT_VERIFICATION_TEMPLATE;
  const [verifPrompt, setVerifPrompt] = useState('');
  const [verifPromptTouche, setVerifPromptTouche] = useState(false);
  const [verifRunning, setVerifRunning] = useState(false);
  const [verifStep, setVerifStep] = useState('');
  const [verifProgress, setVerifProgress] = useState(0);
  const [verifSuggestions, setVerifSuggestions] = useState([]);
  const [verifATourne, setVerifATourne] = useState(false);
  const [savingVerifTemplate, setSavingVerifTemplate] = useState(false);
  const [relectureTick, setRelectureTick] = useState(0);

  // Reprise de la phase 3 apres un rechargement : le rapport est restaure depuis
  // le brouillon dans Redux, mais les suggestions affichees sont un etat local.
  // Sans cette resynchronisation la phase 3 se rouvrait vide alors qu'elle etait
  // marquee terminee. On ne seme que si le local est vide : une session en cours
  // ne doit pas se faire ecraser par le rapport enregistre.
  const rapportObso = agent.obsolescenceReport;
  useEffect(() => {
    const s = rapportObso && Array.isArray(rapportObso.suggestions) ? rapportObso.suggestions : null;
    if (!s) return;
    setVerifSuggestions((prev) => (prev.length ? prev : s));
    setVerifATourne(true);
  }, [rapportObso]);

  // Bandeau d'ampleur (« Article réécrit entièrement… ») : replié par défaut.
  // Il occupait une hauteur fixe au-dessus de l'éditeur sur toute la durée de la
  // relecture, alors qu'il ne se lit qu'une fois. L'essentiel (l'ampleur
  // appliquée, le nombre de mots) reste visible sur la ligne d'en-tête.
  const [ampleurDepliee, setAmpleurDepliee] = useState(false);

  // ── Maillage interne du brief, éditable en PHASE 2 ─────────────────────────
  // Le formulaire de lancement (QatBriefFields) n'est traversé que par les
  // articles lancés à la main. Ceux qui arrivent par « MAJ en attente » se
  // voient imposer `internalLinks: []` (MajEnAttente.jsx), valeur ENREGISTRÉE
  // dans leur qatBrief : la génération recevait donc un brief vide, et le
  // forçage à 100 % de weaveBriefLinks s'appliquait à zéro paire — garantie
  // exacte, effet nul, sans recours possible depuis l'interface.
  // Ces lignes sont la source de vérité de la session pour la génération ET
  // pour le filet de publication.
  const [briefLinkRows, setBriefLinkRows] = useState([emptyLinkRow()]);

  // Suggestions de l'audit déjà versées dans le champ, par article : sans ce
  // repère, une simple relecture de l'audit réinjecterait des paires que le
  // rédacteur vient de supprimer volontairement.
  const suggestionsVerseesRef = useRef(null);
  // Réamorçage à chaque changement d'article : sans la clé sur l'id, les paires
  // d'un article suivraient le rédacteur sur le suivant.
  useEffect(() => {
    const stored = (currentArticle?.qatBrief || cqItem?.majResult?.qatBrief || {}).internalLinks || [];
    setBriefLinkRows(stored.length
      ? stored.map(l => ({ anchor: l.anchor || '', url: l.url || '' }))
      : [emptyLinkRow()]);
    suggestionsVerseesRef.current = null;
    // La selection des cases suit le meme chemin que les paires de liens : lue
    // dans le qatBrief enregistre, sinon amorcee par l'ampleur. Sans cette
    // relecture, un F5 en phase 2 rendait la main a un pre-cochage par defaut
    // SANS le dire — le scenario exact de `agent.targetKeyword`.
    const brief = currentArticle?.qatBrief || cqItem?.majResult?.qatBrief || {};
    setAuditSelection(brief.auditSelection || null);
    // « TOUCHÉE » VEUT DIRE ARBITRÉE, PAS RELUE. Ce drapeau passait à vrai sur la
    // simple présence d'une sélection enregistrée — or l'autosave tourne en
    // continu, donc dès le premier enregistrement l'effet « suivre l'ampleur »
    // sortait immédiatement et choisir « MAJ simple » ne redécochait plus les
    // actions P1 : les consignes d'une refonte partaient sur une mise à jour de
    // 200 mots. Constaté le 20 août 2026 (note « + 9 points », chiffre du
    // pré-cochage d'une refonte, sur un écran affichant MAJ simple).
    // Une sélection identique à un pré-cochage n'exprime aucun choix propre : elle
    // est indiscernable de l'automatique, il n'y a donc rien à protéger.
    setSelectionTouchee(!!brief.auditSelection && !isDefaultSelection(brief.auditSelection));
    // `currentArticle`/`cqItem` sont recalculés à chaque rendu : seul l'id doit
    // déclencher le réamorçage, sinon la saisie en cours serait écrasée.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent.currentArticleId]);

  // ── PRÉ-COCHAGE : DEUX EFFETS, DEUX INTENTIONS ─────────────────────────────
  //
  // Il n'y en avait qu'un, et le réamorçage par article l'écrasait. Constaté par un
  // parcours complet en production le 19 août 2026, sur un article NEUF : les dix
  // cases restaient décochées alors que la règle 12 impose Factuel + fraîcheur + P1
  // sur une refonte.
  //
  // Et le pire n'était pas le décochage. `filterAuditBySelection(audit, null)` ne
  // filtre RIEN : l'audit partait donc EN ENTIER pendant que l'écran affichait
  // « rien de coché ». Vérifié dans le prompt — « Ce que l'audit demande de
  // corriger » présent, « écarté par le rédacteur » absent. C'est la trappe des
  // cases décoratives que la règle 12 devait fermer, prise à l'envers : le rédacteur
  // ne voyait pas partir ce qui partait.
  //
  // L'enchaînement fautif : l'audit arrive → le pré-cochage pose les défauts →
  // l'article est enregistré → `agent.currentArticleId` change → le réamorçage
  // remet `auditSelection` à `null` → et le pré-cochage NE REJOUE PAS, aucune de ses
  // dépendances n'ayant bougé.
  //
  // A. COMBLER LE VIDE. Se déclenche dès que la sélection est nulle, ce qui couvre
  //    le réamorçage. Pas de boucle : dès qu'elle est posée, la garde sort.
  useEffect(() => {
    if (!auditJson || selectionTouchee || auditSelection) return;
    setAuditSelection(defaultAuditSelection(ampleurRetenue));
  }, [auditJson, ampleurRetenue, selectionTouchee, auditSelection]);

  // B. SUIVRE L'AMPLEUR. Changer d'ampleur doit se refléter dans les cases, comme
  //    dans les directives : une MAJ simple (+200 mots, un H2) ne porte pas les
  //    trente consignes d'une refonte. Séparé de A parce que A ne doit PAS rejouer
  //    à chaque changement d'ampleur une fois la sélection posée — sinon il
  //    écraserait un choix du rédacteur qui n'a pas encore coché.
  useEffect(() => {
    if (!auditJson || selectionTouchee) return;
    setAuditSelection(defaultAuditSelection(ampleurRetenue));
    // Volontairement limité à l'ampleur : la présence de `auditSelection` ici
    // rendrait cet effet identique à A et ramènerait la boucle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ampleurRetenue]);

  // ── PRÉ-REMPLISSAGE par les suggestions de l'AUDIT ─────────────────────────
  // L'audit produit `internal_linking.liens_entrants` et le panneau QAT les
  // affiche depuis toujours — mais elles n'allaient nulle part : il fallait les
  // recopier à la main. Le travail était fait, puis jeté, et le brief partait
  // vide. Elles sont désormais versées dans le champ de saisie de la phase 2.
  // AJOUT SEULEMENT (mergeLinkRows) : la saisie du rédacteur prime toujours.
  const auditLinkSuggestions = useMemo(() => auditSuggestedLinkRows(auditJson), [auditJson]);
  useEffect(() => {
    if (!auditLinkSuggestions.length) return;
    if (suggestionsVerseesRef.current === agent.currentArticleId) return;
    suggestionsVerseesRef.current = agent.currentArticleId;
    setBriefLinkRows(rows => mergeLinkRows(rows, auditLinkSuggestions));
  }, [auditLinkSuggestions, agent.currentArticleId]);

  // ── Repérage des liens dans « Après » ──────────────────────────────────────
  // Surlignage 100 % CSS (`:has()`), jamais de balise injectée dans l'éditeur :
  // le HTML de l'article reste strictement intact, donc aucun risque qu'un
  // marquage parte en publication (règle 8). En contrepartie, CSS ne sait
  // cibler qu'un BLOC : c'est le paragraphe porteur qui est teinté, pas la
  // phrase isolée — le lien lui-même est souligné pour pointer l'endroit exact.
  const [reperesLiens, setReperesLiens] = useState(true);
  // Domaine du site, pour séparer lien INTERNE et lien EXTERNE. Sans URL
  // exploitable on ne devine rien : on s'abstient de teinter en « interne »
  // plutôt que de colorier faux (un `[href*=""]` matcherait TOUT).
  const siteHost = useMemo(() => {
    try { return new URL(agent.wpData?.link || articleUrl).hostname.replace(/^www\./, ''); }
    catch { return ''; }
  }, [agent.wpData, articleUrl]);

  // Surlignage temporaire du passage visé en relecture : le nettoyage est gardé
  // dans un ref pour être rejoué au clic suivant comme au démontage — un <mark>
  // oublié dans le texte serait pire que pas de surlignage du tout.
  const focusRef   = useRef(null);
  const focusTimer = useRef(null);
  const FOCUS_MS   = 6000;   // assez pour le repérer à l'œil, assez court pour ne pas gêner
  useEffect(() => () => {
    clearTimeout(focusTimer.current);
    if (focusRef.current) { focusRef.current(); focusRef.current = null; }
  }, []);

  // ── PHASE 4 — appliquer une correction de style acceptée ────────────────────
  // Remplacement DIRECT, sans marqueur de diff : le rédacteur vient de valider la
  // proposition, il n'a pas à la réarbitrer ensuite dans la vue diff.
  // Renvoie `true` si le remplacement a bien eu lieu — la phase 3 s'en sert pour
  // ne marquer « appliquée » qu'une suggestion réellement passée dans le texte.
  // Les autres appelants ignorent la valeur : leur comportement est inchangé.
  const handleAcceptStyleFix = ({ avant, apres }) => {
    const el = articleRef.current;
    const src = el ? el.innerHTML : (contentRef.current || '');
    if (!avant) return false;

    let nouveau = null;
    if (src.includes(avant)) {
      // Chemin RAPIDE, inchangé : le passage figure tel quel dans le HTML.
      nouveau = src.replace(avant, apres);
    } else {
      // ── Le passage TRAVERSE DU BALISAGE — c'est le cas courant, pas l'exception
      // `avant` est du texte NU (les extraits viennent de `texteDe`, qui retire les
      // balises). Dès que la phrase contient un <em>, un <strong> ou un <br>, elle
      // n'apparaît pas telle quelle dans innerHTML : la correction était REFUSÉE,
      // et les phrases de plus de 20 mots — les plus longues, donc les plus
      // susceptibles de porter une balise — échouaient précisément toutes.
      // `replacePassageInDom` apparie sur une signature sans espaces et remplace
      // une plage qui traverse plusieurs nœuds. Il REFUSE si un lien ou un média
      // est dans la plage : le supprimer violerait la règle 8 sans qu'aucun verrou
      // ne s'en aperçoive à ce stade.
      const cible = document.createElement('div');
      cible.innerHTML = src;
      const r = replacePassageInDom(cible, avant, apres);
      if (!r.ok) {
        toast.error(r.reason === 'protege'
          ? 'Ce passage contient un lien ou un média : la correction n\'est pas appliquée automatiquement (le lien serait perdu). À reformuler à la main.'
          : 'Passage introuvable — il a déjà été modifié depuis l\'analyse. Relancez le décompte.');
        return false;
      }
      nouveau = cible.innerHTML;
    }

    if (el) { el.innerHTML = nouveau; lockMedia(el); }
    contentRef.current = nouveau;
    humanEditRef.current = true;
    triggerAutosave();
    setRelectureTick((t) => t + 1);   // le décompte se recalcule sur le texte corrigé
    toast.success('Correction appliquée.');
    return true;
  };

  // ── PHASE 3 — accepter une suggestion : l'éditeur ET le volet de gauche ─────
  // handleAcceptStyleFix ne touche que l'éditeur (onglet « Après »). Le volet
  // gauche de la phase 3 affiche un INSTANTANÉ figé (`texteVerifie`) : sans cette
  // seconde écriture, le passage accepté y restait surligné en ROUGE « à
  // remplacer », comme s'il restait à faire.
  // L'ordre compte : si le remplacement échoue (passage introuvable dans
  // l'éditeur), on ne marque RIEN — afficher en vert un passage jamais modifié
  // serait pire que l'absence de retour.
  // Renvoie `false` sur échec : la liste de droite s'en sert pour GARDER la
  // suggestion à l'écran (sinon elle disparaissait malgré le message d'erreur).
  const handleAcceptObsolescence = ({ avant, apres, index }) => {
    if (!handleAcceptStyleFix({ avant, apres })) return false;
    // L'autosave déclenchée juste avant est différée d'une seconde et reconstruit
    // le brouillon à ce moment-là : elle emportera donc ce rapport à jour.
    dispatch(appliquerSuggestionObsolescence({ index, avant, apres }));
    return true;
  };

  // Référence STABLE tant que le rapport ne change pas : `?? []` fabriquerait un
  // tableau neuf à chaque rendu et ferait rejouer le repérage (analyse DOM de
  // tout l'article) sur la moindre frappe.
  const appliqueesObso = useMemo(
    () => agent.obsolescenceReport?.appliquees || [],
    [agent.obsolescenceReport],
  );

  // ── PHASE 4 — corrections de style proposées par l'IA ───────────────────────
  // Un seul appel pour tout l'article (voir services/agentStyle.js) ; les
  // propositions sont indexées par (règle, extrait normalisé) pour rester
  // valides même après qu'un « Accepter » ait fait disparaître une occurrence.
  const [styleFixRunning, setStyleFixRunning]     = useState(false);
  const [styleFixStep, setStyleFixStep]           = useState('');
  const [styleAiProposals, setStyleAiProposals]   = useState({});

  const handleRunStyleFix = async (findings) => {
    setStyleFixRunning(true);
    setStyleFixStep('Préparation...');
    try {
      const { proposals, occurrences, tokenUsage } = await runStyleFixAgent({
        findings,
        modelSelections: settings.modelSelections || null,
        modelPricing: settings.modelPricing || null,
        onStep: (t) => setStyleFixStep(t),
      });
      const proposalsByN = new Map(proposals.map((p) => [p.n, p]));
      const map = {};
      occurrences.forEach((occ) => {
        const p = proposalsByN.get(occ.n);
        if (p) map[`${occ.id}::${occ.extrait}`] = p;
      });
      setStyleAiProposals(map);
      if (tokenUsage) {
        // Même correctif que l'Obsolescence : fusionner avec le total déjà
        // affiché, sinon le compteur à l'écran retombe au coût de la seule
        // passe de style (souvent proche de 0, donc un total qui semble faux).
        const prevUsage = agent.tokenUsage || { input: 0, output: 0, calls: [], costUsd: 0 };
        dispatch(setTokenUsage({
          input:   prevUsage.input   + tokenUsage.input,
          output:  prevUsage.output  + tokenUsage.output,
          costUsd: prevUsage.costUsd + tokenUsage.costUsd,
          calls:   [...(prevUsage.calls || []), ...(tokenUsage.calls || [])],
        }));
        // pass: 4 — quatrième contribution additive (1 = audit, 2 = génération,
        // 3 = obsolescence). tokenUsage.calls (pas fusionné) : même règle que
        // les autres dispatches, une seule passe par entrée dans byPass.
        if (agent.currentArticleId) {
          dispatch(addArticleStat({
            id:          agent.currentArticleId,
            title:       currentArticle?.title || cqItem?.title || agent.currentArticleId,
            inputTokens: tokenUsage.input,
            outputTokens: tokenUsage.output,
            costUsd:     tokenUsage.costUsd,
            createdAt:   new Date().toISOString(),
            pass: 4,
            byPass: aggregateCallsByPass(tokenUsage.calls, settings.modelPricing || null),
          }));
        }
      }
      toast.success(proposals.length
        ? `${proposals.length} correction(s) de style proposée(s).`
        : 'Aucune correction de style à proposer sur ces passages.');
    } catch (e) {
      toast.error(`Corrections de style en échec — ${e.message}`);
    } finally {
      setStyleFixRunning(false);
    }
  };

  // Situer une occurrence dans l'article : même mécanique que le navigateur de
  // structure (scroll multi-niveaux), qui fonctionne.
  const handleLocateStyle = (extrait, terme = '') => {
    const el = articleRef.current;
    if (!el) {
      toast('Ouvrez la vue « Après » pour situer le passage.', { icon: 'ℹ️' });
      return;
    }
    const amorce = String(extrait || '').slice(0, 40);
    if (!amorce) return;

    // ── SURLIGNER LE MOT, pas seulement le paragraphe ────────────────────────
    // On atterrissait au bon endroit, mais l'ancien `flashBlock` entourait tout le
    // BLOC : sur un paragraphe de 60 mots, il restait à chercher lequel remplacer.
    // On surligne donc le terme fautif quand il est connu, le passage sinon.
    // Le <mark> est retiré au bout de quelques secondes ET débalisé à l'export :
    // s'il est capté par un autosave entre-temps, il ne partira jamais sur le site.
    if (focusRef.current) { focusRef.current(); focusRef.current = null; }
    const focus = highlightPassage(el, extrait, terme);
    if (focus.el) {
      scrollBlockIntoView(el, focus.el);
      focusRef.current = focus.cleanup;
      clearTimeout(focusTimer.current);
      focusTimer.current = setTimeout(() => {
        if (focusRef.current) { focusRef.current(); focusRef.current = null; }
      }, FOCUS_MS);
      return;
    }
    // `findBlockForPassage` (locatePassage.js) au lieu d'un `includes` brut. On
    // cherchait une chaîne DÉJÀ normalisée par `texteDe` (stylePatterns.js :
    // balises remplacées par une espace, `&nbsp;` converti, espaces réduits) dans
    // un `textContent` qui, lui, ne l'est pas : espace insécable réelle, espace
    // fantôme laissée par une balise inline, et surtout `<br>` qui COLLE les mots
    // ("Ligne A<br>Ligne B" → "Ligne ALigne B"). L'appariement échouait sur une
    // amorce de prose française sur deux.
    const bloc = findBlockForPassage(el, amorce);
    if (!bloc) { toast('Passage non localisé dans l\'éditeur.', { icon: 'ℹ️' }); return; }
    scrollBlockIntoView(el, bloc);
    flashBlock(bloc, { color: '#d97706' });
  };

  const reconstruireVerifPrompt = useCallback(() => {
    const mc = agent.targetKeyword ? `\n\nMot-cle de l'article : « ${agent.targetKeyword} ».` : '';
    setVerifPrompt(`${monModeleVerif}${mc}`);
    setVerifPromptTouche(false);
  }, [monModeleVerif, agent.targetKeyword]);

  useEffect(() => {
    if (!verifPromptTouche) reconstruireVerifPrompt();
  }, [reconstruireVerifPrompt, verifPromptTouche]);

  const enregistrerModele = async (cle, texte, setBusy) => {
    setBusy(true);
    try {
      const prompts = { ...(authUser?.prompts || {}), [cle]: texte };
      await axios.put('/api/account', { prompts });
      dispatch(setProfile({ prompts }));
      toast.success('Modele enregistre — il pre-remplira vos prochains articles.');
    } catch (e) {
      toast.error(`Modele non enregistre — ${e?.response?.data?.error || e.message}`);
    } finally {
      setBusy(false);
    }
  };

  const handleVerify = async () => {
    // On verifie le texte REELLEMENT produit en phase 2, diffs resolus.
    const texte = getFinalHtml({ pendingChanges: 'accept' });
    if (!texte || !texte.trim()) { toast.error('Aucun article a verifier — passez par la phase 2.'); return; }
    setVerifRunning(true);
    setVerifProgress(0);
    setVerifStep('Verification des informations...');
    dispatch(setPhaseStatus({ phase: PHASE_OBSOLESCENCE, status: RUNNING }));
    try {
      const res = await runReviewAgent({
        content: texte,
        firstPassUpdates: [],
        firstPassAnalysis: agent.analysis || '',
        skills,
        knowledge,
        modelPricing: settings.modelPricing || null,
        modelSelections: settings.modelSelections || null,
        depth: agent.majDepth,
        instruction: verifPrompt,
        onStep: (t) => setVerifStep(t),
        onProgress: (p) => setVerifProgress(p),
      });
      const propositions = Array.isArray(res?.updates) ? res.updates : [];
      setVerifSuggestions(propositions);
      setVerifATourne(true);
      // Le rapport passe aussi par Redux : c'est ce qui le fait entrer dans le
      // brouillon. Sans ca il ne vivait que dans l'etat local du composant — la
      // phase 3 se rouvrait VIDE au moindre rechargement, et son avancement
      // n'etait deductible d'aucun artefact enregistre.
      // `texteVerifie` : le texte EXACT envoyé à l'agent. Indispensable au
      // repérage des passages en phase 3. La vérification part de
      // getFinalHtml({ pendingChanges: 'accept' }), qui SUPPRIME les <del> — donc
      // l'ancien texte de chaque remplacement en attente. Le volet gauche
      // affichait `updatedContent`, où les paires <del>ancien</del><mark>nouveau</mark>
      // sont encore là : les passages cités par l'agent y étaient introuvables,
      // ni dans un nœud texte ni par le repli au bloc (dont le textContent
      // contient encore le texte supprimé). Mesuré sur un article à 52 diffs en
      // attente : 35 suggestions sur 36 sans repère.
      dispatch(setObsolescenceReport({
        suggestions: propositions, texteVerifie: texte, at: Date.now(),
      }));
      dispatch(setPhaseStatus({ phase: PHASE_OBSOLESCENCE, status: DONE }));
      if (res.tokenUsage) {
        // Fusion avec le total déjà affiché (audit + génération), sinon le
        // compteur à l'écran RETOMBE au coût de la seule Obsolescence — la
        // panne exacte qui rendait le total illisible en fin de Relecture.
        const prevUsage = agent.tokenUsage || { input: 0, output: 0, calls: [], costUsd: 0 };
        dispatch(setTokenUsage({
          input:   prevUsage.input   + res.tokenUsage.input,
          output:  prevUsage.output  + res.tokenUsage.output,
          costUsd: prevUsage.costUsd + res.tokenUsage.costUsd,
          calls:   [...(prevUsage.calls || []), ...(res.tokenUsage.calls || [])],
        }));
        // pass: 3 — troisième contribution additive de CET article (1 = audit
        // seul, 2 = génération seule). result.tokenUsage.calls (pas fusionné) :
        // même règle que pass:2, une seule passe par dispatch dans byPass.
        if (agent.currentArticleId) {
          dispatch(addArticleStat({
            id:          agent.currentArticleId,
            title:       currentArticle?.title || cqItem?.title || agent.currentArticleId,
            inputTokens: res.tokenUsage.input,
            outputTokens: res.tokenUsage.output,
            costUsd:     res.tokenUsage.costUsd,
            createdAt:   new Date().toISOString(),
            pass: 3,
            byPass: aggregateCallsByPass(res.tokenUsage.calls, settings.modelPricing || null),
          }));
        }
      }
      // Enregistrement par le circuit habituel : l'avancement de la phase 3 suit
      // l'article, comme les autres artefacts.
      triggerAutosave();
      toast.success(propositions.length
        ? `${propositions.length} suggestion(s) a examiner.`
        : 'Aucune information obsolete detectee.');
    } catch (e) {
      dispatch(setPhaseStatus({ phase: PHASE_OBSOLESCENCE, status: ERROR }));
      toast.error(`Verification en echec — ${e.message}`);
    } finally {
      setVerifRunning(false);
    }
  };

  const [generating, setGenerating]   = useState(false);
  const [genStep, setGenStep]         = useState('');
  const [genProgress, setGenProgress] = useState(0);

  // ── PHASE 1 — (re)lancer l'audit ───────────────────────────────────────────
  const [auditing, setAuditing]         = useState(false);
  const [auditStep, setAuditStep]       = useState('');
  const [auditProgress, setAuditProgress] = useState(0);

  // Du travail repose-t-il sur l'audit courant ? Si oui, le refaire le rend
  // caduc : PhaseAudit demande confirmation avant de lancer.
  const travailEnAval = phaseStatus[PHASE_GENERATION] === DONE
    || phaseStatus[PHASE_OBSOLESCENCE] === DONE
    || !!agent.qatArticle;

  // ── Prerequis de l'audit : TITRE + MOT-CLE CIBLE ──────────────────────────
  // L'audit confronte le H1 a l'intention de recherche : sans mot-cle il n'a pas
  // de cible, sans titre rien a juger — et runQatAudit accepte les deux vides.
  //
  // Le mot-cle n'est PAS saisissable dans l'editeur : il vient du lancement
  // (agent.targetKeyword), qu'aucune reouverture de review ne redispatche. On
  // retombe donc sur le document lui-meme, avec les MEMES replis que la
  // publication SEO plus bas (focusKw) : sans eux, « Relancer l'audit » serait
  // grise a tort sur toute review rouverte depuis la file ou l'historique.
  const motCleAudit = (agent.targetKeyword || currentArticle?.keyword || cqItem?.keyword || '').trim();
  // Le titre, lui, EST saisissable ici (champ « Titre de l'article ») et se
  // preremplit du titre WP puis du H1 : on exige seulement qu'il ne soit pas vide.
  const titreAudit = (editedTitle || extractH1FromHtml(agent.originalContent) || '').trim();
  // Article d'origine absent (HTML introuvable a la reouverture) : ne PAS parler
  // de titre manquant — c'en est la consequence, pas la cause. Le bouton reste
  // actif pour que handleAudit affiche le vrai diagnostic (« Article d'origine
  // introuvable »), seul message sur lequel l'utilisateur peut agir.
  const contenuOrigine = (agent.originalContent || '').trim();
  // SKILL CERVEAU — troisieme prerequis, jusqu'ici absent de ce garde-fou. Le
  // bouton restait actif, `runQatAudit` levait « exige un skill cerveau (SKILL.md)
  // actif dans le menu SKILLS IA », la phase 1 basculait en ECHEC et le redacteur
  // partait fouiller un menu ou le skill etait pourtant bien la : le vrai probleme
  // etait que la liste n'etait PAS ENCORE CHARGEE. Deux messages distincts donc,
  // pour deux gestes opposes — patienter, ou aller en creer un. Etat derive : le
  // bouton se reactive de lui-meme des que la liste arrive, sans reclic.
  // Deux etats distincts, jamais melanges dans la meme phrase : « pas encore
  // charge » se resout en patientant, « absent » demande d'aller en creer un.
  const skillsEnChargement = !hasBrainSkill && !skillsBootstrapped;
  const champsManquantsAudit = [
    ...(contenuOrigine && !titreAudit ? ['titre'] : []),
    ...(!motCleAudit ? ['mot-clé cible'] : []),
    ...(!hasBrainSkill && skillsBootstrapped ? ['skill cerveau actif'] : []),
  ];

  const handleAudit = async () => {
    // L'audit porte sur la version EN LIGNE, jamais sur le texte en cours
    // d'edition : c'est tout son objet. Le contenu a deja ete nettoye a
    // l'ingestion (boutons de suivi, liens non editoriaux) — on ne le refait pas.
    const source = agent.originalContent || '';
    if (!source.trim()) {
      toast.error('Article d\'origine introuvable — rouvrez-le depuis « MAJ en attente ».');
      return;
    }
    // La liste des skills n'est pas encore revenue du serveur : PATIENTER, ne pas
    // echouer. `runQatAudit` refusait ici avec « exige un skill cerveau actif dans
    // le menu SKILLS IA » — un message faux dans ce cas (le skill est bien la, il
    // n'est pas encore arrive dans le navigateur) qui basculait en plus la phase 1
    // en ECHEC. Constate en production le 2026-08-17.
    if (skillsEnChargement) {
      toast('Chargement des skills en cours — relancez l\'audit dans quelques secondes.', { icon: '⏳' });
      return;
    }
    // Second rideau derriere le bouton desactive de PhaseAudit.
    if (champsManquantsAudit.length) {
      toast.error(`Audit impossible — ${champsManquantsAudit.join(' et ')} manquant${champsManquantsAudit.length > 1 ? 's' : ''}`);
      return;
    }
    const brief = currentArticle?.qatBrief || cqItem?.majResult?.qatBrief || {};
    setAuditing(true);
    setAuditProgress(0);
    setAuditStep('Audit QAT — preparation...');
    dispatch(setPhaseStatus({ phase: PHASE_AUDIT, status: RUNNING }));
    try {
      const res = await runQatAudit({
        content:        source,
        contentHtml:    source,
        skills,
        knowledge,
        articleUrl,
        // Le mot-cle VERIFIE non vide juste au-dessus, replis compris : envoyer
        // `agent.targetKeyword` seul auditait sans cible toute review rouverte
        // depuis la file ou l'historique, alors que la ligne porte le mot-cle.
        targetKeyword:  motCleAudit,
        articleType:    brief.articleType,
        seoPlugin:      brief.seoPlugin,
        targetWords:    brief.targetWords,
        internalLinks:  brief.internalLinks || [],
        wpSites,
        // Les donnees WordPress deja recuperees evitent un second appel MCP.
        existingWpData: agent.wpData || null,
        modelPricing:   settings.modelPricing || null,
        modelSelections: settings.modelSelections || null,
        onStep:     (t) => setAuditStep(t),
        onReplace:  (t) => setAuditStep(t),
        onProgress: (p) => setAuditProgress(p),
        onDelta:    () => {},
      });
      if (!res || !res.audit) throw new Error('audit vide renvoye par l\'IA');

      const resume = typeof res.audit.executive_summary === 'string'
        ? res.audit.executive_summary
        : res.audit.executive_summary ? JSON.stringify(res.audit.executive_summary) : '';
      dispatch(setAuditJson(res.audit));
      dispatch(setAnalysis(resume));
      dispatch(setPhaseStatus({ phase: PHASE_AUDIT, status: DONE }));
      if (res.tokenUsage) dispatch(setTokenUsage(res.tokenUsage));

      // Remise a zero des phases suivantes : elles reposaient sur l'audit qu'on
      // vient de remplacer.
      //
      // On NE DETRUIT AUCUN CONTENU. Une premiere version vidait aussi `diff` et
      // le rapport d'obsolescence pour que la remise a zero survive a un
      // rechargement (derivePhaseStatus re-deduit sinon « generation terminee »).
      // Constate en production sur un article reel : cela aurait efface 52
      // suggestions en attente, du travail paye que le redacteur n'avait pas
      // encore arbitre. Une incoherence d'affichage se rattrape ; du travail
      // supprime, non.
      //
      // `majScope` est la seule valeur remise a zero : c'est un CHOIX, pas un
      // contenu, et le nouvel audit doit pouvoir en proposer un autre.
      if (travailEnAval) {
        [PHASE_GENERATION, PHASE_OBSOLESCENCE, PHASE_RELECTURE]
          .forEach((p) => dispatch(setPhaseStatus({ phase: p, status: TODO })));
        dispatch(setMajScope(null));
      }
      triggerAutosave();
      toast.success(travailEnAval
        ? 'Nouvel audit — les phases 2 a 4 sont a refaire, votre texte est intact.'
        : 'Audit termine — passez a la phase 2.');
    } catch (e) {
      dispatch(setPhaseStatus({ phase: PHASE_AUDIT, status: ERROR }));
      toast.error(`Audit en echec — ${e.message}`);
    } finally {
      setAuditing(false);
    }
  };

  const handleGenerate = async (scope) => {
    if (!auditJson) {
      toast.error('Lancez l\'audit (phase 1) avant de generer.');
      return;
    }
    const brief = currentArticle?.qatBrief || cqItem?.majResult?.qatBrief || {};
    // Le maillage saisi en phase 2 PRIME sur celui du lancement : c'est le
    // dernier état relu par le rédacteur, et le seul dont disposent les articles
    // venus de la file d'attente.
    const maillage = cleanLinkRows(briefLinkRows);
    // Enregistré dans le qatBrief pour que le filet de publication et une
    // réouverture ultérieure voient les mêmes paires que la génération.
    if (agent.currentArticleId) {
      dispatch(updateInHistory({
        id: agent.currentArticleId,
        // La selection des cases est enregistree AVEC le maillage : le filet de
        // publication et une reouverture apres F5 doivent voir la MEME selection
        // que la generation, sinon l'avertissement factuel porterait sur un audit
        // qui n'est pas celui qui est parti.
        qatBrief: { ...brief, internalLinks: maillage, auditSelection },
      }));
    }
    const source = agent.originalContent || '';
    setGenerating(true);
    setGenProgress(0);
    setGenStep('Preparation de la generation...');
    dispatch(setPhaseStatus({ phase: PHASE_GENERATION, status: RUNNING }));
    try {
      const res = await runQatRewrite({
        content:        source,
        contentHtml:    source,
        audit:          auditJson,
        skills,
        knowledge,
        articleUrl,
        targetKeyword:  agent.targetKeyword || '',
        articleType:    brief.articleType,
        seoPlugin:      brief.seoPlugin,
        targetWords:    brief.targetWords,
        internalLinks:  maillage,
        // Les cases de la phase 2 filtrent l'audit AVANT son envoi. Sans ce
        // parametre, decocher n'aurait aucun effet reel : `summarizeAuditForRewrite`
        // envoyait les dix champs entiers par le canal du JSON.
        auditSelection,
        // L'ampleur tranchee en phase 2 pilote la profondeur : un choix explicite
        // du redacteur prime toujours sur la recommandation de l'audit.
        depth:          scope === SCOPE_SIMPLE ? 'ciblee' : 'refonte',
        // Les directives de la phase 2 REMPLACENT la consigne libre : c'est le
        // texte que le redacteur a relu et valide juste avant de lancer.
        instruction:    prompt || agent.instruction || '',
        modelPricing:   settings.modelPricing || null,
        modelSelections: settings.modelSelections || null,
        onStep:     (t) => setGenStep(t),
        onReplace:  (t) => setGenStep(t),
        onProgress: (p) => setGenProgress(p),
        onDelta:    () => {},
      });
      const raw = res.article?.html || '';
      if (!raw.trim()) throw new Error('article vide renvoye par l\'IA');
      // Meme repli que l'ecran de lancement : un article sans balise de bloc
      // deviendrait un mur de texte sans aucun recours.
      const base = /<(p|h[1-6]|table|ul|ol)\b[^>]*>/i.test(raw) ? raw : raw.replace(/\n/g, '<br>');
      const html = makeTablesResponsive(normalizeFaqToAccordion(base));

      dispatch(setUpdatedContent(html));
      dispatch(setQatArticle(res.article || null));
      dispatch(setMajScope(scope));
      dispatch(setPhaseStatus({ phase: PHASE_GENERATION, status: DONE }));
      if (res.tokenUsage) dispatch(setTokenUsage(res.tokenUsage));

      // Synchroniser l'editeur puis ENREGISTRER par le circuit habituel.
      if (articleRef.current) { articleRef.current.innerHTML = html; lockMedia(articleRef.current); }
      contentRef.current = html;
      humanEditRef.current = false;
      triggerAutosave();

      // On RESTE en phase 2 : le redacteur doit d'abord voir le bilan de longueur
      // calcule. Le stepper ouvre desormais la phase 3, il y va quand il veut.
      toast.success('Mise a jour generee — verifiez le bilan de longueur.');
    } catch (e) {
      dispatch(setPhaseStatus({ phase: PHASE_GENERATION, status: ERROR }));
      toast.error(`Generation en echec — ${e.message}`);
    } finally {
      setGenerating(false);
    }
  };

  // ── Modal "Ajouter des sources" ────────────────────────────────────────────
  const [showSourcesModal, setShowSourcesModal] = useState(false);
  const [sourceUrls, setSourceUrls] = useState(['']);

  // ── Logique centrale de la deuxième passe (avec ou sans sources CQ) ────────
  const runReview = async (manualSources = []) => {
    try {
      // Article propre (sans balises <del>/<mark>) envoyé à Claude pour analyse.
      // 'accept' : les diffs de passe 1 encore en attente sont considérés comme
      // intégrés — sinon Claude re-proposerait les mêmes mises à jour en passe 2.
      const cleanContent = getFinalHtml({ pendingChanges: 'accept' });

      const result = await runReviewAgent({
        content: cleanContent,
        firstPassUpdates: agent.diff || [],
        firstPassAnalysis: agent.analysis || '',
        depth: agent.majDepth || 'standard',  // même profondeur que la passe 1
        instruction: agent.instruction || '', // consigne libre de l'équipe (champ « Instruction »)
        skills,
        knowledge,
        anthropicKey: settings.anthropicKey,
        braveKey: settings.braveKey,
        tavilyKey: settings.tavilyKey,
        modelSelections: settings.modelSelections || null,
        manualSources,
        onStep: (s) => setReviewStep(s),
        onProgress: (p) => setReviewProgress(p),
      });

      if (!result.updates?.length) {
        toast('Deuxième passe : article déjà complet, aucune nouvelle modification', { icon: <Info size={18} className="text-blue-500" /> });
        return;
      }

      // ── Appliquer les nouveaux diffs sur l'HTML actuel (avec marques passe 1) ──
      // On utilise contentRef.current et NON cleanContent, pour conserver les marques
      // vertes de la passe 1 dans le rendu. Les stratégies de diff matchent le texte
      // non touché par la passe 1 (str. 1/2) et peuvent traverser les balises HTML
      // pour les textes longs (str. 4 avec [\s\S]{0,N}).
      const { html: newHtml, updates: p2Updates } = applyAllDiffs(contentRef.current, result.updates, 2, articleUrl || '');
      // Conversion \n→<br> uniquement si pas de structure de blocs HTML
      const p2HasBlocks = /<(p|h[1-6]|table|ul|ol)\b[^>]*>/i.test(newHtml);
      // FAQ : fin d'article + normalisation en accordéon (même structure pour toutes les FAQ)
      // Tableaux : enveloppés dans un conteneur responsive (défilement horizontal)
      const finalHtml = makeTablesResponsive(normalizeFaqToAccordion(moveFaqToEnd(p2HasBlocks ? newHtml : newHtml.replace(/\n/g, '<br>'))));

      // Mettre à jour le DOM — finalHtml contient maintenant passe 1 + passe 2
      // Conserver le scroll pour ne pas remonter en haut lors de l'injection innerHTML
      const scrollTopBefore = articleRef.current?.scrollTop ?? 0;
      contentRef.current = finalHtml;
      if (articleRef.current) {
        articleRef.current.innerHTML = finalHtml;
        articleRef.current.scrollTop = scrollTopBefore;
      }

      // Merger les updates passe 1 + passe 2 dans Redux
      const mergedUpdates = [
        ...(agent.diff || []).map(u => ({ ...u, pass: u.pass || 1 })),
        ...p2Updates,
      ];
      const mergedSources = [
        ...(agent.sources || []),
        ...(result.sources || []).filter(s => !(agent.sources || []).some(e => e.url === s.url)),
      ];

      dispatch(setUpdatedContent(finalHtml));
      dispatch(setDiff(mergedUpdates));
      dispatch(setSources(mergedSources.slice(0, 15)));

      // ── Suivi des tokens passe 2 ──────────────────────────────────────────
      // Construire le total fusionné (passe 1 + passe 2) en dehors du bloc
      // conditionnel pour pouvoir l'utiliser aussi dans updateInHistory
      const prev = agent.tokenUsage || { input: 0, output: 0, calls: [], costUsd: 0 };
      const mergedTokenUsage = result.tokenUsage ? {
        input:   prev.input   + result.tokenUsage.input,
        output:  prev.output  + result.tokenUsage.output,
        costUsd: prev.costUsd + result.tokenUsage.costUsd,
        calls:   [...(prev.calls || []), ...(result.tokenUsage.calls || [])],
      } : prev;

      if (result.tokenUsage) {
        dispatch(setTokenUsage(mergedTokenUsage));
        if (agent.currentArticleId) {
          dispatch(addArticleStat({
            id:          agent.currentArticleId,
            title:       currentArticle?.title || cqItem?.title || agent.currentArticleId,
            inputTokens: result.tokenUsage.input,
            outputTokens: result.tokenUsage.output,
            costUsd:     result.tokenUsage.costUsd,
            createdAt:   new Date().toISOString(),
            pass: 2,
            // result.tokenUsage.calls, PAS mergedTokenUsage.calls — correctif :
            // la version précédente réutilisait les calls FUSIONNÉS (audit +
            // refonte), alors que l'audit a déjà sa propre entrée (pass: 1,
            // dispatchée à l'audit seul, Articles.jsx/MajEnAttente.jsx). Chaque
            // dispatch ne doit porter QUE la contribution de SA propre phase —
            // sinon 'audit_qat' et 'query_extraction' sont comptés deux fois
            // dans totalByPass (une fois via pass:1, une fois via pass:2).
            byPass: aggregateCallsByPass(result.tokenUsage.calls, settings.modelPricing || null),
          }));
        }
      }

      // ── Mise à jour de l'entrée historique avec le résultat final (passe 1 + 2) ──
      if (agent.currentArticleId) {
        dispatch(updateInHistory({
          id:           agent.currentArticleId,
          updatedContent: finalHtml,
          updates:      mergedUpdates,
          sources:      mergedSources.slice(0, 15),
          tokenUsage:   mergedTokenUsage,
        }));
      }

      const p2Applied = p2Updates.filter(u => u.applied).length;
      const p2Total   = p2Updates.length;
      if (p2Applied === p2Total) {
        toast.success(`Passe 2 : ${p2Applied} nouvelle${p2Applied > 1 ? 's' : ''} modification${p2Applied > 1 ? 's' : ''} ajoutée${p2Applied > 1 ? 's' : ''} !`);
      } else {
        toast.success(`Passe 2 : ${p2Applied}/${p2Total} modifications ajoutées`);
      }
    } catch (e) {
      console.error('[review]', e);
      toast.error('Erreur deuxième passe : ' + e.message);
    }
  };

  // ── Deuxième passe classique (sans sources manuelles) ─────────────────────
  const handleReview = async () => {
    // La passe 2 produit des updates CIBLÉS, quelle que soit l'ampleur retenue en
    // phase 2 : sur un article refondu, la sémantique de refonte est perdue (le
    // verrou liens externes s'applique quand même). On avertit le rédacteur plutôt
    // que de lui retirer la fonction. Elle deviendra la phase 3 en PR 4.
    if (isQat) {
      toast('Passe 2 en mode classique : elle proposera des modifications ciblées, pas une refonte.', { icon: 'ℹ️', duration: 6000 });
    }
    setReviewing(true);
    setReviewProgress(0);
    setReviewStep('Démarrage de la deuxième passe...');
    try {
      await runReview();
    } finally {
      setReviewing(false);
    }
  };

  // ── Validation du modal "Ajouter des sources" → Passe 2 avec sources CQ ───
  const handleValidateSources = async () => {
    const validUrls = sourceUrls.map(u => u.trim()).filter(Boolean);
    if (!validUrls.length) {
      toast.error('Veuillez entrer au moins une URL source');
      return;
    }

    setShowSourcesModal(false);
    setSourceUrls(['']);
    setReviewing(true);
    setReviewProgress(2);
    setReviewStep(`Lecture de ${validUrls.length} source${validUrls.length > 1 ? 's' : ''} CQ...`);

    try {
      const fetched = await Promise.allSettled(validUrls.map(url => scrapeUrl(url)));
      const manualSources = validUrls.map((url, i) => {
        const r = fetched[i];
        return r.status === 'fulfilled' && r.value?.success
          ? { url, title: r.value.title || url, content: r.value.textContent || r.value.content || '' }
          : { url, title: url, content: '' };
      });

      const successCount = manualSources.filter(s => s.content).length;
      if (successCount === 0) {
        toast.error('Aucune source n\'a pu être lue — vérifiez que le proxy est actif');
      } else if (successCount < validUrls.length) {
        toast(`${successCount}/${validUrls.length} source${validUrls.length > 1 ? 's' : ''} lue${successCount > 1 ? 's' : ''} — les autres ont été ignorées`, { icon: <AlertTriangle size={18} className="text-amber-500" /> });
      }

      setReviewProgress(5);
      setReviewStep('Démarrage de la deuxième passe...');
      await runReview(manualSources);
    } finally {
      setReviewing(false);
    }
  };

  const [terminant, setTerminant] = useState(false);
  const [enregistrant, setEnregistrant] = useState(false);

  // ── Enregistrer SANS quitter (complément manuel de l'autosave) ──────────────
  // Pousse immédiatement TOUT l'état de travail : HTML en cours (marqueurs de
  // diff inclus), titre édité, SEO Meta, date MAJ, instruction, image à la une,
  // catégories — brouillon local + Firestore + entrée Historique. L'utilisateur
  // reste dans l'éditeur.
  const handleEnregistrer = () => {
    setEnregistrant(true);
    try {
      doSave(); // brouillon localStorage + updateInHistory immédiats
      const { userId, build } = draftDataRef.current;
      const d = build ? build() : null;
      if (d && d.html) flushDraftRemote(userId, d); // écriture Firestore sans attendre l'idle
      // Trace de modification humaine + métadonnées dans le doc article (si déjà archivé)
      if (firebaseReady && agent.currentArticleId && contentRef.current) {
        updateArticleHtml(agent.currentArticleId, contentRef.current, reallyEdited(contentRef.current)
          ? { lastModifiedAt: Date.now(), lastModifiedBy: editorNameRef.current }
          : null, articleMetaRef.current()).catch(() => {});
      }
      toast.success('Travail enregistré — vous pouvez continuer ou revenir plus tard', {
        icon: <CheckCircle2 size={18} className="text-green-600" />,
      });
    } finally {
      // petit délai visuel : l'enregistrement local est synchrone
      setTimeout(() => setEnregistrant(false), 400);
    }
  };

  const handleTerminer = async () => {
    setTerminant(true);
    const finalHtml = getFinalHtml();

    // ── Mode validation CQ (article depuis MajEnAttente) ──────────────────────
    if (cqItem) {
      const r = cqItem.majResult || {};
      const articleData = {
        id:              cqItem.id,          // réutilise l'ID du pending → SEO tracking lié
        title:           r.articleTitle    || cqItem.title  || '',
        originalContent: r.originalContent || agent.originalContent || '',
        updatedContent:  finalHtml,
        updates:         agent.diff        || r.updates     || [],
        sources:         agent.sources     || r.sources     || [],
        analysis:        agent.analysis    || r.analysis    || '',
        audit:           agent.audit       || r.audit       || '',   // persiste le rapport d'audit (onglet AUDIT)
        // Mode QAT : audit structuré + métadonnées de l'article réécrit. Sans ces
        // champs, un article produit en QAT perdait son audit dès le « Terminer »
        // ou la publication : l'onglet AUDIT était vide à la réouverture depuis
        // l'Historique, et le bandeau « article réécrit » disparaissait.
        // `qatArticle.html` est retiré : c'est déjà `updatedContent`.
        // Avancement du parcours en 4 phases (remplace l'ancien `majMode`) — omis
        // plutôt que mis à undefined : Firestore refuse les champs undefined.
        ...(agent.phaseStatus ? { phaseStatus: agent.phaseStatus } : {}),
        ...(agent.majScope    ? { majScope: agent.majScope }       : {}),
        ...(auditJson  ? { auditJson } : {}),
        ...(qatArticle ? { qatArticle: (({ html, ...rest }) => rest)(qatArticle) } : {}),
        url:             cqItem.url        || '',
        keyword:         cqItem.keyword    || '',
        priority:        cqItem.priority   || 'normale',
        assigneeId:      cqItem.assigneeId || null,
        createdAt:       new Date().toISOString(),
        tokenUsage:      agent.tokenUsage  || null,
        // Métadonnées d'édition saisies dans l'éditeur — persistées avec l'article
        // (avant : perdues au Terminer, cf. capture « SEO Meta vides »)
        ...(editedTitle && titleDirty ? { editedTitle } : {}),
        ...(seoTitle || seoDescription ? { seoMeta: { seoTitle, seoDescription } } : {}),
        ...(publishDate ? { publishDate } : {}),
        ...(agent.instruction ? { instruction: agent.instruction } : {}),
        // « Terminer » = action humaine → trace de dernière modification (Historique)
        lastModifiedAt:  Date.now(),
        lastModifiedBy:  editorNameRef.current,
        // seoTracking EXCLU de l'écriture : il est maintenu en base par le cron (snapshots
        // J+7/J+30). L'inclure ferait un updateDoc qui ÉCRASE tout le champ → snapshots perdus.
        // On le passe seulement aux dispatch Redux ci-dessous (badge en session) ; la base
        // reste la source de vérité (relue au rechargement via getArticles).
      };
      try {
        if (firebaseReady) {
          try {
            const { id, originalContentUrl, updatedContentUrl } = await saveArticle(articleData);
            const { originalContent, updatedContent, ...meta } = articleData;
            dispatch(addToHistory({
              ...meta,
              id,
              ...(r.seoTracking ? { seoTracking: r.seoTracking } : {}),   // badge en session (NON écrit en base ici)
              ...(originalContentUrl ? { originalContentUrl } : { originalContent }),
              ...(updatedContentUrl  ? { updatedContentUrl  } : { updatedContent  }),
            }));
          } catch {
            dispatch(addToHistory({ ...articleData, id: Date.now().toString(), ...(r.seoTracking ? { seoTracking: r.seoTracking } : {}) }));
          }
        } else {
          dispatch(addToHistory({ ...articleData, id: Date.now().toString(), ...(r.seoTracking ? { seoTracking: r.seoTracking } : {}) }));
        }
        dispatch(removePendingItem(cqItem.id));
        // BROUILLON PURGÉ — il vient d'être archivé, le garder DÉTRUIT du travail.
        // Voir le commentaire jumeau du flux normal ci-dessous : sans cet appel, le
        // brouillon survivait au « Terminer » et écrasait le HTML final à la
        // réouverture.
        clearDraft(draftUserId);
        toast.success('Article validé et archivé dans l\'historique !', { icon: <CheckCircle2 size={18} className="text-green-600" /> });
        navigate('/maj-en-attente');
      } catch (e) {
        toast.error('Erreur : ' + e.message);
      } finally {
        setTerminant(false);
      }
      return;
    }

    // ── Flow normal (article depuis Articles) ─────────────────────────────────
    // L'article est déjà dans Historique (ajouté lors de l'analyse).
    // On met à jour l'entrée avec le HTML final propre (sans balises diff).
    if (!agent.currentArticleId) { setTerminant(false); return; }
    try {
      const lastMod = { lastModifiedAt: Date.now(), lastModifiedBy: editorNameRef.current };
      const titreFinal = editedTitle || extractH1FromHtml(agent.originalContent) || '';
      // Le parcours s'achève ici : la phase 4 est terminée.
      const avancement = { ...(agent.phaseStatus || {}), [PHASE_RELECTURE]: DONE };
      // ── Ce qui doit atterrir EN BASE, et pas seulement dans Redux ──────────────
      // Après un rechargement, c'est la base qui fait foi. L'écriture ne portait
      // que le HTML et la trace de modification : l'archive conservait donc le
      // titre du LANCEMENT (le slug d'URL, « toiture-en-bac-acier »), un
      // avancement réduit à { audit: done } — d'où des phases 2 à 4 qui
      // repassaient « à faire » à la réouverture — et perdait les métas de
      // l'article réécrit (titre SEO, méta-description, chapô, ampleur appliquée).
      // Constaté sur un article réel, archivé puis relu.
      const archive = {
        ...articleMetaRef.current(),
        ...(titreFinal ? { title: titreFinal } : {}),
        phaseStatus: avancement,
        ...(agent.majScope ? { majScope: agent.majScope } : {}),
        ...(auditJson  ? { auditJson } : {}),
        // `qatArticle.html` est retiré : c'est déjà `updatedContent`.
        ...(qatArticle ? { qatArticle: (({ html, ...rest }) => rest)(qatArticle) } : {}),
        finishedAt: new Date().toISOString(),
      };
      dispatch(updateInHistory({
        id:             agent.currentArticleId,
        updatedContent: finalHtml,
        updates:        agent.diff    || [],
        sources:        agent.sources || [],
        ...archive,
        ...lastMod,
      }));
      // Persiste le HTML final + la trace de modification + TOUTE l'archive côté
      // base (non bloquant : l'autosave throttlé peut ne pas avoir eu le temps de
      // pousser les derniers changements). La route range les colonnes connues
      // (dont `title`) et fusionne le reste dans `data`.
      if (firebaseReady && finalHtml) {
        updateArticleHtml(agent.currentArticleId, finalHtml, lastMod, archive).catch(() => {});
      }
      // ── BROUILLON PURGÉ — SINON IL DÉTRUIT LE TRAVAIL ARCHIVÉ ────────────────
      // `clearDraft` n'était appelé NULLE PART dans cet écran. Le brouillon
      // d'autosave survivait donc au « Terminer », figé sur le dernier
      // enregistrement AVANT l'archivage. À la réouverture de ce même article
      // depuis l'Historique, l'effet de restauration d'Articles.jsx retrouvait ce
      // brouillon (même `currentArticleId`) et REMPLAÇAIT le HTML final par lui —
      // puis l'autosave réécrivait cette version périmée en base. Le rédacteur
      // retrouvait un article amputé de ses dernières corrections, et le travail
      // était perdu pour de bon.
      //
      // Purgé ICI, après une archive réussie : le brouillon n'a plus d'objet, tout
      // est en base. `clearDraft` neutralise aussi le flush de démontage (fenêtre
      // d'inhibition de 2,5 s), qui sinon le ré-écrirait aussitôt.
      clearDraft(draftUserId);
      dispatch(resetAgent());
      toast.success('Article archivé dans l\'historique !', { icon: <CheckCircle2 size={18} className="text-green-600" /> });
      navigate('/historique');
    } catch (e) {
      toast.error('Erreur : ' + e.message);
    } finally {
      setTerminant(false);
    }
  };

  const updates = agent.diff || [];
  const appliedUpdates = updates.filter(u => u.applied !== false);
  const missedUpdates  = updates.filter(u => u.applied === false);
  const p2Updates = updates.filter(u => u.pass === 2);
  const sources = agent.sources || [];
  // useMemo : référence stable requise par les hooks qui en dépendent (tissage
  // des liens dans les blocs insérés) — `|| []` nu créerait un tableau neuf à
  // chaque render et invaliderait leurs deps en permanence.
  const internalLinks = useMemo(() => agent.internalLinks || [], [agent.internalLinks]);
  const parseFailed = agent.parseFailed === true;

  // ── Appliquer un lien interne dans l'article ──────────────────────────────
  // Cherche l'ancre dans le texte de l'article et la remplace par un <a href>.
  // Wrap seulement la première occurrence non déjà liée.
  const [appliedLinks, setAppliedLinks] = useState(new Set());
  const [linkHover, setLinkHover]       = useState(null); // { idx, url, anchor, rect } — lien interne PROPOSÉ
  const [anchorHover, setAnchorHover]   = useState(null); // { url, rect } — vraie ancre <a href> survolée
  const leaveTimerRef  = useRef(null);
  const anchorTimerRef = useRef(null); // fermeture différée du tooltip d'ancre (dédié)

  // Survol d'une vraie ancre <a href> (lien externe existant, interne existant ou
  // déjà appliqué) → tooltip affichant l'URL complète + bouton « Ouvrir dans un
  // nouvel onglet ». Quand la souris quitte le lien, le tooltip reste ≥ 1 s
  // (fermeture différée) pour laisser le temps d'aller cliquer dedans.
  const showAnchorTooltip = useCallback((e) => {
    const a = e.target.closest('a[href]');
    if (a && e.currentTarget.contains(a)) {
      clearTimeout(leaveTimerRef.current);
      clearTimeout(anchorTimerRef.current);
      anchorTimerRef.current = null;
      const url = a.getAttribute('href') || '';
      // Titre connu : titre HTML du lien, sinon titre d'un lien interne suggéré de même URL
      const known = (agent.internalLinks || []).find(l => l.url === url);
      const title = a.getAttribute('title') || known?.title || '';
      setAnchorHover({ url, title, rect: a.getBoundingClientRect() });
    } else if (!anchorTimerRef.current) {
      // Pas de replanification à chaque mouvement de souris : un seul timer,
      // sinon le tooltip ne se fermerait jamais tant que la souris bouge.
      anchorTimerRef.current = setTimeout(() => {
        anchorTimerRef.current = null;
        setAnchorHover(null);
      }, 1000);
    }
  }, [agent.internalLinks]);

  // ── #3 Accepter / Rejeter un changement de diff (par segment, au survol) ──────
  // segHover = { node, rect } où node est le <del>/<mark>/<ins> survolé.
  const [segHover, setSegHover] = useState(null);

  // Débaliser un nœud : remplace l'élément par son contenu (conserve le texte).
  const unwrapNode = (n) => {
    const frag = document.createDocumentFragment();
    while (n.firstChild) frag.appendChild(n.firstChild);
    if (n.parentNode) n.parentNode.replaceChild(frag, n);
  };

  // Retrouve la paire <del>…</del><mark>…</mark> (insérée adjacente par applyDiff),
  // ou un <ins> seul (addition).
  const resolveDiffPair = (node) => {
    if (!node) return {};
    if (node.tagName === 'INS') return { ins: node };
    if (node.tagName === 'DEL') {
      const mk = node.nextElementSibling;
      return { del: node, mark: mk && mk.tagName === 'MARK' ? mk : null };
    }
    if (node.tagName === 'MARK') {
      const dl = node.previousElementSibling;
      return { del: dl && dl.tagName === 'DEL' ? dl : null, mark: node };
    }
    return {};
  };

  const afterSegEdit = useCallback(() => {
    if (articleRef.current) {
      lockMedia(articleRef.current);
      contentRef.current = articleRef.current.innerHTML;
      humanEditRef.current = true;
      triggerAutosave();
    }
    setSegHover(null);
  }, [lockMedia, triggerAutosave]);

  // ✓ Accepter : la modification est ENTÉRINÉE → on retire le barré (del), on
  //   débalise le surligné vert (mark) et le bloc ajouté (ins) → texte propre.
  const acceptSegment = useCallback((node) => {
    if (!node || !node.isConnected) { setSegHover(null); return; } // ancre périmée (re-rendu) → no-op plutôt qu'agir au mauvais endroit
    const { del, mark, ins } = resolveDiffPair(node);
    if (ins) unwrapNode(ins);
    if (del) del.remove();
    if (mark) unwrapNode(mark);
    afterSegEdit();
  }, [afterSegEdit]);

  // ✗ Rejeter : on REVIENT à l'original → on restaure le texte barré (débalise del),
  //   on supprime le surligné vert (mark) et le bloc ajouté (ins).
  const rejectSegment = useCallback((node) => {
    if (!node || !node.isConnected) { setSegHover(null); return; } // ancre périmée (re-rendu) → no-op plutôt qu'agir au mauvais endroit
    const { del, mark, ins } = resolveDiffPair(node);
    if (ins) ins.remove();
    if (del) unwrapNode(del);
    if (mark) mark.remove();
    afterSegEdit();
  }, [afterSegEdit]);

  // Nombre de modifications ENCORE EN ATTENTE (une paire del+mark = 1, un ins = 1).
  // Compté depuis contentRef (source de vérité) : fonctionne aussi en vue finale,
  // quand le contentEditable est démonté.
  const countPendingChanges = useCallback(() => {
    const tmp = document.createElement('div');
    tmp.innerHTML = contentRef.current || '';
    const seen = new Set();
    let count = 0;
    tmp.querySelectorAll('del.deleted-content, mark.updated-content, ins.added-content').forEach((n) => {
      if (seen.has(n)) return;
      const { del, mark, ins } = resolveDiffPair(n);
      [del, mark, ins].forEach(x => x && seen.add(x));
      count++;
    });
    return count;
  }, []);

  // Modifications en attente affichées par le badge de la Vue finale : la vue
  // finale EXCLUT tout ce qui n'est pas accepté (getFinalHtml, 'reject') — sans
  // ce compteur, copier depuis la Vue finale avec des diffs en attente exporte
  // silencieusement le texte ORIGINAL. Recalculé au basculement diff/finale et
  // à chaque commit d'historique (accepter/rejeter/undo passent par histState).
  const pendingInFinal = useMemo(
    () => (diffMode ? 0 : countPendingChanges()),
    [diffMode, histState, countPendingChanges] // eslint-disable-line react-hooks/exhaustive-deps
  );

  // ✓✓ / ✗✗ Tout accepter / Tout rejeter — traite d'un coup TOUS les segments en
  // attente. Opère sur le contentEditable live si monté (vue diff), sinon sur
  // contentRef (vue finale) — le résultat est resynchronisé et autosauvegardé,
  // et reste annulable via Ctrl+Z (commitHistory de l'autosave).
  const processAllSegments = useCallback((mode) => {
    const live = articleRef.current;
    const root = live || document.createElement('div');
    if (!live) root.innerHTML = contentRef.current || '';

    const nodes = Array.from(root.querySelectorAll('del.deleted-content, mark.updated-content, ins.added-content'));
    if (!nodes.length) {
      toast('Aucune modification en attente', { icon: <Info size={18} className="text-blue-500" /> });
      return false;
    }
    const seen = new Set();
    nodes.forEach((node) => {
      if (seen.has(node)) return;
      const { del, mark, ins } = resolveDiffPair(node);
      [del, mark, ins].forEach(x => x && seen.add(x));
      if (mode === 'accept') {
        if (ins) unwrapNode(ins);
        if (del) del.remove();
        if (mark) unwrapNode(mark);
      } else {
        if (ins) ins.remove();
        if (del) unwrapNode(del);
        if (mark) mark.remove();
      }
    });

    if (live) {
      afterSegEdit();
    } else {
      contentRef.current = root.innerHTML;
      humanEditRef.current = true;
      triggerAutosave();
    }
    toast.success(mode === 'accept'
      ? 'Toutes les modifications en attente ont été acceptées'
      : 'Toutes les modifications en attente ont été rejetées — texte original restauré');
    return true;
  }, [afterSegEdit, triggerAutosave]);

  // ── Manipulation de la FAQ (bloc entier + questions/réponses) ────────────────
  // faqHover = { rect, qa: { index, count, rect } | null } — au survol de la FAQ :
  //   • qa = null  → barre du BLOC (↑↓ section, copier, couper, supprimer) sur le titre
  //   • qa ≠ null  → barre de la Q/R survolée (↑↓ réordonner, ➕ ajouter, 🗑 supprimer)
  const [faqHover, setFaqHover] = useState(null);

  // Survol d'un TABLEAU → barre « bloc entier » (copier / couper / supprimer),
  // même expérience que la FAQ : cadre pointillé + barre au-dessus du tableau.
  const [tableHover, setTableHover] = useState(null); // { el, rect } — el = bloc top-level

  // ── Survol d'une IMAGE du corps (hors image à la une) → barre « Alt / Légende » ──
  const [imgHover, setImgHover] = useState(null);       // { img, rect }
  const [imgPanelCtx, setImgPanelCtx] = useState(null); // { img } — image en édition dans le panneau

  // ── Presse-papiers interne de BLOCS (FAQ, tableau, titre, image, liste…) ────
  // blockClipRef = { html, meta } — contenu coupé/copié · blockClipboard =
  // { mode:'couper'|'copier', name, art, fem } | null → snackbar + boutons
  // « Coller » (clic droit BubbleToolbar, panneau Structure : avant/après).
  const blockClipRef = useRef(null);
  const [blockClipboard, setBlockClipboard] = useState(null);

  // ── Réécriture d'un passage sélectionné (moteur Claude) ─────────────────────
  // rewriteCtx = { originalText, originalHtml } ; le Range est gardé en ref
  // (objet DOM vivant, pas de re-render nécessaire).
  const [rewriteCtx, setRewriteCtx] = useState(null);
  const rewriteRangeRef = useRef(null);

  // ── Réécriture d'une SECTION entière (clic sur un titre H2/H3/H4) ───────────
  // sectionHover = { el, rect } — titre cliqué, barre flottante « Réécrire cette
  // section ». sectionRewriteCtx = { originalHtml, level } ; Range en ref.
  const [sectionHover, setSectionHover] = useState(null);
  const [sectionRewriteCtx, setSectionRewriteCtx] = useState(null);
  const sectionRangeRef = useRef(null);

  // ── Analyse SEO réelle (critères Yoast/SEOPress + règles équipe) ────────────
  // Remplace l'ancien signal trompeur (« Généré » vert = SEO ok) : verdict
  // STRICT calculé sur le contenu FINAL + metas + mot-clé cible.
  const [seoReport, setSeoReport]         = useState(null);
  const [showSeoChecks, setShowSeoChecks] = useState(false);

  const openRewritePanel = useCallback((range) => {
    if (!range || range.collapsed || !articleRef.current || !articleRef.current.contains(range.commonAncestorContainer)) {
      toast.error('Sélectionnez d\'abord le passage à réécrire (un paragraphe).');
      return;
    }
    const frag = range.cloneContents();
    const tmp = document.createElement('div');
    tmp.appendChild(frag);
    const originalText = (tmp.textContent || '').trim();
    if (originalText.length < 20) {
      toast.error('Sélection trop courte — sélectionnez au moins une phrase complète.');
      return;
    }
    if (tmp.querySelector('a')) {
      // Règle 8 : ne jamais risquer la disparition d'un lien dans la réécriture
      toast.error('La sélection contient un lien — réduisez-la pour ne pas toucher aux liens.');
      return;
    }
    if (tmp.querySelector('del, mark, ins')) {
      toast.error('La sélection contient une modification en attente — acceptez-la ou rejetez-la d\'abord.');
      return;
    }
    if (tmp.querySelector('h1, h2, h3, h4, h5, h6, table, ul, ol, li, figure, img, iframe, video')) {
      toast.error('Sélectionnez un seul passage de texte (sans titre, liste, tableau ni média).');
      return;
    }
    rewriteRangeRef.current = range;
    setRewriteCtx({ originalText, originalHtml: tmp.innerHTML });
  }, []);

  // « Valider » du panneau : insère une PROPOSITION del/mark (accepter ✓ /
  // rejeter ✗) au lieu d'un remplacement brutal — cohérent avec le flux de MAJ.
  const applyRewrite = useCallback((newText) => {
    const range = rewriteRangeRef.current;
    const ctx = rewriteCtx;
    setRewriteCtx(null);
    rewriteRangeRef.current = null;
    if (!newText || !range || !ctx || !articleRef.current) return;
    try {
      const del = document.createElement('del');
      del.className = 'deleted-content';
      del.innerHTML = ctx.originalHtml;
      const mark = document.createElement('mark');
      mark.className = 'updated-content';
      mark.setAttribute('title', 'Réécriture IA');
      mark.textContent = newText;
      range.deleteContents();
      range.insertNode(mark);
      range.insertNode(del); // insertNode insère en tête du range → ordre final del, mark
      lockMedia(articleRef.current);
      contentRef.current = articleRef.current.innerHTML;
      humanEditRef.current = true;
      triggerAutosave();
      mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
      toast.success('Réécriture proposée — acceptez ✓ ou rejetez ✗ le passage surligné.');
    } catch {
      toast.error('La sélection a changé pendant la réécriture — resélectionnez le passage.');
    }
  }, [rewriteCtx, lockMedia, triggerAutosave]);

  // Clic sur un titre H2/H3/H4 → prépare la section (titre + tout son contenu
  // jusqu'au prochain titre de même niveau ou supérieur) pour la réécriture bloc.
  const openSectionRewrite = useCallback((headingEl) => {
    if (!headingEl || !articleRef.current || !articleRef.current.contains(headingEl)) return;
    const level = parseInt(headingEl.tagName.slice(1), 10);
    const collected = [headingEl];
    let sib = headingEl.nextElementSibling;
    while (sib) {
      const m = sib.tagName.match(/^H([1-6])$/);
      if (m && parseInt(m[1], 10) <= level) break;
      collected.push(sib);
      sib = sib.nextElementSibling;
    }
    const hasPending = collected.some(el =>
      el.matches?.('del.deleted-content, mark.updated-content, ins.added-content')
      || el.querySelector?.('del.deleted-content, mark.updated-content, ins.added-content'));
    if (hasPending) {
      toast.error('Cette section contient une modification en attente — acceptez-la ou rejetez-la d\'abord.');
      return;
    }
    const range = document.createRange();
    range.setStartBefore(collected[0]);
    range.setEndAfter(collected[collected.length - 1]);
    const frag = range.cloneContents();
    const tmp = document.createElement('div');
    tmp.appendChild(frag);
    sectionRangeRef.current = range;
    setSectionRewriteCtx({ originalHtml: tmp.innerHTML, level });
    setSectionHover(null);
  }, []);

  // « Valider » du panneau section : REMPLACE directement le titre + son contenu
  // (pas de del/mark — une section entière avec titres imbriqués/listes ne se
  // prête pas à un surlignage inline ; l'undo maison (Ctrl+Z) reste disponible,
  // même contrat que les éditions de blocs FAQ/tableau). Le verrou liens
  // externes (règle 8) s'applique en filet de sécurité avant application.
  const applySectionRewrite = useCallback((newHtml) => {
    const range = sectionRangeRef.current;
    const ctx = sectionRewriteCtx;
    setSectionRewriteCtx(null);
    sectionRangeRef.current = null;
    if (!newHtml || !range || !ctx || !articleRef.current) return;
    try {
      const articleUrl = agent.wpData?.postLink || currentArticle?.url || cqItem?.url || '';
      const { update: policed, blocked } = enforceExternalLinkPolicy(
        { type: 'remplacement', original: ctx.originalHtml, updated: newHtml },
        articleUrl,
      );
      if (blocked) {
        toast.error('Réécriture refusée : un lien externe de la section serait perdu. Réessayez ou ajustez la consigne.');
        return;
      }
      const finalHtml = balanceFragment(policed.updated || newHtml);
      const parseRange = document.createRange();
      const newFrag = parseRange.createContextualFragment(finalHtml);
      range.deleteContents();
      range.insertNode(newFrag);
      lockMedia(articleRef.current);
      contentRef.current = articleRef.current.innerHTML;
      humanEditRef.current = true;
      triggerAutosave();
      toast.success('Section réécrite — Ctrl+Z pour annuler.');
    } catch {
      toast.error('La section a changé pendant la réécriture — réessayez.');
    }
  }, [sectionRewriteCtx, agent.wpData, currentArticle, cqItem, lockMedia, triggerAutosave]);

  // Lance l'analyse SEO sur le contenu FINAL (modifications en attente acceptées,
  // comme à la publication) — même résolution du mot-clé cible que la publication.
  const runSeoCheck = useCallback(() => {
    const focusKw = (agent.targetKeyword || currentArticle?.keyword || cqItem?.keyword || '').trim();
    const report = analyzeSeo({
      html: getFinalHtml({ pendingChanges: 'accept' }),
      focusKeyword: focusKw,
      metaTitle: seoTitle,
      metaDescription: seoDescription,
      articleUrl: agent.wpData?.postLink || currentArticle?.url || cqItem?.url || '',
    });
    setSeoReport(report);
    setShowSeoChecks(true);
  }, [agent.targetKeyword, agent.wpData, currentArticle, cqItem, seoTitle, seoDescription, getFinalHtml]);

  // Resynchronisation après une manipulation DOM externe (navigateur de
  // structure, barres FAQ/blocs…) : lockMedia + contentRef + autosave (qui
  // empile aussi l'instantané undo/redo via commitHistory).
  const afterDomEdit = useCallback(() => {
    if (articleRef.current) {
      lockMedia(articleRef.current);
      contentRef.current = articleRef.current.innerHTML;
      humanEditRef.current = true;
      triggerAutosave();
    }
  }, [lockMedia, triggerAutosave]);

  // « Valider » du panneau Alt/Légende — édite l'image en place (pas un diff à
  // accepter/rejeter, c'est une métadonnée). La légende est un <figcaption>
  // visible sous l'image publiée : on enveloppe l'image dans un <figure> si
  // nécessaire, on la déplie si la légende est vidée (retour au <img> nu).
  const applyImageMeta = useCallback((img, { alt, caption }) => {
    if (!img || !articleRef.current || !articleRef.current.contains(img)) return;
    img.alt = alt || '';
    const trimmedCaption = (caption || '').trim();
    const currentFigure = img.parentElement?.tagName === 'FIGURE' && !img.parentElement.hasAttribute('data-featured')
      ? img.parentElement : null;
    if (trimmedCaption) {
      let figure = currentFigure;
      if (!figure) {
        figure = document.createElement('figure');
        // <figure> n'est PAS autorisé comme enfant de <p> (contenu phrasant
        // uniquement) — <p><figure>…</figure></p> serait invalide et un
        // rechargement du brouillon (innerHTML → re-parsé par le navigateur)
        // casserait la structure. Si l'image est dans un <p>, la figure est
        // insérée comme bloc frère juste après ; le <p> est retiré s'il ne
        // contenait que l'image.
        const parentP = img.parentElement?.tagName === 'P' ? img.parentElement : null;
        if (parentP) {
          parentP.parentNode.insertBefore(figure, parentP.nextSibling);
          figure.appendChild(img);
          if (!parentP.querySelector('img, iframe, video') && !(parentP.textContent || '').trim()) parentP.remove();
        } else {
          img.parentNode.insertBefore(figure, img);
          figure.appendChild(img);
        }
      }
      let figcaption = figure.querySelector(':scope > figcaption');
      if (!figcaption) {
        figcaption = document.createElement('figcaption');
        figure.appendChild(figcaption);
      }
      figcaption.textContent = trimmedCaption;
    } else if (currentFigure) {
      const figcaption = currentFigure.querySelector(':scope > figcaption');
      if (figcaption) figcaption.remove();
      // Plus rien d'autre dans la figure que l'image → on la déplie (retour au <img> nu)
      if (currentFigure.childElementCount === 1 && currentFigure.firstElementChild === img) {
        currentFigure.parentNode.insertBefore(img, currentFigure);
        currentFigure.remove();
      }
    }
    afterDomEdit();
    toast.success('Alt / légende mis à jour.');
  }, [afterDomEdit]);

  // Même contrat + masque les barres flottantes (FAQ, tableau)
  const afterFaqEdit = useCallback(() => {
    afterDomEdit();
    setFaqHover(null);
    setTableHover(null);
  }, [afterDomEdit]);

  // Scroll doux vers un nœud — technique de jumpToChange (pas de scrollIntoView,
  // bug Chrome sur contentEditable).
  const scrollToFaqNode = useCallback((node) => {
    const container = articleRef.current;
    if (!container || !node || node.nodeType !== Node.ELEMENT_NODE) return;
    const relativeTop = node.getBoundingClientRect().top
      - container.getBoundingClientRect().top
      + container.scrollTop;
    container.scrollTo({ top: Math.max(0, relativeTop - container.clientHeight / 3), behavior: 'smooth' });
  }, []);

  // Détection du survol (appelée depuis onMouseOver du contentEditable)
  const detectFaqHover = useCallback((target) => {
    const container = articleRef.current;
    if (!container) return null;
    const block = findFaqBlock(container);
    if (!block || !isInsideFaq(block, target)) return null;
    const rect = rectOfNodes(block.nodes);
    if (!rect) return null;
    const { groups } = getQAGroups(block);
    const qaIdx = findQAIndex(groups, target);
    const qa = qaIdx >= 0
      ? { index: qaIdx, count: groups.length, rect: rectOfNodes(groups[qaIdx].nodes) || rect }
      : null;
    return { rect, qa };
  }, []);

  // Relit le bloc FAQ au moment du clic (le DOM a pu changer depuis le survol)
  const withFaqBlock = useCallback((fn) => {
    const container = articleRef.current;
    if (!container) return;
    const block = findFaqBlock(container);
    if (!block) { toast.error('Section FAQ introuvable'); setFaqHover(null); return; }
    fn(container, block);
  }, []);

  // Copier/couper la FAQ ENTIÈRE (barre au survol du titre FAQ) → presse-papiers
  // de blocs commun (mêmes boutons « Coller » que les autres blocs).
  const faqCopyOrCut = useCallback((cut) => {
    withFaqBlock((container, block) => {
      const meta = { name: 'FAQ', art: 'la FAQ', fem: true };
      blockClipRef.current = { html: serializeFaqBlock(block), meta };
      if (cut) removeFaqBlock(block);
      setBlockClipboard({ mode: cut ? 'couper' : 'copier', ...meta });
      afterFaqEdit();
      toast.success(
        `FAQ ${cut ? 'coupée' : 'copiée'} — faites un CLIC DROIT à l'endroit voulu puis « Coller la FAQ »`,
        { duration: 7000 },
      );
    });
  }, [withFaqBlock, afterFaqEdit]);

  // Copier/couper N'IMPORTE QUEL bloc (élément top-level : tableau, titre,
  // paragraphe, image…) — depuis le panneau Structure ou le clic droit.
  // Une modification EN ATTENTE (paire <del>+<mark> adjacente, ou <ins>) est
  // traitée comme UN SEUL bloc : COUPER emporte les marqueurs (on peut encore
  // Accepter/Rejeter après collage), COPIER produit une copie PROPRE de la
  // version proposée (sans marqueurs).
  const blockClipFromEl = useCallback((el, cut) => {
    if (!el || !articleRef.current || el.parentNode !== articleRef.current) {
      toast.error('Aucun bloc identifié à cet endroit');
      return;
    }
    const cluster = diffClusterOf(el);
    const main = cluster[cluster.length - 1]; // pour une paire : le <mark> (nouvelle version)
    const meta = blockMeta(main);
    const html = cut
      ? cluster.map(n => n.outerHTML).join('')
      : cleanBlocksHtml(cluster);
    if (!html || !html.trim()) {
      toast.error(`${meta.name} vide — rien à ${cut ? 'couper' : 'copier'}`);
      return;
    }
    blockClipRef.current = { html, meta };
    if (cut) cluster.forEach(n => n.remove());
    setBlockClipboard({ mode: cut ? 'couper' : 'copier', ...meta });
    if (cut) afterFaqEdit(); else setFaqHover(null);
    toast.success(
      `${meta.name} ${accord(meta, cut ? 'coupé' : 'copié')} — CLIC DROIT à l'endroit voulu puis « Coller ${meta.art} »`,
      { duration: 6000 },
    );
  }, [afterFaqEdit]);

  // Copier/couper une SECTION ENTIÈRE (H2 + tout son contenu) depuis le panneau
  // Structure. Les modifications en attente voyagent avec la section (couper) ;
  // la copie est PROPRE (version proposée, sans marqueurs).
  const sectionClip = useCallback((els, cut) => {
    const container = articleRef.current;
    const nodes = (els || []).filter(n => n && n.parentNode === container);
    if (!container || !nodes.length) {
      toast.error('Section introuvable dans l\'éditeur');
      return;
    }
    const meta = { name: 'Section', art: 'la section', fem: true };
    const html = cut ? nodes.map(n => n.outerHTML).join('') : cleanBlocksHtml(nodes);
    if (!html.trim()) { toast.error('Section vide — rien à ' + (cut ? 'couper' : 'copier')); return; }
    blockClipRef.current = { html, meta };
    if (cut) nodes.forEach(n => n.remove());
    setBlockClipboard({ mode: cut ? 'couper' : 'copier', ...meta });
    if (cut) afterFaqEdit();
    toast.success(
      `Section ${cut ? 'coupée' : 'copiée'} — CLIC DROIT à l'endroit voulu puis « Coller la section »`,
      { duration: 6000 },
    );
  }, [afterFaqEdit]);

  // Variante BubbleToolbar : résout le bloc au point du clic droit (range
  // sauvegardé), sinon à la sélection courante.
  const blockClipFromRange = useCallback((range, cut) => {
    const container = articleRef.current;
    if (!container) return;
    let el = null;
    try { el = blockAtRange(container, range); } catch { el = null; }
    if (!el) {
      const sel = window.getSelection();
      if (sel && sel.rangeCount) { try { el = blockAtRange(container, sel.getRangeAt(0)); } catch {} }
    }
    // FAQ : un clic droit N'IMPORTE OÙ dans la FAQ cible la FAQ ENTIÈRE
    // (titre + toutes les questions) — pas seulement l'élément cliqué.
    if (el) {
      const faqBlk = findFaqBlock(container);
      if (faqBlk && isInsideFaq(faqBlk, el)) { faqCopyOrCut(cut); return; }
    }
    blockClipFromEl(el, cut);
  }, [blockClipFromEl, faqCopyOrCut]);

  // Colle le presse-papiers au CARET courant (bloc top-level le plus proche),
  // sinon en fin d'article. Plus JAMAIS d'échec silencieux : chaque cas
  // impossible est expliqué à l'utilisateur.
  const blockPaste = useCallback(() => {
    const clip = blockClipRef.current;
    if (!clip?.html) {
      toast.error('Presse-papiers vide — coupez ou copiez d\'abord un bloc');
      setBlockClipboard(null); // resynchronise le bandeau si l'état a divergé
      return;
    }
    if (!articleRef.current) {
      toast.error('Éditeur indisponible — repassez en Vue diff pour coller');
      return;
    }
    // Caret dans l'article ? Sinon le collage retombe en FIN d'article — on le dit.
    const sel = window.getSelection();
    const caretInside = !!(sel && sel.rangeCount && articleRef.current.contains(sel.getRangeAt(0).startContainer));
    const first = insertFaqHtmlAtCaret(articleRef.current, clip.html);
    if (!first) { toast.error('Collage impossible — cliquez dans l\'article puis réessayez'); return; }
    setBlockClipboard(null);
    afterFaqEdit();
    scrollToFaqNode(first);
    toast.success(
      `${clip.meta.name} ${accord(clip.meta, 'collé')}`
      + (caretInside ? '' : ' en fin d\'article (posez le curseur dans le texte pour choisir l\'endroit)'),
      { duration: caretInside ? 4000 : 6000 },
    );
  }, [afterFaqEdit, scrollToFaqNode]);

  // Collage au point du CLIC DROIT : la barre d'outils (BubbleToolbar) fournit
  // la sélection sauvegardée au moment du clic droit → on la restaure puis on
  // colle. Repli : caret courant / fin d'article si le range est périmé.
  const pasteBlockAtRange = useCallback((range) => {
    try {
      if (range && articleRef.current && articleRef.current.contains(range.startContainer)) {
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      }
    } catch { /* range périmé — collage au caret courant */ }
    blockPaste();
  }, [blockPaste]);

  // Collage AVANT/APRÈS un bloc précis — menu contextuel du panneau Structure.
  const pasteBlockRelative = useCallback((refEl, where) => {
    const clip = blockClipRef.current;
    const container = articleRef.current;
    if (!clip?.html) {
      toast.error('Presse-papiers vide — coupez ou copiez d\'abord un bloc');
      setBlockClipboard(null); // resynchronise le bandeau si l'état a divergé
      return;
    }
    if (!container) {
      toast.error('Éditeur indisponible — repassez en Vue diff pour coller');
      return;
    }
    const first = insertBlockHtml(container, clip.html, refEl, where);
    if (!first) { toast.error('Collage impossible'); return; }
    setBlockClipboard(null);
    afterFaqEdit();
    scrollToFaqNode(first);
    toast.success(`${clip.meta.name} ${accord(clip.meta, 'collé')} ${where === 'before' ? 'avant' : 'après'} le bloc`);
  }, [afterFaqEdit, scrollToFaqNode]);

  const faqMoveBlock = useCallback((dir) => {
    withFaqBlock((container, block) => {
      if (!moveFaqBlockBySection(container, block, dir)) {
        toast(dir < 0 ? 'La FAQ est déjà tout en haut' : 'La FAQ est déjà tout en bas', { icon: 'ℹ️' });
        return;
      }
      afterFaqEdit();
      scrollToFaqNode(block.nodes.find(n => n.nodeType === Node.ELEMENT_NODE));
    });
  }, [withFaqBlock, afterFaqEdit, scrollToFaqNode]);

  const faqDeleteBlock = useCallback(() => {
    withFaqBlock((container, block) => {
      if (!window.confirm('Supprimer toute la section FAQ ? (annulable avec Ctrl+Z)')) return;
      removeFaqBlock(block);
      afterFaqEdit();
      toast.success('FAQ supprimée');
    });
  }, [withFaqBlock, afterFaqEdit]);

  // Actions sur une Q/R : 'up' | 'down' | 'add' | 'delete'
  const faqQAAction = useCallback((action, index) => {
    withFaqBlock((container, block) => {
      const qa = getQAGroups(block);
      if (action === 'up' || action === 'down') {
        if (!moveQAGroup(qa.groups, index, action === 'up' ? -1 : 1)) return;
      } else if (action === 'delete') {
        const label = qa.groups[index]?.question?.textContent?.trim().slice(0, 60) || '';
        if (!window.confirm(`Supprimer la question « ${label} » et sa réponse ? (annulable avec Ctrl+Z)`)) return;
        deleteQAGroup(qa.groups, index);
      } else if (action === 'add') {
        const questionEl = insertQAAfter(block, qa, index);
        if (!questionEl) { toast.error('Format de FAQ non reconnu'); return; }
        // Sélectionner le texte placeholder de la nouvelle question → remplacé à la frappe
        requestAnimationFrame(() => {
          try {
            const range = document.createRange();
            range.selectNodeContents(questionEl);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
            articleRef.current?.focus();
          } catch { /* sélection impossible — sans gravité */ }
        });
      }
      afterFaqEdit();
    });
  }, [withFaqBlock, afterFaqEdit]);

  // ── Appliquer un lien interne (depuis le span surligné ou fallback regex) ──
  const applyInternalLink = useCallback((anchor, url, linkIdx) => {
    if (!articleRef.current) return;
    // Priorité : retrouver le span injecté par le surlignage
    const span = articleRef.current.querySelector(`[data-il-idx="${linkIdx}"]`);
    if (span) {
      const a = document.createElement('a');
      a.href  = url;
      a.innerHTML = span.innerHTML;
      span.parentNode.replaceChild(a, span);
      contentRef.current = articleRef.current.innerHTML;
      lockMedia(articleRef.current);
      setAppliedLinks(prev => new Set([...prev, linkIdx]));
      toast.success(`Lien interne ajouté : "${anchor}"`);
      return;
    }
    // Fallback : regex sur l'innerHTML brut
    const html    = articleRef.current.innerHTML;
    const escaped = anchor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex   = new RegExp(`(?<!<[^>]*)${escaped}(?![^<]*>)`, 'i');
    const newHtml = html.replace(regex, match => `<a href="${url}">${match}</a>`);
    if (newHtml !== html) {
      articleRef.current.innerHTML = newHtml;
      contentRef.current = newHtml;
      lockMedia(articleRef.current);
      setAppliedLinks(prev => new Set([...prev, linkIdx]));
      humanEditRef.current = true;
      triggerAutosave(); // action couverte par Ctrl+Z + sauvegardée comme toute édition
      toast.success(`Lien interne ajouté : "${anchor}"`);
    } else {
      toast.error(`Ancre introuvable dans l'article : "${anchor}"`);
    }
  }, [lockMedia, triggerAutosave]);

  // ── Tisser les liens internes suggérés DANS un bloc donné ───────────────────
  // Utilisé sur les blocs fraîchement insérés (suggestions) : chaque ancre de
  // lien interne encore non appliquée et trouvée dans le bloc devient un vrai
  // <a>. Liens INTERNES uniquement — le verrou liens externes n'est pas
  // concerné. Le lien vit dans le bloc suggéré : il suit son sort
  // (accepté/rejeté avec lui). Jamais dans un titre (h1-h6) — un lien interne
  // doit toujours vivre dans un paragraphe (ou tout autre bloc non-titre).
  const weaveLinksInto = useCallback((el) => {
    if (!el || !internalLinks.length) return 0;
    let woven = 0;
    internalLinks.forEach((link, idx) => {
      if (appliedLinks.has(idx) || !link.anchor || !link.url) return;
      const escaped = link.anchor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const rx = new RegExp(escaped, 'i');
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
      let node;
      while ((node = walker.nextNode())) {
        if (node.parentElement?.closest('a, del, [data-il-idx], h1, h2, h3, h4, h5, h6')) continue;
        const m = node.textContent.match(rx);
        if (!m) continue;
        const target = node.splitText(node.textContent.search(rx));
        target.splitText(m[0].length);
        const a = document.createElement('a');
        a.href = link.url;
        target.parentNode.insertBefore(a, target);
        a.appendChild(target);
        setAppliedLinks(prev => new Set([...prev, idx]));
        woven++;
        break; // une injection par lien
      }
    });
    return woven;
  }, [internalLinks, appliedLinks]);

  // ── Injecter les surlignages gris dans l'article dès que les liens arrivent ──
  // Utilise TreeWalker (nœuds texte) au lieu d'une regex sur innerHTML :
  // la vue diff contient des <mark>/<del>/<ins> qui fragmentent le texte,
  // la regex sur chaîne manquait les ancres split sur plusieurs balises.
  useEffect(() => {
    if (!articleRef.current || internalLinks.length === 0) return;
    if (articleRef.current.querySelector('[data-il-idx]')) return;

    let injected = 0;

    // Candidats d'ancrage : l'ancre complète, puis des variantes raccourcies en
    // retirant le dernier mot — mais jamais en dessous de 3 mots (ou la longueur
    // de l'ancre si elle est plus courte). Évite de surligner un fragment trop
    // générique qui pointerait vers le mauvais endroit (ex. "isolation des").
    const anchorCandidates = (anchor) => {
      const words = (anchor || '').trim().split(/\s+/).filter(Boolean);
      if (words.length <= 3) return [words.join(' ')].filter(Boolean);
      const out = [];
      for (let len = words.length; len >= 3; len--) out.push(words.slice(0, len).join(' '));
      return out;
    };

    internalLinks.forEach((link, i) => {
      let done = false;
      for (const candidate of anchorCandidates(link.anchor)) {
        if (done) break;
        const escaped   = candidate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const textRegex = new RegExp(escaped, 'i');

        const walker = document.createTreeWalker(
          articleRef.current,
          NodeFilter.SHOW_TEXT,
          null
        );

        let node;
        while ((node = walker.nextNode())) {
          // Ignorer le contenu supprimé (<del>), les spans déjà surlignés et les
          // titres (h1-h6) — un lien interne doit toujours vivre dans un
          // paragraphe, jamais dans un titre.
          if (node.parentElement?.closest('del, [data-il-idx], h1, h2, h3, h4, h5, h6')) continue;

          const text  = node.textContent;
          const match = text.match(textRegex);
          if (!match) continue;

          const idx = text.search(textRegex);
          // Découper le nœud texte : [avant][ancre][après]
          const anchorNode = node.splitText(idx);       // anchorNode = [ancre][après]
          anchorNode.splitText(match[0].length);        // anchorNode = [ancre] seulement

          // Envelopper anchorNode dans un span highlight
          const span = document.createElement('span');
          span.setAttribute('data-il-idx', String(i));
          span.setAttribute('data-il-url', link.url);
          // title vide : neutralise l'info-bulle système héritée d'un <mark> parent
          // (sinon le survol du lien orange affiche la raison de la modif, ex. "Skill X — …")
          span.setAttribute('title', '');
          span.className = 'il-highlight';
          anchorNode.parentNode.insertBefore(span, anchorNode);
          span.appendChild(anchorNode);

          injected++;
          done = true;
          break; // Une injection par lien interne
        }
      }
    });

    if (injected > 0) {
      contentRef.current = articleRef.current.innerHTML;
      lockMedia(articleRef.current);
    }
  }, [internalLinks, lockMedia, articleEl]); // articleEl → re-run quand le div monte

  // ── Comptage de mots ─────────────────────────────────────────────────────
  const countWords = (html) => {
    if (!html) return 0;
    return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().split(/\s+/).filter(Boolean).length;
  };
  // Mots retirés / ajoutés = cumul des champs original/updated des updates appliqués
  const wordsRemoved = useMemo(
    () => appliedUpdates.reduce((sum, u) => sum + countWords(u.original || ''), 0),
    [appliedUpdates]
  );
  const wordsAdded = useMemo(
    () => appliedUpdates.reduce((sum, u) => sum + countWords(u.updated || ''), 0),
    [appliedUpdates]
  );
  // Total mots dans l'article final
  const totalWords = useMemo(() => countWords(agent.updatedContent || ''), [agent.updatedContent]);
  const showWordStats = !!(agent.updatedContent && appliedUpdates.length > 0);
  const [addedIdx, setAddedIdx] = useState(null);

  const applyMissed = useCallback((update, missedIdx) => {
    if (!articleRef.current) {
      toast.error('Basculez en vue diff pour appliquer la correction.');
      return;
    }

    const currentHtml = contentRef.current;
    let newHtml = currentHtml;
    let matched = false;
    const isSuppression = update.type === 'suppression';

    // Stratégie 1 : remplacement exact OU suppression (applyDiff — toutes stratégies)
    if (update.type !== 'addition' && update.original) {
      const r = applyDiff(currentHtml, update.original, isSuppression ? '' : update.updated, update.reason, isSuppression);
      if (r.matched) { newHtml = r.html; matched = true; }
    }

    // Une suppression ne retombe JAMAIS sur une insertion de secours (cela injecterait
    // le texte "undefined" sans rien supprimer) : si non localisée, on n'applique rien.
    if (isSuppression && !matched) {
      toast.error('Passage à supprimer introuvable — retire-le manuellement dans la vue diff.');
      return;
    }

    // Stratégie 2 : insertion par ancre (applyAddition)
    if (!matched && update.anchor) {
      const r = applyAddition(currentHtml, update.anchor, update.updated);
      if (r.matched) { newHtml = r.html; matched = true; }
    }

    // Stratégie 2.5 : remplacement FLOU — barre le passage le plus proche (#1).
    // Pour un remplacement (pas une addition) dont l'original n'a pas été localisé :
    // on barre le bloc le plus ressemblant au lieu de seulement insérer le nouveau
    // texte (sinon l'ancien resterait non barré → suppression manuelle).
    if (!matched && update.type !== 'addition' && update.original) {
      const r = applyReplacementFuzzy(currentHtml, update.original, update.updated, update.reason);
      if (r.matched) { newHtml = r.html; matched = true; }
    }

    // Stratégie 3 : paragraphe le plus proche par chevauchement lexical
    if (!matched) {
      const r = insertNearClosestParagraph(currentHtml, update.original || update.updated, update.updated);
      newHtml = r.html;
      matched = true;
    }

    // Mettre à jour le DOM
    articleRef.current.innerHTML = newHtml;
    lockMedia(articleRef.current);

    // Tisser les liens internes suggérés dans le bloc fraîchement inséré —
    // identifié par son texte (le dernier ins/mark du document n'est pas
    // forcément lui), avec repli sur le dernier inséré.
    let woven = 0;
    try {
      const tmp = document.createElement('div');
      tmp.innerHTML = update.updated || '';
      const uText = (tmp.textContent || '').trim().slice(0, 60);
      const cands = Array.from(articleRef.current.querySelectorAll('ins.added-content, mark.updated-content'));
      const freshEl = (uText && cands.find(el => (el.textContent || '').includes(uText))) || cands[cands.length - 1] || null;
      woven = weaveLinksInto(freshEl);
    } catch { /* tissage best-effort — l'insertion reste valide sans lien */ }

    contentRef.current = articleRef.current.innerHTML;
    humanEditRef.current = true;
    triggerAutosave(); // action couverte par Ctrl+Z + sauvegardée comme toute édition

    // Marquer comme appliqué dans Redux
    const newDiff = updates.map(d =>
      d.applied === false &&
      d.original === update.original &&
      d.updated  === update.updated &&
      d.reason   === update.reason
        ? { ...d, applied: true }
        : d
    );
    dispatch(setDiff(newDiff));

    // Scroll vers la correction insérée
    setTimeout(() => {
      const els = articleRef.current?.querySelectorAll('ins.added-content, mark.updated-content');
      if (els?.length) els[els.length - 1].scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 80);

    setAddedIdx(missedIdx);
    toast.success(woven > 0
      ? `Correction ajoutée + ${woven} lien${woven > 1 ? 's' : ''} interne${woven > 1 ? 's' : ''} tissé${woven > 1 ? 's' : ''} dedans !`
      : 'Correction ajoutée dans l\'article !');
    setTimeout(() => setAddedIdx(null), 2000);
  }, [updates, dispatch, lockMedia, weaveLinksInto, triggerAutosave]);

  // « Placer » une addition : au lieu de l'insertion auto par ancre, on charge le
  // bloc dans le presse-papiers de blocs → l'utilisateur choisit OÙ le coller
  // (clic droit dans l'article, ou panneau Structure : coller avant/après).
  const placeAddition = useCallback((update, missedIdx) => {
    if (!update.updated) return;
    let meta = { name: 'Bloc', art: 'le bloc', fem: false };
    try {
      const tmp = document.createElement('div');
      tmp.innerHTML = update.updated;
      if (tmp.firstElementChild) meta = blockMeta(tmp.firstElementChild);
    } catch { /* garde le meta par défaut */ }
    blockClipRef.current = { html: update.updated, meta };
    setBlockClipboard({ mode: 'copier', ...meta });
    // La suggestion est considérée traitée (elle va être placée par l'utilisateur)
    const newDiff = updates.map(d =>
      (d.applied === false && d.updated === update.updated && d.reason === update.reason)
        ? { ...d, applied: true } : d
    );
    dispatch(setDiff(newDiff));
    setAddedIdx(missedIdx);
    setTimeout(() => setAddedIdx(null), 2000);
    toast.success(
      `${meta.name} prêt — CLIC DROIT à l'endroit voulu → « Coller », ou panneau Structure (coller avant/après)`,
      { duration: 6000 },
    );
  }, [updates, dispatch]);

  // « Où va s'insérer cette suggestion ? » — localise le point d'ancrage dans
  // l'article (ancre exacte, sinon bloc au plus fort recouvrement lexical),
  // scrolle dessus et le met en évidence brièvement.
  const locateSuggestion = useCallback((update) => {
    const root = articleRef.current;
    if (!root) { toast.error('Basculez en vue diff pour localiser.'); return; }
    const strip = (h) => { const d = document.createElement('div'); d.innerHTML = h || ''; return (d.textContent || '').trim(); };
    const needle = normalizeText(strip(update.anchor || update.original)).toLowerCase();
    const blocks = Array.from(root.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, td, blockquote'));
    let target = needle
      ? blocks.find(b => normalizeText(b.textContent || '').toLowerCase().includes(needle)) || null
      : null;
    if (!target) {
      const refWords = new Set((needle || normalizeText(strip(update.updated)).toLowerCase()).split(/\s+/).filter(w => w.length > 3));
      let bestScore = 0;
      for (const b of blocks) {
        const bw = (b.textContent || '').toLowerCase().split(/\s+/).filter(w => w.length > 3);
        if (!bw.length || !refWords.size) continue;
        const score = bw.filter(w => refWords.has(w)).length / refWords.size;
        if (score > bestScore) { bestScore = score; target = b; }
      }
      if (bestScore < 0.25) target = null;
    }
    if (!target) {
      toast('Repère introuvable dans l\'article (contenu remanié) — utilisez « Placer… » pour choisir l\'endroit.',
        { icon: <Info size={16} className="text-indigo-500" />, duration: 5000 });
      return;
    }
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const prevBg = target.style.backgroundColor;
    target.style.transition = 'background-color 0.35s';
    target.style.backgroundColor = '#e0e7ff';
    setTimeout(() => { target.style.backgroundColor = prevBg; }, 1600);
    toast('La suggestion s\'insérera après le passage surligné.',
      { icon: <Crosshair size={16} className="text-indigo-500" /> });
  }, []);

  const handleExport = async (format) => {
    const finalContent = getFinalHtml();
    let content = '';
    if (format === 'text') content = exportAsText(finalContent);
    // `articleUrl` : sans lui, la politique de suivi ne peut pas distinguer un
    // lien interne d'un lien externe et met du nofollow partout.
    else if (format === 'html') content = exportAsHtml(finalContent, articleUrl);
    else if (format === 'markdown') content = exportAsMarkdown(finalContent, articleUrl);
    await copyToClipboard(content);
    toast.success(`Copié en ${format.toUpperCase()} !`);
    setShowExport(false);
  };

  // Normalise le hostname : supprime www. et met en minuscules pour comparaison robuste
  const normalizeHost = (h) => h.replace(/^www\./, '').toLowerCase();

  // Site WP de l'article (un seul) : par correspondance d'hôte avec l'URL de
  // l'article — SOURCE DE VÉRITÉ. Le wpData mémorisé (MCP) ne sert de repli que
  // si l'article n'a pas d'URL : il peut être périmé (article précédent) et
  // pointait alors le MAUVAIS site dans le menu Publier (confusion de sites).
  // Le menu Publier ne propose QUE ce site (l'article n'appartient qu'à lui).
  const articleSiteId = (() => {
    if (articleUrl) {
      try {
        const h = normalizeHost(new URL(articleUrl).hostname);
        return wpSites.find(s => { try { return normalizeHost(new URL(s.url).hostname) === h; } catch { return false; } })?.id || null;
      } catch { return null; }
    }
    return wpMcpData?.siteId || null;
  })();
  const articleSite  = articleSiteId ? wpSites.find(s => s.id === articleSiteId) : null;
  const publishSites = articleSite ? [articleSite] : wpSites;

  // Dernier segment de chemin d'une URL = slug WordPress (minuscules).
  // Sert à garantir que la cible d'une publication correspond bien à l'article affiché.
  const slugOfUrl = (u) => {
    try { return (new URL(u).pathname.replace(/\/$/, '').split('/').filter(Boolean).pop() || '').toLowerCase(); }
    catch { return ''; }
  };

  // Charge toutes les catégories + tags du site WP (auto-triggered par MCP ou sélection manuelle)
  const catLoadedSiteRef = useRef(null);
  const loadWpCategories = useCallback(async (site) => {
    if (!site?.id) return;
    if (catLoadedSiteRef.current === site.id) return; // déjà chargé pour ce site
    catLoadedSiteRef.current = site.id;
    setCatLoading(true);
    setWpCategories([]);
    try {
      const resp = await axios.post('/api/wp-categories', { siteId: site.id, wpSites });
      setWpCategories(resp.data.categories || []);
    } catch { /* non bloquant */ }
    finally { setCatLoading(false); }
  }, [wpSites]);

  // Auto-charger catégories dès qu'un article WP est détecté via MCP
  useEffect(() => {
    if (!wpMcpData?.siteId) return;
    const site = wpSites.find(s => s.id === wpMcpData.siteId);
    if (site) loadWpCategories(site);
  }, [wpMcpData?.siteId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pré-sélectionner les catégories de l'article dès qu'on a les données MCP.
  // Réinitialise catsDirty : c'est l'état d'origine du post, pas une modif utilisateur.
  useEffect(() => {
    if (wpMcpData?.categories?.length) { setSelectedCategories(wpMcpData.categories); setCatsDirty(false); }
  }, [wpMcpData?.categories]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-suggestion de catégorie : uniquement si l'article n'a AUCUNE vraie catégorie
  // (rien de sélectionné, ou seulement « non classé »). L'agent classe l'article dans
  // une catégorie EXISTANTE et la pré-sélectionne ; l'utilisateur confirme à la publication.
  const catSuggestedRef = useRef(false);
  useEffect(() => {
    if (catSuggestedRef.current) return;
    if (!agent.updatedContent || wpCategories.length === 0) return;
    // Ne JAMAIS suggérer/écraser si l'article a déjà de vraies catégories (données MCP).
    // Changer les catégories d'un post à permalien /catégorie/slug casse son URL → 404.
    if (wpMcpData?.categories?.length) return;
    const onlyUncat = selectedCategories.length > 0 && selectedCategories.every(id => {
      const c = wpCategories.find(x => String(x.id) === String(id));
      return c && /non[\s-]?class|uncategor/i.test(c.name || '');
    });
    if (selectedCategories.length > 0 && !onlyUncat) return; // a déjà une vraie catégorie
    catSuggestedRef.current = true;
    suggestCategory(agent.updatedContent, wpCategories)
      .then(id => {
        if (id == null) return;
        setSelectedCategories([id]);
        const c = wpCategories.find(x => String(x.id) === String(id));
        toast(`Catégorie suggérée : ${c?.name || id}`, { icon: <Tag size={16} /> });
      })
      .catch(() => {});
  }, [wpCategories, agent.updatedContent, selectedCategories]); // eslint-disable-line react-hooks/exhaustive-deps

  // Quand on ouvre le menu WP, chercher si l'article existe déjà sur le site sélectionné.
  // Priorité : données MCP déjà récupérées par l'agent (pas de nouvelle requête WP).
  const handleOpenWP = async (site) => {
    setWpFoundPost(null);
    setWpNotFoundReason('');
    setShowWP(site.id);
    setShowCatPanel(false);
    setCatSearch('');
    loadWpCategories(site);
    if (!articleUrl) {
      setWpNotFoundReason('Aucune URL associée à cet article (analysé par copier-coller).');
      return;
    }
    let siteHost = '', articleHost = '';
    try { siteHost    = normalizeHost(new URL(site.url).hostname); } catch {}
    try { articleHost = normalizeHost(new URL(articleUrl).hostname); } catch {}
    if (!siteHost || siteHost !== articleHost) {
      setWpNotFoundReason(`L'article (${articleHost || '?'}) n'appartient pas à ce site (${siteHost || '?'}).`);
      return;
    }

    // ── MCP : données déjà disponibles → pas besoin de refaire la recherche ──
    if (wpMcpData && wpMcpData.siteId === site.id && wpMcpData.postId) {
      setWpFoundPost({
        id:       wpMcpData.postId,
        title:    { rendered: currentArticle?.title || articleUrl },
        slug:     '',
        postType: wpMcpData.postType || 'posts',
        link:     wpMcpData.postLink || '',
        _fromMcp: true,
      });
      return;
    }

    // ── Fallback : recherche classique par slug ────────────────────────────────
    setWpSearching(true);
    const found = await findPostByUrl(site, articleUrl);
    setWpSearching(false);
    if (found.success) {
      setWpFoundPost(found.post);
    } else {
      setWpNotFoundReason(found.error || 'Article non trouvé dans les posts et pages WordPress.');
    }
  };

  // foundPost (optionnel) : permet de cibler un post sans passer par le state wpFoundPost.
  // mode : 'update' → publier sur le site (statut publish) · 'updateDraft' → publier dans
  // brouillons (repasse l'article EXISTANT en brouillon, retiré du site public).
  const handlePublish = async (site, mode = 'update', foundPost = null) => {
    // ── Modifications encore EN ATTENTE → acceptées automatiquement avant publication ──
    // L'article part EXACTEMENT tel qu'il s'affiche dans « Après » (choix produit :
    // plus de popup de garde-fou). Sans ça, getFinalHtml republierait le texte
    // ORIGINAL aux endroits non acceptés. processAllSegments('accept') mute le DOM
    // de façon SYNCHRONE → getFinalHtml() ci-dessous reflète bien l'état accepté.
    if (countPendingChanges() > 0) processAllSegments('accept');

    // ── R1 — FILET ULTIME : les liens INTERNES de l'article AVANT sont repris ───
    // C'est le SEUL endroit où la vraie référence « AVANT » (agent.originalContent,
    // figée au chargement de l'article) et le HTML final coexistent. Sans ce filet,
    // tous les chemins d'écriture qui ne passent par aucun verrou contournent R1 :
    // « Appliquer » une suggestion en attente, les correctifs de style des phases 3
    // et 4, et les écritures humaines (collage, lien posé à la main).
    // NON BLOQUANT : la publication n'est jamais empêchée, on se contente de
    // ré-envelopper ce qui peut l'être et d'avertir en console pour le reste.
    // NO-OP STRICT si la référence est vide — après un F5 sur un article dont le
    // contenu a été offloadé, `originalContent` vaut '' (Articles.jsx) : sans cette
    // garde, on croirait TOUS les liens perdus et on en ré-injecterait au hasard.
    let finalHtml = getFinalHtml();
    let filetR1Restaures = 0;
    let filetR1Manquants = [];
    {
      const reference = (agent.originalContent || '').trim();
      if (reference) {
        const carried = carryOverInternalLinks(reference, finalHtml, articleUrl);
        finalHtml = carried.html;
        filetR1Restaures = carried.restored.length;
        filetR1Manquants = carried.missing;
        if (carried.missing.length) {
          console.warn(`[R1 publication] ${carried.missing.length} lien(s) interne(s) de l'article d'origine absent(s) du texte publié :`, carried.missing.map((l) => l.href));
        }
      }
    }

    // ── R2 — FILET ULTIME : les liens du BRIEF sont TOUS dans le texte publié ───
    // Même raison que le filet R1 juste au-dessus, et même nécessité : R2 est posé
    // à la GÉNÉRATION, or six chemins d'écriture la contournent ensuite. Le cas
    // concret : une suggestion de phase 3 acceptée remplace un paragraphe qui
    // portait un lien du brief → le lien disparaît, définitivement et en silence.
    // La garantie « 100 % » ne vaut que si elle est revérifiée ICI, au seul
    // passage obligatoire de la publication.
    // Le forçage rédigé s'applique aussi — décision assumée — MAIS il n'est plus
    // muet : voir le garde-fou de relecture juste en dessous.
    let filetR2Redigees = [];
    let filetR2Manquantes = [];
    {
      // Mêmes paires que la génération : la saisie de phase 2 prime sur le brief
      // de lancement, sinon le filet réparerait un maillage qui n'est plus celui
      // que le rédacteur a validé.
      const saisies = cleanLinkRows(briefLinkRows);
      const briefLinks = saisies.length
        ? saisies
        : (currentArticle?.qatBrief || cqItem?.majResult?.qatBrief || {}).internalLinks || [];
      if (briefLinks.length) {
        const woven = weaveBriefLinks(finalHtml, briefLinks, articleUrl);
        finalHtml = woven.html;
        filetR2Redigees = woven.written;
        filetR2Manquantes = woven.missing;
        if (woven.written.length) {
          console.warn(`[R2 publication] ${woven.written.length} lien(s) du brief RÉ-INSÉRÉ(S) par le code au moment de publier (perdu(s) en cours d'édition) :`, woven.written.map((l) => l.url));
        }
        if (woven.missing.length) {
          console.warn(`[R2 publication] ${woven.missing.length} lien(s) du brief ABSENT(S) du texte publié :`, woven.missing);
        }
      }
    }

    // ── R4 — FILET ULTIME : les IMAGES de l'article AVANT sont dans le texte ───
    // Même raison et même nécessité que les deux filets ci-dessus. R4 est posé à
    // la GÉNÉRATION, or tous les chemins d'écriture qui suivent le contournent :
    // « Appliquer » une suggestion en attente, les correctifs de style des phases
    // 3 (obsolescence) et 4 (relecture), et les écritures humaines. C'est ICI, au
    // seul passage obligatoire de la publication, que la garantie « toutes les
    // images sont là » se vérifie une dernière fois.
    // NON BLOQUANT : la publication n'est jamais empêchée.
    // NO-OP STRICT si la référence est vide (F5 sur un article offloadé).
    // L'image à la une (figure[data-featured]) est HORS PÉRIMÈTRE : elle est
    // gérée à part et retirée du contenu publié quelques lignes plus bas — la
    // réinjecter ici recréerait justement le doublon que ce retrait évite.
    let filetR4Restaurees = [];
    let filetR4Manquantes = [];
    {
      const reference = (agent.originalContent || '').trim();
      if (reference) {
        const imgs = carryOverImages(reference, finalHtml);
        finalHtml = imgs.html;
        filetR4Restaurees = imgs.restored;
        filetR4Manquantes = imgs.missing;
        if (imgs.missing.length) {
          console.warn(`[R4 publication] ${imgs.missing.length} image(s) de l'article d'origine absente(s) du texte publié :`, imgs.missing.map((i) => i.src));
        }
      }
    }

    // ── GARDE-FOU DE RELECTURE — le code vient d'écrire dans l'article ─────────
    // Le contrat passé avec le rédacteur est « le code marque ce qu'il écrit, tu
    // le relis ». Sur CE chemin le contrat était structurellement intenable : la
    // clause est écrite dans une variable locale, `exportAsHtml` en retire la
    // marque dans la même foulée, et le texte partait sur le site sans avoir
    // jamais été affiché — le seul signal étant un console.warn.
    // On rétablit donc l'étape de relecture, au seul endroit où elle a un sens :
    //   • ANNULER  → le HTML MARQUÉ est réinjecté dans l'éditeur, la publication
    //     s'arrête, le rédacteur voit les clauses en jaune et les reformule ;
    //   • PUBLIER  → décision explicite, prise en connaissance de cause.
    // Rien ne se déclenche si le code n'a rien écrit : le chemin normal de
    // publication est inchangé (aucune popup ajoutée au quotidien).
    // ── FACTUEL ECARTE — CONFIRMATION AVANT PUBLICATION ────────────────────
    // Les cases de la phase 2 laissent decocher « passages a supprimer » et
    // « affirmations a sourcer ». C'est voulu : sur une MAJ simple a 200 mots,
    // sourcer dix affirmations est hors perimetre. Mais decocher de la VERACITE
    // n'est pas decocher une suggestion SEO — publier sans l'avoir revu doit etre
    // une decision prise, pas un oubli. Meme dispositif que la confirmation du
    // maillage redige juste en dessous, et pour la meme raison : la phase 2 peut
    // etre loin derriere au moment de publier.
    const factuelEcarte = unselectedFactualFields(auditSelection, auditJson);
    if (factuelEcarte.length) {
      const LIB = {
        a_supprimer:   'passages a supprimer signales par l\'audit',
        sources_check: 'affirmations a sourcer ou a retirer',
      };
      const liste = factuelEcarte
        .map((f) => `• ${LIB[f]} (${(auditJson?.[f] || []).length})`)
        .join('\n');
      const ok = window.confirm(
        `L'audit a signale du FACTUEL qui a ete ecarte en phase 2 :\n\n${liste}\n\n`
        + 'Ces points n\'ont pas ete transmis a la generation : l\'article part sans '
        + 'qu\'ils aient ete traites.\n\n'
        + 'OK = publier quand meme.\n'
        + 'Annuler = arreter ici et les recocher en phase 2.',
      );
      if (!ok) {
        toast('Publication annulee — recochez le bloc « Factuel » en phase 2, puis relancez la generation.', { icon: '⚠', duration: 9000 });
        return;
      }
    }

    if (filetR2Redigees.length) {
      const liste = filetR2Redigees.map((l) => `• ${l.anchor} → ${l.url}`).join('\n');
      const ok = window.confirm(
        `${filetR2Redigees.length} lien(s) du brief manquaient dans le texte : le code vient d'ÉCRIRE `
        + `${filetR2Redigees.length} phrase(s) « À lire aussi : … » pour les placer.\n\n${liste}\n\n`
        + 'Ce texte n\'a jamais été relu et il partira tel quel sur le site.\n\n'
        + 'OK = publier quand même.\n'
        + 'Annuler = arrêter ici et relire dans l\'éditeur (les phrases y seront surlignées en jaune).',
      );
      if (!ok) {
        // Réinjection AVEC les marques : c'est tout l'intérêt de s'arrêter.
        const el = articleRef.current;
        if (el) { el.innerHTML = finalHtml; lockMedia(el); }
        contentRef.current = finalHtml;
        humanEditRef.current = true;
        triggerAutosave();
        toast('Publication annulée — les phrases écrites par le code sont surlignées en jaune dans l\'éditeur. Reformulez-les, puis publiez.', { icon: '✎', duration: 10000 });
        return;
      }
    }
    // Non bloquant, mais plus jamais silencieux : ce que le code a réparé ou n'a
    // pas pu placer est DIT, à l'écran et pas seulement dans la console.
    if (filetR1Restaures || filetR1Manquants.length || filetR2Manquantes.length) {
      const bribes = [];
      if (filetR1Restaures) bribes.push(`${filetR1Restaures} lien(s) interne(s) d'origine ré-enveloppé(s)`);
      if (filetR1Manquants.length) bribes.push(`${filetR1Manquants.length} lien(s) interne(s) d'origine NON repris`);
      if (filetR2Manquantes.length) bribes.push(`${filetR2Manquantes.length} lien(s) du brief sans emplacement autorisé`);
      toast(`Contrôle des liens avant publication : ${bribes.join(' — ')}.`, { icon: '🔗', duration: 8000 });
    }
    // R4 — dit à l'écran, pas seulement dans la console : une image remise par le
    // code au niveau de la SECTION est à une place APPROXIMATIVE, et le rédacteur
    // ne l'a pas vue dans l'éditeur (elle est remise dans le HTML publié).
    if (filetR4Restaurees.length || filetR4Manquantes.length) {
      const approx = filetR4Restaurees.filter((i) => i.how === 'section').length;
      const bribes = [];
      if (filetR4Restaurees.length) {
        bribes.push(`${filetR4Restaurees.length} image(s) d'origine remise(s) dans le texte publié`
          + (approx ? ` (dont ${approx} au niveau de la SECTION seulement — placement à vérifier sur le site)` : ''));
      }
      if (filetR4Manquantes.length) bribes.push(`${filetR4Manquantes.length} image(s) d'origine NON replacée(s) : leur contexte a disparu du texte`);
      toast(`Contrôle des images avant publication : ${bribes.join(' — ')}.`, { icon: '🖼️', duration: 9000 });
    }

    setPublishing(true);
    const rawHtml = exportAsHtml(finalHtml, articleUrl);

    // ── Suppression SYSTÉMATIQUE de figure[data-featured] du contenu publié ──────
    // figure[data-featured] est un artefact interne TONTON AI : injecté par le proxy
    // (proxy.js ~2078) UNIQUEMENT pour la preview dans l'éditeur. Le thème WordPress
    // affiche déjà l'image à la une via son widget « Image mise en avant ».
    // L'inclure dans le contenu publié crée un DOUBLON visuel (l'image apparaît une
    // 2e fois dans le widget « Contenu de la publication »).
    // → On la retire toujours, indépendamment de l'état de featured_media.
    let htmlContent = rawHtml;
    {
      const tmp = document.createElement('div');
      tmp.innerHTML = rawHtml;
      tmp.querySelectorAll('figure[data-featured]').forEach(f => f.remove());
      htmlContent = tmp.innerHTML;
    }

    // ── Tableaux responsives sur le site WordPress ───────────────────────────────
    // Filet de publication (idempotent) : chaque <table> part enveloppée dans un
    // conteneur à défilement horizontal (styles inline, indépendants du thème) —
    // un tableau large ne casse plus l'affichage mobile du site.
    htmlContent = makeTablesResponsive(htmlContent);

    // ── Tag auteur (champ caché) ─────────────────────────────────────────────────
    // Signe la MAJ avec l'auteur courant via un commentaire HTML : invisible pour le
    // lecteur, présent dans la source, sans nécessiter de meta WordPress enregistrée.
    const majAuthor = [authUser?.prenom, authUser?.nom].filter(Boolean).join(' ') || authUser?.username || '';
    if (majAuthor) {
      const stamp = new Date().toISOString().slice(0, 10);
      htmlContent = `<!-- MAJ par ${majAuthor} le ${stamp} -->\n${htmlContent}`;
    }

    // foundPost prioritaire sur le state
    let postToUse = foundPost || wpFoundPost;
    const wantDraft = (mode === 'updateDraft'); // « Publier dans brouillons » → statut draft
    let result;

    // ── Garde-fou anti mauvaise cible (correctif publication sur le mauvais post) ──
    // La cible mémorisée peut être périmée (ex. review rouverte sans rebinder la cible),
    // ce qui écraserait un AUTRE article du même site. On ne garde la cible que si son
    // slug correspond à l'URL de l'article affiché ; sinon on retrouve le bon post par
    // son slug (findPostByUrl = source de vérité). Si rien ne correspond → pas de cible.
    {
      const articleSlug = slugOfUrl(articleUrl);
      const targetSlug  = slugOfUrl(postToUse?.link) || (postToUse?.slug || '').toLowerCase();
      if (!postToUse || !articleSlug || articleSlug !== targetSlug) {
        const found = articleUrl ? await findPostByUrl(site, articleUrl) : { success: false };
        postToUse = found.success ? found.post : null;
      }
    }

    if (postToUse) {
      // ── Mise à jour de l'article EXISTANT — statut selon le choix ──
      // « Publier sur le site » → publish · « Publier dans brouillons » → draft (retire
      // l'article du site public jusqu'à republication). Jamais de changement d'auteur ;
      // titre seulement si édité manuellement.
      // featured_media n'accompagne la publication QUE si la cible est bien l'article
      // en cours d'édition (URL de l'article == post cible). On se base sur articleUrl
      // (source de vérité, déjà vérifiée plus haut) et NON sur wpMcpData.postLink, qui
      // peut être absent après un upload/réouverture — ce qui faisait silencieusement
      // sauter la mise à jour de l'image à la une.
      const featuredMatchesTarget =
        !!wpMcpData?.featuredMediaId &&
        !!articleUrl &&
        slugOfUrl(articleUrl) === slugOfUrl(postToUse?.link);

      const postData = { content: htmlContent, status: wantDraft ? 'draft' : 'publish' };
      if (titleDirty && editedTitle) postData.title = editedTitle;
      if (featuredMatchesTarget) postData.featured_media = wpMcpData.featuredMediaId;
      // Catégories : envoyées UNIQUEMENT si l'utilisateur les a modifiées à la main.
      // Sinon on ne TOUCHE PAS aux catégories du post existant → son permalien
      // (souvent /catégorie/slug) reste intact → pas de 404 sur l'ancienne URL.
      if (catsDirty && selectedCategories.length > 0) postData.categories = selectedCategories;
      if (seoTitle || seoDescription) postData.seoMeta = { seoTitle, seoDescription };
      // Mot-clé cible → focus keyphrase SEO (Yoast/RankMath/SEOPress)
      const focusKw = (agent.targetKeyword || currentArticle?.keyword || cqItem?.keyword || '').trim();
      if (focusKw) postData.focusKeyword = focusKw;
      // Date de publication choisie dans l'outil (optionnelle) → ISO 8601
      if (publishDate) postData.date = new Date(publishDate).toISOString();

      result = await updatePost(site, postToUse.id, postData, postToUse.postType || 'posts');
      const postLabel = postToUse.title?.rendered || postToUse.slug || 'article';
      if (result.success) {
        if (wantDraft) {
          toast.success(`« ${postLabel} » repassé en brouillon sur ${site.name} — retiré du site public jusqu'à republication.`, { duration: 7000 });
        } else {
          toast.success(`Article mis à jour sur ${site.name} !`, { duration: 6000 });
          // ?nocache systématique : la page ouverte est la version FRAÎCHE, pas
          // celle du cache WordPress/CDN (l'équipe croyait la MAJ non appliquée).
          if (result.link) window.open(withNoCache(result.link), '_blank');
        }
      }
    } else {
      // Aucun article existant identifiable sur ce site (contenu collé sans URL, ou slug
      // introuvable) → on ne publie/écrase RIEN au hasard : nouveau brouillon de secours.
      const draftTitle = editedTitle || currentArticle?.title || 'Article';
      result = await publishToWordPress(site, {
        title: draftTitle, content: htmlContent, status: 'draft',
        ...(publishDate ? { date: new Date(publishDate).toISOString() } : {}),
      });
      if (result.success) {
        toast(`Article introuvable sur ${site.name} — nouveau brouillon créé à la place.`, { icon: <AlertTriangle size={16} className="text-amber-500" />, duration: 7000 });
      }
    }

    if (!result.success) {
      toast.error(`Erreur WordPress : ${result.error}`, { duration: 8000 });
    } else {
      // Temps de travail : horodater la publication sur le doc article_time
      articleTimeTracker.markPublished();
      // NB : on ne vide PLUS le brouillon ici. Publier ne doit pas détruire la session —
      // on peut vouloir continuer à éditer/republier (ex. ajouter une image). Le brouillon
      // est nettoyé au démarrage d'une NOUVELLE MAJ (Articles.jsx), pas à la publication.
      const finalHtml = getFinalHtml();
      const pub = { publishedAt: new Date().toISOString(), publishedUrl: result.link || articleUrl || '' };
      const alreadyArchived = agent.currentArticleId && historyList.some(a => a.id === agent.currentArticleId);

      if (alreadyArchived) {
        // Déjà dans l'Historique (flux Articles, ou déjà publié/terminé) → simple mise à jour.
        dispatch(updateInHistory({
          id: agent.currentArticleId,
          updatedContent: finalHtml,
          updates: agent.diff || [],
          sources: agent.sources || [],
          ...pub,
        }));
      } else {
        // Pas encore archivé (flux CQ publié sans « Terminer ») → on ARCHIVE à la publication,
        // sinon la MAJ n'apparaît jamais dans l'Historique (bug « Historique vide »).
        const r = cqItem?.majResult || {};
        const articleData = {
          ...(agent.currentArticleId ? { id: agent.currentArticleId } : (cqItem ? { id: cqItem.id } : {})),
          title:           editedTitle || r.articleTitle || cqItem?.title || extractH1FromHtml(agent.originalContent) || '',
          originalContent: agent.originalContent || r.originalContent || '',
          updatedContent:  finalHtml,
          updates:         agent.diff    || [],
          sources:         agent.sources || [],
          analysis:        agent.analysis || r.analysis || '',
          audit:           agent.audit    || r.audit    || '',
          // Mode QAT : audit structuré + métadonnées de l'article réécrit. Sans ces
          // champs, un article produit en QAT perdait son audit dès le « Terminer »
          // ou la publication : l'onglet AUDIT était vide à la réouverture depuis
          // l'Historique, et le bandeau « article réécrit » disparaissait.
          // `qatArticle.html` est retiré : c'est déjà `updatedContent`.
          // Avancement du parcours en 4 phases (remplace l'ancien `majMode`).
          ...(agent.phaseStatus ? { phaseStatus: agent.phaseStatus } : {}),
          ...(agent.majScope    ? { majScope: agent.majScope }       : {}),
          ...(auditJson  ? { auditJson } : {}),
          ...(qatArticle ? { qatArticle: (({ html, ...rest }) => rest)(qatArticle) } : {}),
          url:             articleUrl || cqItem?.url || '',
          keyword:         cqItem?.keyword || '',
          priority:        cqItem?.priority || 'normale',
          assigneeId:      cqItem?.assigneeId || authUid || authUsername || null,
          createdAt:       new Date().toISOString(),
          tokenUsage:      agent.tokenUsage || null,
          ...pub,
        };
        // Repli local (Firestore KO / hors-ligne) : archive en session ET fixe
        // currentArticleId → évite un doublon si l'utilisateur republie dans la foulée.
        const localId = articleData.id || Date.now().toString();
        const archiveLocal = () => {
          dispatch(addToHistory({ ...articleData, id: localId }));
          dispatch(setCurrentArticleId(localId));
        };
        if (firebaseReady) {
          saveArticle(articleData)
            .then(({ id, originalContentUrl, updatedContentUrl }) => {
              const { originalContent, updatedContent, ...meta } = articleData;
              dispatch(addToHistory({
                ...meta, id,
                ...(originalContentUrl ? { originalContentUrl } : { originalContent }),
                ...(updatedContentUrl  ? { updatedContentUrl  } : { updatedContent  }),
              }));
              dispatch(setCurrentArticleId(id));
            })
            .catch(archiveLocal);
        } else {
          archiveLocal();
        }
      }

      // ── La PUBLICATION SUR LE SITE clôt la validation ─────────────────────────
      // L'article publié sort de la file « MAJ en attente » : il ne vit plus que
      // dans l'Historique (archivé ci-dessus / à la fin d'analyse). « Publier
      // dans brouillons » ne clôt PAS — le travail est encore en cours.
      if (!wantDraft && cqItem) {
        dispatch(removePendingItem(cqItem.id));
        toast.success('Publié — retiré de « MAJ en attente », consultable dans l\'Historique', { duration: 5000 });
      }
    }

    setPublishing(false);
    setShowWP(null);
    setWpFoundPost(null);
    setWpNotFoundReason('');
  };

  return (
    <div className="space-y-4 pb-28"> {/* pb-28 : dégage la barre d'actions épinglée en bas */}

      {/* ── Barre de stats — DÉPLIABLE, dépliée par défaut ──────────────────────
          Repliée, elle laisse « Analyse terminée » seul sur une ligne : le bilan
          reste lisible, et l'éditeur remonte de toute la hauteur du bandeau. */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-card p-4 flex flex-wrap items-center gap-x-6 gap-y-2"
      >
        <button
          type="button"
          onClick={() => setShowStats((v) => !v)}
          className="flex items-center gap-2 group"
          title={showStats ? 'Replier le bilan' : 'Déplier le bilan'}
        >
          <CheckCircle2 size={16} className="text-sage-500" />
          <span className="text-sm font-semibold text-gray-800">Analyse terminée</span>
          {showStats
            ? <ChevronUp size={14} className="text-gray-400 group-hover:text-gray-700" />
            : <ChevronDown size={14} className="text-gray-400 group-hover:text-gray-700" />}
        </button>
        {showStats && (<>
        <div className="h-4 w-px bg-gray-200 hidden sm:block" />
        {/* Modifications proposées dans l'article — « proposées » et non « appliquées » :
            chacune reste à accepter ✓ ou rejeter ✗ en Vue diff avant de sortir de l'éditeur
            (getFinalHtml, pendingChanges='reject'). L'ancien libellé laissait croire que la
            Vue finale les contenait déjà. */}
        <div className="text-sm text-gray-600">
          <span className="font-bold text-gray-900">{appliedUpdates.length}</span>
          {' '}modification{appliedUpdates.length !== 1 ? 's' : ''} proposée{appliedUpdates.length !== 1 ? 's' : ''}
          {' '}dans l'article
        </div>
        {/* Modifications non localisées */}
        {missedUpdates.length > 0 && (
          <>
            <div className="h-4 w-px bg-gray-200 hidden sm:block" />
            <div className="flex items-center gap-1.5 text-xs text-amber-600">
              <AlertTriangle size={13} />
              <span>
                <span className="font-semibold">{missedUpdates.length}</span>
                {' '}suggestion{missedUpdates.length > 1 ? 's' : ''} non localisée{missedUpdates.length > 1 ? 's' : ''} dans le texte
              </span>
            </div>
          </>
        )}
        <div className="h-4 w-px bg-gray-200 hidden sm:block" />
        <div className="text-sm text-gray-600">
          <span className="font-bold text-gray-900">{sources.length}</span>
          {' '}source{sources.length !== 1 ? 's' : ''} vérifiée{sources.length !== 1 ? 's' : ''}
        </div>

        {/* ── Compteur de mots ── */}
        {showWordStats && (
          <>
            <div className="h-4 w-px bg-gray-200 hidden sm:block" />
            <div className="flex items-center gap-3 text-xs">
              <span className="text-red-500 font-medium" title="Mots retirés par TONTON AI">
                −{wordsRemoved} retirés
              </span>
              <span className="text-emerald-600 font-medium" title="Mots ajoutés par TONTON AI">
                +{wordsAdded} ajoutés
              </span>
              <span className="text-gray-500" title="Total de mots dans l'article mis à jour">
                {totalWords.toLocaleString()} mots
              </span>
              {/* Indicateur objectif +200 */}
              {(wordsAdded - wordsRemoved) < 200 ? (
                <span
                  title="Objectif recommandé : +200 mots nets pour une MAJ plus efficace"
                  style={{
                    fontSize: 10, fontWeight: 700,
                    background: '#fef3c7', color: '#d97706',
                    border: '1px solid #fcd34d',
                    borderRadius: 99, padding: '1px 7px',
                    cursor: 'help', whiteSpace: 'nowrap',
                  }}
                >
                  objectif +200
                </span>
              ) : (
                <span
                  title="Objectif +200 mots nets atteint OK"
                  style={{
                    fontSize: 10, fontWeight: 700,
                    background: '#d1fae5', color: '#059669',
                    border: '1px solid #6ee7b7',
                    borderRadius: 99, padding: '1px 7px',
                    cursor: 'help', whiteSpace: 'nowrap',
                  }}
                >
                  +200 <CheckCircle2 size={13} className="inline text-emerald-600 shrink-0" />
                </span>
              )}
            </div>
          </>
        )}
        {updates.length === 0 && (
          <>
            <div className="h-4 w-px bg-gray-200 hidden sm:block" />
            <div className={`flex items-center gap-1.5 text-xs ${parseFailed ? 'text-red-500' : 'text-gray-400'}`}>
              <AlertTriangle size={13} />
              <span>
                {parseFailed
                  ? 'Réponse Claude non parsée — relancez l\'analyse (article trop long ou JSON malformé)'
                  : 'Aucune modification détectée — lancez la passe 2 pour approfondir'}
              </span>
            </div>
          </>
        )}
        {p2Updates.length > 0 && (
          <>
            <div className="h-4 w-px bg-gray-200 hidden sm:block" />
            <div className="flex items-center gap-1.5 text-xs text-purple-600 font-medium">
              <Sparkles size={13} />
              <span>+{p2Updates.filter(u => u.applied).length} passe 2</span>
            </div>
          </>
        )}

        {/* Tokens consommés */}
        {agent.tokenUsage && (
          <div className="flex items-center gap-3 text-xs text-gray-400 border-l border-gray-200 pl-3 ml-auto mr-3">
            <span title="Tokens envoyés à Claude">
              ↑ {(agent.tokenUsage.input || 0).toLocaleString()}
            </span>
            <span title="Tokens générés par Claude">
              ↓ {(agent.tokenUsage.output || 0).toLocaleString()}
            </span>
            <span className="font-medium text-gray-600" title="Coût estimé USD">
              ~${(agent.tokenUsage.costUsd || 0).toFixed(4)}
            </span>
          </div>
        )}

        {/* Bouton deuxième passe */}
        <div className={agent.tokenUsage ? '' : 'ml-auto'}>
          {reviewing ? (
            <div className="flex items-center gap-3 bg-purple-50 border border-purple-100 rounded-xl px-4 py-2">
              <Loader size={13} className="animate-spin text-purple-500 flex-shrink-0" />
              <div className="min-w-0">
                <p className="text-[11px] font-medium text-purple-700 truncate max-w-[220px]">{reviewStep}</p>
                <div className="mt-1 h-1 bg-purple-100 rounded-full overflow-hidden w-40">
                  <motion.div
                    className="h-full bg-purple-400 rounded-full"
                    animate={{ width: `${reviewProgress}%` }}
                    transition={{ duration: 0.4 }}
                  />
                </div>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <motion.button
                onClick={() => setShowSourcesModal(true)}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                className="flex items-center gap-2 bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-medium px-3 py-2 rounded-xl transition-colors border border-blue-200"
              >
                <Link2 size={13} />
                Ajouter des sources
              </motion.button>
              <motion.button
                onClick={handleReview}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                className="flex items-center gap-2 bg-purple-600 hover:bg-purple-700 text-white text-xs font-medium px-3 py-2 rounded-xl transition-colors shadow-sm"
              >
                <Sparkles size={13} />
                Relire &amp; enrichir
                <span className="bg-purple-500 rounded-md px-1.5 py-0.5 text-[10px]">Passe 2</span>
              </motion.button>
            </div>
          )}
        </div>
        </>)}
      </motion.div>

      {/* ── Analyse globale — accordéon replié par défaut (même pattern que
             « Détail des modifications ») pour laisser les onglets visibles ── */}
      {agent.analysis && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="glass-card p-4 space-y-3"
        >
          <div
            className="flex items-center gap-3 cursor-pointer"
            onClick={() => setShowAnalysis(v => !v)}
          >
            <div className="w-7 h-7 bg-black rounded-lg flex items-center justify-center flex-shrink-0">
              <Info size={13} className="text-white" />
            </div>
            <h3 className="text-sm font-semibold text-gray-800 flex items-center gap-2 flex-1">
              Synthèse de l'agent
              {showAnalysis ? <ChevronUp size={14} className="text-gray-400" /> : <ChevronDown size={14} className="text-gray-400" />}
            </h3>
            {!showAnalysis && (
              <span className="text-[11px] text-gray-400 truncate max-w-[45%]">
                {String(agent.analysis).replace(/[#*_`>]/g, '').slice(0, 90)}…
              </span>
            )}
          </div>
          {showAnalysis && (
            <div
              className="md-content text-gray-700 text-[13px] leading-snug [&_h1]:!text-lg [&_h1]:!my-2 [&_h1]:!border-0 [&_h1]:!pb-0 [&_h2]:!text-base [&_h2]:!my-2 [&_h2]:!border-0 [&_h2]:!pb-0 [&_h3]:!text-sm [&_h3]:!my-1.5 [&_h4]:!text-sm [&_h4]:!my-1 [&_p]:!text-[13px] [&_p]:!my-1 [&_p]:!leading-snug [&_li]:!text-[13px] [&_li]:!my-0.5 [&_ul]:!my-1 [&_ol]:!my-1"
              dangerouslySetInnerHTML={{ __html: emojiToIcons(renderMarkdown(agent.analysis)) }}
            />
          )}
        </motion.div>
      )}

      {/* ── Catégories WordPress (visible si article MCP) ── */}
      {wpMcpData?.siteId && (wpCategories.length > 0 || catLoading) && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-card px-5 py-4 space-y-3"
        >
          {/* En-tête cliquable — bloc replié par défaut */}
          <div
            className="flex items-center justify-between gap-3 cursor-pointer"
            onClick={() => setShowCatsBlock(v => !v)}
          >
            <div className="flex items-center gap-2">
              <Tag size={14} className="text-indigo-500 flex-shrink-0" />
              <span className="text-sm font-semibold text-gray-800">Catégories WordPress</span>
              {showCatsBlock
                ? <ChevronUp size={14} className="text-gray-400" />
                : <ChevronDown size={14} className="text-gray-400" />}
              {catLoading && <Loader size={12} className="animate-spin text-gray-400" />}
            </div>
            {/* Replié : rappel de la sélection · Déplié : barre de recherche */}
            {!showCatsBlock && selectedCategories.length > 0 && (
              <span className="text-[11px] text-indigo-500 font-medium">
                {selectedCategories.length} sélectionnée{selectedCategories.length > 1 ? 's' : ''}
              </span>
            )}
            {showCatsBlock && (
              <div className="relative w-44" onClick={(e) => e.stopPropagation()}>
                <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                <input
                  value={catSearch}
                  onChange={e => setCatSearch(e.target.value)}
                  placeholder="Filtrer…"
                  className="w-full pl-7 pr-3 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-300 bg-white"
                />
              </div>
            )}
          </div>

          {/* Catégories */}
          {showCatsBlock && wpCategories.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {wpCategories
                .filter(c => !catSearch || decodeHtml(c.name).toLowerCase().includes(catSearch.toLowerCase()))
                .map(cat => {
                  const name    = decodeHtml(cat.name);
                  const checked = selectedCategories.includes(cat.id);
                  return (
                    <button
                      key={cat.id}
                      onClick={() => { setCatsDirty(true); setSelectedCategories(prev =>
                        checked ? prev.filter(id => id !== cat.id) : [...prev, cat.id]
                      ); }}
                      className={`inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full border transition-colors ${
                        checked
                          ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                          : 'bg-white text-gray-600 border-gray-200 hover:border-indigo-300 hover:text-indigo-600'
                      }`}
                    >
                      {checked && <CheckCircle2 size={11} />}
                      {name}
                      <span className={`text-[10px] ${checked ? 'text-indigo-200' : 'text-gray-400'}`}>{cat.count}</span>
                    </button>
                  );
                })}
            </div>
          )}

          {/* Résumé sélection */}
          {showCatsBlock && selectedCategories.length > 0 && (
            <p className="text-[11px] text-indigo-600 font-medium">
              <CheckCircle2 size={13} className="inline text-emerald-600 shrink-0" /> {selectedCategories.length} catégorie{selectedCategories.length > 1 ? 's' : ''} sélectionnée{selectedCategories.length > 1 ? 's' : ''} — appliquée{selectedCategories.length > 1 ? 's' : ''} à la publication
            </p>
          )}
        </motion.div>
      )}

      {/* ── Carte AVANT / APRÈS ── */}
      <div className="glass-card overflow-hidden">

        {/* Barre onglets + actions — ÉPINGLÉE EN BAS de l'écran (portal fixed) :
            reste toujours visible pendant qu'on parcourt l'article, pour changer
            de vue (Audit/Avant/Après) et accéder à Terminer/Exporter/Publier
            sans remonter en haut. Décalée de la sidebar sur desktop (md:left-60).
            Les menus Exporter/Publier s'ouvrent VERS LE HAUT (bottom-full). */}
        {createPortal(
        <div className="fixed bottom-0 left-0 right-0 md:left-60 z-40 bg-white/95 backdrop-blur-md border-t border-gray-200 shadow-[0_-6px_24px_rgba(0,0,0,0.10)]">
        <div className="flex items-center justify-between gap-2 px-4 sm:px-6 flex-wrap">
          <div className="flex items-center gap-1.5 py-2.5 flex-wrap">
            {[
              ...((auditReport || hasBrainSkill) ? [{
                id: TAB_AUDIT, label: 'Audit', icon: ClipboardCheck,
                activeText: 'text-violet-700', activeBg: 'bg-violet-50', activeRing: 'ring-violet-200',
                activeIcon: 'text-violet-600', idleIcon: 'text-violet-400',
              }] : []),
              {
                id: TAB_AVANT, label: 'Avant', icon: FileText,
                activeText: 'text-slate-800', activeBg: 'bg-slate-100', activeRing: 'ring-slate-200',
                activeIcon: 'text-slate-600', idleIcon: 'text-slate-400',
              },
              {
                id: TAB_APRES, label: isQat ? 'Après — article réécrit' : 'Après — MAJ proposées', icon: Sparkles,
                activeText: 'text-emerald-700', activeBg: 'bg-emerald-50', activeRing: 'ring-emerald-200',
                activeIcon: 'text-emerald-600', idleIcon: 'text-emerald-500',
              },
            ].map(t => {
              const active = activeTab === t.id;
              const Icon = t.icon;
              return (
                <button
                  key={t.id}
                  onClick={() => setActiveTab(t.id)}
                  title={`Vue ${t.label}`}
                  className={`relative flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors duration-200 ${
                    active ? t.activeText : 'text-gray-400 hover:text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {active && (
                    <motion.div
                      layoutId="tab-indicator"
                      transition={{ type: 'spring', stiffness: 500, damping: 40 }}
                      className={`absolute inset-0 rounded-lg ring-1 ${t.activeBg} ${t.activeRing}`}
                    />
                  )}
                  <Icon size={15} className={`relative z-10 transition-colors ${active ? t.activeIcon : t.idleIcon}`} />
                  <span className="relative z-10">{t.label}</span>
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-2 py-3">

            {/* Annuler / Rétablir — TOUJOURS visibles (l'équivalent en tête
                d'article sort de l'écran au scroll). Couvre frappe, accepter/
                rejeter, suggestions insérées, liens internes appliqués. */}
            {activeTab === TAB_APRES && diffMode && hasContent && (
              <div className="flex items-center gap-0.5 border-r border-gray-200 pr-2 mr-1">
                <button onClick={undo} disabled={!histState.canUndo} title="Annuler (Ctrl+Z)"
                  className="flex items-center justify-center w-7 h-7 rounded-lg hover:bg-black/10 text-gray-500 hover:text-gray-800 disabled:opacity-30 disabled:hover:bg-transparent transition-colors">
                  <Undo2 size={15} />
                </button>
                <button onClick={redo} disabled={!histState.canRedo} title="Rétablir (Ctrl+Y)"
                  className="flex items-center justify-center w-7 h-7 rounded-lg hover:bg-black/10 text-gray-500 hover:text-gray-800 disabled:opacity-30 disabled:hover:bg-transparent transition-colors">
                  <Redo2 size={15} />
                </button>
              </div>
            )}

            {/* Enregistrer (sans quitter) + Terminer (enregistre, archive et quitte) —
                deux actions distinctes : avant, « Terminer » cumulait les deux rôles */}
            {(cqItem || agent.currentArticleId) && (
              <>
                <button
                  onClick={handleEnregistrer}
                  disabled={enregistrant || terminant}
                  title="Enregistre tout le travail en cours (texte, titre, SEO Meta, date, instruction, image à la une) — vous restez dans l'éditeur"
                  className="btn-secondary text-xs"
                >
                  {enregistrant
                    ? <Loader size={13} className="animate-spin" />
                    : <Save size={13} />
                  }
                  Enregistrer
                </button>
                {/* « Terminer » n'apparaît QU'EN PHASE 4, comme « Publier ». Il
                    archive l'article et quitte l'éditeur : cliqué en phase 1, il
                    archivait un article dont rien n'avait encore été généré.
                    « Enregistrer », lui, reste disponible à toutes les phases —
                    sauvegarder son travail ne doit jamais être bridé. */}
                {phase === PHASE_RELECTURE && (
                  <button
                    onClick={handleTerminer}
                    disabled={terminant || enregistrant}
                    title="Enregistre, archive l'article dans l'Historique et quitte l'éditeur"
                    className="btn-primary text-xs bg-gray-900 hover:bg-gray-700"
                  >
                    {terminant
                      ? <Loader size={13} className="animate-spin" />
                      : <ShieldCheck size={13} />
                    }
                    Terminer
                  </button>
                )}
              </>
            )}

            <div className="relative">
              <button
                onClick={() => { setShowExport(!showExport); setShowWP(null); }}
                className="btn-secondary text-xs"
              >
                <Copy size={13} />
                Exporter
                <ChevronDown size={12} />
              </button>
              <AnimatePresence>
                {showExport && (
                  <motion.div
                    initial={{ opacity: 0, y: 8, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 8, scale: 0.95 }}
                    className="absolute right-0 bottom-full mb-1 glass-card p-1.5 z-50 w-44"
                  >
                    {[
                      { id: 'text', label: 'Texte brut', icon: FileText },
                      { id: 'html', label: 'HTML', icon: Code },
                      { id: 'markdown', label: 'Markdown', icon: FileText },
                    ].map(({ id, label, icon: Icon }) => (
                      <button key={id} onClick={() => handleExport(id)}
                        className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-gray-700 hover:bg-black/5 rounded-lg transition-colors"
                      >
                        <Icon size={14} />{label}
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* « Publier » N'APPARAÎT QU'EN PHASE 4 (relecture).
                Il était visible dans LES QUATRE phases — vérifié en production, y
                compris sur l'écran d'audit où rien n'est encore généré : on pouvait
                donc publier un article non réécrit, en un clic, par erreur.
                La publication est la SEULE action irréversible du parcours (elle
                modifie un article public) : elle appartient à la dernière étape,
                après la relecture humaine. */}
            {wpSites.length > 0 && phase === PHASE_RELECTURE && (
              <div className="relative">
                {/* « Publier » ouvre toujours le menu pour proposer les 2 choix
                    (sur le site / dans brouillons). Si le site est connu via MCP,
                    on le pré-sélectionne pour afficher les 2 choix immédiatement. */}
                <button
                  onClick={() => {
                    setShowExport(false);
                    if (showWP) { setShowWP(null); return; }
                    // Le site de l'article est connu → on l'ouvre directement (2 choix).
                    if (articleSite) {
                      handleOpenWP(articleSite);
                    } else {
                      setShowWP('__menu__');
                      setWpFoundPost(null);
                      setWpNotFoundReason('');
                    }
                  }}
                  disabled={publishing}
                  className="btn-primary text-xs"
                >
                  {publishing ? <Loader size={13} className="animate-spin" /> : <Globe size={13} />}
                  Publier
                  <ChevronDown size={12} />
                </button>
                <AnimatePresence>
                  {showWP && (
                    <motion.div
                      initial={{ opacity: 0, y: 8, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 8, scale: 0.95 }}
                      className="absolute right-0 bottom-full mb-1 glass-card p-2 z-50 w-80 max-h-[70vh] overflow-y-auto"
                    >
                      {publishSites.map(site => (
                        <div key={site.id} className="mb-1 last:mb-0">
                          {/* Nom du site */}
                          <button
                            onClick={() => handleOpenWP(site)}
                            className="w-full flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-black/5 rounded-lg transition-colors"
                          >
                            <Globe size={13} className="text-gray-400" />
                            <span className="flex-1 text-left truncate">{site.name}</span>
                            {wpMcpData?.siteId === site.id && (
                              <span className="text-[10px] font-semibold bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full">MCP</span>
                            )}
                            {wpSearching && showWP === site.id && <Loader size={12} className="animate-spin text-gray-400" />}
                          </button>

                          {/* Options quand ce site est sélectionné */}
                          {showWP === site.id && (
                            <div className="ml-2 pl-3 border-l border-gray-100 space-y-1.5 mt-0.5">

                              {/* ── Sélecteur catégories ───────────────────── */}
                              <div>
                                <button
                                  onClick={() => setShowCatPanel(v => !v)}
                                  className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-600 hover:bg-black/5 rounded-lg transition-colors"
                                >
                                  <Tag size={12} className="text-indigo-400" />
                                  <span className="flex-1 text-left">
                                    Catégories
                                    {selectedCategories.length > 0 && (
                                      <span className="ml-1 bg-indigo-100 text-indigo-700 text-[10px] font-semibold px-1.5 py-0.5 rounded-full">
                                        {selectedCategories.length}
                                      </span>
                                    )}
                                  </span>
                                  {catLoading
                                    ? <Loader size={11} className="animate-spin text-gray-400" />
                                    : <ChevronDown size={11} className={`text-gray-400 transition-transform ${showCatPanel ? 'rotate-180' : ''}`} />
                                  }
                                </button>

                                {showCatPanel && !catLoading && (
                                  <div className="mt-1 bg-gray-50 rounded-xl p-2 space-y-2 max-h-56 overflow-y-auto">
                                    {/* Recherche */}
                                    <div className="relative">
                                      <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                                      <input
                                        value={catSearch}
                                        onChange={e => setCatSearch(e.target.value)}
                                        placeholder="Rechercher…"
                                        className="w-full pl-7 pr-2 py-1.5 text-xs border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-indigo-300"
                                      />
                                    </div>

                                    {/* Catégories */}
                                    {wpCategories.length > 0 && (
                                      <div>
                                        <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wide px-1 mb-1">Catégories</p>
                                        {wpCategories
                                          .filter(c => !catSearch || c.name.toLowerCase().includes(catSearch.toLowerCase()))
                                          .map(cat => (
                                            <label key={cat.id} className="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-white cursor-pointer transition-colors">
                                              <input
                                                type="checkbox"
                                                checked={selectedCategories.includes(cat.id)}
                                                onChange={e => { setCatsDirty(true); setSelectedCategories(prev =>
                                                  e.target.checked ? [...prev, cat.id] : prev.filter(id => id !== cat.id)
                                                ); }}
                                                className="w-3.5 h-3.5 rounded text-indigo-600 accent-indigo-600"
                                              />
                                              <span className="text-xs text-gray-700 truncate flex-1">{decodeHtml(cat.name)}</span>
                                              <span className="text-[10px] text-gray-400">{cat.count}</span>
                                            </label>
                                          ))}
                                      </div>
                                    )}

                                    {wpCategories.length === 0 && (
                                      <p className="text-xs text-gray-400 text-center py-2">Aucune catégorie disponible</p>
                                    )}
                                  </div>
                                )}
                              </div>

                              {/* ── Choix 1 : Publier sur le site (en ligne) ── */}
                              <button
                                onClick={() => handlePublish(site, 'update')}
                                disabled={publishing}
                                title="Met à jour l'article et le publie sur le site (en ligne)"
                                className="w-full flex items-center gap-2 px-3 py-2 text-xs text-green-700 bg-green-50 hover:bg-green-100 rounded-lg transition-colors disabled:opacity-50"
                              >
                                <Globe size={13} />
                                <span className="flex-1 text-left truncate">
                                  Publier sur le site{wpFoundPost ? ` « ${wpFoundPost.title?.rendered || wpFoundPost.slug} »` : ''}
                                </span>
                                {wpFoundPost?._fromMcp && (
                                  <span className="text-[10px] font-semibold bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full shrink-0">MCP</span>
                                )}
                              </button>
                              {/* ── Choix 2 : Publier dans brouillons (hors ligne) ── */}
                              <button
                                onClick={() => handlePublish(site, 'updateDraft')}
                                disabled={publishing}
                                title="Repasse l'article en brouillon (retiré du site public jusqu'à republication)"
                                className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-700 bg-gray-50 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50"
                              >
                                <FileText size={13} className="text-gray-500" />
                                <span className="flex-1 text-left truncate">Publier dans brouillons</span>
                              </button>
                              {!wpFoundPost && !wpSearching && wpNotFoundReason && showWP === site.id && (
                                <p className="px-3 py-1.5 text-[11px] text-amber-600 leading-snug">
                                  <AlertTriangle size={13} className="inline text-amber-500 shrink-0" /> {wpNotFoundReason}
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}
          </div>
        </div>
        </div>,
        document.body)}

        {/* ── Parcours en quatre phases — repère principal du rédacteur ─────── */}
        {/* TOUJOURS VISIBLE : `position: fixed` dans un PORTAL sur document.body,
            exactement comme la barre d'actions du bas quelques lignes plus haut.
            Ce n'est pas une préférence, c'est le seul procédé qui tienne ici.
            Il était `sticky top-62`, et il ne collait JAMAIS. Mesuré dans le
            navigateur le 19 août 2026 : après 2 000 px de défilement, le stepper
            se trouvait à -1 548 px, donc hors écran depuis longtemps. Trois causes
            cumulées, chacune suffisante :
              • `glass-card overflow-hidden` (son parent direct) — `overflow`
                différent de `visible` sur un ancêtre confine un élément sticky à la
                boîte de cet ancêtre ;
              • `p-4 sm:p-6 overflow-x-hidden` (calculé « hidden auto ») ;
              • `<main class="flex-1 overflow-auto">` — et c'est le cas le plus
                trompeur : ce MAIN ne défile JAMAIS. Sa hauteur de contenu égale sa
                hauteur visible (14 671 px pour 14 671 px), parce que la chaîne
                parente est en `min-h-screen` et ne le contraint pas. C'est la
                FENÊTRE qui défile (14 733 px pour 694 px de haut). `overflow: auto`
                fait pourtant de lui le « scrollport » de référence de sticky, qui se
                colle donc à une boîte qui s'en va avec la page.
            Neutraliser un seul ancêtre ne suffit pas, vérifié à l'exécution. D'où
            `fixed`, immunisé contre tous.
            `md:left-60` dégage la barre latérale, comme la barre du bas ; `top: 62`
            reste la hauteur mesurée de la barre du haut, et le z-index passe
            DESSOUS elle (100). */}
        {/* L'ORIGINAL, dans le flux : il occupe sa place et ne masque rien. */}
        <div ref={stepperRef} className="px-6 pt-4 pb-3">
          <PhaseStepper
            phase={phase}
            phaseStatus={phaseStatus}
            onSelect={(p) => dispatch(setPhase(p))}
          />
        </div>

        {/* LA COPIE FLOTTANTE, seulement quand l'original est sorti de l'écran.
            `md:left-60` dégage la barre latérale, comme la barre du bas ; le z-index
            passe DESSOUS la barre du haut (100) et non dessus. */}
        {stepperFlottant && createPortal(
          <div
            className="fixed left-0 right-0 md:left-60 z-[90] px-6 pt-3 pb-3 bg-[#eceef1]/95 backdrop-blur-md border-b border-gray-200/70 shadow-sm"
            style={{ top: TOPBAR_HEIGHT }}
          >
            <PhaseStepper
              phase={phase}
              phaseStatus={phaseStatus}
              onSelect={(p) => dispatch(setPhase(p))}
            />
          </div>,
          document.body,
        )}

        {/* PHASE 4 — le relevé des patterns est un WIDGET FLOTTANT : il se place
            lui-même (position: fixed + portal document.body, cf. PhaseRelecture)
            et n'occupe donc AUCUNE place dans le flux. Il était `sticky` ici, en
            frère du stepper, mais une bande pleine largeur au-dessus de l'éditeur
            rognait la hauteur utile et imposait un aller-retour par point.
            Flottant et repliable, il reste sous les yeux pendant qu'on édite. */}
        {phase === PHASE_RELECTURE && (
          // `key` force le recalcul sur le texte COURANT de l'editeur : le
          // decompte doit refleter les corrections au fur et a mesure.
          <PhaseRelecture
            key={relectureTick}
            html={contentRef.current || agent.updatedContent || ''}
            // Mot-clé RÉSOLU, comme partout ailleurs : `agent.targetKeyword` seul
            // laisserait la mesure de suroptimisation muette sur toute review
            // rouverte depuis la file (le mot-clé y vit dans `cqItem`).
            targetKeyword={(agent.targetKeyword || currentArticle?.keyword || cqItem?.keyword || '').trim()}
            onRefresh={() => setRelectureTick((t) => t + 1)}
            onAccept={handleAcceptStyleFix}
            onLocate={handleLocateStyle}
            onRunStyleFix={handleRunStyleFix}
            styleFixRunning={styleFixRunning}
            styleFixStep={styleFixStep}
            aiProposals={styleAiProposals}
          />
        )}
        <div className="px-6 pt-4 space-y-4">
          {phase === PHASE_AUDIT && (
            <PhaseAudit
              audit={auditJson}
              rapportMarkdown={auditReport}
              onRun={handleAudit}
              running={auditing}
              step={auditStep}
              progress={auditProgress}
              travailEnAval={travailEnAval}
              champsManquants={champsManquantsAudit}
              skillsEnChargement={skillsEnChargement}
              // Le mot-cle cible se saisit dans le panneau quand il manque : c'est
              // la SEULE porte de sortie ici (aucun champ de l'editeur ne le porte)
              // pour les articles rouverts sans mot-cle archive. Meme valeur que
              // celle lue par motCleAudit et par le focus keyphrase a la publication.
              onMotCleChange={(mc) => {
                dispatch(setTargetKeyword(mc));
                toast.success('Mot-clé cible enregistré — l\'audit peut être lancé');
              }}
            />
          )}
          {phase === PHASE_GENERATION && (
            <PhaseGeneration
              audit={auditJson}
              scope={agent.majScope || scopeProposedByAudit(auditJson)}
              onScopeChange={(sc) => dispatch(setMajScope(sc))}
              onGenerate={handleGenerate}
              generating={generating}
              step={genStep}
              progress={genProgress}
              originalHtml={agent.originalContent || ''}
              generatedHtml={qatArticle ? (agent.updatedContent || '') : ''}
              qatArticle={qatArticle}
              prompt={prompt}
              onPromptChange={(t) => { setPrompt(t); setPromptTouche(true); }}
              onResetPrompt={reconstruirePrompt}
              onSaveTemplate={handleSaveTemplate}
              savingTemplate={savingTemplate}
              linkRows={briefLinkRows}
              onLinkRowsChange={setBriefLinkRows}
              articleUrl={articleUrl}
              auditSuggestionsCount={auditLinkSuggestions.length}
              // Cases de l'audit. `setSelectionTouchee` coupe le pre-cochage
              // automatique par ampleur : passe ce point, c'est SA selection qui
              // vaut, et changer d'ampleur ne la reecrit plus.
              auditSelection={auditSelection}
              onAuditSelectionChange={(sel) => { setAuditSelection(sel); setSelectionTouchee(true); }}
            />
          )}
          {phase === PHASE_OBSOLESCENCE && (
            <PhaseObsolescence
              /* Le texte SUR LEQUEL la vérification a porté, sinon les repères
                 ne peuvent pas tomber juste (voir handleVerify). Repli sur
                 updatedContent pour les rapports enregistrés avant ce champ. */
              articleHtml={agent.obsolescenceReport?.texteVerifie || agent.updatedContent || ''}
              suggestions={verifSuggestions}
              appliquees={appliqueesObso}
              running={verifRunning}
              step={verifStep}
              progress={verifProgress}
              aTourne={verifATourne}
              prompt={verifPrompt}
              onPromptChange={(t) => { setVerifPrompt(t); setVerifPromptTouche(true); }}
              onResetPrompt={reconstruireVerifPrompt}
              onSaveTemplate={() => enregistrerModele('verification', verifPrompt, setSavingVerifTemplate)}
              savingTemplate={savingVerifTemplate}
              onRun={handleVerify}
              // Même mécanique qu'en phase 4 (remplacement direct, message clair
              // si le texte n'est pas retrouvé), PLUS la répercussion du passage
              // en vert dans le volet de gauche.
              onAccept={handleAcceptObsolescence}
            />
          )}
        </div>

        {/* Contenu des tabs */}
        <AnimatePresence mode="wait">

          {activeTab === TAB_AUDIT && (
            <motion.div key="audit"
              initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 10 }}
              className="p-6"
            >
              <div className="flex items-center gap-2 mb-3">
                <ClipboardCheck size={15} className="text-violet-500" />
                <p className="text-sm font-semibold text-gray-800">
                  {auditJson ? 'Audit QAT — rapport structuré' : 'Audit du skill — rapport complet'}
                </p>
                <span className="text-[10px] text-gray-400">
                  {auditJson
                    ? 'l\'article réécrit dans « Après » découle de cet audit'
                    : 'les corrections appliquées dans « Après » en sont déduites'}
                </span>
              </div>
              <div className="bg-white border border-gray-200 rounded-xl p-6 min-h-[420px] shadow-sm">
                {auditJson ? (
                  <QatAuditPanel audit={auditJson} />
                ) : auditReport ? (
                  <div
                    onClick={handleAuditToggle}
                    className="md-content audit-md text-sm leading-relaxed break-words [&_h1]:!text-xl [&_h1]:!mt-4 [&_h2]:!text-lg [&_h2]:!mt-5 [&_h3]:!text-base [&_h3]:!mt-3 [&_h4]:!text-sm [&_p]:!text-[13px] [&_li]:!text-[13px] [&_a]:break-all [&_pre]:!max-w-full [&_pre]:!overflow-x-auto [&_pre]:!text-[12px] [&_table]:!table [&_table]:!w-full [&_table]:!max-w-none [&_td]:!align-top [&_td]:!max-w-none [&_th]:!whitespace-normal"
                    dangerouslySetInnerHTML={{ __html: emojiToIcons(renderMarkdown(trimAuditForDisplay(unwrapProseFences(auditReport)), { codePreview: true })) }}
                  />
                ) : (
                  <div className="flex flex-col items-center justify-center text-center py-16 text-gray-400">
                    <ClipboardCheck size={28} className="mb-3 opacity-30" />
                    <p className="text-sm font-medium text-gray-500">Aucun rapport d'audit pour cette MAJ</p>
                    <p className="text-xs mt-1 max-w-sm">
                      Le rapport est généré pendant une analyse quand un skill SKILL.md est actif.
                      Relancez une MAJ sur cet article pour produire l'audit complet.
                    </p>
                  </div>
                )}
              </div>
            </motion.div>
          )}

          {activeTab === TAB_APRES && isQat && qatArticle && (
            <div className="px-6 pt-6 -mb-2">
              <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 overflow-hidden">
                {/* En-tête toujours visible : l'ampleur appliquée et le nombre de
                    mots — de quoi se repérer sans déplier. */}
                <button
                  type="button"
                  onClick={() => setAmpleurDepliee(v => !v)}
                  className="w-full flex items-center gap-2.5 px-4 py-2.5 text-left hover:bg-emerald-100/50 transition-colors"
                >
                  <span className="text-sm font-semibold text-emerald-800 flex-1 min-w-0">
                    {qatArticle.ampleurAppliquee === 'ciblee' ? 'Article mis à jour (MAJ ciblée)'
                      : qatArticle.ampleurAppliquee === 'restructuration' ? 'Article restructuré (plan refait, fond conservé)'
                      : 'Article réécrit entièrement (refonte totale)'}
                  </span>
                  <span className="text-[11px] text-emerald-700 shrink-0">
                    <strong>{qatArticle.wordCount}</strong> mots
                  </span>
                  {/* Les avertissements ne doivent pas pouvoir se cacher derrière un
                      panneau replié : on les signale sur l'en-tête. */}
                  {(qatArticle.strippedExternalLinks?.length > 0
                    || (qatArticle.ampleurSource === 'redacteur' && qatArticle.ampleurOverridden)
                    // R1/R2 — tout ce que le CODE a écrit ou n'a pas pu placer doit
                    // armer le triangle : sans ça, la seule trace était un
                    // console.warn que le rédacteur ne verra jamais.
                    || qatArticle.ancresRedigees?.length > 0
                    || qatArticle.ancresManquantes?.length > 0
                    || qatArticle.ancresMalPlacees?.length > 0
                    || qatArticle.ancresHorsDomaine?.length > 0
                    || qatArticle.ancresNonVerifiables?.length > 0
                    || qatArticle.ancresAutoLien?.length > 0
                    || qatArticle.missingInternalLinks?.length > 0
                    || qatArticle.restoredInternalLinks?.length > 0) && (
                    <AlertTriangle size={13} className="text-amber-600 shrink-0" title="Un point à lire dans ce panneau" />
                  )}
                  {ampleurDepliee ? <ChevronUp size={14} className="text-emerald-600 shrink-0" />
                                  : <ChevronDown size={14} className="text-emerald-600 shrink-0" />}
                </button>
                {ampleurDepliee && (
                  <div className="px-4 pb-3 space-y-1.5 border-t border-emerald-200/70 pt-2.5">
                    <p className="text-xs text-emerald-700">
                      Le mode « Audit QAT + Refonte » ne produit pas de modifications à valider une par une :
                      comparez cette version à l'onglet « Avant », puis corrigez directement dans l'éditeur.
                    </p>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-emerald-700 pt-0.5">
                      {qatArticle.motCleRetenu && <span>Mot-clé : <strong>{qatArticle.motCleRetenu}</strong></span>}
                      {/* Décompte RÉEL (recompté sur le HTML final), et affiché même
                          à 0 dès qu'une paire a été saisie : « rien » ne se distinguait
                          pas de « aucun lien placé ». */}
                      {qatArticle.ancresBrief?.length > 0 && (
                        <span>
                          <strong>{qatArticle.ancresPlacees?.length || 0}</strong>
                          /{qatArticle.ancresBrief.length} lien(s) interne(s) du brief placé(s)
                        </span>
                      )}
                      {/* Brouillon enregistré AVANT ce constat (ancresBrief absent) :
                          on garde l'affichage historique plutôt que de le faire
                          disparaître d'un article déjà généré. */}
                      {!qatArticle.ancresBrief && qatArticle.ancresPlacees?.length > 0 && (
                        <span><strong>{qatArticle.ancresPlacees.length}</strong> lien(s) interne(s) placé(s)</span>
                      )}
                      {qatArticle.ampleurSource === 'redacteur' && qatArticle.ampleurOverridden && (
                        <span className="text-amber-700">Ampleur imposée par le rédacteur, différente de l'audit</span>
                      )}
                    </div>
                    {qatArticle.strippedExternalLinks?.length > 0 && (
                      <p className="text-[11px] text-amber-700">
                        {qatArticle.strippedExternalLinks.length} lien(s) externe(s) ajouté(s) par l'IA ont été retiré(s) —
                        la règle interdit d'ajouter ou de supprimer un lien externe.
                      </p>
                    )}

                    {/* ── R1 / R2 — CE QUE LE CODE A FAIT DANS LE TEXTE ──────────────
                        Ces compteurs n'étaient nulle part : le seul canal était
                        console.warn, plus une ligne de progression écrasée par
                        l'étape suivante. Un article dont du code a rédigé une phrase
                        partait donc en production sans que personne ne le sache. */}
                    {qatArticle.ancresRedigees?.length > 0 && (
                      <p className="text-[11px] text-amber-800 font-medium">
                        ✎ {qatArticle.ancresRedigees.length} clause(s) ÉCRITE(S) PAR LE CODE pour placer un lien du brief
                        introuvable dans le texte — surlignées en jaune dans l'éditeur, À RELIRE et reformuler.
                        La marque ne part pas sur le site ; le lien, si.
                      </p>
                    )}
                    {qatArticle.ancresManquantes?.length > 0 && (
                      <p className="text-[11px] text-amber-700">
                        {qatArticle.ancresManquantes.length} lien(s) du brief NON placé(s) — aucun emplacement autorisé
                        (article sans paragraphe éligible : tableau, FAQ, paragraphes trop courts) :{' '}
                        {qatArticle.ancresManquantes.map(l => l.anchor).join(', ')}. À placer à la main.
                      </p>
                    )}
                    {qatArticle.ancresMalPlacees?.length > 0 && (
                      <p className="text-[11px] text-amber-700">
                        {qatArticle.ancresMalPlacees.length} lien(s) du brief placé(s) dans un emplacement non conforme
                        (titre, tableau, FAQ, TL;DR ou citation) : {qatArticle.ancresMalPlacees.map(l => l.anchor).join(', ')}.
                      </p>
                    )}
                    {qatArticle.ancresHorsDomaine?.length > 0 && (
                      <p className="text-[11px] text-red-700">
                        {qatArticle.ancresHorsDomaine.length} paire(s) de maillage ÉCARTÉE(S) — l'URL saisie pointe hors du
                        domaine de l'article : {qatArticle.ancresHorsDomaine.map(l => l.url).join(', ')}. La règle interdit
                        d'ajouter un lien externe, même par le maillage.
                      </p>
                    )}
                    {qatArticle.ancresAutoLien?.length > 0 && (
                      <p className="text-[11px] text-amber-700">
                        {qatArticle.ancresAutoLien.length} paire(s) écartée(s) : l'URL est celle de cet article — il ne peut
                        pas se lier à lui-même.
                      </p>
                    )}
                    {qatArticle.ancresNonVerifiables?.length > 0 && (
                      <p className="text-[11px] text-amber-700">
                        {qatArticle.ancresNonVerifiables.length} paire(s) écartée(s) : l'URL de l'article n'a pas été fournie
                        (contenu collé), donc une URL absolue n'est ni vérifiable ni plaçable — saisissez un chemin relatif
                        (/ma-page). Ce n'est pas un problème de domaine.
                      </p>
                    )}
                    {qatArticle.restoredInternalLinks?.length > 0 && (
                      <p className="text-[11px] text-emerald-700">
                        {qatArticle.restoredInternalLinks.length} lien(s) interne(s) de l'article d'origine délié(s) par l'IA
                        et RÉ-ENVELOPPÉ(S) automatiquement sur leur ancre.
                      </p>
                    )}
                    {qatArticle.missingInternalLinks?.length > 0 && (
                      <p className="text-[11px] text-amber-700">
                        {qatArticle.missingInternalLinks.length} lien(s) interne(s) de l'article d'origine NON repris —
                        leur ancre a disparu du nouveau texte, ou n'apparaît que dans un emplacement interdit :{' '}
                        {qatArticle.missingInternalLinks.map(l => l.href).join(', ')}. Avertissement, la génération est conservée.
                      </p>
                    )}
                    {qatArticle.notesRedaction && (
                      <p className="text-[11px] text-emerald-600 italic">{qatArticle.notesRedaction}</p>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === TAB_AVANT && (
            <motion.div key="avant"
              initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 10 }}
              className="p-6"
            >
              <div className="bg-gray-50 rounded-xl p-6 min-h-[420px]">
                <div
                  className="md-content"
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(agent.originalContent || '—') }}
                />
              </div>
            </motion.div>
          )}

          {activeTab === TAB_APRES && (
            <motion.div key="apres"
              initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }}
              className="p-5 space-y-3"
            >
              {/* ── Repérage des liens : teinte le BLOC porteur, sans toucher au HTML ── */}
              {hasContent && (
                <>
                  <style>{`
                    .liens-reperes :is(p,li,h2,h3,h4,td,blockquote):has(a[href]) {
                      background: rgba(245,158,11,.13);
                      box-shadow: inset 3px 0 0 rgba(245,158,11,.65);
                      border-radius: 3px;
                    }
                    ${siteHost ? `
                    .liens-reperes :is(p,li,h2,h3,h4,td,blockquote):has(a[href*="${siteHost}"]),
                    .liens-reperes :is(p,li,h2,h3,h4,td,blockquote):has(a[href^="/"]) {
                      background: rgba(16,185,129,.13);
                      box-shadow: inset 3px 0 0 rgba(16,185,129,.65);
                    }
                    /* Un bloc qui porte AUSSI un lien externe repasse en ambre :
                       c'est le point à surveiller, il ne doit pas être masqué par
                       un lien interne présent dans le même paragraphe. */
                    .liens-reperes :is(p,li,h2,h3,h4,td,blockquote):has(a[href^="http"]:not([href*="${siteHost}"])) {
                      background: rgba(245,158,11,.13);
                      box-shadow: inset 3px 0 0 rgba(245,158,11,.65);
                    }` : ''}
                    .liens-reperes a[href] { text-decoration-thickness: 2px; text-underline-offset: 2px; }
                  `}</style>
                  <div className="flex items-center gap-3 bg-white border border-gray-200 rounded-xl px-4 py-2 text-xs flex-wrap">
                    <Link size={14} className="shrink-0 text-gray-400" />
                    <span className="text-[11px] font-medium text-gray-500 shrink-0">Repérer les liens</span>
                    <button
                      type="button"
                      onClick={() => setReperesLiens((v) => !v)}
                      className={`px-2 py-0.5 rounded-md text-[10px] font-semibold transition-colors ${
                        reperesLiens ? 'bg-black text-white' : 'bg-gray-100 text-gray-500 hover:text-gray-800'
                      }`}
                    >
                      {reperesLiens ? 'Affiché' : 'Masqué'}
                    </button>
                    {reperesLiens && (
                      <span className="flex items-center gap-3 text-[10px] text-gray-500 flex-wrap">
                        {siteHost && (
                          <span className="flex items-center gap-1">
                            <span className="inline-block w-3 h-3 rounded" style={{ background: 'rgba(16,185,129,.35)' }} />
                            lien interne
                          </span>
                        )}
                        <span className="flex items-center gap-1">
                          <span className="inline-block w-3 h-3 rounded" style={{ background: 'rgba(245,158,11,.35)' }} />
                          {siteHost ? 'lien externe' : 'lien (domaine du site inconnu)'}
                        </span>
                        <span className="text-gray-400">le bloc porteur est teinté, le lien souligné</span>
                      </span>
                    )}
                  </div>
                </>
              )}

              {/* ── Champ titre — au-dessus de l'image à la une ─────────────── */}
              {(cqItem || agent.currentArticleId) && (
                <div className="flex items-center gap-3 bg-white border border-gray-200 rounded-xl px-4 py-2.5 text-xs">
                  <FileText size={16} className="shrink-0" />
                  <span className="text-[11px] font-medium text-gray-500 shrink-0 whitespace-nowrap">Titre</span>
                  <input
                    type="text"
                    value={editedTitle}
                    onChange={e => { setEditedTitle(e.target.value); setTitleDirty(true); }}
                    placeholder="Titre de l'article..."
                    className="flex-1 bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-black/20 min-w-0"
                  />
                </div>
              )}

              {/* ── Barre image à la une — pleine largeur, tout en haut ──────── */}
              <input ref={fileImgInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileUpload} />
              <AnimatePresence>
                {hasContent && (
                  <motion.div
                    initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
                    className="flex items-center gap-3 bg-white border border-gray-200 rounded-xl px-4 py-2.5 text-xs"
                  >
                    <Image size={16} className="shrink-0" />
                    <span className="text-[11px] font-medium text-gray-500 shrink-0">Image à la une</span>
                    {!showImgReplace ? (
                      <>
                        {featuredImgUrl && (
                          <img
                            src={featuredImgUrl}
                            alt="Aperçu image à la une"
                            className="shrink-0 w-9 h-9 rounded-lg object-cover border border-gray-200 bg-gray-50"
                          />
                        )}
                        <span className="flex-1 text-gray-400 truncate font-mono text-[10px]">
                          {featuredImgUrl || (
                            <em className="not-italic text-gray-300">
                              Aucune image à la une
                              {nbImagesCorps > 0 && (
                                <span className="text-amber-600">
                                  {' '}— l'article en contient {nbImagesCorps} dans son texte, non définie{nbImagesCorps > 1 ? 's' : ''} comme image à la une
                                </span>
                              )}
                            </em>
                          )}
                        </span>
                        <button
                          onClick={() => { setNewImgInput(featuredImgUrl); setShowImgReplace(true); }}
                          disabled={uploadingImg}
                          className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 bg-black/5 hover:bg-black/10 text-gray-700 rounded-lg transition-colors font-medium disabled:opacity-40"
                        >
                          <Link2 size={11} /> Lien
                        </button>
                        {featuredImgUrl && (
                          <button
                            onClick={() => setShowFeaturedImgPanel(true)}
                            disabled={uploadingImg}
                            title="Éditer le texte ALT et la légende de l'image à la une"
                            className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 bg-black/5 hover:bg-black/10 text-gray-700 rounded-lg transition-colors font-medium disabled:opacity-40"
                          >
                            <Image size={11} /> Alt / Légende
                          </button>
                        )}
                        {resolvedSite && (
                          <button
                            onClick={() => fileImgInputRef.current?.click()}
                            disabled={uploadingImg}
                            className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 bg-black text-white rounded-lg hover:bg-gray-800 transition-colors font-medium disabled:opacity-40"
                          >
                            {uploadingImg ? <Loader size={11} className="animate-spin" /> : <Plus size={11} />}
                            {uploadingImg ? 'Upload...' : 'Téléverser'}
                          </button>
                        )}
                      </>
                    ) : (
                      <>
                        <input
                          autoFocus
                          type="url"
                          value={newImgInput}
                          onChange={e => setNewImgInput(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') handleReplaceFeaturedImage(); if (e.key === 'Escape') setShowImgReplace(false); }}
                          placeholder="https://example.com/image.jpg"
                          disabled={uploadingImg}
                          className="flex-1 bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-black/20 min-w-0 disabled:opacity-50"
                        />
                        <button onClick={handleReplaceFeaturedImage} disabled={uploadingImg} className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 bg-black text-white rounded-lg hover:bg-gray-800 transition-colors font-medium disabled:opacity-50">
                          {uploadingImg ? <><Loader size={11} className="animate-spin" /> Upload...</> : 'OK'}
                        </button>
                        <button onClick={() => setShowImgReplace(false)} disabled={uploadingImg} className="shrink-0 p-1.5 text-gray-400 hover:text-gray-700 transition-colors disabled:opacity-30"><X size={13} /></button>
                      </>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>

              {/* ── SEO Meta — Yoast SEO & SEOPress ─────────────────────────────── */}
              <AnimatePresence>
                {hasContent && (
                  <motion.div
                    initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
                    className="flex flex-col gap-2.5 bg-white border border-gray-200 rounded-xl px-4 py-3"
                  >
                    {/* En-tête — CLIQUABLE : le bloc se replie pour dégager la vue
                        diff (demande d'Andrianina, 19/08). Déplié par défaut. */}
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setShowSeoMeta((v) => !v)}
                        className="flex items-center gap-2 group shrink-0"
                        title={showSeoMeta ? 'Replier SEO Meta' : 'Déplier SEO Meta'}
                      >
                        <Search size={16} className="shrink-0" />
                        <span className="text-[11px] font-medium text-gray-500 shrink-0">SEO Meta</span>
                        {showSeoMeta
                          ? <ChevronUp size={13} className="text-gray-400 group-hover:text-gray-700" />
                          : <ChevronDown size={13} className="text-gray-400 group-hover:text-gray-700" />}
                      </button>
                      {seoGenerating && <Loader size={11} className="animate-spin text-gray-400 ml-1" />}
                      {/* Ce badge signifie seulement « metas remplies » — le verdict SEO
                          réel est donné par l'Analyse SEO ci-dessous (critères plugins) */}
                      {!seoGenerating && (seoTitle || seoDescription) && (
                        <span className="text-[10px] font-semibold text-gray-500 bg-gray-50 border border-gray-200 px-1.5 py-0.5 rounded-full flex items-center gap-1">
                          <Sparkles size={9} /> Metas générées
                        </span>
                      )}
                      <button
                        onClick={runSeoGeneration}
                        disabled={seoGenerating}
                        title="Générer les balises SEO avec l'IA"
                        className="ml-auto flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-medium bg-white border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-40"
                      >
                        <Sparkles size={10} /> {seoTitle || seoDescription ? 'Régénérer' : 'Générer'}
                      </button>
                      <span className="text-[10px] text-gray-400">Yoast SEO &amp; SEOPress</span>
                    </div>

                    {showSeoMeta && (<>
                    {/* Meta Title */}
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-medium text-gray-400 w-20 shrink-0">Meta Title</span>
                      <input
                        type="text"
                        value={seoTitle}
                        onChange={e => setSeoTitle(e.target.value.substring(0, 70))}
                        placeholder="Titre SEO optimisé (50-60 caractères)..."
                        className="flex-1 bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-black/20 min-w-0"
                      />
                      <span className={`text-[10px] font-semibold shrink-0 w-10 text-right tabular-nums ${
                        seoTitle.length === 0 ? 'text-gray-300'
                        : seoTitle.length < 40 ? 'text-amber-500'
                        : seoTitle.length <= 60 ? 'text-emerald-600'
                        : 'text-red-500'
                      }`}>{seoTitle.length}/60</span>
                    </div>

                    {/* Meta Description */}
                    <div className="flex items-start gap-2">
                      <span className="text-[10px] font-medium text-gray-400 w-20 shrink-0 pt-2">Meta Desc</span>
                      <textarea
                        value={seoDescription}
                        onChange={e => setSeoDescription(e.target.value.substring(0, 165))}
                        placeholder="Description SEO engageante (140-155 caractères)..."
                        rows={2}
                        className="flex-1 bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-black/20 min-w-0 resize-none"
                      />
                      <span className={`text-[10px] font-semibold shrink-0 w-10 text-right tabular-nums pt-2 ${
                        seoDescription.length === 0 ? 'text-gray-300'
                        : seoDescription.length < 120 ? 'text-amber-500'
                        : seoDescription.length <= 155 ? 'text-emerald-600'
                        : 'text-red-500'
                      }`}>{seoDescription.length}/155</span>
                    </div>

                    {/* Date de publication de la MAJ (optionnelle) */}
                    <div className="flex items-center gap-2 pt-1">
                      <span className="text-[10px] font-medium text-gray-400 w-20 shrink-0">Date MAJ</span>
                      <input
                        type="datetime-local"
                        value={publishDate}
                        onChange={e => setPublishDate(e.target.value)}
                        className="flex-1 bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-black/20 min-w-0"
                      />
                      {publishDate ? (
                        <button
                          type="button"
                          onClick={() => setPublishDate('')}
                          title="Réinitialiser (garder la date WordPress existante)"
                          className="shrink-0 text-[10px] text-gray-400 hover:text-red-500 px-1"
                        >
                          effacer
                        </button>
                      ) : (
                        <span className="text-[10px] text-gray-400 shrink-0 w-28 text-right">date WP inchangée</span>
                      )}
                    </div>
                    </>)}

                    {/* Le champ « Instruction » a été retiré d'ici : la consigne libre
                        se saisit désormais dans le PROMPT de la phase 2, que le rédacteur
                        édite directement. Deux endroits pour la même chose se
                        contredisaient. La valeur (`agent.instruction`) reste en place :
                        elle est encore pré-remplie par les Notes de la file d'attente et
                        injectée dans le prompt. */}

                    {/* ── Analyse SEO réelle — critères Yoast/SEOPress, verdict STRICT ──
                        (remplace le faux signal « Généré » vert : ici chaque critère
                        des plugins WP est vérifié sur le contenu final) */}
                    <div className="border-t border-gray-100 pt-2.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Gauge size={14} className="text-gray-400 shrink-0" />
                        <span className="text-[11px] font-medium text-gray-500 shrink-0">
                          Analyse SEO{resolvedSite?.name ? ` — ${resolvedSite.name}` : ''}
                        </span>
                        {seoReport && (
                          <button
                            type="button"
                            onClick={() => setShowSeoChecks(v => !v)}
                            title="Afficher / masquer le détail des critères"
                            className={`flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border transition-colors ${
                              seoReport.verdict === 'green' ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
                              : seoReport.verdict === 'amber' ? 'text-amber-700 bg-amber-50 border-amber-200'
                              : 'text-red-700 bg-red-50 border-red-200'
                            }`}
                          >
                            {seoReport.verdict === 'green' && <><CheckCircle2 size={10} /> Tous les critères au vert</>}
                            {seoReport.verdict === 'amber' && <><AlertTriangle size={10} /> {seoReport.stats.ambers} critère{seoReport.stats.ambers > 1 ? 's' : ''} à améliorer</>}
                            {seoReport.verdict === 'red' && <><XCircle size={10} /> {seoReport.stats.reds} critère{seoReport.stats.reds > 1 ? 's' : ''} au rouge</>}
                            {showSeoChecks ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                          </button>
                        )}
                        <button
                          onClick={runSeoCheck}
                          title="Vérifier les critères Yoast/SEOPress sur le contenu final (mot-clé, metas, structure, maillage, lisibilité)"
                          className="ml-auto flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-medium bg-white border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
                        >
                          <Gauge size={10} /> {seoReport ? 'Réanalyser' : 'Analyser'}
                        </button>
                      </div>
                      {seoReport && showSeoChecks && (
                        <div className="mt-2 space-y-1.5">
                          {seoReport.checks.map(c => (
                            <div key={c.id} className="flex items-start gap-1.5 text-[11px] leading-snug">
                              {c.status === 'green' && <CheckCircle2 size={12} className="text-emerald-500 shrink-0 mt-0.5" />}
                              {c.status === 'amber' && <AlertTriangle size={12} className="text-amber-500 shrink-0 mt-0.5" />}
                              {c.status === 'red'   && <XCircle size={12} className="text-red-500 shrink-0 mt-0.5" />}
                              {c.status === 'gray'  && <Info size={12} className="text-gray-300 shrink-0 mt-0.5" />}
                              <span className="font-medium text-gray-600 shrink-0">{c.label}</span>
                              <span className="text-gray-400 min-w-0">{c.detail}</span>
                            </div>
                          ))}
                          <p className="text-[10px] text-gray-300 pt-1">
                            Mêmes critères que Yoast SEO / SEOPress ({seoReport.stats.words} mots analysés) — réanalysez après chaque modification importante.
                          </p>
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Barre toggle diff/final + légende + navigation */}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-gray-500 bg-gray-50 rounded-xl px-4 py-2.5">

                {/* Toggle Vue diff / Vue finale */}
                <div className="flex items-center gap-0.5 bg-white border border-gray-200 rounded-lg p-0.5 shadow-sm">
                  <button
                    onClick={() => setDiffMode(true)}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition-all duration-150 ${
                      diffMode ? 'bg-black text-white shadow-sm' : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    Vue diff
                  </button>
                  <button
                    onClick={() => setDiffMode(false)}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition-all duration-150 ${
                      !diffMode ? 'bg-black text-white shadow-sm' : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    Vue finale
                  </button>
                </div>

                {/* Légende (visible uniquement en mode diff) */}
                {diffMode && (
                  <>
                    <div className="flex items-center gap-1.5">
                      <span className="px-1.5 py-0.5 rounded text-[11px] font-medium"
                        style={{ background: '#fee2e2', color: '#9ca3af', textDecoration: 'line-through' }}>
                        supprimé
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="px-1.5 py-0.5 rounded text-[11px] font-medium"
                        style={{ background: '#bbf7d0', color: '#14532d' }}>
                        mis à jour
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="px-1.5 py-0.5 rounded text-[11px] font-medium"
                        style={{ background: '#dbeafe', color: '#1e40af', borderLeft: '2px solid #3b82f6' }}>
                        ajouté
                      </span>
                    </div>
                  </>
                )}

                {/* Annuler / Rétablir (undo/redo du contenu) */}
                {diffMode && (
                  <div className="flex items-center gap-0.5 border-l border-gray-200 pl-2">
                    <button onClick={undo} disabled={!histState.canUndo} title="Annuler (Ctrl+Z)"
                      className="flex items-center justify-center w-6 h-6 rounded-lg hover:bg-black/10 text-gray-500 hover:text-gray-800 disabled:opacity-30 disabled:hover:bg-transparent transition-colors">
                      <Undo2 size={14} />
                    </button>
                    <button onClick={redo} disabled={!histState.canRedo} title="Rétablir (Ctrl+Y)"
                      className="flex items-center justify-center w-6 h-6 rounded-lg hover:bg-black/10 text-gray-500 hover:text-gray-800 disabled:opacity-30 disabled:hover:bg-transparent transition-colors">
                      <Redo2 size={14} />
                    </button>
                  </div>
                )}

                {/* Tout accepter / Tout rejeter (segments en attente) — annulable Ctrl+Z */}
                {diffMode && (
                  <div className="flex items-center gap-1 border-l border-gray-200 pl-2">
                    <button
                      onClick={() => processAllSegments('accept')}
                      title="Accepter TOUTES les modifications en attente (annulable Ctrl+Z)"
                      className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 transition-colors"
                    >
                      <CheckCheck size={12} /> Tout accepter
                    </button>
                    <button
                      onClick={() => processAllSegments('reject')}
                      title="Rejeter TOUTES les modifications en attente — retour au texte original (annulable Ctrl+Z)"
                      className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium text-gray-500 bg-white hover:bg-gray-100 border border-gray-200 transition-colors"
                    >
                      <X size={12} /> Tout rejeter
                    </button>
                  </div>
                )}

                {/* Badge vue finale — avertit si des modifications en attente sont EXCLUES */}
                {!diffMode && (pendingInFinal > 0 ? (
                  <span className="flex items-center gap-1 text-[11px] font-medium text-amber-600">
                    <AlertTriangle size={12} />
                    {pendingInFinal} modification{pendingInFinal > 1 ? 's' : ''} en attente non incluse{pendingInFinal > 1 ? 's' : ''} — acceptez-les en Vue diff avant de copier/publier
                  </span>
                ) : (
                  <span className="text-[11px] text-gray-400 italic">
                    Article final sans marquages — prêt à copier/publier
                  </span>
                ))}

                {/* Navigation entre changements (diff uniquement) */}
                {diffMode && appliedUpdates.length > 0 && (
                  <div className="ml-auto flex items-center gap-2">
                    <span className="text-[11px] text-gray-400">
                      <span className="font-semibold text-gray-600">{appliedUpdates.length}</span>
                      {missedUpdates.length > 0 && (
                        <span className="text-amber-500"> / {updates.length}</span>
                      )}
                      {' '}modif.
                    </span>
                    <div className="flex items-center gap-0.5">
                      <button onClick={() => jumpToChange(-1)} title="Modification précédente"
                        className="flex items-center justify-center w-6 h-6 rounded-lg hover:bg-black/10 text-gray-500 hover:text-gray-800 transition-colors">
                        <ChevronUp size={13} />
                      </button>
                      <button onClick={() => jumpToChange(1)} title="Modification suivante"
                        className="flex items-center justify-center w-6 h-6 rounded-lg hover:bg-black/10 text-gray-500 hover:text-gray-800 transition-colors">
                        <ChevronDown size={13} />
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Article */}
              {hasContent ? (
                <AnimatePresence mode="wait">
                  {diffMode ? (
                    /* ── Vue diff : del barrés + mark surlignés ── */
                    <motion.div key="diff" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>

                      {/* Contenu diff */}
                      <div
                        ref={setArticleRef}
                        className={`article-diff-content md-content text-sm leading-loose p-6 bg-white rounded-xl border border-gray-200 shadow-sm min-h-[300px] focus:outline-none focus:ring-2 focus:ring-black/10${reperesLiens ? ' liens-reperes' : ''}`}
                        onInput={handleInput}
                        onPaste={handlePaste}
                        onDragOver={(e) => {
                          // Autoriser le drop de FICHIERS (images) — le drag interne
                          // de texte/blocs garde le comportement natif du navigateur.
                          if (Array.from(e.dataTransfer?.types || []).includes('Files')) e.preventDefault();
                        }}
                        onDrop={(e) => {
                          const file = Array.from(e.dataTransfer?.files || []).find(f => f.type?.startsWith('image/'));
                          if (!file) return;
                          e.preventDefault();
                          const range = document.caretRangeFromPoint
                            ? document.caretRangeFromPoint(e.clientX, e.clientY)
                            : null;
                          insertImageFileAt(file, range);
                        }}
                        onKeyDown={(e) => {
                          // Undo/redo maison (couvre accepter/rejeter, médias… que l'undo
                          // natif ignore) → on court-circuite l'undo natif du navigateur.
                          const k = e.key.toLowerCase();
                          if ((e.ctrlKey || e.metaKey) && k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
                          else if ((e.ctrlKey || e.metaKey) && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); redo(); }
                        }}
                        onClick={(e) => {
                          // Clic sur un titre H2/H3/H4 → barre « Réécrire cette section »
                          // (n'empêche pas le placement normal du curseur pour éditer le
                          // titre à la main — c'est un complément, pas un remplacement).
                          const heading = e.target.closest('h2, h3, h4');
                          if (heading && articleRef.current?.contains(heading)
                              && !heading.closest('del.deleted-content, mark.updated-content, ins.added-content')) {
                            clearTimeout(leaveTimerRef.current);
                            setSectionHover({ el: heading, rect: heading.getBoundingClientRect() });
                            return;
                          }
                          setSectionHover(null);
                        }}
                        onMouseOver={(e) => {
                          // 1) Lien interne PROPOSÉ (span non encore appliqué) → popup "Appliquer"
                          const il = e.target.closest('[data-il-idx]');
                          if (il) {
                            const idx = parseInt(il.getAttribute('data-il-idx'), 10);
                            if (!appliedLinks.has(idx)) {
                              clearTimeout(leaveTimerRef.current);
                              setLinkHover({ idx, url: il.getAttribute('data-il-url') || '', anchor: il.textContent, rect: il.getBoundingClientRect() });
                              setAnchorHover(null);
                              setFaqHover(null);
                              setTableHover(null);
                              setImgHover(null);
                              return;
                            }
                          }
                          // 2) Segment de diff (del/mark/ins) → mini-boutons ✓/✗ (#3)
                          const seg = e.target.closest('del.deleted-content, mark.updated-content, ins.added-content');
                          if (seg && e.currentTarget.contains(seg)) {
                            clearTimeout(leaveTimerRef.current);
                            // La barre ✓/✗ s'affiche AU-DESSUS du segment ancré : en montant
                            // vers elle, la souris peut traverser un AUTRE segment sur la
                            // ligne du dessus. Ré-ancrer silencieusement ferait porter le
                            // clic Accepter/Rejeter sur le mauvais segment → l'ancre est
                            // gelée tant que la souris reste dans ce couloir.
                            const corridor = segHover && seg !== segHover.node
                              && e.clientY > segHover.rect.top - 44 && e.clientY < segHover.rect.top + 4
                              && e.clientX > segHover.rect.left - 24 && e.clientX < segHover.rect.left + 280;
                            if (!corridor) setSegHover({ node: seg, rect: seg.getBoundingClientRect() });
                            setLinkHover(null); setAnchorHover(null); setFaqHover(null); setTableHover(null); setImgHover(null);
                            return;
                          }
                          // 3) Section FAQ → barres flottantes (bloc entier / Q-R survolée)
                          const fq = detectFaqHover(e.target);
                          if (fq) {
                            clearTimeout(leaveTimerRef.current);
                            setFaqHover(fq);
                            setLinkHover(null);
                            setTableHover(null);
                            setImgHover(null);
                            showAnchorTooltip(e); // les tooltips de liens restent actifs dans la FAQ
                            return;
                          }
                          // 3bis) Tableau → barre « bloc entier » (copier / couper / supprimer)
                          const tbl = e.target.closest('table, [data-tt-table-wrap]');
                          if (tbl && e.currentTarget.contains(tbl)) {
                            const top = tableBlockOf(articleRef.current, tbl) || tbl;
                            clearTimeout(leaveTimerRef.current);
                            setTableHover({ el: top, rect: top.getBoundingClientRect() });
                            setLinkHover(null);
                            setImgHover(null);
                            showAnchorTooltip(e);
                            return;
                          }
                          // 3ter) Image (hors image à la une, gérée par sa propre barre dédiée)
                          // → barre « Alt / Légende »
                          const imgTarget = e.target.tagName === 'IMG' ? e.target : e.target.closest('figure')?.querySelector('img');
                          if (imgTarget && e.currentTarget.contains(imgTarget) && !imgTarget.closest('figure[data-featured]')) {
                            clearTimeout(leaveTimerRef.current);
                            setImgHover({ img: imgTarget, rect: imgTarget.getBoundingClientRect() });
                            setLinkHover(null);
                            setTableHover(null);
                            showAnchorTooltip(e);
                            return;
                          }
                          // 4) Vraie ancre <a href> → tooltip URL complète
                          showAnchorTooltip(e);
                          // Hors lien interne / segment de diff / FAQ : on n'est plus sur l'élément
                          // → planifier le masquage des mini-boutons ✓/✗ (la souris sur le
                          // segment OU sur la barre flottante annule ce timer). Évite qu'ils
                          // restent affichés en glissant la souris sur le texte voisin.
                          if (segHover || linkHover || faqHover || tableHover || imgHover) {
                            clearTimeout(leaveTimerRef.current);
                            leaveTimerRef.current = setTimeout(() => { setSegHover(null); setLinkHover(null); setFaqHover(null); setTableHover(null); setImgHover(null); }, 1200);
                          }
                        }}
                        onMouseLeave={() => {
                          leaveTimerRef.current = setTimeout(() => { setLinkHover(null); setAnchorHover(null); setSegHover(null); setFaqHover(null); }, 1200);
                        }}
                        onBlur={() => {
                          // Fin d'édition (déplacement/collage terminé) → réparer la structure (#2)
                          if (articleRef.current) {
                            repairStructureEl(articleRef.current);
                            contentRef.current = articleRef.current.innerHTML;
                          }
                        }}
                        contentEditable
                        suppressContentEditableWarning
                      />
                    </motion.div>
                  ) : (
                    /* ── Vue finale : article propre, sans marquages ── */
                    <motion.div key="final"
                      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                      className="p-6 bg-white rounded-xl border border-gray-200 shadow-sm min-h-[300px]"
                      onMouseOver={showAnchorTooltip}
                      onMouseLeave={() => { leaveTimerRef.current = setTimeout(() => setAnchorHover(null), 1000); }}
                    >
                      <div
                        className="md-content"
                        dangerouslySetInnerHTML={{ __html: getFinalHtml() }}
                      />
                    </motion.div>
                  )}
                </AnimatePresence>
              ) : (
                <div className="text-center py-12 text-gray-400 text-sm">
                  <RefreshCw size={28} className="mx-auto mb-3 opacity-30" />
                  <p>Aucun contenu à afficher</p>
                </div>
              )}

              {/* ── Suggestions non-localisées — sous l'article ── */}
              {diffMode && missedUpdates.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="rounded-xl border-2 border-indigo-200 bg-indigo-50/60 overflow-hidden shadow-sm ring-1 ring-indigo-100"
                >
                  <button
                    type="button"
                    onClick={() => setShowMissed(v => !v)}
                    className={`w-full flex items-center gap-2.5 px-4 py-3 bg-indigo-100/80 hover:bg-indigo-100 transition-colors ${showMissed ? 'border-b border-indigo-200' : ''}`}
                  >
                    <span className="flex items-center justify-center w-5 h-5 rounded-md bg-indigo-600 text-white flex-shrink-0">
                      <Plus size={12} />
                    </span>
                    <p className="text-xs font-semibold text-indigo-800 flex-1 text-left">
                      {missedUpdates.length} suggestion{missedUpdates.length > 1 ? 's' : ''} à ajouter en 1 clic
                      <span className="font-normal text-indigo-500 ml-1">— l'agent l'insère au bon endroit dans l'article</span>
                    </p>
                    {showMissed ? <ChevronUp size={15} className="text-indigo-600 flex-shrink-0" /> : <ChevronDown size={15} className="text-indigo-600 flex-shrink-0" />}
                  </button>
                  {showMissed && (
                  <div className="divide-y divide-indigo-100">
                    {missedUpdates.map((u, i) => (
                      <div key={i} className="px-4 py-3 flex items-start gap-3">
                        <span className="flex-shrink-0 w-5 h-5 rounded-md bg-indigo-200 text-indigo-800 flex items-center justify-center text-[10px] font-bold mt-0.5">
                          {i + 1}
                        </span>
                        <div className="flex-1 min-w-0 space-y-1">
                          <p className="text-[11px] text-gray-400 line-through leading-relaxed break-words">{u.original}</p>
                          <div className="flex items-start gap-1.5">
                            <ArrowRight size={11} className="text-green-500 flex-shrink-0 mt-0.5" />
                            {/* Aperçu RENDU (HTML interprété) — pas de balises brutes. À l'insertion,
                                applyMissed applique le HTML tel quel dans l'article. */}
                            <div
                              className="md-content flex-1 min-w-0 text-[12px] text-gray-800 leading-relaxed break-words [&_h1]:!text-sm [&_h2]:!text-sm [&_h3]:!text-[13px] [&_h1]:!my-1 [&_h2]:!my-1 [&_h3]:!my-1 [&_h4]:!text-[12px] [&_p]:!text-[12px] [&_p]:!my-0.5 [&_ul]:!my-1 [&_ol]:!my-1 [&_li]:!text-[12px] [&_a]:text-indigo-600 [&_a]:break-all [&_table]:!text-[11px] [&_strong]:text-gray-900"
                              dangerouslySetInnerHTML={{ __html: renderMarkdown(u.updated || '') }}
                            />
                          </div>
                          {u.reason && (
                            <p className="text-[10px] text-gray-400 italic">{u.reason}</p>
                          )}
                        </div>
                        <div className="flex-shrink-0 flex flex-col items-stretch gap-1">
                          <button
                            onClick={() => applyMissed(u, i)}
                            title="Insérer automatiquement au bon endroit (par ancre)"
                            className={`flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-colors ${
                              addedIdx === i
                                ? 'bg-green-100 text-green-700 border border-green-200'
                                : 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm'
                            }`}
                          >
                            {addedIdx === i
                              ? <><CheckCircle2 size={12} /> Ajouté</>
                              : <><Plus size={12} /> Ajouter</>
                            }
                          </button>
                          {/* Placement manuel avant/après un élément — pour les additions (nouveaux blocs) */}
                          {u.type === 'addition' && addedIdx !== i && (
                            <button
                              onClick={() => placeAddition(u, i)}
                              title="Choisir où l'insérer : clic droit dans l'article, ou panneau Structure (coller avant/après)"
                              className="flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border border-indigo-200 text-indigo-700 hover:bg-indigo-50 transition-colors whitespace-nowrap"
                            >
                              <ArrowRight size={11} /> Placer…
                            </button>
                          )}
                          {/* Voir OÙ la suggestion va s'insérer (scroll + surbrillance du repère) */}
                          {addedIdx !== i && (
                            <button
                              onClick={() => locateSuggestion(u)}
                              title="Voir où la suggestion s'insérera dans l'article"
                              className="flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium text-gray-500 hover:text-indigo-700 hover:bg-indigo-50 border border-transparent hover:border-indigo-200 transition-colors whitespace-nowrap"
                            >
                              <Crosshair size={11} /> Localiser
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                  )}
                </motion.div>
              )}

              <p className="text-xs text-gray-400 text-right">
                {diffMode
                  ? 'Sélectionnez du texte pour faire apparaître la barre de mise en forme · ↑↓ pour naviguer'
                  : 'Basculez en "Vue diff" pour modifier le contenu'}
              </p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Barre flottante de mise en forme — portail vers document.body pour éviter
            les interférences avec les transforms CSS de Framer Motion */}
        {diffMode && (
          <BubbleToolbar
            articleEl={articleEl}
            contentRef={contentRef}
            siteFonts={resolvedSiteFonts}
            clipboard={blockClipboard ? { art: blockClipboard.art, name: blockClipboard.name, mode: blockClipboard.mode } : null}
            onPasteBlock={pasteBlockAtRange}
            onCopyBlock={blockClipFromRange}
            onRewrite={openRewritePanel}
            onUploadMedia={resolvedSite ? uploadMediaToWp : undefined}
            onImageInserted={settings.anthropicKey ? (url) => {
              generateAltText(url, settings.anthropicKey).then(altText => {
                if (!altText || !articleRef.current) return;
                const imgs = articleRef.current.querySelectorAll(`img[src="${CSS.escape(url)}"]`);
                if (imgs.length) {
                  imgs[imgs.length - 1].alt = altText;
                  contentRef.current = articleRef.current.innerHTML;
                  toast.success('Texte ALT généré automatiquement', { duration: 2500 });
                }
              }).catch(() => {});
            } : undefined}
          />
        )}
        {/* Panneau de réécriture (sélection → clic droit → Réécrire) */}
        {rewriteCtx && (
          <RewritePanel
            originalText={rewriteCtx.originalText}
            onValidate={applyRewrite}
            onClose={() => { setRewriteCtx(null); rewriteRangeRef.current = null; }}
          />
        )}
        {/* Panneau Alt/Légende d'une image du corps (survol → « Alt / Légende ») */}
        {imgPanelCtx && (
          <ImageAltCaptionPanel
            imageUrl={imgPanelCtx.img.getAttribute('src') || ''}
            initialAlt={imgPanelCtx.img.getAttribute('alt') || ''}
            initialCaption={imgPanelCtx.img.parentElement?.tagName === 'FIGURE' ? (imgPanelCtx.img.parentElement.querySelector(':scope > figcaption')?.textContent || '') : ''}
            apiKey={settings.anthropicKey}
            onValidate={({ alt, caption }) => { applyImageMeta(imgPanelCtx.img, { alt, caption }); setImgPanelCtx(null); setImgHover(null); }}
            onClose={() => setImgPanelCtx(null)}
          />
        )}
        {/* Panneau Alt/Légende de l'image à la une (bouton dédié de la barre) */}
        {showFeaturedImgPanel && (
          <ImageAltCaptionPanel
            imageUrl={featuredImgUrl}
            initialAlt={articleRef.current?.querySelector('figure[data-featured] img')?.getAttribute('alt') || featuredImgMeta.alt}
            initialCaption={featuredImgMeta.caption}
            apiKey={settings.anthropicKey}
            captionIsVisible={false}
            onValidate={(meta) => { applyFeaturedImgMeta(meta); setShowFeaturedImgPanel(false); }}
            onClose={() => setShowFeaturedImgPanel(false)}
          />
        )}
        {/* Panneau de réécriture de section (clic sur un titre H2/H3/H4) */}
        {sectionRewriteCtx && (
          <SectionRewritePanel
            originalHtml={sectionRewriteCtx.originalHtml}
            onValidate={applySectionRewrite}
            onClose={() => { setSectionRewriteCtx(null); sectionRangeRef.current = null; }}
          />
        )}
        {/* Barre contextuelle d'édition de tableaux (vue diff) */}
        {diffMode && <TableToolbar articleEl={articleEl} contentRef={contentRef} />}
        {/* Navigateur de structure du document (façon Gutenberg) — vue diff */}
        {diffMode && (
          <DocNavigator
            articleEl={articleEl}
            onEdited={afterDomEdit}
            clipboard={blockClipboard ? { name: blockClipboard.name, art: blockClipboard.art } : null}
            onCopyBlock={(el) => blockClipFromEl(el, false)}
            onCutBlock={(el) => blockClipFromEl(el, true)}
            onCopySection={(els, cut) => sectionClip(els, cut)}
            onPasteRelative={pasteBlockRelative}
          />
        )}
      </div>

      {/* ── Détail des modifications ── */}
      {updates.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
          className="glass-card p-5 space-y-3"
        >
          <div
            className="flex items-center justify-between flex-wrap gap-2 cursor-pointer"
            onClick={() => setShowDetails(v => !v)}
          >
            <h3 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
              <RefreshCw size={14} className="text-sage-500" />
              Détail des modifications ({updates.length})
              {showDetails ? <ChevronUp size={14} className="text-gray-400" /> : <ChevronDown size={14} className="text-gray-400" />}
            </h3>
            <div className="flex items-center gap-3 text-[11px]">
              {appliedUpdates.length > 0 && (
                <span className="flex items-center gap-1 bg-green-50 text-green-700 border border-green-100 rounded-full px-2.5 py-1 font-medium">
                  <CheckCircle2 size={11} />
                  {appliedUpdates.length} appliquée{appliedUpdates.length > 1 ? 's' : ''}
                </span>
              )}
              {missedUpdates.length > 0 && (
                <span className="flex items-center gap-1 bg-amber-50 text-amber-600 border border-amber-100 rounded-full px-2.5 py-1 font-medium">
                  <AlertTriangle size={11} />
                  {missedUpdates.length} non localisée{missedUpdates.length > 1 ? 's' : ''}
                </span>
              )}
            </div>
          </div>
          {showDetails && (<>
          <div className="space-y-2">
            {updates.map((u, i) => {
              const isApplied = u.applied !== false;
              const isPass2 = u.pass === 2;
              const isAddition = u.type === 'addition';
              const isSuppression = u.type === 'suppression';
              const isIncoherent = u.coherent === false;
              return (
                <div key={i} className={`rounded-xl p-4 border transition-colors ${
                  isApplied
                    ? isAddition ? 'bg-blue-50/40 border-blue-100'
                    : isPass2 ? 'bg-purple-50/40 border-purple-100' : 'bg-green-50/40 border-green-100'
                    : 'bg-amber-50/30 border-amber-100'
                }`}>
                  <div className="flex items-start gap-3 text-sm">
                    {/* Numéro + statut */}
                    <div className="flex flex-col items-center gap-1 flex-shrink-0">
                      <span className={`w-5 h-5 rounded-md flex items-center justify-center text-[10px] font-bold ${
                        isApplied
                          ? isAddition ? 'bg-blue-500 text-white'
                          : isPass2 ? 'bg-purple-600 text-white' : 'bg-black text-white'
                          : 'bg-amber-200 text-amber-800'
                      }`}>
                        {i + 1}
                      </span>
                      {isApplied
                        ? <CheckCircle2 size={11} className={isAddition ? 'text-blue-500' : isPass2 ? 'text-purple-500' : 'text-green-500'} />
                        : <AlertTriangle size={11} className="text-amber-500" />
                      }
                    </div>
                    <div className="flex-1 space-y-1.5 min-w-0">
                      {/* Badges statut + passe */}
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        {isApplied ? (
                          <span className={`text-[10px] font-semibold rounded-full px-2 py-0.5 ${
                            isAddition ? 'text-blue-700 bg-blue-100'
                            : isPass2 ? 'text-purple-700 bg-purple-100' : 'text-green-600 bg-green-100'
                          }`}>
                            <CheckCircle2 size={13} className="inline text-emerald-600 shrink-0" /> {isAddition ? 'Paragraphe ajouté' : isSuppression ? 'Contenu supprimé' : 'Appliquée dans l\'article'}
                          </span>
                        ) : (
                          <span className="text-[10px] font-semibold text-amber-600 bg-amber-100 rounded-full px-2 py-0.5">
                            <AlertTriangle size={13} className="inline text-amber-500 shrink-0" /> Non localisée dans le texte
                          </span>
                        )}
                        {isAddition && (
                          <span className="text-[10px] font-semibold text-blue-600 bg-blue-50 border border-blue-200 rounded-full px-2 py-0.5">
                            + Nouveau
                          </span>
                        )}
                        {isIncoherent && (
                          <span className="text-[10px] font-semibold text-orange-600 bg-orange-50 border border-orange-200 rounded-full px-2 py-0.5 flex items-center gap-0.5">
                            <AlertTriangle size={9} /> À vérifier
                          </span>
                        )}
                        {isPass2 && (
                          <span className="text-[10px] font-semibold text-purple-600 bg-purple-50 border border-purple-200 rounded-full px-2 py-0.5 flex items-center gap-0.5">
                            <Sparkles size={9} /> Passe 2
                          </span>
                        )}
                      </div>
                      {isAddition ? (
                        <p className="text-[11px] text-gray-400 italic">Inséré après : « {u.anchor?.substring(0, 80)}{(u.anchor?.length ?? 0) > 80 ? '…' : ''} »</p>
                      ) : (
                        <p className="text-gray-400 line-through text-xs leading-relaxed break-words">{u.original}</p>
                      )}
                      {!isSuppression && (
                        <div className="flex items-start gap-1.5">
                          <ArrowRight size={12} className={`flex-shrink-0 mt-0.5 ${isAddition ? 'text-blue-400' : 'text-sage-500'}`} />
                          <p className="text-xs leading-relaxed font-medium break-words"
                            style={{ color: isAddition ? '#1d4ed8' : '#2d6a2d' }}
                            dangerouslySetInnerHTML={{ __html: u.updated }}
                          />
                        </div>
                      )}
                      {u.reason && <p className="text-[11px] text-gray-400 italic pt-0.5">{u.reason}</p>}
                      {isIncoherent && u.coherenceIssue && (
                        <p className="text-[11px] text-orange-600 font-medium flex items-center gap-1 pt-0.5">
                          <AlertTriangle size={10} className="flex-shrink-0" />{u.coherenceIssue}
                        </p>
                      )}
                      {u.source && (
                        <p className="text-[11px] text-gray-400 flex items-center gap-1 pt-0.5">
                          <Link size={10} className="flex-shrink-0" />{u.source}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Note pour les non localisées */}
          {missedUpdates.length > 0 && (
            <div className="flex items-center gap-2 bg-amber-50 border border-amber-100 rounded-xl px-4 py-2.5 text-xs text-amber-600">
              <AlertTriangle size={12} className="flex-shrink-0" />
              <p>Les suggestions <AlertTriangle size={12} className="inline text-amber-500" /> sont visibles dans l'onglet <strong>Après</strong> avec un bouton "Copier" pour les appliquer directement dans l'éditeur.</p>
            </div>
          )}
          </>
          )}
        </motion.div>
      )}

      {/* ── Modal : Ajouter des sources CQ ── */}
      <AnimatePresence>
        {showSourcesModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
            onClick={(e) => { if (e.target === e.currentTarget) { setShowSourcesModal(false); setSourceUrls(['']); } }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6 space-y-5"
              onClick={(e) => e.stopPropagation()}
            >
              {/* En-tête */}
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-blue-600 rounded-xl flex items-center justify-center flex-shrink-0">
                  <Link2 size={15} className="text-white" />
                </div>
                <div>
                  <h2 className="text-base font-semibold text-gray-900">Ajouter des sources</h2>
                  <p className="text-xs text-gray-500">TONTON AI va lire ces pages et les intégrer en priorité dans la Passe 2</p>
                </div>
                <button
                  onClick={() => { setShowSourcesModal(false); setSourceUrls(['']); }}
                  className="ml-auto text-gray-400 hover:text-gray-600 transition-colors"
                >
                  <X size={18} />
                </button>
              </div>

              {/* Champs URL */}
              <div className="space-y-2">
                {sourceUrls.map((url, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <div className="flex-1 flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 focus-within:border-blue-400 focus-within:ring-1 focus-within:ring-blue-200 transition-all">
                      <Link2 size={13} className="text-gray-400 flex-shrink-0" />
                      <input
                        type="url"
                        value={url}
                        onChange={(e) => {
                          const next = [...sourceUrls];
                          next[i] = e.target.value;
                          setSourceUrls(next);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && i === sourceUrls.length - 1) {
                            setSourceUrls([...sourceUrls, '']);
                          }
                        }}
                        placeholder="https://exemple.com/article-de-reference"
                        className="flex-1 bg-transparent text-sm text-gray-700 outline-none placeholder-gray-400"
                      />
                    </div>
                    {sourceUrls.length > 1 && (
                      <button
                        onClick={() => setSourceUrls(sourceUrls.filter((_, j) => j !== i))}
                        className="text-gray-400 hover:text-red-500 transition-colors flex-shrink-0"
                      >
                        <X size={15} />
                      </button>
                    )}
                  </div>
                ))}
              </div>

              {/* Bouton ajouter une ligne */}
              <button
                onClick={() => setSourceUrls([...sourceUrls, ''])}
                className="flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-700 font-medium transition-colors"
              >
                <Plus size={12} />
                Ajouter une source
              </button>

              {/* Actions */}
              <div className="flex gap-3 pt-2 border-t border-gray-100">
                <button
                  onClick={() => { setShowSourcesModal(false); setSourceUrls(['']); }}
                  className="flex-1 text-sm text-gray-600 hover:text-gray-800 font-medium py-2 rounded-xl border border-gray-200 hover:bg-gray-50 transition-colors"
                >
                  Annuler
                </button>
                <motion.button
                  onClick={handleValidateSources}
                  disabled={!sourceUrls.some(u => u.trim())}
                  whileHover={{ scale: 1.01 }}
                  whileTap={{ scale: 0.99 }}
                  className="flex-1 flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium py-2 rounded-xl transition-colors"
                >
                  <Sparkles size={13} />
                  Lancer Passe 2 avec sources
                </motion.button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Récap liens internes (mini-badge) ─────────────────────────────── */}
      {internalLinks.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gray-50 border border-gray-200"
        >
          <Link2 size={13} className="text-sage-500 flex-shrink-0" />
          <span className="text-[12px] text-gray-600">
            <span className="font-semibold text-gray-800">{appliedLinks.size}</span>
            /{internalLinks.length} lien{internalLinks.length > 1 ? 's' : ''} interne{internalLinks.length > 1 ? 's' : ''} appliqué{appliedLinks.size > 1 ? 's' : ''}
          </span>
          {appliedLinks.size < internalLinks.length && (
            <span className="text-[11px] text-gray-400 ml-1">— survolez les passages surlignés dans l'article</span>
          )}
          {appliedLinks.size === internalLinks.length && internalLinks.length > 0 && (
            <span className="text-[11px] text-emerald-600 ml-1 font-medium"><CheckCircle2 size={13} className="inline text-emerald-600 shrink-0" /> Tous appliqués</span>
          )}
        </motion.div>
      )}

      {/* ── Explication quand AUCUN lien interne n'est proposé ────────────────── */}
      {internalLinks.length === 0 && agent.internalLinksInfo?.reason && hasContent && diffMode && (
        <motion.div
          initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}
          className="flex items-start gap-2 px-4 py-2.5 rounded-xl bg-gray-50 border border-gray-200"
        >
          <Info size={13} className="text-gray-400 flex-shrink-0 mt-0.5" />
          <span className="text-[12px] text-gray-500">
            <span className="font-semibold text-gray-700">Aucun lien interne proposé</span> — {agent.internalLinksInfo.reason}
          </span>
        </motion.div>
      )}

      {/* ── Bouton flottant "Appliquer" au survol d'un surlignage ─────────── */}
      {/* #3 Mini-boutons ✓/✗ au survol d'un segment de diff (accepter / rejeter) */}
      {segHover && createPortal(
        <div
          style={{
            position: 'fixed',
            top:  Math.max(6, segHover.rect.top - 34),
            left: segHover.rect.left,
            zIndex: 401,
          }}
          onMouseEnter={() => clearTimeout(leaveTimerRef.current)}
          onMouseLeave={() => { leaveTimerRef.current = setTimeout(() => setSegHover(null), 220); }}
          className="flex items-center gap-1 bg-gray-900 rounded-lg px-1.5 py-1 shadow-[0_6px_24px_rgba(0,0,0,0.4)]"
        >
          <button
            type="button"
            title="Accepter la modification"
            onMouseDown={(e) => { e.preventDefault(); acceptSegment(segHover.node); }}
            className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold text-green-300 hover:bg-green-500/20 hover:text-green-200 transition-colors"
          >
            <CheckCircle2 size={13} /> Accepter
          </button>
          <div className="w-px h-4 bg-white/15" />
          <button
            type="button"
            title="Rejeter (revenir à l'original)"
            onMouseDown={(e) => { e.preventDefault(); rejectSegment(segHover.node); }}
            className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold text-red-300 hover:bg-red-500/20 hover:text-red-200 transition-colors"
          >
            <X size={13} /> Rejeter
          </button>
        </div>,
        document.body,
      )}

      {/* ── Snackbar « Coller … ici » après un couper/copier d'un bloc ─────────────
          En position FIXE bas-centre de l'écran (portal) : toujours visible quel
          que soit le scroll — un sticky dans le flux restait hors écran quand on
          était scrollé au niveau du bloc. */}
      {blockClipboard && diffMode && hasContent && createPortal(
        <div
          style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 402 }}
          className="flex items-center gap-2.5 rounded-2xl border-2 border-indigo-300 bg-white px-4 py-2.5 shadow-[0_10px_40px_rgba(0,0,0,0.25)] max-w-[92vw]"
        >
          <Info size={16} className="text-indigo-600 shrink-0" />
          <p className="text-xs text-indigo-900 flex-1 min-w-0">
            <span className="font-semibold">
              {blockClipboard.name} {accord(blockClipboard, blockClipboard.mode === 'couper' ? 'coupé' : 'copié')}.
            </span>
            {' '}<span className="font-semibold">Clic droit</span> à l'endroit voulu → « Coller {blockClipboard.art} » — aussi via le panneau <span className="font-semibold">Structure</span> (clic droit sur un bloc : coller avant/après) — ou posez le curseur et utilisez ce bouton :
          </p>
          <button
            type="button"
            onMouseDown={(e) => { e.preventDefault(); blockPaste(); }}
            className="shrink-0 px-3.5 py-2 rounded-xl bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 transition-colors shadow-sm"
          >
            Coller ici
          </button>
          <button
            type="button"
            onClick={() => setBlockClipboard(null)}
            title="Fermer (un couper reste annulable avec Ctrl+Z)"
            className="shrink-0 p-1.5 rounded-lg hover:bg-indigo-50 text-indigo-400 hover:text-indigo-600 transition-colors"
          >
            <X size={15} />
          </button>
        </div>,
        document.body,
      )}

      {/* ── Écran de verrouillage : un AUTRE membre édite cet article ──────────────
          (façon WordPress) — bloque tout l'écran ; « Prendre la main » force le
          verrou pour soi, l'autre membre voit cet écran à son tour en temps réel. */}
      {editLockedBy && hasContent && createPortal(
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 600 }}
          className="bg-gray-900/50 backdrop-blur-[3px] flex items-center justify-center p-6"
        >
          <div className="bg-white rounded-2xl shadow-[0_24px_80px_rgba(0,0,0,0.35)] max-w-md w-full p-7 text-center">
            <div className="mx-auto w-12 h-12 rounded-2xl bg-amber-50 border border-amber-200 flex items-center justify-center mb-4">
              <Lock size={22} className="text-amber-500" />
            </div>
            <h3 className="text-base font-bold text-gray-900">Article en cours de modification</h3>
            <p className="text-sm text-gray-500 mt-2 leading-relaxed">
              <span className="font-semibold text-gray-800">{editLockedBy.name || 'Un autre membre'}</span>{' '}
              travaille actuellement sur cet article. L'accès est verrouillé pour éviter
              d'écraser ses modifications.
            </p>
            <div className="flex items-center justify-center gap-3 mt-6">
              <button
                type="button"
                onClick={() => navigate('/historique')}
                className="px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600 hover:bg-gray-50 transition-colors"
              >
                Retour à l'historique
              </button>
              <button
                type="button"
                onClick={() => takeOverRef.current?.()}
                className="px-4 py-2.5 rounded-xl bg-amber-500 text-white text-sm font-semibold hover:bg-amber-600 transition-colors shadow-sm"
                title="Récupérer le verrou d'édition sur cet article"
              >
                Prendre la main
              </button>
            </div>
            <p className="text-[11px] text-gray-400 mt-4">
              « Prendre la main » verrouille l'article pour vous — {editLockedBy.name || 'l\'autre membre'} verra cet écran à son tour.
            </p>
          </div>
        </div>,
        document.body,
      )}

      {/* ── Barres flottantes FAQ : bloc entier (survol du titre) ou Q/R survolée ── */}
      {faqHover && createPortal(
        (() => {
          const zone = faqHover.qa?.rect || faqHover.rect;
          return (
            <>
              {/* Cadre indicatif de la zone ciblée (aucune classe injectée dans le contenu) */}
              <div
                style={{
                  position: 'fixed',
                  top: zone.top - 4,
                  left: zone.left - 6,
                  width: zone.width + 12,
                  height: zone.height + 8,
                  border: '2px dashed rgba(99,102,241,0.45)',
                  borderRadius: 8,
                  zIndex: 399,
                  pointerEvents: 'none',
                }}
              />
              <div
                style={{
                  position: 'fixed',
                  top: Math.max(6, zone.top - 34),
                  left: zone.left,
                  zIndex: 401,
                }}
                onMouseEnter={() => clearTimeout(leaveTimerRef.current)}
                onMouseLeave={() => { leaveTimerRef.current = setTimeout(() => setFaqHover(null), 220); }}
                className="flex items-center gap-1 bg-gray-900 rounded-lg px-1.5 py-1 shadow-[0_6px_24px_rgba(0,0,0,0.4)]"
              >
                {faqHover.qa ? (
                  <>
                    <span className="px-1.5 text-[10px] font-bold uppercase tracking-wide text-indigo-300 select-none">
                      Question {faqHover.qa.index + 1}/{faqHover.qa.count}
                    </span>
                    <button
                      type="button"
                      title="Monter la question"
                      disabled={faqHover.qa.index === 0}
                      onMouseDown={(e) => { e.preventDefault(); faqQAAction('up', faqHover.qa.index); }}
                      className="flex items-center px-1.5 py-1 rounded-md text-white/90 hover:bg-white/15 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      <ChevronUp size={14} />
                    </button>
                    <button
                      type="button"
                      title="Descendre la question"
                      disabled={faqHover.qa.index >= faqHover.qa.count - 1}
                      onMouseDown={(e) => { e.preventDefault(); faqQAAction('down', faqHover.qa.index); }}
                      className="flex items-center px-1.5 py-1 rounded-md text-white/90 hover:bg-white/15 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      <ChevronDown size={14} />
                    </button>
                    <button
                      type="button"
                      title="Ajouter une question/réponse après celle-ci"
                      onMouseDown={(e) => { e.preventDefault(); faqQAAction('add', faqHover.qa.index); }}
                      className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold text-green-300 hover:bg-green-500/20 hover:text-green-200 transition-colors"
                    >
                      <Plus size={13} /> Ajouter
                    </button>
                    <div className="w-px h-4 bg-white/15" />
                    <button
                      type="button"
                      title="Supprimer cette question et sa réponse"
                      onMouseDown={(e) => { e.preventDefault(); faqQAAction('delete', faqHover.qa.index); }}
                      className="flex items-center px-1.5 py-1 rounded-md text-red-300 hover:bg-red-500/20 hover:text-red-200 transition-colors"
                    >
                      <Trash2 size={13} />
                    </button>
                  </>
                ) : (
                  <>
                    <span className="px-1.5 text-[10px] font-bold uppercase tracking-wide text-indigo-300 select-none">FAQ</span>
                    <button
                      type="button"
                      title="Monter la FAQ d'une section"
                      onMouseDown={(e) => { e.preventDefault(); faqMoveBlock(-1); }}
                      className="flex items-center px-1.5 py-1 rounded-md text-white/90 hover:bg-white/15 transition-colors"
                    >
                      <ChevronUp size={14} />
                    </button>
                    <button
                      type="button"
                      title="Descendre la FAQ d'une section"
                      onMouseDown={(e) => { e.preventDefault(); faqMoveBlock(1); }}
                      className="flex items-center px-1.5 py-1 rounded-md text-white/90 hover:bg-white/15 transition-colors"
                    >
                      <ChevronDown size={14} />
                    </button>
                    <div className="w-px h-4 bg-white/15" />
                    <button
                      type="button"
                      title="Copier toute la FAQ (coller ensuite à l'endroit voulu)"
                      onMouseDown={(e) => { e.preventDefault(); faqCopyOrCut(false); }}
                      className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold text-white/90 hover:bg-white/15 transition-colors"
                    >
                      <Copy size={13} /> Copier
                    </button>
                    <button
                      type="button"
                      title="Couper toute la FAQ (coller ensuite à l'endroit voulu)"
                      onMouseDown={(e) => { e.preventDefault(); faqCopyOrCut(true); }}
                      className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold text-amber-300 hover:bg-amber-500/20 hover:text-amber-200 transition-colors"
                    >
                      <Scissors size={13} /> Couper
                    </button>
                    <div className="w-px h-4 bg-white/15" />
                    <button
                      type="button"
                      title="Supprimer toute la FAQ"
                      onMouseDown={(e) => { e.preventDefault(); faqDeleteBlock(); }}
                      className="flex items-center px-1.5 py-1 rounded-md text-red-300 hover:bg-red-500/20 hover:text-red-200 transition-colors"
                    >
                      <Trash2 size={13} />
                    </button>
                  </>
                )}
              </div>
            </>
          );
        })(),
        document.body,
      )}

      {/* ── Barre flottante TABLEAU : sélection du tableau ENTIER au survol ──────
          Même expérience que la FAQ : cadre pointillé + barre au-dessus —
          copier / couper (presse-papiers de blocs) / supprimer. */}
      {tableHover && createPortal(
        <>
          <div
            style={{
              position: 'fixed',
              top: tableHover.rect.top - 4,
              left: tableHover.rect.left - 6,
              width: tableHover.rect.width + 12,
              height: tableHover.rect.height + 8,
              border: '2px dashed rgba(16,185,129,0.5)',
              borderRadius: 8,
              zIndex: 399,
              pointerEvents: 'none',
            }}
          />
          <div
            style={{ position: 'fixed', top: Math.max(6, tableHover.rect.top - 34), left: tableHover.rect.left, zIndex: 401 }}
            onMouseEnter={() => clearTimeout(leaveTimerRef.current)}
            onMouseLeave={() => { leaveTimerRef.current = setTimeout(() => setTableHover(null), 220); }}
            className="flex items-center gap-1 bg-gray-900 rounded-lg px-1.5 py-1 shadow-[0_6px_24px_rgba(0,0,0,0.4)]"
          >
            <span className="px-1.5 text-[10px] font-bold uppercase tracking-wide text-emerald-300 select-none">Tableau</span>
            <button
              type="button"
              title="Copier le tableau entier (coller ensuite au clic droit à l'endroit voulu)"
              onMouseDown={(e) => { e.preventDefault(); blockClipFromEl(tableHover.el, false); }}
              className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold text-white/90 hover:bg-white/15 transition-colors"
            >
              <Copy size={13} /> Copier
            </button>
            <button
              type="button"
              title="Couper le tableau entier (coller ensuite au clic droit à l'endroit voulu)"
              onMouseDown={(e) => { e.preventDefault(); blockClipFromEl(tableHover.el, true); }}
              className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold text-amber-300 hover:bg-amber-500/20 hover:text-amber-200 transition-colors"
            >
              <Scissors size={13} /> Couper
            </button>
            <div className="w-px h-4 bg-white/15" />
            <button
              type="button"
              title="Supprimer le tableau (annulable avec Ctrl+Z)"
              onMouseDown={(e) => {
                e.preventDefault();
                const el = tableHover.el;
                // Garde-fou : la cible doit VRAIMENT être le tableau (ou son unique
                // wrapper). L'ancienne condition « enfant direct de l'éditeur »
                // rejetait un tableau imbriqué tout en acceptant le <div> qui
                // enveloppait l'article entier → la corbeille effaçait 3 534 mots
                // sur 3 535. On vérifie donc le contenu de la cible, pas sa place.
                const cibleSaine = !!el && el !== articleRef.current
                  && !!articleRef.current?.contains(el)
                  && el.querySelectorAll('table').length <= 1
                  && !el.querySelector('h1, h2, h3, h4, h5, h6');
                if (!cibleSaine) { setTableHover(null); return; }
                if (!window.confirm('Supprimer ce tableau ? (annulable avec Ctrl+Z)')) return;
                el.remove();
                afterFaqEdit();
                toast('Tableau supprimé — Ctrl+Z pour annuler', { icon: '🗑️' });
              }}
              className="flex items-center px-1.5 py-1 rounded-md text-red-300 hover:bg-red-500/20 hover:text-red-200 transition-colors"
            >
              <Trash2 size={13} />
            </button>
          </div>
        </>,
        document.body,
      )}

      {imgHover && createPortal(
        <div
          style={{ position: 'fixed', top: Math.max(6, imgHover.rect.top - 34), left: imgHover.rect.left, zIndex: 401 }}
          onMouseEnter={() => clearTimeout(leaveTimerRef.current)}
          onMouseLeave={() => { leaveTimerRef.current = setTimeout(() => setImgHover(null), 220); }}
          className="flex items-center gap-1 bg-gray-900 rounded-lg px-1.5 py-1 shadow-[0_6px_24px_rgba(0,0,0,0.4)]"
        >
          <span className="px-1.5 text-[10px] font-bold uppercase tracking-wide text-violet-300 select-none">Image</span>
          <button
            type="button"
            title="Éditer le texte ALT et la légende de cette image"
            onMouseDown={(e) => { e.preventDefault(); setImgPanelCtx({ img: imgHover.img }); }}
            className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold text-white/90 hover:bg-white/15 transition-colors"
          >
            <Image size={13} /> Alt / Légende
          </button>
        </div>,
        document.body,
      )}

      {sectionHover && createPortal(
        <div
          style={{ position: 'fixed', top: Math.max(6, sectionHover.rect.top - 34), left: sectionHover.rect.left, zIndex: 401 }}
          className="flex items-center gap-1 bg-gray-900 rounded-lg px-1.5 py-1 shadow-[0_6px_24px_rgba(0,0,0,0.4)]"
        >
          <span className="px-1.5 text-[10px] font-bold uppercase tracking-wide text-amber-300 select-none">{sectionHover.el.tagName}</span>
          <button
            type="button"
            title="Réécrire ce titre et tout son contenu (IA)"
            onClick={(e) => {
              // stopPropagation : le clic (portail React, bulle via l'arbre React)
              // remonterait sinon jusqu'à l'onClick du contentEditable et fermerait
              // sectionHover juste après son ouverture.
              e.stopPropagation();
              e.preventDefault();
              openSectionRewrite(sectionHover.el);
            }}
            className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold text-white/90 hover:bg-white/15 transition-colors"
          >
            <Sparkles size={13} /> Réécrire cette section
          </button>
        </div>,
        document.body,
      )}

      {linkHover && createPortal(
        <div
          style={{
            position: 'fixed',
            top:  linkHover.rect.bottom + 6,
            left: linkHover.rect.left,
            zIndex: 400,
          }}
          onMouseEnter={() => clearTimeout(leaveTimerRef.current)}
          onMouseLeave={() => { leaveTimerRef.current = setTimeout(() => setLinkHover(null), 1000); }}
        >
          <motion.button
            initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
            onClick={() => {
              applyInternalLink(linkHover.anchor, linkHover.url, linkHover.idx);
              setLinkHover(null);
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-gray-900 text-white shadow-lg hover:bg-black whitespace-nowrap"
          >
            <Link2 size={11} />
            Appliquer le lien
          </motion.button>
          {/* Destination : URL complète + titre de la page cible */}
          {(linkHover.url || internalLinks[linkHover.idx]?.title) && (
            <div className="mt-1 px-2 py-1 bg-white border border-gray-200 rounded-lg shadow max-w-[420px] space-y-0.5">
              {linkHover.url && (
                <p className="text-[10px] text-gray-600 break-all flex items-start gap-1">
                  <Link2 size={9} className="flex-shrink-0 mt-0.5 text-sage-500" />
                  <span>{linkHover.url}</span>
                </p>
              )}
              {internalLinks[linkHover.idx]?.title && (
                <p className="text-[10px] text-gray-400 truncate">→ {internalLinks[linkHover.idx].title}</p>
              )}
            </div>
          )}
        </div>,
        document.body
      )}

      {/* ── Tooltip URL au survol d'une vraie ancre (lien existant/appliqué) ──── */}
      {anchorHover && createPortal(
        <div
          style={{
            position: 'fixed',
            top:  anchorHover.rect.bottom + 6,
            left: Math.max(8, Math.min(anchorHover.rect.left, window.innerWidth - 440)),
            zIndex: 400,
          }}
          onMouseEnter={() => {
            clearTimeout(leaveTimerRef.current);
            clearTimeout(anchorTimerRef.current);
            anchorTimerRef.current = null;
          }}
          onMouseLeave={() => {
            clearTimeout(anchorTimerRef.current);
            anchorTimerRef.current = setTimeout(() => { anchorTimerRef.current = null; setAnchorHover(null); }, 1000);
          }}
        >
          <div className="max-w-[420px] px-2.5 py-2 rounded-lg bg-gray-900 text-white shadow-lg text-[11px] leading-snug space-y-1.5">
            {anchorHover.title && (
              <p className="font-semibold text-white/95 line-clamp-2">{anchorHover.title}</p>
            )}
            <div className="flex items-start gap-1.5">
              <Link2 size={11} className="flex-shrink-0 mt-0.5 text-sage-300" />
              <span className="break-all text-white/70">{anchorHover.url}</span>
            </div>
            {/^https?:\/\//i.test(anchorHover.url) && (
              <a
                href={anchorHover.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 mt-0.5 px-2 py-1 rounded-md bg-white/15 hover:bg-white/25 text-white text-[11px] font-medium transition-colors"
              >
                <ExternalLink size={11} /> Ouvrir dans un nouvel onglet
              </a>
            )}
          </div>
        </div>,
        document.body
      )}


      {sources.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
          className="glass-card p-5 space-y-3"
        >
          <h3
            className="text-sm font-semibold text-gray-800 flex items-center gap-2 cursor-pointer"
            onClick={() => setShowSources(v => !v)}
          >
            <Globe size={14} className="text-gray-400" />
            Sources vérifiées ({sources.length})
            {showSources ? <ChevronUp size={14} className="text-gray-400 ml-auto" /> : <ChevronDown size={14} className="text-gray-400 ml-auto" />}
          </h3>
          {showSources && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {sources.slice(0, 8).map((source, i) => (
              <div key={i} className="flex items-start gap-2.5 bg-gray-50 rounded-xl px-3 py-2.5">
                <div className="w-5 h-5 bg-white border border-gray-200 rounded-md flex items-center justify-center flex-shrink-0 mt-0.5 shadow-sm">
                  <span className="text-[10px] font-semibold text-gray-500">{i + 1}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-gray-700 leading-snug truncate">
                    {source.title || source.url || 'Source sans titre'}
                  </p>
                  {source.url && (
                    <a href={source.url} target="_blank" rel="noopener noreferrer"
                      className="text-[11px] text-sage-500 hover:underline flex items-center gap-0.5 mt-0.5 truncate"
                    >
                      <ExternalLink size={9} className="flex-shrink-0" />
                      {source.url.replace(/^https?:\/\//, '').split('/')[0]}
                    </a>
                  )}
                  {source.relevance && (
                    <p className="text-[11px] text-gray-400 mt-0.5 truncate">{source.relevance}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
          )}
        </motion.div>
      )}
    </div>
  );
}
