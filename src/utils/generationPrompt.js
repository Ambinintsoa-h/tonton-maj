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
import { filterAuditBySelection, isSelectionEmpty } from './auditSelection';

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

/**
 * PLAFOND DE L'INSTRUCTION, en caractères.
 *
 * `runQatRewrite` tronque l'instruction à cette longueur avant de l'envoyer
 * (`agentQat.js`). Mesuré avant correction : un audit complet produisait 2 557
 * caractères, donc **1 057 perdus en silence** — les actions 5 à 8 et TOUT le
 * bloc « Données à actualiser », c'est-à-dire les chiffres à rafraîchir.
 *
 * Exporté pour que la saisie (compteur bloquant, PhaseGeneration), le
 * pré-remplissage (ci-dessous) et l'envoi partagent LE MÊME littéral. Trois
 * copies d'un plafond, c'est trois occasions de divergence.
 */
export const MAX_INSTRUCTION_CHARS = 1500;

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
      // DEUX formes. Quand la place manque, on garde l'action en abrégeant son
      // détail plutôt que de supprimer l'action entière : huit titres valent
      // mieux que deux actions complètes et six disparues.
      return {
        long: `- ${p}${t}${d && d !== t ? ` — ${d}` : ''}`,
        court: `- ${p}${t || d}`,
      };
    });
};

/**
 * Champs d'audit qui NE nourrissent PAS le prompt du rédacteur, mais qui partent
 * quand même au modèle : `summarizeAuditForRewrite` (services/agentQat.js) les
 * injecte dans la refonte.
 *
 * Ils servent ici à une seule chose, et elle compte : ne plus écrire « aucune
 * recommandation exploitable » quand l'audit en contient. Le verdict était rendu
 * sur TROIS champs alors que le modèle en reçoit DIX — un audit sans action
 * prioritaire mais riche en manques SEO ou en recommandations stratégiques était
 * donc annoncé vide au rédacteur, qui pouvait croire l'analyse ratée.
 *
 * On les NOMME sans recopier leur contenu : le dupliquer dans `instruction`
 * l'enverrait deux fois au modèle et surpondérerait l'audit face aux directives.
 */
const AUTRES_APPORTS = [
  ['a_supprimer',              'passages à supprimer'],
  ['keyword_repositioning',    'repositionnement du mot-clé'],
  ['seo_geo_gaps',             'manques SEO / GEO'],
  ['eeat_recommendations',     'recommandations EEAT'],
  ['strategic_recommendation', 'recommandation stratégique'],
  ['sources_check',            'affirmations à sourcer'],
];

/** Compte ce qui est réellement rempli — tableau non vide ou objet non vide. */
const rempli = (v) => {
  if (Array.isArray(v)) return v.length > 0;
  if (v && typeof v === 'object') return Object.keys(v).length > 0;
  return !!ligne(v);
};

const autresApportsDeLAudit = (audit) => AUTRES_APPORTS
  .filter(([cle]) => rempli(audit?.[cle]))
  .map(([cle, libelle]) => {
    const v = audit[cle];
    return Array.isArray(v) ? `${libelle} (${v.length})` : libelle;
  });

/**
 * SUGGESTION DE FRAÎCHEUR, PRÉ-REMPLIE DANS LA DIRECTIVE (MAJ simple).
 *
 * Une MAJ simple ajoute 200 mots au minimum : concrètement UN H2 d'actualisation.
 * Le rédacteur écrivait cette directive à la main alors que l'audit venait de
 * PAYER une recherche web pour trouver exactement ces faits — dates, scores,
 * statuts, sources. On les lui sert, il ajuste.
 *
 * ASSEMBLAGE EN DUR, aucun appel IA : chaque valeur est reprise telle quelle du
 * JSON d'audit. Le code ne rédige pas de son initiative — c'est la même ligne de
 * conduite que le maillage (`weaveBriefLinks`), à ceci près qu'ici le texte
 * atterrit dans un champ que le rédacteur RELIT avant de lancer, donc sans avoir
 * besoin d'être marqué dans l'éditeur.
 *
 * La nuance (`d.nuance`, « à confirmer ») est reprise TEXTUELLEMENT et suivie de
 * « au conditionnel ». C'est le point qui a lâché en production : noyée dans un
 * JSON de dix champs parmi trente consignes, la nuance a été ignorée et le modèle
 * a inventé une confirmation de date. Dans la directive de priorité haute, que le
 * rédacteur a sous les yeux, elle a une chance de tenir.
 */
export const buildFreshnessSuggestion = (audit, maxChars = MAX_INSTRUCTION_CHARS) => {
  const recent = audit?.recent_context || {};
  const faits = [];

  (Array.isArray(recent.donnees_obsoletes) ? recent.donnees_obsoletes : [])
    .filter((d) => d && (d.element || d.valeur_actuelle))
    .slice(0, MAX_OBSOLETES)
    .forEach((d) => {
      const e = ligne(d.element);
      const v = ligne(d.valeur_actuelle);
      faits.push(v ? `${e} : ${v}` : e);
    });

  (Array.isArray(recent.developpements_manquants) ? recent.developpements_manquants : [])
    .filter((d) => d && (d.sujet || d.description))
    .slice(0, MAX_OBSOLETES)
    .forEach((d) => {
      const s = ligne(d.sujet);
      const desc = ligne(d.description);
      const n = ligne(d.nuance);
      const base = desc && desc !== s ? `${s} — ${desc}` : s || desc;
      faits.push(n ? `${base} (${n} : écris-le au conditionnel)` : base);
    });

  if (!faits.length) return '';

  // Les sources sont NOMMÉES, jamais inventées : l'audit les a rapportées de sa
  // recherche web. Le rédacteur sait où vérifier avant de valider la directive.
  const sources = [...new Set(
    [...(Array.isArray(recent.donnees_obsoletes) ? recent.donnees_obsoletes : []),
      ...(Array.isArray(recent.developpements_manquants) ? recent.developpements_manquants : [])]
      .map((d) => ligne(d?.source))
      .filter(Boolean)
      .map((u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } })
      .filter(Boolean)
  )];

  // ── ON TIENT DANS LE PLAFOND, ET ON DIT CE QU'ON ÉCARTE ────────────────────
  // Sans cette borne, la suggestion faisait à elle seule 3 127 caractères sur un
  // audit chargé, soit le DOUBLE du plafond de l'instruction. `runQatRewrite`
  // tronque par la FIN : la ligne « Sources » sautait la première, et avec elle
  // la seule chose qui rend le fait vérifiable. Même logique que les deux listes
  // d'audit plus bas, et jamais de coupe silencieuse.
  const entete = `Ajout de fraîcheur — un H2, ${MIN_WORDS_ADDED_SIMPLE} mots minimum, chaque fait sourcé.`;
  const pied = sources.length ? `Sources : ${sources.join(', ')}.` : '';
  const dispo = Math.max(0, maxChars - entete.length - (pied ? pied.length + 1 : 0) - 1);

  const retenus = [];
  let cout = 0;
  faits.forEach((f) => {
    const l = `- ${f}`;
    if (cout + l.length + 1 <= dispo) { retenus.push(l); cout += l.length + 1; }
  });
  // Aucun fait ne tient : mieux vaut ne rien suggérer que servir un en-tête et
  // une liste de sources sans le moindre fait à rédiger.
  if (!retenus.length) return '';
  const ecartes = faits.length - retenus.length;

  return [
    entete,
    ...retenus,
    ecartes ? `(+ ${ecartes} fait(s) de fraîcheur non repris ici, faute de place — voir l'audit.)` : '',
    pied,
  ].filter(Boolean).join('\n');
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
      const long = av && ap ? `- ${e} : « ${av} » devient « ${ap} »` : `- ${e}${ap ? ` : ${ap}` : ''}`;
      // Forme courte : la valeur À JOUR suffit à agir, l'ancienne est dans l'article.
      return { long, court: `- ${e}${ap ? ` : ${ap}` : ''}` };
    });
};

/**
 * Construit le prompt de génération.
 *
 * @param {object}  audit          audit QAT (objet JSON) — peut être null
 * @param {string}  template       modèle personnel du rédacteur
 * @param {string}  scope          SCOPE_SIMPLE | SCOPE_REFONTE
 * @param {string}  targetKeyword  mot-clé cible
 * @param {object}  selection      cases cochées par le rédacteur (null = tout)
 * @returns {string} prompt prêt à être relu et ajusté
 */
export const buildGenerationPrompt = ({
  audit: auditComplet = null,
  template = DEFAULT_GENERATION_TEMPLATE,
  scope = SCOPE_SIMPLE,
  targetKeyword = '',
  selection = null,
} = {}) => {
  const bloc = [];

  // MÊME sélection que `summarizeAuditForRewrite` : les deux canaux doivent voir
  // le même audit, sinon la case décochée disparaîtrait de l'écran tout en
  // partant au modèle par le JSON — des cases décoratives, et une confiance
  // perdue qu'on ne récupère pas.
  const audit = filterAuditBySelection(auditComplet, selection);

  // Le template n'est JAMAIS remplacé par la suggestion : les directives
  // permanentes du rédacteur (tutoiement, forme des H2) doivent survivre au
  // pré-remplissage. Elles passent devant, la suggestion se glisse dessous.
  const mesDirectives = ligne(template) ? String(template).trim() : DEFAULT_GENERATION_TEMPLATE;
  bloc.push('## Mes directives', mesDirectives);

  // La suggestion de fraîcheur s'AFFICHE ici, sous les directives permanentes,
  // mais elle se CALCULE plus bas : son budget dépend de tout ce qui vient après
  // (ampleur, mot-clé, audit). Calculée à cet endroit, elle réservait 120
  // caractères pour le seul bloc « Mot-clé » et ignorait les 310 du bloc
  // « Ampleur » — le prompt sortait à 1 863 caractères, donc tronqué par la fin
  // par `runQatRewrite`. On retient la position, on insère à la fin.
  const POS_FRAICHEUR = bloc.length;

  if (scope === SCOPE_SIMPLE) {
    bloc.push('', '## Ampleur : MAJ simple',
      'Corrige et enrichis les passages concernés, en gardant la structure et le texte qui tiennent.',
      `Ajoute ${MIN_WORDS_ADDED_SIMPLE} mots au minimum — minimum strict, pas un objectif.`,
      // Sans cette préséance, une action d'audit du type « réduire de 3452 à 2500
      // mots » entre en contradiction directe avec le minimum ci-dessus. Constaté
      // en test réel : le modèle a suivi l'audit et RACCOURCI l'article de 935
      // mots sur une MAJ simple. Les deux consignes venant du même prompt, c'est
      // à lui de dire laquelle l'emporte.
      // Formulation resserrée (232 → 118 caractères) : le plafond de l'instruction
      // est serré, et chaque caractère de texte FIXE en retire un au contenu de
      // l'audit, qui est la vraie matière.
      'PRÉSÉANCE : une action de l\'audit qui demande de raccourcir ne l\'emporte PAS sur ce minimum. Applique-la sans réduire la longueur.');
  } else {
    bloc.push('', '## Ampleur : refonte',
      'Réécris l\'article intégralement à partir de ces directives. Le plan peut être refait.',
      'Toute information encore valable de l\'ancien texte est conservée et reformulée.');
  }

  if (targetKeyword) {
    bloc.push('', '## Mot-clé cible', `« ${ligne(targetKeyword)} » — tel quel, à la lettre près.`);
  }

  // ── Insertion de la suggestion de fraîcheur, à la place retenue plus haut ───
  // Réserve : l'en-tête « Ce que l'audit demande de corriger » et la note de
  // points non repris s'ajoutent hors budget dans la section suivante.
  const RESERVE_AUDIT = 160;
  if (scope === SCOPE_SIMPLE) {
    const suggestion = buildFreshnessSuggestion(
      audit, MAX_INSTRUCTION_CHARS - bloc.join('\n').length - RESERVE_AUDIT,
    );
    if (suggestion) bloc.splice(POS_FRAICHEUR, 0, '', suggestion);
  }

  // TOUT DÉCOCHÉ N'EST PAS « AUDIT INDISPONIBLE ». Le repli d'un audit absent
  // écrit « traite l'article comme une refonte totale prudente » : le servir à
  // quelqu'un qui a sciemment tout décoché serait faux deux fois — l'audit
  // existe, et il vient de demander le minimum, pas une refonte. Deux états,
  // deux messages, comme `skills.bootstrapped`.
  if (auditComplet && isSelectionEmpty(selection)) {
    bloc.push('', '## Audit — écarté par le rédacteur',
      'L\'audit a bien tourné : aucune de ses catégories n\'a été retenue pour cette génération.',
      'Applique mes directives ci-dessus, et rien d\'autre de l\'audit.');
    return bloc.join('\n');
  }

  const actions = actionsDeLAudit(audit);
  const obsoletes = obsoletesDeLAudit(audit);
  const resume = ligne(audit?.executive_summary);

  if (!actions.length && !obsoletes.length && !resume) {
    // L'audit n'a rien d'ACTIONNABLE au sens de ce prompt. Ça ne veut pas dire
    // qu'il est vide : le dire à tort ferait douter le rédacteur d'une analyse
    // qui a bel et bien tourné, et qu'il paie.
    const autres = autresApportsDeLAudit(audit);
    if (autres.length) {
      bloc.push('', '## Audit — aucune action prioritaire',
        `Ni action prioritaire, ni donnée obsolète, ni résumé. Il contient en revanche : ${autres.join(', ')}.`,
        'Ces éléments partent au modèle avec l\'audit complet — ne les recopie pas ici.');
    } else {
      bloc.push('', '## Audit',
        'Aucune recommandation exploitable dans l\'audit de cet article — appuie-toi sur mes directives seules.');
    }
  } else {
    bloc.push('', '## Ce que l\'audit demande de corriger');
    if (resume) bloc.push(resume);

    // ── ON TIENT DANS LE PLAFOND, ET ON DIT CE QUI N'Y TIENT PAS ─────────────
    // Avant : tout était empilé, puis `runQatRewrite` coupait à 1 500 caractères
    // au milieu d'une phrase. Les actions 5 à 8 et TOUT le bloc « Données à
    // actualiser » disparaissaient — sans un mot, et toujours les mêmes, parce
    // qu'une troncature ampute par la FIN.
    //
    // Rien n'est perdu de ce que le rédacteur a COCHÉ :
    // `summarizeAuditForRewrite` envoie les catégories retenues entières au
    // modèle par l'autre canal — filtrées par la MÊME sélection qu'ici. Ce qui se
    // joue à cet endroit, c'est la place dans l'instruction de PRIORITÉ HAUTE, et
    // la relecture par le rédacteur.
    // « avec l'audit COMPLET » se lisait « l'audit NON FILTRÉ » — et c'est cette
    // phrase qui a fait douter Andrianina de l'utilité des cases le 20 août 2026 :
    // il a compris que tout partait quand même, cases décochées ou non. L'audit du
    // second canal est filtré par la MÊME sélection ; la note doit le dire, sinon
    // le dispositif passe pour un décor.
    const NOTE = (n) => `(+ ${n} point(s) d'audit non repris ici, faute de place — ils partent avec l'audit, filtré par les mêmes cases.)`;
    // Réserve calculée sur la note la PLUS LONGUE possible, jamais estimée : une
    // marge « à peu près » laissait le total à 1 537 caractères.
    const reserve = NOTE(actions.length + obsoletes.length).length + 2;

    // Les DONNÉES À ACTUALISER passent AVANT les actions : ce sont les chiffres
    // périmés, le cœur d'une mise à jour de fraîcheur, et elles étaient les
    // premières sacrifiées puisqu'elles fermaient le prompt.
    const budget = () => MAX_INSTRUCTION_CHARS - bloc.join('\n').length - reserve;
    const rejetes = [];
    // `plafond` borne ce qu'UNE liste peut prendre, pour que les deux soient
    // représentées. Sans lui, la première servie mangeait tout : mesuré à
    // 1 391 caractères avec les 5 données obsolètes et UNE SEULE action sur 8.
    const empile = (entete, lignes, plafond) => {
      if (!lignes.length) return;
      const dispo = Math.min(plafond, budget());
      const fixe = (entete ? entete.length + 1 : 0) + 1;   // + la ligne vide de séparation
      const total = (forme) => fixe + lignes.reduce((n, o) => n + o[forme].length + 1, 0);
      // La forme se choisit pour la LISTE ENTIÈRE, pas ligne par ligne. En
      // décidant par ligne, les premières prenaient la forme longue et mangeaient
      // la place des suivantes : mesuré à DEUX actions complètes sur huit, quand
      // la forme courte en fait tenir six.
      const forme = total('long') <= dispo ? 'long' : 'court';
      const retenues = [];
      let cout = fixe;
      lignes.forEach((o) => {
        const l = o[forme];
        if (cout + l.length + 1 <= dispo) { retenues.push(l); cout += l.length + 1; }
        else rejetes.push(o);
      });
      if (retenues.length) bloc.push('', ...(entete ? [entete] : []), ...retenues);
    };

    // Moitié-moitié au départ, puis le reste va aux actions : les deux listes
    // comptent, et une place non consommée ne se perd pas.
    const moitie = Math.floor(budget() / 2);
    empile('Données à actualiser :', obsoletes, moitie);
    empile(null, actions, Infinity);
    // Deuxième tour : ce que le plafond de moitié avait écarté peut encore tenir.
    if (rejetes.length && budget() > 0) {
      const restants = rejetes.splice(0, rejetes.length);
      empile(null, restants, Infinity);
    }

    if (rejetes.length) bloc.push('', NOTE(rejetes.length));
  }

  return bloc.join('\n');
};
