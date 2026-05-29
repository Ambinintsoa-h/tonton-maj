import { useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { motion, AnimatePresence } from 'framer-motion';
import toast from 'react-hot-toast';
import { Link2, FileText, Sparkles, ChevronRight, AlertCircle } from 'lucide-react';
import { resetAgent, setStatus, addStep, replaceLastStep, setProgress, setOriginalContent, setUpdatedContent, setDiff, setSources, setAnalysis, setError, setCurrentArticleId, setTokenUsage, setParseFailed, setWpData } from '../store/slices/agentSlice';
import { addToHistory } from '../store/slices/articlesSlice';
import { addArticleStat } from '../store/slices/statsSlice';
import axios from 'axios';
import { scrapeUrl } from '../services/scraper';
import { runAgent } from '../services/agent';
import { saveArticle } from '../services/firebase';
import AgentThinking from '../components/agent/AgentThinking';
import ArticleResult from '../components/agent/ArticleResult';
import { applyAllDiffs } from '../utils/diff';

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

  const [tab, setTab] = useState(TAB_URL);
  const [url, setUrl] = useState('');
  const [text, setText] = useState('');
  const [scraping, setScraping] = useState(false);
  const canRun = (settings.aiConfigured || settings.useLocalProxy || settings.anthropicKey) && (tab === TAB_URL ? url.trim() : text.trim());

  const handleRun = async () => {
    if (!settings.aiConfigured && !settings.useLocalProxy && !settings.anthropicKey) {
      toast.error('Clé API Anthropic manquante — vérifiez les Paramètres');
      return;
    }

    dispatch(resetAgent());
    dispatch(setStatus('running'));

    let articleContent   = '';    // texte brut → envoyé à Claude + applyAllDiffs
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
            // sans attendre la fin de runAgent — la barre image s'affiche dès le début
            prefetchedWpData = {
              siteId:          matchingSite.id,
              siteName:        matchingSite.name,
              postId:          r.post_id,
              postType:        r.post_type || 'posts',
              featuredMediaId: r.featured_media_id  || null,
              featuredMediaUrl:r.featured_media_url || null,
              postLink:        r.link || null,
              wpTitle:         r.title || '',   // titre réel WP (pas le slug)
            };
            dispatch(setWpData(prefetchedWpData));
            dispatch(addStep(`WordPress MCP ✓ — article lu directement (ID ${r.post_id})`));
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

    // originalContent stocke le HTML → affiché avec mise en page préservée
    dispatch(setOriginalContent(articleHtml));

    try {
      const result = await runAgent({
        content: articleContent,   // texte brut pour Claude
        skills,
        knowledge,
        articleUrl:      tab === TAB_URL ? url : '',
        wpSites,
        existingWpData:  prefetchedWpData,  // évite un 2e appel WP MCP dans runAgent
        modelPricing:    settings.modelPricing || null,
        onStep:     (s) => dispatch(addStep(s)),
        onReplace:  (s) => dispatch(replaceLastStep(s)),
        onProgress: (p) => dispatch(setProgress(p)),
      });
      if (result.wpData) dispatch(setWpData(result.wpData));

      // ── Application des diffs via utils/diff ─────────────────────────────
      // On applique les diffs sur le HTML structuré (articleHtml) pour préserver
      // la mise en page originale : tableaux, titres, listes…
      const { html: rawHtml, updates: allUpdatesWithStatus } = applyAllDiffs(articleHtml, result.updates, 1);

      // Conversion \n→<br> uniquement si le contenu n'a pas déjà une structure
      // de blocs HTML (<p>, <h1-6>, <table>, <ul>, <ol>).
      // Cas couverts :
      //   - HTML riche de Readability → pas de conversion (les <p> gèrent les espacements)
      //   - Texte brut de Jina / coller manuel → conversion pour afficher les sauts de ligne
      //   - HTML pauvre (Readability sans <p>) → conversion pour éviter le mur de texte
      const hasBlockStructure = /<(p|h[1-6]|table|ul|ol)\b[^>]*>/i.test(rawHtml);
      const updatedHtml = hasBlockStructure ? rawHtml : rawHtml.replace(/\n/g, '<br>');

      const appliedUpdates = allUpdatesWithStatus.filter(u => u.applied);
      dispatch(setUpdatedContent(updatedHtml));
      // Stocker TOUS les updates avec leur statut (applied/non-applied)
      dispatch(setDiff(allUpdatesWithStatus));
      dispatch(setSources(result.sources || []));
      dispatch(setAnalysis(result.analysis || ''));
      dispatch(setParseFailed(result.parseFailed === true));
      dispatch(setStatus('done'));

      // Save to history — extraire le H1 comme titre (pas le slug d'URL)
      const extractH1 = (html) => {
        try {
          const tmp = document.createElement('div');
          tmp.innerHTML = html;
          return tmp.querySelector('h1')?.textContent?.trim() || '';
        } catch { return ''; }
      };
      const articleTitle = tab === TAB_URL
        ? (extractH1(articleHtml) || url.replace(/\/$/, '').split('/').pop() || url)
        : (extractH1(articleHtml) || articleContent.substring(0, 60) + '...');
      const articleData = {
        title: articleTitle,
        originalContent: articleHtml,   // HTML pour affichage fidèle (tableaux, titres…)
        updatedContent: updatedHtml,
        updates: result.updates || [],
        sources: result.sources || [],
        analysis: result.analysis || '',
        url: tab === TAB_URL ? url : '',
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
                  </motion.div>
                )}
              </AnimatePresence>

              {!settings.anthropicKey && !settings.aiConfigured && !settings.useLocalProxy && (
                <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-700">
                  <AlertCircle size={15} />
                  <span>Clé API Anthropic requise — <a href="/parametres" className="underline font-medium">Paramètres</a></span>
                </div>
              )}

              <motion.button
                onClick={handleRun}
                disabled={!canRun || scraping}
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
