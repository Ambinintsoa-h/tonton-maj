/**
 * styleFixes.js — propositions MÉCANIQUES pour la phase 4.
 *
 * Moitié « sûre » de la correction des patterns : les cas où le remplacement ne
 * demande aucune compréhension du sens, et peut donc être calculé ici, gratuitement
 * et instantanément. L'autre moitié — verbes interdits, participe présent, voix
 * passive, phrases trop longues — exige de comprendre la phrase et passera par un
 * appel IA.
 *
 * Règle que je m'impose : ne proposer QUE ce dont je suis sûr. Une substitution
 * aveugle qui casse la phrase est pire que pas de proposition du tout — la
 * rédactrice perdrait plus de temps à réparer qu'à écrire. En cas de doute, on
 * renvoie `null` et l'IA prend le relais.
 */

/** Anomalies dont la correction est calculable sans comprendre le sens. */
export const MECHANICAL_IDS = ['cadratins', 'adverbes'];

/**
 * Anomalies qui exigent de comprendre la phrase → proposition par l'IA.
 *
 * `coupees` (phrases amputées) ouvre la liste depuis le 18 août 2026 : c'est la
 * seule famille où le texte est ILLISIBLE, pas seulement fade. Restituer le mot
 * manquant demande de lire le contexte — donc l'IA, jamais un calcul. La consigne
 * qui l'accompagne (`stylePrompt.js`) lui interdit d'inventer : sans certitude,
 * elle renvoie la phrase à l'identique, ce que `normalizeStyleProposals` écarte
 * ensuite comme « rien à corriger ». Le doute ne produit donc aucune proposition,
 * au lieu d'en produire une fausse.
 */
export const AI_IDS = ['coupees', 'verbes', 'participes', 'passive', 'phrases', 'cliches', 'meta'];

const nettoie = (s) => String(s || '')
  .replace(/\s+([,.;:!?])/g, '$1')      // pas d'espace avant une ponctuation simple
  .replace(/\s{2,}/g, ' ')
  .replace(/,\s*,/g, ',')
  .replace(/\s+$/g, '')
  .trim();

/**
 * Remplace les tirets cadratins et demi-cadratins par une virgule.
 *
 * Le skill autorise « virgule, deux points, ou deux phrases » ; la virgule est le
 * seul choix qui marche dans tous les cas sans réécrire la phrase. Un tiret en
 * fin de segment est simplement supprimé, sinon on obtiendrait « … ,. »
 */
const corrigeCadratins = (extrait) => {
  const avant = String(extrait || '');
  if (!/[—–]/.test(avant)) return null;
  let apres = avant
    .replace(/\s*[—–]\s*([,.;:!?])/g, '$1')   // tiret collé à une ponctuation → il disparaît
    .replace(/\s*[—–]\s*$/g, '')              // tiret en fin de segment → supprimé
    .replace(/\s*[—–]\s*/g, ', ');
  apres = nettoie(apres);
  return apres && apres !== avant ? { avant, apres } : null;
};

/**
 * Supprime l'adverbe en -ment. « Le prix varie fortement selon la région. »
 * devient « Le prix varie selon la région. » — la phrase reste grammaticale, et
 * le skill demande justement d'éviter ces adverbes plutôt que de les remplacer.
 */
const corrigeAdverbe = (extrait, terme) => {
  const avant = String(extrait || '');
  const mot = String(terme || '').trim();
  if (!mot) return null;
  const re = new RegExp(`\\s*\\b${mot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
  if (!re.test(avant)) return null;
  const apres = nettoie(avant.replace(re, ''));
  return apres && apres !== avant ? { avant, apres } : null;
};

/**
 * Propose une correction mécanique pour une occurrence.
 *
 * @param {string} id       identifiant de la règle (voir stylePatterns)
 * @param {string} extrait  la phrase ou le paragraphe concerné
 * @param {string} terme    le mot fautif, quand la règle en désigne un
 * @returns {{avant:string, apres:string}|null} `null` = aucune correction sûre
 */
export const proposeMechanicalFix = (id, extrait, terme) => {
  if (!extrait) return null;
  if (id === 'cadratins') return corrigeCadratins(extrait);
  if (id === 'adverbes')  return corrigeAdverbe(extrait, terme);
  return null;   // tout le reste demande du sens → IA
};

/** Vrai si la règle relève de la correction mécanique. */
export const isMechanical = (id) => MECHANICAL_IDS.includes(id);
