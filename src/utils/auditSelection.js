/**
 * auditSelection.js — LE RÉDACTEUR TRANCHE CE QUE L'AUDIT IMPOSE.
 *
 * Jusqu'ici l'audit partait EN ENTIER à la génération, par deux canaux à la
 * fois : le JSON brut (`summarizeAuditForRewrite`, services/agentQat.js) et la
 * prose du textarea (`buildGenerationPrompt`). Le modèle recevait donc, sur un
 * article réel, 8 actions + 10 affirmations à sourcer + 6 manques SEO + 5
 * recommandations EEAT — une trentaine de consignes concurrentes qu'AUCUN humain
 * n'avait hiérarchisées. Il arbitrait seul, et c'est en arbitrant qu'il a inventé
 * une confirmation de date (« confirmé au Comic-Con le 24 juillet ») que l'audit
 * demandait justement de mettre au conditionnel.
 *
 * Ce module ne fait qu'une chose : dire QUELLES catégories partent. Le rédacteur
 * coche, le code filtre les DEUX canaux avec la MÊME sélection.
 *
 * ── PÉRIMÈTRE, décision Andrianina (août 2026) ──────────────────────────────
 * Les cases ne pilotent QUE LE CONTENU. Tout l'aspect technique reste appliqué
 * sans recours et n'apparaît JAMAIS ici : verrou liens externes (règle 8),
 * dofollow/nofollow à l'export, reprise des liens et des images (R1/R4),
 * maillage à 100 % et déliage des zones interdites (R2/R2a), plafond de 20 mots
 * par phrase et gras sémantique (règle 10), plancher de 6 à 10 liens internes
 * suggérés, schéma JSON et `max_tokens`.
 *
 * Deux champs d'audit sont volontairement ABSENTS de la liste cochable sans être
 * techniques pour autant : `ampleur` pilote `resolveQatDepth` et
 * `keyword_repositioning` porte le mot-clé cible. Les décocher ne nuancerait pas
 * la génération, elle la casserait.
 */
import { SCOPE_SIMPLE } from '../constants/majPhases';

/**
 * Les quatre blocs, dans l'ordre d'affichage de la colonne de gauche.
 *
 * `factuel` vient EN PREMIER et reste à part : ces deux catégories portent sur la
 * VÉRACITÉ, pas sur la qualité. Décocher « ajouter un bloc auteur » renonce à une
 * amélioration ; décocher « retirer cette affirmation fausse » publie sciemment
 * du non vérifié. Les mêler aux améliorations SEO dans une liste plate ferait
 * décocher les deux du même geste distrait — c'est exactement le trou par lequel
 * l'invention de date est passée.
 */
export const AUDIT_BLOCKS = [
  {
    key: 'factuel',
    label: 'Factuel',
    hint: 'Véracité — décocher, c\'est publier du non vérifié.',
    fields: ['a_supprimer', 'sources_check'],
  },
  {
    key: 'fraicheur',
    label: 'Fraîcheur',
    hint: 'Les faits récents trouvés par la recherche web de l\'audit.',
    fields: ['recent_context'],
  },
  {
    key: 'actions',
    label: 'Actions prioritaires',
    hint: 'P1 d\'abord : ce que l\'audit juge bloquant.',
    fields: ['priority_actions'],
  },
  {
    key: 'ameliorations',
    label: 'Améliorations',
    hint: 'Utile, jamais bloquant.',
    fields: ['seo_geo_gaps', 'eeat_recommendations', 'strategic_recommendation', 'tldr'],
  },
];

/** Toutes les catégories cochables, à plat. Source unique des deux filtres. */
export const SELECTABLE_FIELDS = AUDIT_BLOCKS.flatMap((b) => b.fields);

/** Catégories dont le décochage engage la véracité — avertissement à la publication. */
export const FACTUAL_FIELDS = AUDIT_BLOCKS.find((b) => b.key === 'factuel').fields;

/**
 * Champs qui partent TOUJOURS, cochés ou non : ils ne décrivent pas du contenu à
 * ajouter mais le cadre de la réécriture.
 */
export const ALWAYS_SENT_FIELDS = ['ampleur', 'keyword_repositioning'];

/**
 * Pré-cochage, PAR AMPLEUR — et c'est tout l'intérêt du dispositif.
 *
 * Une MAJ simple ajoute 200 mots au minimum (`MIN_WORDS_ADDED_SIMPLE`), soit UN
 * H2 bien sourcé. Lui envoyer trente consignes n'est pas exigeant, c'est
 * incohérent : aucun arbitrage raisonnable n'existe entre « réduire à 2 500
 * mots » et « ajoute 200 mots », et le code en portait déjà la cicatrice — une
 * ligne « PRÉSÉANCE : une action de l'audit qui demande de raccourcir ne
 * l'emporte PAS » écrite dans le prompt après qu'un test réel ait RACCOURCI
 * l'article de 935 mots sur une MAJ simple. Cette rustine arbitrait un conflit
 * qu'il suffisait de ne pas créer : sur MAJ simple, l'action se décoche.
 *
 * Seule la fraîcheur reste pré-cochée : un H2 d'actualisation SANS les données
 * d'actualisation n'a aucune matière, et cette recherche web a été payée.
 */
export const defaultAuditSelection = (scope) => {
  const simple = scope === SCOPE_SIMPLE;
  return {
    a_supprimer:              !simple,
    sources_check:            !simple,
    recent_context:           true,
    priority_actions:         !simple ? ['P1'] : [],
    seo_geo_gaps:             false,
    eeat_recommendations:     false,
    strategic_recommendation: false,
    tldr:                     false,
  };
};

/** `priority_actions` se coche par priorité, pas en bloc. */
export const isFieldSelected = (selection, field) => {
  const v = selection?.[field];
  return Array.isArray(v) ? v.length > 0 : !!v;
};

/** Priorités retenues pour `priority_actions` (tableau, jamais un booléen). */
export const selectedPriorities = (selection) => {
  const v = selection?.priority_actions;
  return Array.isArray(v) ? v : [];
};

/**
 * Filtre l'audit selon la sélection. Retourne un NOUVEL objet : l'audit d'origine
 * reste intact, il est affiché au rédacteur et enregistré en base.
 *
 * Une sélection absente (`null`) renvoie l'audit tel quel — les articles audités
 * avant ce dispositif, et les appels qui ne passent pas par la phase 2, ne
 * changent pas de comportement.
 */
export const filterAuditBySelection = (audit, selection) => {
  if (!audit || !selection) return audit;
  const out = {};
  Object.keys(audit).forEach((k) => {
    if (!SELECTABLE_FIELDS.includes(k)) { out[k] = audit[k]; return; }
    if (k === 'priority_actions') {
      const gardees = selectedPriorities(selection);
      out[k] = (Array.isArray(audit[k]) ? audit[k] : [])
        .filter((a) => gardees.includes(a?.priority));
      return;
    }
    if (isFieldSelected(selection, k)) out[k] = audit[k];
  });
  return out;
};

/**
 * Le rédacteur a-t-il tout décoché ? À distinguer d'un audit ABSENT.
 *
 * Le repli d'un audit manquant écrit « Audit indisponible : traite l'article
 * comme une refonte totale prudente ». Servir ce texte à quelqu'un qui a
 * sciemment tout décoché serait faux DEUX fois : l'audit existe, et il vient de
 * demander le minimum, pas une refonte. Deux états, deux messages.
 */
export const isSelectionEmpty = (selection) => !!selection
  && !SELECTABLE_FIELDS.some((f) => isFieldSelected(selection, f));

/** Catégories factuelles décochées — nourrit l'avertissement de publication. */
export const unselectedFactualFields = (selection, audit = null) => {
  if (!selection) return [];
  return FACTUAL_FIELDS.filter((f) => {
    if (isFieldSelected(selection, f)) return false;
    // Ne pas alerter sur une catégorie que l'audit n'a de toute façon pas remplie.
    if (!audit) return true;
    const v = audit[f];
    return Array.isArray(v) ? v.length > 0 : !!v;
  });
};
