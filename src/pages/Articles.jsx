import { useState, useEffect, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { motion, AnimatePresence } from 'framer-motion';
import toast from 'react-hot-toast';
import { Link2, FileText, Sparkles, ChevronRight, AlertCircle, TrendingUp, Plus, X as XIcon, Tag, CheckCircle2 } from 'lucide-react';
import { resetAgent, setStatus, addStep, replaceLastStep, setProgress, setOriginalContent, setUpdatedContent, setDiff, setSources, setAnalysis, setError, setCurrentArticleId, setTokenUsage, setParseFailed, setWpData, setInternalLinks, setInternalLinksInfo, setTargetKeyword as setAgentTargetKeyword, setMajDepth as setAgentMajDepth, setAudit, setInstruction as setAgentInstruction, setEditorMeta, setPhase, setPhaseStatus, restorePhaseStatus, setMajScope, setAuditJson, setQatArticle, setObsolescenceReport, setLiveText, clearLiveText } from '../store/slices/agentSlice';
import { DEFAULT_DEPTH } from '../constants/majDepth';
import {
  DEFAULT_ARTICLE_TYPE, DEFAULT_SEO_PLUGIN, DEFAULT_TARGET_WORDS,
  INTERNAL_LINK_ROWS_INITIAL, emptyLinkRow, cleanLinkRows,
} from '../constants/majMode';
import {
  PHASE_AUDIT, PHASE_GENERATION, DONE,
  derivePhaseStatus, maxReachablePhase,
} from '../constants/majPhases';
import { addToHistory, updateInHistory } from '../store/slices/articlesSlice';
import { addArticleStat } from '../store/slices/statsSlice';
import { cacheSiteFonts } from '../store/slices/wordpressSlice';
import axios from 'axios';
import { scrapeUrl } from '../services/scraper';
import { stripNonEditorialLinks, stripNonEditorialUrlsFromText } from '../utils/scrapeClean';
import { runQatAudit } from '../services/agentQat';
import QatBriefFields from '../components/agent/QatBriefFields';
import { saveArticle, initArticleSeoTracking, saveSeoSnapshot, saveSiteFonts } from '../services/firebase';
import { loadDraftLocal, loadDraftRemote, clearDraft } from '../services/articleDraft';
import tracker from '../services/activityTracker';
import articleTimeTracker from '../services/articleTimeTracker';
import AgentThinking from '../components/agent/AgentThinking';
import ArticleResult from '../components/agent/ArticleResult';

const TAB_URL = 'url';
const TAB_TEXT = 'text';

export default function Articles() {
  const dispatch = useDispatch();
  const agent = useSelector(s => s.agent);
  const settings = useSelector(s => s.settings);
  const skills = useSelector(s => s.skills.list);
  const knowledge = useSelector(s => s.knowledge.list);
  const firebaseReady = useSelector(s => s.settings.firebaseReady);
  const wpSites = useSelector(s => s.wordpress.sites);
  const authUid      = useSelector(s => s.auth.uid);
  const authUsername = useSelector(s => s.auth.username);
  const authRole     = useSelector(s => s.auth.role);
  const authPrenom   = useSelector(s => s.auth.prenom);
  const authNom      = useSelector(s => s.auth.nom);

  const [tab, setTab] = useState(TAB_URL);
  const [url, setUrl] = useState('');
  const [text, setText] = useState('');
  // URL du post original en mode « Coller le contenu » (optionnel) : si renseignée,
  // le collage se comporte comme le mode URL (publication ciblée + suivi SEO),
  // SANS re-scraper — on garde le contenu collé.
  const [pasteUrl, setPasteUrl] = useState('');
  const [scraping, setScraping] = useState(false);
  const [targetKeyword, setTargetKeyword] = useState('');
  const [notes, setNotes]                 = useState(''); // instruction libre transmise en priorité à TONTON (passe 1)
  // `majDepth` reste dans l'etat mais N'EST PLUS demande au lancement : l'ampleur
  // se decide en PHASE 2, une fois l'audit lu. Le selecteur qui subsistait ici
  // etait de l'interface morte — runQatAudit ne prend pas de `depth` — et il
  // redemandait la decision au moment precis ou le redacteur n'a rien pour
  // trancher. La valeur par defaut sert encore a la verification de phase 3.
  const [majDepth] = useState(DEFAULT_DEPTH);
  // Parcours UNIQUE en quatre phases (voir constants/majPhases.js). Le double flux
  // « classique | qat » a été retiré : il était explicitement temporaire, et le
  // choix de l'ampleur descend en phase 2, une fois l'audit lu.
  const [articleType, setArticleType]   = useState(DEFAULT_ARTICLE_TYPE);
  const [seoPlugin, setSeoPlugin]       = useState(DEFAULT_SEO_PLUGIN);
  const [targetWords, setTargetWords]   = useState(DEFAULT_TARGET_WORDS);
  const [linkRows, setLinkRows]         = useState(
    () => Array.from({ length: INTERNAL_LINK_ROWS_INITIAL }, emptyLinkRow)
  );
  const [seoKeywords, setSeoKeywords] = useState([]);
  const [seoKwInput, setSeoKwInput] = useState('');

  // ── Restauration de l'autosave au montage (façon Google Docs) ───────────────
  // Reprend automatiquement la MAJ en cours après rechargement / navigation /
  // changement d'appareil, sans rien demander à l'utilisateur.
  const restoredRef = useRef(false);
  // Le fetch réseau de `loadDraftRemote` peut se résoudre bien après le montage —
  // le temps que l'utilisateur audite et génère la MAJ. `agent` capturé par la
  // closure de l'effet ci-dessous reste alors figé sur sa valeur au montage
  // (typiquement 'idle'), et le `.then()` écraserait un travail déjà en cours
  // avec un ancien brouillon. `agentRef` porte la valeur à jour à chaque rendu.
  const agentRef = useRef(agent);
  useEffect(() => { agentRef.current = agent; }, [agent]);

  useEffect(() => {
    const uid = authUid || authUsername || null;
    // L'AUTHENTIFICATION SE RÉSOUT APRÈS LE MONTAGE. Au premier passage `uid` est
    // nul : `loadDraftLocal(null)` lit une clé « anon » vide et
    // `loadDraftRemote(null)` renvoie null SANS MÊME APPELER LE SERVEUR — et le
    // garde-fou interdisait tout nouvel essai quand l'uid arrivait enfin.
    // Mesuré en production : après un rechargement complet (F5, vidage de cache),
    // la requête `article-drafts` n'était jamais émise et le rédacteur retombait
    // sur l'écran de lancement, son travail intact sur le serveur mais invisible.
    // On attend donc d'avoir un uid ; l'effet est rejoué quand il arrive.
    if (!uid || restoredRef.current) return;
    restoredRef.current = true;

    const applyDraft = (d, full) => {
      if (!d || !d.html) return;
      if (full) {
        dispatch(setOriginalContent(d.originalContent || ''));
        dispatch(setDiff(d.diff || []));
        dispatch(setSources(d.sources || []));
        dispatch(setAnalysis(d.analysis || ''));
        dispatch(setWpData(d.wpData || null));
        dispatch(setInternalLinks(d.internalLinks || []));
        dispatch(setAudit(d.audit || ''));
        // Avancement du parcours en quatre phases. C'est le chemin d'entrée le PLUS
        // fréquent — il se déclenche à chaque chargement de page — et l'oublier
        // ramenait le stepper à « phase 1 à faire » sur un article déjà généré,
        // en verrouillant les phases 2 à 4. Un brouillon antérieur ne porte pas
        // d'avancement : derivePhaseStatus le déduit alors de son contenu.
        // Artefacts des phases 1 à 3 : sans eux les panneaux se rouvraient vides.
        if (d.auditJson) dispatch(setAuditJson(d.auditJson));
        if (d.qatArticle) dispatch(setQatArticle(d.qatArticle));
        if (d.obsolescenceReport) dispatch(setObsolescenceReport(d.obsolescenceReport));
        const statuts = derivePhaseStatus({
          phaseStatus: d.phaseStatus,
          audit:       d.audit,
          auditJson:   d.auditJson,
          qatArticle:  d.qatArticle,
          obsolescenceReport: d.obsolescenceReport,
          diff:        d.diff,
        });
        dispatch(restorePhaseStatus(statuts));
        dispatch(setPhase(maxReachablePhase(statuts)));
        if (d.majScope) dispatch(setMajScope(d.majScope));
        dispatch(setCurrentArticleId(d.currentArticleId || null));
        if (d.tokenUsage) dispatch(setTokenUsage(d.tokenUsage));
        if (d.instruction) dispatch(setAgentInstruction(d.instruction));
      }
      // Métadonnées d'édition (titre édité, SEO Meta, date MAJ, image à la une,
      // catégories) : rehydratées par ArticleResult — AUSSI au retour SPA
      // (full=false), car ses états locaux sont perdus au démontage.
      if (d.editorMeta) dispatch(setEditorMeta(d.editorMeta));
      dispatch(setUpdatedContent(d.html));
      dispatch(setStatus('done'));
    };

    // 1. Restauration locale instantanée
    const local = loadDraftLocal(uid);
    if (agent.status === 'idle' && local?.html) {
      applyDraft(local, true);
    } else if (agent.status === 'done' && local?.html
        && local.currentArticleId === agent.currentArticleId
        && (local.html !== agent.updatedContent || local.editorMeta)) {
      // Retour SPA : récupérer les éditions manuelles (contentRef) non reflétées
      // dans Redux — HTML édité ET métadonnées (titre, SEO, date, image, catégories)
      applyDraft(local, false);
    }

    // 2. Réconciliation distante (cache vidé / autre appareil) — si plus récent
    loadDraftRemote(uid).then((remote) => {
      // `agentRef.current` (pas `agent`) : à ce moment, l'utilisateur a pu déjà
      // auditer/générer pendant que ce fetch était en vol.
      if (remote?.html && agentRef.current.status === 'idle'
          && (remote.savedAt || 0) > (local?.savedAt || 0)) {
        applyDraft(remote, true);
      }
    });
  }, [authUid, authUsername]); // eslint-disable-line react-hooks/exhaustive-deps

  // Un skill cerveau (SKILL.md actif) est requis par le mode QAT : il porte la
  // méthode d'audit et les gabarits de rédaction.
  const hasBrainSkill = (skills || []).some(k => k?.format === 'skillmd' && k?.body && k?.active !== false);

  // Le skill cerveau porte la méthode d'audit : sans lui, le parcours n'a plus de
  // règles à appliquer. Il est donc requis, et non plus seulement pour un mode.
  const canRun = (settings.aiConfigured || settings.useLocalProxy || settings.anthropicKey)
    && (tab === TAB_URL ? url.trim() : text.trim())
    && targetKeyword.trim()
    && hasBrainSkill;

  // Un bouton grisé muet est un cul-de-sac : on nomme ce qui manque, au survol du
  // bouton comme sous le formulaire. Même ordre que `canRun` ci-dessus.
  const raisonsBlocage = [
    ...(!(settings.aiConfigured || settings.useLocalProxy || settings.anthropicKey) ? ['clé API Anthropic'] : []),
    ...(!(tab === TAB_URL ? url.trim() : text.trim()) ? [tab === TAB_URL ? 'URL de l\'article' : 'contenu de l\'article'] : []),
    ...(!targetKeyword.trim() ? ['mot-clé cible'] : []),
    ...(!hasBrainSkill ? ['skill cerveau actif'] : []),
  ];

  const handleRun = async () => {
    if (!settings.aiConfigured && !settings.useLocalProxy && !settings.anthropicKey) {
      toast.error('Clé API Anthropic manquante — vérifiez les Paramètres');
      return;
    }
    // Verrou : une analyse tourne déjà (ici ou lancée en interactif depuis la
    // file) → un nouveau lancement écraserait sa progression ET son résultat.
    if (agent.status === 'running') {
      toast.error('Une analyse est déjà en cours — attendez la fin avant d\'en lancer une nouvelle');
      return;
    }

    // Nouvelle MAJ → on abandonne tout brouillon précédent
    clearDraft(authUid || authUsername || null);
    dispatch(resetAgent());
    dispatch(setStatus('running'));

    // URL de l'article : celle de l'onglet URL, ou celle (optionnelle) saisie en
    // mode collage. Unifie publication ciblée, suivi SEO, verrou liens, historique.
    const articleUrl = (tab === TAB_URL ? url : pasteUrl).trim();

    // ── Tracking du temps de travail : démarre AU LANCEMENT de l'analyse ────────
    // L'id Firestore n'existe pas encore → les minutes s'accumulent en buffer et
    // seront créditées à assignArticle() après la sauvegarde (fin de passe 1).
    articleTimeTracker.begin({
      articleId: null,
      url:       articleUrl,
      userId:    authUid || authUsername,
      userName:  [authPrenom, authNom].filter(Boolean).join(' ') || authUsername || '',
      userRole:  authRole || '',
    });

    let articleContent   = '';    // texte brut → envoyé à Claude pour l'audit
    let articleHtml      = '';    // HTML structuré → affiché dans l'UI (tableaux, titres…)
    let prefetchedWpData = null;  // données WP déjà récupérées — évite un 2e appel MCP

    if (tab === TAB_URL) {
      setScraping(true);
      dispatch(setProgress(5));

      // ── MCP : si l'URL correspond à un site WP configuré, lire via l'API REST ──
      // Bypass du scraping → contourne les protections anti-bot (Cloudflare, etc.)
      let wpFetched = false;
      try {
        const articleHostname = new URL(url).hostname.replace(/^www\./, '');
        const matchingSite = wpSites.find(site => {
          try { return new URL(site.url).hostname.replace(/^www\./, '') === articleHostname; }
          catch { return false; }
        });
        if (matchingSite) {
          dispatch(addStep('Connexion WordPress MCP — lecture de l\'article...'));
          const resp = await axios.post('/api/wp-tool', {
            toolName: 'wp_get_post',
            toolInput: { site_id: matchingSite.id, post_url: url },
            wpSites: [matchingSite],
          }, { timeout: 25000 });
          if (resp.data.success && resp.data.result?.content) {
            const r = resp.data.result;
            articleHtml    = r.content;
            articleContent = r.content;
            // Stocker immédiatement les données WP (image à la une incluse)
            // sans attendre la fin de l'agent — la barre image s'affiche dès le début
            prefetchedWpData = {
              siteId:          matchingSite.id,
              siteName:        matchingSite.name,
              postId:          r.post_id,
              postType:        r.post_type || 'posts',
              featuredMediaId: r.featured_media_id  || null,
              featuredMediaUrl:r.featured_media_url || null,
              postLink:        r.link || null,
              wpTitle:         r.title || '',
              categories:      r.categories || [],  // IDs des catégories actuelles de l'article
              tags:            r.tags       || [],  // IDs des tags actuels
              siteFonts:       r.site_fonts || [],  // polices déclarées sur le site (sélecteur de police)
            };
            dispatch(setWpData(prefetchedWpData));
            // Cache des polices du site → réutilisées à la réouverture depuis l'historique (sans requête)
            const detectedFonts = r.site_fonts || [];
            dispatch(cacheSiteFonts({ siteId: matchingSite.id, fonts: detectedFonts }));
            // Persistance Firestore (survit au vidage du cache) — uniquement si changé
            if (detectedFonts.length && JSON.stringify(detectedFonts) !== JSON.stringify(matchingSite.fonts || [])) {
              saveSiteFonts(matchingSite.id, detectedFonts).catch(() => {});
            }
            dispatch(addStep(`WordPress MCP OK — article lu directement (ID ${r.post_id})`));
            wpFetched = true;
          }
        }
      } catch { /* non-fatal : on retombe sur le scraping */ }

      // ── Fallback : scraping classique ────────────────────────────────────────
      if (!wpFetched) {
        dispatch(addStep('Récupération de l\'article via l\'URL...'));
        const result = await scrapeUrl(url);
        setScraping(false);
        if (!result.success) {
          toast.error(result.error, { duration: 6000 });
          dispatch(setError(result.error));
          return;
        }
        articleHtml    = result.content;
        articleContent = result.textContent || result.content;
        dispatch(addStep('Article récupéré avec succès !'));
      } else {
        setScraping(false);
      }
    } else {
      articleContent = text;
      articleHtml    = text;
      dispatch(addStep('Article chargé depuis le texte collé.'));
      dispatch(setProgress(5));
    }

    // ── POINT DE PASSAGE UNIQUE des trois sources ─────────────────────────────
    // WordPress MCP, scraping, collage manuel : tout converge ici. Les boutons de
    // suivi Google (« Discover », « Ajouter comme source préférée ») sont retirés
    // à cet endroit précis, et nulle part ailleurs.
    //
    // Le corriger dans le scraper seul ne servait à rien : un article WordPress
    // connecté est lu par l'API (branche `wpFetched` ci-dessus) et NE PASSE PAS
    // par le scraping — c'était justement le cas qui échouait. Mesuré en prod :
    // « [refonte] 2 lien(s) externe(s) d'origine INTROUVABLE(s) → génération à
    // rejeter », le verrou refusant les 3 essais puisqu'il exige de reproduire
    // tout lien externe de l'original, boutons Google compris.
    //
    // Le verrou n'est pas touché : c'est ce qu'il voit comme « original » qu'on
    // corrige, en amont de lui.
    const ingestion = stripNonEditorialLinks(articleHtml);
    if (ingestion.removed.length) {
      dispatch(addStep(`${ingestion.removed.length} bouton(s) de suivi Google retiré(s) du contenu`));
      console.warn('[ingestion] liens non éditoriaux retirés :', ingestion.removed);
    }
    articleHtml    = ingestion.html;
    articleContent = stripNonEditorialUrlsFromText(articleContent);

    // originalContent stocke le HTML → affiché avec mise en page préservée
    dispatch(setOriginalContent(articleHtml));

    // ── Titre de l'article : DÉDUIT ici, jamais saisi ─────────────────────────
    // Cet écran ne demande pas de titre — il le tire du H1 de l'article récupéré
    // (WordPress MCP, scraping ou collage), avec repli sur le slug d'URL. Ajouter
    // un champ n'aurait rien fiabilisé : on ferait retaper une valeur que l'on
    // connaît déjà, et le vrai titre reste éditable dans l'éditeur après l'audit.
    // La règle « titre obligatoire » se traduit donc ici par « titre déduit NON
    // VIDE » : sans titre, l'audit n'a pas de H1 à confronter au mot-clé cible.
    // (Le mot-clé, lui, est saisi et déjà exigé par `canRun`.)
    const extractH1 = (html) => {
      try {
        const tmp = document.createElement('div');
        tmp.innerHTML = html;
        return tmp.querySelector('h1')?.textContent?.trim() || '';
      } catch { return ''; }
    };
    const articleTitle = (extractH1(articleHtml)
      || (articleUrl ? (articleUrl.replace(/\/$/, '').split('/').pop() || articleUrl)
                     : articleContent.substring(0, 60) + '...')).trim();
    if (!articleTitle) {
      // Même traitement qu'un scraping en échec : message + sortie, sans lancer
      // l'appel IA (qui auditerait un article sans titre).
      const msg = 'Titre de l\'article introuvable — le contenu récupéré n\'a ni H1 ni URL exploitable. Vérifiez l\'URL ou collez le contenu complet.';
      toast.error(msg, { duration: 6000 });
      dispatch(setError(msg));
      return;
    }

    try {
      // PHASE 1 — AUDIT SEUL. La génération est désormais une étape distincte,
      // déclenchée par le rédacteur en phase 2 une fois l'audit lu : c'est tout
      // l'objet du découpage en quatre phases. Le lancement ne produit donc aucun
      // texte, et ne coûte qu'un appel d'audit au lieu de deux.
      const result = await runQatAudit({
        content: articleContent,
        contentHtml: articleHtml,
        skills,
        knowledge,
        articleUrl,
        targetKeyword:  targetKeyword.trim(),
        articleType,
        seoPlugin,
        targetWords,
        internalLinks:  cleanLinkRows(linkRows),
        wpSites,
        existingWpData: prefetchedWpData,
        modelPricing:   settings.modelPricing || null,
        onStep:     (s) => dispatch(addStep(s)),
        onReplace:  (s) => dispatch(replaceLastStep(s)),
        onProgress: (p) => dispatch(setProgress(p)),
        // Rédaction en direct : seule la fin du texte est conservée (400 car.),
        // c'est tout ce que l'affichage montre.
        onDelta:    (text, chars) => dispatch(setLiveText({ tail: text.slice(-400), chars })),
      });
      dispatch(clearLiveText());
      dispatch(setWpData(result.wpData || null));
      dispatch(setAuditJson(result.audit || null));
      dispatch(setQatArticle(null));      // rien n'est encore généré

      // L'éditeur travaille sur `updatedContent`. Tant que la phase 2 n'a pas
      // tourné, c'est l'article D'ORIGINE, inchangé : le rédacteur voit le texte
      // réel sur lequel porte l'audit, plutôt qu'un écran vide.
      const updatedHtml = articleHtml;
      const appliedUpdates = [];
      dispatch(setUpdatedContent(updatedHtml));
      dispatch(setDiff([]));
      dispatch(setSources(result.sources || []));
      // `executive_summary` vient d'un JSON libre : un objet ou un tableau ferait
      // planter renderMarkdown (text.trimStart).
      const rawSummary = result.audit?.executive_summary;
      const analysisText = typeof rawSummary === 'string'
        ? rawSummary
        : rawSummary ? JSON.stringify(rawSummary) : '';
      // L'audit markdown du flux historique n'existe plus : l'audit vit dans
      // `auditJson` (objet structuré), consulté en phase 1.
      const auditMarkdown = '';
      dispatch(setAnalysis(analysisText));
      dispatch(setParseFailed(result.parseFailed === true));
      dispatch(setInternalLinks(result.internalLinks || []));
      dispatch(setInternalLinksInfo(result.internalLinksInfo || null));
      dispatch(setAgentTargetKeyword(targetKeyword.trim()));
      dispatch(setAgentMajDepth(majDepth));
      // SEULE la phase 1 est terminée. Le parcours s'ouvre sur la phase 2, où le
      // rédacteur tranche l'ampleur et lance la génération.
      dispatch(setPhaseStatus({ phase: PHASE_AUDIT, status: DONE }));
      dispatch(setPhase(PHASE_GENERATION));
      dispatch(setMajScope(null));
      dispatch(setAudit(auditMarkdown));
      dispatch(setStatus('done'));

      // Save to history — `articleTitle` (H1, jamais le slug d'URL) est déduit et
      // vérifié NON VIDE avant le lancement, plus haut dans cette fonction.
      const articleData = {
        title: articleTitle,
        originalContent: articleHtml,   // HTML pour affichage fidèle (tableaux, titres…)
        updatedContent: updatedHtml,
        updates: result.updates || [],
        sources: result.sources || [],
        analysis: analysisText,
        audit: auditMarkdown,   // persiste le rapport d'audit markdown (flux historique)
        url: articleUrl,
        keyword: targetKeyword.trim(),  // mot-clé cible → focus keyphrase à la publication
        majDepth,                       // profondeur choisie — réutilisée par la phase 3
        // Avancement : seule la phase 1 est faite, l'article se rouvrira en phase 2.
        phaseStatus: { [PHASE_AUDIT]: DONE },
        // Audit structuré, consultable à la réouverture. `qatArticle` (titre SEO,
        // méta-description, chapô, ampleur appliquée) naît en PHASE 2 : au sortir
        // du lancement il n'existe pas encore.
        ...{
          auditJson: result.audit || null,
          qatArticle: null,
          // Brief de lancement : sans lui, impossible de rejouer une MAJ QAT à
          // l'identique (le type d'article et le maillage ne vivaient que dans
          // l'état local de cette page et disparaissaient au démontage).
          qatBrief: { articleType, seoPlugin, targetWords, internalLinks: cleanLinkRows(linkRows) },
        },
        createdAt: new Date().toISOString(),
        tokenUsage: result.tokenUsage || null,
        assigneeId: authUid || authUsername || null,
      };

      let savedId;
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
          dispatch(setCurrentArticleId(id));
          savedId = id;
        } catch (e) {
          const localId = Date.now().toString();
          dispatch(addToHistory({ ...articleData, id: localId }));
          dispatch(setCurrentArticleId(localId));
          savedId = localId;
        }
      } else {
        const localId = Date.now().toString();
        dispatch(addToHistory({ ...articleData, id: localId }));
        dispatch(setCurrentArticleId(localId));
        savedId = localId;
      }

      tracker.trackAction('articlesUpdated');
      // L'article a maintenant un id → créditer les minutes bufferisées de l'analyse
      articleTimeTracker.assignArticle(savedId, { title: articleTitle, url: articleUrl });

      // ── Suivi SEO Haloscan — snapshot J+0 ───────────────────────────────────
      // targetKeyword = mot-clé principal (toujours en tête)
      // seoKeywords   = mots-clés secondaires optionnels ajoutés dans "Suivi SEO"
      const trackingKeywords = [targetKeyword.trim(), ...seoKeywords].filter(Boolean);
      if (trackingKeywords.length > 0 && savedId && firebaseReady && (settings.haloscanConfigured || settings.haloscanKey)) {
        const now    = Date.now();
        const DAY_MS = 86400000;
        // Initialisé avant le try pour que le badge "En attente J+7" s'affiche
        // même si les appels distants échouent silencieusement.
        const capturedSeoTracking = {
          enabled:          true,
          keywords:         trackingKeywords,
          articleUrl:       articleUrl || '',
          snapshots:        [],
          nextSnapshotType: 'after_7d',
          nextSnapshotAt:   now + 7 * DAY_MS,
          completed:        false,
        };
        try {
          await initArticleSeoTracking(savedId, { keywords: trackingKeywords, articleUrl });
          if (articleUrl) {
            const resp = await axios.post('/api/haloscan/check', { keywords: trackingKeywords, articleUrl });
            if (resp.data?.success) {
              const snap = { type: 'before', capturedAt: now, results: resp.data.results || [] };
              await saveSeoSnapshot(savedId, snap);
              capturedSeoTracking.snapshots = [snap];
            }
          }
        } catch { /* non bloquant */ }
        // Propager seoTracking dans Redux → badge visible dans Historique
        dispatch(updateInHistory({ id: savedId, seoTracking: capturedSeoTracking }));
        setSeoKeywords([]);
        setSeoKwInput('');
      }
      if (result.tokenUsage) {
        dispatch(setTokenUsage(result.tokenUsage));
        dispatch(addArticleStat({
          id: savedId,
          title: articleTitle,
          inputTokens: result.tokenUsage.input,
          outputTokens: result.tokenUsage.output,
          costUsd: result.tokenUsage.costUsd,
          createdAt: new Date().toISOString(),
          assigneeId: authUid || authUsername || null,
          pass: 1,
        }));
      }

      const total = result.updates?.length || 0;
      const applied = appliedUpdates.length;
      if (applied === total && total > 0) {
        toast.success(`${applied} modification${applied > 1 ? 's' : ''} appliquée${applied > 1 ? 's' : ''} dans l'article !`);
      } else if (total > 0) {
        toast.success(`${applied}/${total} modifications affichées (${total - applied} non localisées dans le texte)`);
      }
      // Si 0 modifications : pas de toast — l'analyse reste visible, l'utilisateur peut lancer une passe 2
    } catch (e) {
      console.error(e);
      dispatch(setError(e.message));
      toast.error('Erreur de l\'agent : ' + e.message);
    }
  };

  const handleReset = () => {
    clearDraft(authUid || authUsername || null);
    dispatch(resetAgent());
    setUrl('');
    setText('');
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Articles</h1>
          <p className="text-sm text-gray-500 mt-1">Mise à jour d'article avec l'agent IA TONTON</p>
        </div>
        {agent.status === 'done' && (
          <motion.button
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            onClick={handleReset}
            className="btn-secondary"
          >
            Nouvel article
          </motion.button>
        )}
      </div>

      <AnimatePresence mode="wait">
        {/* Input phase */}
        {agent.status === 'idle' && (
          <motion.div
            key="input"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="space-y-6"
          >
            {/* Tab selector */}
            <div className="glass-card p-6 space-y-5">
              <div className="flex gap-2 bg-gray-100 p-1 rounded-xl w-fit">
                <button
                  onClick={() => setTab(TAB_URL)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${tab === TAB_URL ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
                >
                  <Link2 size={15} />
                  Lien URL
                </button>
                <button
                  onClick={() => setTab(TAB_TEXT)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${tab === TAB_TEXT ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
                >
                  <FileText size={15} />
                  Copier-coller
                </button>
              </div>

              <AnimatePresence mode="wait">
                {tab === TAB_URL ? (
                  <motion.div
                    key="url"
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 10 }}
                    className="space-y-2"
                  >
                    <label className="text-sm font-medium text-gray-700">URL de l'article</label>
                    <input
                      type="url"
                      value={url}
                      onChange={e => setUrl(e.target.value)}
                      placeholder="https://example.com/mon-article"
                      className="input-glass"
                      onKeyDown={e => e.key === 'Enter' && canRun && handleRun()}
                    />
                    <p className="text-xs text-gray-400">
                      L'agent va récupérer le contenu complet de la page mot par mot.
                    </p>
                  </motion.div>
                ) : (
                  <motion.div
                    key="text"
                    initial={{ opacity: 0, x: 10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -10 }}
                    className="space-y-2"
                  >
                    <label className="text-sm font-medium text-gray-700">Contenu de l'article</label>
                    <textarea
                      value={text}
                      onChange={e => setText(e.target.value)}
                      placeholder="Collez ici le contenu complet de votre article..."
                      className="input-glass resize-none"
                      rows={10}
                    />
                    <p className="text-xs text-gray-400">
                      {text.length > 0 ? `${text.split(/\s+/).length} mots` : 'Collez votre article complet pour une analyse optimale.'}
                    </p>

                    {/* URL du post original (optionnel) — cible la publication + active le suivi SEO */}
                    <div className="pt-1 space-y-1.5">
                      <label className="flex items-center gap-1.5 text-sm font-medium text-gray-700">
                        <Link2 size={13} className="text-gray-400" />
                        URL du post original
                        <span className="text-xs font-normal text-gray-400 ml-1">(optionnel)</span>
                      </label>
                      <input
                        type="url"
                        value={pasteUrl}
                        onChange={e => setPasteUrl(e.target.value)}
                        placeholder="https://exemple.com/mon-article"
                        className="input-glass"
                      />
                      <p className="text-xs text-gray-400">
                        Renseignez-la pour <strong>publier la MAJ sur le bon post</strong> et <strong>activer le suivi SEO</strong>. Le contenu collé est conservé (aucun re-téléchargement).
                      </p>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* ── Mot-clé cible (optionnel) ─────────────────────────────────────── */}
              <div className="space-y-1.5">
                <label className="flex items-center gap-1.5 text-sm font-medium text-gray-700">
                  <Tag size={13} className="text-gray-400" />
                  Mot-clé cible
                  <span className="text-xs font-normal text-red-400 ml-1">*</span>
                </label>
                <input
                  type="text"
                  value={targetKeyword}
                  onChange={e => setTargetKeyword(e.target.value)}
                  placeholder="ex: isolation toiture thermique"
                  className="input-glass text-sm"
                />
                <p className="text-[11px] text-gray-400">
                  {targetKeyword.trim()
                    ? <span className="text-sage-600"><CheckCircle2 size={13} className="inline text-sage-600 shrink-0" /> L'IA optimisera l'article autour de ce mot-clé (H1/H2, intro, densité sémantique).</span>
                    : 'Requis — TONTON AI l\'utilisera pour orienter toute la MAJ SEO.'}
                </p>
              </div>

              {/* ── Notes — instruction pour TONTON (optionnel) ──────────────────── */}
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-gray-700">Notes — instruction pour TONTON</label>
                <textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  placeholder="Consigne appliquée en priorité par l'IA pendant l'analyse — ex. « concentre la MAJ sur la partie prix », « ajoute des idées sur les nouveautés 2026 »…"
                  rows={3}
                  className="input-glass text-sm resize-none"
                />
              </div>

              {/* ── Brief du mode « Audit QAT + Refonte » ─────────────────────────── */}
              <AnimatePresence>
                {(
                  <QatBriefFields
                    articleType={articleType} setArticleType={setArticleType}
                    seoPlugin={seoPlugin} setSeoPlugin={setSeoPlugin}
                    targetWords={targetWords} setTargetWords={setTargetWords}
                    linkRows={linkRows} setLinkRows={setLinkRows}
                    hasBrainSkill={hasBrainSkill}
                    articleUrl={url}
                  />
                )}
              </AnimatePresence>

              {!settings.anthropicKey && !settings.aiConfigured && !settings.useLocalProxy && (
                <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-700">
                  <AlertCircle size={15} />
                  <span>Clé API Anthropic requise — <a href="/parametres" className="underline font-medium">Paramètres</a></span>
                </div>
              )}

              {/* ── Suivi SEO Haloscan (optionnel) — visible uniquement si clé configurée ── */}
              {(settings.haloscanConfigured || settings.haloscanKey) && (
                <div className="border border-emerald-100 bg-emerald-50/50 rounded-xl p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <TrendingUp size={14} className="text-emerald-600" />
                    <span className="text-sm font-medium text-emerald-800">Mots-clés secondaires</span>
                    <span className="text-xs text-emerald-500 ml-auto">optionnel · max 3</span>
                  </div>

                  {/* Liste mots-clés ajoutés */}
                  {seoKeywords.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {seoKeywords.map((kw, i) => (
                        <span key={i} className="inline-flex items-center gap-1.5 bg-emerald-100 text-emerald-800 text-xs font-medium px-3 py-1 rounded-full">
                          {kw}
                          <button
                            type="button"
                            onClick={() => setSeoKeywords(prev => prev.filter((_, j) => j !== i))}
                            className="text-emerald-500 hover:text-emerald-800 transition-colors"
                          >
                            <XIcon size={11} />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Input nouveau mot-clé */}
                  {seoKeywords.length < 3 && (
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={seoKwInput}
                        onChange={e => setSeoKwInput(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter' && seoKwInput.trim()) {
                            e.preventDefault();
                            setSeoKeywords(prev => [...prev, seoKwInput.trim()]);
                            setSeoKwInput('');
                          }
                        }}
                        placeholder="ex: choisir un bon VPN"
                        className="input-glass text-sm flex-1 !py-2"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          if (seoKwInput.trim()) {
                            setSeoKeywords(prev => [...prev, seoKwInput.trim()]);
                            setSeoKwInput('');
                          }
                        }}
                        disabled={!seoKwInput.trim()}
                        className="btn-secondary !py-2 !px-3 text-xs disabled:opacity-40"
                      >
                        <Plus size={13} />
                      </button>
                    </div>
                  )}
                  <p className="text-[11px] text-emerald-600">
                    Le mot-clé cible est tracké automatiquement. Ajoutez ici des variantes longue traîne.
                  </p>
                </div>
              )}

              {/* Ce qui bloque le lancement, écrit noir sur blanc sous le bouton */}
              {!canRun && raisonsBlocage.length > 0 && (
                <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 flex items-start gap-2">
                  <AlertCircle size={13} className="flex-shrink-0 mt-0.5" />
                  <span>À renseigner avant de lancer : <strong>{raisonsBlocage.join(', ')}</strong>.</span>
                </p>
              )}

              <motion.button
                onClick={handleRun}
                disabled={!canRun || scraping}
                title={canRun
                  ? 'Lancer l\'audit de l\'article (phase 1)'
                  : `Lancement impossible — il manque : ${raisonsBlocage.join(', ')}`}
                whileHover={{ scale: canRun ? 1.01 : 1 }}
                whileTap={{ scale: canRun ? 0.99 : 1 }}
                className="btn-primary w-full justify-center py-3 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Sparkles size={16} />
                {scraping ? 'Récupération en cours...' : 'Lancer l\'analyse IA'}
                <ChevronRight size={15} />
              </motion.button>
            </div>

            {/* Skills + Knowledge summary */}
            {(skills.length > 0 || knowledge.length > 0) && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex items-center gap-3 px-4 py-3 bg-white/50 rounded-xl border border-gray-100 text-sm text-gray-500 flex-wrap"
              >
                <Sparkles size={14} className="text-gray-400" />
                {skills.length > 0 && (
                  <span>{skills.length} skill{skills.length > 1 ? 's' : ''} actif{skills.length > 1 ? 's' : ''}</span>
                )}
                {skills.length > 0 && knowledge.filter(k => k.content).length > 0 && (
                  <span className="text-gray-300">·</span>
                )}
                {knowledge.filter(k => k.content).length > 0 && (
                  <span>{knowledge.filter(k => k.content).length} doc{knowledge.filter(k => k.content).length > 1 ? 's' : ''} de référence</span>
                )}
              </motion.div>
            )}
          </motion.div>
        )}

        {/* Running phase */}
        {agent.status === 'running' && (
          <motion.div key="running">
            <AgentThinking
              steps={agent.steps}
              currentStep={agent.currentStep}
              progress={agent.progress}
              status={agent.status}
              liveTail={agent.liveTail}
              liveChars={agent.liveChars}
            />
          </motion.div>
        )}

        {/* Error phase */}
        {agent.status === 'error' && (
          <motion.div
            key="error"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="glass-card p-6"
          >
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 bg-red-50 rounded-xl flex items-center justify-center flex-shrink-0">
                <AlertCircle size={20} className="text-red-500" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-gray-900 mb-1">Erreur</h3>
                <p className="text-sm text-gray-600">{agent.error}</p>
                <button onClick={handleReset} className="btn-primary mt-4">
                  Réessayer
                </button>
              </div>
            </div>
          </motion.div>
        )}

        {/* Result phase */}
        {agent.status === 'done' && (
          <motion.div key="result" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
            <ArticleResult />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
