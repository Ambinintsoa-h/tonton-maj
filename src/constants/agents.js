// ── Définition des agents IA du SaaS ─────────────────────────────────────────
// Source unique de vérité : importé dans Equipe, AgentThinking, MajEnAttente…

import { Brain, Search, Globe, PenLine } from 'lucide-react';

export const IA_AGENTS = [
  {
    id:        'tonton',
    Icon:      Brain,
    name:      'TONTON AI',
    pseudo:    'Le manager des agents IA',
    avatarCls: 'bg-black text-white',
    badgeCls:  'bg-gray-900 text-white border border-gray-900',
    roleLabel: 'Agent principal',
    status:    'active',
    desc:      'Orchestre tous les agents, lit l\'article, génère les mises à jour et rédige la synthèse finale. Travaille en deux passes pour ne rien rater.',
    skills:    ['Analyse d\'article', 'Génération de MAJ', 'Revue qualité (passe 2)', 'Rédaction synthèse'],
  },
  {
    id:        'sherlock',
    Icon:      Search,
    name:      'SHERLOCK',
    pseudo:    'Le chasseur de sources',
    avatarCls: 'bg-blue-600 text-white',
    badgeCls:  'bg-blue-50 text-blue-700 border border-blue-200',
    roleLabel: 'Agent recherche',
    status:    'active',
    desc:      'Parcourt le web en cascade (Brave → Tavily → SearXNG → Jina) pour trouver les sources les plus fraîches et pertinentes. Ne lâche jamais une piste.',
    skills:    ['Recherche multi-sources', 'Déduplication URLs', 'Scoring de pertinence', 'Fallback automatique'],
  },
  {
    id:        'scrappy',
    Icon:      Globe,
    name:      'SCRAPPY',
    pseudo:    'Le gratteur de pages',
    avatarCls: 'bg-emerald-600 text-white',
    badgeCls:  'bg-emerald-50 text-emerald-700 border border-emerald-200',
    roleLabel: 'Agent scraping',
    status:    'active',
    desc:      'S\'infiltre dans les pages web et en extrait le contenu propre grâce à Readability. Repasse par Jina si le site résiste. Ne recule devant aucun CMS.',
    skills:    ['Scraping Readability', 'Fallback Jina AI', 'Extraction HTML→texte', 'Gestion anti-bot'],
  },
  {
    id:        'raoul',
    Icon:      PenLine,
    name:      'RAOUL',
    pseudo:    'Le correcteur',
    avatarCls: 'bg-purple-600 text-white',
    badgeCls:  'bg-purple-50 text-purple-700 border border-purple-200',
    roleLabel: 'Agent revue',
    status:    'active',
    desc:      'Reprend le travail de TONTON AI après la passe 1 et traque les incohérences, les chiffres périmés et les tournures trop « IA ». Qualité garantie.',
    skills:    ['Revue passe 2', 'Détection patterns IA', 'Vérification chiffres', 'Reformulation naturelle'],
  },
];

// Accès rapide par id
export const IA_AGENTS_MAP = Object.fromEntries(IA_AGENTS.map(a => [a.id, a]));

// ── Détection de l'agent actif à partir du texte d'un step ───────────────────
// Ordre important : RAOUL en premier (ses steps contiennent aussi "source" parfois)
export const detectAgent = (text) => {
  if (!text) return IA_AGENTS_MAP.tonton;
  const t = text.toLowerCase();

  if (/deuxi[eè]me passe|passe terminée|enrichissement.*skill|vérification de cohérence/.test(t))
    return IA_AGENTS_MAP.raoul;

  if (/requête|interrogation|résultat.*(trouvé|complémentaire)|lancement des recherches|recherches en cours/.test(t))
    return IA_AGENTS_MAP.sherlock;

  if (/lecture de.*source|source.*analysée|sélection des meilleures/.test(t))
    return IA_AGENTS_MAP.scrappy;

  return IA_AGENTS_MAP.tonton;
};
