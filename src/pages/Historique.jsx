import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useDispatch, useSelector } from 'react-redux';
import { motion, AnimatePresence } from 'framer-motion';
import toast from 'react-hot-toast';
import {
  Clock, Trash2, Eye, Search, X, ExternalLink,
  Calendar, CheckCircle2, Sparkles, AlertTriangle, ChevronDown, ChevronUp,
  UserCircle2, RotateCcw, Loader, TrendingUp, TrendingDown, Minus,
  ArrowUp, ArrowDown, Timer, Activity, RefreshCw,
} from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import axios from 'axios';
import { removeFromHistory } from '../store/slices/articlesSlice';
import { addPendingItem } from '../store/slices/pendingSlice';
import {
  setOriginalContent, setUpdatedContent, setDiff,
  setSources, setAnalysis, setStatus, setCurrentArticleId, setAudit,
} from '../store/slices/agentSlice';
import { deleteArticle, fetchArticleHtml } from '../services/firebase';
import { useNavigate } from 'react-router-dom';
import { renderMarkdown } from '../utils/markdown';
import { ROLE_COLORS, PRIORITY_META, domainColor } from '../constants/theme';

// ── Constantes visuelles (importées depuis constants/theme) ───────────────────

function AssigneeAvatar({ member }) {
  if (!member) return null;
  const initials = [member.firstName?.[0], member.lastName?.[0]]
    .filter(Boolean).join('').toUpperCase() || '?';
  const cls = ROLE_COLORS[member.role] || 'bg-gray-100 text-gray-600';
  return (
    <div
      className={`w-6 h-6 text-[10px] ${cls} rounded-full flex items-center justify-center font-bold flex-shrink-0`}
      title={`${member.firstName} ${member.lastName}`}
    >
      {initials}
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const extractDomain = (url) => {
  try { return new URL(url).hostname.replace(/^www\./, ''); }
  catch { return url || '?'; }
};

const getArticleDate = (article) => {
  if (article.createdAt) return new Date(article.createdAt);
  const ts = Number(article.id);
  if (!isNaN(ts) && ts > 1_000_000_000_000) return new Date(ts);
  return null;
};

const formatDate = (date) => {
  if (!date || isNaN(date.getTime())) return null;
  return {
    short: date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }),
    long:  date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long',  year: 'numeric' }),
    time:  date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
  };
};

// ── Barre de recherche avec autocomplete ─────────────────────────────────────
function SearchBar({ value, onChange, suggestions }) {
  const [open, setOpen]   = useState(false);
  const [pos, setPos]     = useState({ top: 0, left: 0, width: 0 });
  const inputRef          = useRef(null);
  const filtered          = suggestions.filter(s =>
    s.toLowerCase().includes(value.toLowerCase()) && s !== value
  ).slice(0, 8);

  const handleFocus = () => {
    if (inputRef.current) {
      const r = inputRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 4, left: r.left, width: r.width });
    }
    setOpen(true);
  };

  const handleChange = (e) => {
    onChange(e.target.value);
    if (inputRef.current) {
      const r = inputRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 4, left: r.left, width: r.width });
    }
    setOpen(true);
  };

  const handleSelect = (s) => {
    onChange(s);
    setOpen(false);
    inputRef.current?.blur();
  };

  const showDropdown = open && value.length >= 1 && filtered.length > 0;

  return (
    <div className="relative">
      <Search size={15} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
      <input
        ref={inputRef}
        value={value}
        onChange={handleChange}
        onFocus={handleFocus}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Rechercher un article par titre ou URL…"
        className="input-glass pl-10 pr-10 w-full"
        autoComplete="off"
      />
      {value && (
        <button
          onClick={() => { onChange(''); inputRef.current?.focus(); }}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
        >
          <X size={14} />
        </button>
      )}

      {createPortal(
        <AnimatePresence>
          {showDropdown && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.1 }}
              style={{
                position: 'fixed',
                top: pos.top,
                left: pos.left,
                width: pos.width,
                zIndex: 9999,
                background: '#fff',
                borderRadius: 14,
                paddingTop: 6,
                paddingBottom: 6,
                boxShadow: '0 12px 48px rgba(0,0,0,0.13)',
                border: '1px solid rgba(0,0,0,0.07)',
              }}
            >
              {filtered.map((s, i) => (
                <button
                  key={i}
                  onMouseDown={() => handleSelect(s)}
                  className="flex items-center gap-2.5 w-full px-4 py-2.5 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors text-left truncate"
                >
                  <Search size={11} className="text-gray-300 flex-shrink-0" />
                  <span className="truncate">{s}</span>
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </div>
  );
}

// ── Composant SEO Panel — données live via Haloscan pageEvolution ─────────────
const COLORS = ['#16a34a', '#2563eb', '#d97706'];

function SeoPanel({ seoTracking, majDate }) {
  const [evoData, setEvoData] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(null);

  const keywords   = seoTracking?.keywords   || [];
  const articleUrl = seoTracking?.articleUrl || '';
  // Date de référence : la date de MAJ, sinon la date du 1er snapshot ("before"), sinon rien.
  // Évite un panneau éternellement vide quand l'article n'a pas de createdAt (majDate null).
  const firstSnapAt  = seoTracking?.snapshots?.[0]?.capturedAt;
  const baselineDate = majDate || (firstSnapAt ? new Date(firstSnapAt).toISOString().slice(0, 10) : null);

  useEffect(() => {
    if (!keywords.length || !articleUrl || !baselineDate) return;
    setLoading(true);
    setError(null);
    const today = new Date().toISOString().slice(0, 10);
    Promise.all(keywords.map(keyword =>
      axios.post('/api/haloscan/evolution', { keyword, articleUrl, firstDate: baselineDate, secondDate: today })
        .then(r => ({ keyword, ...r.data }))
        .catch(() => ({ keyword, position_history: [], volume_history: [] }))
    ))
      .then(results => {
        const map = {};
        results.forEach(r => { map[r.keyword] = r; });
        setEvoData(map);
      })
      .catch(() => setError('Impossible de charger les données Haloscan'))
      .finally(() => setLoading(false));
    // Recharge si l'URL, la date de référence ou la liste de mots-clés changent (hydratation tardive).
  }, [articleUrl, baselineDate, keywords.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!keywords.length) return null;

  // Chart : une entrée par date, une key par mot-clé
  const allDates = [...new Set(
    keywords.flatMap(kw => (evoData[kw]?.position_history || []).map(p => p.search_date))
  )].sort();

  const chartData = allDates.map(date => {
    const entry = { date: date.slice(5) }; // "MM-DD"
    keywords.forEach(kw => {
      const pt = (evoData[kw]?.position_history || []).find(p => p.search_date === date);
      entry[kw] = pt?.position && pt.position !== 'NA' ? Number(pt.position) : null;
    });
    return entry;
  });

  // Résumé par mot-clé
  const summary = keywords.map(kw => {
    const hist  = (evoData[kw]?.position_history || []).filter(p => p.position !== 'NA' && p.position != null);
    const first = hist[0];
    const last  = hist[hist.length - 1];
    const best  = hist.reduce((b, p) => (!b || Number(p.position) < Number(b.position) ? p : b), null);
    return { kw, first, last, best };
  });

  // Volume mensuel (dernier mot-clé saisi)
  const volumeData = (evoData[keywords[0]]?.volume_history || []).map(v => ({
    month: v.search_date.slice(0, 7),
    volume: v.volume,
  }));

  return (
    <div className="mt-3 border border-emerald-100 rounded-xl overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 bg-emerald-50 border-b border-emerald-100">
        <TrendingUp size={13} className="text-emerald-600" />
        <span className="text-xs font-semibold text-emerald-800">Suivi SEO Haloscan</span>
        {loading && <Loader size={11} className="animate-spin text-emerald-500 ml-1" />}
        {baselineDate && <span className="ml-auto text-[10px] text-emerald-500">depuis le {baselineDate}</span>}
      </div>

      <div className="p-4 bg-white space-y-4">
        {/* Chips mots-clés */}
        <div className="flex flex-wrap gap-1.5">
          {keywords.map((kw, i) => (
            <span key={i} className="inline-flex items-center gap-1 text-[11px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 px-2.5 py-1 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: COLORS[i] }} />
              {kw}
            </span>
          ))}
        </div>

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center gap-2 py-6 text-xs text-gray-400">
            <Loader size={14} className="animate-spin" />Chargement depuis Haloscan…
          </div>
        )}

        {/* Erreur */}
        {error && !loading && <p className="text-xs text-red-400 text-center py-3">{error}</p>}

        {/* Tableau résumé */}
        {!loading && summary.some(s => s.first || s.last) && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left text-[10px] text-gray-400 uppercase tracking-widest font-semibold pb-2 pr-4">Mot-clé</th>
                  <th className="text-center text-[10px] text-gray-400 uppercase tracking-widest font-semibold pb-2 px-3">À la MAJ</th>
                  <th className="text-center text-[10px] text-gray-400 uppercase tracking-widest font-semibold pb-2 px-3">Meilleure</th>
                  <th className="text-center text-[10px] text-gray-400 uppercase tracking-widest font-semibold pb-2 px-3">Actuelle</th>
                  <th className="text-center text-[10px] text-gray-400 uppercase tracking-widest font-semibold pb-2 px-3">Évol.</th>
                </tr>
              </thead>
              <tbody>
                {summary.map(({ kw, first, last, best }, i) => {
                  const diff = first && last ? Number(first.position) - Number(last.position) : null;
                  return (
                    <tr key={kw} className="border-b border-gray-50 last:border-0">
                      <td className="py-2 pr-4 font-medium text-gray-700 truncate max-w-[150px]">
                        <span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ background: COLORS[i] }} />{kw}
                      </td>
                      <td className="py-2 px-3 text-center font-mono text-gray-600">{first ? `#${first.position}` : '—'}</td>
                      <td className="py-2 px-3 text-center font-mono text-emerald-600 font-semibold">{best ? `#${best.position}` : '—'}</td>
                      <td className="py-2 px-3 text-center font-mono text-gray-600">{last ? `#${last.position}` : '—'}</td>
                      <td className="py-2 px-3 text-center">
                        {diff == null ? <span className="text-gray-300">—</span>
                          : diff > 0 ? <span className="inline-flex items-center gap-0.5 text-emerald-600 font-semibold"><TrendingUp size={11} />+{diff}</span>
                          : diff < 0 ? <span className="inline-flex items-center gap-0.5 text-red-500 font-semibold"><TrendingDown size={11} />{diff}</span>
                          : <span className="inline-flex items-center gap-0.5 text-gray-400"><Minus size={11} />=</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Courbe de position complète */}
        {!loading && chartData.length >= 2 && (
          <div>
            <p className="text-[10px] text-gray-400 uppercase tracking-widest font-semibold mb-2">Historique de position (axe inversé — bas = meilleur)</p>
            <ResponsiveContainer width="100%" height={150}>
              <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: -22 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 9, fill: '#9ca3af' }} axisLine={false} tickLine={false}
                  interval={Math.max(0, Math.floor(chartData.length / 6))} />
                <YAxis reversed tick={{ fontSize: 9, fill: '#9ca3af' }} axisLine={false} tickLine={false}
                  tickFormatter={v => `#${v}`} />
                <Tooltip
                  contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #e5e7eb', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}
                  labelFormatter={l => `Date : ${l}`}
                  formatter={(v, name) => [v != null ? `#${v}` : 'Hors top 100', name]}
                />
                {keywords.map((kw, i) => (
                  <Line key={kw} type="monotone" dataKey={kw} stroke={COLORS[i]}
                    strokeWidth={2} dot={false} activeDot={{ r: 4 }} connectNulls={false} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Volume mensuel */}
        {!loading && volumeData.length > 0 && (
          <div className="flex items-center gap-3 text-xs text-gray-400 flex-wrap">
            <span className="font-medium text-gray-500">Vol/mois :</span>
            {volumeData.slice(-3).map(v => (
              <span key={v.month}>{v.month} → <strong className="text-gray-600">{Number(v.volume).toLocaleString('fr')}</strong></span>
            ))}
          </div>
        )}

        {/* Aucune donnée */}
        {!loading && !error && chartData.length === 0 && Object.keys(evoData).length > 0 && (
          <p className="text-xs text-gray-400 text-center py-3">
            Aucun historique disponible — l'URL n'est peut-être pas encore dans les données Haloscan.
          </p>
        )}

        {/* URL */}
        {articleUrl && (
          <a href={articleUrl} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[11px] text-blue-400 hover:text-blue-600 hover:underline">
            <ExternalLink size={10} />{articleUrl}
          </a>
        )}
      </div>
    </div>
  );
}

// ── Ligne historique (read-only, même design que MAJ en attente) ──────────────
function HistoryRow({ article, users, onView, onRequeue, onDelete }) {
  const [expanded, setExpanded] = useState(false);

  const domain   = extractDomain(article.url);
  const initial  = domain[0]?.toUpperCase() || '?';
  const bgColor  = domainColor(domain);
  const date     = formatDate(getArticleDate(article));
  const assignee = users.find(u => u.id === article.assigneeId) || null;
  const prio     = PRIORITY_META[article.priority] || PRIORITY_META.normale;

  const applied = article.updates?.filter(u => u.applied !== false) || [];
  const missed  = article.updates?.filter(u => u.applied === false)  || [];

  return (
    <>
      <motion.div
        layout
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0, x: -16 }}
        className={`flex items-center gap-4 px-5 py-3.5 border-b border-gray-50/80 hover:bg-gray-50/40 transition-colors border-l-[3px] ${prio.border}`}
      >
        {/* Domain avatar */}
        <div className={`w-9 h-9 rounded-xl ${bgColor} flex items-center justify-center text-white text-sm font-bold flex-shrink-0 shadow-sm`}>
          {initial}
        </div>

        {/* Titre + domaine + mot-clé */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900 truncate leading-snug" title={article.title}>
            {article.title || article.url}
          </p>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[11px] text-gray-400 truncate">{domain}</span>
            {article.keyword && (
              <>
                <span className="text-gray-200 select-none">·</span>
                <span className="inline-flex items-center gap-0.5 text-[10px] text-indigo-400 font-medium truncate">
                  <Sparkles size={8} className="flex-shrink-0" />
                  {article.keyword}
                </span>
              </>
            )}
          </div>
        </div>

        {/* Assigné — read-only */}
        <div className="flex-shrink-0 hidden md:flex items-center gap-1.5">
          {assignee ? (
            <>
              <AssigneeAvatar member={assignee} />
              <span className="text-[11px] text-gray-500 font-medium leading-none">
                {assignee.firstName}
              </span>
            </>
          ) : (
            <UserCircle2 size={16} className="text-gray-200" />
          )}
        </div>

        {/* Priorité — read-only */}
        <div className="flex-shrink-0 hidden sm:block">
          <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold border rounded-full px-2.5 py-1 whitespace-nowrap leading-none ${prio.badge}`}>
            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${prio.dot}`} />
            {prio.label}
          </span>
        </div>

        {/* Date */}
        {date && (
          <div className="flex-shrink-0 hidden sm:block">
            <span className="inline-flex items-center gap-1.5 text-[11px] text-gray-400 font-medium">
              <Calendar size={10} className="flex-shrink-0" />
              {date.short}
            </span>
          </div>
        )}

        {/* Badges MAJ */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {applied.length > 0 && (
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full px-2.5 py-1 leading-none whitespace-nowrap">
              <Sparkles size={9} />
              {applied.length} MAJ
            </span>
          )}
          {missed.length > 0 && (
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold bg-amber-50 text-amber-600 border border-amber-200 rounded-full px-2.5 py-1 leading-none whitespace-nowrap">
              <AlertTriangle size={9} />
              {missed.length} manquée{missed.length > 1 ? 's' : ''}
            </span>
          )}

          {/* Badge SEO Haloscan — position avant/après ou statut en attente */}
          {article.seoTracking?.enabled && (() => {
            const st          = article.seoTracking;
            const snapshots   = st.snapshots || [];
            const beforeSnap  = snapshots.find(s => s.type === 'before');
            const after7Snap  = snapshots.find(s => s.type === 'after_7d');
            const after30Snap = snapshots.find(s => s.type === 'after_30d');
            const beforePos   = beforeSnap?.results?.[0]?.position;
            const latestPos   = (after30Snap || after7Snap)?.results?.[0]?.position;

            // En attente J+7
            if (st.nextSnapshotType === 'after_7d') {
              return (
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold bg-blue-50 text-blue-600 border border-blue-200 rounded-full px-2.5 py-1 leading-none whitespace-nowrap">
                  <Timer size={9} />
                  En attente J+7
                  {beforePos && beforePos !== 'NA' && (
                    <span className="opacity-50 font-normal">· #{beforePos}</span>
                  )}
                </span>
              );
            }

            // En attente J+30
            if (st.nextSnapshotType === 'after_30d') {
              return (
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold bg-violet-50 text-violet-600 border border-violet-200 rounded-full px-2.5 py-1 leading-none whitespace-nowrap">
                  <Timer size={9} />
                  En attente J+30
                  {beforePos && beforePos !== 'NA' && (
                    <span className="opacity-50 font-normal">· #{beforePos}</span>
                  )}
                </span>
              );
            }

            // Évolution connue (avant + après)
            if (beforePos && beforePos !== 'NA' && latestPos && latestPos !== 'NA') {
              const diff = Number(beforePos) - Number(latestPos); // positif = gagné des positions
              return (
                <span className={`inline-flex items-center gap-1 text-[11px] font-semibold rounded-full px-2.5 py-1 leading-none whitespace-nowrap border ${
                  diff > 0 ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : diff < 0 ? 'bg-red-50 text-red-600 border-red-200'
                  : 'bg-gray-50 text-gray-500 border-gray-200'
                }`}>
                  {diff > 0 ? <ArrowUp size={10} /> : diff < 0 ? <ArrowDown size={10} /> : <Minus size={10} />}
                  #{beforePos} → #{latestPos}
                </span>
              );
            }

            // Seulement snapshot avant disponible
            if (beforePos && beforePos !== 'NA') {
              return (
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold bg-gray-50 text-gray-500 border border-gray-200 rounded-full px-2.5 py-1 leading-none whitespace-nowrap">
                  <Activity size={9} className="text-gray-400" />
                  #{beforePos}
                </span>
              );
            }

            // Tracking actif mais pas encore de données
            return (
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold bg-emerald-50 text-emerald-600 border border-emerald-200 rounded-full px-2.5 py-1 leading-none whitespace-nowrap">
                <Activity size={9} />
                SEO actif
              </span>
            );
          })()}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={() => onView(article)}
            className="btn-ghost !p-1.5 text-gray-400 hover:text-gray-700"
            title="Voir avant / après"
          >
            <Eye size={13} />
          </button>
          <button
            onClick={() => onRequeue(article)}
            className="btn-ghost !p-1.5 text-gray-300 hover:text-amber-500 hover:bg-amber-50"
            title="Remettre en attente de MAJ"
          >
            <RotateCcw size={13} />
          </button>
          <button
            onClick={() => setExpanded(x => !x)}
            className="btn-ghost !p-1.5 text-gray-300 hover:text-gray-500"
          >
            {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>
          <button
            onClick={() => onDelete(article.id)}
            className="btn-ghost !p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50"
          >
            <Trash2 size={13} />
          </button>
        </div>
      </motion.div>

      {/* Panneau expand — read-only */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="px-5 py-4 bg-gray-50/50 border-b border-gray-100 space-y-3">
              <a
                href={article.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs text-blue-500 hover:text-blue-600 hover:underline break-all transition-colors"
              >
                <ExternalLink size={11} className="flex-shrink-0" />
                {article.url}
              </a>
              <div className="flex items-start gap-8 flex-wrap">
                {date && (
                  <div>
                    <p className="text-[10px] text-gray-400 uppercase tracking-widest font-semibold mb-1">Traité le</p>
                    <p className="text-xs text-gray-600">{date.long} · {date.time}</p>
                  </div>
                )}
                {applied.length > 0 && (
                  <div>
                    <p className="text-[10px] text-gray-400 uppercase tracking-widest font-semibold mb-1">Modifications</p>
                    <p className="text-xs text-gray-600">
                      {applied.length} appliquée{applied.length > 1 ? 's' : ''}
                      {missed.length > 0 ? ` · ${missed.length} non localisée${missed.length > 1 ? 's' : ''}` : ''}
                    </p>
                  </div>
                )}
                {article.sources?.length > 0 && (
                  <div>
                    <p className="text-[10px] text-gray-400 uppercase tracking-widest font-semibold mb-1">Sources</p>
                    <p className="text-xs text-gray-600">{article.sources.length} source{article.sources.length > 1 ? 's' : ''}</p>
                  </div>
                )}
              </div>

              {/* Panneau SEO Haloscan */}
              {article.seoTracking?.enabled && (
                <SeoPanel
                  seoTracking={article.seoTracking}
                  majDate={article.createdAt ? new Date(article.createdAt).toISOString().slice(0, 10) : null}
                />
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

// ── Page principale ───────────────────────────────────────────────────────────

export default function Historique() {
  const dispatch      = useDispatch();
  const navigate      = useNavigate();
  const history       = useSelector(s => s.articles.history);
  const firebaseReady = useSelector(s => s.settings.firebaseReady);
  const users         = useSelector(s => s.users.list);
  const authRole      = useSelector(s => s.auth.role);
  const authUid       = useSelector(s => s.auth.uid);
  const authUsername  = useSelector(s => s.auth.username);

  const [search,        setSearch]        = useState('');
  const [preview,       setPreview]       = useState(null);
  const [previewTab,    setPreviewTab]    = useState('apres');
  const [previewHtml,   setPreviewHtml]   = useState({ original: '', updated: '' });
  const [previewLoading, setPreviewLoading] = useState(false);

  // CQ IA : uniquement ses propres articles
  const visibleHistory = authRole === 'cq_ia'
    ? history.filter(a => a.assigneeId === authUid || a.assigneeId === authUsername)
    : history;

  // Suggestions autocomplete = titres uniques de l'historique visible
  const suggestions = [...new Set(visibleHistory.map(a => a.title).filter(Boolean))];

  const q = search.toLowerCase();
  const filtered = visibleHistory.filter(a =>
    !q ||
    a.title?.toLowerCase().includes(q) ||
    a.url?.toLowerCase().includes(q) ||
    a.keyword?.toLowerCase().includes(q)
  );

  const handleDelete = (id) => {
    dispatch(removeFromHistory(id));
    toast.success('Supprimé de l\'historique');
    if (preview?.id === id) setPreview(null);
    // Nettoyage Firestore en arrière-plan (non bloquant — comme handleRequeue)
    if (firebaseReady) deleteArticle(id).catch(() => {});
  };

  const handleRequeue = (article) => {
    // 1. Mise à jour UI immédiate — pas d'await pour ne jamais bloquer sur Firebase
    dispatch(removeFromHistory(article.id));
    if (preview?.id === article.id) setPreview(null);

    dispatch(addPendingItem({
      id:         `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      url:        article.url        || '',
      title:      article.title      || article.url || '',
      keyword:    article.keyword    || '',
      priority:   article.priority   || 'normale',
      assigneeId: article.assigneeId || null,
      status:     'pending',
      source:     'requeue',
      addedAt:    Date.now(),
    }));

    toast.success('Article remis en attente de MAJ', { icon: <RefreshCw size={18} /> });

    // 2. Nettoyage Firestore en arrière-plan (best-effort, non bloquant)
    if (firebaseReady) deleteArticle(article.id).catch(() => {});
  };

  // Ouvre la modale de prévisualisation et charge le HTML depuis Storage si nécessaire
  const openPreview = async (article) => {
    setPreview(article);
    setPreviewTab('apres');
    setPreviewHtml({ original: '', updated: '' });
    setPreviewLoading(true);
    const [orig, updated] = await Promise.all([
      article.originalContent || fetchArticleHtml(article.originalContentUrl),
      article.updatedContent  || fetchArticleHtml(article.updatedContentUrl),
    ]);
    setPreviewHtml({ original: orig, updated });
    setPreviewLoading(false);
  };

  // Rouvre l'article dans l'éditeur (Articles page) — charge le HTML si besoin
  const handleView = async (article) => {
    const [orig, updated] = await Promise.all([
      article.originalContent || fetchArticleHtml(article.originalContentUrl),
      article.updatedContent  || fetchArticleHtml(article.updatedContentUrl),
    ]);
    dispatch(setOriginalContent(orig));
    dispatch(setUpdatedContent(updated));
    dispatch(setDiff(article.updates || []));
    dispatch(setSources(article.sources || []));
    dispatch(setAnalysis(article.analysis || ''));
    dispatch(setAudit(article.audit || ''));   // restaure le rapport d'audit (rétrocompat: anciens docs → '')
    dispatch(setCurrentArticleId(article.id));
    dispatch(setStatus('done'));
    navigate('/');
  };

  return (
    <div className="space-y-6 animate-fade-in">

      {/* ── Header ── */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Clock size={22} className="text-gray-700" />
            Historique
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            {visibleHistory.length} article{visibleHistory.length > 1 ? 's' : ''} traité{visibleHistory.length > 1 ? 's' : ''}
            {search && ` · ${filtered.length} résultat${filtered.length > 1 ? 's' : ''}`}
          </p>
        </div>
      </div>

      {/* ── Barre de recherche avec autocomplete ── */}
      {visibleHistory.length > 0 && (
        <SearchBar
          value={search}
          onChange={setSearch}
          suggestions={suggestions}
        />
      )}

      {/* ── Liste ── */}
      {visibleHistory.length === 0 ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="glass-card p-12 text-center"
        >
          <Clock size={36} className="mx-auto mb-4 text-gray-200" />
          <p className="text-sm font-semibold text-gray-400">Aucun article traité</p>
          <p className="text-xs text-gray-400 mt-1 max-w-sm mx-auto">
            Les articles mis à jour par TONTON AI apparaîtront ici.
          </p>
        </motion.div>
      ) : filtered.length === 0 ? (
        <div className="glass-card p-8 text-center">
          <p className="text-sm text-gray-400">Aucun résultat pour «&nbsp;<strong>{search}</strong>&nbsp;»</p>
          <button onClick={() => setSearch('')} className="mt-3 text-xs text-blue-500 hover:underline">
            Effacer la recherche
          </button>
        </div>
      ) : (
        <div className="glass-card overflow-hidden rounded-2xl">
          <AnimatePresence mode="popLayout">
            {filtered.map(article => (
              <HistoryRow
                key={article.id}
                article={article}
                users={users}
                onView={() => openPreview(article)}
                onRequeue={handleRequeue}
                onDelete={handleDelete}
              />
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* ── Modal avant / après ── */}
      <AnimatePresence>
        {preview && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/20 backdrop-blur-sm z-50 flex items-center justify-center p-6"
            onClick={() => { setPreview(null); setPreviewTab('apres'); setPreviewHtml({ original: '', updated: '' }); }}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={e => e.stopPropagation()}
              className="glass-card w-full max-w-4xl max-h-[85vh] overflow-hidden flex flex-col"
            >
              {/* En-tête modal */}
              <div className="flex items-center justify-between px-5 pt-5 pb-0 flex-shrink-0">
                <div className="min-w-0 flex-1 pr-4">
                  <h3 className="font-semibold text-gray-900 truncate">{preview.title}</h3>
                  <div className="flex items-center gap-3 mt-1 flex-wrap">
                    {(() => {
                      const d = formatDate(getArticleDate(preview));
                      return d ? (
                        <p className="text-xs text-gray-400 flex items-center gap-1">
                          <Calendar size={11} />
                          {d.long} · {d.time}
                        </p>
                      ) : null;
                    })()}
                    {preview.updates?.length > 0 && (() => {
                      const applied = preview.updates.filter(u => u.applied !== false);
                      const p2      = applied.filter(u => u.pass === 2);
                      const missed  = preview.updates.filter(u => u.applied === false);
                      return (
                        <div className="flex items-center gap-2 flex-wrap">
                          {applied.length > 0 && (
                            <span className="flex items-center gap-1 text-[10px] font-medium bg-green-50 text-green-700 border border-green-100 rounded-full px-2 py-0.5">
                              <CheckCircle2 size={9} />
                              {applied.length} modif. appliquée{applied.length > 1 ? 's' : ''}
                            </span>
                          )}
                          {p2.length > 0 && (
                            <span className="flex items-center gap-1 text-[10px] font-medium bg-purple-50 text-purple-700 border border-purple-100 rounded-full px-2 py-0.5">
                              <Sparkles size={9} />
                              {p2.length} passe 2
                            </span>
                          )}
                          {missed.length > 0 && (
                            <span className="flex items-center gap-1 text-[10px] font-medium bg-amber-50 text-amber-600 border border-amber-100 rounded-full px-2 py-0.5">
                              <AlertTriangle size={9} />
                              {missed.length} non localisée{missed.length > 1 ? 's' : ''}
                            </span>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                </div>
                <div className="flex gap-2 flex-shrink-0">
                  <button onClick={() => handleView(preview)} className="btn-primary text-xs">
                    <ExternalLink size={13} />
                    Rouvrir &amp; éditer
                  </button>
                  <button
                    onClick={() => { setPreview(null); setPreviewTab('apres'); setPreviewHtml({ original: '', updated: '' }); }}
                    className="btn-ghost !p-2"
                  >
                    <X size={15} />
                  </button>
                </div>
              </div>

              {/* Onglets */}
              <div className="flex border-b border-gray-100 px-5 mt-3 flex-shrink-0">
                {[
                  { id: 'avant', label: 'Avant' },
                  { id: 'apres', label: 'Après — MAJ appliquées' },
                ].map(t => (
                  <button
                    key={t.id}
                    onClick={() => setPreviewTab(t.id)}
                    className={`relative px-4 py-3 text-sm font-medium transition-colors ${
                      previewTab === t.id ? 'text-gray-900' : 'text-gray-400 hover:text-gray-600'
                    }`}
                  >
                    {t.label}
                    {previewTab === t.id && (
                      <motion.div layoutId="hist-tab" className="absolute bottom-0 left-0 right-0 h-0.5 bg-black rounded-full" />
                    )}
                  </button>
                ))}
              </div>

              {/* Contenu */}
              <div className="overflow-y-auto flex-1 p-5">
                {previewLoading ? (
                  <div className="flex items-center justify-center py-16 gap-3 text-gray-400">
                    <Loader size={18} className="animate-spin" />
                    <span className="text-sm">Chargement du contenu…</span>
                  </div>
                ) : (
                  <>
                    {preview.analysis && (
                      <div className="bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-100 rounded-xl px-4 py-3 mb-4">
                        <p className="text-[10px] font-semibold text-indigo-400 uppercase tracking-wide mb-2">Synthèse de l'agent</p>
                        <div
                          className="md-content text-indigo-900"
                          dangerouslySetInnerHTML={{ __html: renderMarkdown(preview.analysis) }}
                        />
                      </div>
                    )}
                    <AnimatePresence mode="wait">
                      {previewTab === 'avant' ? (
                        <motion.div
                          key="avant"
                          initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 8 }}
                          className="bg-gray-50 rounded-xl p-5"
                        >
                          <div
                            className="md-content"
                            dangerouslySetInnerHTML={{ __html: renderMarkdown(previewHtml.original || '—') }}
                          />
                        </motion.div>
                      ) : (
                        <motion.div
                          key="apres"
                          initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }}
                        >
                          {previewHtml.updated ? (
                            <>
                              <div className="flex items-center gap-3 text-xs text-gray-500 bg-gray-50 rounded-xl px-4 py-2 mb-3 flex-wrap">
                                <span className="px-1.5 py-0.5 rounded text-[11px] font-medium"
                                  style={{ background: '#fee2e2', color: '#9ca3af', textDecoration: 'line-through' }}>
                                  supprimé
                                </span>
                                <span className="px-1.5 py-0.5 rounded text-[11px] font-medium"
                                  style={{ background: '#bbf7d0', color: '#14532d' }}>
                                  mis à jour
                                </span>
                              </div>
                              <div
                                className="article-diff-content text-sm leading-loose p-5 bg-white rounded-xl border border-gray-100"
                                dangerouslySetInnerHTML={{ __html: previewHtml.updated }}
                              />
                            </>
                          ) : (
                            <div className="text-center py-10 text-gray-400 text-sm">
                              Aucune version mise à jour disponible
                            </div>
                          )}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
