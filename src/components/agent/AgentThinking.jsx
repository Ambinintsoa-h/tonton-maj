import { motion, AnimatePresence } from 'framer-motion';
import { Brain, Search, FileCheck, Sparkles, CheckCircle2, Globe } from 'lucide-react';
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

export default function AgentThinking({ steps, progress, status }) {
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
              <div className="w-4 h-4 rounded-full bg-gray-100 flex items-center justify-center shrink-0 text-[9px]">
                {agent.emoji}
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
                <span className="text-sm leading-none">{agent.emoji}</span>
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
    </motion.div>
  );
}
