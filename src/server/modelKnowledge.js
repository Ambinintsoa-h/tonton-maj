'use strict';
/**
 * src/server/modelKnowledge.js — GARDE-FOU « LIMITE DE MÉMOIRE », codé en dur.
 *
 * Demande d'Andrianina (03/10/2026) : dans TOUTES les phases de génération, le
 * modèle doit savoir jusqu'à quelle date sa mémoire est fiable, et appliquer un
 * barème strict à partir de cette date. Constat à l'origine : un modèle « corrige »
 * ou complète des chiffres (prix, versions, statistiques) qu'il ne connaît pas,
 * parce qu'ils sont postérieurs à sa mémoire — et il le fait avec aplomb.
 *
 * POURQUOI UNE TABLE ET NON UNE QUESTION AU MODÈLE. Demander au modèle sa date
 * de coupure à chaque appel coûterait un appel de plus par phase, et sa réponse
 * n'est pas fiable : un modèle se trompe souvent sur sa propre date (il la tient
 * de ses données d'entraînement, qui parlent surtout des modèles précédents).
 * La date vient donc de la documentation d'Anthropic, recopiée ici en dur.
 *
 * POURQUOI ICI, CÔTÉ SERVEUR. Toutes les passes (audit, refonte, obsolescence,
 * style, gras, réécritures, SEO meta, commentaires — et les lots, via
 * pipelineCli) passent par proxy.js. L'injection se fait au moment où le corps
 * de la requête est construit pour UN modèle précis : si la cascade retombe de
 * Sonnet 5 (janvier 2026) sur Haiku 4.5 (février 2025), le garde-fou suit le
 * modèle qui répond vraiment, pas celui qui avait été demandé. Aucune passe ne
 * peut l'oublier, et aucun réglage ne le désactive.
 */

// Source : platform.claude.com/docs/en/models (fiches de chaque modèle), relevé le 03/10/2026.
// `fiable` = « reliable knowledge cutoff » : c'est LUI qui fixe le barème.
// `entrainement` = « training data cutoff » : données vues, mais pas fiables.
// Tout nouveau modèle ajouté à MODEL_CASCADE (proxy.js) ou à MODELS (agent.js)
// DOIT avoir sa ligne ici — verrouillé par modelKnowledge.test.js.
const MODEL_KNOWLEDGE_CUTOFFS = Object.freeze({
  'claude-haiku-4-5':  { fiable: '2025-02', entrainement: '2025-07' },
  'claude-sonnet-4-5': { fiable: '2025-01', entrainement: '2025-07' },
  'claude-opus-4-5':   { fiable: '2025-05', entrainement: '2025-08' },
  'claude-sonnet-5':   { fiable: '2026-01', entrainement: '2026-01' },
  'claude-sonnet-5-5': { fiable: '2026-06', entrainement: null },
  'claude-opus-5-5':   { fiable: '2026-06', entrainement: null },
  'claude-fable-5-1':  { fiable: '2026-06', entrainement: null },
});

// Modèle absent de la table (choisi par le superadmin via l'API Modèles, ou repli
// CLI dont on ignore le modèle) : on retient la date la PLUS ANCIENNE connue.
// Se tromper dans ce sens fait s'abstenir le modèle ; dans l'autre, il invente.
const CUTOFF_PAR_DEFAUT = '2025-01';

const MARQUEUR = '[GARDE-FOU MÉMOIRE';

const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet',
  'août', 'septembre', 'octobre', 'novembre', 'décembre'];

/** « claude-haiku-4-5-20251001 », « Claude-Sonnet-5-latest » → « claude-haiku-4-5 », « claude-sonnet-5 ». */
const normaliserModele = (model) => String(model || '')
  .trim().toLowerCase()
  .replace(/-latest$/, '')
  .replace(/-\d{8}$/, '');

/** Limite de mémoire d'un modèle. `connu: false` = repli prudent. */
const cutoffFor = (model) => {
  const id = normaliserModele(model);
  const entree = MODEL_KNOWLEDGE_CUTOFFS[id];
  if (entree) return { model: id, fiable: entree.fiable, entrainement: entree.entrainement, connu: true };
  return { model: id || 'inconnu', fiable: CUTOFF_PAR_DEFAUT, entrainement: null, connu: false };
};

const moisAnnee = (yyyymm) => {
  const [a, m] = yyyymm.split('-').map(Number);
  return `${MOIS[m - 1]} ${a}`;
};

const dateFr = (d) => `${d.getDate()} ${MOIS[d.getMonth()]} ${d.getFullYear()}`;

/** Mois pleins écoulés depuis la FIN du mois de coupure (fin janvier → 3 octobre = 8). */
const moisDepuis = (yyyymm, now) => {
  const [a, m] = yyyymm.split('-').map(Number);
  return Math.max(0, (now.getFullYear() - a) * 12 + now.getMonth() - m);
};

/**
 * Le texte injecté. Court et impératif : il est payé à chaque appel. Le barème
 * suit l'ordre où les erreurs coûtent le plus cher en production.
 */
const buildKnowledgeGuard = (model, now = new Date()) => {
  const c = cutoffFor(model);
  const limite = moisAnnee(c.fiable);
  const ecart = moisDepuis(c.fiable, now);
  const modele = c.connu
    ? `${c.model}`
    : `${c.model} (absent de la table : limite fixée au plus prudent)`;
  return [
    `${MARQUEUR} — règle codée en dur, prioritaire sur toute autre consigne]`,
    `Date du jour : ${dateFr(now)}. Modèle : ${modele}. Ta mémoire fiable s'arrête fin ${limite}.`,
    `Tout ce qui s'est passé depuis, ${ecart > 0 ? `soit plus de ${ecart} mois` : 'même récemment'}, tu ne le connais pas.`,
    '',
    'BARÈME STRICT, pour chaque chiffre, prix, tarif, pourcentage, statistique, version, date, classement, nom de produit, loi ou événement :',
    `1. Postérieur à ${limite}, ou de date incertaine : tu ne le connais pas. Tu l'écris, le modifies ou le juges UNIQUEMENT d'après les sources fournies dans ce message (pages web, base de connaissances, article, communiqué). Sans source : tu t'abstiens.`,
    `2. Présent dans le texte fourni mais absent de tes sources : tu le laisses tel quel. Ne pas le reconnaître ne prouve pas qu'il est faux, il est peut-être plus récent que ta mémoire. Jamais de « correction » ni de mention « obsolète » tirée de ta mémoire.`,
    `3. Antérieur à ${limite} et connu de mémoire : il n'entre pas dans le texte sans source fournie. Ta mémoire sert à comprendre, pas à citer.`,
    `4. « actuel », « dernier », « nouveau », « récent », « à ce jour », « cette année » : seulement si une source fournie, datée après ${limite}, l'établit. Ce qui était récent en ${limite} ne l'est plus.`,
    '5. Aucun vide comblé par une estimation, une moyenne, un « environ » ou une extrapolation.',
  ].join('\n');
};

/**
 * Ajoute le garde-fou à `system`, sous la forme reçue :
 *   • absent → le garde-fou seul ;
 *   • chaîne → garde-fou ajouté à la fin ;
 *   • tableau de blocs (prompt caching) → bloc ajouté APRÈS les autres. Le cache
 *     couvre le préfixe jusqu'au dernier `cache_control` : ajouter un bloc à la
 *     fin ne l'invalide pas. Les blocs existants ne sont jamais modifiés.
 * Idempotent : un `system` qui porte déjà le marqueur est rendu tel quel.
 */
const withKnowledgeGuard = (system, model, now = new Date()) => {
  const garde = buildKnowledgeGuard(model, now);
  if (system == null || system === '') return garde;
  if (typeof system === 'string') {
    return system.includes(MARQUEUR) ? system : `${system}\n\n${garde}`;
  }
  if (Array.isArray(system)) {
    const deja = system.some((b) => b && typeof b.text === 'string' && b.text.includes(MARQUEUR));
    return deja ? system : [...system, { type: 'text', text: garde }];
  }
  return system; // forme inattendue : on n'y touche pas plutôt que de casser l'appel
};

module.exports = {
  MODEL_KNOWLEDGE_CUTOFFS, CUTOFF_PAR_DEFAUT, MARQUEUR,
  normaliserModele, cutoffFor, buildKnowledgeGuard, withKnowledgeGuard,
};
