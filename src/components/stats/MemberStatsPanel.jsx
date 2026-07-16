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
import { getUserActivitySessions, getArticleTimeAll } from '../../services/firebase';
import { AccountAvatar } from '../account/MonComptePanel';

// ── Helpers ───────────────────────────────────────────────────────────────────
// Convertit un timestamp UTC en heure locale du viewer (super_admin)
// new Date(ts) gère automatiquement le timezone de l'appareil du super_admin
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

// Date courte depuis un timestamp (tableaux MAJ fait)
const tsLabel = (ts) => ts
  ? new Date(ts).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
  : '—';

const ROLE_COLORS = {
  cq_ia:       { bar: '#3b82f6', area: '#93c5fd', badge: 'bg-blue-50 text-blue-700 border border-blue-200' },
  manager:     { bar: '#8b5cf6', area: '#c4b5fd', badge: 'bg-purple-50 text-purple-700 border border-purple-200' },
  support:     { bar: '#10b981', area: '#6ee7b7', badge: 'bg-emerald-50 text-emerald-700 border border-emerald-200' },
  super_admin: { bar: '#f59e0b', area: '#fcd34d', badge: 'bg-amber-50 text-amber-700 border border-amber-200' },
};

const ROLE_LABELS = { cq_ia: 'CQ IA', manager: 'Manager', support: 'Support', super_admin: 'Admin' };

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

/**
 * Construit la liste ordonnée de segments à partir de connections[], pauses[] et lastActivityAt.
 *
 * Types de segments :
 *   'active'  → vert   : période d'utilisation active du SaaS
 *   'pause'   → gris   : inactivité > 10 min sans fermer le navigateur
 *   'offline' → ardoise: navigateur fermé (gap entre lastActivityAt et reconnexion suivante)
 */
/**
 * Construit les segments active / pause / offline à partir de la session.
 *
 * Modèle de données :
 *   connections[i].at  = timestamp d'ouverture du navigateur (session i)
 *   closes[i]          = timestamp de fermeture du navigateur (session i) — nouveau champ
 *   → offline[i]       = closes[i] → connections[i+1].at
 *
 * Pour les anciennes sessions sans closes[], le fallback est :
 *   connEnd = connections[i+1].at  (pas d'offline calculable → tout en active/pause)
 */
const buildSegments = (session) => {
  // Tableau des heures d'ouverture (triées)
  const opens = [...(session.connections || [{ at: session.firstActivityAt }])]
    .filter(c => c?.at)
    .map(c => c.at)
    .sort((a, b) => a - b);

  // Tableau des heures de fermeture (triées) — parallèle à opens[]
  const closes = [...(session.closes || [])]
    .filter(Boolean)
    .sort((a, b) => a - b);

  const lastAct = session.lastActivityAt || Date.now();

  // Pauses inactivité — on filtre uniquement les clairement corrompues (> 4h)
  const MAX_PAUSE_MS = 4 * 60 * 60 * 1000;
  const pauses = [...(session.pauses || [])]
    .filter(p => p.start && p.end && p.end > p.start && (p.end - p.start) <= MAX_PAUSE_MS)
    .sort((a, b) => a.start - b.start);

  const segments = [];

  opens.forEach((openAt, i) => {
    const nextOpenAt = opens[i + 1] ?? null;

    // Heure de fermeture réelle pour cette session
    // closes[i] correspond à opens[i] (tableaux parallèles, même ordre chronologique)
    const closeAt = closes[i] ?? null;

    // connEnd = fin de la période de travail de cette session :
    //   - closeAt si enregistré et cohérent (> openAt, < prochaine ouverture)
    //   - sinon nextOpenAt (fallback : pas de fermeture connue → la fenêtre va jusqu'à la prochaine ouverture)
    //   - sinon lastAct (dernière session de la journée)
    const connEnd = nextOpenAt
      ? (closeAt && closeAt > openAt && closeAt < nextOpenAt ? closeAt : nextOpenAt)
      : lastAct;

    // Pauses dont le début est dans cette fenêtre [openAt, connEnd]
    const periodPauses = pauses.filter(p => p.start >= openAt && p.start < connEnd);
    let cursor = openAt;

    periodPauses.forEach(p => {
      const pauseStart = Math.max(p.start, cursor);
      const pauseEnd   = Math.min(p.end, connEnd); // jamais au-delà de connEnd
      if (pauseEnd <= pauseStart) return;
      if (pauseStart > cursor) segments.push({ type: 'active', start: cursor,     end: pauseStart });
      segments.push(                         { type: 'pause',  start: pauseStart, end: pauseEnd   });
      cursor = pauseEnd;
    });

    if (cursor < connEnd) segments.push({ type: 'active', start: cursor, end: connEnd });

    // Offline = closeAt → nextOpenAt (seulement si closeAt est connu et < nextOpenAt)
    if (nextOpenAt) {
      const offlineStart = closeAt && closeAt > openAt && closeAt < nextOpenAt ? closeAt : connEnd;
      if (offlineStart < nextOpenAt) {
        segments.push({ type: 'offline', start: offlineStart, end: nextOpenAt });
      }
    }
  });

  return segments;
};

// ── Barre de timeline visuelle ────────────────────────────────────────────────
function TimelineBar({ session }) {
  if (!session?.firstActivityAt) return (
    <div className="h-6 bg-gray-100 rounded-lg flex items-center justify-center">
      <p className="text-[10px] text-gray-400">Aucune donnée</p>
    </div>
  );

  const start    = session.firstActivityAt;
  const end      = session.lastActivityAt || Date.now();
  const total    = end - start;
  if (total <= 0) return null;

  const segments = buildSegments(session);

  const segColor = {
    active:  'bg-emerald-400',
    pause:   'bg-amber-200',
    offline: 'bg-gray-400',
  };

  const reconnections = (session.connections || []).length - 1;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center h-5 rounded-lg overflow-hidden gap-px">
        {segments.map((seg, i) => {
          const width = ((seg.end - seg.start) / total) * 100;
          const label = seg.type === 'offline'
            ? `Hors-ligne ${fmtTime(seg.start)} → ${fmtTime(seg.end)}`
            : seg.type === 'pause'
            ? `Pause ${fmtTime(seg.start)} → ${fmtTime(seg.end)}`
            : `Actif ${fmtTime(seg.start)} → ${fmtTime(seg.end)}`;
          return (
            <div
              key={i}
              title={label}
              className={`h-full ${segColor[seg.type]} ${seg.type === 'offline' ? 'opacity-50' : ''}`}
              style={{ width: `${Math.max(width, 0.3)}%`, flexShrink: 0 }}
            />
          );
        })}
      </div>
      <div className="flex justify-between text-[10px] text-gray-400">
        <span>{fmtTime(start)}</span>
        <span className="flex items-center gap-3 flex-wrap justify-center">
          <span className="flex items-center gap-1"><span className="w-2 h-2 bg-emerald-400 rounded-sm inline-block" />Actif</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 bg-amber-200 rounded-sm inline-block" />Pause</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 bg-gray-400 opacity-50 rounded-sm inline-block" />Hors-ligne</span>
          {reconnections > 0 && (
            <span className="text-indigo-400 font-semibold">{reconnections} reconnexion{reconnections > 1 ? 's' : ''}</span>
          )}
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

  // ── Onglets de la section détail : par jour | absences | MAJ faites ─────────
  const [detailTab, setDetailTab] = useState('days'); // 'days' | 'absences' | 'majs'

  // Temps par article (du clic « Lancer la MAJ » jusqu'à la publication) —
  // docs article_time du membre. Le panel est réservé au super_admin, qui a le
  // droit de lister la collection complète.
  const [articleTimes, setArticleTimes] = useState(null); // null = chargement
  useEffect(() => {
    getArticleTimeAll()
      .then(all => {
        const ids = new Set([user.id, user.uid, user.username].filter(Boolean));
        setArticleTimes(
          all.filter(e => ids.has(e.userId))
             .sort((a, b) => (b.lastActivityAt || 0) - (a.lastActivityAt || 0))
        );
      })
      .catch(() => setArticleTimes([]));
  }, [user.id, user.uid, user.username]);

  // Jours OUVRÉS (lun-ven) sans aucune session sur les 30 derniers jours.
  // Le jour courant n'est pas compté (journée en cours).
  const absences = (() => {
    const have = new Set(sessions.map(s => s.date));
    const out = [];
    for (let i = 1; i <= 30; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dow = d.getDay();
      if (dow === 0 || dow === 6) continue;
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      if (!have.has(iso)) out.push(iso);
    }
    return out;
  })();

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

  // ── Calcul depuis la timeline : active / pause / offline ──────────────────────
  // buildSegments() découpe la session en segments sans chevauchement.
  // C'est la seule source fiable : pauses[] brut Firestore peut être corrompu.
  const segments     = currentSession ? buildSegments(currentSession) : [];
  const connections  = [...(currentSession?.connections || [])].filter(c => c?.at).sort((a, b) => a.at - b.at);
  const reconnections = Math.max(0, connections.length - 1);

  // Durée totale de la session (fenêtre début → fin)
  const sessionWindowMs  = currentSession
    ? (currentSession.lastActivityAt || Date.now()) - currentSession.firstActivityAt
    : 0;
  const sessionWindowMin = Math.round(sessionWindowMs / 60000);

  // Somme de chaque type de segment (mutuellement exclusifs, somme = fenêtre)
  const sumMin = (type) =>
    segments
      .filter(s => s.type === type)
      .reduce((acc, s) => acc + Math.round((s.end - s.start) / 60000), 0);

  const totalPauseMin   = sumMin('pause');
  const totalOfflineMin = sumMin('offline');

  // Segments pour l'affichage détaillé (liste des pauses / hors-ligne)
  const pauses        = segments.filter(s => s.type === 'pause');
  const offlinePeriods = segments.filter(s => s.type === 'offline');

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
        className="fixed inset-0 z-[200]"
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
                <h2 className="font-bold text-gray-900 text-base leading-tight">
                  {[user.firstName, user.lastName].filter(Boolean).join(' ')
                    || user.username
                    || user.email?.split('@')[0]
                    || 'Membre'}
                </h2>
                <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ${colors.badge}`}>
                  {ROLE_LABELS[user.role] || user.role || 'Membre'}
                </span>
                {isActiveNow && (
                  <span className="flex items-center gap-1 text-[11px] font-semibold text-emerald-600 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full flex-shrink-0">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    Actif maintenant
                  </span>
                )}
              </div>
              {user.email && (
                <p className="text-xs text-gray-400 mt-0.5 truncate">{user.email}</p>
              )}
              {user.username && user.username !== user.email?.split('@')[0] && (
                <p className="text-[11px] text-gray-300 mt-0.5">@{user.username}</p>
              )}
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
                    {(() => {
                      const activeMin  = currentSession.totalActiveMinutes || 0;
                      const absentMin  = Math.max(0, sessionWindowMin - activeMin);
                      const activePct  = sessionWindowMin > 0 ? Math.round((activeMin / sessionWindowMin) * 100) : 0;

                      return (
                        <>
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                            {[
                              {
                                icon: Clock, label: 'Début',
                                value: fmtTime(currentSession.firstActivityAt),
                                sub: `→ ${fmtTime(currentSession.lastActivityAt)}`,
                                color: 'text-gray-900', bg: 'bg-gray-50',
                              },
                              {
                                icon: Zap, label: 'Temps actif',
                                value: fmtDuration(activeMin),
                                sub: sessionWindowMin > 0 ? `${activePct}% de la session` : null,
                                color: 'text-emerald-700', bg: 'bg-emerald-50',
                              },
                              {
                                icon: Coffee, label: 'Absent',
                                value: fmtDuration(absentMin),
                                sub: reconnections > 0
                                  ? `${reconnections} reconnexion${reconnections > 1 ? 's' : ''}`
                                  : null,
                                color: 'text-amber-700', bg: 'bg-amber-50',
                              },
                              {
                                icon: TrendingUp, label: 'Actions',
                                value: currentSession.actions?.total || 0,
                                sub: null,
                                color: colors.bar.startsWith('#3') ? 'text-blue-700' : 'text-purple-700',
                                bg: colors.bar.startsWith('#3') ? 'bg-blue-50' : 'bg-purple-50',
                              },
                            ].map(k => (
                              <div key={k.label} className={`${k.bg} rounded-xl px-4 py-3 text-center`}>
                                <k.icon size={14} className={`mx-auto mb-1 ${k.color}`} />
                                <p className={`text-xl font-bold ${k.color} leading-none`}>{k.value}</p>
                                <p className="text-[10px] text-gray-400 mt-1">{k.label}</p>
                                {k.sub && <p className="text-[9px] text-gray-400 mt-0.5">{k.sub}</p>}
                              </div>
                            ))}
                          </div>

                          {/* Barre récap : Actif + Absent = Total — toujours exact */}
                          {sessionWindowMin > 0 && (
                            <div className="bg-gray-50 rounded-xl px-4 py-3 space-y-2">
                              <div className="flex items-center justify-between text-[10px] text-gray-400 font-semibold uppercase tracking-wide">
                                <span>Répartition session</span>
                                <span className="font-bold text-gray-600">{fmtDuration(sessionWindowMin)} total</span>
                              </div>
                              <div className="flex h-3 rounded-full overflow-hidden gap-px">
                                <div className="bg-emerald-400 h-full" style={{ width: `${activePct}%` }} />
                                {absentMin > 0 && (
                                  <div className="bg-gray-200 h-full flex-1" />
                                )}
                              </div>
                              <div className="flex items-center gap-4 flex-wrap text-[10px]">
                                <span className="flex items-center gap-1.5 text-emerald-700">
                                  <span className="w-2.5 h-2.5 rounded-sm bg-emerald-400 inline-block" />
                                  Actif · <strong>{fmtDuration(activeMin)}</strong>
                                </span>
                                <span className="flex items-center gap-1.5 text-gray-500">
                                  <span className="w-2.5 h-2.5 rounded-sm bg-gray-200 inline-block" />
                                  Absent · <strong>{fmtDuration(absentMin)}</strong>
                                </span>
                              </div>
                            </div>
                          )}
                        </>
                      );
                    })()}

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

                    {/* Pauses (inactivité) + Hors-ligne (fermeture navigateur) */}
                    {(pauses.length > 0 || offlinePeriods.length > 0) && (
                      <div className="space-y-2">
                        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                          Absences
                          {(totalPauseMin + totalOfflineMin) > 0 && ` — ${fmtDuration(totalPauseMin + totalOfflineMin)} total`}
                        </p>
                        <div className="space-y-1.5">
                          {/* Pauses inactivité */}
                          {pauses.map((p, i) => {
                            const dur = Math.round((p.end - p.start) / 60000);
                            return (
                              <div key={`pause-${i}`} className="flex items-center justify-between bg-amber-50 border border-amber-100 rounded-xl px-3 py-2">
                                <div className="flex items-center gap-2">
                                  <Coffee size={12} className="text-amber-500" />
                                  <div>
                                    <span className="text-xs text-gray-700 font-medium">
                                      {fmtTime(p.start)} → {fmtTime(p.end)}
                                    </span>
                                    <span className="ml-2 text-[10px] text-amber-500">Inactivité</span>
                                  </div>
                                </div>
                                <span className="text-xs font-semibold text-amber-700">{fmtDuration(dur)}</span>
                              </div>
                            );
                          })}
                          {/* Périodes hors-ligne (navigateur fermé) */}
                          {offlinePeriods.map((p, i) => {
                            const dur = Math.round((p.end - p.start) / 60000);
                            return (
                              <div key={`offline-${i}`} className="flex items-center justify-between bg-gray-50 border border-gray-200 rounded-xl px-3 py-2">
                                <div className="flex items-center gap-2">
                                  <span className="w-3 h-3 rounded-sm bg-gray-400 opacity-60 flex-shrink-0" />
                                  <div>
                                    <span className="text-xs text-gray-700 font-medium">
                                      {fmtTime(p.start)} → {fmtTime(p.end)}
                                    </span>
                                    <span className="ml-2 text-[10px] text-gray-400">Hors-ligne</span>
                                  </div>
                                </div>
                                <span className="text-xs font-semibold text-gray-500">{fmtDuration(dur)}</span>
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

                    {/* Section détail : Détail par jour | Liste absence | MAJ fait */}
                    <div className="space-y-2">
                      <div className="flex items-center gap-1 bg-gray-100 rounded-xl p-1">
                        {[
                          { id: 'days',     label: 'Détail par jour' },
                          { id: 'absences', label: `Liste absence${absences.length ? ` (${absences.length})` : ''}` },
                          { id: 'majs',     label: `MAJ fait${articleTimes?.length ? ` (${articleTimes.length})` : ''}` },
                        ].map(t => (
                          <button
                            key={t.id}
                            onClick={() => setDetailTab(t.id)}
                            className={`flex-1 px-3 py-1.5 text-xs rounded-lg font-medium transition-all ${
                              detailTab === t.id ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'
                            }`}
                          >
                            {t.label}
                          </button>
                        ))}
                      </div>

                      {detailTab === 'days' && (
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
                      )}

                      {/* Liste absence : jours ouvrés sans aucune session (30 derniers jours) */}
                      {detailTab === 'absences' && (
                        absences.length === 0 ? (
                          <div className="flex items-center gap-2 text-xs text-emerald-600 bg-emerald-50 border border-emerald-100 rounded-xl px-4 py-3">
                            <CheckCircle2 size={14} /> Aucun jour ouvré sans activité sur les 30 derniers jours.
                          </div>
                        ) : (
                          <div className="space-y-1">
                            {absences.map(dt => (
                              <div key={dt} className="flex items-center justify-between text-xs bg-red-50/60 border border-red-100 rounded-lg px-3 py-2">
                                <span className="font-medium text-gray-700 flex items-center gap-2">
                                  <Calendar size={12} className="text-red-400" /> {dateLabel(dt)}
                                </span>
                                <span className="text-[10px] font-semibold text-red-500 uppercase tracking-wide">Aucune activité</span>
                              </div>
                            ))}
                            <p className="text-[10px] text-gray-300 pt-1">
                              Jours ouvrés (lundi-vendredi) sans aucune session d'activité sur les 30 derniers jours — week-ends exclus.
                            </p>
                          </div>
                        )
                      )}

                      {/* MAJ fait : temps par article, du « Lancer la MAJ » à la publication */}
                      {detailTab === 'majs' && (
                        articleTimes === null ? (
                          <p className="text-xs text-gray-400 py-3">Chargement…</p>
                        ) : articleTimes.length === 0 ? (
                          <p className="text-xs text-gray-400 py-3">
                            Aucune MAJ trackée pour ce membre — le suivi démarre au clic « Lancer la MAJ » et s'arrête à la publication.
                          </p>
                        ) : (
                          <div className="overflow-x-auto -mx-1">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="border-b border-gray-100">
                                  {['Article', 'Temps actif', 'Dernière activité', 'Publié'].map(h => (
                                    <th key={h} className="pb-2 px-2 text-[10px] font-semibold text-gray-400 uppercase tracking-wide text-left whitespace-nowrap">
                                      {h}
                                    </th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-50">
                                {articleTimes.map(e => (
                                  <tr key={e.id} className="hover:bg-gray-50/60 transition-colors">
                                    <td className="py-2.5 px-2 font-medium text-gray-700 max-w-[240px]">
                                      {e.url
                                        ? <a href={e.url} target="_blank" rel="noreferrer" className="hover:text-blue-600 hover:underline">{e.title || e.url}</a>
                                        : (e.title || e.articleId)}
                                    </td>
                                    <td className="py-2.5 px-2 font-semibold text-emerald-600 whitespace-nowrap">{fmtDuration(e.totalActiveMinutes)}</td>
                                    <td className="py-2.5 px-2 text-gray-500 whitespace-nowrap">{tsLabel(e.lastActivityAt)}</td>
                                    <td className="py-2.5 px-2 whitespace-nowrap">
                                      {e.publishedAt
                                        ? <span className="font-semibold" style={{ color: colors.bar }}>{tsLabel(e.publishedAt)}</span>
                                        : <span className="text-gray-300">—</span>}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )
                      )}
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
