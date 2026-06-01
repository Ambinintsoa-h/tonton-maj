import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  BarChart, Bar, AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import {
  X, Clock, Coffee, Zap, TrendingUp,
  FileText, MessageSquare, CheckCircle2, AlertCircle,
  Calendar, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { getUserActivitySessions } from '../../services/firebase';
import { AccountAvatar } from '../account/MonComptePanel';

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmtTime = (ts) => {
  if (!ts) return '—';
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}h${String(d.getMinutes()).padStart(2, '0')}`;
};

const fmtDuration = (minutes) => {
  if (!minutes || minutes <= 0) return '—';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, '0')}`;
};

const localDate = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const dateLabel = (dateStr) => {
  if (!dateStr) return '—';
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
};

const ROLE_COLORS = {
  cq_ia:   { bar: '#3b82f6', area: '#93c5fd', badge: 'bg-blue-50 text-blue-700 border border-blue-200' },
  manager: { bar: '#8b5cf6', area: '#c4b5fd', badge: 'bg-purple-50 text-purple-700 border border-purple-200' },
};

// ── Tooltip custom Recharts ───────────────────────────────────────────────────
const ChartTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-gray-100 rounded-xl shadow-lg px-3 py-2 text-xs">
      <p className="font-semibold text-gray-700 mb-1">{label}</p>
      {payload.map((p, i) => (
        <p key={i} style={{ color: p.color }} className="font-medium">
          {p.name} : {p.value}
        </p>
      ))}
    </div>
  );
};

// ── Barre de timeline visuelle ────────────────────────────────────────────────
function TimelineBar({ session }) {
  if (!session?.firstActivityAt) return (
    <div className="h-6 bg-gray-100 rounded-lg flex items-center justify-center">
      <p className="text-[10px] text-gray-400">Aucune donnée</p>
    </div>
  );

  const start = session.firstActivityAt;
  const end   = session.lastActivityAt || Date.now();
  const total = end - start;
  if (total <= 0) return null;

  const pauses = (session.pauses || []).filter(p => p.start && p.end);

  // Convertir en segments colorés
  const segments = [];
  let cursor = start;
  const sortedPauses = [...pauses].sort((a, b) => a.start - b.start);

  sortedPauses.forEach(p => {
    if (p.start > cursor) {
      segments.push({ type: 'active', start: cursor, end: p.start });
    }
    segments.push({ type: 'pause', start: p.start, end: p.end });
    cursor = p.end;
  });
  if (cursor < end) segments.push({ type: 'active', start: cursor, end });

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 h-5 rounded-lg overflow-hidden">
        {segments.map((seg, i) => {
          const width = ((seg.end - seg.start) / total) * 100;
          return (
            <div
              key={i}
              title={`${fmtTime(seg.start)} → ${fmtTime(seg.end)}`}
              className={`h-full rounded-sm ${seg.type === 'active' ? 'bg-emerald-400' : 'bg-gray-200'}`}
              style={{ width: `${Math.max(width, 0.5)}%` }}
            />
          );
        })}
      </div>
      <div className="flex justify-between text-[10px] text-gray-400">
        <span>{fmtTime(start)}</span>
        <span className="flex items-center gap-3">
          <span className="flex items-center gap-1"><span className="w-2 h-2 bg-emerald-400 rounded-sm inline-block" />Actif</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 bg-gray-200 rounded-sm inline-block" />Pause</span>
        </span>
        <span>{fmtTime(end)}</span>
      </div>
    </div>
  );
}

// ── Panneau principal ─────────────────────────────────────────────────────────
export default function MemberStatsPanel({ user, onClose }) {
  const [sessions,   setSessions]   = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [activeTab,  setActiveTab]  = useState('today'); // 'today' | '7days'
  const [dayOffset,  setDayOffset]  = useState(0); // 0 = today, 1 = yesterday…

  const colors = ROLE_COLORS[user.role] || ROLE_COLORS.cq_ia;
  const today  = localDate();

  useEffect(() => {
    setLoading(true);
    getUserActivitySessions(user.id, 30)
      .then(data => setSessions(data))
      .catch(() => setSessions([]))
      .finally(() => setLoading(false));
  }, [user.id]);

  // Session du jour affiché (avec offset)
  const targetDate = (() => {
    const d = new Date();
    d.setDate(d.getDate() - dayOffset);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  })();

  const currentSession = sessions.find(s => s.date === targetDate) || null;

  // ── Données pour le graphique horaire ──
  const hourlyData = Array.from({ length: 24 }, (_, h) => ({
    hour: `${h}h`,
    activité: currentSession?.hourlyActivity?.[String(h)] || 0,
  }));

  // ── Données pour la tendance 7 jours ──
  const last7 = sessions.slice(0, 7);
  const trendData = [...last7].reverse().map(s => ({
    date:    dateLabel(s.date),
    actions: s.actions?.total || 0,
    minutes: s.totalActiveMinutes || 0,
  }));

  // ── Pauses de la session courante ──
  const pauses = (currentSession?.pauses || [])
    .filter(p => p.start && p.end)
    .sort((a, b) => a.start - b.start);

  const totalPauseMin = pauses.reduce((acc, p) => acc + Math.round((p.end - p.start) / 60000), 0);

  // ── Statut actif maintenant ──
  const isActiveNow = currentSession?.lastActivityAt
    && targetDate === today
    && (Date.now() - currentSession.lastActivityAt) < 10 * 60 * 1000;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50"
        style={{ background: 'rgba(0,0,0,0.3)', backdropFilter: 'blur(4px)' }}
        onClick={e => e.target === e.currentTarget && onClose()}
      >
        <motion.div
          initial={{ x: '100%' }}
          animate={{ x: 0 }}
          exit={{ x: '100%' }}
          transition={{ type: 'spring', damping: 28, stiffness: 220 }}
          className="absolute right-0 inset-y-0 w-full max-w-2xl bg-white shadow-2xl overflow-y-auto"
        >
          {/* ── Header ── */}
          <div className="sticky top-0 z-10 bg-white border-b border-gray-100 px-6 py-4 flex items-center gap-4">
            <AccountAvatar
              avatarUrl={user.avatarUrl || ''}
              prenom={user.firstName || ''}
              nom={user.lastName || ''}
              username={user.username || ''}
              size={44}
            />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="font-bold text-gray-900 text-base">
                  {user.firstName} {user.lastName}
                </h2>
                <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${colors.badge}`}>
                  {user.role === 'cq_ia' ? 'CQ IA' : 'Manager'}
                </span>
                {isActiveNow && (
                  <span className="flex items-center gap-1 text-[11px] font-semibold text-emerald-600 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    Actif maintenant
                  </span>
                )}
              </div>
              <p className="text-xs text-gray-400 mt-0.5">{user.email}</p>
            </div>
            <button onClick={onClose} className="btn-ghost !px-1.5 !py-1.5 flex-shrink-0">
              <X size={18} />
            </button>
          </div>

          <div className="p-6 space-y-6">

            {/* ── Onglets ── */}
            <div className="flex items-center gap-1 bg-gray-100 rounded-xl p-1">
              {[
                { key: 'today',  label: 'Par jour' },
                { key: '7days',  label: '7 derniers jours' },
              ].map(t => (
                <button
                  key={t.key}
                  onClick={() => setActiveTab(t.key)}
                  className={`flex-1 px-3 py-1.5 text-xs rounded-lg font-medium transition-all ${
                    activeTab === t.key ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-16 text-gray-400">
                <div className="w-6 h-6 border-2 border-gray-200 border-t-gray-500 rounded-full animate-spin mr-3" />
                <span className="text-sm">Chargement des données…</span>
              </div>
            ) : activeTab === 'today' ? (

              /* ══ VUE JOURNÉE ══ */
              <div className="space-y-5">

                {/* Sélecteur de jour */}
                <div className="flex items-center justify-between">
                  <button
                    onClick={() => setDayOffset(d => d + 1)}
                    className="btn-ghost !px-2 !py-1"
                    disabled={dayOffset >= 29}
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <div className="text-center">
                    <p className="text-sm font-semibold text-gray-900">
                      {dayOffset === 0 ? "Aujourd'hui" : dayOffset === 1 ? 'Hier' : dateLabel(targetDate)}
                    </p>
                    <p className="text-[11px] text-gray-400">{targetDate}</p>
                  </div>
                  <button
                    onClick={() => setDayOffset(d => Math.max(0, d - 1))}
                    className="btn-ghost !px-2 !py-1"
                    disabled={dayOffset === 0}
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>

                {!currentSession ? (
                  <div className="text-center py-12 text-gray-400">
                    <Calendar size={36} className="mx-auto mb-3 opacity-30" />
                    <p className="text-sm font-medium">Aucune activité ce jour</p>
                    <p className="text-xs mt-1">L'utilisateur ne s'est pas connecté</p>
                  </div>
                ) : (
                  <>
                    {/* KPIs */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      {[
                        {
                          icon: Clock, label: 'Début',
                          value: fmtTime(currentSession.firstActivityAt),
                          color: 'text-gray-900', bg: 'bg-gray-50',
                        },
                        {
                          icon: Zap, label: 'Temps actif',
                          value: fmtDuration(currentSession.totalActiveMinutes),
                          color: 'text-emerald-700', bg: 'bg-emerald-50',
                        },
                        {
                          icon: Coffee, label: 'Pauses',
                          value: pauses.length > 0 ? `${pauses.length} (${fmtDuration(totalPauseMin)})` : '—',
                          color: 'text-amber-700', bg: 'bg-amber-50',
                        },
                        {
                          icon: TrendingUp, label: 'Actions',
                          value: currentSession.actions?.total || 0,
                          color: colors.bar.startsWith('#3') ? 'text-blue-700' : 'text-purple-700',
                          bg: colors.bar.startsWith('#3') ? 'bg-blue-50' : 'bg-purple-50',
                        },
                      ].map(k => (
                        <div key={k.label} className={`${k.bg} rounded-xl px-4 py-3 text-center`}>
                          <k.icon size={14} className={`mx-auto mb-1 ${k.color}`} />
                          <p className={`text-xl font-bold ${k.color} leading-none`}>{k.value}</p>
                          <p className="text-[10px] text-gray-400 mt-1">{k.label}</p>
                        </div>
                      ))}
                    </div>

                    {/* Timeline */}
                    <div className="space-y-2">
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Timeline</p>
                      <TimelineBar session={currentSession} />
                    </div>

                    {/* Graphique horaire */}
                    <div className="space-y-2">
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Activité horaire</p>
                      <div className="h-36">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={hourlyData} barCategoryGap="30%">
                            <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
                            <XAxis
                              dataKey="hour"
                              tick={{ fontSize: 10, fill: '#9ca3af' }}
                              axisLine={false}
                              tickLine={false}
                              interval={3}
                            />
                            <YAxis hide />
                            <Tooltip content={<ChartTooltip />} cursor={{ fill: '#f9fafb' }} />
                            <Bar dataKey="activité" fill={colors.bar} radius={[3, 3, 0, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>

                    {/* Répartition actions */}
                    <div className="space-y-2">
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Répartition des actions</p>
                      <div className="grid grid-cols-2 gap-2.5">
                        {[
                          { label: 'Articles traités',  icon: FileText,      key: 'articlesUpdated',  color: 'text-blue-600 bg-blue-50' },
                          { label: 'Tickets créés',     icon: AlertCircle,   key: 'ticketsCreated',   color: 'text-amber-600 bg-amber-50' },
                          { label: 'Commentaires',      icon: MessageSquare, key: 'ticketsCommented', color: 'text-gray-600 bg-gray-50' },
                          { label: 'Tickets résolus',   icon: CheckCircle2,  key: 'ticketsResolved',  color: 'text-emerald-600 bg-emerald-50' },
                        ].map(a => {
                          const count = currentSession.actions?.[a.key] || 0;
                          return (
                            <div key={a.key} className="flex items-center gap-3 bg-gray-50 rounded-xl px-3 py-2.5">
                              <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${a.color}`}>
                                <a.icon size={14} />
                              </div>
                              <div>
                                <p className="text-sm font-bold text-gray-900">{count}</p>
                                <p className="text-[10px] text-gray-400">{a.label}</p>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Pauses détaillées */}
                    {pauses.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                          Pauses ({fmtDuration(totalPauseMin)} total)
                        </p>
                        <div className="space-y-1.5">
                          {pauses.map((p, i) => {
                            const dur = Math.round((p.end - p.start) / 60000);
                            return (
                              <div key={i} className="flex items-center justify-between bg-amber-50 border border-amber-100 rounded-xl px-3 py-2">
                                <div className="flex items-center gap-2">
                                  <Coffee size={12} className="text-amber-500" />
                                  <span className="text-xs text-gray-700 font-medium">
                                    {fmtTime(p.start)} → {fmtTime(p.end)}
                                  </span>
                                </div>
                                <span className="text-xs font-semibold text-amber-700">{fmtDuration(dur)}</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>

            ) : (

              /* ══ VUE 7 JOURS ══ */
              <div className="space-y-5">
                {sessions.length === 0 ? (
                  <div className="text-center py-12 text-gray-400">
                    <TrendingUp size={36} className="mx-auto mb-3 opacity-30" />
                    <p className="text-sm font-medium">Aucune donnée disponible</p>
                    <p className="text-xs mt-1">Le tracking démarre à la prochaine connexion</p>
                  </div>
                ) : (
                  <>
                    {/* KPIs semaine */}
                    <div className="grid grid-cols-3 gap-3">
                      {[
                        {
                          label: 'Jours actifs',
                          value: last7.length,
                          color: 'text-gray-900', bg: 'bg-gray-50',
                        },
                        {
                          label: 'Total actions',
                          value: last7.reduce((s, d) => s + (d.actions?.total || 0), 0),
                          color: colors.bar.startsWith('#3') ? 'text-blue-700' : 'text-purple-700',
                          bg: colors.bar.startsWith('#3') ? 'bg-blue-50' : 'bg-purple-50',
                        },
                        {
                          label: 'Temps moyen',
                          value: fmtDuration(
                            last7.length > 0
                              ? Math.round(last7.reduce((s, d) => s + (d.totalActiveMinutes || 0), 0) / last7.length)
                              : 0
                          ),
                          color: 'text-emerald-700', bg: 'bg-emerald-50',
                        },
                      ].map(k => (
                        <div key={k.label} className={`${k.bg} rounded-xl px-4 py-3 text-center`}>
                          <p className={`text-2xl font-bold ${k.color} leading-none`}>{k.value}</p>
                          <p className="text-[10px] text-gray-400 mt-1">{k.label}</p>
                        </div>
                      ))}
                    </div>

                    {/* Tendance actions */}
                    <div className="space-y-2">
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Actions par jour</p>
                      <div className="h-44">
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart data={trendData}>
                            <defs>
                              <linearGradient id="colorActions" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%"  stopColor={colors.bar} stopOpacity={0.25} />
                                <stop offset="95%" stopColor={colors.bar} stopOpacity={0.02} />
                              </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
                            <XAxis
                              dataKey="date"
                              tick={{ fontSize: 10, fill: '#9ca3af' }}
                              axisLine={false}
                              tickLine={false}
                            />
                            <YAxis hide />
                            <Tooltip content={<ChartTooltip />} />
                            <Area
                              type="monotone"
                              dataKey="actions"
                              name="Actions"
                              stroke={colors.bar}
                              strokeWidth={2}
                              fill="url(#colorActions)"
                              dot={{ fill: colors.bar, r: 3, strokeWidth: 0 }}
                              activeDot={{ r: 5 }}
                            />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                    </div>

                    {/* Tendance temps actif */}
                    <div className="space-y-2">
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Temps actif / jour (minutes)</p>
                      <div className="h-36">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={trendData} barCategoryGap="35%">
                            <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
                            <XAxis
                              dataKey="date"
                              tick={{ fontSize: 10, fill: '#9ca3af' }}
                              axisLine={false}
                              tickLine={false}
                            />
                            <YAxis hide />
                            <Tooltip content={<ChartTooltip />} formatter={v => [`${v} min`, 'Temps actif']} />
                            <Bar dataKey="minutes" name="Minutes actives" fill="#10b981" radius={[3, 3, 0, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>

                    {/* Tableau détaillé */}
                    <div className="space-y-2">
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Détail par jour</p>
                      <div className="overflow-x-auto -mx-1">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b border-gray-100">
                              {['Date', 'Début', 'Fin', 'Temps actif', 'Pauses', 'Actions'].map(h => (
                                <th key={h} className="pb-2 px-2 text-[10px] font-semibold text-gray-400 uppercase tracking-wide text-left whitespace-nowrap">
                                  {h}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-50">
                            {[...sessions].slice(0, 14).map(s => (
                              <tr key={s.id} className="hover:bg-gray-50/60 transition-colors">
                                <td className="py-2.5 px-2 font-medium text-gray-700">{dateLabel(s.date)}</td>
                                <td className="py-2.5 px-2 text-gray-500">{fmtTime(s.firstActivityAt)}</td>
                                <td className="py-2.5 px-2 text-gray-500">{fmtTime(s.lastActivityAt)}</td>
                                <td className="py-2.5 px-2 font-semibold text-emerald-600">{fmtDuration(s.totalActiveMinutes)}</td>
                                <td className="py-2.5 px-2 text-amber-600">{(s.pauses || []).length || '—'}</td>
                                <td className="py-2.5 px-2 font-bold" style={{ color: colors.bar }}>{s.actions?.total || 0}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
