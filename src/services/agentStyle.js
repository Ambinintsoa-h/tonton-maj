/**
 * agentStyle.js — corrections de style proposées par l'IA (PHASE 4).
 *
 * Seconde moitié de l'option C. `utils/styleFixes.js` corrige ce qui est
 * calculable (tirets, adverbes) ; ici on traite ce qui demande de comprendre la
 * phrase : verbes interdits, participe présent, voix passive, phrases trop
 * longues, clichés, méta-commentaires.
 *
 * UN SEUL appel pour tout l'article. Envoyer 79 occurrences une par une coûterait
 * 79 appels pour un résultat moins cohérent.
 *
 * Déclenché par un BOUTON, jamais à l'ouverture de la phase : sans ça, chaque
 * passage en relecture déclencherait un appel payant, y compris quand la
 * rédactrice ne fait que relire.
 */
import { callClaudeWithProgress, makeTokenTracker, selectModel } from './agent';
import { parseJsonLoose } from './agentQat';
import {
  flattenAiOccurrences, buildStyleFixPrompt, normalizeStyleProposals,
} from '../utils/stylePrompt';

const SYSTEME = 'Tu es correctrice de style pour un média francophone. '
  + 'Tu réponds UNIQUEMENT par du JSON valide, sans aucun texte autour.';

/**
 * @param {Array}    findings  anomalies renvoyées par detectStylePatterns
 * @returns {Promise<{ proposals:Array, occurrences:Array, tokenUsage:object|null }>}
 */
export const runStyleFixAgent = async ({
  findings = [],
  modelSelections = null, // choix de modèle par passe (settings.json) — null = défaut du registre
  onStep = () => {},
  onReplace = () => {},
} = {}) => {
  const occurrences = flattenAiOccurrences(findings);
  // Rien qui relève de l'IA : on ne paie pas un appel pour rien.
  if (!occurrences.length) return { proposals: [], occurrences: [], tokenUsage: null };

  const { acc, track } = makeTokenTracker();
  onStep(`Corrections de style — ${occurrences.length} passage(s) à réécrire...`);

  const res = await callClaudeWithProgress(
    null,
    {
      system: SYSTEME,
      messages: [{ role: 'user', content: buildStyleFixPrompt(occurrences) }],
      max_tokens: 8000,
      model: selectModel('style', modelSelections),
    },
    onStep,
    onReplace,
    'Corrections de style',
  );

  track(res && res.usage, 'style');
  // `salvage` : une réponse coupée par la limite de tokens garde ses premières
  // propositions, plutôt que de tout perdre.
  const json = parseJsonLoose(String((res && res.text) || ''), { salvage: true });
  const proposals = normalizeStyleProposals(json, occurrences);

  return { proposals, occurrences, tokenUsage: acc };
};
