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

/**
 * ── CE QUE L'AUDIT A TROUVÉ, EN CLAIR ────────────────────────────────────────
 *
 * Ajouté le 18 août 2026, demande d'Andrianina : « Données périmées et
 * développements manquants : 4 (lister les 4 manquants) », « donner les faits
 * récents trouvés par la recherche ».
 *
 * Le défaut était réel et il vidait le dispositif de son sens. Les cases
 * n'affichaient qu'un COMPTEUR — « 4 », « 10 ». Or on demandait au rédacteur de
 * TRANCHER : cocher, c'est décider qu'une consigne part au modèle. Décider sur un
 * nombre, sans voir de quoi il s'agit, ce n'est pas décider — c'est deviner. Le
 * pré-cochage par ampleur (règle 12) devenait alors la seule vraie décision, et
 * les cases un décor de plus.
 *
 * Trois choses sont rendues visibles, et chacune pour une raison précise :
 *   • le FAIT, évidemment ;
 *   • la NUANCE (« à confirmer ») — c'est le point EXACT qui a lâché en
 *     production : noyée dans un JSON de dix champs, le modèle l'a ignorée et a
 *     écrit « date confirmée au Comic-Con le 24 juillet ». Elle doit sauter aux
 *     yeux de celui qui coche ;
 *   • la SOURCE, réduite à son nom d'hôte : elle rend le fait vérifiable en un
 *     clic. Un fait sans source affichée est un fait qu'on croit sur parole.
 *
 * Aucune donnée n'est fabriquée : tout est repris tel quel de l'audit. Un champ
 * de forme inattendue (le modèle rend parfois du texte libre là où le schéma
 * prévoit un objet) est rendu en texte plutôt qu'ignoré — l'ignorer afficherait
 * « 4 » avec deux lignes en dessous, ce qui est pire qu'un affichage imparfait.
 */

const ligneTexte = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();

/** Nom d'hôte d'une URL, ou '' — c'est lui qui rend la source lisible. */
export const sourceHost = (u) => {
  const s = ligneTexte(u);
  if (!s) return '';
  try { return new URL(s).hostname.replace(/^www\./, ''); } catch { return ''; }
};

/** Premières valeurs textuelles d'un objet de forme inconnue. */
const premiersTextes = (o) => Object.entries(o)
  .filter(([k, v]) => typeof v === 'string' && v.trim() && !/^(source|url|nuance|priority)$/i.test(k))
  .map(([, v]) => ligneTexte(v));

/** Une entrée d'audit → { text, nuance, source }. Jamais null : on montre tout. */
const versLigne = (item, clesPrincipales = []) => {
  if (item == null) return null;
  if (typeof item === 'string') {
    const t = ligneTexte(item);
    return t ? { text: t, nuance: '', source: '' } : null;
  }
  if (typeof item !== 'object') return { text: ligneTexte(item), nuance: '', source: '' };

  // Clés attendues d'abord, dans l'ordre du schéma : elles composent la phrase
  // la plus lisible (« Metascore Sons of Sparta : 64/100 »).
  const morceaux = clesPrincipales.map((k) => ligneTexte(item[k])).filter(Boolean);
  const texte = morceaux.length ? [...new Set(morceaux)].join(' — ') : premiersTextes(item).join(' — ');
  if (!texte) return null;
  return {
    text: texte,
    nuance: ligneTexte(item.nuance),
    source: sourceHost(item.source || item.url),
  };
};

/**
 * Les éléments d'une catégorie de l'audit, prêts à l'affichage.
 *
 * `recent_context` porte DEUX listes de natures différentes — une donnée périmée
 * n'est pas un développement manquant — d'où le préfixe qui les distingue. Les
 * fondre sans le dire ferait lire « 4 » comme quatre choses de même nature.
 *
 * @returns {Array<{text:string, nuance:string, source:string, prefixe?:string}>}
 */
export const auditItemLines = (audit, field) => {
  const v = audit?.[field];
  if (v == null) return [];

  if (field === 'recent_context') {
    const r = typeof v === 'object' ? v : {};
    const out = [];
    (Array.isArray(r.donnees_obsoletes) ? r.donnees_obsoletes : []).forEach((d) => {
      const l = versLigne(d, ['element', 'valeur_actuelle']);
      if (l) out.push({ ...l, prefixe: 'Périmé' });
    });
    (Array.isArray(r.developpements_manquants) ? r.developpements_manquants : []).forEach((d) => {
      const l = versLigne(d, ['sujet', 'description']);
      if (l) out.push({ ...l, prefixe: 'Manquant' });
    });
    // Forme inattendue : plutôt que rien, on montre ce qu'il y a.
    if (!out.length && typeof v === 'string') {
      const l = versLigne(v);
      if (l) out.push(l);
    }
    return out;
  }

  const CLES = {
    a_supprimer:              ['element', 'passage', 'raison'],
    sources_check:            ['affirmation', 'statut'],
    seo_geo_gaps:             ['gap', 'element', 'description'],
    eeat_recommendations:     ['recommandation', 'element', 'description'],
    strategic_recommendation: ['recommandation', 'description'],
    tldr:                     ['point', 'texte'],
  };
  const liste = Array.isArray(v) ? v : [v];
  return liste.map((it) => versLigne(it, CLES[field] || [])).filter(Boolean);
};
