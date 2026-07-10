// ── Profondeur de MAJ ─────────────────────────────────────────────────────────
// Choisie par l'utilisateur au lancement d'une analyse (page Articles ou file
// MAJ en attente). Traduite en consignes plus ou moins agressives dans les
// prompts (services/agent.js). « standard » = comportement historique du
// pipeline — aucun bloc supplémentaire n'est injecté dans les prompts.

export const DEFAULT_DEPTH = 'standard';

export const MAJ_DEPTHS = {
  legere: {
    label: 'Légère',
    hint: '~30 %',
    description: 'Rafraîchissement : corrige uniquement les données fausses ou obsolètes (prix, chiffres, dates). Aucune nouvelle section, aucune restructuration.',
  },
  standard: {
    label: 'Standard',
    hint: '~60 %',
    description: 'Corrections + enrichissements (TL;DR, FAQ, H2 manquants, tableaux) — le comportement habituel.',
  },
  refonte: {
    label: 'Refonte',
    hint: '100 %',
    description: 'Réécriture en profondeur section par section : remaniement des H2, condensation du superflu, refonte du contenu faible.',
  },
};

export const depthMeta = (d) => MAJ_DEPTHS[d] || MAJ_DEPTHS[DEFAULT_DEPTH];
