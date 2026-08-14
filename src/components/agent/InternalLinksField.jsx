// Saisie des paires ancre + URL du maillage interne (règle 9).
//
// Extrait de QatBriefFields pour être rendu à DEUX endroits, et pas un de
// moins : l'écran de lancement manuel (où il vivait) ET la phase 2, juste avant
// la génération. Sans le second, tout article arrivé par « MAJ en attente »
// partait avec `internalLinks: []` — le forçage à 100 % s'appliquait alors à un
// brief vide, garantie exacte et sans effet, sans que le rédacteur puisse rien
// y faire depuis l'interface.
//
// Le composant ne décide rien : il saisit. Le filtrage hors domaine (règle 8)
// reste à `classifyBriefLinks`/`filterSameSiteLinks`, la pose à `weaveBriefLinks`.
import React from 'react';
import { Link2, Plus, X as XIcon, AlertCircle } from 'lucide-react';
import {
  INTERNAL_LINK_ROWS_MAX, emptyLinkRow, cleanLinkRows,
  offDomainLinkRows, unverifiableLinkRows,
} from '../../constants/majMode';

const InternalLinksField = ({ linkRows, setLinkRows, articleUrl = '', disabled = false }) => {
  const filled = cleanLinkRows(linkRows).length;
  // Le code PLACE lui-même ces liens depuis R2 : une URL hors domaine deviendrait
  // un lien EXTERNE ajouté (règle 8), donc elle est écartée. Autant le dire ICI,
  // pendant la saisie, plutôt qu'après une MAJ payée.
  const horsDomaine = offDomainLinkRows(linkRows, articleUrl);
  const nonVerifiables = unverifiableLinkRows(linkRows, articleUrl);

  const setRow = (i, patch) =>
    setLinkRows(rows => rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <div className="space-y-2">
      <label className="flex items-center gap-1.5 text-sm font-medium text-gray-700">
        <Link2 size={13} className="text-gray-400" />
        Liens internes à placer
        <span className="ml-1 text-xs font-normal text-gray-400">
          {filled} paire{filled > 1 ? 's' : ''} complète{filled > 1 ? 's' : ''}
        </span>
      </label>

      <div className="space-y-2">
        {linkRows.map((row, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              type="text"
              value={row.anchor}
              onChange={e => setRow(i, { anchor: e.target.value })}
              disabled={disabled}
              placeholder="Ancre — ex. le prix au m² d'un faux plafond"
              className="input-glass text-xs flex-1 min-w-0 disabled:opacity-60"
            />
            <input
              type="url"
              value={row.url}
              onChange={e => setRow(i, { url: e.target.value })}
              disabled={disabled}
              placeholder="https://mon-site.fr/ma-page"
              className="input-glass text-xs flex-1 min-w-0 disabled:opacity-60"
            />
            <button
              type="button"
              disabled={disabled}
              onClick={() => setLinkRows(rows => (rows.length > 1 ? rows.filter((_, j) => j !== i) : [emptyLinkRow()]))}
              className="p-1.5 text-gray-300 hover:text-red-500 transition-colors shrink-0 disabled:opacity-40"
              title="Retirer cette ligne"
            >
              <XIcon size={14} />
            </button>
          </div>
        ))}
      </div>

      {linkRows.length < INTERNAL_LINK_ROWS_MAX && (
        <button
          type="button"
          disabled={disabled}
          onClick={() => setLinkRows(rows => [...rows, emptyLinkRow()])}
          className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-800 transition-colors disabled:opacity-40"
        >
          <Plus size={13} /> Ajouter un lien
        </button>
      )}

      {horsDomaine.length > 0 && (
        <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-[11px] text-red-700">
          <AlertCircle size={13} className="shrink-0 mt-0.5" />
          <span>
            {horsDomaine.length} URL hors du domaine de l'article — elle{horsDomaine.length > 1 ? 's' : ''} sera
            {horsDomaine.length > 1 ? 'ont' : ''} ÉCARTÉE{horsDomaine.length > 1 ? 'S' : ''} : le maillage interne ne
            doit jamais ajouter de lien externe. {horsDomaine.map(r => r.url).join(', ')}
          </span>
        </div>
      )}

      {nonVerifiables.length > 0 && (
        <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-[11px] text-amber-700">
          <AlertCircle size={13} className="shrink-0 mt-0.5" />
          <span>
            Aucune URL d'article n'est renseignée (contenu collé) : une URL absolue ne peut alors être ni vérifiée ni
            placée — le verrou liens externes la retirerait. Saisissez un chemin relatif (<code>/ma-page</code>) pour
            ces {nonVerifiables.length} paire(s).
          </span>
        </div>
      )}

      <p className="text-[11px] text-gray-400">
        Toutes ces paires sont placées : celles que l'IA n'intègre pas d'elle-même, le code les place — en écrivant
        au besoin une courte phrase, surlignée en jaune dans l'éditeur pour que vous la reformuliez. Jamais dans un
        titre, le TL;DR, un tableau ou la FAQ. Les liens externes de l'article d'origine sont conservés à l'identique
        et aucun n'est ajouté.
      </p>
    </div>
  );
};

export default InternalLinksField;
