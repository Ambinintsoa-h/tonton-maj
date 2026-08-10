/**
 * majPhases.js — le parcours de MAJ en QUATRE phases distinctes.
 *
 * Remplace le double flux « classique | qat » (constants/majMode.js), qui était
 * explicitement temporaire. Il n'y a plus qu'un seul parcours :
 *
 *   0. VERROU LIENS (pré-requis, pas une phase) — inventaire des liens de
 *      l'article d'origine AVANT l'audit. Règle en dur : aucun lien externe
 *      ajouté ni supprimé ; les liens internes existants sont toujours remis ;
 *      des liens internes supplémentaires sont proposés depuis l'index du site.
 *   1. AUDIT — audit QAT (le skill n'est pas modifié). Rapport enregistré.
 *   2. GÉNÉRATION — le rédacteur fusionne sa vision avec l'audit dans un prompt
 *      que Tonton pré-remplit et qu'il peut éditer, puis choisit MAJ simple ou
 *      Refonte. La MAJ produite est enregistrée.
 *   3. OBSOLESCENCE — vérification des informations du NOUVEAU texte, suivant le
 *      prompt du rédacteur. Deux écrans : article à gauche, suggestions à droite.
 *   4. RELECTURE — retrait des patterns d'écriture IA puis finitions humaines.
 *
 * Navigation : revenir en arrière est toujours permis ; sauter une phase en avant
 * ne l'est pas, sinon les artefacts enregistrés ne correspondent plus entre eux
 * (une vérification d'obsolescence n'a pas de sens sans texte généré).
 */

export const PHASE_AUDIT        = 'audit';
export const PHASE_GENERATION   = 'generation';
export const PHASE_OBSOLESCENCE = 'obsolescence';
export const PHASE_RELECTURE    = 'relecture';

/** Ordre du parcours — l'index dans ce tableau EST le numéro de phase (1-based). */
export const PHASE_ORDER = [PHASE_AUDIT, PHASE_GENERATION, PHASE_OBSOLESCENCE, PHASE_RELECTURE];

export const PHASES = {
  [PHASE_AUDIT]: {
    num: 1,
    label: 'Audit',
    title: 'Audit QAT de l\'article',
    description: 'Analyse Quality / Accuracy / Transparency de l\'article en ligne. Le rapport est enregistré et reste consultable.',
    action: 'Lancer l\'audit',
  },
  [PHASE_GENERATION]: {
    num: 2,
    label: 'Génération',
    title: 'Génération de la mise à jour',
    description: 'Votre vision + l\'audit dans un même prompt, que vous ajustez. Puis MAJ simple ou refonte complète.',
    action: 'Générer la MAJ',
  },
  [PHASE_OBSOLESCENCE]: {
    num: 3,
    label: 'Obsolescence',
    title: 'Vérification des informations',
    description: 'Contrôle du texte qui vient d\'être produit : chiffres, dates, normes, tarifs. Suggestions prêtes à coller.',
    action: 'Vérifier les informations',
  },
  [PHASE_RELECTURE]: {
    num: 4,
    label: 'Relecture',
    title: 'Relecture et finitions',
    description: 'Retrait des patterns d\'écriture IA, dernières retouches humaines, puis publication.',
    action: 'Terminer',
  },
};

/** Statuts possibles d'une phase. */
export const TODO    = 'todo';
export const RUNNING = 'running';
export const DONE    = 'done';
export const ERROR   = 'error';

/** État initial : tout à faire. */
export const initialPhaseStatus = () =>
  PHASE_ORDER.reduce((acc, id) => { acc[id] = TODO; return acc; }, {});

export const phaseMeta  = (id) => PHASES[id] || PHASES[PHASE_AUDIT];
export const phaseIndex = (id) => PHASE_ORDER.indexOf(id);

export const nextPhase = (id) => PHASE_ORDER[phaseIndex(id) + 1] || null;
export const prevPhase = (id) => (phaseIndex(id) > 0 ? PHASE_ORDER[phaseIndex(id) - 1] : null);

/**
 * Phase la plus avancée que le rédacteur peut ouvrir : la première qui n'est pas
 * terminée. Tout ce qui précède reste accessible (retour en arrière libre).
 */
export const maxReachablePhase = (statuses = {}) => {
  for (const id of PHASE_ORDER) {
    if (statuses[id] !== DONE) return id;
  }
  return PHASE_ORDER[PHASE_ORDER.length - 1];   // tout est fait → dernière phase
};

export const canEnterPhase = (id, statuses = {}) => {
  const i = phaseIndex(id);
  if (i < 0) return false;
  return i <= phaseIndex(maxReachablePhase(statuses));
};

/**
 * Reconstitue l'avancement d'un article qui n'en porte pas — tout ce qui a été
 * créé AVANT le passage au parcours en quatre phases (file d'attente, historique,
 * archives). On déduit l'avancement de ce que l'enregistrement contient déjà,
 * plutôt que de renvoyer le rédacteur à la phase 1 sur un article déjà travaillé.
 */
export const derivePhaseStatus = (rec) => {
  const base = initialPhaseStatus();
  if (!rec) return base;
  if (rec.phaseStatus) return { ...base, ...rec.phaseStatus };   // déjà au nouveau format

  const aUnAudit      = !!(rec.auditJson || rec.audit);
  const aUneGenration = !!(rec.qatArticle || rec.updatedContent || (rec.diff && rec.diff.length));
  const aUneVerif     = !!rec.obsolescenceReport;

  // Une génération présente implique un audit passé : sur les anciens
  // enregistrements l'audit markdown n'était pas toujours conservé.
  if (aUnAudit || aUneGenration) base[PHASE_AUDIT] = DONE;
  if (aUneGenration)             base[PHASE_GENERATION] = DONE;
  if (aUneVerif)                 base[PHASE_OBSOLESCENCE] = DONE;
  return base;
};

// ── Phase 2 : ampleur décidée par le rédacteur ────────────────────────────────
// L'audit PROPOSE (champ `ampleur.decision`), le rédacteur TRANCHE. Ce choix
// remonte de l'écran de lancement vers la phase 2 : on ne peut pas décider de
// l'ampleur avant d'avoir lu l'audit.

export const SCOPE_SIMPLE  = 'simple';
export const SCOPE_REFONTE = 'refonte';

export const MAJ_SCOPES = {
  [SCOPE_SIMPLE]: {
    label: 'MAJ simple',
    hint: 'portions ciblées',
    description: 'Modifications ciblées, validées une par une dans le diff. La structure et le texte existants sont conservés.',
  },
  [SCOPE_REFONTE]: {
    label: 'Refonte',
    hint: 'article entier',
    description: 'Article réécrit intégralement à partir de toutes les directives. La structure est refaite.',
  },
};

/**
 * Ampleur PROPOSÉE par l'audit. L'audit propose, le rédacteur tranche : cette
 * valeur ne fait que présélectionner le choix de la phase 2.
 *
 * `restructuration` (plan refait, fond conservé) relève de la refonte : la
 * structure change, donc c'est hors de portée de modifications ciblées.
 * Décision absente ou inconnue → refonte, l'option prudente : mieux vaut
 * proposer trop de travail que de laisser passer un article à refaire.
 */
export const scopeProposedByAudit = (audit) => {
  const d = audit && audit.ampleur && audit.ampleur.decision;
  return d === 'maj_ciblee' ? SCOPE_SIMPLE : SCOPE_REFONTE;
};

/**
 * MINIMUM STRICT sur une MAJ simple : 200 mots ajoutés. Ce n'est pas un objectif
 * indicatif — une MAJ simple qui ajoute moins que ça est NON CONFORME et doit
 * être signalée comme telle, pas comme une remarque neutre.
 *
 * Le décompte est calculé et affiché : le rédacteur voit le chiffre réel plutôt
 * que de faire confiance à l'IA sur parole. Même principe à chaque phase — un
 * indicateur vérifiable, jamais une promesse.
 */
export const MIN_WORDS_ADDED_SIMPLE = 200;

/** Nombre de mots d'un fragment HTML ou texte. */
export const wordCount = (htmlOrText = '') =>
  String(htmlOrText)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(?:nbsp|amp|lt|gt|quot|#\d+);/gi, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .length;

/**
 * Bilan de longueur entre l'avant et l'après, affiché au rédacteur en fin de
 * phase 2. `conforme` porte le minimum strict des 200 mots pour une MAJ simple ;
 * une refonte n'y est pas soumise (elle a le droit de raccourcir l'article).
 */
export const wordsAddedReport = (beforeHtml, afterHtml, scope = SCOPE_SIMPLE) => {
  const before = wordCount(beforeHtml);
  const after  = wordCount(afterHtml);
  const added  = after - before;
  // `null` = aucun minimum ne s'applique (refonte). Ce n'est PAS « un minimum de
  // zéro » : une refonte a le droit de raccourcir l'article, donc un écart négatif
  // reste conforme — la comparaison `added >= 0` la déclarerait à tort non conforme.
  const minimum = scope === SCOPE_SIMPLE ? MIN_WORDS_ADDED_SIMPLE : null;
  return {
    before, after, added, minimum,
    conforme: minimum === null ? true : added >= minimum,
    manque:   minimum === null ? 0    : Math.max(0, minimum - added),
  };
};
