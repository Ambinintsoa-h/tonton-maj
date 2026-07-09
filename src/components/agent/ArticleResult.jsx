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
  Undo2, Redo2, Scissors, Trash2, Lock, CheckCheck,
} from 'lucide-react';
import { exportAsText, exportAsHtml, exportAsMarkdown, copyToClipboard, stripParasiticFontSize } from '../../utils/export';
import { publishToWordPress, updatePost, findPostByUrl } from '../../services/wordpress';
import BubbleToolbar from './BubbleToolbar';
import TableToolbar from './TableToolbar';
import DocNavigator from './DocNavigator';
import { runReviewAgent, generateAltText, generateSeoMeta, suggestCategory } from '../../services/agent';
import { scrapeUrl } from '../../services/scraper';
import { applyAllDiffs, applyDiff, applyAddition, applyReplacementFuzzy, insertNearClosestParagraph, repairStructureEl, moveFaqToEnd } from '../../utils/diff';
import {
  findFaqBlock, isInsideFaq, getQAGroups, findQAIndex, moveQAGroup, deleteQAGroup,
  insertQAAfter, serializeFaqBlock, removeFaqBlock, moveFaqBlockBySection,
  insertFaqHtmlAtCaret, rectOfNodes, normalizeFaqToAccordion,
} from '../../utils/faq';
import { blockMeta, accord, blockAtRange, insertBlockHtml, makeTablesResponsive, topLevelBlockOf, isDiffWrapper, normalizeTableStructure } from '../../utils/blocks';
import { resetAgent, setUpdatedContent, setDiff, setSources, setTokenUsage, setWpData, setDraftStatus, setCurrentArticleId } from '../../store/slices/agentSlice';
import { updateInHistory, addToHistory } from '../../store/slices/articlesSlice';
import { addArticleStat } from '../../store/slices/statsSlice';
import { removePendingItem } from '../../store/slices/pendingSlice';
import {
  saveArticle, updateArticleHtml,
  acquireEditLock, heartbeatEditLock, releaseEditLock, watchEditLock, isLockActive, LOCK_HEARTBEAT_MS,
} from '../../services/firebase';
import { saveDraft, flushDraftRemote, onDraftStatus } from '../../services/articleDraft';
import articleTimeTracker from '../../services/articleTimeTracker';
import { renderMarkdown, emojiToIcons, unwrapProseFences, trimAuditForDisplay } from '../../utils/markdown';
import { validateImageFile } from '../../utils/uploadLimits';
import { useNavigate } from 'react-router-dom';

const TAB_AUDIT = 'audit';
const TAB_AVANT = 'avant';
const TAB_APRES = 'apres';

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
  // Dialogue « modifications en attente » au moment de publier :
  // { site, mode, foundPost, count } | null
  const [publishGuard, setPublishGuard] = useState(null);

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
  // Titre éditable de l'article
  const [editedTitle, setEditedTitle] = useState('');
  // titleDirty = true uniquement si l'utilisateur a tapé dans le champ
  // → le titre n'est envoyé à WordPress QUE si l'utilisateur l'a modifié
  const [titleDirty, setTitleDirty]   = useState(false);

  // ── SEO Meta (Yoast / SEOPress) ───────────────────────────────────────────────
  const [seoTitle,       setSeoTitle]       = useState('');
  const [seoDescription, setSeoDescription] = useState('');
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

  useEffect(() => {
    setTitleDirty(false);
    // Priorité 1 : titre WP réel (API REST) — source la plus fiable
    const wpTitle = wpMcpData?.wpTitle || '';
    if (wpTitle) { setEditedTitle(wpTitle); return; }
    // Priorité 2 : H1 de l'article original — jamais le slug d'URL
    const h1 = extractH1FromHtml(agent.originalContent);
    setEditedTitle(h1 || '');
  }, [wpMcpData?.wpTitle, agent.originalContent]);

  // Reset SEO fields + état catégories quand on passe à un nouvel article.
  // Réinitialiser catsDirty/selectedCategories/catSuggestedRef évite d'hériter d'un
  // état « dirty » d'un article précédent (sinon on pourrait publier des catégories
  // non désirées → changement de permalien → 404).
  useEffect(() => {
    seoGeneratedRef.current = false;
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
        const { seoTitle: t, seoDescription: d } = await generateSeoMeta(agent.updatedContent, title);
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

  // Auto-génération SEO dès que la MAJ est prête (une seule fois par analyse)
  useEffect(() => {
    if (!agent.updatedContent || seoGeneratedRef.current) return;
    seoGeneratedRef.current = true;
    runSeoGeneration();
  }, [agent.updatedContent, runSeoGeneration]);

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
  const [newImgInput, setNewImgInput] = useState('');
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

    // 2b. Filet : retirer toute SUPPRESSION résiduelle qui n'est plus un <del> —
    //     élément portant .deleted-content, balises <s>/<strike>, ou tout élément dont
    //     le style inline barre le texte (line-through). Ces résidus apparaissent quand
    //     Chrome « inline » le style d'un <del> lors d'une édition manuelle dans le
    //     contentEditable. Règle de base : le barré (supprimé) ne doit jamais rester
    //     dans la vue finale ni dans l'article publié.
    tmp.querySelectorAll('.deleted-content, s, strike, [style*="line-through"]').forEach(el => el.remove());

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

    // 4. Filet de sécurité regex — capture les <del>/<mark>/<ins> résiduels que le DOM
    //    n'aurait pas rattrapés (ex: balises cassées par une édition dans contentEditable,
    //    HTML encodé différemment, attributs inattendus…)
    let html = tmp.innerHTML;
    // Supprimer tout <del …>…</del> résiduel (contenu texte simple, pas de <del> imbriqués)
    html = html.replace(/<del\b[^>]*>[\s\S]*?<\/del>/gi, '');
    // Idem pour <s>/<strike> résiduels (texte barré = supprimé → jamais publié)
    html = html.replace(/<(s|strike)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
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
      currentArticleId: agent.currentArticleId || null,
      tokenUsage:      agent.tokenUsage || null,
    }),
  };

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
    const snap = html != null ? html : (contentRef.current || '');
    if (h.present == null) { h.present = snap; return; }   // 1er état = référence, pas d'undo dessus
    if (snap === h.present) return;                          // rien de neuf
    h.past.push(h.present);
    if (h.past.length > MAX_HISTORY) h.past.shift();
    h.present = snap;
    h.future = [];
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
  const undo = useCallback(() => {
    const h = historyRef.current;
    if (!h.past.length) return;
    h.future.unshift(h.present);
    h.present = h.past.pop();
    syncHist();
    persistHistory();
    applyHistorySnap(h.present);
  }, [syncHist, persistHistory, applyHistorySnap]);
  const redo = useCallback(() => {
    const h = historyRef.current;
    if (!h.future.length) return;
    h.past.push(h.present);
    h.present = h.future.shift();
    syncHist();
    persistHistory();
    applyHistorySnap(h.present);
  }, [syncHist, persistHistory, applyHistorySnap]);
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
    setHistState({ canUndo: historyRef.current.past.length > 0, canRedo: historyRef.current.future.length > 0 });
  }, [agent.currentArticleId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Frappe clavier : mise à jour du ref uniquement, SANS setState → pas de re-render
  // (couvre aussi la mise en forme BubbleToolbar : execCommand déclenche 'input')
  const handleInput = useCallback((e) => {
    contentRef.current = e.currentTarget.innerHTML;
    humanEditRef.current = true;
    triggerAutosave(true);
  }, [triggerAutosave]);

  // Autosave sur changements d'état non clavier (image à la une, diff, liens, sources)
  useEffect(() => {
    if (!hasContent) return;
    triggerAutosave();
  }, [agent.wpData, agent.diff, agent.sources, agent.internalLinks, featuredImgUrl, hasContent, triggerAutosave]);

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
  useEffect(() => {
    if (agent.draftStatus !== 'saved') return;
    const articleId = agent.currentArticleId;
    if (!articleId) return;
    const html = contentRef.current || '';
    if (!html || html === lastSyncedHtmlRef.current) return;
    lastSyncedHtmlRef.current = html;
    updateArticleHtml(articleId, html, reallyEdited(html)
      ? { lastModifiedAt: Date.now(), lastModifiedBy: editorNameRef.current }
      : null).catch(() => {});
  }, [agent.draftStatus, agent.currentArticleId]); // eslint-disable-line react-hooks/exhaustive-deps

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
  const handlePaste = useCallback((e) => {
    e.preventDefault();
    const cd = e.clipboardData || window.clipboardData;
    if (!cd) return;
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
  }, []);

  // Navigation entre les modifications dans l'article
  const jumpToChange = useCallback((dir) => {
    if (!articleRef.current) return;
    const marks = Array.from(articleRef.current.querySelectorAll('mark.updated-content, del.deleted-content, ins.added-content'));
    // Naviguer sur les mark (remplacement) et ins (addition), pas les del
    const targets = marks.filter(el => el.tagName === 'MARK' || el.tagName === 'INS');
    if (!targets.length) return;
    changeIdxRef.current = (changeIdxRef.current + dir + targets.length) % targets.length;
    const target = targets[changeIdxRef.current];

    // Scroll manuel plutôt que scrollIntoView : évite le bug Chrome où scrollIntoView
    // sur un contentEditable réinitialise le scrollTop à 0 avant de scroller.
    // getBoundingClientRect() est correct même si un ancêtre intermédiaire est positionné
    // (offsetTop serait relatif à cet ancêtre, pas au container — résultat erroné).
    const container = articleRef.current;
    const relativeTop = target.getBoundingClientRect().top
      - container.getBoundingClientRect().top
      + container.scrollTop;
    const center = relativeTop - container.clientHeight / 2 + target.offsetHeight / 2;
    container.scrollTo({ top: Math.max(0, center), behavior: 'smooth' });

    // Flash outline pour signaler le changement actif
    target.style.outline = '2px solid #2d6a2d';
    target.style.outlineOffset = '2px';
    setTimeout(() => { target.style.outline = ''; target.style.outlineOffset = ''; }, 900);
  }, []);

  // ── Deuxième passe ────────────────────────────────────────────────────────
  const [reviewing, setReviewing] = useState(false);
  const [reviewStep, setReviewStep] = useState('');
  const [reviewProgress, setReviewProgress] = useState(0);

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
        skills,
        knowledge,
        anthropicKey: settings.anthropicKey,
        braveKey: settings.braveKey,
        tavilyKey: settings.tavilyKey,
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
        url:             cqItem.url        || '',
        keyword:         cqItem.keyword    || '',
        priority:        cqItem.priority   || 'normale',
        assigneeId:      cqItem.assigneeId || null,
        createdAt:       new Date().toISOString(),
        tokenUsage:      agent.tokenUsage  || null,
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
      dispatch(updateInHistory({
        id:             agent.currentArticleId,
        title:          editedTitle || extractH1FromHtml(agent.originalContent) || '',
        updatedContent: finalHtml,
        updates:        agent.diff    || [],
        sources:        agent.sources || [],
        finishedAt:     new Date().toISOString(),
        ...lastMod,
      }));
      // Persiste le HTML final + la trace de modification côté base (non bloquant :
      // l'autosave throttlé peut ne pas avoir eu le temps de pousser les derniers changements)
      if (firebaseReady && finalHtml) {
        updateArticleHtml(agent.currentArticleId, finalHtml, lastMod).catch(() => {});
      }
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
  const internalLinks = agent.internalLinks || [];
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
    const { del, mark, ins } = resolveDiffPair(node);
    if (ins) unwrapNode(ins);
    if (del) del.remove();
    if (mark) unwrapNode(mark);
    afterSegEdit();
  }, [afterSegEdit]);

  // ✗ Rejeter : on REVIENT à l'original → on restaure le texte barré (débalise del),
  //   on supprime le surligné vert (mark) et le bloc ajouté (ins).
  const rejectSegment = useCallback((node) => {
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

  // ── Presse-papiers interne de BLOCS (FAQ, tableau, titre, image, liste…) ────
  // blockClipRef = { html, meta } — contenu coupé/copié · blockClipboard =
  // { mode:'couper'|'copier', name, art, fem } | null → snackbar + boutons
  // « Coller » (clic droit BubbleToolbar, panneau Structure : avant/après).
  const blockClipRef = useRef(null);
  const [blockClipboard, setBlockClipboard] = useState(null);

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
  const blockClipFromEl = useCallback((el, cut) => {
    if (!el || !articleRef.current || el.parentNode !== articleRef.current) {
      toast.error('Aucun bloc identifié à cet endroit');
      return;
    }
    const meta = blockMeta(el);
    // Bloc AJOUTÉ (enveloppé dans <ins>/<mark> de diff) → on copie le contenu
    // PROPRE (sans le marqueur), pour qu'il se colle comme un bloc normal.
    blockClipRef.current = { html: isDiffWrapper(el) ? el.innerHTML : el.outerHTML, meta };
    if (cut) el.remove();
    setBlockClipboard({ mode: cut ? 'couper' : 'copier', ...meta });
    if (cut) afterFaqEdit(); else setFaqHover(null);
    toast.success(
      `${meta.name} ${accord(meta, cut ? 'coupé' : 'copié')} — CLIC DROIT à l'endroit voulu puis « Coller ${meta.art} »`,
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
  // sinon en fin d'article.
  const blockPaste = useCallback(() => {
    const clip = blockClipRef.current;
    if (!clip?.html || !articleRef.current) return;
    const first = insertFaqHtmlAtCaret(articleRef.current, clip.html);
    if (!first) { toast.error('Collage impossible'); return; }
    setBlockClipboard(null);
    afterFaqEdit();
    scrollToFaqNode(first);
    toast.success(`${clip.meta.name} ${accord(clip.meta, 'collé')}`);
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
    if (!clip?.html || !container) return;
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
      toast.success(`Lien interne ajouté : "${anchor}"`);
    } else {
      toast.error(`Ancre introuvable dans l'article : "${anchor}"`);
    }
  }, [lockMedia]);

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
          // Ignorer le contenu supprimé (<del>) et les spans déjà surlignés
          if (node.parentElement?.closest('del, [data-il-idx]')) continue;

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
    contentRef.current = articleRef.current.innerHTML;
    lockMedia(articleRef.current);

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
    toast.success('Correction ajoutée dans l\'article !');
    setTimeout(() => setAddedIdx(null), 2000);
  }, [updates, dispatch, lockMedia]);

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

  const handleExport = async (format) => {
    const finalContent = getFinalHtml();
    let content = '';
    if (format === 'text') content = exportAsText(finalContent);
    else if (format === 'html') content = exportAsHtml(finalContent);
    else if (format === 'markdown') content = exportAsMarkdown(finalContent);
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
  // opts.skipPendingGuard : true quand l'utilisateur a déjà tranché dans le dialogue
  // « modifications en attente » (Tout accepter / Publier sans elles).
  const handlePublish = async (site, mode = 'update', foundPost = null, opts = {}) => {
    // ── Garde-fou : des modifications encore EN ATTENTE ne seront pas publiées ──
    // (getFinalHtml les exclut). On prévient l'utilisateur au lieu de publier
    // silencieusement un article incomplet.
    if (!opts.skipPendingGuard) {
      const count = countPendingChanges();
      if (count > 0) { setPublishGuard({ site, mode, foundPost, count }); return; }
    }
    setPublishing(true);
    const rawHtml = exportAsHtml(getFinalHtml());

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
          toast.success(`Article mis à jour sur ${site.name} ! Si la page semble inchangée, videz le cache WordPress/CDN.`, { duration: 6000 });
          if (result.link) window.open(result.link, '_blank');
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
    <div className="space-y-4">

      {/* ── Barre de stats ── */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-card p-4 flex flex-wrap items-center gap-x-6 gap-y-2"
      >
        <div className="flex items-center gap-2">
          <CheckCircle2 size={16} className="text-sage-500" />
          <span className="text-sm font-semibold text-gray-800">Analyse terminée</span>
        </div>
        <div className="h-4 w-px bg-gray-200 hidden sm:block" />
        {/* Modifications appliquées dans l'article */}
        <div className="text-sm text-gray-600">
          <span className="font-bold text-gray-900">{appliedUpdates.length}</span>
          {' '}modification{appliedUpdates.length !== 1 ? 's' : ''} appliquée{appliedUpdates.length !== 1 ? 's' : ''}
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
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Tag size={14} className="text-indigo-500 flex-shrink-0" />
              <span className="text-sm font-semibold text-gray-800">Catégories WordPress</span>
              {catLoading && <Loader size={12} className="animate-spin text-gray-400" />}
            </div>
            {/* Barre de recherche */}
            <div className="relative w-44">
              <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              <input
                value={catSearch}
                onChange={e => setCatSearch(e.target.value)}
                placeholder="Filtrer…"
                className="w-full pl-7 pr-3 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-300 bg-white"
              />
            </div>
          </div>

          {/* Catégories */}
          {wpCategories.length > 0 && (
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
          {selectedCategories.length > 0 && (
            <p className="text-[11px] text-indigo-600 font-medium">
              <CheckCircle2 size={13} className="inline text-emerald-600 shrink-0" /> {selectedCategories.length} catégorie{selectedCategories.length > 1 ? 's' : ''} sélectionnée{selectedCategories.length > 1 ? 's' : ''} — appliquée{selectedCategories.length > 1 ? 's' : ''} à la publication
            </p>
          )}
        </motion.div>
      )}

      {/* ── Carte AVANT / APRÈS ── */}
      <div className="glass-card overflow-hidden">

        {/* Tab bar + actions */}
        <div className="flex items-center justify-between border-b border-gray-100 px-6">
          <div className="flex items-center gap-1.5 py-3">
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
                id: TAB_APRES, label: 'Après — MAJ proposées', icon: Sparkles,
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

            {/* Bouton Terminer — CQ validation + flow normal */}
            {(cqItem || agent.currentArticleId) && (
              <button
                onClick={handleTerminer}
                disabled={terminant}
                className="btn-primary text-xs bg-gray-900 hover:bg-gray-700"
              >
                {terminant
                  ? <Loader size={13} className="animate-spin" />
                  : <ShieldCheck size={13} />
                }
                Terminer
              </button>
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
                    className="absolute right-0 top-full mt-1 glass-card p-1.5 z-50 w-44"
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

            {wpSites.length > 0 && (
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
                      className="absolute right-0 top-full mt-1 glass-card p-2 z-50 w-80"
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

        {/* Contenu des tabs */}
        <AnimatePresence mode="wait">

          {activeTab === TAB_AUDIT && (
            <motion.div key="audit"
              initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 10 }}
              className="p-6"
            >
              <div className="flex items-center gap-2 mb-3">
                <ClipboardCheck size={15} className="text-violet-500" />
                <p className="text-sm font-semibold text-gray-800">Audit du skill — rapport complet</p>
                <span className="text-[10px] text-gray-400">les corrections appliquées dans « Après » en sont déduites</span>
              </div>
              <div className="bg-white border border-gray-200 rounded-xl p-6 min-h-[420px] shadow-sm">
                {auditReport ? (
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
                          {featuredImgUrl || <em className="not-italic text-gray-300">Aucune image définie</em>}
                        </span>
                        <button
                          onClick={() => { setNewImgInput(featuredImgUrl); setShowImgReplace(true); }}
                          disabled={uploadingImg}
                          className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 bg-black/5 hover:bg-black/10 text-gray-700 rounded-lg transition-colors font-medium disabled:opacity-40"
                        >
                          <Link2 size={11} /> Lien
                        </button>
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
                    {/* En-tête */}
                    <div className="flex items-center gap-2">
                      <Search size={16} className="shrink-0" />
                      <span className="text-[11px] font-medium text-gray-500 shrink-0">SEO Meta</span>
                      {seoGenerating && <Loader size={11} className="animate-spin text-gray-400 ml-1" />}
                      {!seoGenerating && (seoTitle || seoDescription) && (
                        <span className="text-[10px] font-semibold text-emerald-600 bg-emerald-50 border border-emerald-100 px-1.5 py-0.5 rounded-full flex items-center gap-1">
                          <Sparkles size={9} /> Généré
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

                {/* Badge vue finale */}
                {!diffMode && (
                  <span className="text-[11px] text-gray-400 italic">
                    Article final sans marquages — prêt à copier/publier
                  </span>
                )}

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
                        className="article-diff-content md-content text-sm leading-loose p-6 bg-white rounded-xl border border-gray-200 shadow-sm min-h-[300px] focus:outline-none focus:ring-2 focus:ring-black/10"
                        onInput={handleInput}
                        onPaste={handlePaste}
                        onKeyDown={(e) => {
                          // Undo/redo maison (couvre accepter/rejeter, médias… que l'undo
                          // natif ignore) → on court-circuite l'undo natif du navigateur.
                          const k = e.key.toLowerCase();
                          if ((e.ctrlKey || e.metaKey) && k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
                          else if ((e.ctrlKey || e.metaKey) && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); redo(); }
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
                              return;
                            }
                          }
                          // 2) Segment de diff (del/mark/ins) → mini-boutons ✓/✗ (#3)
                          const seg = e.target.closest('del.deleted-content, mark.updated-content, ins.added-content');
                          if (seg && e.currentTarget.contains(seg)) {
                            clearTimeout(leaveTimerRef.current);
                            setSegHover({ node: seg, rect: seg.getBoundingClientRect() });
                            setLinkHover(null); setAnchorHover(null); setFaqHover(null); setTableHover(null);
                            return;
                          }
                          // 3) Section FAQ → barres flottantes (bloc entier / Q-R survolée)
                          const fq = detectFaqHover(e.target);
                          if (fq) {
                            clearTimeout(leaveTimerRef.current);
                            setFaqHover(fq);
                            setLinkHover(null);
                            setTableHover(null);
                            showAnchorTooltip(e); // les tooltips de liens restent actifs dans la FAQ
                            return;
                          }
                          // 3bis) Tableau → barre « bloc entier » (copier / couper / supprimer)
                          const tbl = e.target.closest('table, [data-tt-table-wrap]');
                          if (tbl && e.currentTarget.contains(tbl)) {
                            const top = topLevelBlockOf(articleRef.current, tbl) || tbl;
                            clearTimeout(leaveTimerRef.current);
                            setTableHover({ el: top, rect: top.getBoundingClientRect() });
                            setLinkHover(null);
                            showAnchorTooltip(e);
                            return;
                          }
                          // 4) Vraie ancre <a href> → tooltip URL complète
                          showAnchorTooltip(e);
                          // Hors lien interne / segment de diff / FAQ : on n'est plus sur l'élément
                          // → planifier le masquage des mini-boutons ✓/✗ (la souris sur le
                          // segment OU sur la barre flottante annule ce timer). Évite qu'ils
                          // restent affichés en glissant la souris sur le texte voisin.
                          if (segHover || linkHover || faqHover || tableHover) {
                            clearTimeout(leaveTimerRef.current);
                            leaveTimerRef.current = setTimeout(() => { setSegHover(null); setLinkHover(null); setFaqHover(null); setTableHover(null); }, 1200);
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
                if (!el || el.parentNode !== articleRef.current) { setTableHover(null); return; }
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

      {/* ── Garde-fou publication : des modifications encore EN ATTENTE ────────
          Elles ne seraient pas publiées (getFinalHtml les exclut) → on demande. */}
      {publishGuard && createPortal(
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 700 }}
          className="bg-black/40 backdrop-blur-[2px] flex items-center justify-center p-6"
          onMouseDown={() => setPublishGuard(null)}
        >
          <div
            onMouseDown={(e) => e.stopPropagation()}
            className="bg-white rounded-2xl shadow-[0_24px_80px_rgba(0,0,0,0.35)] w-full max-w-md p-6 text-center border-t-4 border-amber-400"
          >
            <div className="mx-auto w-11 h-11 rounded-2xl bg-amber-50 flex items-center justify-center mb-3">
              <AlertTriangle size={20} className="text-amber-500" />
            </div>
            <h3 className="text-[15px] font-bold text-gray-900">
              {publishGuard.count} modification{publishGuard.count > 1 ? 's' : ''} en attente
            </h3>
            <p className="text-[13px] text-gray-500 mt-2 leading-relaxed">
              Les passages surlignés (vert / bleu / rouge) qui n'ont pas été acceptés
              ne seront <span className="font-semibold text-gray-700">pas publiés</span> —
              l'article partira avec son texte original à ces endroits.
            </p>
            <div className="flex flex-col gap-2 mt-5">
              <button
                type="button"
                onClick={() => {
                  const g = publishGuard;
                  setPublishGuard(null);
                  processAllSegments('accept');
                  handlePublish(g.site, g.mode, g.foundPost, { skipPendingGuard: true });
                }}
                className="w-full px-4 py-2.5 rounded-xl text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 transition-colors shadow-sm flex items-center justify-center gap-2"
              >
                <CheckCheck size={16} /> Tout accepter puis publier
              </button>
              <button
                type="button"
                onClick={() => {
                  const g = publishGuard;
                  setPublishGuard(null);
                  handlePublish(g.site, g.mode, g.foundPost, { skipPendingGuard: true });
                }}
                className="w-full px-4 py-2.5 rounded-xl text-sm font-semibold text-gray-700 border border-gray-200 hover:bg-gray-50 transition-colors"
              >
                Publier sans ces modifications
              </button>
              <button
                type="button"
                onClick={() => setPublishGuard(null)}
                className="w-full px-4 py-2 rounded-xl text-sm font-medium text-gray-400 hover:text-gray-600 transition-colors"
              >
                Annuler
              </button>
            </div>
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
