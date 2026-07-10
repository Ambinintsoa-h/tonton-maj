import { useState, useEffect, useMemo } from 'react';
import { useSelector } from 'react-redux';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Timer, RefreshCw, ChevronDown, ChevronUp, ExternalLink,
  CheckCircle2, Loader, Clock,
} from 'lucide-react';
import { getArticleTimeAll } from '../services/firebase';
import { AccountAvatar } from '../components/account/MonComptePanel';
import Pagination, { pageSlice } from '../components/common/Pagination';
import ListFilters, { EMPTY_FILTERS, ME, memberIds, memberDisplayName, buildDateMatcher } from '../components/common/ListFilters';

// ── Helpers ──────────────────────────────────────────────────────────────────

// Libellés lisibles des rôles enregistrés avec chaque suivi de temps
const ROLE_LABELS = {
  cq_ia:       'CQ IA',
  manager:     'Manager',
  super_admin: 'Super admin',
  support:     'Support',
};
const roleLabel = (r) => ROLE_LABELS[r] || r || '';

const fmtMinutes = (min) => {
  const m = Math.max(0, Math.round(min || 0));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} h ${String(r).padStart(2, '0')}` : `${h} h`;
};

const fmtDate = (ts) => {
  if (!ts) return '—';
  try {
    return new Date(ts).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch { return '—'; }
};

// ── Ligne article (drill-down d'un utilisateur) ──────────────────────────────

function ArticleTimeRow({ entry }) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 border-t border-gray-100 hover:bg-gray-50/60 transition-colors">
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-medium text-gray-800 truncate">
          {entry.title || entry.url || entry.articleId}
        </p>
        <p className="text-[11px] text-gray-400 flex items-center gap-2 mt-0.5">
          <span>Démarré le {fmtDate(entry.startedAt)}</span>
          {entry.url && (
            <a href={entry.url} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-0.5 text-gray-400 hover:text-blue-500">
              <ExternalLink size={10} /> article
            </a>
          )}
        </p>
      </div>
      {entry.publishedAt ? (
        <span className="flex items-center gap-1 text-[11px] font-medium text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5 flex-shrink-0">
          <CheckCircle2 size={11} /> Publié
        </span>
      ) : (
        <span className="flex items-center gap-1 text-[11px] font-medium text-amber-600 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5 flex-shrink-0">
          <Loader size={11} /> En cours
        </span>
      )}
      <span className="text-[13px] font-bold text-gray-800 w-20 text-right flex-shrink-0">
        {fmtMinutes(entry.totalActiveMinutes)}
      </span>
    </div>
  );
}

// ── Carte utilisateur (total + articles dépliables paginés) ──────────────────

function UserTimeCard({ group, users }) {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(1);

  const member = users.find(u => u.uid === group.userId || u.username === group.userId) || null;
  const displayName = group.userName
    || (member ? [member.firstName, member.lastName].filter(Boolean).join(' ') : '')
    || member?.username || group.userId;

  const pageArticles = pageSlice(group.articles, page);

  return (
    <div className="glass-card overflow-hidden rounded-2xl">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-gray-50/60 transition-colors text-left"
      >
        <AccountAvatar
          avatarUrl={member?.avatarUrl}
          prenom={member?.firstName}
          nom={member?.lastName}
          username={member?.username || group.userId}
          size={38}
        />
        <div className="flex-1 min-w-0">
          <p className="text-[14px] font-semibold text-gray-800 truncate">{displayName}</p>
          <p className="text-[11px] text-gray-400">
            {group.articles.length} article{group.articles.length > 1 ? 's' : ''}
            {group.userRole ? ` · ${roleLabel(group.userRole)}` : ''}
          </p>
        </div>
        <div className="text-right flex-shrink-0">
          <p className="text-[16px] font-bold text-gray-900">{fmtMinutes(group.totalMinutes)}</p>
          <p className="text-[10px] text-gray-400 uppercase tracking-wide">temps total</p>
        </div>
        {open ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden"
          >
            {pageArticles.map(entry => <ArticleTimeRow key={entry.id} entry={entry} />)}
            <Pagination total={group.articles.length} page={page} onPageChange={setPage} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function TempsEquipe() {
  const users = useSelector(s => s.users.list);
  const firebaseReady = useSelector(s => s.settings.firebaseReady);
  const authUid       = useSelector(s => s.auth.uid);
  const authUsername  = useSelector(s => s.auth.username);
  const authPrenom    = useSelector(s => s.auth.prenom);
  const authNom       = useSelector(s => s.auth.nom);

  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters,    setFilters]    = useState({ ...EMPTY_FILTERS });
  const [roleFilter, setRoleFilter] = useState('');

  const load = () => {
    setLoading(true);
    getArticleTimeAll()
      .then(list => setEntries(list))
      .catch(() => setEntries([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!firebaseReady) return;
    load();
  }, [firebaseReady]); // eslint-disable-line react-hooks/exhaustive-deps

  // Rôles présents dans les suivis (pour le filtre par rôle)
  const availableRoles = useMemo(
    () => [...new Set(entries.map(e => e.userRole).filter(Boolean))].sort(),
    [entries]
  );

  // ── Filtrage des suivis : rôle + membre + période (dernière activité) ────────
  // Les suivis portent userId/userName (pas assigneeId) → correspondance membre
  // faite ici avec les mêmes identifiants que ListFilters (id doc, uid, username, nom).
  const filteredEntries = useMemo(() => {
    let list = entries;
    if (roleFilter) list = list.filter(e => (e.userRole || '') === roleFilter);
    if (filters.member) {
      let ids, names;
      if (filters.member === ME) {
        const self = users.find(x => memberIds(x).some(id => id === authUid || id === authUsername));
        ids   = [...new Set([authUid, authUsername, ...(self ? memberIds(self) : [])])].filter(Boolean);
        names = [[authPrenom, authNom].filter(Boolean).join(' '), authUsername, self ? memberDisplayName(self) : ''].filter(Boolean);
      } else {
        const u = users.find(x => x.id === filters.member);
        ids   = u ? memberIds(u) : [filters.member];
        names = u ? [memberDisplayName(u), u.username].filter(Boolean) : [];
      }
      const lowerNames = names.map(n => String(n).trim().toLowerCase()).filter(Boolean);
      list = list.filter(e =>
        (!!e.userId && ids.includes(e.userId)) ||
        (!!e.userName && lowerNames.includes(String(e.userName).trim().toLowerCase()))
      );
    }
    const dateMatch = buildDateMatcher(filters, e => e.lastActivityAt || e.startedAt || null);
    if (dateMatch) list = list.filter(dateMatch);
    return list;
  }, [entries, roleFilter, filters, users, authUid, authUsername, authPrenom, authNom]);

  // Agrégation par éditeur : total + articles triés par temps décroissant
  const grouped = useMemo(() => {
    const byUser = new Map();
    for (const e of filteredEntries) {
      if (!e.userId) continue;
      if (!byUser.has(e.userId)) {
        byUser.set(e.userId, { userId: e.userId, userName: e.userName || '', userRole: e.userRole || '', totalMinutes: 0, articles: [] });
      }
      const g = byUser.get(e.userId);
      g.totalMinutes += e.totalActiveMinutes || 0;
      if (!g.userName && e.userName) g.userName = e.userName;
      g.articles.push(e);
    }
    const groups = [...byUser.values()];
    groups.forEach(g => g.articles.sort((a, b) => (b.lastActivityAt || 0) - (a.lastActivityAt || 0)));
    return groups.sort((a, b) => b.totalMinutes - a.totalMinutes);
  }, [filteredEntries]);

  const totalMinutes = grouped.reduce((s, g) => s + g.totalMinutes, 0);
  const filtersActive = !!(roleFilter || filters.member || filters.from || filters.to);

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      {/* En-tête */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <Timer size={20} className="text-gray-500" /> Temps équipe
          </h1>
          <p className="text-[12px] text-gray-400 mt-0.5">
            Temps actif de travail par éditeur, du lancement de l'analyse à la publication
            — les pauses de plus de 5 minutes ne comptent pas.
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium text-gray-600 bg-white border border-gray-200 hover:bg-gray-50 transition-colors"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Actualiser
        </button>
      </div>

      {/* ── Filtres : rôle / par moi / membre / période (dernière activité) ── */}
      {entries.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={roleFilter}
            onChange={e => setRoleFilter(e.target.value)}
            className="px-2.5 py-1.5 text-[12px] font-medium bg-white border border-gray-200 rounded-lg text-gray-600 focus:outline-none focus:ring-2 focus:ring-black/10"
            title="Filtrer par rôle (CQ IA, Manager…)"
          >
            <option value="">Tous les rôles</option>
            {availableRoles.map(r => (
              <option key={r} value={r}>{roleLabel(r)}</option>
            ))}
          </select>
          <ListFilters users={users} value={filters} onChange={setFilters} />
        </div>
      )}

      {/* Stat globale */}
      <div className="glass-card px-4 py-3 rounded-2xl flex items-center gap-3">
        <Clock size={16} className="text-gray-400" />
        <span className="text-[13px] text-gray-600">
          <span className="font-bold text-gray-900">{fmtMinutes(totalMinutes)}</span> de travail cumulé
          sur <span className="font-bold text-gray-900">{filteredEntries.length}</span> suivi{filteredEntries.length > 1 ? 's' : ''} article×éditeur
          {filtersActive && ` (filtré — ${entries.length} au total)`}
        </span>
      </div>

      {/* Liste */}
      {loading ? (
        <div className="glass-card p-10 text-center text-gray-400 text-sm">
          <Loader size={18} className="animate-spin mx-auto mb-2" /> Chargement…
        </div>
      ) : grouped.length === 0 ? (
        <div className="glass-card p-10 text-center">
          <p className="text-sm font-semibold text-gray-500">
            {entries.length === 0 ? 'Aucun temps enregistré pour l\'instant' : 'Aucun suivi pour ces filtres'}
          </p>
          <p className="text-xs text-gray-400 mt-1.5 max-w-sm mx-auto">
            {entries.length === 0
              ? 'Le suivi démarre automatiquement au lancement d\'une analyse et s\'arrête à la publication. Les données apparaîtront ici dès la première MAJ.'
              : 'Modifiez le rôle, le membre ou la période pour retrouver des suivis.'}
          </p>
          {entries.length > 0 && (
            <button
              onClick={() => { setRoleFilter(''); setFilters({ ...EMPTY_FILTERS }); }}
              className="mt-3 text-xs text-blue-500 hover:underline"
            >
              Réinitialiser les filtres
            </button>
          )}
        </div>
      ) : (
        grouped.map(g => <UserTimeCard key={g.userId} group={g} users={users} />)
      )}
    </div>
  );
}
