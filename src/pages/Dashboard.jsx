import { useSelector, useDispatch } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';
import {
  BarChart3, Zap, DollarSign, Trash2, Clock,
  AlertCircle, Users, CheckCircle2, TrendingUp,
  Sparkles, RefreshCw, Calendar, ArrowRight,
} from 'lucide-react';
import { resetStats } from '../store/slices/statsSlice';

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmt   = (n) => (n || 0).toLocaleString('fr-FR');
const fmtUsd = (n) => {
  const v = n || 0;
  if (v === 0) return '$0.0000';
  if (v >= 0.01) return `$${v.toFixed(2)}`;
  return `$${v.toFixed(4)}`;
};
const fmtDate = (iso) => {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('fr-FR', {
      day: '2-digit', month: 'short', year: '2-digit',
    });
  } catch { return iso; }
};

const extractDomain = (url) => {
  try { return new URL(url).hostname.replace(/^www\./, ''); }
  catch { return url || '?'; }
};

const ROLE_COLORS = {
  cq_ia:       'bg-blue-100 text-blue-700',
  manager:     'bg-purple-100 text-purple-700',
  super_admin: 'bg-gray-900 text-white',
};

// ── Composants ────────────────────────────────────────────────────────────────

const KpiCard = ({ icon: Icon, label, value, sub, color = 'gray', delay = 0 }) => {
  const c = {
    gray:   'bg-gray-100 text-gray-600',
    blue:   'bg-blue-100 text-blue-600',
    green:  'bg-emerald-100 text-emerald-600',
    purple: 'bg-purple-100 text-purple-600',
    amber:  'bg-amber-100 text-amber-600',
  }[color] || 'bg-gray-100 text-gray-600';

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
      className="glass-card p-5 flex items-start gap-4"
    >
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${c}`}>
        <Icon size={18} />
      </div>
      <div className="min-w-0">
        <p className="text-[11px] text-gray-400 font-semibold uppercase tracking-wide mb-0.5">{label}</p>
        <p className="text-2xl font-bold text-gray-900 leading-none">{value}</p>
        {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
      </div>
    </motion.div>
  );
};

// ── Page ─────────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const dispatch = useDispatch();
  const navigate = useNavigate();

  const stats          = useSelector(s => s.stats);
  const history        = useSelector(s => s.articles.history);
  const pendingItems   = useSelector(s => s.pending.list);
  const users          = useSelector(s => s.users.list);

  const { totalInputTokens, totalOutputTokens, totalCostUsd, totalArticles } = stats;

  // ── Calculs file d'attente ────────────────────────────────────────────────
  const activeItems   = pendingItems.filter(i => i.status !== 'done');
  const urgentItems   = activeItems.filter(i => (i.priority || 'normale') === 'haute');
  const aValiderItems = activeItems.filter(i => i.status === 'a_valider');
  const pendingCount  = activeItems.filter(i => i.status === 'pending').length;
  const inProgressCount = activeItems.filter(i => i.status === 'in_progress').length;

  // ── Moyennes tokens ───────────────────────────────────────────────────────
  const avgCost    = totalArticles > 0 ? totalCostUsd / totalArticles : 0;
  const avgTokensIn  = totalArticles > 0 ? Math.round(totalInputTokens / totalArticles) : 0;
  const avgTokensOut = totalArticles > 0 ? Math.round(totalOutputTokens / totalArticles) : 0;

  // ── Stats par membre ──────────────────────────────────────────────────────
  const memberStats = users
    .filter(u => ['cq_ia', 'manager'].includes(u.role))
    .map(u => ({
      ...u,
      completed:  history.filter(a => a.assigneeId === u.id).length,
      inQueue:    activeItems.filter(i => i.assigneeId === u.id && i.status === 'pending').length,
      aValider:   activeItems.filter(i => i.assigneeId === u.id && i.status === 'a_valider').length,
    }))
    .sort((a, b) => b.completed - a.completed);

  const handleReset = () => {
    if (window.confirm('Réinitialiser toutes les statistiques ? Cette action est irréversible.')) {
      dispatch(resetStats());
      toast.success('Statistiques réinitialisées');
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">

      {/* ── Header ── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <BarChart3 size={22} className="text-gray-700" />
            Dashboard
          </h1>
          <p className="text-sm text-gray-500 mt-1">Vue d'ensemble — tokens, file d'attente, équipe</p>
        </div>
        <button
          onClick={handleReset}
          className="btn-ghost flex items-center gap-2 text-red-400 hover:text-red-600 hover:bg-red-50 text-xs"
        >
          <Trash2 size={13} />
          Réinitialiser les stats
        </button>
      </div>

      {/* ── KPIs ── */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <KpiCard icon={BarChart3}  label="Articles traités"   value={history.length.toLocaleString('fr-FR')}  sub="dans l'historique"           color="gray"   delay={0}    />
        <KpiCard icon={Zap}        label="Tokens consommés"   value={fmt(totalInputTokens + totalOutputTokens)} sub={`↑ ${fmt(totalInputTokens)} · ↓ ${fmt(totalOutputTokens)}`} color="blue"   delay={0.04} />
        <KpiCard icon={TrendingUp} label="Moy. tokens/article" value={fmt(avgTokensIn + avgTokensOut)}           sub={`~${fmtUsd(avgCost)} / article`}            color="purple" delay={0.08} />
        <KpiCard icon={DollarSign} label="Coût total estimé"  value={fmtUsd(totalCostUsd)}                      sub="USD — tarifs Anthropic"      color="green"  delay={0.12} />
      </div>

      {/* ── File d'attente + Urgents ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* Statuts */}
        <motion.div
          initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.14 }}
          className="glass-card p-5 space-y-4"
        >
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
              <Clock size={14} className="text-gray-400" />
              File d'attente
            </h2>
            <button
              onClick={() => navigate('/maj-en-attente')}
              className="text-[11px] text-gray-400 hover:text-gray-600 flex items-center gap-1 transition-colors"
            >
              Voir tout <ArrowRight size={11} />
            </button>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'En attente',  value: pendingCount,    bg: 'bg-amber-50',  text: 'text-amber-700'  },
              { label: 'En cours',    value: inProgressCount, bg: 'bg-blue-50',   text: 'text-blue-700'   },
              { label: 'À valider',   value: aValiderItems.length, bg: 'bg-purple-50', text: 'text-purple-700' },
            ].map(c => (
              <div key={c.label} className={`${c.bg} rounded-xl px-3 py-3 text-center`}>
                <p className={`text-2xl font-bold ${c.text} leading-none`}>{c.value}</p>
                <p className="text-[10px] text-gray-400 font-medium mt-1">{c.label}</p>
              </div>
            ))}
          </div>

          {/* Articles à valider */}
          {aValiderItems.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[10px] font-semibold text-purple-500 uppercase tracking-widest">À valider maintenant</p>
              {aValiderItems.slice(0, 3).map(item => (
                <div key={item.id} className="flex items-center gap-2.5 bg-purple-50/60 border border-purple-100 rounded-xl px-3 py-2">
                  <div className="w-6 h-6 rounded-lg bg-purple-200 text-purple-700 text-[10px] font-bold flex items-center justify-center flex-shrink-0">
                    {extractDomain(item.url)[0]?.toUpperCase() || '?'}
                  </div>
                  <p className="text-xs text-gray-700 truncate flex-1">{item.title || item.url}</p>
                  <CheckCircle2 size={12} className="text-purple-400 flex-shrink-0" />
                </div>
              ))}
              {aValiderItems.length > 3 && (
                <p className="text-[11px] text-gray-400 text-center">+{aValiderItems.length - 3} autres</p>
              )}
            </div>
          )}
        </motion.div>

        {/* Urgents */}
        <motion.div
          initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.16 }}
          className="glass-card p-5 space-y-4"
        >
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
              <AlertCircle size={14} className="text-red-400" />
              Priorité haute en attente
              {urgentItems.length > 0 && (
                <span className="text-xs font-bold bg-red-500 text-white rounded-full px-2 py-0.5 leading-none">
                  {urgentItems.length}
                </span>
              )}
            </h2>
          </div>

          {urgentItems.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center py-6 text-center">
              <CheckCircle2 size={28} className="text-emerald-300 mb-2" />
              <p className="text-sm text-gray-400">Aucun article urgent en attente</p>
            </div>
          ) : (
            <div className="space-y-2">
              {urgentItems.slice(0, 5).map(item => {
                const assignee = users.find(u => u.id === item.assigneeId);
                return (
                  <div key={item.id} className="flex items-center gap-2.5 border border-red-100 bg-red-50/40 rounded-xl px-3 py-2.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-red-500 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-gray-800 truncate">{item.title || item.url}</p>
                      <p className="text-[10px] text-gray-400">{extractDomain(item.url)}</p>
                    </div>
                    {assignee && (
                      <div
                        className={`w-6 h-6 rounded-full text-[10px] font-bold flex items-center justify-center flex-shrink-0 ${ROLE_COLORS[assignee.role] || 'bg-gray-100 text-gray-600'}`}
                        title={`${assignee.firstName} ${assignee.lastName}`}
                      >
                        {[assignee.firstName?.[0], assignee.lastName?.[0]].filter(Boolean).join('').toUpperCase() || '?'}
                      </div>
                    )}
                  </div>
                );
              })}
              {urgentItems.length > 5 && (
                <p className="text-[11px] text-gray-400 text-center">+{urgentItems.length - 5} autres urgents</p>
              )}
            </div>
          )}
        </motion.div>
      </div>

      {/* ── Productivité équipe ── */}
      {memberStats.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.18 }}
          className="glass-card p-5 space-y-4"
        >
          <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
            <Users size={14} className="text-gray-400" />
            Productivité équipe
          </h2>
          <div className="overflow-x-auto -mx-1">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b border-gray-100">
                  {['Membre', 'Rôle', 'Terminés', 'En attente', 'À valider'].map(h => (
                    <th key={h} className="pb-2 px-3 text-[11px] font-semibold text-gray-400 uppercase tracking-wide whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {memberStats.map(m => {
                  const initials = [m.firstName?.[0], m.lastName?.[0]].filter(Boolean).join('').toUpperCase() || '?';
                  const roleCls  = ROLE_COLORS[m.role] || 'bg-gray-100 text-gray-600';
                  const roleLabel = m.role === 'cq_ia' ? 'CQ IA' : m.role === 'manager' ? 'Manager' : 'Super Admin';
                  return (
                    <tr key={m.id} className="hover:bg-gray-50/60 transition-colors">
                      <td className="py-3 px-3">
                        <div className="flex items-center gap-2.5">
                          <div className={`w-7 h-7 rounded-full text-[11px] font-bold flex items-center justify-center flex-shrink-0 ${roleCls}`}>
                            {initials}
                          </div>
                          <div>
                            <p className="text-xs font-semibold text-gray-800">{m.firstName} {m.lastName}</p>
                            {m.email && <p className="text-[10px] text-gray-400 truncate max-w-[140px]">{m.email}</p>}
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-3">
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${roleCls}`}>
                          {roleLabel}
                        </span>
                      </td>
                      <td className="py-3 px-3">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-bold text-emerald-600">{m.completed}</span>
                          {m.completed > 0 && (
                            <div className="h-1.5 w-16 bg-gray-100 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-emerald-400 rounded-full"
                                style={{ width: `${Math.min(100, (m.completed / Math.max(...memberStats.map(x => x.completed), 1)) * 100)}%` }}
                              />
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-3">
                        <span className={`text-sm font-bold ${m.inQueue > 0 ? 'text-amber-600' : 'text-gray-300'}`}>
                          {m.inQueue}
                        </span>
                      </td>
                      <td className="py-3 px-3">
                        <span className={`text-sm font-bold ${m.aValider > 0 ? 'text-purple-600' : 'text-gray-300'}`}>
                          {m.aValider}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </motion.div>
      )}

      {/* ── Moyennes tokens ── */}
      {totalArticles > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
          className="glass-card p-5"
        >
          <h2 className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-2">
            <RefreshCw size={14} className="text-gray-400" />
            Moyennes par analyse
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-gray-50 rounded-xl px-4 py-3">
              <p className="text-[11px] text-gray-400 uppercase tracking-wide font-medium mb-1">Coût moyen</p>
              <p className="text-xl font-bold text-gray-900">{fmtUsd(avgCost)}</p>
              <p className="text-xs text-gray-400">par article</p>
            </div>
            <div className="bg-blue-50 rounded-xl px-4 py-3">
              <p className="text-[11px] text-gray-400 uppercase tracking-wide font-medium mb-1">Tokens ↑ moyens</p>
              <p className="text-xl font-bold text-gray-900">{fmt(avgTokensIn)}</p>
              <p className="text-xs text-gray-400">tokens en entrée / article</p>
            </div>
            <div className="bg-purple-50 rounded-xl px-4 py-3">
              <p className="text-[11px] text-gray-400 uppercase tracking-wide font-medium mb-1">Tokens ↓ moyens</p>
              <p className="text-xl font-bold text-gray-900">{fmt(avgTokensOut)}</p>
              <p className="text-xs text-gray-400">tokens en sortie / article</p>
            </div>
          </div>
        </motion.div>
      )}

      {/* ── Dernières analyses ── */}
      <motion.div
        initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.22 }}
        className="glass-card p-5 space-y-3"
      >
        <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
          <Calendar size={14} className="text-gray-400" />
          Dernières analyses
          {stats.history.length > 0 && (
            <span className="ml-1 text-[11px] font-normal text-gray-400">({Math.min(20, stats.history.length)} sur {stats.history.length})</span>
          )}
        </h2>

        {stats.history.length === 0 ? (
          <div className="text-center py-10 text-gray-400">
            <BarChart3 size={28} className="mx-auto mb-3 opacity-20" />
            <p className="text-sm">Aucune analyse enregistrée</p>
          </div>
        ) : (
          <div className="overflow-x-auto -mx-1">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b border-gray-100">
                  {['Date', 'Titre', 'Passe', 'Tokens ↑', 'Tokens ↓', 'Coût'].map(h => (
                    <th key={h} className="pb-2 px-2 text-[11px] font-semibold text-gray-400 uppercase tracking-wide whitespace-nowrap last:text-right">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {stats.history.slice(0, 20).map((h, i) => (
                  <tr key={i} className="hover:bg-gray-50/60 transition-colors">
                    <td className="py-2.5 px-2 text-xs text-gray-400 whitespace-nowrap">{fmtDate(h.createdAt)}</td>
                    <td className="py-2.5 px-2 max-w-[200px]">
                      <p className="text-xs text-gray-700 truncate">{h.title || '—'}</p>
                    </td>
                    <td className="py-2.5 px-2">
                      {h.pass === 2 ? (
                        <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-purple-600 bg-purple-50 border border-purple-100 rounded-full px-2 py-0.5">
                          <Sparkles size={9} /> P2
                        </span>
                      ) : (
                        <span className="text-[10px] font-semibold text-gray-500 bg-gray-100 rounded-full px-2 py-0.5">P1</span>
                      )}
                    </td>
                    <td className="py-2.5 px-2 text-right text-xs text-blue-600 font-medium tabular-nums">{fmt(h.inputTokens)}</td>
                    <td className="py-2.5 px-2 text-right text-xs text-purple-600 font-medium tabular-nums">{fmt(h.outputTokens)}</td>
                    <td className="py-2.5 px-2 text-right text-xs font-semibold text-gray-700 tabular-nums">{fmtUsd(h.costUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </motion.div>

      <motion.p
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.25 }}
        className="text-[11px] text-gray-400 text-center pb-2"
      >
        Tarifs : Haiku 4.5 $0.80/$4.00 · Sonnet 4.5 $3.00/$15.00 · Opus 4.5 $15.00/$75.00 (USD/MTok ↑/↓)
      </motion.p>

    </div>
  );
}
