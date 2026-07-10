import { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { AnimatePresence, motion } from 'framer-motion';
import toast from 'react-hot-toast';
import {
  Archive, ArchiveRestore, Trash2, ExternalLink, Search, X,
} from 'lucide-react';
import { updateInHistory, removeFromHistory } from '../store/slices/articlesSlice';
import { restoreArticle, deleteArticle } from '../services/firebase';
import ConfirmDialog from '../components/common/ConfirmDialog';
import Pagination, { pageSlice } from '../components/common/Pagination';
import ListFilters, { EMPTY_FILTERS, hasActiveFilters, buildMemberMatcher, buildDateMatcher } from '../components/common/ListFilters';

const fmtDate = (ts) => {
  if (!ts) return '—';
  try {
    return new Date(ts).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch { return '—'; }
};

// Titre TOUJOURS lisible : le titre de l'article en priorité ; à défaut, le slug
// de l'URL humanisé (« pose-toiture-bac-acier » → « pose toiture bac acier ») —
// jamais une URL brute ni un id technique.
const displayTitle = (article) => {
  if (article.title?.trim()) return article.title.trim();
  try {
    const seg = decodeURIComponent(new URL(article.url).pathname.replace(/\/$/, '').split('/').pop() || '');
    const human = seg.replace(/[-_]+/g, ' ').trim();
    if (human) return human.charAt(0).toUpperCase() + human.slice(1);
  } catch { /* URL absente ou invalide */ }
  return article.url || '(Sans titre)';
};

export default function Archives() {
  const dispatch      = useDispatch();
  const history       = useSelector(s => s.articles.history);
  const firebaseReady = useSelector(s => s.settings.firebaseReady);
  const users         = useSelector(s => s.users.list);
  const authUid       = useSelector(s => s.auth.uid);
  const authUsername  = useSelector(s => s.auth.username);
  const authPrenom    = useSelector(s => s.auth.prenom);
  const authNom       = useSelector(s => s.auth.nom);

  const [search,  setSearch]  = useState('');
  const [filters, setFilters] = useState({ ...EMPTY_FILTERS });
  const [page, setPage]       = useState(1);
  const [confirmDelete, setConfirmDelete] = useState(null); // article à supprimer définitivement
  const [selectedIds, setSelectedIds]     = useState(() => new Set());
  const [confirmBulk, setConfirmBulk]     = useState(false);

  const archived = history.filter(a => a.archived);
  const q = search.toLowerCase();
  // Filtres membre (assigné OU dernier modificateur) + période (date d'archivage)
  const me          = { uid: authUid, username: authUsername, name: [authPrenom, authNom].filter(Boolean).join(' ') || authUsername };
  const memberMatch = buildMemberMatcher(filters, users, me);
  const dateMatch   = buildDateMatcher(filters, a => a.archivedAt || null);
  const filtered = archived
    .filter(a =>
      !q ||
      a.title?.toLowerCase().includes(q) ||
      a.url?.toLowerCase().includes(q) ||
      a.keyword?.toLowerCase().includes(q)
    )
    .filter(a => !memberMatch || memberMatch(a))
    .filter(a => !dateMatch || dateMatch(a))
    .sort((a, b) => (b.archivedAt || 0) - (a.archivedAt || 0));

  // Retour page 1 (et sélection purgée) à chaque nouvelle recherche / nouveau filtre
  useEffect(() => { setPage(1); setSelectedIds(new Set()); }, [q, filters]);
  const pageItems = pageSlice(filtered, page);

  // ── Sélection multiple → restauration groupée ───────────────────────────────
  const allSelected = filtered.length > 0 && filtered.every(a => selectedIds.has(a.id));

  const toggleSelect = (id) => setSelectedIds(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const toggleSelectAll = () => setSelectedIds(
    allSelected ? new Set() : new Set(filtered.map(a => a.id))
  );

  // Ne restaure que les éléments sélectionnés ENCORE visibles dans le filtre courant
  const bulkTargets = filtered.filter(a => selectedIds.has(a.id));

  const handleRestore = (article) => {
    dispatch(updateInHistory({ id: article.id, archived: false, archivedAt: null, archivedBy: null }));
    toast.success('Article restauré dans l\'Historique');
    if (firebaseReady) restoreArticle(article.id).catch(() => {});
  };

  // Restauration groupée de la sélection (après confirmation)
  const confirmBulkRestore = () => {
    bulkTargets.forEach(a => {
      dispatch(updateInHistory({ id: a.id, archived: false, archivedAt: null, archivedBy: null }));
      if (firebaseReady) restoreArticle(a.id).catch(() => {});
    });
    setSelectedIds(new Set());
    toast.success(
      `${bulkTargets.length} article${bulkTargets.length > 1 ? 's' : ''} restauré${bulkTargets.length > 1 ? 's' : ''} dans l'Historique`,
      { icon: <ArchiveRestore size={16} /> }
    );
  };

  const confirmDeletion = () => {
    const article = confirmDelete;
    if (!article) return;
    dispatch(removeFromHistory(article.id));
    toast.success('Article supprimé définitivement');
    if (firebaseReady) deleteArticle(article.id).catch(() => {});
  };

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      {/* En-tête */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <Archive size={20} className="text-gray-500" /> Archives
          </h1>
          <p className="text-[12px] text-gray-400 mt-0.5">
            Articles archivés depuis l'Historique — restaurez-les ou supprimez-les définitivement.
            {(search || hasActiveFilters(filters)) && ` · ${filtered.length} résultat${filtered.length > 1 ? 's' : ''}`}
          </p>
        </div>
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-300" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Rechercher…"
            className="pl-8 pr-8 py-1.5 text-[13px] bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-black/10 w-56"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500">
              <X size={13} />
            </button>
          )}
        </div>
      </div>

      {/* ── Filtres : par moi / membre / période (date d'archivage) ── */}
      {archived.length > 0 && (
        <ListFilters users={users} value={filters} onChange={setFilters} />
      )}

      {/* Liste */}
      {filtered.length === 0 ? (
        <div className="glass-card p-10 text-center">
          <div className="w-12 h-12 rounded-2xl bg-gray-50 border border-gray-100 flex items-center justify-center mx-auto mb-3">
            <Archive size={20} className="text-gray-300" />
          </div>
          <p className="text-sm font-semibold text-gray-500">
            {archived.length === 0 ? 'Aucun article archivé' : 'Aucun résultat pour cette recherche'}
          </p>
          <p className="text-xs text-gray-400 mt-1.5 max-w-sm mx-auto">
            {archived.length === 0
              ? 'Archivez un article depuis l\'Historique (bouton Archiver) pour le retrouver ici.'
              : 'Modifiez la recherche ou les filtres pour retrouver un article archivé.'}
          </p>
          {archived.length > 0 && (
            <button
              onClick={() => { setSearch(''); setFilters({ ...EMPTY_FILTERS }); }}
              className="mt-3 text-xs text-blue-500 hover:underline"
            >
              Effacer la recherche et les filtres
            </button>
          )}
        </div>
      ) : (
        <div className="glass-card overflow-hidden rounded-2xl">
          {/* Barre de sélection multiple → restauration groupée */}
          <div className="flex items-center gap-3 px-4 py-2.5 border-b border-gray-100 bg-gray-50/60 flex-wrap">
            <label className="flex items-center gap-2 text-[12px] font-medium text-gray-500 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={toggleSelectAll}
                className="w-4 h-4 accent-emerald-600 cursor-pointer"
              />
              Tout sélectionner ({filtered.length})
            </label>
            {selectedIds.size > 0 && (
              <>
                <span className="text-[12px] text-gray-400">
                  {bulkTargets.length} sélectionné{bulkTargets.length > 1 ? 's' : ''}
                </span>
                <button
                  type="button"
                  onClick={() => setConfirmBulk(true)}
                  className="ml-auto flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12px] font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 transition-colors"
                >
                  <ArchiveRestore size={13} /> Restaurer la sélection
                </button>
              </>
            )}
          </div>
          <AnimatePresence mode="popLayout">
            {pageItems.map(article => (
              <motion.div
                key={article.id}
                layout
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0, x: -12 }}
                className={`flex items-center gap-3 px-4 py-3 border-b border-gray-100 last:border-b-0 hover:bg-gray-50/60 transition-colors ${selectedIds.has(article.id) ? 'bg-emerald-50/40' : ''}`}
              >
                {/* Case de sélection multiple (restauration groupée) */}
                <input
                  type="checkbox"
                  checked={selectedIds.has(article.id)}
                  onChange={() => toggleSelect(article.id)}
                  className="w-4 h-4 accent-emerald-600 cursor-pointer flex-shrink-0"
                  title="Sélectionner pour restaurer"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-semibold text-gray-800 truncate">
                    {displayTitle(article)}
                  </p>
                  <p className="text-[11px] text-gray-400 mt-0.5 flex items-center gap-2 flex-wrap">
                    <span>Archivé le {fmtDate(article.archivedAt)}{article.archivedBy ? ` par ${article.archivedBy}` : ''}</span>
                    {article.url && (
                      <a href={article.url} target="_blank" rel="noopener noreferrer"
                        className="inline-flex items-center gap-0.5 text-gray-400 hover:text-blue-500">
                        <ExternalLink size={10} /> article
                      </a>
                    )}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => handleRestore(article)}
                  title="Remettre dans l'Historique"
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12px] font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 transition-colors flex-shrink-0"
                >
                  <ArchiveRestore size={13} /> Restaurer
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(article)}
                  title="Supprimer définitivement (article + suivi SEO)"
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12px] font-medium text-red-600 bg-red-50 hover:bg-red-100 border border-red-200 transition-colors flex-shrink-0"
                >
                  <Trash2 size={13} /> Supprimer
                </button>
              </motion.div>
            ))}
          </AnimatePresence>
          <Pagination total={filtered.length} page={page} onPageChange={setPage} />
        </div>
      )}

      {/* ── Confirmation de restauration groupée ── */}
      <ConfirmDialog
        open={confirmBulk}
        onClose={() => setConfirmBulk(false)}
        onConfirm={confirmBulkRestore}
        title={`Restaurer ${bulkTargets.length} article${bulkTargets.length > 1 ? 's' : ''} ?`}
        message="Ils quitteront les Archives et retrouveront leur place dans l'Historique."
        confirmLabel="Restaurer"
      />

      {/* Garde-fou suppression définitive */}
      <ConfirmDialog
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={confirmDeletion}
        definitive
        title="Supprimer définitivement cet article ?"
        message={`« ${confirmDelete ? displayTitle(confirmDelete) : ''} » sera supprimé de la base (avant/après, suivi SEO inclus). Cette action ne peut pas être annulée.`}
        confirmLabel="SUPPRIMER DÉFINITIVEMENT"
      />
    </div>
  );
}
