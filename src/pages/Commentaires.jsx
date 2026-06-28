import { useState, useEffect, useCallback, useMemo } from 'react';
import { useSelector } from 'react-redux';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';
import {
  MessageSquare, Sparkles, Check, Ban, Trash2, RefreshCw, Loader2,
  ExternalLink, Inbox, ShieldAlert, AlertTriangle, Reply, Send, X,
} from 'lucide-react';
import { fetchComments, moderateComment, classifyComments, generateReply, publishReply } from '../services/comments';
import { getCommentAi, saveCommentAi, getCommentSettings, saveCommentSettings } from '../services/firebase';

// Onglets de statut. `filter` = valeur envoyée à l'API WP (verbe), `match` = valeurs
// possibles renvoyées par WP dans le champ status (WP renvoie 'approved' mais filtre 'approve').
const TABS = [
  { key: 'hold',    label: 'En attente', filter: 'hold',    icon: Inbox },
  { key: 'approve', label: 'Approuvés',  filter: 'approve',  icon: Check },
  { key: 'spam',    label: 'Spam',       filter: 'spam',     icon: ShieldAlert },
  { key: 'trash',   label: 'Corbeille',  filter: 'trash',    icon: Trash2 },
];

const CAT_STYLE = {
  question:     'bg-blue-50 text-blue-700',
  'éloge':      'bg-emerald-50 text-emerald-700',
  critique:     'bg-amber-50 text-amber-700',
  spam:         'bg-gray-100 text-gray-600',
  toxique:      'bg-red-50 text-red-700',
  'hors-sujet': 'bg-violet-50 text-violet-700',
};
const SENTIMENT_STYLE = {
  positif: 'text-emerald-600',
  neutre:  'text-gray-500',
  'négatif': 'text-red-600',
};
const PRIORITY_STYLE = {
  haute:   'bg-red-100 text-red-700',
  moyenne: 'bg-amber-100 text-amber-700',
  basse:   'bg-gray-100 text-gray-500',
};

const fmtDate = (d) => {
  try { return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' }); }
  catch { return ''; }
};

export default function Commentaires() {
  const sites = useSelector(s => s.wordpress.sites) || [];

  const [siteId, setSiteId]     = useState(sites[0]?.id || '');
  const [tab, setTab]           = useState('hold');
  const [comments, setComments] = useState([]);
  const [ai, setAi]             = useState({});      // { [commentId]: { category, sentiment, priority, summary } }
  const [loading, setLoading]   = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [busyId, setBusyId]     = useState(null);    // commentaire en cours de modération
  const [error, setError]       = useState('');
  const [autoSpam, setAutoSpam] = useState(false);   // réglage par site : spam auto haute confiance

  // Phase 2 — réponses de marque (brouillon IA → édition humaine → publication).
  const [openReplyId, setOpenReplyId] = useState(null);   // commentaire dont la zone réponse est ouverte
  const [drafts, setDrafts]           = useState({});     // { [commentId]: texte du brouillon }
  const [replyGenId, setReplyGenId]   = useState(null);   // génération IA en cours
  const [publishingId, setPublishingId] = useState(null); // publication en cours

  const site = useMemo(() => sites.find(s => s.id === siteId), [sites, siteId]);

  // Charge le cache d'analyse IA + le réglage auto-spam quand le site change.
  useEffect(() => {
    if (!siteId) return;
    let cancelled = false;
    setOpenReplyId(null);
    getCommentAi(siteId).then(rows => {
      if (cancelled) return;
      const map = {}, savedDrafts = {};
      for (const r of rows) {
        map[r.commentId] = r;
        if (r.draftReply) savedDrafts[r.commentId] = r.draftReply;   // brouillon repris après reload
      }
      setAi(map);
      setDrafts(savedDrafts);
    }).catch(() => {});
    getCommentSettings(siteId)
      .then(s => { if (!cancelled) setAutoSpam(!!s.autoSpam); })
      .catch(() => { if (!cancelled) setAutoSpam(false); });
    return () => { cancelled = true; };
  }, [siteId]);

  // Active/désactive l'auto-spam pour le site courant (persisté côté Firestore).
  const toggleAutoSpam = useCallback(async (e) => {
    const next = e.target.checked;
    setAutoSpam(next);
    try { await saveCommentSettings(siteId, { autoSpam: next }); }
    catch { toast.error('Réglage non enregistré — réessaie.'); }
  }, [siteId]);

  // Charge les commentaires WordPress (site + onglet).
  const load = useCallback(async () => {
    if (!site) { setComments([]); return; }
    setLoading(true); setError('');
    try {
      const tabDef = TABS.find(t => t.key === tab);
      const rows = await fetchComments({ site, statuses: [tabDef.filter], perPage: 50 });
      setComments(rows);
    } catch (e) {
      setError(e.response?.data?.error || e.message || 'Erreur de chargement');
      setComments([]);
    } finally {
      setLoading(false);
    }
  }, [site, tab]);

  useEffect(() => { load(); }, [load]);

  // Tri IA des commentaires affichés non encore classés → cache Firestore.
  const analyze = useCallback(async () => {
    const todo = comments.filter(c => !ai[c.id]);
    if (!todo.length) { toast('Tous les commentaires affichés sont déjà analysés.'); return; }
    setAnalyzing(true);
    try {
      const map = await classifyComments(todo);
      if (!Object.keys(map).length) { toast.error('Analyse IA indisponible — réessaie.'); return; }
      setAi(prev => ({ ...prev, ...map }));
      // Persiste en parallèle (non bloquant pour l'UI)
      Promise.all(Object.entries(map).map(([cid, data]) =>
        saveCommentAi(siteId, cid, data).catch(() => {})
      ));
      toast.success(`${Object.keys(map).length} commentaire(s) analysé(s)`);

      // Auto-spam : seulement sur la file « En attente » et UNIQUEMENT pour le spam
      // détecté à HAUTE confiance — en cas de doute, on ne touche à rien. Réversible
      // (dossier Spam WP). Agit sur les commentaires fraîchement analysés.
      if (autoSpam && tab === 'hold' && site) {
        const targets = todo.filter(c => {
          const a = map[c.id];
          return a && a.category === 'spam' && a.confidence === 'haute';
        });
        if (targets.length) {
          const results = await Promise.allSettled(
            targets.map(c => moderateComment({ site, commentId: c.id, action: 'spam' }))
          );
          const okSet = new Set(targets.filter((_, i) => results[i].status === 'fulfilled').map(c => c.id));
          if (okSet.size) {
            setComments(prev => prev.filter(c => !okSet.has(c.id)));
            toast.success(`${okSet.size} commentaire(s) passé(s) en spam automatiquement`);
          }
        }
      }
    } finally {
      setAnalyzing(false);
    }
  }, [comments, ai, siteId, autoSpam, tab, site]);

  // Action de modération avec confirmation sur les actions destructives.
  const act = useCallback(async (comment, action) => {
    const destructive = action === 'spam' || action === 'trash';
    if (destructive) {
      const verb = action === 'spam' ? 'marquer comme spam' : 'mettre à la corbeille';
      if (!window.confirm(`Confirmer : ${verb} ce commentaire de ${comment.author} ?`)) return;
    }
    setBusyId(comment.id);
    try {
      await moderateComment({ site, commentId: comment.id, action });
      setComments(prev => prev.filter(c => c.id !== comment.id)); // disparaît de la vue courante
      const label = { approve: 'Approuvé', hold: 'Remis en attente', spam: 'Marqué spam', trash: 'Corbeille' }[action];
      toast.success(label);
    } catch (e) {
      toast.error(e.response?.data?.error || 'Action impossible');
    } finally {
      setBusyId(null);
    }
  }, [site]);

  // Ouvre la zone de réponse et génère un brouillon IA s'il n'en existe pas encore.
  const openReply = useCallback(async (comment) => {
    setOpenReplyId(comment.id);
    if (drafts[comment.id]) return;            // brouillon déjà présent (saisi ou repris du cache)
    setReplyGenId(comment.id);
    try {
      const text = await generateReply({ comment, siteName: site?.name || '' });
      if (!text) { toast.error('Génération IA indisponible — écris la réponse manuellement.'); return; }
      setDrafts(prev => ({ ...prev, [comment.id]: text }));
      saveCommentAi(siteId, comment.id, { draftReply: text }).catch(() => {});
    } finally {
      setReplyGenId(null);
    }
  }, [drafts, site, siteId]);

  // Régénère un brouillon (écrase le texte courant).
  const regenerate = useCallback(async (comment) => {
    setReplyGenId(comment.id);
    try {
      const text = await generateReply({ comment, siteName: site?.name || '' });
      if (!text) { toast.error('Génération IA indisponible.'); return; }
      setDrafts(prev => ({ ...prev, [comment.id]: text }));
      saveCommentAi(siteId, comment.id, { draftReply: text }).catch(() => {});
    } finally {
      setReplyGenId(null);
    }
  }, [site, siteId]);

  // Publie la réponse APRÈS confirmation explicite (publication de contenu public).
  const publish = useCallback(async (comment) => {
    const content = (drafts[comment.id] || '').trim();
    if (!content) { toast.error('Le brouillon est vide.'); return; }
    if (!window.confirm(`Publier cette réponse publiquement sous « ${comment.postTitle} » ?`)) return;
    setPublishingId(comment.id);
    try {
      await publishReply({ site, comment, content });
      saveCommentAi(siteId, comment.id, { draftReply: '', repliedAt: Date.now() }).catch(() => {});
      setOpenReplyId(null);
      setDrafts(prev => { const n = { ...prev }; delete n[comment.id]; return n; });
      toast.success('Réponse publiée');
    } catch (e) {
      toast.error(e.response?.data?.error || 'Publication impossible');
    } finally {
      setPublishingId(null);
    }
  }, [drafts, site, siteId]);

  // Mini-dashboard : répartition par sentiment / priorité sur le lot affiché et analysé.
  const stats = useMemo(() => {
    const s = { total: comments.length, positif: 0, neutre: 0, 'négatif': 0, haute: 0 };
    for (const c of comments) {
      const a = ai[c.id];
      if (!a) continue;
      if (s[a.sentiment] !== undefined) s[a.sentiment]++;
      if (a.priority === 'haute') s.haute++;
    }
    return s;
  }, [comments, ai]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="max-w-5xl mx-auto"
    >
      {/* En-tête */}
      <div className="flex items-center gap-3 mb-5">
        <div className="w-11 h-11 rounded-xl bg-violet-100 flex items-center justify-center flex-shrink-0">
          <MessageSquare size={22} className="text-violet-600" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-bold text-gray-900 tracking-tight">Commentaires</h1>
            <span className="text-[10px] font-bold uppercase tracking-wide bg-violet-500 text-white rounded-full px-2 py-0.5">
              Phase 1 · bêta
            </span>
          </div>
          <p className="text-sm text-gray-500 mt-0.5">Gestion &amp; modération des commentaires WordPress, assistée par l'IA.</p>
        </div>
      </div>

      {/* Barre site + actions */}
      <div className="glass-card p-4 flex items-center gap-3 flex-wrap">
        <select
          value={siteId}
          onChange={e => setSiteId(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-violet-200"
        >
          {sites.length === 0 && <option value="">Aucun site configuré</option>}
          {sites.map(s => <option key={s.id} value={s.id}>{s.name || s.url}</option>)}
        </select>

        <label
          className="inline-flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none"
          title="Passe automatiquement en spam les commentaires détectés spam à HAUTE confiance (réversible). En cas de doute, rien n'est touché."
        >
          <input
            type="checkbox"
            checked={autoSpam}
            onChange={toggleAutoSpam}
            disabled={!site}
            className="w-4 h-4 accent-violet-600 rounded disabled:opacity-50"
          />
          <ShieldAlert size={15} className={autoSpam ? 'text-violet-600' : 'text-gray-400'} />
          Auto-spam
        </label>

        <div className="flex-1" />

        <button
          onClick={load}
          disabled={loading || !site}
          className="inline-flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> Rafraîchir
        </button>
        <button
          onClick={analyze}
          disabled={analyzing || loading || comments.length === 0}
          className="inline-flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50"
        >
          {analyzing ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />} Analyser avec l'IA
        </button>
      </div>

      {/* Onglets statut */}
      <div className="flex items-center gap-1 mt-4 border-b border-gray-200">
        {TABS.map(t => {
          const Icon = t.icon;
          const on = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                on ? 'border-violet-600 text-violet-700' : 'border-transparent text-gray-500 hover:text-gray-800'
              }`}
            >
              <Icon size={15} /> {t.label}
            </button>
          );
        })}
      </div>

      {/* Mini-dashboard */}
      {comments.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
          <Stat label="Commentaires" value={stats.total} />
          <Stat label="Positifs" value={stats.positif} accent="text-emerald-600" />
          <Stat label="Négatifs" value={stats['négatif']} accent="text-red-600" />
          <Stat label="Priorité haute" value={stats.haute} accent="text-amber-600" />
        </div>
      )}

      {/* Liste */}
      <div className="mt-4 space-y-3">
        {loading && (
          <div className="glass-card p-8 flex items-center justify-center text-gray-400 gap-2">
            <Loader2 size={18} className="animate-spin" /> Chargement…
          </div>
        )}

        {!loading && error && (
          <div className="glass-card p-5 flex items-start gap-3 border-l-4 border-red-300">
            <AlertTriangle size={18} className="text-red-500 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-gray-700">
              <p className="font-semibold">Impossible de charger les commentaires</p>
              <p className="text-gray-500 mt-0.5">{error}</p>
              <p className="text-[12px] text-gray-400 mt-1">
                Vérifie que l'utilisateur Application Password du site a la capacité « modérer les commentaires ».
              </p>
            </div>
          </div>
        )}

        {!loading && !error && comments.length === 0 && (
          <div className="glass-card p-10 text-center text-gray-400">
            <Inbox size={28} className="mx-auto mb-2 opacity-60" />
            Aucun commentaire dans « {TABS.find(t => t.key === tab)?.label} ».
          </div>
        )}

        {!loading && comments.map(c => {
          const a = ai[c.id];
          const busy = busyId === c.id;
          return (
            <div key={c.id} className="glass-card p-4">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-gray-900 text-sm">{c.author}</span>
                    <span className="text-[12px] text-gray-400">{fmtDate(c.date)}</span>
                    {a && (
                      <>
                        <span className={`text-[10px] font-semibold uppercase tracking-wide rounded-full px-2 py-0.5 ${CAT_STYLE[a.category] || 'bg-gray-100 text-gray-600'}`}>
                          {a.category}
                        </span>
                        <span className={`text-[11px] font-medium ${SENTIMENT_STYLE[a.sentiment] || 'text-gray-500'}`}>
                          {a.sentiment}
                        </span>
                        <span className={`text-[10px] font-bold rounded px-1.5 py-0.5 ${PRIORITY_STYLE[a.priority] || 'bg-gray-100 text-gray-500'}`}>
                          {a.priority}
                        </span>
                      </>
                    )}
                  </div>
                  {c.postTitle && (
                    <a
                      href={c.postLink || undefined}
                      target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[12px] text-gray-400 hover:text-violet-600 mt-0.5"
                    >
                      sur « {c.postTitle} » <ExternalLink size={11} />
                    </a>
                  )}
                </div>
              </div>

              <p className="text-sm text-gray-700 mt-2 leading-relaxed whitespace-pre-line">{c.content}</p>
              {a?.summary && <p className="text-[12px] text-gray-400 italic mt-1">IA : {a.summary}</p>}

              <div className="flex items-center gap-2 mt-3 flex-wrap">
                {tab !== 'approve' && (
                  <ActionBtn onClick={() => act(c, 'approve')} busy={busy} icon={Check}
                    className="text-emerald-700 border-emerald-200 hover:bg-emerald-50">Approuver</ActionBtn>
                )}
                {tab !== 'hold' && tab !== 'spam' && (
                  <ActionBtn onClick={() => act(c, 'hold')} busy={busy} icon={Inbox}
                    className="text-gray-600 border-gray-200 hover:bg-gray-50">En attente</ActionBtn>
                )}
                {tab !== 'spam' && (
                  <ActionBtn onClick={() => act(c, 'spam')} busy={busy} icon={Ban}
                    className="text-gray-600 border-gray-200 hover:bg-gray-50">Spam</ActionBtn>
                )}
                {tab !== 'trash' && (
                  <ActionBtn onClick={() => act(c, 'trash')} busy={busy} icon={Trash2}
                    className="text-red-600 border-red-200 hover:bg-red-50">Corbeille</ActionBtn>
                )}
                {/* Répondre : seulement sur les commentaires réels (en attente / approuvés) */}
                {(tab === 'hold' || tab === 'approve') && openReplyId !== c.id && (
                  <ActionBtn onClick={() => openReply(c)} busy={replyGenId === c.id} icon={Reply}
                    className="text-violet-700 border-violet-200 hover:bg-violet-50">Répondre (IA)</ActionBtn>
                )}
              </div>

              {/* Zone de réponse — brouillon IA éditable, publication validée par l'humain */}
              {openReplyId === c.id && (
                <div className="mt-3 border-t border-gray-100 pt-3">
                  {replyGenId === c.id && !drafts[c.id] ? (
                    <div className="flex items-center gap-2 text-sm text-gray-400 py-3">
                      <Loader2 size={15} className="animate-spin" /> Rédaction du brouillon…
                    </div>
                  ) : (
                    <>
                      <textarea
                        value={drafts[c.id] || ''}
                        onChange={e => setDrafts(prev => ({ ...prev, [c.id]: e.target.value }))}
                        rows={4}
                        placeholder="Réponse de la marque…"
                        className="w-full text-sm border border-gray-200 rounded-lg p-2.5 focus:outline-none focus:ring-2 focus:ring-violet-200 resize-y"
                      />
                      <div className="flex items-center gap-2 mt-2 flex-wrap">
                        <button
                          onClick={() => publish(c)}
                          disabled={publishingId === c.id || !(drafts[c.id] || '').trim()}
                          className="inline-flex items-center gap-1.5 text-[13px] px-3 py-1.5 rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50"
                        >
                          {publishingId === c.id ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} Publier la réponse
                        </button>
                        <ActionBtn onClick={() => regenerate(c)} busy={replyGenId === c.id} icon={Sparkles}
                          className="text-violet-700 border-violet-200 hover:bg-violet-50">Régénérer</ActionBtn>
                        <ActionBtn onClick={() => setOpenReplyId(null)} icon={X}
                          className="text-gray-500 border-gray-200 hover:bg-gray-50">Annuler</ActionBtn>
                      </div>
                      <p className="text-[11px] text-gray-400 mt-1.5">
                        Brouillon généré par l'IA — relis et ajuste avant publication. Rien n'est publié sans ton clic.
                      </p>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </motion.div>
  );
}

function Stat({ label, value, accent = 'text-gray-900' }) {
  return (
    <div className="glass-card p-3 text-center">
      <div className={`text-xl font-bold ${accent}`}>{value}</div>
      <div className="text-[11px] text-gray-500 mt-0.5">{label}</div>
    </div>
  );
}

function ActionBtn({ onClick, busy, icon: Icon, className = '', children }) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className={`inline-flex items-center gap-1.5 text-[13px] px-2.5 py-1.5 rounded-lg border disabled:opacity-50 ${className}`}
    >
      {busy ? <Loader2 size={13} className="animate-spin" /> : <Icon size={13} />} {children}
    </button>
  );
}
