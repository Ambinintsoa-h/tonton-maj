/**
 * agentBold.js — PASSE DE GRAS, fusionnée à la génération (phase 2).
 *
 * Décision d'Andrianina, 19 août 2026 : « une passe incontournable, très
 * importante », automatique à chaque génération.
 *
 * Pourquoi une passe séparée plutôt qu'une ligne de plus dans le prompt de
 * refonte — les deux tentatives précédentes, mesurées sur le même article :
 *   • CONSIGNE DANS LE PROMPT DE REFONTE : le modèle a posé 29 puis 33 passages,
 *     dont 19 puis 22 de purs chiffres, et 5 sections H2 sans aucun gras. Il sait
 *     faire, mais la consigne est une ligne parmi une quarantaine dans un prompt
 *     de 82 000 caractères : il priorise mal ;
 *   • POSE PAR LE CODE (R8) : « War III », « jeu God », « premiers God » — des
 *     moitiés de noms propres. Le code ne sait pas juger.
 *
 * Une passe, une tâche. C'est le même remède que les cases de l'audit : moins de
 * consignes concurrentes, meilleur arbitrage.
 *
 * NON BLOQUANTE. Un échec de cet appel ne doit JAMAIS perdre l'article qui vient
 * d'être généré — il a coûté un appel bien plus cher. En cas d'erreur on rend le
 * HTML d'entrée inchangé, et on le dit.
 */
import { callClaudeWithProgress, selectModel } from './agent';
import { parseJsonLoose } from './agentQat';
import {
  buildBoldPrompt, normalizeBoldProposals, boldPassReportLine, formeInattendue,
} from '../utils/boldPrompt';
import { splitSectionsForBold, applyBoldPassages } from '../utils/boldApply';

/**
 * PLAFOND DE SORTIE de la passe.
 *
 * Relevé de 4 000 à 16 000 le 19 août 2026, sur un échec MESURÉ en production. Les
 * trois appels de la journée :
 *   7 482 car. → 22 passages posés
 *   5 273 car. → posés
 *   9 419 car. → RÉPONSE ILLISIBLE, zéro posé
 * La plus longue est la seule qui a échoué, et le plafond de 4 000 tokens en était
 * proche : le JSON était coupé en plein tableau, donc impossible à parser. Tout
 * l'appel était perdu.
 *
 * Le retrait de la borne de longueur (demande d'Andrianina, le même jour) a créé
 * les conditions : des passages plus longs font un JSON plus gros. Le correctif
 * demandé a franchi un plafond laissé trop bas.
 *
 * Même défaut que la règle 11 du projet — l'audit calibré à 20 000 tokens sur
 * Sonnet 4.5, illisible sur Sonnet 5 dont le tokenizer compte ~30 % de plus, avec
 * 0,55 $ dépensés pour un JSON null. Le plafond doit avoir de la MARGE, pas être
 * ajusté au plus juste : on ne paie pas moins cher en tronquant, on paie pour rien.
 * 16 000 laisse de la place à un article de trente sections sans jamais s'en
 * approcher, et reste la moitié des 32 000 de l'audit.
 */
const MAX_TOKENS_GRAS = 16000;

const SYSTEME = 'Tu es experte SEO éditoriale. Tu désignes des passages à mettre en '
  + 'valeur dans un texte existant, sans jamais le réécrire. Tu réponds UNIQUEMENT '
  + 'par du JSON valide, sans aucun texte autour.';

/**
 * @param {{html:string, targetKeyword:string, secondaires?:string[],
 *          onStep?:function, onReplace?:function}} args
 * @returns {Promise<{html:string, posed:Array, ecartes:Array, echecs:Array,
 *                    sansGras:string[], report:string, tokenUsage:object|null}>}
 */
export const runBoldPass = async ({
  html = '',
  targetKeyword = '',
  secondaires = [],
  modelSelections = null, // choix de modèle par passe (settings.json) — null = défaut du registre
  onStep = () => {},
  onReplace = () => {},
} = {}) => {
  const inchange = {
    html, posed: [], ecartes: [], echecs: [], sansGras: [], report: '', tokenUsage: null,
  };

  // Sans mot-clé, la passe n'a aucun critère : on ne paie pas un appel pour rien.
  if (!html || !String(targetKeyword).trim()) return inchange;

  const sections = splitSectionsForBold(html);
  if (!sections.length) return inchange;

  const prompt = buildBoldPrompt(sections, targetKeyword, secondaires);
  if (!prompt) return inchange;

  onStep(`Mise en gras — ${sections.length} section(s) analysée(s)...`);

  // L'usage est renvoyé BRUT, jamais pré-agrégé : `makeTokenTracker().track()`
  // attend un objet `usage` de l'API (`input_tokens`…). Lui passer un accumulateur
  // ajouterait ZÉRO en silence, et le coût de cette passe disparaîtrait de la
  // facture affichée au rédacteur.
  let usage = null;
  let brut = null;
  // Déclaré HORS du try : le compte rendu d'échec en a besoin, et une variable
  // locale au bloc aurait rendu la fin de la réponse inaccessible là où elle sert.
  let texte = '';
  try {
    const res = await callClaudeWithProgress(
      null,
      { system: SYSTEME, messages: [{ role: 'user', content: prompt }], max_tokens: MAX_TOKENS_GRAS, model: selectModel('gras', modelSelections) },
      onStep, onReplace, 'Mise en gras',
    );
    usage = (res && res.usage) || null;
    texte = (res && res.text) || '';
    brut = parseJsonLoose(texte);
    // RÉPONSE BRUTE DANS LA CONSOLE, comme le prompt de génération. Sans elle, un
    // no-op est indiagnosticable : c'est exactement ce qui est arrivé le 19/08 —
    // 1 156 tokens de sortie consommés, rien posé, rien signalé, et aucun moyen de
    // savoir ce que le modèle avait répondu.
    try {
      /* eslint-disable no-console */
      console.groupCollapsed(`%c[TONTON] Passe de gras — réponse du modèle (${texte.length} car.)`, 'color:#6366f1;font-weight:bold');
      console.log(texte);
      console.groupEnd();
      /* eslint-enable no-console */
    } catch { /* la journalisation ne doit jamais empêcher la passe */ }
  } catch (e) {
    // On garde l'article. Perdre une génération payée pour un gras manquant serait
    // une très mauvaise affaire.
    onStep(`⚠️ Passe de gras en échec (${e.message}) — article conservé tel quel, gras à faire à la main.`);
    return inchange;
  }

  if (!brut) {
    // ON PERSISTE LE MOTIF ET LA FIN DE LA RÉPONSE. Sans ça, cet échec est
    // indiagnosticable : `onStep` disparaît avec la génération, et il ne restait
    // qu'un `grasPasse` vide — impossible de distinguer « réponse illisible » d'un
    // retour anticipé avant l'appel. La FIN du texte est ce qui compte : une
    // troncature par `max_tokens` se voit à ce qu'il s'arrête en plein milieu d'un
    // objet JSON, sans crochet fermant.
    const fin = texte.slice(-160);
    const report = `Passe de gras : réponse ILLISIBLE (${texte.length} car., `
      + `plafond ${MAX_TOKENS_GRAS} tokens) — article conservé tel quel. Fin reçue : « …${fin} »`;
    onStep(`⚠️ ${report}`);
    return { ...inchange, report, tokenUsage: usage };
  }

  // FORME INATTENDUE : la réponse a été lue mais ne porte aucune proposition. On le
  // DIT. Se taire ici a produit le pire résultat possible en production — un appel
  // payé, aucun effet, aucun message.
  if (formeInattendue(brut)) {
    const report = 'Passe de gras : réponse au format inattendu — aucun passage exploitable, gras à faire à la main.';
    onStep(`⚠️ ${report}`);
    return { ...inchange, report, tokenUsage: usage };
  }

  const { retenus, ecartes } = normalizeBoldProposals(brut, sections);
  if (!retenus.length) {
    // Toutes les propositions ont été refusées : on nomme les motifs, sinon le
    // rédacteur ne peut ni comprendre ni corriger.
    const report = boldPassReportLine({ retenus: [], ecartes })
      || `Passe de gras : ${ecartes.length} proposition(s), toutes écartées.`;
    onStep(`⚠️ ${report}`);
    return { ...inchange, ecartes, report, tokenUsage: usage };
  }

  const applique = applyBoldPassages(html, sections, retenus);
  const report = boldPassReportLine({
    retenus: applique.posed,
    ecartes: [...ecartes, ...applique.echecs],
    sansGras: applique.sansGras,
  });
  if (report) onStep(report);

  return {
    html: applique.html,
    posed: applique.posed,
    ecartes,
    echecs: applique.echecs,
    sansGras: applique.sansGras,
    report,
    tokenUsage: usage,
  };
};
