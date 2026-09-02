import { useState, useEffect, useMemo, useCallback } from 'react';
import { useSelector } from 'react-redux';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ListChecks, RefreshCw, ExternalLink, Eye } from 'lucide-react';
import Pagination, { pageSlice } from '../components/common/Pagination';
import Badge from '../components/common/Badge';
import { listMyBatchItems } from '../services/batchItems';
import { listStagedItems } from '../services/gsheetStaging';
import { fmtCost, fmtDuration, fmtDate, DISPLAY_STATUS, deriveDisplayStatus, groupCostByDay } from '../utils/batchDisplay';

// ─────────────────────────────────────────────────────────────────────────────
// "Mes MAJ" — remplace l'ancien écran "MAJ en attente" (import fichier, ajout
// manuel, assignation par personne, moteur de lancement à 3 slots simultanés,
// tous retirés). Ce n'est plus un point de LANCEMENT : c'est un tableau de
// bord de CONSULTATION de ce qui a déjà été traité via "MAJ en lot" -- le
// lancement reste exclusivement sur /lots. Décision Andrianina, sept. 2026.
// ─────────────────────────────────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;

// Date locale YYYY-MM-DD (PAS toISOString : décalage UTC près de minuit).
const localIso = (d) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

const DATE_PRESETS = [
  { label: "Aujourd'hui", days: 0 },
  { label: '7 jours', days: 6 },
  { label: '30 jours', days: 29 },
];

// Rapproche le "Attribué à" du Sheet de l'utilisateur connecté -- comparaison
// texte insensible à la casse/accents/@ initial, jamais une égalité stricte
// (même esprit que buildMemberMatcher, ListFilters.jsx) : "andrianina",
// "Andrianina" et "@andrianina" doivent tous matcher la même personne.
const normalizeName = (s) => String(s || '').trim().toLowerCase().replace(/^@/, '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '');

const matchesMe = (assignedTo, me) => {
  if (!assignedTo) return false;
  const a = normalizeName(assignedTo);
  return [me.username, me.name, me.uid].filter(Boolean).some((v) => normalizeName(v) === a);
};

export default function MajEnAttente() {
  const authUid = useSelector((s) => s.auth.uid);
  const authUsername = useSelector((s) => s.auth.username);
  const authRole = useSelector((s) => s.auth.role) || 'cq_ia';
  const authPrenom = useSelector((s) => s.auth.prenom);
  const authNom = useSelector((s) => s.auth.nom);
  const me = useMemo(() => ({
    uid: authUid,
    username: authUsername,
    name: [authPrenom, authNom].filter(Boolean).join(' '),
  }), [authUid, authUsername, authPrenom, authNom]);

  // Un cq_ia est de toute façon forcé sur ses propres lots côté SERVEUR
  // (jamais une restriction de sécurité laissée au client) -- ce booléen ne
  // pilote que l'affichage (masquer "Lancé par", filtrer le widget du bas).
  const isPersonalScope = authRole === 'cq_ia';

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dateFrom, setDateFrom] = useState(() => localIso(new Date(Date.now() - 29 * DAY_MS)));
  const [dateTo, setDateTo] = useState(() => localIso(new Date()));
  const [siteFilter, setSiteFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);

  const [staged, setStaged] = useState([]);
  const [loadingStaged, setLoadingStaged] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const from = new Date(`${dateFrom}T00:00:00`).getTime();
      const to = new Date(`${dateTo}T23:59:59.999`).getTime();
      const list = await listMyBatchItems({ from, to });
      setItems(list);
    } catch (e) {
      toast.error(`Impossible de charger "Mes MAJ" : ${e.message}`);
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo]);

  useEffect(() => { refresh(); }, [refresh]);
  // Une nouvelle recherche repart toujours de la page 1 -- sinon un filtre qui
  // réduit la liste peut laisser l'affichage sur une page devenue vide.
  useEffect(() => { setPage(1); }, [siteFilter, statusFilter, dateFrom, dateTo]);

  const refreshStaged = useCallback(async () => {
    setLoadingStaged(true);
    try {
      const list = await listStagedItems();
      setStaged(list);
    } catch (e) {
      toast.error(`Impossible de charger les lignes en attente : ${e.message}`);
    } finally {
      setLoadingStaged(false);
    }
  }, []);
  useEffect(() => { refreshStaged(); }, [refreshStaged]);

  const sites = useMemo(() => [...new Set(items.map((it) => it.site).filter(Boolean))].sort(), [items]);

  const filtered = useMemo(() => items.filter((it) => {
    if (siteFilter && it.site !== siteFilter) return false;
    if (statusFilter && deriveDisplayStatus(it) !== statusFilter) return false;
    return true;
  }), [items, siteFilter, statusFilter]);

  const totalCost = useMemo(() => filtered.reduce((sum, it) => sum + (it.costUsd || 0), 0), [filtered]);
  const costByDay = useMemo(() => groupCostByDay(filtered), [filtered]);
  const paged = pageSlice(filtered, page);

  const applyDatePreset = (days) => {
    setDateTo(localIso(new Date()));
    setDateFrom(localIso(new Date(Date.now() - days * DAY_MS)));
  };

  // Widget "MAJ en attente" : lignes du Google Sheet détectées mais pas
  // encore lancées (gsheet_staged_items, statut 'nouveau') -- même donnée que
  // le bloc de /lots, réparti par attribution ici. Lecture seule : lancer
  // reste exclusivement sur /lots.
  const myStaged = useMemo(() => {
    if (!isPersonalScope) return staged;
    return staged.filter((it) => matchesMe(it.assignedTo, me));
  }, [staged, isPersonalScope, me]);

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <div className="flex items-center gap-3">
        <ListChecks className="w-6 h-6 text-teal-600" />
        <div className="flex-1">
          <h1 className="text-xl font-semibold text-gray-900">Mes MAJ</h1>
          <p className="text-sm text-gray-500">
            {isPersonalScope
              ? 'Le suivi de vos mises à jour traitées via MAJ en lot.'
              : "Le suivi des mises à jour de toute l'équipe, traitées via MAJ en lot."}
          </p>
        </div>
        <button type="button" onClick={refresh} className="text-gray-400 hover:text-gray-700 p-1.5" title="Rafraîchir">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Cartes de synthèse */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <p className="text-xs text-gray-400 uppercase tracking-wide font-medium">Articles traités</p>
          <p className="text-2xl font-semibold text-gray-900 mt-1">{filtered.length}</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <p className="text-xs text-gray-400 uppercase tracking-wide font-medium">Coût total (période)</p>
          <p className="text-2xl font-semibold text-gray-900 mt-1">{fmtCost(totalCost)}</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <p className="text-xs text-gray-400 uppercase tracking-wide font-medium">Coût moyen / article</p>
          <p className="text-2xl font-semibold text-gray-900 mt-1">{fmtCost(filtered.length ? totalCost / filtered.length : null)}</p>
        </div>
      </div>

      {/* Coût par jour -- calculé côté client sur la liste déjà chargée, pas
          une requête séparée. */}
      {costByDay.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Coût par jour</p>
          <div className="space-y-1">
            {costByDay.map((d) => (
              <div key={d.day} className="flex items-center justify-between text-sm py-1 border-b border-gray-50 last:border-0">
                <span className="text-gray-600">
                  {new Date(`${d.day}T00:00:00`).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })}
                </span>
                <span className="text-gray-400">{d.count} article{d.count > 1 ? 's' : ''}</span>
                <span className="font-medium text-gray-900">{fmtCost(d.costUsd)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filtres */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5">
          <input
            type="date" value={dateFrom} max={dateTo}
            onChange={(e) => setDateFrom(e.target.value)}
            className="px-2 py-1.5 text-[12px] bg-white border border-gray-200 rounded-lg text-gray-600 focus:outline-none focus:ring-2 focus:ring-black/10"
            title="Du (inclus)"
          />
          <span className="text-gray-300 text-[11px] select-none">→</span>
          <input
            type="date" value={dateTo} min={dateFrom}
            onChange={(e) => setDateTo(e.target.value)}
            className="px-2 py-1.5 text-[12px] bg-white border border-gray-200 rounded-lg text-gray-600 focus:outline-none focus:ring-2 focus:ring-black/10"
            title="Au (inclus)"
          />
        </div>
        {DATE_PRESETS.map((p) => (
          <button
            key={p.label} type="button" onClick={() => applyDatePreset(p.days)}
            className="px-2.5 py-1.5 rounded-full text-[12px] font-medium border bg-white text-gray-500 border-gray-200 hover:bg-gray-50 whitespace-nowrap"
          >
            {p.label}
          </button>
        ))}
        <select
          value={siteFilter} onChange={(e) => setSiteFilter(e.target.value)}
          className="px-2.5 py-1.5 text-[12px] font-medium bg-white border border-gray-200 rounded-lg text-gray-600 focus:outline-none focus:ring-2 focus:ring-black/10"
        >
          <option value="">Tous les sites</option>
          {sites.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select
          value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
          className="px-2.5 py-1.5 text-[12px] font-medium bg-white border border-gray-200 rounded-lg text-gray-600 focus:outline-none focus:ring-2 focus:ring-black/10"
        >
          <option value="">Tous les statuts</option>
          {Object.values(DISPLAY_STATUS).map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
      </div>

      {/* Tableau */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        {loading && !items.length && <p className="text-sm text-gray-400 py-10 text-center">Chargement...</p>}
        {!loading && !filtered.length && <p className="text-sm text-gray-400 py-10 text-center">Aucun article sur cette période.</p>}
        {filtered.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-400 border-b border-gray-100">
                  <th className="text-left font-medium py-2 px-4">Article</th>
                  <th className="text-left font-medium py-2 px-4">Site</th>
                  <th className="text-left font-medium py-2 px-4">Mot-clé</th>
                  {!isPersonalScope && <th className="text-left font-medium py-2 px-4">Lancé par</th>}
                  <th className="text-left font-medium py-2 px-4">Durée</th>
                  <th className="text-left font-medium py-2 px-4">Coût</th>
                  <th className="text-left font-medium py-2 px-4">Statut</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {paged.map((it) => {
                  const displayStatus = deriveDisplayStatus(it);
                  const canReview = (displayStatus === 'a_relire' || displayStatus === 'publie') && it.articleId;
                  return (
                    <tr key={it.id}>
                      <td className="py-2 px-4 max-w-xs truncate">
                        <a href={it.articleUrl} target="_blank" rel="noopener noreferrer" className="text-teal-700 hover:underline inline-flex items-center gap-1">
                          <span className="truncate">{it.articleUrl}</span>
                          <ExternalLink className="w-3 h-3 flex-shrink-0" />
                        </a>
                      </td>
                      <td className="py-2 px-4 text-gray-500">{it.site || '—'}</td>
                      <td className="py-2 px-4 text-gray-600">{it.targetKeyword || '—'}</td>
                      {!isPersonalScope && <td className="py-2 px-4 text-gray-500">{it.launchedByName || '—'}</td>}
                      <td className="py-2 px-4 text-gray-500 whitespace-nowrap">
                        {it.startedAt && it.completedAt ? fmtDuration(it.completedAt - it.startedAt) : '—'}
                      </td>
                      <td className="py-2 px-4 text-gray-500 whitespace-nowrap">{fmtCost(it.costUsd)}</td>
                      <td className="py-2 px-4">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge meta={DISPLAY_STATUS[displayStatus]} fallback={it.status} />
                          {canReview && (
                            <Link
                              to={`/?articleId=${encodeURIComponent(it.articleId)}`}
                              className="inline-flex items-center gap-1 text-xs font-semibold text-teal-700 hover:text-teal-800 hover:underline"
                            >
                              <Eye className="w-3.5 h-3.5" /> {displayStatus === 'publie' ? 'Voir' : 'Relire'}
                            </Link>
                          )}
                          {it.errorMessage && (
                            <span className="text-xs text-red-500 truncate max-w-[220px]" title={it.errorMessage}>{it.errorMessage}</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <Pagination total={filtered.length} page={page} onPageChange={setPage} />
      </div>

      {/* Widget "MAJ en attente" -- lignes du Google Sheet pas encore lancées.
          Lecture seule : le lancement reste exclusivement sur /lots. */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="font-medium text-gray-900">MAJ en attente</h2>
            {myStaged.length > 0 && (
              <span className="text-xs font-semibold text-white bg-amber-500 rounded-full px-2 py-0.5">{myStaged.length}</span>
            )}
          </div>
          <Link to="/lots" className="text-sm font-medium text-teal-700 hover:text-teal-800">
            Voir dans MAJ en lot →
          </Link>
        </div>
        <p className="text-xs text-gray-500 -mt-1">
          {isPersonalScope
            ? 'Lignes détectées depuis le Google Sheet et qui vous sont attribuées, pas encore lancées.'
            : "Toutes les lignes détectées depuis le Google Sheet, pas encore lancées."}
        </p>

        {loadingStaged && !myStaged.length && <p className="text-sm text-gray-400 py-6 text-center">Chargement...</p>}
        {!loadingStaged && !myStaged.length && <p className="text-sm text-gray-400 py-6 text-center">Rien en attente pour l'instant.</p>}

        {myStaged.length > 0 && (
          <div className="space-y-2">
            {myStaged.map((it) => (
              <div key={it.id} className="flex items-center gap-3 border border-gray-100 rounded-lg p-2 text-sm">
                <div className="flex-1 min-w-0">
                  <a href={it.articleUrl} target="_blank" rel="noopener noreferrer" className="text-gray-900 font-medium hover:underline truncate block">
                    {it.articleUrl}
                  </a>
                  <div className="text-xs text-gray-500">
                    {it.targetKeyword || '—'}
                    {it.assignedTo && <> · attribué à {it.assignedTo}</>}
                  </div>
                </div>
                <span className="text-xs text-gray-400 whitespace-nowrap">{fmtDate(it.detectedAt)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
