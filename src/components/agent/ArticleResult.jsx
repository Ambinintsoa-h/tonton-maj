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
  Plus, Link2, X, Tag, Search,
} from 'lucide-react';
import { exportAsText, exportAsHtml, exportAsMarkdown, copyToClipboard } from '../../utils/export';
import { publishToWordPress, updatePost, findPostByUrl } from '../../services/wordpress';
import BubbleToolbar from './BubbleToolbar';
import { runReviewAgent, generateAltText } from '../../services/agent';
import { scrapeUrl } from '../../services/scraper';
import { applyAllDiffs, moveFaqToEnd } from '../../utils/diff';
import { resetAgent, setUpdatedContent, setDiff, setSources, setTokenUsage, setWpData } from '../../store/slices/agentSlice';
import { updateInHistory, addToHistory } from '../../store/slices/articlesSlice';
import { addArticleStat } from '../../store/slices/statsSlice';
import { removePendingItem } from '../../store/slices/pendingSlice';
import { saveArticle } from '../../services/firebase';
import { renderMarkdown } from '../../utils/markdown';
import { useNavigate } from 'react-router-dom';

const TAB_AVANT = 'avant';
const TAB_APRES = 'apres';

export default function ArticleResult() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const agent = useSelector(s => s.agent);
  const settings = useSelector(s => s.settings);
  const skills = useSelector(s => s.skills.list);
  const knowledge = useSelector(s => s.knowledge.list);
  const firebaseReady   = useSelector(s => s.settings.firebaseReady);
  const wpSites         = useSelector(s => s.wordpress.sites);
  const articlesHistory = useSelector(s => s.articles.history);
  const pendingItems    = useSelector(s => s.pending.list);
  const wpMcpData       = agent.wpData || null;  // données MCP WordPress (post ID, featured_media…)

  // Mode validation CQ : l'item pending avec cet ID est en statut 'a_valider'
  const cqItem = pendingItems.find(i => i.id === agent.currentArticleId && i.status === 'a_valider') || null;

  // URL de l'article courant (pour retrouver le post WP à mettre à jour)
  const currentArticle = articlesHistory.find(a => a.id === agent.currentArticleId);
  const articleUrl     = cqItem?.url || currentArticle?.url || '';

  const [activeTab, setActiveTab] = useState(TAB_APRES);
  const [showExport, setShowExport] = useState(false);
  const [showWP, setShowWP] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [wpFoundPost, setWpFoundPost] = useState(null);         // post WP trouvé par URL
  const [wpSearching, setWpSearching] = useState(false);
  const [wpNotFoundReason, setWpNotFoundReason] = useState(''); // raison si non trouvé
  const [hasContent, setHasContent] = useState(false);
  const [diffMode, setDiffMode] = useState(true);
  // Titre éditable de l'article
  const [editedTitle, setEditedTitle] = useState('');
  // titleDirty = true uniquement si l'utilisateur a tapé dans le champ
  // → le titre n'est envoyé à WordPress QUE si l'utilisateur l'a modifié
  const [titleDirty, setTitleDirty]   = useState(false);

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

  // ── Catégories WordPress ──────────────────────────────────────────────────────
  const [wpCategories, setWpCategories]       = useState([]);
  const [selectedCategories, setSelectedCategories] = useState([]);
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
  const fileImgInputRef = useRef(null); // input file caché pour l'upload image à la une
  const [articleEl, setArticleEl] = useState(null); // exposé à BubbleToolbar (déclenche re-render quand le div monte)

  // Vue finale : supprime les <del> et débalise les <mark>
  //
  // ⚠️  On utilise la manipulation DOM (pas des regex sur string) car :
  //   - contentRef.current peut contenir des balises HTML déséquilibrées
  //     (ex: une </strong> capturée dans un <del> par la stratégie 3b du diff)
  //   - Le navigateur normalise automatiquement ces déséquilibres quand on
  //     définit innerHTML (c'est ce qui rend la Vue diff correcte visuellement)
  //   - Les regex sur string ignorent ce contexte et laissent des <strong>
  //     non fermés → tout ce qui suit s'affiche en gras dans la Vue finale
  const getFinalHtml = useCallback(() => {
    // 1. Laisser le navigateur parser et normaliser le HTML
    const tmp = document.createElement('div');
    tmp.innerHTML = contentRef.current || '';

    // 2. Supprimer tous les blocs <del> (texte supprimé) via le DOM
    tmp.querySelectorAll('del').forEach(el => el.remove());

    // 3. Débaliser les <mark> et <ins class="added-content"> : conserver le contenu
    tmp.querySelectorAll('mark').forEach(el => {
      const frag = document.createDocumentFragment();
      while (el.firstChild) frag.appendChild(el.firstChild);
      if (el.parentNode) el.parentNode.replaceChild(frag, el);
    });
    tmp.querySelectorAll('ins.added-content').forEach(el => {
      const frag = document.createDocumentFragment();
      while (el.firstChild) frag.appendChild(el.firstChild);
      if (el.parentNode) el.parentNode.replaceChild(frag, el);
    });

    // 4. Filet de sécurité regex — capture les <del>/<mark>/<ins> résiduels que le DOM
    //    n'aurait pas rattrapés (ex: balises cassées par une édition dans contentEditable,
    //    HTML encodé différemment, attributs inattendus…)
    let html = tmp.innerHTML;
    // Supprimer tout <del …>…</del> résiduel (contenu texte simple, pas de <del> imbriqués)
    html = html.replace(/<del\b[^>]*>[\s\S]*?<\/del>/gi, '');
    // Débaliser tout <mark …>…</mark> résiduel (garder le contenu interne)
    // Boucle pour gérer les marks éventuellement imbriqués (ex: édition manuelle)
    let prev = '';
    while (prev !== html) {
      prev = html;
      html = html.replace(/<mark\b[^>]*>([\s\S]*?)<\/mark>/gi, '$1');
    }
    // Débaliser tout <ins class="added-content">…</ins> résiduel
    html = html.replace(/<ins\b[^>]*class="added-content"[^>]*>([\s\S]*?)<\/ins>/gi, '$1');

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
    el.querySelectorAll('img, [data-media="iframe-wrapper"], iframe, video').forEach(m => {
      m.contentEditable = 'false';
    });
  }, []);

  // Extrait l'URL de l'image à la une :
  // 1. Depuis figure[data-featured] dans le HTML de l'article
  // 2. Fallback : depuis wpData.featuredMediaUrl retourné par le MCP
  useEffect(() => {
    let url = '';
    if (agent.updatedContent) {
      const tmp = document.createElement('div');
      tmp.innerHTML = agent.updatedContent;
      url = tmp.querySelector('figure[data-featured] img')?.getAttribute('src') || '';
    }
    if (!url && wpMcpData?.featuredMediaUrl) url = wpMcpData.featuredMediaUrl;
    setFeaturedImgUrl(url);
  }, [agent.updatedContent, wpMcpData]);

  // Remplace l'image à la une :
  // 1. Upload vers la médiathèque WP via MCP (si site connecté) → met à jour featured_media
  // 2. Met à jour la preview dans le diff (figure data-featured)
  const [uploadingImg, setUploadingImg] = useState(false);
  const handleReplaceFeaturedImage = useCallback(async () => {
    const url = newImgInput.trim();
    if (!url) return;

    // ── Upload MCP si site WP connecté ───────────────────────────────────────
    if (wpMcpData?.siteId) {
      setUploadingImg(true);
      try {
        const matchingSite = wpSites.find(s => s.id === wpMcpData.siteId);
        if (matchingSite) {
          const resp = await axios.post('/api/wp-tool', {
            toolName: 'wp_upload_media',
            toolInput: { site_id: wpMcpData.siteId, image_url: url, alt_text: '' },
            wpSites: [matchingSite],
          }, { timeout: 60000 });
          if (resp.data.success && resp.data.result?.media_id) {
            // Mettre à jour le featured_media_id dans Redux pour la publication
            dispatch(setWpData({ ...wpMcpData, featuredMediaId: resp.data.result.media_id, featuredMediaUrl: url }));
            toast.success(`Image uploadée dans la médiathèque WP (ID ${resp.data.result.media_id})`);
          } else {
            toast.error('Upload échoué : ' + (resp.data.error || 'erreur inconnue'));
            setUploadingImg(false);
            return;
          }
        }
      } catch (e) {
        toast.error('Upload MCP échoué : ' + e.message);
        setUploadingImg(false);
        return;
      }
      setUploadingImg(false);
    }

    // ── Mise à jour de la preview dans le diff ────────────────────────────────
    if (articleRef.current) {
      const fig = articleRef.current.querySelector('figure[data-featured]');
      if (fig) {
        const img = fig.querySelector('img');
        if (img) img.src = url;
      }
      contentRef.current = articleRef.current.innerHTML;
    }
    setFeaturedImgUrl(url);
    setShowImgReplace(false);
    setNewImgInput('');
    if (!wpMcpData?.siteId) toast.success('Image à la une mise à jour dans la preview');

    // Génération automatique du texte ALT via Claude Vision
    if (settings.anthropicKey) {
      generateAltText(url, settings.anthropicKey).then(altText => {
        if (!altText || !articleRef.current) return;
        const img = articleRef.current.querySelector('figure[data-featured] img');
        if (img) { img.alt = altText; contentRef.current = articleRef.current.innerHTML; }
      }).catch(() => {});
    }
  }, [newImgInput, wpMcpData, wpSites, dispatch, settings.anthropicKey]);

  // Upload fichier local → médiathèque WP → met à jour featured_media
  const handleFileUpload = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = ''; // reset input pour permettre re-sélection du même fichier

    const matchingSite = wpSites.find(s => s.id === wpMcpData?.siteId);
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
        dispatch(setWpData({ ...wpMcpData, featuredMediaId: resp.data.media_id, featuredMediaUrl: newUrl }));
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
  }, [wpMcpData, wpSites, dispatch, settings.anthropicKey]);

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

  // Frappe clavier : mise à jour du ref uniquement, SANS setState → pas de re-render
  const handleInput = useCallback((e) => {
    contentRef.current = e.currentTarget.innerHTML;
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
      // Article propre (sans balises <del>/<mark>) envoyé à Claude pour analyse
      const cleanContent = getFinalHtml();

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
        toast('Deuxième passe : article déjà complet, aucune nouvelle modification', { icon: 'ℹ️' });
        return;
      }

      // ── Appliquer les nouveaux diffs sur l'HTML actuel (avec marques passe 1) ──
      // On utilise contentRef.current et NON cleanContent, pour conserver les marques
      // vertes de la passe 1 dans le rendu. Les stratégies de diff matchent le texte
      // non touché par la passe 1 (str. 1/2) et peuvent traverser les balises HTML
      // pour les textes longs (str. 4 avec [\s\S]{0,N}).
      const { html: newHtml, updates: p2Updates } = applyAllDiffs(contentRef.current, result.updates, 2);
      // Conversion \n→<br> uniquement si pas de structure de blocs HTML
      const p2HasBlocks = /<(p|h[1-6]|table|ul|ol)\b[^>]*>/i.test(newHtml);
      const finalHtml = moveFaqToEnd(p2HasBlocks ? newHtml : newHtml.replace(/\n/g, '<br>'));

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
        toast(`${successCount}/${validUrls.length} source${validUrls.length > 1 ? 's' : ''} lue${successCount > 1 ? 's' : ''} — les autres ont été ignorées`, { icon: '⚠️' });
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
        url:             cqItem.url        || '',
        keyword:         cqItem.keyword    || '',
        priority:        cqItem.priority   || 'normale',
        assigneeId:      cqItem.assigneeId || null,
        createdAt:       new Date().toISOString(),
        tokenUsage:      agent.tokenUsage  || null,
        ...(r.seoTracking ? { seoTracking: r.seoTracking } : {}),
      };
      try {
        if (firebaseReady) {
          try {
            const { id, originalContentUrl, updatedContentUrl } = await saveArticle(articleData);
            const { originalContent, updatedContent, ...meta } = articleData;
            dispatch(addToHistory({
              ...meta,
              id,
              ...(originalContentUrl ? { originalContentUrl } : { originalContent }),
              ...(updatedContentUrl  ? { updatedContentUrl  } : { updatedContent  }),
            }));
          } catch {
            dispatch(addToHistory({ ...articleData, id: Date.now().toString() }));
          }
        } else {
          dispatch(addToHistory({ ...articleData, id: Date.now().toString() }));
        }
        dispatch(removePendingItem(cqItem.id));
        toast.success('Article validé et archivé dans l\'historique !', { icon: '✅' });
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
      dispatch(updateInHistory({
        id:             agent.currentArticleId,
        title:          editedTitle || extractH1FromHtml(agent.originalContent) || '',
        updatedContent: finalHtml,
        updates:        agent.diff    || [],
        sources:        agent.sources || [],
        finishedAt:     new Date().toISOString(),
      }));
      dispatch(resetAgent());
      toast.success('Article archivé dans l\'historique !', { icon: '✅' });
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
  const [linkHover, setLinkHover]       = useState(null); // { idx, url, anchor, rect }
  const leaveTimerRef  = useRef(null);

  // ── Appliquer un lien interne (depuis le span surligné ou fallback regex) ──
  const applyInternalLink = useCallback((anchor, url, linkIdx) => {
    if (!articleRef.current) return;
    // Priorité : retrouver le span injecté par le surlignage
    const span = articleRef.current.querySelector(`[data-il-idx="${linkIdx}"]`);
    if (span) {
      const a = document.createElement('a');
      a.href  = url;
      a.title = anchor;
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
    const newHtml = html.replace(regex, match => `<a href="${url}" title="${anchor}">${match}</a>`);
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

    internalLinks.forEach((link, i) => {
      const escaped   = link.anchor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
        span.className = 'il-highlight';
        anchorNode.parentNode.insertBefore(span, anchorNode);
        span.appendChild(anchorNode);

        injected++;
        break; // Une injection par lien interne
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
  const [copiedIdx, setCopiedIdx] = useState(null);

  const copyMissed = async (text, idx) => {
    await copyToClipboard(text);
    setCopiedIdx(idx);
    toast.success('Correction copiée !');
    setTimeout(() => setCopiedIdx(null), 2000);
  };

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

  // Pré-sélectionner les catégories de l'article dès qu'on a les données MCP
  useEffect(() => {
    if (wpMcpData?.categories?.length) setSelectedCategories(wpMcpData.categories);
  }, [wpMcpData?.categories]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const handlePublish = async (site, mode = 'draft') => {
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

    // featured_media est envoyé séparément à l'API WP REST pour mettre à jour
    // l'image à la une réelle (≠ contenu) — tant qu'un ID est disponible via MCP.
    const hasFeaturedMedia = !!wpMcpData?.featuredMediaId;

    let result;

    if (mode === 'update' && wpFoundPost) {
      // Mise à jour d'un article existant :
      // • Ne jamais changer l'auteur (non inclus dans le body)
      // • Ne jamais changer le titre sauf si l'utilisateur l'a édité manuellement
      // • Ne jamais toucher aux champs SEO (SEOPRESS, Yoast…) — non inclus
      const postData = { content: htmlContent, status: 'publish' };
      if (titleDirty && editedTitle) postData.title = editedTitle;
      if (hasFeaturedMedia) postData.featured_media = wpMcpData.featuredMediaId;
      // Catégories et tags — inclus uniquement si l'utilisateur a fait une sélection
      if (selectedCategories.length > 0) postData.categories = selectedCategories;
      result = await updatePost(
        site,
        wpFoundPost.id,
        postData,
        wpFoundPost.postType || 'posts'
      );
      if (result.success) {
        toast.success(
          `Article mis à jour sur ${site.name} ! Si la page semble inchangée, videz le cache WordPress/CDN.`,
          { duration: 6000 }
        );
        if (result.link) window.open(result.link, '_blank');
      }
    } else {
      // Création d'un nouveau brouillon — le titre vient de l'édition manuelle ou du H1 de l'article
      const draftTitle = editedTitle || currentArticle?.title || 'Article';
      result = await publishToWordPress(site, { title: draftTitle, content: htmlContent, status: 'draft' });
      if (result.success) toast.success(`Brouillon créé sur ${site.name} !`);
    }

    if (!result.success) {
      toast.error(`Erreur WordPress : ${result.error}`, { duration: 8000 });
    } else if (agent.currentArticleId) {
      // ── Auto-archivage dans Historique après publication réussie ────────────
      dispatch(updateInHistory({
        id:             agent.currentArticleId,
        updatedContent: getFinalHtml(),
        updates:        agent.diff    || [],
        sources:        agent.sources || [],
        publishedAt:    new Date().toISOString(),
        publishedUrl:   result.link   || articleUrl || '',
      }));
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
                  title="Objectif +200 mots nets atteint ✓"
                  style={{
                    fontSize: 10, fontWeight: 700,
                    background: '#d1fae5', color: '#059669',
                    border: '1px solid #6ee7b7',
                    borderRadius: 99, padding: '1px 7px',
                    cursor: 'help', whiteSpace: 'nowrap',
                  }}
                >
                  +200 ✓
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

      {/* ── Analyse globale ── */}
      {agent.analysis && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="glass-card p-4 flex items-start gap-3"
        >
          <div className="w-7 h-7 bg-black rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
            <Info size={13} className="text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Synthèse de l'agent</p>
            <div
              className="md-content text-gray-700"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(agent.analysis) }}
            />
          </div>
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
                      onClick={() => setSelectedCategories(prev =>
                        checked ? prev.filter(id => id !== cat.id) : [...prev, cat.id]
                      )}
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
              ✓ {selectedCategories.length} catégorie{selectedCategories.length > 1 ? 's' : ''} sélectionnée{selectedCategories.length > 1 ? 's' : ''} — appliquée{selectedCategories.length > 1 ? 's' : ''} à la publication
            </p>
          )}
        </motion.div>
      )}

      {/* ── Carte AVANT / APRÈS ── */}
      <div className="glass-card overflow-hidden">

        {/* Tab bar + actions */}
        <div className="flex items-center justify-between border-b border-gray-100 px-6">
          <div className="flex">
            {[
              { id: TAB_AVANT, label: 'Avant' },
              { id: TAB_APRES, label: 'Après — MAJ proposées' },
            ].map(t => (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id)}
                className={`relative px-5 py-4 text-sm font-medium transition-colors duration-200 ${
                  activeTab === t.id ? 'text-gray-900' : 'text-gray-400 hover:text-gray-600'
                }`}
              >
                {t.label}
                {activeTab === t.id && (
                  <motion.div
                    layoutId="tab-indicator"
                    className="absolute bottom-0 left-0 right-0 h-0.5 bg-black rounded-full"
                  />
                )}
              </button>
            ))}
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
                <button
                  onClick={() => { setShowWP(showWP ? null : '__menu__'); setWpFoundPost(null); setWpNotFoundReason(''); setShowExport(false); }}
                  className="btn-primary text-xs"
                >
                  {publishing ? <Loader size={13} className="animate-spin" /> : <Globe size={13} />}
                  Publier<ChevronDown size={12} />
                </button>
                <AnimatePresence>
                  {showWP && (
                    <motion.div
                      initial={{ opacity: 0, y: 8, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 8, scale: 0.95 }}
                      className="absolute right-0 top-full mt-1 glass-card p-2 z-50 w-80"
                    >
                      {wpSites.map(site => (
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
                                                onChange={e => setSelectedCategories(prev =>
                                                  e.target.checked ? [...prev, cat.id] : prev.filter(id => id !== cat.id)
                                                )}
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

                              {/* ── Mettre à jour l'article existant ──────── */}
                              {wpFoundPost && (
                                <button
                                  onClick={() => handlePublish(site, 'update')}
                                  disabled={publishing}
                                  className="w-full flex items-center gap-2 px-3 py-2 text-xs text-green-700 bg-green-50 hover:bg-green-100 rounded-lg transition-colors disabled:opacity-50"
                                >
                                  <CheckCircle2 size={13} />
                                  <span className="flex-1 text-left truncate">
                                    Mettre à jour « {wpFoundPost.title?.rendered || wpFoundPost.slug} »
                                  </span>
                                  {wpFoundPost._fromMcp && (
                                    <span className="text-[10px] font-semibold bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full shrink-0">MCP</span>
                                  )}
                                </button>
                              )}
                              {/* ── Créer un nouveau brouillon ────────────── */}
                              <button
                                onClick={() => handlePublish(site, 'draft')}
                                disabled={publishing}
                                className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-600 hover:bg-black/5 rounded-lg transition-colors disabled:opacity-50"
                              >
                                <ExternalLink size={13} />
                                Créer un nouveau brouillon
                              </button>
                              {!wpFoundPost && !wpSearching && wpNotFoundReason && showWP === site.id && (
                                <p className="px-3 py-1.5 text-[11px] text-amber-600 leading-snug">
                                  ⚠ {wpNotFoundReason}
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

          {activeTab === TAB_AVANT && (
            <motion.div key="avant"
              initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 10 }}
              className="p-6"
            >
              <div className="bg-gray-50 rounded-xl p-6 min-h-[420px] max-h-[78vh] overflow-y-auto">
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
                  <span className="text-base shrink-0">📝</span>
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
                    <span className="text-base shrink-0">🖼</span>
                    <span className="text-[11px] font-medium text-gray-500 shrink-0">Image à la une</span>
                    {!showImgReplace ? (
                      <>
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
                        {wpMcpData?.siteId && (
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
                        className="article-diff-content md-content text-sm leading-loose p-6 bg-white rounded-xl border border-gray-200 shadow-sm min-h-[480px] max-h-[78vh] overflow-y-auto focus:outline-none focus:ring-2 focus:ring-black/10"
                        onInput={handleInput}
                        onMouseOver={(e) => {
                          const el = e.target.closest('[data-il-idx]');
                          if (!el) return;
                          const idx = parseInt(el.getAttribute('data-il-idx'), 10);
                          if (appliedLinks.has(idx)) return;
                          clearTimeout(leaveTimerRef.current);
                          const rect = el.getBoundingClientRect();
                          setLinkHover({ idx, url: el.getAttribute('data-il-url') || '', anchor: el.textContent, rect });
                        }}
                        onMouseLeave={() => {
                          leaveTimerRef.current = setTimeout(() => setLinkHover(null), 220);
                        }}
                        contentEditable
                        suppressContentEditableWarning
                      />
                    </motion.div>
                  ) : (
                    /* ── Vue finale : article propre, sans marquages ── */
                    <motion.div key="final"
                      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                      className="p-6 bg-white rounded-xl border border-gray-200 shadow-sm min-h-[480px] max-h-[78vh] overflow-y-auto"
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
                  className="rounded-xl border border-amber-200 bg-amber-50 overflow-hidden"
                >
                  <div className="flex items-center gap-2 px-4 py-2.5 bg-amber-100/70 border-b border-amber-200">
                    <AlertTriangle size={13} className="text-amber-600 flex-shrink-0" />
                    <p className="text-[11px] font-semibold text-amber-700 flex-1">
                      {missedUpdates.length} suggestion{missedUpdates.length > 1 ? 's' : ''} à appliquer manuellement
                      <span className="font-normal ml-1">— texte légèrement différent de la source, copiez la correction et collez-la dans l'article ci-dessus</span>
                    </p>
                  </div>
                  <div className="divide-y divide-amber-100">
                    {missedUpdates.map((u, i) => (
                      <div key={i} className="px-4 py-3 flex items-start gap-3">
                        <span className="flex-shrink-0 w-5 h-5 rounded-md bg-amber-200 text-amber-800 flex items-center justify-center text-[10px] font-bold mt-0.5">
                          {i + 1}
                        </span>
                        <div className="flex-1 min-w-0 space-y-1">
                          <p className="text-[11px] text-gray-400 line-through leading-relaxed break-words">{u.original}</p>
                          <div className="flex items-start gap-1.5">
                            <ArrowRight size={11} className="text-green-500 flex-shrink-0 mt-0.5" />
                            <p className="text-[11px] font-semibold text-green-700 leading-relaxed break-words">{u.updated}</p>
                          </div>
                          {u.reason && (
                            <p className="text-[10px] text-gray-400 italic">{u.reason}</p>
                          )}
                        </div>
                        <button
                          onClick={() => copyMissed(u.updated, i)}
                          title="Copier la correction"
                          className="flex-shrink-0 flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium bg-white border border-amber-200 text-amber-700 hover:bg-amber-50 transition-colors"
                        >
                          {copiedIdx === i
                            ? <><ClipboardCheck size={11} className="text-green-500" /> Copié</>
                            : <><Clipboard size={11} /> Copier</>
                          }
                        </button>
                      </div>
                    ))}
                  </div>
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
      </div>

      {/* ── Détail des modifications ── */}
      {updates.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
          className="glass-card p-5 space-y-3"
        >
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h3 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
              <RefreshCw size={14} className="text-sage-500" />
              Détail des modifications ({updates.length})
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
          <div className="space-y-2">
            {updates.map((u, i) => {
              const isApplied = u.applied !== false;
              const isPass2 = u.pass === 2;
              const isAddition = u.type === 'addition';
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
                            ✓ {isAddition ? 'Paragraphe ajouté' : 'Appliquée dans l\'article'}
                          </span>
                        ) : (
                          <span className="text-[10px] font-semibold text-amber-600 bg-amber-100 rounded-full px-2 py-0.5">
                            ⚠ Non localisée dans le texte
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
                      <div className="flex items-start gap-1.5">
                        <ArrowRight size={12} className={`flex-shrink-0 mt-0.5 ${isAddition ? 'text-blue-400' : 'text-sage-500'}`} />
                        <p className="text-xs leading-relaxed font-medium break-words"
                          style={{ color: isAddition ? '#1d4ed8' : '#2d6a2d' }}
                          dangerouslySetInnerHTML={{ __html: u.updated }}
                        />
                      </div>
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
              <p>Les suggestions ⚠ sont visibles dans l'onglet <strong>Après</strong> avec un bouton "Copier" pour les appliquer directement dans l'éditeur.</p>
            </div>
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
            <span className="text-[11px] text-emerald-600 ml-1 font-medium">✓ Tous appliqués</span>
          )}
        </motion.div>
      )}

      {/* ── Bouton flottant "Appliquer" au survol d'un surlignage ─────────── */}
      {linkHover && createPortal(
        <div
          style={{
            position: 'fixed',
            top:  linkHover.rect.bottom + 6,
            left: linkHover.rect.left,
            zIndex: 400,
          }}
          onMouseEnter={() => clearTimeout(leaveTimerRef.current)}
          onMouseLeave={() => { leaveTimerRef.current = setTimeout(() => setLinkHover(null), 220); }}
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
          {/* Tooltip : destination du lien */}
          {internalLinks[linkHover.idx]?.title && (
            <p className="mt-1 px-2 py-1 bg-white border border-gray-200 rounded-lg text-[10px] text-gray-500 shadow max-w-[260px] truncate">
              → {internalLinks[linkHover.idx].title}
            </p>
          )}
        </div>,
        document.body
      )}

      {sources.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
          className="glass-card p-5 space-y-3"
        >
          <h3 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
            <Globe size={14} className="text-gray-400" />
            Sources vérifiées ({sources.length})
          </h3>
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
        </motion.div>
      )}
    </div>
  );
}
