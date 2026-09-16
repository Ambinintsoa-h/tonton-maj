/**
 * agentAffiliate.js — MODE AFFILIATION : on met à jour les MOTS, rien d'autre.
 *
 * Décision Andrianina, 16 septembre 2026. Certains articles sont des
 * comparatifs bâtis autour de liens d'affiliation : sur
 * `cyber-securite.fr/meilleur-antivirus/`, 1 714 mots de prose pour 113 898
 * caractères de HTML, 32 liens externes, deux encarts comparatifs de 14 Ko, six
 * boutons « VOIR + » vers six URL différentes. La refonte normale y échoue par
 * construction — elle demande au modèle de RENVOYER l'article entier, donc de
 * recopier ces 113 Ko sans en altérer un caractère, et le verrou liens externes
 * rejette la génération au premier href manquant (règle 8).
 *
 * Ici, le modèle ne voit ni balise, ni href, ni encart. Il reçoit des blocs de
 * prose numérotés dont les liens sont masqués par des marqueurs — le TEXTE de
 * l'ancre reste lisible, pour qu'il comprenne encore la phrase — et il renvoie
 * du texte. C'est le code qui recolle (`src/utils/affiliateBlocks.js`).
 *
 * La garantie n'est donc pas une consigne adressée au modèle, c'est une
 * propriété du dispositif : il ne peut pas changer une URL qu'il n'a jamais vue.
 * Même partage des rôles que la passe de gras — « l'IA nomme, le code
 * applique » (règle 10).
 *
 * ── CE QUE CE MODE NE FAIT PAS, ET C'EST VOULU ──────────────────────────────
 * Aucune section ajoutée, aucune FAQ, aucun TL;DR, aucune restructuration, et
 * AUCUN lien interne ajouté (règle 9 suspendue sur ces articles — demande
 * explicite d'Andrianina). Mettre à jour le texte, c'est mettre à jour le
 * texte. Tout ajout de bloc rouvrirait la porte qu'on vient de fermer.
 */
import {
  callClaudeWithProgress, selectModel, getDateContext, calcCost, makeTokenTracker,
  buildSkillsBlock, buildKnowledgeBlock,
} from './agent';
import { parseJsonLoose } from './agentQat';
import { extraireBlocsProse, appliquerReecritures, MOTS_MIN_BLOC } from '../utils/affiliateBlocks';
import { MOTS_MAX_PHRASE } from '../utils/stylePatterns';

/**
 * Blocs envoyés par appel. Un comparatif dépasse rarement la trentaine de
 * paragraphes de prose ; au-delà on découpe, pour que `max_tokens` ne tronque
 * jamais la réponse — la panne d'audit du 17/08 a assez montré ce que coûte un
 * JSON coupé en deux (règle 11).
 */
const BLOCS_PAR_APPEL = 20;

const MARQUEURS_EXPLIQUES = `Certains passages sont encadrés par des marqueurs de la forme ⟦1⟧…⟦/1⟧.
Entre ces marqueurs se trouve le texte d'un lien ou d'une mise en forme que tu
ne dois PAS supprimer. Tu peux déplacer le groupe complet dans ta phrase, mais :
- chaque marqueur ouvrant et son fermant doivent être présents dans ta réponse,
  avec le MÊME numéro ;
- garde le texte entre les marqueurs tel quel (c'est un nom de produit ou de
  marque) — si tu le changes, le lien restera bon mais la formulation sera
  signalée au relecteur ;
- n'invente aucun nouveau marqueur.`;

/**
 * Réécrit UNIQUEMENT les textes de prose d'un article d'affiliation.
 * Même signature de retour que `runQatRewrite` : { article, articleRaw, tokenUsage }.
 */
export const runAffiliateRewrite = async ({
  contentHtml = '',
  content = '',
  audit = null,
  skills = [],
  knowledge = [],
  targetKeyword = '',
  instruction = '',
  modelPricing = null,
  modelSelections = null,
  onStep = () => {},
  onProgress = () => {},
}) => {
  const { acc: tokenAcc, track: trackCall } = makeTokenTracker();
  const sourceHtml = contentHtml || content;
  const { fr } = getDateContext();

  const extrait = extraireBlocsProse(sourceHtml);
  if (!extrait.blocs.length) {
    // Message ACTIONNABLE : dire « échec » sans dire pourquoi, c'est ce qu'on
    // vient de corriger ailleurs. Les trois compteurs disent où est passée la
    // matière.
    throw new Error(
      'Mode affiliation : aucun paragraphe de prose à mettre à jour dans cet article '
      + `(${extrait.ecartes.encart} bloc(s) dans un encart, ${extrait.ecartes.media} avec un média, `
      + `${extrait.ecartes.court} trop court(s) — moins de ${MOTS_MIN_BLOC} mots). `
      + "L'article est probablement composé uniquement de cartes comparatives : il n'y a rien à réécrire.",
    );
  }

  onStep(`Mode affiliation — ${extrait.blocs.length} bloc(s) de prose à mettre à jour (structure, images et liens intacts).`);
  onProgress(20);

  const contexteAudit = audit?.resume_executif
    ? `## CE QUE L'AUDIT A RELEVÉ\n${String(audit.resume_executif).slice(0, 1500)}`
    : '';

  const system = `Nous sommes le ${fr}. Tu es une rédactrice SEO senior.

Tu mets à jour les TEXTES d'un article de comparatif, sans toucher à sa
structure. Tu ne produis JAMAIS de HTML : ni balise, ni lien, ni attribut. Tu
renvoies du texte brut, et c'est un programme qui le replacera dans la page.

${MARQUEURS_EXPLIQUES}

## CONTRAINTES RÉDACTIONNELLES — NON NÉGOCIABLES
- AUCUNE phrase de plus de ${MOTS_MAX_PHRASE} mots. C'est un PLAFOND, pas une moyenne.
- Longueur de chaque bloc : proche de l'original (entre la moitié et le double).
  Tu mets à jour, tu ne développes pas.
- Aucun adverbe en -ment, aucun participe présent en tête de proposition,
  aucune voix passive avec agent, aucun tiret cadratin.
- N'annonce ni l'article ni son plan. Pas de méta-commentaire.
- N'invente AUCUN chiffre, prix, date ni classement. Si une donnée du texte
  d'origine te semble périmée et que rien ne permet de la corriger, reformule
  sans elle plutôt que d'en inventer une.

${buildSkillsBlock(
    skills,
    'Règles éditées par l\'équipe dans le menu SKILLS IA.',
    'RÈGLES D\'ÉQUIPE (menu SKILLS IA) — OBLIGATOIRES',
  )}${buildKnowledgeBlock(knowledge)}

## RÉPONSE
UN SEUL objet JSON, sans texte ni backticks autour :
{"reecritures":[{"id":1,"texte":"…"},{"id":2,"texte":"…"}]}
Un bloc que tu juges déjà à jour : ne le renvoie pas du tout. Ne renvoie jamais
un id qui ne t'a pas été soumis.`;

  const paquets = [];
  for (let i = 0; i < extrait.blocs.length; i += BLOCS_PAR_APPEL) {
    paquets.push(extrait.blocs.slice(i, i + BLOCS_PAR_APPEL));
  }

  const reecritures = [];
  let raw = '';
  for (let p = 0; p < paquets.length; p += 1) {
    const paquet = paquets[p];
    const user = `${targetKeyword ? `Mot-clé cible : « ${targetKeyword} ».\n\n` : ''}${contexteAudit}
${instruction ? `\n## CONSIGNE DE L'ÉQUIPE — PRIORITÉ HAUTE\n${String(instruction).slice(0, 1500)}\n` : ''}
## BLOCS À METTRE À JOUR (${paquet.length})
${paquet.map((b) => `[${b.id}] (${b.tag}) ${b.texte}`).join('\n\n')}

Renvoie maintenant le JSON des réécritures. Rien d'autre que le JSON.`;

    onStep(`Réécriture des textes${paquets.length > 1 ? ` (${p + 1}/${paquets.length})` : ''}...`);
    const res = await callClaudeWithProgress(
      null,
      {
        system,
        max_tokens: 16000,
        model: selectModel('refonte', modelSelections),
        thinking: { type: 'disabled' },
        messages: [{ role: 'user', content: user }],
      },
      onStep, () => {}, 'Mise à jour des textes',
    );
    if (res?.usage) trackCall(res.usage, 'affiliation');
    raw += res?.text || '';
    const parsed = parseJsonLoose(res?.text || '', { salvage: true });
    const liste = Array.isArray(parsed?.reecritures) ? parsed.reecritures : [];
    // NON BLOQUANT paquet par paquet : un lot illisible ne doit pas emporter les
    // autres. Le compte rendu dira combien de blocs sont restés inchangés.
    if (!liste.length) onStep(`⚠️ Aucun bloc exploitable renvoyé pour le lot ${p + 1}/${paquets.length} — ces paragraphes restent inchangés.`);
    reecritures.push(...liste);
    onProgress(20 + Math.round(((p + 1) / paquets.length) * 60));
  }

  if (!reecritures.length) {
    throw new Error("Mode affiliation : l'IA n'a renvoyé aucune réécriture exploitable. Relancez, ou vérifiez le skill actif dans le menu SKILLS IA.");
  }

  const applique = appliquerReecritures(sourceHtml, reecritures);
  onProgress(90);

  // ── LE COMPTE RENDU EST DIT, PAS SEULEMENT CALCULÉ ─────────────────────────
  onStep(`✅ ${applique.appliques} bloc(s) mis à jour sur ${extrait.blocs.length}.`);
  if (applique.rejetes.length) {
    onStep(`⚠️ ${applique.rejetes.length} bloc(s) NON appliqué(s) (texte d'origine conservé) — ${applique.rejetes.slice(0, 3).map((r) => r.motif).join(' · ')}${applique.rejetes.length > 3 ? '…' : ''}`);
  }
  if (applique.marqueursInventes) {
    onStep(`🧹 ${applique.marqueursInventes} repère(s) inventé(s) par l'IA retiré(s) du texte — les mots sont conservés.`);
  }
  if (applique.ancresModifiees.length) {
    onStep(`🔗 ${applique.ancresModifiees.length} texte(s) de lien reformulé(s) — le lien reste bon, la formulation est à relire.`);
  }

  return {
    article: {
      html: applique.html,
      affiliation: {
        blocsTotal: extrait.blocs.length,
        appliques: applique.appliques,
        rejetes: applique.rejetes,
        ancresModifiees: applique.ancresModifiees,
        marqueursInventes: applique.marqueursInventes,
        ecartes: extrait.ecartes,
      },
      // Champs attendus par l'éditeur et l'archivage : en mode affiliation, rien
      // de tout cela n'est produit — la structure n'est pas touchée. On les pose
      // VIDES plutôt qu'absents (la couche de persistance refuse `undefined`).
      ampleurAppliquee: 'affiliation',
      ancresPlacees: [], ancresRedigees: [], ancresManquantes: [], ancresBrief: [],
      strippedExternalLinks: [], restoredInternalLinks: [], missingInternalLinks: [],
      restoredImages: [], missingImages: [], restoredBold: [], missingBold: [],
      constatGras: null, constatFaq: null, grasPasse: null,
      phrasesLongues: [], suroptimisation: null, elisions: [],
    },
    articleRaw: raw,
    tokenUsage: { ...tokenAcc, costUsd: calcCost(tokenAcc.calls, modelPricing) },
  };
};
