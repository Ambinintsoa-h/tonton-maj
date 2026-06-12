import { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Bug, Clock, CheckCircle2, XCircle, AlertTriangle, TrendingUp, RefreshCw, ChevronRight, Circle } from 'lucide-react';
import { getTickets } from '../services/firebase';

// ─── Constantes ───────────────────────────────────────────────────────────────

const STATUSES = {
  open:        { label: 'Ouvert',   color: 'text-yellow-700', bg: 'bg-yellow-50',  border: 'border-yellow-200' },
  in_progress: { label: 'En cours', color: 'text-blue-700',   bg: 'bg-blue-50',    border: 'border-blue-200'   },
  resolved:    { label: 'Résolu',   color: 'text-green-700',  bg: 'bg-green-50',   border: 'border-green-200'  },
  closed:      { label: 'Fermé',    color: 'text-gray-500',   bg: 'bg-gray-50',    border: 'border-gray-200'   },
};

const PRIORITIES = {
  urgent:  { label: 'Urgent',  dot: 'bg-red-500',    text: 'text-red-700',    border: 'border-l-red-500'    },
  haute:   { label: 'Haute',   dot: 'bg-orange-400', text: 'text-orange-700', border: 'border-l-orange-400' },
  normale: { label: 'Normale', dot: 'bg-yellow-400', text: 'text-yellow-700', border: 'border-l-yellow-400' },
  basse:   { label: 'Basse',   dot: 'bg-gray-300',   text: 'text-gray-500',   border: 'border-l-gray-300'   },
};

function timeAgo(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'à l\'instant';
  if (m < 60) return `il y a ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `il y a ${h}h`;
  const d = Math.floor(h / 24);
  if (d === 1) return 'hier';
  return `il y a ${d}j`;
}

// ─── Carte de stat ────────────────────────────────────────────────────────────

function StatCard({ icon: Icon, label, value, color, bg, delay = 0 }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.35 }}
      className={`rounded-2xl p-5 flex flex-col gap-2 border ${bg} ${color} border-opacity-40`}
      style={{ borderColor: 'inherit' }}
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium opacity-80">{label}</span>
        <Icon size={18} className="opacity-60" />
      </div>
      <span className="text-3xl font-bold">{value}</span>
    </motion.div>
  );
}

// ─── Ligne de ticket ──────────────────────────────────────────────────────────

function TicketRow({ ticket, onClick }) {
  const prio   = PRIORITIES[ticket.priority]  || PRIORITIES.normale;
  const status = STATUSES[ticket.status]      || STATUSES.open;

  return (
    <motion.div
      whileHover={{ x: 2 }}
      onClick={onClick}
      className={`flex items-center gap-3 p-3 rounded-xl border-l-4 cursor-pointer hover:bg-gray-50 transition-colors ${prio.border}`}
    >
      <div className={`w-2 h-2 rounded-full flex-shrink-0 ${prio.dot}`} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900 truncate">{ticket.title || `Ticket #${ticket.id?.slice(-6)}`}</p>
        <p className="text-xs text-gray-400 mt-0.5">{timeAgo(ticket.createdAt)}</p>
      </div>
      <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full border whitespace-nowrap ${status.bg} ${status.color} ${status.border}`}>
        {status.label}
      </span>
      <ChevronRight size={14} className="text-gray-300 flex-shrink-0" />
    </motion.div>
  );
}

// ─── Page principale ──────────────────────────────────────────────────────────

export default function SupportDashboard() {
  const navigate   = useNavigate();
  const auth       = useSelector(s => s.auth);
  const [tickets,  setTickets]  = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState(null);
  const [filter,   setFilter]   = useState('all'); // 'all' | 'open' | 'in_progress' | 'urgent'

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getTickets(auth.uid || auth.username, auth.role);
      setTickets(data);
    } catch (e) {
      setError('Impossible de charger les tickets');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Stats ──────────────────────────────────────────────────────────────────
  const open        = tickets.filter(t => t.status === 'open').length;
  const in_progress = tickets.filter(t => t.status === 'in_progress').length;
  const resolved    = tickets.filter(t => t.status === 'resolved').length;
  const closed      = tickets.filter(t => t.status === 'closed').length;
  const urgent      = tickets.filter(t => t.priority === 'urgent' && t.status !== 'closed').length;

  // ── Liste filtrée ─────────────────────────────────────────────────────────
  const filtered = tickets
    .filter(t => {
      if (filter === 'open')        return t.status === 'open';
      if (filter === 'in_progress') return t.status === 'in_progress';
      if (filter === 'urgent')      return t.priority === 'urgent' && t.status !== 'closed';
      return t.status !== 'closed'; // 'all' = tickets actifs
    })
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .slice(0, 25);

  return (
    <div className="flex-1 p-6 max-w-5xl mx-auto w-full">

      {/* ── En-tête ──────────────────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-between mb-6"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center">
            <Bug size={20} className="text-blue-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Suivi des tickets</h1>
            <p className="text-xs text-gray-400">Support technique — vue globale</p>
          </div>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-100 px-3 py-1.5 rounded-lg transition-colors"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          Actualiser
        </button>
      </motion.div>

      {/* ── Stat cards ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
        <StatCard icon={AlertTriangle} label="Urgents"   value={urgent}      color="text-red-700"    bg="bg-red-50 border-red-200"    delay={0}    />
        <StatCard icon={Clock}         label="Ouverts"   value={open}        color="text-yellow-700" bg="bg-yellow-50 border-yellow-200" delay={0.05} />
        <StatCard icon={TrendingUp}    label="En cours"  value={in_progress} color="text-blue-700"   bg="bg-blue-50 border-blue-200"  delay={0.1}  />
        <StatCard icon={CheckCircle2}  label="Résolus"   value={resolved}    color="text-green-700"  bg="bg-green-50 border-green-200" delay={0.15} />
        <StatCard icon={XCircle}       label="Fermés"    value={closed}      color="text-gray-500"   bg="bg-gray-50 border-gray-200"  delay={0.2}  />
      </div>

      {/* ── Liste ────────────────────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.25 }}
        className="glass-card rounded-2xl p-5"
      >
        {/* Filtres */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-gray-700">Tickets récents</h2>
          <div className="flex gap-1">
            {[
              { key: 'all',         label: 'Actifs'    },
              { key: 'open',        label: 'Ouverts'   },
              { key: 'in_progress', label: 'En cours'  },
              { key: 'urgent',      label: 'Urgents'   },
            ].map(f => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={`text-xs px-2.5 py-1 rounded-lg transition-colors inline-flex items-center gap-1 ${
                  filter === f.key
                    ? 'bg-blue-100 text-blue-700 font-semibold'
                    : 'text-gray-500 hover:bg-gray-100'
                }`}
              >
                {f.key === 'urgent' && <Circle size={10} className="inline fill-current text-red-500" />}
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* Contenu */}
        {loading && (
          <div className="py-12 text-center text-gray-400 text-sm">
            <RefreshCw size={20} className="animate-spin mx-auto mb-2" />
            Chargement…
          </div>
        )}

        {error && !loading && (
          <div className="py-8 text-center text-red-500 text-sm">{error}</div>
        )}

        {!loading && !error && filtered.length === 0 && (
          <div className="py-10 text-center text-gray-400 text-sm">
            <CheckCircle2 size={28} className="mx-auto mb-2 opacity-30" />
            Aucun ticket dans cette catégorie
          </div>
        )}

        {!loading && !error && filtered.length > 0 && (
          <div className="space-y-1">
            {filtered.map(ticket => (
              <TicketRow
                key={ticket.id}
                ticket={ticket}
                onClick={() => navigate('/tickets', { state: { openTicketId: ticket.id } })}
              />
            ))}
          </div>
        )}

        {/* Lien vers page complète */}
        {!loading && tickets.length > 0 && (
          <div className="mt-4 pt-3 border-t border-gray-100 text-center">
            <button
              onClick={() => navigate('/tickets')}
              className="text-xs text-blue-500 hover:text-blue-700 font-medium transition-colors"
            >
              Voir tous les tickets ({tickets.length}) →
            </button>
          </div>
        )}
      </motion.div>
    </div>
  );
}
