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

const LIGNE = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();

/**
 * RÈGLES DE MISE EN GRAS — classées par IMPACT SEO/GEO DÉCROISSANT.
 *
 * Elles vivent dans le code et non dans un skill, pour la même raison que
 * `buildStyleFixPrompt` : ce n'est pas une préférence éditoriale mais le CONTRAT
 * de cette passe. Le skill « Style d'écriture » (règle 13) reste la source
 * éditoriale ; ce bloc est ce qui le rend exécutable.
 *
 * Pourquoi cet ordre, concrètement :
 *   1. LA RÉPONSE À LA REQUÊTE d'abord. C'est le passage qu'un moteur extrait en
 *      position zéro et qu'un moteur génératif cite. Aucun autre gras n'a ce
 *      rendement — et c'est précisément celui que le modèle n'a jamais posé.
 *   2. LE MOT-CLÉ ET SES VARIANTES : le signal de sujet. Une seule fois chacun.
 *   3. LES ENTITÉS du sujet (produits, versions, studios, normes) : elles
 *      alimentent la reconnaissance d'entités, donc l'association thématique.
 *   4. LES CHIFFRES DÉCISIFS en DERNIER — utiles et très citables, mais c'est la
 *      catégorie que le modèle sur-produit spontanément (19 sur 29, puis 26 sur 42).
 *
 * AUCUN PLAFOND n'est imposé au modèle depuis le 19/08 : il juge le nombre d'après
 * la longueur et la densité de la section. Le code ne borne que ce qui ne demande
 * aucun jugement (doublons, longueur d'un passage, emplacements) et MESURE le reste.
 *
 * Et la contrainte de RÉPARTITION est traitée comme une règle à part entière :
 * un article est découpé en fragments par les moteurs génératifs. Une section
 * sans gras est un fragment sans signal.
 */
const REGLES = (kw, secondaires) => [
  `## Mot-clé principal : « ${kw} »`,
  secondaires.length ? `Mots-clés secondaires : ${secondaires.map((s) => `« ${s} »`).join(', ')}.` : '',
  '',
  'Choisis les passages à mettre en gras, par ORDRE D\'IMPORTANCE DÉCROISSANTE :',
  '',
  '1. LA RÉPONSE À LA REQUÊTE. Le fragment de phrase qui répond directement à la',
  '   question posée par le mot-clé. C\'est le passage qu\'un moteur reprend en',
  '   position zéro et qu\'une IA cite. Le plus rentable de tous : ne le manque pas.',
  `2. LE MOT-CLÉ PRINCIPAL, sa première occurrence utile dans le corps, et ses`,
  '   VARIANTES proches (reformulations, synonymes, pluriel). Une seule fois chacune.',
  '3. LES MOTS-CLÉS SECONDAIRES, là où ils apparaissent naturellement.',
  '4. LES ENTITÉS centrales du sujet : noms de produits, de versions, de studios,',
  '   de normes, de lieux. Elles portent la reconnaissance d\'entités.',
  '5. LE VOCABULAIRE TECHNIQUE propre au sujet.',
  '6. LES CHIFFRES DÉCISIFS avec leur unité (prix, notes, dates, durées) —',
  '   EN DERNIER. Ils sont citables, mais tu en mets spontanément trop : ils ne',
  '   doivent JAMAIS dépasser la MOITIÉ des passages d\'une section.',
  '',
  '## Répartition — une règle, pas un détail',
  `CHAQUE section H2 doit porter AU MOINS ${GRAS_MIN_PAR_H2} passages. Pas une seule`,
  'section vide : les moteurs génératifs découpent l\'article en fragments, et un',
  'fragment sans gras est un fragment sans signal. Traite les sections une par une.',
  '',
  // PLAFOND SUPPRIMÉ le 19 août 2026, sur objection d'Andrianina : « le modèle peut
  // juger par lui-même, il comprend le mot-clé et le contenu de l'article ». Les
  // données lui donnaient raison. Sur la section à 11 passages, le défaut n'était
  // pas le nombre mais la COMPOSITION : 6 chiffres sur 11. Les cinq autres —
  // studios, nom du jeu, genre technique — étaient exactement ce qu'on veut, et un
  // plafond à 4 aurait coupé dans le bon, au hasard de l'ordre d'arrivée.
  // Un nombre fixe ignore aussi la longueur : 3 passages sur 107 mots et 3 sur 231
  // ne sont pas la même densité, et l'ancien plafond traitait les deux à l'identique.
  'AUCUN PLAFOND IMPOSÉ. Tu juges combien une section en mérite, d\'après sa longueur',
  'et sa densité d\'information : une section de 230 mots riche en entités en porte',
  'légitimement plus qu\'une section de 60 mots. Garde le sens de la mesure — du gras',
  'partout ne met plus rien en avant.',
  '',
  '## Interdits',
  `- JAMAIS plus de ${GRAS_MAX_MOTS} mots par passage, JAMAIS une phrase entière.`,
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
    '[{ "section": 1, "passage": "copie exacte" }]',
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
 *   • `trop-long` — au-delà de GRAS_MAX_MOTS, ce n'est plus une mise en avant ;
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
export const normalizeBoldProposals = (brut, sections = []) => {
  const items = Array.isArray(brut) ? brut : (brut && Array.isArray(brut.passages) ? brut.passages : []);
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
    if (passage.split(' ').length > GRAS_MAX_MOTS) { ecartes.push({ passage, motif: 'trop-long' }); return; }

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
