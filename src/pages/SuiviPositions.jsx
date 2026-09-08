/**
 * SuiviPositions — page dédiée (super_admin) au suivi de position SEO
 * (Haloscan), TOUS les articles trackés en une seule vue.
 *
 * Le suivi lui-même (snapshot « avant » à la sauvegarde initiale, puis J+7 et
 * J+30 automatiques via le cron serveur) existe déjà et n'est pas modifié —
 * cette page n'ajoute qu'une vue d'ensemble : jusqu'ici, la seule façon de
 * voir une position était d'ouvrir l'article correspondant dans l'Historique.
 */
import { Fragment, useEffect, useMemo, useState } from 'react';
import { useSelector } from 'react-redux';
import { motion, AnimatePresence } from 'framer-motion';
import {
  TrendingUp, TrendingDown, Minus, Search, ExternalLink, ChevronDown, ChevronUp,
  Timer, Activity, Loader, AlertCircle,
} from 'lucide-react';
import { getSeoTrackingOverview } from '../services/firebase';
import {
  seoTrackingStatus, SEO_STATUT_ATTENTE_J7, SEO_STATUT_ATTENTE_J30, SEO_STATUT_EVOLUTION, SEO_STATUT_PARTIEL,
} from '../utils/seoTrackingStatus';
import { SeoPanel } from './Historique';
import Pagination, { pageSlice } from '../components/common/Pagination';

const hostOf = (url) => {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
};

const fmtDate = (ts) => {
  if (!ts) return '—';
  try { return new Date(ts).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' }); }
  catch { return '—'; }
};

const StatutBadge = ({ info }) => {
  if (!info) return null;
  if (info.statut === SEO_STATUT_ATTENTE_J7 || info.statut === SEO_STATUT_ATTENTE_J30) {
    const j30 = info.statut === SEO_STATUT_ATTENTE_J30;
    return (
      <span className={`inline-flex items-center gap-1 text-[11px] font-semibold rounded-full px-2.5 py-1 leading-none whitespace-nowrap border ${
        j30 ? 'bg-violet-50 text-violet-600 border-violet-200' : 'bg-blue-50 text-blue-600 border-blue-200'
      }`}>
        <Timer size={9} /> En attente J+{j30 ? '30' : '7'}
      </span>
    );
  }
  if (info.statut === SEO_STATUT_EVOLUTION) {
    const { diff } = info;
    return (
      <span className={`inline-flex items-center gap-1 text-[11px] font-semibold rounded-full px-2.5 py-1 leading-none whitespace-nowrap border ${
        diff > 0 ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
          : diff < 0 ? 'bg-red-50 text-red-600 border-red-200'
            : 'bg-gray-50 text-gray-500 border-gray-200'
      }`}>
        {diff > 0 ? <TrendingUp size={10} /> : diff < 0 ? <TrendingDown size={10} /> : <Minus size={10} />}
        Terminé
      </span>
    );
  }
  if (info.statut === SEO_STATUT_PARTIEL) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-semibold bg-gray-50 text-gray-500 border border-gray-200 rounded-full px-2.5 py-1 leading-none whitespace-nowrap">
        <Activity size={9} className="text-gray-400" /> Partiel
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-semibold bg-emerald-50 text-emerald-600 border border-emerald-200 rounded-full px-2.5 py-1 leading-none whitespace-nowrap">
      <Activity size={9} /> SEO actif
    </span>
  );
};

export default function SuiviPositions() {
  const haloscanConfigured = useSelector((s) => !!s.settings.haloscanKey);
  const [rows, setRows] = useState(null); // null = chargement
  const [error, setError] = useState(false);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [ouvert, setOuvert] = useState(null); // articleId déplié

  useEffect(() => {
    getSeoTrackingOverview()
      .then((data) => setRows(Array.isArray(data) ? data : []))
      .catch(() => { setRows([]); setError(true); });
  }, []);

  const items = useMemo(() => {
    if (!rows) return [];
    return rows
      .map((r) => ({ ...r, statut: seoTrackingStatus(r.seoTracking) }))
      .filter((r) => r.statut); // suivi désactivé entretemps → écarté
  }, [rows]);

  const q = search.trim().toLowerCase();
  const filtered = q
    ? items.filter((r) =>
        r.title?.toLowerCase().includes(q) ||
        r.url?.toLowerCase().includes(q) ||
        (r.seoTracking?.keywords || []).some((k) => k.toLowerCase().includes(q)))
    : items;

  const paged = pageSlice(filtered, page);

  return (
    <div className="max-w-6xl mx-auto px-4 md:px-6 py-6 space-y-4">
      <div className="flex items-center gap-2.5">
        <span className="flex items-center justify-center w-9 h-9 rounded-xl bg-emerald-50 text-emerald-600">
          <TrendingUp size={18} />
        </span>
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Suivi des positions SEO</h1>
          <p className="text-xs text-gray-400">
            Position Haloscan avant / après chaque MAJ, tous les articles trackés — réservé aux super admins.
          </p>
        </div>
      </div>

      {!haloscanConfigured && (
        <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
          <AlertCircle size={14} className="shrink-0" />
          Haloscan n'est pas configuré — renseignez la clé API dans Paramètres pour activer le suivi de position.
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
          <AlertCircle size={14} className="shrink-0" /> Impossible de charger le suivi des positions.
        </div>
      )}

      {rows !== null && haloscanConfigured && (
        <div className="relative max-w-xs">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-300" />
          <input
            type="text"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="Rechercher un article ou un mot-clé…"
            className="w-full pl-8 pr-3 py-2 text-xs bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-emerald-300"
          />
        </div>
      )}

      <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden">
        {rows === null ? (
          <div className="flex items-center justify-center gap-2 py-10 text-xs text-gray-400">
            <Loader size={14} className="animate-spin" /> Chargement…
          </div>
        ) : items.length === 0 ? (
          <p className="text-xs text-gray-400 text-center py-10">
            Aucun suivi de position actif pour l'instant — il démarre automatiquement quand un mot-clé cible est renseigné au lancement d'une MAJ.
          </p>
        ) : filtered.length === 0 ? (
          <p className="text-xs text-gray-400 text-center py-10">Aucun résultat pour « {search} ».</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50/60">
                    {['Site', 'Article', 'Mot(s)-clé(s)', 'Avant', 'Actuelle', 'Évolution', 'Statut', 'Lancé le', ''].map((h) => (
                      <th key={h} className="py-2.5 px-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wide text-left whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {paged.map((r) => {
                    const deplie = ouvert === r.articleId;
                    const { statut } = r;
                    return (
                      <Fragment key={r.articleId}>
                        <tr
                          onClick={() => setOuvert(deplie ? null : r.articleId)}
                          className="hover:bg-gray-50/60 transition-colors cursor-pointer"
                        >
                          <td className="py-2.5 px-3 text-gray-400 whitespace-nowrap">{hostOf(r.url) || '—'}</td>
                          <td className="py-2.5 px-3 font-medium text-gray-700 max-w-[260px]">
                            <span className="truncate block">{r.title || r.url || r.articleId}</span>
                          </td>
                          <td className="py-2.5 px-3 text-gray-500 max-w-[200px]">
                            <span className="truncate block">{(r.seoTracking?.keywords || []).join(', ') || '—'}</span>
                          </td>
                          <td className="py-2.5 px-3 font-mono text-gray-600 whitespace-nowrap">
                            {statut.beforePos ? `#${statut.beforePos}` : '—'}
                          </td>
                          <td className="py-2.5 px-3 font-mono text-gray-600 whitespace-nowrap">
                            {statut.latestPos ? `#${statut.latestPos}` : '—'}
                          </td>
                          <td className="py-2.5 px-3 whitespace-nowrap">
                            {statut.diff == null ? <span className="text-gray-300">—</span>
                              : statut.diff > 0 ? <span className="inline-flex items-center gap-0.5 text-emerald-600 font-semibold"><TrendingUp size={11} />+{statut.diff}</span>
                              : statut.diff < 0 ? <span className="inline-flex items-center gap-0.5 text-red-500 font-semibold"><TrendingDown size={11} />{statut.diff}</span>
                              : <span className="inline-flex items-center gap-0.5 text-gray-400"><Minus size={11} />=</span>}
                          </td>
                          <td className="py-2.5 px-3 whitespace-nowrap"><StatutBadge info={statut} /></td>
                          <td className="py-2.5 px-3 text-gray-400 whitespace-nowrap">{fmtDate(r.seoTracking?.createdAt)}</td>
                          <td className="py-2.5 px-3 text-gray-300">
                            {deplie ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                          </td>
                        </tr>
                        {deplie && (
                          <tr>
                            <td colSpan={9} className="px-3 pb-3">
                              <AnimatePresence>
                                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                                  <SeoPanel
                                    seoTracking={r.seoTracking}
                                    majDate={r.seoTracking?.createdAt
                                      ? new Date(r.seoTracking.createdAt).toISOString().slice(0, 10)
                                      : null}
                                  />
                                  {r.url && (
                                    <a href={r.url} target="_blank" rel="noreferrer"
                                      className="mt-2 inline-flex items-center gap-1 text-[11px] text-gray-400 hover:text-blue-600 hover:underline">
                                      <ExternalLink size={10} /> Ouvrir l'article
                                    </a>
                                  )}
                                </motion.div>
                              </AnimatePresence>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pagination total={filtered.length} page={page} onPageChange={setPage} />
          </>
        )}
      </div>
    </div>
  );
}
