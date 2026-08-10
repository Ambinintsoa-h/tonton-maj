/**
 * PhaseStepper — navigation du parcours en quatre phases.
 *
 * Remplace la navigation par onglets comme repère principal : le rédacteur voit
 * où il en est, ce qui est fait, et ce qui reste. Les vues Audit / Avant / Après
 * subsistent en dessous comme sous-vues de la phase courante.
 *
 * Règle de navigation (constants/majPhases.js) : revenir en arrière est toujours
 * permis, sauter une phase en avant non — une phase verrouillée est visiblement
 * désactivée plutôt que masquée, pour que le parcours reste lisible d'un coup d'œil.
 */
import { Check, Lock, Loader2, AlertTriangle } from 'lucide-react';
import {
  PHASE_ORDER, PHASES, DONE, RUNNING, ERROR, canEnterPhase,
} from '../../constants/majPhases';

const etatIcone = (statut) => {
  if (statut === DONE)    return <Check size={11} strokeWidth={3} />;
  if (statut === RUNNING) return <Loader2 size={11} className="animate-spin" />;
  if (statut === ERROR)   return <AlertTriangle size={11} />;
  return null;
};

export default function PhaseStepper({ phase, phaseStatus = {}, onSelect }) {
  return (
    <div className="glass-card p-2.5">
      <div className="flex items-stretch gap-1.5">
        {PHASE_ORDER.map((id) => {
          const meta      = PHASES[id];
          const statut    = phaseStatus[id];
          const courante  = phase === id;
          const ouvrable  = canEnterPhase(id, phaseStatus);
          const verrouillee = !ouvrable;

          return (
            <button
              key={id}
              type="button"
              disabled={verrouillee}
              onClick={() => ouvrable && onSelect?.(id)}
              title={verrouillee
                ? `Phase ${meta.num} — terminez la phase précédente pour y accéder`
                : meta.description}
              aria-current={courante ? 'step' : undefined}
              className={`flex-1 min-w-0 flex items-center gap-2 rounded-xl px-3 py-2 text-left transition-all border ${
                courante
                  ? 'bg-black text-white border-black shadow-sm'
                  : verrouillee
                    ? 'bg-gray-50 text-gray-300 border-gray-100 cursor-not-allowed'
                    : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300 hover:text-gray-900'
              }`}
            >
              <span className={`flex-shrink-0 flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold ${
                statut === DONE
                  ? 'bg-emerald-500 text-white'
                  : statut === ERROR
                    ? 'bg-red-500 text-white'
                    : courante
                      ? 'bg-white/20 text-white'
                      : verrouillee
                        ? 'bg-gray-100 text-gray-300'
                        : 'bg-gray-100 text-gray-500'
              }`}>
                {etatIcone(statut) || meta.num}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-semibold truncate">{meta.label}</span>
                <span className={`block text-[10px] truncate ${courante ? 'text-white/60' : 'text-gray-400'}`}>
                  {statut === DONE ? 'terminée' : statut === RUNNING ? 'en cours…' : statut === ERROR ? 'en échec' : 'à faire'}
                </span>
              </span>
              {verrouillee && <Lock size={11} className="flex-shrink-0 text-gray-300" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
