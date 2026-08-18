/**
 * AuditChecklist — LE RÉDACTEUR TRANCHE CE QUE L'AUDIT IMPOSE.
 *
 * Colonne GAUCHE de la phase 2, face aux directives (colonne droite). L'audit ne
 * part plus en bloc : le rédacteur coche, et la sélection filtre les DEUX canaux
 * d'envoi (`filterAuditBySelection`, utils/auditSelection.js).
 *
 * Ce que ce panneau ne fait PAS, et ne doit jamais faire : proposer de désactiver
 * un verrou technique. Liens externes, dofollow/nofollow, reprise des liens et
 * des images, maillage à 100 %, plafond de 20 mots, gras sémantique, plancher de
 * liens internes — tout cela s'applique sans recours et n'apparaît pas ici. Les
 * cases pilotent le CONTENU, rien d'autre (décision Andrianina, août 2026).
 */
import { AlertTriangle, ShieldCheck, Clock, ListChecks, Sparkles } from 'lucide-react';
import {
  AUDIT_BLOCKS, FACTUAL_FIELDS, isFieldSelected, selectedPriorities, isSelectionEmpty,
} from '../../utils/auditSelection';
import { SCOPE_SIMPLE, MIN_WORDS_ADDED_SIMPLE } from '../../constants/majPhases';

const ICONES = {
  factuel:       <ShieldCheck size={13} />,
  fraicheur:     <Clock size={13} />,
  actions:       <ListChecks size={13} />,
  ameliorations: <Sparkles size={13} />,
};

const LIBELLES = {
  a_supprimer:              'Passages à supprimer',
  sources_check:            'Affirmations à sourcer',
  recent_context:           'Données périmées et développements manquants',
  seo_geo_gaps:             'Manques SEO / GEO',
  eeat_recommendations:     'Recommandations E-E-A-T',
  strategic_recommendation: 'Recommandation stratégique',
  tldr:                     'TL;DR proposé par l\'audit',
};

const PRIORITES = ['P1', 'P2', 'P3'];

/** Nombre d'éléments réellement portés par une catégorie de l'audit. */
const compte = (audit, field) => {
  const v = audit?.[field];
  if (Array.isArray(v)) return v.length;
  if (field === 'recent_context') {
    const r = v || {};
    return (Array.isArray(r.donnees_obsoletes) ? r.donnees_obsoletes.length : 0)
      + (Array.isArray(r.developpements_manquants) ? r.developpements_manquants.length : 0);
  }
  if (v && typeof v === 'object') return Object.keys(v).length;
  return v ? 1 : 0;
};

const Case = ({ checked, onChange, disabled, label, count, ton = 'gray' }) => (
  <label
    className={`flex items-start gap-2 py-1 cursor-pointer group ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
  >
    <input
      type="checkbox"
      checked={checked}
      disabled={disabled}
      onChange={(e) => onChange(e.target.checked)}
      className="mt-0.5 shrink-0 accent-gray-800"
    />
    <span className={`text-[12px] leading-snug ${checked ? 'text-gray-800' : 'text-gray-500'} group-hover:text-gray-900`}>
      {label}
      {count > 0 && (
        <span className={`ml-1.5 text-[10px] font-semibold tabular-nums ${ton === 'red' ? 'text-red-500' : 'text-gray-400'}`}>
          {count}
        </span>
      )}
    </span>
  </label>
);

export default function AuditChecklist({
  audit,
  selection,
  onChange,
  scope = SCOPE_SIMPLE,
  disabled = false,
}) {
  // Pas d'audit : rien à cocher. On ne montre pas une liste vide qui laisserait
  // croire que l'analyse n'a rien trouvé — un audit absent est un ÉCHEC, traité
  // en amont (phase 1), pas une liste sans case.
  if (!audit) return null;

  const set = (patch) => onChange?.({ ...selection, ...patch });

  const togglePriorite = (p, on) => {
    const actuelles = selectedPriorities(selection);
    set({ priority_actions: on ? [...new Set([...actuelles, p])] : actuelles.filter((x) => x !== p) });
  };

  const actionsParPriorite = (p) =>
    (Array.isArray(audit.priority_actions) ? audit.priority_actions : []).filter((a) => a?.priority === p);

  const factuelDecoche = FACTUAL_FIELDS.filter((f) => !isFieldSelected(selection, f) && compte(audit, f) > 0);
  const simple = scope === SCOPE_SIMPLE;

  return (
    <div className="space-y-4">
      <div>
        <h4 className="text-sm font-medium text-gray-700">Ce que l'audit envoie à la génération</h4>
        <p className="text-[11px] text-gray-400 mt-0.5">
          Décochez ce qui n'a pas sa place dans CET article. Ce que vous décochez ne part pas — ni ici, ni dans
          l'audit transmis au modèle.
        </p>
      </div>

      {/* BUDGET ANNONCÉ AVANT DE COCHER, pas après avoir lu le résultat. Une MAJ
          simple ajoute 200 mots, soit UN H2 : trente consignes n'y tiennent pas,
          et le modèle les arbitrait seul — c'est en arbitrant qu'il a inventé une
          confirmation de date que l'audit demandait de mettre au conditionnel. */}
      {simple && (
        <p className="rounded-xl border border-sky-100 bg-sky-50/60 px-3 py-2 text-[11px] text-sky-800">
          MAJ simple : <strong>{MIN_WORDS_ADDED_SIMPLE} mots minimum</strong>, soit un H2 bien sourcé. Ne cochez que ce
          qui tient dans ce périmètre.
        </p>
      )}

      {AUDIT_BLOCKS.map((bloc) => {
        // Une catégorie que l'audit n'a pas remplie n'a pas de case : cocher du
        // vide n'a pas de sens, et ça allongerait la liste pour rien.
        const champs = bloc.fields.filter((f) => f === 'priority_actions' || compte(audit, f) > 0);
        if (!champs.length) return null;
        const factuel = bloc.key === 'factuel';

        return (
          <div
            key={bloc.key}
            className={`rounded-xl border px-3 py-2 ${
              factuel ? 'border-red-100 bg-red-50/40' : 'border-gray-100 bg-white/40'
            }`}
          >
            <div className={`flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide ${
              factuel ? 'text-red-700' : 'text-gray-500'
            }`}
            >
              <span className={factuel ? 'text-red-500' : 'text-gray-400'}>{ICONES[bloc.key]}</span>
              {bloc.label}
            </div>
            <p className={`text-[10px] mt-0.5 mb-1 ${factuel ? 'text-red-600/80' : 'text-gray-400'}`}>{bloc.hint}</p>

            {champs.map((f) => {
              if (f !== 'priority_actions') {
                return (
                  <Case
                    key={f}
                    checked={isFieldSelected(selection, f)}
                    onChange={(on) => set({ [f]: on })}
                    disabled={disabled}
                    label={LIBELLES[f]}
                    count={compte(audit, f)}
                    ton={factuel ? 'red' : 'gray'}
                  />
                );
              }
              // `priority_actions` se coche PAR PRIORITÉ : c'est la granularité
              // utile. Sur une MAJ simple, cocher les P1 en bloc ferait entrer
              // « réduire de 3 452 à 2 500 mots » face à « ajoute 200 mots ».
              const retenues = selectedPriorities(selection);
              return PRIORITES.map((p) => {
                const n = actionsParPriorite(p).length;
                if (!n) return null;
                return (
                  <div key={p}>
                    <Case
                      checked={retenues.includes(p)}
                      onChange={(on) => togglePriorite(p, on)}
                      disabled={disabled}
                      label={`Actions ${p}`}
                      count={n}
                    />
                    {retenues.includes(p) && (
                      <ul className="ml-6 mb-1 space-y-0.5">
                        {actionsParPriorite(p).map((a, i) => (
                          <li key={i} className="text-[10px] text-gray-400 leading-snug truncate" title={a?.title || ''}>
                            {a?.title || a?.detail}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              });
            })}
          </div>
        );
      })}

      {/* Le silence était le vrai défaut : rien ne distinguait « rien décoché »
          de « factuel écarté ». Dit ici, et redemandé à la publication. */}
      {factuelDecoche.length > 0 && (
        <p className="flex items-start gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
          <AlertTriangle size={12} className="shrink-0 mt-0.5" />
          <span>
            Vous publierez sans traiter&nbsp;
            {factuelDecoche.map((f) => LIBELLES[f].toLowerCase()).join(' ni ')}. Confirmation redemandée avant
            publication.
          </span>
        </p>
      )}

      {isSelectionEmpty(selection) && (
        <p className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-[11px] text-gray-600">
          Tout est décoché : l'audit ne pèsera pas sur cette génération. Seules vos directives partiront.
        </p>
      )}
    </div>
  );
}
