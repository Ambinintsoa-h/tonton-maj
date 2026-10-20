/**
 * boldPrompt.js — PASSE DÉDIÉE DE MISE EN GRAS (fusionnée à la génération).
 *
 * Décision d'Andrianina, 19 août 2026, après deux constats mesurés sur le même
 * article :
 *   • le MODÈLE sait mettre en gras — il en a posé 29 puis 33 — mais il priorise
 *     mal : la consigne de gras est une ligne parmi une quarantaine, dans un
 *     prompt de 82 000 caractères. Résultat : 19 puis 22 de purs chiffres, et
 *     5 sections H2 sans aucun gras ;
 *   • le CODE, lui, ne sait pas juger. La pose déterministe (R8) a produit
 *     « War III », « jeu God », « premiers God » — des moitiés de noms propres.
 *
 * D'où cette passe : UNE tâche, UN seul objectif. C'est le même remède que les
 * cases de l'audit — moins de consignes concurrentes, meilleur arbitrage.
 *
 * ── LE PARTAGE DES RÔLES, QUI EST TOUT LE DISPOSITIF ────────────────────────
 * L'IA NOMME, LE CODE APPLIQUE.
 *   • l'IA renvoie une liste de passages, en TEXTE NU. Elle ne produit aucun HTML,
 *     ne réécrit aucune phrase, ne déplace rien ;
 *   • le code vérifie que chaque passage figure MOT POUR MOT dans l'article, puis
 *     l'enveloppe, et applique les bornes.
 *
 * Sans ce partage, le modèle renvoie du HTML et réécrit des phrases au passage —
 * c'est arrivé en phase 4, d'où les mêmes garde-fous ici (`PORTE_BALISAGE`,
 * rejet de tout passage introuvable). Le jugement vient du modèle, les bornes
 * viennent du code : ni l'un ni l'autre seul n'y arrive.
 */
import { GRAS_MIN_PAR_H2, GRAS_MAX_MOTS } from './boldCarry';

/**
 * PLUS DE « RÉPONSE À LA REQUÊTE » EN GRAS — décision Andrianina, 20 octobre 2026 :
 * « on ne met plus une phrase complète en gras, seulement les mots-clés
 * principaux, les mots-clés secondaires, les mots ou groupes de mots importants ».
 *
 * Le type « reponse » (jusqu'à 12 mots, priorité 1 depuis le 19 août) produisait
 * exactement ce que l'équipe ne veut plus voir : des morceaux de phrase entiers en
 * gras. Il disparaît, et la borne de longueur revient en code : GRAS_MAX_MOTS (4),
 * la même que le skill « Style d'écriture » (« groupes de 1 à 4 mots »). Au-delà,
 * le passage est REFUSÉ (`trop-long`), quel que soit son type.
 */
const TYPES_GRAS = ['motcle', 'secondaire', 'important'];

const LIGNE = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();

/**
 * RÈGLES DE MISE EN GRAS — trois familles, par ordre d'importance.
 *
 * Elles vivent dans le code et non dans un skill, pour la même raison que
 * `buildStyleFixPrompt` : ce n'est pas une préférence éditoriale mais le CONTRAT
 * de cette passe. Le skill « Style d'écriture » (règle 13) reste la source
 * éditoriale ; ce bloc est ce qui le rend exécutable.
 *
 * La contrainte de RÉPARTITION reste une règle à part entière : un article est
 * découpé en fragments par les moteurs génératifs, et une section sans gras est un
 * fragment sans signal.
 */
const REGLES = (kw, secondaires) => [
  `## Mot-clé principal : « ${kw} »`,
  secondaires.length ? `Mots-clés secondaires : ${secondaires.map((s) => `« ${s} »`).join(', ')}.` : '',
  '',
  'Mets en gras UNIQUEMENT des mots ou de courts groupes de mots, jamais une phrase.',
  'Trois familles, par ordre d\'importance :',
  '',
  '1. LE MOT-CLÉ PRINCIPAL, à sa première occurrence utile dans le corps, et ses',
  '   VARIANTES proches (pluriel, synonyme, reformulation courte). Une fois chacune.',
  '   "type": "motcle".',
  '2. LES MOTS-CLÉS SECONDAIRES, là où ils apparaissent naturellement.',
  '   "type": "secondaire".',
  '3. LES MOTS OU GROUPES DE MOTS IMPORTANTS du sujet : noms de produits, de marques,',
  '   de normes, de lieux, vocabulaire technique, et chiffres décisifs avec leur unité',
  '   (les chiffres jamais plus de la MOITIÉ des passages d\'une section).',
  '   "type": "important".',
  '',
  '## Longueur — une borne, plus une visée',
  `De 1 à ${GRAS_MAX_MOTS} mots par passage, pas un de plus : au-delà, le code REFUSE le passage.`,
  'Jamais une phrase entière, jamais un morceau de phrase avec son verbe (« le',
  'modèle coûte 299 € »), jamais une proposition complète : seulement le terme',
  '(« 299 € », « pompe à chaleur air-eau », « RE2020 »).',
  '',
  '## Répartition — une règle, pas un détail',
  `CHAQUE section H2 doit porter AU MOINS ${GRAS_MIN_PAR_H2} passages. Pas une seule`,
  'section vide : les moteurs génératifs découpent l\'article en fragments, et un',
  'fragment sans gras est un fragment sans signal. Traite les sections une par une.',
  'Garde le sens de la mesure : du gras partout ne met plus rien en avant.',
  '',
  '## Interdits',
  '- JAMAIS une phrase ni une proposition : le gras désigne un terme, il ne',
  '  remplace pas le corps du texte.',
  '- JAMAIS un titre (H1-H6), JAMAIS le texte d\'un lien, JAMAIS la FAQ ni le TL;DR.',
  '- JAMAIS deux fois le même terme dans tout l\'article.',
  '- JAMAIS un mot seul coupé d\'un nom propre : « God of War » entier, pas « War ».',
].filter((l) => l !== '').join('\n');

/**
 * Construit le prompt. L'article est fourni SECTION PAR SECTION, avec son titre :
 * c'est ce découpage qui rend la contrainte de répartition applicable — demander
 * « au moins 2 par section » sur un mur de texte revient à ne rien demander.
 *
 * @param {Array<{titre:string, texte:string}>} sections
 * @param {string} targetKeyword
 * @param {string[]} secondaires
 */
export const buildBoldPrompt = (sections = [], targetKeyword = '', secondaires = []) => {
  const liste = (Array.isArray(sections) ? sections : []).filter((s) => s && s.texte);
  if (!liste.length || !LIGNE(targetKeyword)) return '';

  const corps = liste.map((s, i) => `### SECTION ${i + 1} — ${s.titre || '(sans titre)'}\n${s.texte}`);

  return [
    'Tu choisis les mots à mettre en GRAS dans un article web déjà rédigé.',
    'Tu ne réécris RIEN. Tu ne fais que DÉSIGNER des passages existants.',
    '',
    REGLES(LIGNE(targetKeyword), (secondaires || []).map(LIGNE).filter(Boolean)),
    '',
    '## Article, section par section',
    ...corps,
    '',
    'Réponds UNIQUEMENT par un tableau JSON, sans texte autour. Chaque passage doit',
    'être une COPIE EXACTE, au caractère près, d\'un extrait de la section indiquée :',
    `[{ "section": 1, "passage": "copie exacte", "type": "${TYPES_GRAS.join('|')}" }]`,
  ].join('\n');
};

/** Tout balisage : un passage est du TEXTE NU, jamais du HTML. */
const PORTE_BALISAGE = /<|>|href\s*=|&[a-z]+;/i;

/**
 * Valide les propositions du modèle contre les sections RÉELLES.
 *
 * Écarte, et chaque motif a sa raison :
 *   • `introuvable` — le passage n'est pas dans la section citée. C'est le cas le
 *     plus fréquent (le modèle paraphrase sans s'en rendre compte) et le plus
 *     dangereux : appliquer un passage approximatif déplacerait le gras ailleurs ;
 *   • `balisage` — le modèle a renvoyé du HTML malgré la consigne. L'appliquer
 *     injecterait des balises dans le texte ;
 *   • `trop-long` — plus de GRAS_MAX_MOTS (4) mots. Supprimé le 19/08, RÉTABLI le
 *     20/10/2026 (décision Andrianina : plus de phrase en gras, seulement des
 *     mots-clés et des groupes de mots), pour tous les types sans exception ;
 *   • `phrase-entiere` — un passage terminé par un point ou qui enjambe deux
 *     phrases : il constate une nature, même sous 4 mots (« Prix en baisse. ») ;
 *   • `doublon` — le même terme deux fois. Le modèle l'a fait en production
 *     (`Valhalla` deux fois dans la MÊME section) : il comprend l'article et se
 *     répète quand même. Aucun jugement n'est requis pour le refuser, donc c'est
 *     au code de le faire.
 *
 * PLUS DE PLAFOND PAR SECTION. Retiré le 19 août 2026 : compter à la place du
 * modèle coupait dans le bon au hasard de l'ordre d'arrivée. Le code ne borne plus
 * le NOMBRE, il MESURE la composition (part de chiffres) et la montre au rédacteur.
 *
 * @returns {{ retenus: Array<{section:number, passage:string}>,
 *             ecartes: Array<{passage:string, motif:string}> }}
 */
/**
 * Extrait la liste de propositions, quelle que soit la FORME rendue.
 *
 * Corrigé le 19 août 2026 après un no-op SILENCIEUX en production : la passe a
 * consommé ~1 156 tokens de sortie, et RIEN n'a été posé ni signalé. Cause : la
 * réponse n'était ni un tableau nu ni `{ passages: [...] }`, les deux seules
 * formes acceptées — donc `items` valait `[]`, donc `retenus` ET `ecartes` étaient
 * vides, donc `boldPassReportLine` rendait une chaîne vide. Aucun message, aucun
 * effet, un appel payé : le pire des trois résultats possibles.
 *
 * On accepte donc TOUT tableau d'objets trouvé à la racine, quel que soit le nom
 * de la clé — le modèle rend « resultats », « items », « gras » selon l'humeur.
 * Et si rien n'est trouvé, l'appelant le DIT (voir `formeInattendue`).
 */
const extraireItems = (brut) => {
  if (Array.isArray(brut)) return brut;
  if (!brut || typeof brut !== 'object') return [];
  // Une clé explicite d'abord, pour rester prévisible.
  for (const cle of ['passages', 'items', 'resultats', 'gras', 'bold', 'data']) {
    if (Array.isArray(brut[cle])) return brut[cle];
  }
  // Sinon, le premier tableau d'objets rencontré.
  const trouve = Object.values(brut).find(
    (v) => Array.isArray(v) && v.length && typeof v[0] === 'object',
  );
  return trouve || [];
};

/** La réponse a été lue mais ne contient AUCUNE proposition exploitable. */
export const formeInattendue = (brut) => !!brut && extraireItems(brut).length === 0;

export const normalizeBoldProposals = (brut, sections = []) => {
  const items = extraireItems(brut);
  const retenus = [];
  const ecartes = [];
  const vus = new Set();
  const parSection = new Map();

  items.forEach((it) => {
    if (!it) return;
    const passage = LIGNE(it.passage);
    const idx = Number(it.section);
    if (!passage) return;

    const sec = sections[idx - 1];
    if (!sec) { ecartes.push({ passage, motif: 'section-inconnue' }); return; }
    if (PORTE_BALISAGE.test(passage)) { ecartes.push({ passage, motif: 'balisage' }); return; }
    // LA BORNE DE LONGUEUR REVIENT — décision d'Andrianina, 20 octobre 2026 : « on
    // ne met plus une phrase complète en gras ». Historique : retirée le 19 août
    // (« enlève le trop-long, on va observer le résultat »), parce qu'elle refusait
    // toutes les « réponses à la requête » de 12 mots. Observé depuis : ces
    // réponses sont précisément les phrases en gras que l'équipe corrige à la main.
    // Le type « reponse » est supprimé (voir TYPES_GRAS) et la borne s'applique à
    // TOUT passage, sans exception par type.
    if (passage.split(/\s+/).length > GRAS_MAX_MOTS) {
      ecartes.push({ passage, motif: 'trop-long' });
      return;
    }
    // Deux formes, une seule nature : le passage porte une phrase complète.
    //   • il se TERMINE par un point : « Trois approches existent. » ;
    //   • il ENJAMBE une frontière de phrase : « …existent. L'ordre de sortie… ».
    // Aucun jugement requis : la ponctuation constate, elle ne mesure pas.
    if (/[.!?]\s*$/.test(passage) || /[.!?]\s+\p{Lu}/u.test(passage)) {
      ecartes.push({ passage, motif: 'phrase-entiere' });
      return;
    }

    const cle = passage.toLowerCase();
    if (vus.has(cle)) { ecartes.push({ passage, motif: 'doublon' }); return; }

    // MOT POUR MOT dans la section citée. Aucune tolérance : un appariement
    // approximatif poserait le gras sur d'autres mots que ceux choisis.
    if (!String(sec.texte || '').includes(passage)) {
      ecartes.push({ passage, motif: 'introuvable' });
      return;
    }

    vus.add(cle);
    parSection.set(idx, (parSection.get(idx) || 0) + 1);
    retenus.push({ section: idx, passage });
  });

  return { retenus, ecartes };
};


/** Ligne remontée au rédacteur : ce qui a été posé, et ce qui a été refusé. */
export const boldPassReportLine = ({ retenus = [], ecartes = [], sansGras = [] } = {}) => {
  const bouts = [];
  if (retenus.length) bouts.push(`${retenus.length} passage(s) mis en gras`);
  if (ecartes.length) {
    const motifs = [...new Set(ecartes.map((e) => e.motif))].join(', ');
    bouts.push(`${ecartes.length} proposition(s) écartée(s) (${motifs})`);
  }
  if (sansGras.length) {
    bouts.push(`${sansGras.length} section(s) encore sans gras : ${sansGras.slice(0, 2).join(', ')}${sansGras.length > 2 ? '…' : ''}`);
  }
  return bouts.length ? `🅱️ Gras : ${bouts.join(' — ')}.` : '';
};
