import { useState, useEffect } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';
import {
  BarChart as RBarChart, Bar, AreaChart, Area,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import {
  BarChart3, Zap, DollarSign, Trash2, Clock,
  AlertCircle, Users, CheckCircle2, TrendingUp,
  Sparkles, Calendar, ArrowRight,
  User, ListTodo, Target, Activity, Award,
} from 'lucide-react';
import { resetStats } from '../store/slices/statsSlice';
import { ROLE_COLORS } from '../constants/theme';
import { getTodayActivitySessions } from '../services/firebase';

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmt    = (n) => (n || 0).toLocaleString('fr-FR');
const fmtUsd = (n) => {
  const v = n || 0;
  if (v === 0) return '$0.0000';
  if (v >= 0.01) return `$${v.toFixed(2)}`;
  return `$${v.toFixed(4)}`;
};
const fmtDate = (iso) => {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: '2-digit' }); }
  catch { return iso; }
};
const extractDomain = (url) => {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url || '?'; }
};
const isToday = (iso) => {
  if (!iso) return false;
  const d = new Date(iso); const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
};
const isThisWeek = (iso) => {
  if (!iso) return false;
  const d = new Date(iso); const now = new Date();
  const monday = new Date(now); monday.setDate(now.getDate() - now.getDay() + (now.getDay() === 0 ? -6 : 1)); monday.setHours(0,0,0,0);
  return d >= monday;
};

// ── Composants partagés ───────────────────────────────────────────────────────
const KpiCard = ({ icon: Icon, label, value, sub, color = 'gray', delay = 0, large = false }) => {
  const c = {
    gray:   'bg-gray-100 text-gray-600',
    blue:   'bg-blue-100 text-blue-600',
    green:  'bg-emerald-100 text-emerald-600',
    purple: 'bg-purple-100 text-purple-600',
    amber:  'bg-amber-100 text-amber-600',
    red:    'bg-red-100 text-red-600',
  }[color] || 'bg-gray-100 text-gray-600';
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay }}
      className="glass-card p-5 flex items-start gap-4">
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${c}`}>
        <Icon size={18} />
      </div>
      <div className="min-w-0">
        <p className="text-[11px] text-gray-400 font-semibold uppercase tracking-wide mb-0.5">{label}</p>
        <p className={`font-bold text-gray-900 leading-none ${large ? 'text-3xl' : 'text-2xl'}`}>{value}</p>
        {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
      </div>
    </motion.div>
  );
};

// ── Widget Coût API (super_admin — le plus important) ─────────────────────────
const CostWidget = ({ stats, delay = 0 }) => {
  const todayCost  = stats.history.filter(h => isToday(h.createdAt)).reduce((s, h) => s + (h.costUsd || 0), 0);
  const weekCost   = stats.history.filter(h => isThisWeek(h.createdAt)).reduce((s, h) => s + (h.costUsd || 0), 0);
  const totalTokens = (stats.totalInputTokens || 0) + (stats.totalOutputTokens || 0);
  const inputPct   = totalTokens > 0 ? Math.round(((stats.totalInputTokens || 0) / totalTokens) * 100) : 50;

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay }}
      className="glass-card p-6 col-span-full">
      <div className="flex items-center gap-3 mb-5">
        <div className="w-10 h-10 bg-emerald-500 rounded-xl flex items-center justify-center flex-shrink-0">
          <DollarSign size={18} className="text-white" />
        </div>
        <div>
          <h2 className="font-bold text-gray-900 text-sm">Coût API Anthropic</h2>
          <p className="text-xs text-gray-400">Consommation totale de l'équipe</p>
        </div>
        <div className="ml-auto text-right">
          <p className="text-4xl font-black text-gray-900 leading-none">{fmtUsd(stats.totalCostUsd)}</p>
          <p className="text-xs text-gray-400 mt-1">coût total cumulé</p>
        </div>
      </div>

      {/* Barre input/output */}
      <div className="mb-5">
        <div className="flex justify-between text-[11px] text-gray-400 mb-1.5">
          <span>↑ Tokens entrée : {fmt(stats.totalInputTokens)}</span>
          <span>↓ Tokens sortie : {fmt(stats.totalOutputTokens)}</span>
        </div>
        <div className="h-2 bg-gray-100 rounded-full overflow-hidden flex">
          <div className="h-full bg-blue-400 rounded-l-full transition-all" style={{ width: `${inputPct}%` }} />
          <div className="h-full bg-purple-400 rounded-r-full transition-all" style={{ width: `${100 - inputPct}%` }} />
        </div>
        <div className="flex justify-between text-[10px] text-gray-400 mt-1">
          <span className="flex items-center gap-1"><span className="w-2 h-2 bg-blue-400 rounded-full inline-block"/>Entrée {inputPct}%</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 bg-purple-400 rounded-full inline-block"/>Sortie {100 - inputPct}%</span>
        </div>
      </div>

      {/* Aujourd'hui / Cette semaine / Moy/article */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-emerald-50 rounded-xl px-4 py-3 text-center">
          <p className="text-[11px] text-gray-400 uppercase tracking-wide font-medium mb-1">Aujourd'hui</p>
          <p className="text-xl font-bold text-emerald-700">{fmtUsd(todayCost)}</p>
        </div>
        <div className="bg-blue-50 rounded-xl px-4 py-3 text-center">
          <p className="text-[11px] text-gray-400 uppercase tracking-wide font-medium mb-1">Cette semaine</p>
          <p className="text-xl font-bold text-blue-700">{fmtUsd(weekCost)}</p>
        </div>
        <div className="bg-gray-50 rounded-xl px-4 py-3 text-center">
          <p className="text-[11px] text-gray-400 uppercase tracking-wide font-medium mb-1">Moy / article</p>
          <p className="text-xl font-bold text-gray-700">
            {stats.totalArticles > 0 ? fmtUsd(stats.totalCostUsd / stats.totalArticles) : '$0.00'}
          </p>
        </div>
      </div>
      <p className="text-[10px] text-gray-300 mt-3 text-right">
        Tarifs : Haiku 4.5 $0.80/$4.00 · Sonnet 4.5 $3.00/$15.00 · Opus 4.5 $15.00/$75.00 (USD/MTok ↑/↓)
      </p>
    </motion.div>
  );
};

// ── Widget file d'attente ─────────────────────────────────────────────────────
const QueueWidget = ({ items, users, navigate, delay = 0, title = 'File d\'attente' }) => {
  const pending    = items.filter(i => i.status === 'pending').length;
  const inProgress = items.filter(i => i.status === 'in_progress').length;
  const aValider   = items.filter(i => i.status === 'a_valider');
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay }}
      className="glass-card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
          <Clock size={14} className="text-gray-400" />{title}
        </h2>
        <button onClick={() => navigate('/maj-en-attente')}
          className="text-[11px] text-gray-400 hover:text-gray-600 flex items-center gap-1 transition-colors">
          Voir tout <ArrowRight size={11} />
        </button>
      </div>
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'En attente',  value: pending,           bg: 'bg-amber-50',  text: 'text-amber-700'  },
          { label: 'En cours',    value: inProgress,        bg: 'bg-blue-50',   text: 'text-blue-700'   },
          { label: 'À valider',   value: aValider.length,   bg: 'bg-purple-50', text: 'text-purple-700' },
        ].map(c => (
          <div key={c.label} className={`${c.bg} rounded-xl px-3 py-3 text-center`}>
            <p className={`text-2xl font-bold ${c.text} leading-none`}>{c.value}</p>
            <p className="text-[10px] text-gray-400 font-medium mt-1">{c.label}</p>
          </div>
        ))}
      </div>
      {aValider.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[10px] font-semibold text-purple-500 uppercase tracking-widest">À valider maintenant</p>
          {aValider.slice(0, 3).map(item => (
            <div key={item.id} className="flex items-center gap-2.5 bg-purple-50/60 border border-purple-100 rounded-xl px-3 py-2">
              <div className="w-6 h-6 rounded-lg bg-purple-200 text-purple-700 text-[10px] font-bold flex items-center justify-center flex-shrink-0">
                {extractDomain(item.url)[0]?.toUpperCase() || '?'}
              </div>
              <p className="text-xs text-gray-700 truncate flex-1">{item.title || item.url}</p>
              <CheckCircle2 size={12} className="text-purple-400 flex-shrink-0" />
            </div>
          ))}
          {aValider.length > 3 && <p className="text-[11px] text-gray-400 text-center">+{aValider.length - 3} autres</p>}
        </div>
      )}
    </motion.div>
  );
};

// ── Widget urgents ────────────────────────────────────────────────────────────
const UrgentWidget = ({ items, users, delay = 0 }) => {
  const urgent = items.filter(i => (i.priority || 'normale') === 'haute');
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay }}
      className="glass-card p-5 space-y-4">
      <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
        <AlertCircle size={14} className="text-red-400" />
        Priorité haute
        {urgent.length > 0 && (
          <span className="text-xs font-bold bg-red-500 text-white rounded-full px-2 py-0.5 leading-none">{urgent.length}</span>
        )}
      </h2>
      {urgent.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-6 text-center">
          <CheckCircle2 size={28} className="text-emerald-300 mb-2" />
          <p className="text-sm text-gray-400">Aucun article urgent</p>
        </div>
      ) : (
        <div className="space-y-2">
          {urgent.slice(0, 5).map(item => {
            const assignee = users.find(u => u.id === item.assigneeId);
            return (
              <div key={item.id} className="flex items-center gap-2.5 border border-red-100 bg-red-50/40 rounded-xl px-3 py-2.5">
                <span className="w-1.5 h-1.5 rounded-full bg-red-500 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-gray-800 truncate">{item.title || item.url}</p>
                  <p className="text-[10px] text-gray-400">{extractDomain(item.url)}</p>
                </div>
                {assignee && (
                  <div className={`w-6 h-6 rounded-full text-[10px] font-bold flex items-center justify-center flex-shrink-0 ${ROLE_COLORS[assignee.role] || 'bg-gray-100 text-gray-600'}`}
                    title={`${assignee.firstName} ${assignee.lastName}`}>
                    {[assignee.firstName?.[0], assignee.lastName?.[0]].filter(Boolean).join('').toUpperCase() || '?'}
                  </div>
                )}
              </div>
            );
          })}
          {urgent.length > 5 && <p className="text-[11px] text-gray-400 text-center">+{urgent.length - 5} autres</p>}
        </div>
      )}
    </motion.div>
  );
};

// ── Widget dernières analyses ─────────────────────────────────────────────────
const RecentAnalysesWidget = ({ history, limit = 10, delay = 0 }) => (
  <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay }}
    className="glass-card p-5 space-y-3">
    <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
      <Calendar size={14} className="text-gray-400" />
      Dernières analyses
      {history.length > 0 && <span className="ml-1 text-[11px] font-normal text-gray-400">({Math.min(limit, history.length)} sur {history.length})</span>}
    </h2>
    {history.length === 0 ? (
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
                <th key={h} className="pb-2 px-2 text-[11px] font-semibold text-gray-400 uppercase tracking-wide whitespace-nowrap last:text-right">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {history.slice(0, limit).map((h, i) => (
              <tr key={i} className="hover:bg-gray-50/60 transition-colors">
                <td className="py-2.5 px-2 text-xs text-gray-400 whitespace-nowrap">{fmtDate(h.createdAt)}</td>
                <td className="py-2.5 px-2 max-w-[200px]"><p className="text-xs text-gray-700 truncate">{h.title || '—'}</p></td>
                <td className="py-2.5 px-2">
                  {h.pass === 2
                    ? <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-purple-600 bg-purple-50 border border-purple-100 rounded-full px-2 py-0.5"><Sparkles size={9}/> P2</span>
                    : <span className="text-[10px] font-semibold text-gray-500 bg-gray-100 rounded-full px-2 py-0.5">P1</span>}
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
);

// ── Tooltip custom ────────────────────────────────────────────────────────────
const DashTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-gray-100 rounded-xl shadow-lg px-3 py-2 text-xs">
      <p className="font-semibold text-gray-700 mb-1">{label}</p>
      {payload.map((p, i) => (
        <p key={i} style={{ color: p.color }} className="font-medium">{p.name} : {p.value}</p>
      ))}
    </div>
  );
};

const fmtDuration = (min) => {
  if (!min || min <= 0) return '—';
  const h = Math.floor(min / 60), m = min % 60;
  return h === 0 ? `${m}min` : m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, '0')}`;
};

// ── Widget Activité équipe (super_admin uniquement) ───────────────────────────
const TeamActivityWidget = ({ delay = 0 }) => {
  const [sessions, setSessions] = useState([]);
  const [loading,  setLoading]  = useState(true);
  const ACTIVE_WINDOW = 10 * 60 * 1000; // 10 min

  useEffect(() => {
    getTodayActivitySessions()
      .then(data => setSessions(data))
      .catch(() => setSessions([]))
      .finally(() => setLoading(false));
  }, []);

  const now           = Date.now();
  const activeNow     = sessions.filter(s => s.lastActivityAt && (now - s.lastActivityAt) < ACTIVE_WINDOW);
  const totalActions  = sessions.reduce((s, d) => s + (d.actions?.total || 0), 0);
  const totalMin      = sessions.reduce((s, d) => s + (d.totalActiveMinutes || 0), 0);

  // Agrégation horaire équipe
  const teamHourly = Array.from({ length: 24 }, (_, h) => ({
    heure: `${h}h`,
    activité: sessions.reduce((s, d) => s + (d.hourlyActivity?.[String(h)] || 0), 0),
  }));

  // Leaderboard
  const leaderboard = [...sessions]
    .sort((a, b) => (b.actions?.total || 0) - (a.actions?.total || 0))
    .slice(0, 5);

  const maxActions = Math.max(...leaderboard.map(s => s.actions?.total || 0), 1);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
      className="glass-card p-6 space-y-5"
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-violet-500 to-indigo-600 rounded-xl flex items-center justify-center flex-shrink-0">
            <Activity size={18} className="text-white" />
          </div>
          <div>
            <h2 className="font-bold text-gray-900 text-sm">Activité équipe — aujourd'hui</h2>
            <p className="text-xs text-gray-400">Tracking en temps réel</p>
          </div>
        </div>
        {loading && (
          <div className="w-4 h-4 border-2 border-gray-200 border-t-violet-500 rounded-full animate-spin" />
        )}
      </div>

      {/* KPIs rapides */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-violet-50 rounded-xl px-4 py-3 text-center">
          <p className="text-[11px] text-gray-400 font-medium uppercase mb-1">Actifs maintenant</p>
          <div className="flex items-center justify-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${activeNow.length > 0 ? 'bg-emerald-500 animate-pulse' : 'bg-gray-300'}`} />
            <p className="text-2xl font-bold text-violet-700">{activeNow.length}</p>
          </div>
        </div>
        <div className="bg-indigo-50 rounded-xl px-4 py-3 text-center">
          <p className="text-[11px] text-gray-400 font-medium uppercase mb-1">Actions totales</p>
          <p className="text-2xl font-bold text-indigo-700">{totalActions}</p>
        </div>
        <div className="bg-emerald-50 rounded-xl px-4 py-3 text-center">
          <p className="text-[11px] text-gray-400 font-medium uppercase mb-1">Temps cumulé</p>
          <p className="text-2xl font-bold text-emerald-700">{fmtDuration(totalMin)}</p>
        </div>
      </div>

      {sessions.length === 0 && !loading ? (
        <div className="text-center py-8 text-gray-400">
          <Activity size={32} className="mx-auto mb-2 opacity-25" />
          <p className="text-sm">Aucune activité enregistrée aujourd'hui</p>
          <p className="text-xs mt-1 text-gray-300">Le tracking démarre dès qu'un membre se connecte</p>
        </div>
      ) : sessions.length > 0 && (
        <>
          {/* Membres actifs maintenant */}
          {activeNow.length > 0 && (
            <div className="space-y-2">
              <p className="text-[10px] font-semibold text-emerald-500 uppercase tracking-widest">Connectés maintenant</p>
              <div className="flex flex-wrap gap-2">
                {activeNow.map(s => {
                  const sinceMin = Math.round((now - s.lastActivityAt) / 60000);
                  return (
                    <div key={s.id} className="flex items-center gap-2 bg-emerald-50 border border-emerald-100 rounded-xl px-3 py-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                      <span className="text-xs font-semibold text-gray-700">{s.userName}</span>
                      <span className="text-[10px] text-gray-400">
                        {sinceMin === 0 ? 'à l\'instant' : `il y a ${sinceMin}min`}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Graphique activité horaire équipe */}
          <div className="space-y-2">
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest">Activité horaire (équipe)</p>
            <div className="h-28">
              <ResponsiveContainer width="100%" height="100%">
                <RBarChart data={teamHourly} barCategoryGap="25%">
                  <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
                  <XAxis
                    dataKey="heure"
                    tick={{ fontSize: 9, fill: '#9ca3af' }}
                    axisLine={false}
                    tickLine={false}
                    interval={3}
                  />
                  <YAxis hide />
                  <Tooltip content={<DashTooltip />} cursor={{ fill: '#f5f3ff' }} />
                  <Bar dataKey="activité" fill="#8b5cf6" radius={[2, 2, 0, 0]} />
                </RBarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Leaderboard */}
          {leaderboard.length > 0 && (
            <div className="space-y-2">
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest flex items-center gap-1.5">
                <Award size={11} className="text-amber-500" />Classement du jour
              </p>
              <div className="space-y-2">
                {leaderboard.map((s, i) => {
                  const actions = s.actions?.total || 0;
                  const pct = Math.round((actions / maxActions) * 100);
                  const badgeCls = i === 0
                    ? 'bg-amber-100 text-amber-700 border-amber-200'
                    : 'bg-gray-100 text-gray-500 border-gray-200';
                  return (
                    <div key={s.id} className="flex items-center gap-3">
                      <span className={`w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center border ${badgeCls}`}>
                        {i + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-0.5">
                          <div className="flex items-center gap-1.5">
                            <p className="text-xs font-semibold text-gray-800 truncate">{s.userName}</p>
                            <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${
                              s.userRole === 'cq_ia'
                                ? 'bg-blue-50 text-blue-600'
                                : 'bg-purple-50 text-purple-600'
                            }`}>
                              {s.userRole === 'cq_ia' ? 'CQ' : 'Mgr'}
                            </span>
                          </div>
                          <span className="text-xs font-bold text-gray-700 tabular-nums">{actions}</span>
                        </div>
                        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${
                              s.userRole === 'cq_ia' ? 'bg-blue-400' : 'bg-purple-400'
                            }`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </motion.div>
  );
};

// ══════════════════════════════════════════════════════════════════════════════
// 👑 SUPER ADMIN — Vue globale
// ══════════════════════════════════════════════════════════════════════════════
function DashboardSuperAdmin({ stats, history, pendingItems, users, navigate, dispatch }) {
  const activeItems = pendingItems.filter(i => i.status !== 'done');
  const memberStats = users
    .filter(u => ['cq_ia', 'manager'].includes(u.role))
    .map(u => ({
      ...u,
      completed: history.filter(a => a.assigneeId === u.id).length,
      inQueue:   activeItems.filter(i => i.assigneeId === u.id && i.status === 'pending').length,
      aValider:  activeItems.filter(i => i.assigneeId === u.id && i.status === 'a_valider').length,
    }))
    .sort((a, b) => b.completed - a.completed);

  const todayCount = stats.history.filter(h => isToday(h.createdAt)).length;
  const weekCount  = stats.history.filter(h => isThisWeek(h.createdAt)).length;

  const handleReset = () => {
    if (window.confirm('Réinitialiser toutes les statistiques ? Cette action est irréversible.')) {
      dispatch(resetStats());
      toast.success('Statistiques réinitialisées');
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <BarChart3 size={22} className="text-gray-700" />Dashboard
          </h1>
          <p className="text-sm text-gray-500 mt-1">Vue globale — toute l'activité du SaaS</p>
        </div>
        <button onClick={handleReset}
          className="btn-ghost flex items-center gap-2 text-red-400 hover:text-red-600 hover:bg-red-50 text-xs">
          <Trash2 size={13} />Réinitialiser les stats
        </button>
      </div>

      {/* 💰 Widget coût — en premier, le plus important */}
      <div className="grid grid-cols-1">
        <CostWidget stats={stats} delay={0} />
      </div>

      {/* KPIs globaux */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <KpiCard icon={BarChart3}  label="Articles traités"   value={history.length.toLocaleString('fr-FR')} sub="dans l'historique"            color="gray"   delay={0.04} />
        <KpiCard icon={Zap}        label="Tokens totaux"      value={fmt((stats.totalInputTokens||0) + (stats.totalOutputTokens||0))} sub={`↑ ${fmt(stats.totalInputTokens)} · ↓ ${fmt(stats.totalOutputTokens)}`} color="blue"   delay={0.06} />
        <KpiCard icon={Calendar}   label="MAJ aujourd'hui"    value={todayCount} sub={`${weekCount} cette semaine`}   color="amber"  delay={0.08} />
        <KpiCard icon={Users}      label="Membres actifs"     value={users.filter(u => u.status === 'active').length} sub={`${users.length} au total`} color="purple" delay={0.10} />
      </div>

      {/* File d'attente + Urgents */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <QueueWidget items={activeItems} users={users} navigate={navigate} delay={0.12} />
        <UrgentWidget items={activeItems} users={users} delay={0.14} />
      </div>

      {/* Productivité équipe */}
      {memberStats.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.16 }}
          className="glass-card p-5 space-y-4">
          <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
            <Users size={14} className="text-gray-400" />Productivité équipe
          </h2>
          <div className="overflow-x-auto -mx-1">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b border-gray-100">
                  {['Membre', 'Rôle', 'Terminés', 'En attente', 'À valider'].map(h => (
                    <th key={h} className="pb-2 px-3 text-[11px] font-semibold text-gray-400 uppercase tracking-wide whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {memberStats.map(m => {
                  const initials  = [m.firstName?.[0], m.lastName?.[0]].filter(Boolean).join('').toUpperCase() || '?';
                  const roleCls   = ROLE_COLORS[m.role] || 'bg-gray-100 text-gray-600';
                  const roleLabel = m.role === 'cq_ia' ? 'CQ IA' : 'Manager';
                  const maxCompleted = Math.max(...memberStats.map(x => x.completed), 1);
                  return (
                    <tr key={m.id} className="hover:bg-gray-50/60 transition-colors">
                      <td className="py-3 px-3">
                        <div className="flex items-center gap-2.5">
                          <div className={`w-7 h-7 rounded-full text-[11px] font-bold flex items-center justify-center flex-shrink-0 ${roleCls}`}>{initials}</div>
                          <div>
                            <p className="text-xs font-semibold text-gray-800">{m.firstName} {m.lastName}</p>
                            {m.email && <p className="text-[10px] text-gray-400 truncate max-w-[140px]">{m.email}</p>}
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-3">
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${roleCls}`}>{roleLabel}</span>
                      </td>
                      <td className="py-3 px-3">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-bold text-emerald-600">{m.completed}</span>
                          {m.completed > 0 && (
                            <div className="h-1.5 w-16 bg-gray-100 rounded-full overflow-hidden">
                              <div className="h-full bg-emerald-400 rounded-full" style={{ width: `${Math.min(100, (m.completed / maxCompleted) * 100)}%` }} />
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-3">
                        <span className={`text-sm font-bold ${m.inQueue > 0 ? 'text-amber-600' : 'text-gray-300'}`}>{m.inQueue}</span>
                      </td>
                      <td className="py-3 px-3">
                        <span className={`text-sm font-bold ${m.aValider > 0 ? 'text-purple-600' : 'text-gray-300'}`}>{m.aValider}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </motion.div>
      )}

      {/* Activité équipe — tracking temps réel */}
      <TeamActivityWidget delay={0.17} />

      {/* Dernières analyses */}
      <RecentAnalysesWidget history={stats.history} limit={20} delay={0.18} />
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// 🧑‍💼 MANAGER — Vue équipe
// ══════════════════════════════════════════════════════════════════════════════
function DashboardManager({ stats, history, pendingItems, users, navigate }) {
  const activeItems = pendingItems.filter(i => i.status !== 'done');
  const cqMembers   = users.filter(u => u.role === 'cq_ia');

  const memberStats = cqMembers.map(u => ({
    ...u,
    completed: history.filter(a => a.assigneeId === u.id).length,
    inQueue:   activeItems.filter(i => i.assigneeId === u.id && i.status === 'pending').length,
    aValider:  activeItems.filter(i => i.assigneeId === u.id && i.status === 'a_valider').length,
  })).sort((a, b) => b.completed - a.completed);

  const weekCount  = stats.history.filter(h => isThisWeek(h.createdAt)).length;
  const weekCost   = stats.history.filter(h => isThisWeek(h.createdAt)).reduce((s, h) => s + (h.costUsd || 0), 0);
  const aValiderAll = activeItems.filter(i => i.status === 'a_valider');

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <BarChart3 size={22} className="text-gray-700" />Dashboard
        </h1>
        <p className="text-sm text-gray-500 mt-1">Activité de votre équipe</p>
      </div>

      {/* KPIs équipe */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <KpiCard icon={BarChart3}   label="MAJ équipe (total)" value={history.length.toLocaleString('fr-FR')} sub="dans l'historique"        color="gray"   delay={0}    />
        <KpiCard icon={Calendar}    label="MAJ cette semaine"  value={weekCount}                              sub="pour toute l'équipe"       color="blue"   delay={0.04} />
        <KpiCard icon={CheckCircle2} label="À valider"         value={aValiderAll.length}                    sub="en attente de validation"  color="purple" delay={0.08} />
        <KpiCard icon={DollarSign}  label="Coût cette semaine" value={fmtUsd(weekCost)}                      sub={`Total : ${fmtUsd(stats.totalCostUsd)}`} color="green" delay={0.12} />
      </div>

      {/* File d'attente + Urgents */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <QueueWidget items={activeItems} users={users} navigate={navigate} delay={0.14} title="File d'attente équipe" />
        <UrgentWidget items={activeItems} users={users} delay={0.16} />
      </div>

      {/* Performance CQ IA */}
      {memberStats.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.18 }}
          className="glass-card p-5 space-y-4">
          <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
            <TrendingUp size={14} className="text-gray-400" />Performance CQ IA
          </h2>
          <div className="overflow-x-auto -mx-1">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b border-gray-100">
                  {['Membre', 'Terminés', 'En attente', 'À valider'].map(h => (
                    <th key={h} className="pb-2 px-3 text-[11px] font-semibold text-gray-400 uppercase tracking-wide whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {memberStats.map(m => {
                  const initials = [m.firstName?.[0], m.lastName?.[0]].filter(Boolean).join('').toUpperCase() || '?';
                  const maxCompleted = Math.max(...memberStats.map(x => x.completed), 1);
                  return (
                    <tr key={m.id} className="hover:bg-gray-50/60 transition-colors">
                      <td className="py-3 px-3">
                        <div className="flex items-center gap-2.5">
                          <div className="w-7 h-7 rounded-full bg-blue-100 text-blue-700 text-[11px] font-bold flex items-center justify-center flex-shrink-0">{initials}</div>
                          <p className="text-xs font-semibold text-gray-800">{m.firstName} {m.lastName}</p>
                        </div>
                      </td>
                      <td className="py-3 px-3">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-bold text-emerald-600">{m.completed}</span>
                          {m.completed > 0 && (
                            <div className="h-1.5 w-16 bg-gray-100 rounded-full overflow-hidden">
                              <div className="h-full bg-emerald-400 rounded-full" style={{ width: `${Math.min(100, (m.completed / maxCompleted) * 100)}%` }} />
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-3">
                        <span className={`text-sm font-bold ${m.inQueue > 0 ? 'text-amber-600' : 'text-gray-300'}`}>{m.inQueue}</span>
                      </td>
                      <td className="py-3 px-3">
                        <span className={`text-sm font-bold ${m.aValider > 0 ? 'text-purple-600' : 'text-gray-300'}`}>{m.aValider}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </motion.div>
      )}

      {/* Dernières analyses équipe */}
      <RecentAnalysesWidget history={stats.history} limit={10} delay={0.20} />
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// ✅ CQ IA — Vue personnelle
// ══════════════════════════════════════════════════════════════════════════════
function DashboardCqIa({ stats, history, pendingItems, navigate, authUid, authUsername }) {
  const isMe = (id) => id === authUid || id === authUsername;

  const myHistory  = history.filter(a => isMe(a.assigneeId));
  const myItems    = pendingItems.filter(i => isMe(i.assigneeId) && i.status !== 'done');
  const myPending  = myItems.filter(i => i.status === 'pending').length;
  const myProgress = myItems.filter(i => i.status === 'in_progress').length;
  const myValider  = myItems.filter(i => i.status === 'a_valider');
  const myToday    = myHistory.filter(a => isToday(a.createdAt)).length;
  const myWeek     = myHistory.filter(a => isThisWeek(a.createdAt)).length;

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <User size={22} className="text-gray-700" />Mon tableau de bord
        </h1>
        <p className="text-sm text-gray-500 mt-1">Votre activité personnelle</p>
      </div>

      {/* KPIs personnels */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <KpiCard icon={CheckCircle2} label="Mes MAJ (total)"    value={myHistory.length}  sub="dans l'historique"       color="green"  delay={0}    />
        <KpiCard icon={Calendar}     label="Aujourd'hui"        value={myToday}           sub={`${myWeek} cette semaine`} color="blue" delay={0.04} />
        <KpiCard icon={ListTodo}     label="En attente"         value={myPending}         sub={`${myProgress} en cours`} color="amber" delay={0.08} />
        <KpiCard icon={Target}       label="À valider"          value={myValider.length}  sub="prêts à soumettre"       color="purple" delay={0.12} />
      </div>

      {/* Mes tâches */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <QueueWidget items={myItems} users={[]} navigate={navigate} delay={0.14} title="Mes tâches" />

        {/* À valider en détail */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.16 }}
          className="glass-card p-5 space-y-4">
          <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
            <CheckCircle2 size={14} className="text-purple-400" />Prêts à valider
          </h2>
          {myValider.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-6 text-center">
              <CheckCircle2 size={28} className="text-gray-200 mb-2" />
              <p className="text-sm text-gray-400">Aucun article à valider</p>
            </div>
          ) : (
            <div className="space-y-2">
              {myValider.map(item => (
                <div key={item.id} className="flex items-center gap-2.5 bg-purple-50/60 border border-purple-100 rounded-xl px-3 py-2.5">
                  <div className="w-6 h-6 rounded-lg bg-purple-200 text-purple-700 text-[10px] font-bold flex items-center justify-center flex-shrink-0">
                    {extractDomain(item.url)[0]?.toUpperCase() || '?'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-gray-800 truncate">{item.title || item.url}</p>
                    <p className="text-[10px] text-gray-400">{extractDomain(item.url)}</p>
                  </div>
                  <button onClick={() => navigate('/maj-en-attente')}
                    className="text-[10px] text-purple-500 hover:text-purple-700 font-medium flex items-center gap-0.5">
                    Voir <ArrowRight size={10} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </motion.div>
      </div>

      {/* Mes dernières analyses — filtrées sur l'utilisateur connecté */}
      <RecentAnalysesWidget
        history={stats.history.filter(h => isMe(h.assigneeId))}
        limit={8}
        delay={0.18}
      />
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// 🔀 Routeur de rôles
// ══════════════════════════════════════════════════════════════════════════════
export default function Dashboard() {
  const dispatch     = useDispatch();
  const navigate     = useNavigate();
  const role         = useSelector(s => s.auth.role) || 'cq_ia';
  const authUid      = useSelector(s => s.auth.uid);
  const authUsername = useSelector(s => s.auth.username);
  const stats        = useSelector(s => s.stats);
  const history      = useSelector(s => s.articles.history);
  const pendingItems = useSelector(s => s.pending.list);
  const users        = useSelector(s => s.users.list);

  const props = { stats, history, pendingItems, users, navigate, dispatch, authUid, authUsername };

  if (role === 'cq_ia')   return <DashboardCqIa    {...props} />;
  if (role === 'manager') return <DashboardManager {...props} />;
  return                         <DashboardSuperAdmin {...props} />;
}
