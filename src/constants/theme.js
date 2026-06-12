// ── Constantes visuelles partagées entre Dashboard, MajEnAttente, Historique ──

export const ROLE_COLORS = {
  cq_ia:       'bg-blue-100 text-blue-700',
  manager:     'bg-purple-100 text-purple-700',
  super_admin: 'bg-gray-900 text-white',
};

export const PRIORITY_META = {
  haute:   {
    label:   'Haute',
    dot:     'bg-red-500',
    border:  'border-l-red-500',
    badge:   'bg-red-100 text-red-700 border-red-300',
    section: 'text-red-600 bg-red-50 border-red-200',
  },
  normale: {
    label:   'Normale',
    dot:     'bg-amber-400',
    border:  'border-l-amber-400',
    badge:   'bg-amber-50 text-amber-700 border-amber-200',
    section: 'text-amber-700 bg-amber-50 border-amber-200',
  },
  basse:   {
    label:   'Basse',
    dot:     'bg-gray-400',
    border:  'border-l-gray-300',
    badge:   'bg-gray-100 text-gray-500 border-gray-200',
    section: 'text-gray-500 bg-gray-50 border-gray-200',
  },
};

export const DOMAIN_COLORS = [
  'bg-blue-500', 'bg-violet-500', 'bg-emerald-500', 'bg-amber-500',
  'bg-rose-500',  'bg-teal-500',   'bg-indigo-500',  'bg-pink-500',
];

export const domainColor = (domain) => {
  let h = 0;
  for (const c of (domain || '')) h = (h * 31 + c.charCodeAt(0)) % DOMAIN_COLORS.length;
  return DOMAIN_COLORS[h];
};
