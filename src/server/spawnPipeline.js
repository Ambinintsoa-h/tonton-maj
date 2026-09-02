/**
 * src/server/spawnPipeline.js — lance pipelineCli.js dans un process séparé.
 *
 * Extrait de la route `POST /api/internal/run-article-pipeline` (Phase 1) pour
 * être réutilisé tel quel par l'orchestrateur de batches (Phase 5) — même
 * contrat exact, une seule fois écrit. Rien de métier ici : ce fichier ne fait
 * que parler NDJSON avec le process enfant.
 *
 * Le pipeline tourne dans un process séparé (jamais dans celui de proxy.js)
 * parce que pipelineCli.js simule jsdom/sessionStorage et fixe
 * `axios.defaults.baseURL` globalement pour rejouer tel quel le code ESM
 * écrit pour le navigateur (`agentQat.js` et ses dépendances) — le faire dans
 * le process de proxy.js corromprait sa propre instance axios partagée.
 */
const path = require('path');
const { spawn } = require('child_process');

const DEFAULT_CLI_PATH = path.join(__dirname, '..', '..', 'pipelineCli.js');
// Relevé de 15 à 25 min le 2 septembre 2026 : ce plafond datait du 28/08 avec un
// commentaire disant "4 passes IA", alors que la passe de gras (agentBold.js,
// ajoutée le 19/08, donc déjà là) en fait une 5e obligatoire à chaque génération.
// Constaté en production : un item tué pile à 15 min pendant "Mise en gras",
// sur un article lourd où le cumul des 5 passes (avec leurs essais IA en
// cascade) a dépassé le plafond -- pas un vrai blocage, juste un budget trop
// juste pour le nombre réel de passes.
const DEFAULT_TIMEOUT_MS = 25 * 60 * 1000; // un run complet (5 passes IA) peut prendre plusieurs minutes

/**
 * @param {object} input — transmis tel quel en JSON sur stdin de pipelineCli.js
 * @param {object} [opts]
 * @param {number} [opts.timeoutMs]
 * @param {string} [opts.cliPath]     override pour les tests
 * @param {function} [opts.onStep]   appelé pour chaque ligne {type:'step'}
 * @returns {Promise<{ok:true, ...resultat, steps:string[]}>}
 *   Rejette avec une Error (portant `.steps`/`.stderr`) si le runner n'a rien
 *   renvoyé, ou si le pipeline a échoué (`ok:false`) — jamais un objet muet,
 *   l'appelant doit explicitement traiter l'échec.
 */
const spawnPipeline = (input, opts = {}) => new Promise((resolve, reject) => {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, cliPath = DEFAULT_CLI_PATH, onStep } = opts;

  const proc = spawn(process.execPath, [cliPath], {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });

  const steps = [];
  let resultLine = null;
  let stderr = '';
  let buf = '';
  proc.stdout.setEncoding('utf8');
  proc.stderr.setEncoding('utf8');
  proc.stdout.on('data', (chunk) => {
    buf += chunk;
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line);
        if (parsed.type === 'step') { steps.push(parsed.text); if (onStep) onStep(parsed.text); }
        else if (parsed.type === 'result') resultLine = parsed;
      } catch { /* ligne non-JSON (ne devrait pas arriver) — ignorée */ }
    }
  });
  proc.stderr.on('data', (d) => { stderr += d; });

  proc.stdin.write(JSON.stringify(input));
  proc.stdin.end();

  const timer = setTimeout(() => proc.kill(), timeoutMs);

  proc.on('close', () => {
    clearTimeout(timer);
    if (!resultLine) {
      reject(Object.assign(new Error('Le runner n\'a renvoyé aucun résultat'), { steps, stderr }));
      return;
    }
    if (!resultLine.ok) {
      reject(Object.assign(new Error(resultLine.error || 'Échec du pipeline'), { steps, resultLine }));
      return;
    }
    resolve({ ...resultLine, steps });
  });
  proc.on('error', (e) => {
    clearTimeout(timer);
    reject(new Error(`Impossible de démarrer le runner : ${e.message}`));
  });
});

module.exports = { spawnPipeline, DEFAULT_CLI_PATH };
