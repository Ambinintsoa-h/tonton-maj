/**
 * PhaseObsolescence — panneau de la PHASE 3, en DEUX ÉCRANS.
 *
 * À gauche l'article issu de la phase 2, à droite les suggestions de la
 * vérification, chacune prête à être copiée. Rien n'est appliqué
 * automatiquement : le rédacteur copie ce qu'il retient, exactement le geste
 * demandé (« le texte à modifier en haut, la suggestion en bas, avec un système
 * de copier/coller »).
 *
 * Le moteur est celui de l'ancienne « passe 2 » (runReviewAgent), réorienté sur
 * l'obsolescence par le prompt du rédacteur — code déjà éprouvé plutôt qu'une
 * mécanique de fusion réécrite.
 */
import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  Clock, Loader2, Copy, Check, FileText, RotateCcw, Save, ArrowRight, AlertTriangle,
} from 'lucide-react';

export default function PhaseObsolescence({
  articleHtml = '',
  suggestions = [],
  running = false,
  step = '',
  progress = 0,
  aTourne = false,
  prompt = '',
  onPromptChange,
  onResetPrompt,
  onSaveTemplate,
  savingTemplate = false,
  onRun,
}) {
  // { cle, ok } — `ok:false` = la copie a ÉCHOUÉ. L'ancienne version remettait
  // simplement l'état à null dans le catch : le rédacteur cliquait, rien ne se
  // passait, et il ne savait pas que le presse-papiers avait refusé. Constaté en
  // test : `clipboard.writeText` peut lever (permission, contexte non sécurisé).
  const [etatCopie, setEtatCopie] = useState(null);

  const copier = async (texte, cle) => {
    let ok = true;
    try {
      await navigator.clipboard.writeText(texte);
    } catch {
      ok = false;
    }
    setEtatCopie({ cle, ok });
    setTimeout(() => setEtatCopie((e) => (e && e.cle === cle ? null : e)), 2600);
  };

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">

      {/* Directives de vérification */}
      <div className="glass-card p-5 space-y-3">
        <h3 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
          <Clock size={14} className="text-sage-500" />
          Vérification des informations
        </h3>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <label className="flex items-center gap-1.5 text-xs font-medium text-gray-600">
              <FileText size={12} className="text-gray-400" />
              Ce que TONTON doit vérifier
            </label>
            <div className="flex items-center gap-1">
              <button type="button" disabled={running} onClick={() => onResetPrompt?.()}
                title="Repartir de mon modèle de vérification"
                className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium text-gray-500 hover:text-gray-800 hover:bg-black/5 transition-colors disabled:opacity-40">
                <RotateCcw size={11} /> Reconstruire
              </button>
              <button type="button" disabled={running || savingTemplate || !prompt.trim()} onClick={() => onSaveTemplate?.()}
                title="Garder ces directives comme mon modèle de vérification"
                className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium text-gray-500 hover:text-gray-800 hover:bg-black/5 transition-colors disabled:opacity-40">
                {savingTemplate ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />}
                Enregistrer comme mon modèle
              </button>
            </div>
          </div>
          <textarea
            value={prompt}
            onChange={(e) => onPromptChange?.(e.target.value)}
            disabled={running}
            rows={6}
            spellCheck={false}
            className="input-glass text-[12px] leading-relaxed font-mono resize-y w-full disabled:opacity-60"
            placeholder="Directives de vérification…"
          />
        </div>

        {!running ? (
          <button type="button" onClick={() => onRun?.()}
            className="flex items-center gap-2 px-4 py-2.5 bg-black text-white rounded-xl text-sm font-semibold hover:bg-gray-800 transition-colors shadow-sm">
            <Clock size={14} />
            {aTourne ? 'Relancer la vérification' : 'Vérifier les informations'}
            <ArrowRight size={14} />
          </button>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs text-gray-600">
              <Loader2 size={13} className="animate-spin text-sage-500" />
              <span className="truncate">{step || 'Vérification en cours…'}</span>
            </div>
            <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full bg-sage-500 transition-all duration-500" style={{ width: `${Math.min(100, Math.max(0, progress))}%` }} />
            </div>
          </div>
        )}
      </div>

      {/* Deux écrans : article à gauche, suggestions à droite */}
      {aTourne && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

          <div className="glass-card p-4 space-y-2 min-w-0">
            <h4 className="text-xs font-semibold text-gray-700 flex items-center gap-1.5">
              <FileText size={12} className="text-gray-400" />
              Article issu de la phase 2
            </h4>
            <div className="md-content text-[12px] leading-relaxed max-h-[70vh] overflow-y-auto pr-1 border-t border-gray-100 pt-2"
                 dangerouslySetInnerHTML={{ __html: articleHtml }} />
          </div>

          <div className="glass-card p-4 space-y-2 min-w-0">
            <h4 className="text-xs font-semibold text-gray-700 flex items-center gap-1.5">
              <Clock size={12} className="text-sage-500" />
              Suggestions ({suggestions.length}) — prêtes à copier
            </h4>

            {suggestions.length === 0 ? (
              <p className="text-[11px] text-emerald-700 bg-emerald-50/70 border border-emerald-200 rounded-xl px-3 py-2.5 flex items-center gap-1.5">
                <Check size={12} />
                Aucune information obsolète détectée sur cet article.
              </p>
            ) : (
              <div className="space-y-2.5 max-h-[70vh] overflow-y-auto pr-1">
                {suggestions.map((s, i) => {
                  const cle = `s${i}`;
                  const nouveau = s.updated || '';
                  return (
                    <div key={i} className="rounded-xl border border-gray-200 overflow-hidden">
                      {/* Le texte à modifier — en haut */}
                      {s.original && (
                        <div className="px-3 py-2 bg-red-50/50 border-b border-gray-100">
                          <p className="text-[9px] uppercase tracking-wide text-gray-400 font-bold mb-0.5">À remplacer</p>
                          <p className="text-[11px] text-gray-500 line-through leading-relaxed break-words">{s.original}</p>
                        </div>
                      )}
                      {/* La suggestion — en bas, avec le bouton copier */}
                      <div className="px-3 py-2 bg-emerald-50/40">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-[9px] uppercase tracking-wide text-gray-400 font-bold mb-0.5">Suggestion</p>
                          <button
                            type="button"
                            onClick={() => copier(nouveau, cle)}
                            disabled={!nouveau}
                            title="Copier la suggestion dans le presse-papiers"
                            className={`flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold transition-colors flex-shrink-0 disabled:opacity-40 ${
                              etatCopie?.cle === cle
                                ? (etatCopie.ok ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-800')
                                : 'bg-white text-gray-500 hover:text-gray-800 border border-gray-200'
                            }`}
                          >
                            {etatCopie?.cle === cle
                              ? (etatCopie.ok
                                  ? <><Check size={10} /> Copié</>
                                  // Échec annoncé, avec la marche à suivre : sans ça le
                                  // rédacteur croit avoir copié et collera du vide.
                                  : <><AlertTriangle size={10} /> Refusé — sélectionnez le texte</>)
                              : <><Copy size={10} /> Copier</>}
                          </button>
                        </div>
                        <div className="md-content text-[12px] text-gray-800 leading-relaxed break-words [&_p]:!my-0.5"
                             dangerouslySetInnerHTML={{ __html: nouveau }} />
                        {s.reason && (
                          <p className="text-[10px] text-gray-400 italic mt-1 flex items-start gap-1">
                            <AlertTriangle size={9} className="mt-0.5 flex-shrink-0" />
                            {s.reason}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </motion.div>
  );
}
