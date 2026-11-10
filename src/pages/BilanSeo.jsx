/**
 * BilanSeo — « Effet des MAJ » : est-ce que l'outil fait gagner des positions ?
 *
 * Page distincte de SuiviPositions, qui reste inchangée. Celle-ci ne liste pas
 * les suivis : elle les AGRÈGE. Une ligne par page (URL + mot-clé), position
 * médiane avant la première MAJ contre position médiane après la dernière.
 *
 * ── CE QUE CETTE PAGE S'INTERDIT ───────────────────────────────────────────
 * Afficher un taux de réussite sans son dénominateur. Sur 155 pages suivies,
 * une partie n'a aucun historique Haloscan et une autre vient d'être mise à
 * jour : les compter comme des échecs donnerait à l'outil l'air de rater ce
 * qu'on n'a pas même pu mesurer. Le nombre de pages COMPARABLES est donc le
 * premier chiffre de l'écran, et tant qu'il est mince le bilan est présenté
 * comme une tendance, jamais comme un verdict.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSelector } from 'react-redux';
import axios from 'axios';
import {
  BarChart3, TrendingUp, TrendingDown, Minus, Search, ExternalLink,
  AlertCircle, Loader, RefreshCw, Timer, Activity,
} from 'lucide-react';
import {
  calculerEffetDesMaj, MESURABLES_MIN, FENETRE_AVANT_JOURS, DELAI_EFFET_JOURS,
  EFFET_PROGRESSE, EFFET_RECULE, EFFET_STABLE, EFFET_ENTRE_SERP, EFFET_SORT_SERP,
  EFFET_TROP_RECENT, EFFET_SANS_AVANT, EFFET_SANS_HISTORIQUE, EFFET_ERREUR,
} from '../utils/seoEffect';
import Pagination, { pageSlice } from '../components/common/Pagination';

const hostOf = (url) => {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
};

const fmtDate = (ts) => {
  if (!ts) return '—';
  try { return new Date(ts).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: '2-digit' }); }
  catch { return '—'; }
};

// Libellé + couleur de chaque statut. Les intitulés disent ce qui a été mesuré,
// pas ce qu'on aimerait conclure : « pas d'historique » n'est pas un échec de
// l'outil, et l'écran ne doit pas le laisser croire.
const STATUTS = {
  [EFFET_PROGRESSE]:       { label: 'A progressé',      court: 'Progression',  classe: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  [EFFET_RECULE]:          { label: 'A reculé',         court: 'Recul',        classe: 'bg-red-50 text-red-600 border-red-200' },
  [EFFET_STABLE]:          { label: 'Stable',           court: 'Stable',       classe: 'bg-gray-50 text-gray-500 border-gray-200' },
  [EFFET_ENTRE_SERP]:      { label: 'Entrée en SERP',   court: 'Entrée SERP',  classe: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  [EFFET_SORT_SERP]:       { label: 'Sortie de SERP',   court: 'Sortie SERP',  classe: 'bg-red-50 text-red-600 border-red-200' },
  [EFFET_TROP_RECENT]:     { label: 'Trop récent',      court: 'Trop récent',  classe: 'bg-blue-50 text-blue-600 border-blue-200' },
  [EFFET_SANS_AVANT]:      { label: 'Pas de position avant', court: 'Sans avant', classe: 'bg-amber-50 text-amber-700 border-amber-200' },
  [EFFET_SANS_HISTORIQUE]: { label: 'Pas d\'historique Haloscan', court: 'Sans historique', classe: 'bg-gray-50 text-gray-400 border-gray-200' },
  [EFFET_ERREUR]:          { label: 'Relevé en échec',  court: 'Échec relevé', classe: 'bg-orange-50 text-orange-600 border-orange-200' },
};

const ORDRE = [
  EFFET_PROGRESSE, EFFET_ENTRE_SERP, EFFET_STABLE, EFFET_RECULE, EFFET_SORT_SERP,
  EFFET_TROP_RECENT, EFFET_SANS_AVANT, EFFET_SANS_HISTORIQUE, EFFET_ERREUR,
];

const Badge = ({ statut }) => {
  const s = STATUTS[statut];
  if (!s) return null;
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-semibold rounded-full px-2.5 py-1 leading-none whitespace-nowrap border ${s.classe}`}>
      {statut === EFFET_PROGRESSE || statut === EFFET_ENTRE_SERP ? <TrendingUp size={10} />
        : statut === EFFET_RECULE || statut === EFFET_SORT_SERP ? <TrendingDown size={10} />
          : statut === EFFET_TROP_RECENT ? <Timer size={9} />
            : <Activity size={9} />}
      {s.court}
    </span>
  );
};

const Kpi = ({ valeur, unite, libelle, detail, accent = 'text-gray-900' }) => (
  <div className="bg-white border border-gray-100 rounded-2xl px-4 py-3.5">
    <div className="flex items-baseline gap-1">
      <span className={`text-2xl font-semibold tabular-nums ${accent}`}>{valeur}</span>
      {unite && <span className="text-sm text-gray-400 font-medium">{unite}</span>}
    </div>
    <p className="text-[11px] font-medium text-gray-600 mt-0.5">{libelle}</p>
    {detail && <p className="text-[10px] text-gray-400 mt-0.5 leading-snug">{detail}</p>}
  </div>
);

export default function BilanSeo() {
  const haloscanConfigured = useSelector((s) => !!s.settings.haloscanKey);
  const [data, setData]       = useState(null);   // null = chargement
  const [erreur, setErreur]   = useState(null);
  const [search, setSearch]   = useState('');
  const [filtre, setFiltre]   = useState(null);   // statut sélectionné
  const [page, setPage]       = useState(1);
  const [rafraichi, setRafraichi] = useState(null); // couple en cours de relevé

  const charger = useCallback(() => {
    setErreur(null);
    axios.get('/api/haloscan/dashboard')
      .then((r) => setData(r.data))
      .catch((e) => {
        setData({ trackings: [], cache: [] });
        setErreur(e.response?.data?.error || 'Impossible de charger le bilan.');
      });
  }, []);

  useEffect(() => { charger(); }, [charger]);

  const { pages, bilan } = useMemo(
    () => (data ? calculerEffetDesMaj(data.trackings, data.cache, data.beforeSnapshots) : { pages: [], bilan: null }),
    [data]);

  const rafraichirUn = async (p) => {
    setRafraichi(`${p.url}|${p.keyword}`);
    try {
      await axios.post('/api/haloscan/dashboard/refresh', {
        articleUrl: p.url, keyword: p.keyword, firstMajAt: p.firstMajAt,
      });
      charger();
    } catch (e) {
      setErreur(e.response?.data?.detail || e.response?.data?.error || 'Relevé Haloscan impossible.');
    } finally {
      setRafraichi(null);
    }
  };

  const q = search.trim().toLowerCase();
  const filtrees = useMemo(() => {
    let l = pages;
    if (filtre) l = l.filter((p) => p.statut === filtre);
    if (q) l = l.filter((p) => p.title?.toLowerCase().includes(q) || p.url?.toLowerCase().includes(q) || p.keyword?.toLowerCase().includes(q));
    // Les pages comparables d'abord, puis le plus gros mouvement en tête :
    // c'est ce qu'on vient voir, pas la liste de ce qui manque.
    return [...l].sort((a, b) => {
      const ma = a.diff != null ? 0 : 1, mb = b.diff != null ? 0 : 1;
      if (ma !== mb) return ma - mb;
      return (b.diff ?? 0) - (a.diff ?? 0);
    });
  }, [pages, filtre, q]);

  const paged = pageSlice(filtrees, page);

  return (
    <div className="max-w-6xl mx-auto px-4 md:px-6 py-6 space-y-4">
      <div className="flex items-center gap-2.5">
        <span className="flex items-center justify-center w-9 h-9 rounded-xl bg-emerald-50 text-emerald-600">
          <BarChart3 size={18} />
        </span>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-semibold text-gray-900">Effet des MAJ</h1>
          <p className="text-xs text-gray-400">
            Position médiane avant la première MAJ contre position médiane après la dernière, une ligne par page — réservé aux super admins.
          </p>
        </div>
        {data && (
          <button
            onClick={() => { setData(null); charger(); }}
            className="inline-flex items-center gap-1.5 text-[11px] font-medium text-gray-500 hover:text-emerald-600 border border-gray-200 hover:border-emerald-200 rounded-xl px-3 py-2 transition-colors"
          >
            <RefreshCw size={12} /> Recharger
          </button>
        )}
      </div>

      {!haloscanConfigured && (
        <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
          <AlertCircle size={14} className="shrink-0" />
          Haloscan n'est pas configuré — renseignez la clé API dans Paramètres.
        </div>
      )}

      {erreur && (
        <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
          <AlertCircle size={14} className="shrink-0" /> {erreur}
        </div>
      )}

      {data === null ? (
        <div className="flex items-center justify-center gap-2 py-16 text-xs text-gray-400 bg-white border border-gray-100 rounded-2xl">
          <Loader size={14} className="animate-spin" /> Chargement du bilan…
        </div>
      ) : !pages.length ? (
        <p className="text-xs text-gray-400 text-center py-16 bg-white border border-gray-100 rounded-2xl">
          Aucune page suivie pour l'instant — le suivi démarre quand un mot-clé cible est renseigné au lancement d'une MAJ.
        </p>
      ) : (
        <>
          {/* LE DÉNOMINATEUR D'ABORD. Un taux de réussite présenté seul laisserait
              croire qu'il porte sur les 155 pages suivies. */}
          <div className={`flex items-start gap-2 text-xs rounded-xl px-4 py-3 border ${
            bilan.fiable ? 'text-gray-600 bg-gray-50 border-gray-200' : 'text-amber-800 bg-amber-50 border-amber-200'
          }`}>
            <AlertCircle size={14} className="shrink-0 mt-0.5" />
            <p className="leading-relaxed">
              <strong>{bilan.mesurables} page{bilan.mesurables > 1 ? 's' : ''} comparable{bilan.mesurables > 1 ? 's' : ''}</strong> sur {bilan.total} suivie{bilan.total > 1 ? 's' : ''}.
              {!bilan.fiable && (
                <> En dessous de {MESURABLES_MIN} pages, les chiffres ci-dessous sont une <strong>tendance</strong>, pas un verdict sur l'outil.</>
              )}
              {' '}Les {bilan.total - bilan.mesurables} autres n'ont pas d'avant / après exploitable : {bilan.sansHistorique} sans historique Haloscan,
              {' '}{bilan.tropRecent} trop récentes, {bilan.sansAvant} sans position avant la MAJ, {bilan.erreur} en échec de relevé.
            </p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Kpi
              valeur={bilan.tauxProgression == null ? '—' : bilan.tauxProgression}
              unite={bilan.tauxProgression == null ? '' : '%'}
              libelle="Pages en progression"
              detail={bilan.tauxProgression == null ? 'Rien de comparable pour l\'instant' : `${bilan.progresse} sur ${bilan.mesurables} comparables`}
              accent={bilan.tauxProgression == null ? 'text-gray-300' : bilan.tauxProgression >= 50 ? 'text-emerald-600' : 'text-gray-900'}
            />
            <Kpi
              valeur={bilan.gainMedian == null ? '—' : (bilan.gainMedian > 0 ? `+${bilan.gainMedian}` : bilan.gainMedian)}
              libelle="Gain médian"
              detail="Places gagnées, médiane des pages comparables"
              accent={bilan.gainMedian == null ? 'text-gray-300' : bilan.gainMedian > 0 ? 'text-emerald-600' : bilan.gainMedian < 0 ? 'text-red-500' : 'text-gray-900'}
            />
            <Kpi
              valeur={bilan.entreDansSerp}
              libelle="Entrées en SERP"
              detail="Hors top 100 avant, classées après"
              accent={bilan.entreDansSerp ? 'text-emerald-600' : 'text-gray-900'}
            />
            <Kpi
              valeur={bilan.sortDuSerp}
              libelle="Sorties de SERP"
              detail="Classées avant, hors top 100 après"
              accent={bilan.sortDuSerp ? 'text-red-500' : 'text-gray-900'}
            />
          </div>

          {/* Répartition cliquable : chaque pastille filtre la table. */}
          <div className="bg-white border border-gray-100 rounded-2xl px-4 py-3 flex flex-wrap items-center gap-2">
            <button
              onClick={() => { setFiltre(null); setPage(1); }}
              className={`text-[11px] font-semibold rounded-full px-2.5 py-1 border transition-colors ${
                filtre === null ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300'
              }`}
            >
              Toutes ({pages.length})
            </button>
            {ORDRE.map((st) => {
              const n = pages.filter((p) => p.statut === st).length;
              if (!n) return null;
              return (
                <button
                  key={st}
                  onClick={() => { setFiltre(filtre === st ? null : st); setPage(1); }}
                  className={`inline-flex items-center gap-1 text-[11px] font-semibold rounded-full px-2.5 py-1 border transition-colors ${
                    filtre === st ? 'ring-2 ring-offset-1 ring-gray-300 ' : ''
                  }${STATUTS[st].classe}`}
                >
                  {STATUTS[st].label} ({n})
                </button>
              );
            })}
          </div>

          <div className="relative max-w-xs">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-300" />
            <input
              type="text"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              placeholder="Rechercher une page ou un mot-clé…"
              className="w-full pl-8 pr-3 py-2 text-xs bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-emerald-300"
            />
          </div>

          <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden">
            {!filtrees.length ? (
              <p className="text-xs text-gray-400 text-center py-10">Aucune page ne correspond.</p>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-gray-100 bg-gray-50/60">
                        {['Site', 'Page', 'Mot-clé', 'MAJ', 'Avant', 'Après', 'Gain', 'Statut', ''].map((h) => (
                          <th key={h} className="py-2.5 px-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wide text-left whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {paged.map((p) => {
                        const cle = `${p.url}|${p.keyword}`;
                        return (
                          <tr key={cle} className="hover:bg-gray-50/60 transition-colors">
                            <td className="py-2.5 px-3 text-gray-400 whitespace-nowrap">{hostOf(p.url) || '—'}</td>
                            <td className="py-2.5 px-3 font-medium text-gray-700 max-w-[240px]">
                              <span className="truncate block" title={p.title || p.url}>{p.title || p.url}</span>
                            </td>
                            <td className="py-2.5 px-3 text-gray-500 max-w-[160px]">
                              <span className="truncate block" title={p.keyword}>{p.keyword}</span>
                            </td>
                            <td className="py-2.5 px-3 text-gray-400 whitespace-nowrap" title={
                              p.majCount > 1
                                ? `${p.majCount} passages, du ${fmtDate(p.firstMajAt)} au ${fmtDate(p.lastMajAt)}`
                                : `1 passage le ${fmtDate(p.firstMajAt)}`
                            }>
                              {fmtDate(p.lastMajAt)}
                              {p.majCount > 1 && <span className="ml-1 text-[10px] text-gray-300">×{p.majCount}</span>}
                            </td>
                            <td className="py-2.5 px-3 font-mono text-gray-600 whitespace-nowrap">
                              {p.avant != null ? (
                                <span title={p.avantSource === 'releve_j0'
                                  ? 'Relevé unique du jour de la MAJ — l\'historique Haloscan ne remonte pas avant'
                                  : `Médiane de ${p.pointsAvant} relevé(s) avant la MAJ`}>
                                  #{p.avant}
                                  {/* Un point unique ne doit pas se faire passer pour une médiane. */}
                                  {p.avantSource === 'releve_j0' && <span className="ml-0.5 text-amber-500 font-sans">*</span>}
                                </span>
                              ) : <span className="text-gray-300">—</span>}
                            </td>
                            <td className="py-2.5 px-3 font-mono text-gray-600 whitespace-nowrap">
                              {p.apres != null ? `#${p.apres}` : <span className="text-gray-300">—</span>}
                            </td>
                            <td className="py-2.5 px-3 whitespace-nowrap">
                              {p.diff == null ? <span className="text-gray-300">—</span>
                                : p.diff > 0 ? <span className="inline-flex items-center gap-0.5 text-emerald-600 font-semibold"><TrendingUp size={11} />+{p.diff}</span>
                                  : p.diff < 0 ? <span className="inline-flex items-center gap-0.5 text-red-500 font-semibold"><TrendingDown size={11} />{p.diff}</span>
                                    : <span className="inline-flex items-center gap-0.5 text-gray-400"><Minus size={11} />=</span>}
                            </td>
                            <td className="py-2.5 px-3 whitespace-nowrap"><Badge statut={p.statut} /></td>
                            <td className="py-2.5 px-3 whitespace-nowrap">
                              <div className="flex items-center gap-1.5">
                                <button
                                  onClick={() => rafraichirUn(p)}
                                  disabled={rafraichi === cle}
                                  title="Relever la position maintenant (1 crédit Haloscan)"
                                  className="text-gray-300 hover:text-emerald-600 disabled:text-gray-200 transition-colors"
                                >
                                  <RefreshCw size={12} className={rafraichi === cle ? 'animate-spin' : ''} />
                                </button>
                                {p.url && (
                                  <a href={p.url} target="_blank" rel="noreferrer" title="Ouvrir la page"
                                    className="text-gray-300 hover:text-blue-600 transition-colors">
                                    <ExternalLink size={12} />
                                  </a>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <Pagination total={filtrees.length} page={page} onPageChange={setPage} />
              </>
            )}
          </div>

          <p className="text-[10px] text-gray-400 leading-relaxed px-1">
            Méthode — « avant » = médiane des positions relevées dans les {FENETRE_AVANT_JOURS} jours précédant la première MAJ ;
            « après » = médiane des {FENETRE_AVANT_JOURS} jours suivants, à partir de J+{DELAI_EFFET_JOURS} après la dernière MAJ
            (les jours qui suivent immédiatement une republication mesurent le recrawl de Google, pas l'effet du contenu).
            Un mouvement d'une seule place est compté comme stable. Une page hors SERP n'est jamais convertie en numéro de position :
            elle est comptée à part, en entrée ou en sortie de SERP. Historiques Haloscan rafraîchis une fois par semaine.
            {' '}<span className="text-amber-500 font-semibold">*</span> à côté d'un « avant » = relevé unique du jour de la MAJ,
            utilisé quand l'historique Haloscan ne remonte pas plus loin — moins solide qu'une médiane, mais pris au bon moment.
          </p>
        </>
      )}
    </div>
  );
}
