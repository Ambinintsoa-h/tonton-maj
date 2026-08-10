/**
 * PhaseRelecture — panneau de la PHASE 4.
 *
 * Retrait des patterns d'écriture IA, puis finitions humaines. Rien n'est
 * corrigé automatiquement : chaque anomalie est montrée AVEC son extrait, et
 * c'est le rédacteur qui tranche. Une correction automatique sur du style
 * produirait des phrases fausses sans que personne ne s'en aperçoive.
 *
 * Le décompte est recalculé sur le texte courant de l'éditeur à chaque
 * ouverture : il reflète donc les corrections au fur et à mesure, ce qui est
 * précisément ce qui rassure en fin de parcours.
 */
import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { ShieldCheck, AlertTriangle, ChevronDown, ChevronUp, RefreshCw, Check } from 'lucide-react';
import { detectStylePatterns } from '../../utils/stylePatterns';

export default function PhaseRelecture({ html = '', onRefresh }) {
  const [ouvert, setOuvert] = useState(null);
  const rapport = useMemo(() => detectStylePatterns(html), [html]);
  const propre = rapport.findings.length === 0;

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="glass-card p-5 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
          <ShieldCheck size={14} className={propre ? 'text-emerald-500' : 'text-amber-500'} />
          Patterns d'écriture IA
        </h3>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-gray-400">{rapport.phrases} phrases analysées</span>
          {onRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              title="Recalculer sur le texte actuel de l'éditeur"
              className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium text-gray-500 hover:text-gray-800 hover:bg-black/5 transition-colors"
            >
              <RefreshCw size={11} /> Recalculer
            </button>
          )}
        </div>
      </div>

      {propre ? (
        <p className="text-xs text-emerald-700 bg-emerald-50/70 border border-emerald-200 rounded-xl px-3 py-2.5 flex items-center gap-1.5">
          <Check size={13} />
          Aucun pattern détecté sur les {rapport.phrases} phrases analysées — l'article est prêt pour les finitions.
        </p>
      ) : (
        <>
          <p className="text-[11px] text-gray-500">
            <strong className="text-amber-700">{rapport.total}</strong> point(s) à relire, répartis sur{' '}
            {rapport.findings.length} règle(s). Rien n'est corrigé automatiquement : à vous de juger sur l'extrait.
          </p>
          <div className="space-y-1.5">
            {rapport.findings.map((f) => {
              const deplie = ouvert === f.id;
              return (
                <div key={f.id} className="rounded-xl border border-gray-200 overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setOuvert(deplie ? null : f.id)}
                    className="w-full flex items-center gap-2.5 px-3 py-2 bg-gray-50/80 hover:bg-gray-100 transition-colors text-left"
                  >
                    <AlertTriangle size={12} className="text-amber-500 flex-shrink-0" />
                    <span className="text-xs font-semibold text-gray-800 flex-1 min-w-0 truncate">{f.label}</span>
                    <span className="text-[10px] font-bold text-amber-700 bg-amber-100 rounded-full px-2 py-0.5 flex-shrink-0">
                      {f.count}
                    </span>
                    {deplie ? <ChevronUp size={13} className="text-gray-400 flex-shrink-0" />
                            : <ChevronDown size={13} className="text-gray-400 flex-shrink-0" />}
                  </button>
                  {deplie && (
                    <div className="px-3 py-2.5 space-y-2 bg-white">
                      <p className="text-[11px] text-gray-500 italic">{f.hint}</p>
                      <ul className="space-y-1.5">
                        {f.exemples.map((ex, i) => (
                          <li key={i} className="text-[11px] text-gray-700 leading-relaxed border-l-2 border-amber-200 pl-2">
                            {ex.terme && <strong className="text-amber-800">« {ex.terme} » — </strong>}
                            {ex.mots && <span className="text-gray-400">({ex.mots} mots) </span>}
                            {ex.extrait}
                          </li>
                        ))}
                      </ul>
                      {f.count > f.exemples.length && (
                        <p className="text-[10px] text-gray-400">
                          {f.count - f.exemples.length} autre(s) occurrence(s) non listée(s) ici.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </motion.div>
  );
}
