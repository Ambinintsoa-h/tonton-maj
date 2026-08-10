/**
 * generationPrompt.js — fusion de la vision du rédacteur et de l'audit.
 *
 * C'est le cœur de la PHASE 2. Le rédacteur ne repart pas d'une page blanche :
 * Tonton pré-remplit un prompt à partir de son MODÈLE personnel (ses directives
 * permanentes) et de l'AUDIT de cet article (ce qui est réellement à corriger).
 * Il ajuste, puis lance. Le texte produit ici part dans `instruction`, que
 * runQatRewrite injecte en priorité haute.
 *
 * Rien n'est inventé : chaque ligne issue de l'audit est reprise telle quelle du
 * JSON, sans reformulation. Si l'audit est vide, le prompt le dit au lieu de
 * fabriquer des recommandations.
 */
import { SCOPE_SIMPLE, MIN_WORDS_ADDED_SIMPLE } from '../constants/majPhases';

/**
 * Modèle par défaut, servi au rédacteur qui n'en a pas encore enregistré un.
 * Volontairement court : ce sont SES directives permanentes, pas les règles
 * métier — celles-ci vivent dans les skills et n'ont pas à être recopiées ici.
 */
export const DEFAULT_GENERATION_TEMPLATE = `Écris comme une journaliste spécialisée : ton factuel, phrases courtes, aucune formule creuse.
Conserve toute information encore valable de l'article d'origine, reformulée au style.
Remplace les données datées par des chiffres vérifiables et récents.
Ne laisse aucun paragraphe sans apport concret.`;

/**
 * Modèle par défaut de la PHASE 3. Volontairement restrictif : cette étape ne
 * doit vérifier que l'exactitude et la fraîcheur. Sans cette borne, le modèle
 * repart en réécriture éditoriale et noie les vraies obsolescences.
 */
export const DEFAULT_VERIFICATION_TEMPLATE = `Vérifie uniquement l'exactitude et la fraîcheur des informations de cet article.
Signale les chiffres et tarifs dépassés, les dates révolues, les normes ou réglementations remplacées, les produits ou versions abandonnés.
Pour chaque point, donne le passage exact à remplacer et sa version corrigée, avec la source quand tu l'as.
N'apporte aucune amélioration de style : ce n'est pas l'objet de cette étape.`;

const MAX_ACTIONS = 8;      // même plafond que l'audit (skill QAT)
const MAX_OBSOLETES = 5;

const ligne = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();

/** Actions prioritaires de l'audit, de la plus urgente à la moins urgente. */
const actionsDeLAudit = (audit) => {
  const brutes = Array.isArray(audit?.priority_actions) ? audit.priority_actions : [];
  const rang = { P1: 0, P2: 1, P3: 2 };
  return brutes
    .filter((a) => a && (a.title || a.detail))
    .slice(0, MAX_ACTIONS)
    .map((a, i) => ({ ...a, _i: i }))
    .sort((a, b) => (rang[a.priority] ?? 9) - (rang[b.priority] ?? 9) || a._i - b._i)
    .map((a) => {
      const p = a.priority ? `[${a.priority}] ` : '';
      const t = ligne(a.title);
      const d = ligne(a.detail);
      return `- ${p}${t}${d && d !== t ? ` — ${d}` : ''}`;
    });
};

/** Données que l'audit signale comme périmées. */
const obsoletesDeLAudit = (audit) => {
  const src = audit?.recent_context?.donnees_obsoletes;
  return (Array.isArray(src) ? src : [])
    .filter((o) => o && (o.element || o.valeur_actuelle))
    .slice(0, MAX_OBSOLETES)
    .map((o) => {
      const e = ligne(o.element);
      const av = ligne(o.valeur_article);
      const ap = ligne(o.valeur_actuelle);
      if (av && ap) return `- ${e} : « ${av} » devient « ${ap} »`;
      return `- ${e}${ap ? ` : ${ap}` : ''}`;
    });
};

/**
 * Construit le prompt de génération.
 *
 * @param {object}  audit          audit QAT (objet JSON) — peut être null
 * @param {string}  template       modèle personnel du rédacteur
 * @param {string}  scope          SCOPE_SIMPLE | SCOPE_REFONTE
 * @param {string}  targetKeyword  mot-clé cible
 * @returns {string} prompt prêt à être relu et ajusté
 */
export const buildGenerationPrompt = ({
  audit = null,
  template = DEFAULT_GENERATION_TEMPLATE,
  scope = SCOPE_SIMPLE,
  targetKeyword = '',
} = {}) => {
  const bloc = [];

  const mesDirectives = ligne(template) ? String(template).trim() : DEFAULT_GENERATION_TEMPLATE;
  bloc.push('## Mes directives', mesDirectives);

  if (scope === SCOPE_SIMPLE) {
    bloc.push('', '## Ampleur : MAJ simple',
      'Corrige et enrichis les passages concernés en conservant la structure et le texte qui fonctionnent.',
      `Ajoute ${MIN_WORDS_ADDED_SIMPLE} mots au minimum : c'est un minimum strict, pas un objectif indicatif.`);
  } else {
    bloc.push('', '## Ampleur : refonte',
      'Réécris l\'article intégralement à partir de ces directives. Le plan peut être refait.',
      'Toute information encore valable de l\'ancien texte est conservée et reformulée, jamais supprimée par réflexe.');
  }

  if (targetKeyword) {
    bloc.push('', `## Mot-clé cible`, `« ${ligne(targetKeyword)} » — à employer tel quel, à la lettre près.`);
  }

  const actions = actionsDeLAudit(audit);
  const obsoletes = obsoletesDeLAudit(audit);
  const resume = ligne(audit?.executive_summary);

  if (!actions.length && !obsoletes.length && !resume) {
    bloc.push('', '## Audit',
      'Aucune recommandation exploitable dans l\'audit de cet article — appuie-toi sur mes directives seules.');
  } else {
    bloc.push('', '## Ce que l\'audit demande de corriger');
    if (resume) bloc.push(resume);
    if (actions.length) bloc.push('', ...actions);
    if (obsoletes.length) bloc.push('', 'Données à actualiser :', ...obsoletes);
  }

  return bloc.join('\n');
};
