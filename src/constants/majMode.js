// Verrou de domaine du maillage interne (règle 8) — voir cleanLinkRows plus bas.
import { filterSameSiteLinks } from '../utils/diff';

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
// Plafond relevé à 5 000 : sur les MAJ réellement publiées par l'équipe, un
// article de prix est monté à 4 500 mots — le curseur ne doit pas brider un
// sujet dense (au-delà de 3 000 mots, le taux de citation par les IA double).
export const TARGET_WORDS_MAX = 5000;

// Maillage interne : le rédacteur fournit des paires ancre + URL. Les articles
// publiés en portent 8 à 15 ; on part sur 3 lignes vides et on laisse ajouter.
export const INTERNAL_LINK_ROWS_INITIAL = 3;
export const INTERNAL_LINK_ROWS_MAX = 15;

/** Ligne de maillage vide — { anchor, url } */
export const emptyLinkRow = () => ({ anchor: '', url: '' });

/**
 * Ne garde que les paires complètes et dédoublonne par URL.
 *
 * `articleUrl` (OPTIONNEL) — PRÉREQUIS DE LA RÈGLE 8. Le maillage est saisi à la
 * main : rien n'empêchait d'y coller une URL d'un AUTRE site. Tant que ces
 * paires ne servaient qu'à instruire le prompt, l'erreur restait rattrapée en
 * aval par le verrou liens externes. Depuis R2, le code PLACE lui-même ces liens
 * dans l'article : une URL hors domaine deviendrait un LIEN EXTERNE AJOUTÉ, soit
 * une violation directe de la règle 8 par la porte du maillage. `articleUrl`
 * branche donc `filterSameSiteLinks` (src/utils/diff.js), écrite exactement pour
 * ça et jamais exécutée jusqu'ici (son seul appelant, `runAgent`, est du code
 * mort).
 *
 * Sans `articleUrl`, on ne filtre RIEN : `filterSameSiteLinks` jetterait alors
 * TOUTE URL absolue (protection maximale faute d'hôte de référence), ce qui
 * viderait le maillage des appelants qui ne connaissent pas l'URL de l'article
 * — un changement de comportement de l'existant (règle 7). Le placement
 * physique, lui, refiltre TOUJOURS de son côté (voir src/utils/internalWeave.js).
 */
export const cleanLinkRows = (rows = [], articleUrl = '') => {
  const seen = new Set();
  const clean = (rows || [])
    .map((r) => ({ anchor: String(r?.anchor || '').trim(), url: String(r?.url || '').trim() }))
    .filter((r) => {
      if (!r.anchor || !r.url) return false;
      const k = r.url.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, INTERNAL_LINK_ROWS_MAX);
  return articleUrl ? filterSameSiteLinks(clean, articleUrl) : clean;
};

/**
 * Lignes de maillage ÉCARTÉES parce qu'elles pointent hors du domaine de
 * l'article. Sert à le DIRE au rédacteur : sans ce retour, une URL mal collée
 * disparaîtrait en silence et il croirait son lien placé.
 */
export const offDomainLinkRows = (rows = [], articleUrl = '') => {
  if (!articleUrl) return [];
  const all = cleanLinkRows(rows);
  const kept = new Set(filterSameSiteLinks(all, articleUrl).map((r) => r.url));
  return all.filter((r) => !kept.has(r.url));
};
