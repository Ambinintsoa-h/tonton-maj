import { motion } from 'framer-motion';
import { Brain, Search, FileCheck, Sparkles, CheckCircle2, Globe } from 'lucide-react';

const STEP_ICONS = {
  'Analyse':      Brain,
  'Connexion':    Globe,
  'WordPress':    Globe,
  'MCP':          Globe,
  'Recherche':    Search,
  'Sources':      Search,
  'Interrogation':Search,
  'résultat':     Search,
  'Génération':   Sparkles,
  'rédaction':    Sparkles,
  'Finalisation': FileCheck,
  'terminée':     CheckCircle2,
  'default':      Brain,
};

const getIcon = (text) => {
  const key = Object.keys(STEP_ICONS).find(k => text.toLowerCase().includes(k.toLowerCase()));
  return STEP_ICONS[key || 'default'];
};

export default function AgentThinking({ steps, progress, status }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="glass-card p-8 space-y-6"
    >
      {/* Header */}
      <div className="flex items-center gap-3">
        <motion.div
          animate={{ rotate: status === 'running' ? 360 : 0 }}
          transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
          className="w-10 h-10 bg-black rounded-xl flex items-center justify-center"
        >
          <Brain size={20} className="text-white" />
        </motion.div>
        <div>
          <h3 className="font-semibold text-gray-900">Agent IA en cours...</h3>
          <p className="text-sm text-gray-500">Analyse et mise à jour de l'article</p>
        </div>
      </div>

      {/* Progress bar */}
      <div className="space-y-2">
        <div className="flex justify-between text-xs text-gray-400">
          <span>Progression</span>
          <span>{progress}%</span>
        </div>
        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
          <motion.div
            className="h-full bg-black rounded-full"
            initial={{ width: '0%' }}
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
          />
        </div>
      </div>

      {/* Toutes les étapes — aucun scroll, tout visible */}
      <div className="space-y-2">
        {steps.map((step, i) => {
          const Icon = getIcon(step.text);
          const isLast = i === steps.length - 1;
          return (
            <motion.div
              key={i}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.25 }}
              className={`flex items-start gap-3 text-sm ${isLast ? 'text-gray-900' : 'text-gray-400'}`}
            >
              {/* Icône / dot animé */}
              <div className="flex-shrink-0 mt-0.5">
                {isLast && status === 'running' ? (
                  <motion.div
                    animate={{ scale: [1, 1.25, 1], opacity: [0.7, 1, 0.7] }}
                    transition={{ duration: 1, repeat: Infinity }}
                    className="w-5 h-5 rounded-full bg-black flex items-center justify-center"
                  >
                    <div className="w-2 h-2 rounded-full bg-white" />
                  </motion.div>
                ) : (
                  <div className={`w-5 h-5 rounded-full flex items-center justify-center ${isLast ? 'bg-black' : 'bg-gray-200'}`}>
                    <Icon size={11} className={isLast ? 'text-white' : 'text-gray-400'} />
                  </div>
                )}
              </div>
              <span className={`leading-snug ${isLast ? 'font-medium' : ''}`}>{step.text}</span>
            </motion.div>
          );
        })}
      </div>

      {/* Dots d'attente */}
      {status === 'running' && (
        <div className="flex gap-1.5 justify-center">
          {[0, 1, 2].map(i => (
            <motion.div
              key={i}
              className="w-1.5 h-1.5 bg-gray-400 rounded-full"
              animate={{ y: [0, -6, 0], opacity: [0.4, 1, 0.4] }}
              transition={{ duration: 0.8, repeat: Infinity, delay: i * 0.15 }}
            />
          ))}
        </div>
      )}
    </motion.div>
  );
}
