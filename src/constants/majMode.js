// ── Mode de MAJ ───────────────────────────────────────────────────────────────
// DOUBLE FLUX TEMPORAIRE (décision équipe, août 2026) : le flux historique reste
// intact et sélectionnable pendant que le nouveau flux « Audit QAT + Refonte »
// est validé par l'équipe sur de vrais articles. Aucun comportement existant ne
// change tant que l'utilisateur ne choisit pas explicitement le mode « qat ».
//
// - classique : audit markdown + updates[] appliqués un par un (applyAllDiffs),
//               diff validable modif par modif. Comportement historique.
// - qat       : audit JSON strict (framework QAT) + réécriture de l'article
//               ENTIER d'un bloc, sécurisée par sanitizeFullArticle (diff.js).
//
// Le mode « qat » exige un skill cerveau (SKILL.md) actif portant la méthode.

export const DEFAULT_MODE = 'classique';

export const MAJ_MODES = {
  classique: {
    label: 'MAJ classique',
    hint: 'modif par modif',
    description: 'Audit markdown puis modifications ciblées, validées une par une dans le diff. Comportement historique.',
  },
  qat: {
    label: 'Audit QAT + Refonte',
    hint: 'article entier',
    description: 'Audit JSON (Quality / Accuracy / Transparency) puis réécriture complète de l\'article. La vue Après montre le nouvel article entier.',
  },
};

export const modeMeta = (m) => MAJ_MODES[m] || MAJ_MODES[DEFAULT_MODE];
export const isQatMode = (m) => m === 'qat';

// ── Champs de saisie propres au mode QAT ──────────────────────────────────────
// Le type d'article change les règles de placement du mot-clé et les seuils
// Yoast ; le plugin SEO change la terminologie attendue dans la checklist.

export const ARTICLE_TYPES = {
  dossier: {
    label: 'Dossier',
    description: 'Mot-clé dans 50 à 75 % des sous-titres. Les deux voyants Yoast doivent être au vert.',
  },
  actus: {
    label: 'Actus',
    description: 'Mot-clé dans au moins un sous-titre. Yoast SEO minimum orange, lisibilité au vert.',
  },
};

export const DEFAULT_ARTICLE_TYPE = 'dossier';

export const SEO_PLUGINS = {
  yoast:    { label: 'Yoast SEO' },
  seopress: { label: 'SEOPress' },
  aucun:    { label: 'Aucun / autre' },
};

export const DEFAULT_SEO_PLUGIN = 'yoast';

// Longueur cible par défaut — alignée sur ce que l'équipe publie réellement
// (médiane relevée sur 10 MAJ : ~2 500 mots, 7 à 9 H2), et non sur les 1 500
// mots du prompt d'origine qui produisaient des articles 40 % trop courts.
export const DEFAULT_TARGET_WORDS = 2500;
export const TARGET_WORDS_MIN = 800;
export const TARGET_WORDS_MAX = 4000;

// Maillage interne : le rédacteur fournit des paires ancre + URL. Les articles
// publiés en portent 8 à 15 ; on part sur 3 lignes vides et on laisse ajouter.
export const INTERNAL_LINK_ROWS_INITIAL = 3;
export const INTERNAL_LINK_ROWS_MAX = 15;

/** Ligne de maillage vide — { anchor, url } */
export const emptyLinkRow = () => ({ anchor: '', url: '' });

/** Ne garde que les paires complètes et dédoublonne par URL. */
export const cleanLinkRows = (rows = []) => {
  const seen = new Set();
  return (rows || [])
    .map((r) => ({ anchor: String(r?.anchor || '').trim(), url: String(r?.url || '').trim() }))
    .filter((r) => {
      if (!r.anchor || !r.url) return false;
      const k = r.url.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, INTERNAL_LINK_ROWS_MAX);
};
