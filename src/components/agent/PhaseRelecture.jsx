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
import { ShieldCheck, AlertTriangle, ChevronDown, ChevronUp, RefreshCw, Check, X } from 'lucide-react';
import { detectStylePatterns } from '../../utils/stylePatterns';
import { proposeMechanicalFix } from '../../utils/styleFixes';

export default function PhaseRelecture({ html = '', onRefresh, onAccept, onLocate }) {
  const [ouvert, setOuvert] = useState(null);
  // Occurrences écartées par le rédacteur — locales à la session : « Ignorer »
  // n'écrit rien dans l'article, il retire simplement la ligne de la liste.
  const [ignores, setIgnores] = useState([]);
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
                      <ul className="space-y-2">
                        {f.exemples.map((ex, i) => {
                          const cle = `${f.id}-${i}`;
                          if (ignores.includes(cle)) return null;
                          // Correction MÉCANIQUE quand elle est sûre (tirets, adverbes).
                          // `null` pour tout ce qui demande de comprendre la phrase :
                          // la proposition viendra alors de l'IA.
                          const prop = proposeMechanicalFix(f.id, ex.extrait, ex.terme);
                          return (
                            <li key={i} className="text-[11px] leading-relaxed border-l-2 border-amber-200 pl-2 space-y-1">
                              <button
                                type="button"
                                onClick={() => onLocate?.(ex.extrait)}
                                title="Situer ce passage dans l'article"
                                className="text-left text-gray-700 hover:text-amber-800 transition-colors"
                              >
                                {ex.terme && <strong className="text-amber-800">« {ex.terme} » — </strong>}
                                {ex.mots && <span className="text-gray-400">({ex.mots} mots) </span>}
                                {ex.extrait}
                              </button>
                              {prop ? (
                                <div className="rounded-lg bg-emerald-50/70 border border-emerald-200 px-2 py-1.5 space-y-1">
                                  <p className="text-[10px] text-emerald-900">
                                    <span className="uppercase tracking-wide font-bold text-emerald-700 text-[9px]">Proposition </span>
                                    {prop.apres}
                                  </p>
                                  <div className="flex items-center gap-1">
                                    <button
                                      type="button"
                                      onClick={() => onAccept?.(prop)}
                                      className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-600 text-white text-[10px] font-semibold hover:bg-emerald-700 transition-colors"
                                    >
                                      <Check size={10} /> Accepter
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setIgnores((l) => [...l, cle])}
                                      className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-white text-gray-500 border border-gray-200 text-[10px] font-semibold hover:text-gray-800 transition-colors"
                                    >
                                      <X size={10} /> Ignorer
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                // On le DIT plutôt que de laisser une ligne muette :
                                // le rédacteur doit savoir pourquoi il n'a pas de bouton.
                                <p className="text-[10px] text-gray-400 italic">
                                  Correction à écrire à la main : elle dépend du sens de la phrase.
                                </p>
                              )}
                            </li>
                          );
                        })}
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
