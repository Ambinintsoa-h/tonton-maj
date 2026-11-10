/**
 * apiBudget.js — « Combien reste-t-il sur l'API Anthropic ? »
 *
 * Calcul PUR, aucun appel réseau, aucune base : le serveur sert les recharges
 * saisies et les lignes brutes de `model_call_log`, ce module en tire le
 * restant, les statistiques de consommation et la décision d'alerter.
 *
 * ── POURQUOI UN CALCUL ET PAS UNE LECTURE ──────────────────────────────────
 * Anthropic n'expose AUCUN point d'entrée « solde restant ». Le seul chiffre
 * officiel proche est `GET /v1/organizations/cost_report`, qui exige une clé
 * Admin (`sk-ant-admin…`) que ce projet n'a pas — il ne détient qu'une clé
 * d'API ordinaire. Le restant est donc nécessairement une SOUSTRACTION :
 * ce qui a été chargé, moins ce que l'outil a mesuré.
 *
 * ── LA DATE DE DÉPART EST LA PREMIÈRE RECHARGE (décision Andrianina, 10/11/2026)
 * `model_call_log` porte des mois d'historique antérieur à la première
 * recharge. Tout décompter donnerait un restant négatif dès le premier
 * affichage. Ne décompter que « depuis la DERNIÈRE recharge » — formulation
 * spontanée du besoin — gonflerait au contraire le restant à chaque nouvelle
 * recharge, puisqu'on additionnerait tous les versements en n'en soustrayant
 * qu'une tranche de consommation. On additionne donc TOUTES les recharges et
 * on soustrait TOUT ce qui a été consommé depuis la PREMIÈRE : les deux termes
 * couvrent la même période, et le compte reste juste dans la durée.
 *
 * Contrepartie assumée, affichée sur la page et non masquée : un solde qui
 * existait AVANT la première recharge n'est pas compté. Le restant réel peut
 * donc être plus élevé que celui affiché — jamais plus bas, ce qui est le bon
 * sens de l'erreur pour une alerte de budget.
 *
 * ── LE CACHE EST FACTURÉ ICI, ET NULLE PART AILLEURS ───────────────────────
 * `calcCost` (agent.js) ne facture que input + output. Les tokens de cache
 * n'entrent dans aucun calcul, alors que le diagnostic laissé dans proxy.js
 * relève « cache_creation_input_tokens (9674) a chaque fois » sur des audits
 * réels : une écriture de cache facturée 1,25× et jamais relue. Sur un seul
 * audit c'est peu ; sur des centaines d'articles, c'est un écart qui ne cesse
 * de croître et que rien ne signale.
 *
 * Ce module corrige l'écart POUR LUI SEUL : `coutLigne` repart des tokens et
 * ajoute le cache. `calcCost`, `stats.total_cost_usd`, le Dashboard et
 * `model_call_log.cost_usd` gardent leur définition inchangée — la corriger
 * ferait bouger un chiffre affiché à toute l'équipe depuis des mois, dans une
 * PR dont ce n'est pas le sujet.
 *
 * ── CE QUE CE MODULE REFUSE DE FAIRE ───────────────────────────────────────
 * Traiter une donnée absente comme un zéro. Les lignes antérieures à la
 * migration n'ont pas de colonnes de cache : leur coût est repris tel quel et
 * elles sont COMPTÉES à part (`lignesSansCache`), pour que la page puisse dire
 * sur quelle part du total le cache n'a pas pu être facturé. Un 0 silencieux
 * ferait passer « on ne sait pas » pour « c'était gratuit ».
 *
 * ── POURQUOI DANS src/server/ ET PAS DANS src/utils/ ───────────────────
 * Les autres calculs purs du projet (`seoEffect.js`) vivent dans `src/utils/`
 * et sont en ESM, parce qu'ils n'ont qu'UN appelant : la page. Celui-ci en a
 * deux — la page ET le cron d'alerte, qui vit dans `proxy.js`, en CommonJS.
 *
 * Or Create React App compile TOUT `src/` comme un module ES : un fichier
 * CommonJS placé dans `src/utils/` n'est pas importable par une page (build en
 * échec, « does not contain a default export »), et un fichier ESM n'est pas
 * `require`-able par proxy.js. Les deux formes s'excluent dans le même fichier.
 *
 * L'alternative était un miroir, comme `linkFollowPolicy.js` — légitime là-bas,
 * où les deux côtés manipulent du DOM par des moyens différents (navigateur
 * contre jsdom) et n'ont aucun code commun possible. Ici il n'y a que de
 * l'arithmétique : deux copies d'une soustraction divergeraient tôt ou tard, et
 * ce jour-là la page afficherait un restant pendant que l'alerte en calculerait
 * un autre, sans que rien ne le signale.
 *
 * D'où ce choix : le module vit côté serveur, et la ROUTE calcule. La page ne
 * fait que rendre les nombres qu'on lui sert — elle ne peut donc pas en
 * afficher d'autres que ceux sur lesquels l'alerte se décide. Accessoirement,
 * la route n'a plus à envoyer au navigateur les milliers de lignes brutes de
 * `model_call_log`, mais c'est le bénéfice secondaire, pas la raison.
 */

// ── Seuil d'alerte ───────────────────────────────────────────────────────────
// Demande d'Andrianina, 10/11/2026 : « envoyer un email d'alerte quand le
// budget est inférieur à 50$ ». Un seul littéral pour la décision d'alerte, le
// texte du mail et l'affichage de la page — trois nombres qui divergeraient en
// silence seraient pires qu'un seul.
const SEUIL_ALERTE_USD = 50;

// Rappel hebdomadaire tant qu'on reste sous le seuil SANS recharge. Le cron
// passe toutes les 6 h : sans ce délai il enverrait le même mail quatre fois
// par jour, et une boîte qui se remplit finit filtrée — donc l'alerte finirait
// par ne plus être vue du tout, ce qu'elle est précisément censée empêcher.
const RAPPEL_ALERTE_MS = 7 * 24 * 60 * 60 * 1000;

const ALERTE_FRANCHISSEMENT = 'franchissement';
const ALERTE_RAPPEL = 'rappel';

// Multiplicateurs de facturation du cache, relatifs au prix d'entrée du modèle
// (barème Anthropic) : une écriture coûte 1,25× le prix d'entrée, une lecture
// 0,1×. Ils ne dépendent pas du modèle, seul le prix d'entrée en dépend.
const MULT_CACHE_ECRITURE = 1.25;
const MULT_CACHE_LECTURE = 0.1;

// Repli de tarif quand le modèle d'une ligne n'est pas dans la grille servie
// par le serveur (LiteLLM). Même repli que `calcCost` : Haiku, le moins cher —
// donc l'erreur se fait vers le bas, jamais vers une facture inventée.
const TARIF_REPLI = { input: 1.0, output: 5.0 };

/**
 * Tarif d'un modèle dans la grille. `model_call_log.model` porte parfois
 * l'identifiant daté renvoyé par l'API (« claude-sonnet-5-20250929 ») là où la
 * grille est indexée sur l'identifiant court : on retombe donc sur la clé la
 * plus longue dont le modèle est un préfixe. Sans ça, TOUTES les lignes
 * seraient facturées au repli Haiku et le budget serait faux d'un facteur 3.
 */
const tarifPour = (model, grille) => {
  const table = grille || {};
  if (!model) return table['claude-haiku-4-5'] || TARIF_REPLI;
  if (table[model]) return table[model];
  let trouve = null;
  for (const cle of Object.keys(table)) {
    if (model.startsWith(cle) && (!trouve || cle.length > trouve.length)) trouve = cle;
  }
  if (trouve) return table[trouve];
  return table['claude-haiku-4-5'] || TARIF_REPLI;
};

const nombre = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Coût d'UNE ligne de `model_call_log`, cache compris.
 *
 * Retourne { usd, cacheMesure } — `cacheMesure` à false quand la ligne est
 * antérieure à la migration (colonnes de cache NULL). Dans ce cas on reprend
 * `cost_usd` tel qu'il a été journalisé plutôt que de recalculer : recalculer
 * sur les tarifs d'AUJOURD'HUI une ligne facturée au tarif d'hier réécrirait
 * le passé, et un changement de grille LiteLLM ferait bouger un historique
 * censé être figé.
 */
const coutLigne = (ligne, grille) => {
  const aCache = ligne.cache_write_tokens != null || ligne.cache_read_tokens != null;
  if (!aCache) return { usd: nombre(ligne.cost_usd), cacheMesure: false };

  const p = tarifPour(ligne.model, grille);
  const entree = nombre(p.input);
  const usd =
    (nombre(ligne.input_tokens) / 1e6) * entree +
    (nombre(ligne.output_tokens) / 1e6) * nombre(p.output) +
    (nombre(ligne.cache_write_tokens) / 1e6) * entree * MULT_CACHE_ECRITURE +
    (nombre(ligne.cache_read_tokens) / 1e6) * entree * MULT_CACHE_LECTURE;
  return { usd, cacheMesure: true };
};

/**
 * Horodatage (ms) du DÉBUT du jour de la première recharge.
 *
 * Une recharge se saisit au jour près (`recharged_on` est une DATE) : prendre
 * minuit évite de perdre la consommation du matin si la recharge est faite
 * l'après-midi. L'erreur se fait donc vers « on décompte un peu trop », ce qui
 * est le bon sens pour une alerte.
 *
 * `new Date('2026-11-10')` serait interprété en UTC par la spec ; on découpe
 * la chaîne à la main pour construire une date LOCALE — sinon, à l'est de
 * Greenwich, le début de journée tomberait la veille au soir.
 */
const premiereRechargeMs = (recharges) => {
  const dates = (recharges || [])
    .map((r) => String(r.recharged_on || r.rechargedOn || '').slice(0, 10))
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort();
  if (!dates.length) return null;
  const [a, m, j] = dates[0].split('-').map(Number);
  return new Date(a, m - 1, j, 0, 0, 0, 0).getTime();
};

const jourDe = (ms) => {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/**
 * Le calcul complet du budget.
 *
 * @param {Array}  recharges — lignes api_recharges ({ amount_usd, recharged_on })
 * @param {Array}  appels    — lignes model_call_log
 * @param {Object} grille    — { 'claude-x': { input, output } }, tarifs USD/MTok
 * @returns {Object} voir le retour, chaque champ est affiché tel quel
 */
const calculerBudget = ({ recharges = [], appels = [], grille = {} } = {}) => {
  const totalRecharge = (recharges || []).reduce((s, r) => s + nombre(r.amount_usd ?? r.amountUsd), 0);
  const depuis = premiereRechargeMs(recharges);

  // Aucune recharge saisie : il n'y a pas de budget à suivre, et SURTOUT pas de
  // date de départ. Renvoyer 0 laisserait croire que le budget est épuisé et
  // déclencherait l'alerte dès la première passe du cron.
  if (depuis == null) {
    return {
      aucuneRecharge: true, totalRecharge: 0, consomme: 0, restant: null, depuis: null,
      parJour: [], parModele: [], parFlux: [],
      appelsComptes: 0, lignesSansCache: 0, coutSansCache: 0, articles: 0,
    };
  }

  const retenus = (appels || []).filter((l) => nombre(l.logged_at) >= depuis);

  let consomme = 0;
  let lignesSansCache = 0;
  let coutSansCache = 0;
  const parJour = new Map();
  const parModele = new Map();
  const parFlux = new Map();
  const articles = new Set();

  for (const l of retenus) {
    const { usd, cacheMesure } = coutLigne(l, grille);
    consomme += usd;
    if (!cacheMesure) { lignesSansCache += 1; coutSansCache += usd; }
    if (l.article_id) articles.add(l.article_id);

    const jour = jourDe(nombre(l.logged_at));
    parJour.set(jour, (parJour.get(jour) || 0) + usd);

    const m = l.model || 'inconnu';
    const vm = parModele.get(m) || { model: m, usd: 0, appels: 0, input: 0, output: 0 };
    vm.usd += usd; vm.appels += 1;
    vm.input += nombre(l.input_tokens); vm.output += nombre(l.output_tokens);
    parModele.set(m, vm);

    // Le « flux » est la sous-passe du registre IA (MODEL_PASSES) : audit_qat,
    // refonte, gras… C'est la granularité qui répond à « où part l'argent ? »,
    // là où le numéro de passe (1 à 4) mélange plusieurs modèles.
    const f = l.sub_pass || 'inconnu';
    const vf = parFlux.get(f) || { flux: f, usd: 0, appels: 0 };
    vf.usd += usd; vf.appels += 1;
    parFlux.set(f, vf);
  }

  return {
    aucuneRecharge: false,
    totalRecharge,
    consomme,
    restant: totalRecharge - consomme,
    depuis,
    appelsComptes: retenus.length,
    articles: articles.size,
    // Ce que le cache n'a pas pu facturer : la page le dit, elle ne le cache pas.
    lignesSansCache,
    coutSansCache,
    parJour: [...parJour.entries()].map(([jour, usd]) => ({ jour, usd })).sort((a, b) => a.jour.localeCompare(b.jour)),
    parModele: [...parModele.values()].sort((a, b) => b.usd - a.usd),
    parFlux: [...parFlux.values()].sort((a, b) => b.usd - a.usd),
  };
};

/**
 * Faut-il envoyer une alerte maintenant ?
 *
 * Deux déclenchements, décision Andrianina (10/11/2026) :
 *  — FRANCHISSEMENT : on vient de passer sous le seuil. Une seule fois.
 *  — RAPPEL : on y est resté une semaine sans qu'une recharge ne nous en sorte.
 *
 * Le réarmement ne se décide PAS sur une date mais sur la dernière alerte
 * comparée à la dernière recharge : une recharge qui repasse au-dessus du seuil
 * rend le franchissement suivant éligible, sans quoi un budget rechargé puis
 * re-épuisé n'alerterait plus jamais.
 *
 * Une tentative en ÉCHEC (`status` 'echec' ou 'smtp_absent') ne vaut pas
 * alerte : elle n'a prévenu personne. Elle ne doit donc pas bloquer la
 * tentative suivante — c'est exactement le piège du SMTP silencieux de ce
 * projet, où l'on se croit alerté sans l'être.
 *
 * @param {number} restant        — null quand aucune recharge n'est saisie
 * @param {Array}  alertes        — journal api_budget_alerts, plus récent d'abord
 * @param {number} derniereRechargeMs
 */
const decisionAlerte = ({
  restant, alertes = [], derniereRechargeMs = null, maintenant = Date.now(), seuil = SEUIL_ALERTE_USD,
} = {}) => {
  if (restant == null || !Number.isFinite(restant)) return { envoyer: false, motif: 'budget inconnu' };
  if (restant >= seuil) return { envoyer: false, motif: 'au-dessus du seuil' };

  const reussies = (alertes || [])
    .filter((a) => a.status === 'envoye')
    .sort((a, b) => nombre(b.sent_at) - nombre(a.sent_at));
  const derniere = reussies[0] || null;

  if (!derniere) return { envoyer: true, kind: ALERTE_FRANCHISSEMENT, motif: 'premier passage sous le seuil' };

  // Une recharge postérieure à la dernière alerte a réarmé le dispositif : si
  // on est de nouveau sous le seuil, c'est un NOUVEAU franchissement.
  if (derniereRechargeMs != null && nombre(derniereRechargeMs) > nombre(derniere.sent_at)) {
    return { envoyer: true, kind: ALERTE_FRANCHISSEMENT, motif: 'nouveau passage sous le seuil après recharge' };
  }

  if (maintenant - nombre(derniere.sent_at) >= RAPPEL_ALERTE_MS) {
    return { envoyer: true, kind: ALERTE_RAPPEL, motif: 'toujours sous le seuil une semaine après' };
  }

  return { envoyer: false, motif: 'déjà alerté, rappel pas encore dû' };
};

/**
 * Horodatage (ms) de la recharge la plus récente — sert au réarmement.
 * Minuit du jour de saisie, même raison que `premiereRechargeMs`.
 */
const derniereRechargeMs = (recharges) => {
  const dates = (recharges || [])
    .map((r) => String(r.recharged_on || r.rechargedOn || '').slice(0, 10))
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort();
  if (!dates.length) return null;
  const [a, m, j] = dates[dates.length - 1].split('-').map(Number);
  return new Date(a, m - 1, j, 0, 0, 0, 0).getTime();
};

/**
 * Rythme de consommation et projection d'épuisement.
 *
 * La moyenne porte sur les jours RÉELLEMENT écoulés depuis la première
 * recharge, pas sur le nombre de jours où l'outil a tourné : un week-end sans
 * MAJ fait partie du rythme, l'ignorer donnerait une projection trop pessimiste
 * et ferait paniquer pour rien.
 *
 * `jours` est null quand la moyenne est nulle — on ne divise pas par zéro et on
 * n'écrit pas « épuisé dans l'infini ».
 */
const projection = ({ consomme = 0, restant = null, depuis = null, maintenant = Date.now() } = {}) => {
  if (depuis == null) return { parJour: 0, jours: null };
  const joursEcoules = Math.max(1, Math.ceil((maintenant - depuis) / (24 * 60 * 60 * 1000)));
  const parJour = consomme / joursEcoules;
  if (!(parJour > 0) || restant == null) return { parJour, jours: null, joursEcoules };
  return { parJour, jours: Math.max(0, restant / parJour), joursEcoules };
};

module.exports = {
  SEUIL_ALERTE_USD,
  RAPPEL_ALERTE_MS,
  ALERTE_FRANCHISSEMENT,
  ALERTE_RAPPEL,
  MULT_CACHE_ECRITURE,
  MULT_CACHE_LECTURE,
  tarifPour,
  coutLigne,
  premiereRechargeMs,
  derniereRechargeMs,
  calculerBudget,
  decisionAlerte,
  projection,
};
