import { motion } from 'framer-motion';
import {
  MessageSquare, Construction, Filter, MessageCircle, Sparkles, Bot, ShieldCheck,
} from 'lucide-react';

// Périmètre prévu du module Commentaires (indépendant du pipeline MAJ).
// Page placeholder « en cours de dev » — rien n'est encore actif.
const ROADMAP = [
  {
    icon: Filter,
    accent: 'violet',
    tag: 'Phase 1',
    title: 'Gestion & modération',
    desc: "Centralise les commentaires de tous les sites WordPress. Tri IA automatique (spam, toxique, question, éloge, hors-sujet) et actions en 1 clic : approuver, spam, corbeille. Dashboard volume / sentiment / temps de réponse.",
  },
  {
    icon: MessageCircle,
    accent: 'emerald',
    tag: 'Phase 2',
    title: 'Réponses de marque',
    desc: "L'IA rédige une réponse aux vrais commentaires, dans le ton du site. Validation humaine obligatoire avant publication (même principe que les 2 choix de publication des MAJ).",
  },
  {
    icon: Bot,
    accent: 'amber',
    tag: 'Phase 3',
    title: 'Génération de commentaires',
    desc: "Création de nouveaux commentaires from scratch pour amorcer la discussion. Sous contrôle humain, avec garde-fous à cadrer.",
  },
];

const ACCENT = {
  violet:  { bg: 'bg-violet-50',  text: 'text-violet-700',  icon: 'text-violet-600'  },
  emerald: { bg: 'bg-emerald-50', text: 'text-emerald-700', icon: 'text-emerald-600' },
  amber:   { bg: 'bg-amber-50',   text: 'text-amber-700',   icon: 'text-amber-600'   },
};

export default function Commentaires() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="max-w-4xl mx-auto"
    >
      {/* En-tête */}
      <div className="flex items-center gap-3 mb-1">
        <div className="w-11 h-11 rounded-xl bg-violet-100 flex items-center justify-center flex-shrink-0">
          <MessageSquare size={22} className="text-violet-600" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-bold text-gray-900 tracking-tight">Commentaires</h1>
            <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide bg-violet-500 text-white rounded-full px-2 py-0.5">
              <Construction size={11} /> en cours de dev
            </span>
          </div>
          <p className="text-sm text-gray-500 mt-0.5">
            Centraliser et gérer les commentaires de tous vos sites WordPress avec l'IA.
          </p>
        </div>
      </div>

      {/* Bandeau dev */}
      <div className="glass-card p-5 mt-5 flex items-start gap-3 border-l-4 border-violet-300">
        <Sparkles size={18} className="text-violet-500 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-gray-800">Module en construction</p>
          <p className="text-[13px] text-gray-500 leading-relaxed mt-0.5">
            Fonctionnalité indépendante des MAJ d'articles. Voici le périmètre prévu — rien n'est encore actif.
          </p>
        </div>
      </div>

      {/* Roadmap */}
      <div className="grid gap-3 mt-5">
        {ROADMAP.map((f) => {
          const a = ACCENT[f.accent];
          const Icon = f.icon;
          return (
            <div key={f.tag} className="glass-card p-5 flex items-start gap-4">
              <div className={`w-10 h-10 rounded-lg ${a.bg} flex items-center justify-center flex-shrink-0`}>
                <Icon size={18} className={a.icon} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <h3 className="text-[15px] font-semibold text-gray-900">{f.title}</h3>
                  <span className={`text-[10px] font-bold uppercase tracking-wide ${a.bg} ${a.text} rounded-full px-2 py-0.5`}>
                    {f.tag}
                  </span>
                </div>
                <p className="text-[13px] text-gray-600 leading-relaxed">{f.desc}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Note d'accès */}
      <p className="text-[11px] text-gray-400 mt-6 flex items-center gap-1.5">
        <ShieldCheck size={13} /> Visible par Manager, Super Admin et Support pendant le développement.
      </p>
    </motion.div>
  );
}
