import { motion, AnimatePresence } from 'framer-motion';
import { Brain, Search, FileCheck, Sparkles, CheckCircle2, Globe, PenLine } from 'lucide-react';
import { detectAgent } from '../../constants/agents';

const STEP_ICONS = {
  'Analyse':       Brain,
  'Connexion':     Globe,
  'WordPress':     Globe,
  'MCP':           Globe,
  'Recherche':     Search,
  'Sources':       Search,
  'Interrogation': Search,
  'résultat':      Search,
  'Génération':    Sparkles,
  'rédaction':     Sparkles,
  'Finalisation':  FileCheck,
  'terminée':      CheckCircle2,
  'default':       Brain,
};

const getIcon = (text) => {
  const key = Object.keys(STEP_ICONS).find(k => text.toLowerCase().includes(k.toLowerCase()));
  return STEP_ICONS[key || 'default'];
};

// Nombre de steps précédentes visibles avant le step actif
const MAX_PREV_VISIBLE = 3;

/**
 * Panneau de rédaction en direct — mode « Audit QAT + Refonte ».
 *
 * Une refonte dure 8 à 9 minutes. Sans retour visible, le rédacteur croit
 * l'application bloquée. Le streaming SSE fournit la fin du texte réellement
 * produit : on l'affiche avec un curseur clignotant, comme une frappe au clavier.
 * Le compteur est celui des caractères RÉELS, pas une estimation.
 */
const LiveTyping = ({ tail, chars }) => (
  <motion.div
    initial={{ opacity: 0, height: 0 }}
    animate={{ opacity: 1, height: 'auto' }}
    exit={{ opacity: 0, height: 0 }}
    className="overflow-hidden"
  >
    <div className="bg-gray-900 rounded-xl px-4 py-3 space-y-2">
      <div className="flex items-center gap-2">
        <PenLine size={12} className="text-emerald-400 shrink-0" />
        <span className="text-[10px] font-semibold text-emerald-400 uppercase tracking-wide">
          Rédaction en cours
        </span>
        <span className="text-[10px] text-gray-500 ml-auto tabular-nums">
          {chars.toLocaleString('fr-FR')} caractères
        </span>
      </div>
      {/* La queue du texte défile : la dernière ligne reste toujours visible */}
      <p className="text-[11px] leading-relaxed text-gray-300 font-mono break-words max-h-24 overflow-hidden flex flex-col justify-end">
        <span>
          {tail}
          <motion.span
            animate={{ opacity: [1, 0, 1] }}
            transition={{ duration: 1, repeat: Infinity }}
            className="inline-block w-1.5 h-3 bg-emerald-400 align-middle ml-0.5"
          />
        </span>
      </p>
    </div>
  </motion.div>
);

export default function AgentThinking({ steps, progress, status, liveTail = '', liveChars = 0 }) {
  const total = steps.length;
  const prevSteps = total > 1 ? steps.slice(0, total - 1) : [];
  const currentStep = total > 0 ? steps[total - 1] : null;

  // Steps précédents à afficher (les plus récents)
  const hiddenCount = Math.max(0, prevSteps.length - MAX_PREV_VISIBLE);
  const visiblePrev = prevSteps.slice(hiddenCount);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="glass-card p-6 space-y-5"
    >
      {/* Header */}
      <div className="flex items-center gap-3">
        <motion.div
          animate={{ rotate: status === 'running' ? 360 : 0 }}
          transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
          className="w-9 h-9 bg-black rounded-xl flex items-center justify-center shrink-0"
        >
          <Brain size={18} className="text-white" />
        </motion.div>
        <div>
          <h3 className="font-semibold text-gray-900 text-sm">Agent IA en cours...</h3>
          <p className="text-xs text-gray-400">Analyse et mise à jour de l'article</p>
        </div>
      </div>

      {/* Progress bar */}
      <div className="space-y-1.5">
        <div className="flex justify-between text-[11px] text-gray-400">
          <span>Progression</span>
          <span>{progress}%</span>
        </div>
        <div className="h-1 bg-gray-100 rounded-full overflow-hidden">
          <motion.div
            className="h-full bg-black rounded-full"
            initial={{ width: '0%' }}
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
          />
        </div>
      </div>

      {/* Steps précédents — compacts */}
      <div className="space-y-1">
        {/* Badge pour les steps cachés */}
        {hiddenCount > 0 && (
          <div className="flex items-center gap-2 text-[11px] text-gray-300 px-1">
            <div className="flex gap-0.5">
              {[0,1,2].map(i => (
                <div key={i} className="w-1 h-1 rounded-full bg-gray-200" />
              ))}
            </div>
            <span>{hiddenCount} étape{hiddenCount > 1 ? 's' : ''} précédente{hiddenCount > 1 ? 's' : ''}</span>
          </div>
        )}

        {/* Steps précédents visibles */}
        {visiblePrev.map((step) => {
          const agent = detectAgent(step.text);
          return (
            <motion.div
              key={step.ts}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.2 }}
              className="flex items-center gap-2 text-[11px] text-gray-400 px-1"
            >
              <div className="w-4 h-4 rounded-full bg-gray-100 flex items-center justify-center shrink-0 text-gray-500">
                <agent.Icon size={10} className="shrink-0" />
              </div>
              <span className="truncate leading-tight">{step.text}</span>
            </motion.div>
          );
        })}
      </div>

      {/* Step actif — prominent */}
      <AnimatePresence mode="wait">
        {currentStep && (() => {
          const agent = detectAgent(currentStep.text);
          return (
            <motion.div
              key={currentStep.ts}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.2 }}
              className="bg-gray-50 border border-gray-100 rounded-xl px-4 py-3 space-y-1.5"
            >
              {/* Badge agent */}
              <div className="flex items-center gap-1.5">
                <agent.Icon size={14} className="shrink-0 text-gray-500" />
                <span className="text-[10px] font-semibold text-gray-500">
                  {agent.name}
                </span>
                <span className="text-[10px] text-gray-300">·</span>
                <span className="text-[10px] text-gray-400 italic">{agent.pseudo}</span>
              </div>

              {/* Texte du step + dot animé */}
              <div className="flex items-center gap-3">
                {status === 'running' ? (
                  <motion.div
                    animate={{ scale: [1, 1.3, 1], opacity: [0.6, 1, 0.6] }}
                    transition={{ duration: 1, repeat: Infinity }}
                    className="w-5 h-5 rounded-full bg-black flex items-center justify-center shrink-0"
                  >
                    <div className="w-2 h-2 rounded-full bg-white" />
                  </motion.div>
                ) : (
                  <div className="w-5 h-5 rounded-full bg-black flex items-center justify-center shrink-0">
                    <CheckCircle2 size={12} className="text-white" />
                  </div>
                )}

                <span className="text-sm font-medium text-gray-900 leading-snug flex-1">
                  {currentStep.text}
                </span>

                {status === 'running' && (
                  <div className="flex gap-1 shrink-0">
                    {[0, 1, 2].map(i => (
                      <motion.div
                        key={i}
                        className="w-1 h-1 bg-gray-400 rounded-full"
                        animate={{ y: [0, -4, 0], opacity: [0.3, 1, 0.3] }}
                        transition={{ duration: 0.7, repeat: Infinity, delay: i * 0.12 }}
                      />
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          );
        })()}
      </AnimatePresence>

      {/* Rédaction en direct (streaming) — sous le step actif */}
      <AnimatePresence>
        {status === 'running' && liveTail && (
          <LiveTyping key="live" tail={liveTail} chars={liveChars} />
        )}
      </AnimatePresence>
    </motion.div>
  );
}
