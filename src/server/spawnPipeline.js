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
// Relevé de 15 à 25 min le 2 septembre 2026, puis REDESCENDU à 20 min le 24
// septembre 2026 (décision Andrianina) -- en même temps que le nombre max
// d'essais par appel IA passe de 3 à 2 (agentQat.js, MAX_ESSAIS_IA) : un
// essai de moins par passe réduit le pire cas (5 passes x un essai en moins
// chacune), ce qui rend un budget plus court à nouveau tenable. À surveiller
// comme en septembre : si des items se font tuer en cours de route sur un
// article lourd, c'est ce plafond qu'il faut remonter, pas le nombre d'essais.
// REVENU à 25 min le 1er octobre 2026 (retour à la configuration d'avant le
// 24/09, décision Andrianina) -- constaté le même jour : à 20 min, des articles
// étaient coupés à quelques minutes de la fin (mise en gras), deux fois de suite.
const DEFAULT_TIMEOUT_MS = 25 * 60 * 1000; // un run complet (5 passes IA, 3 essais max chacune) peut prendre plusieurs minutes
// Délai dur (voir plus bas) : SIGKILL 5 s après le SIGTERM, promesse réglée
// au plus tard 20 s après le délai même si le process ne donne plus signe de
// vie, et 2 s de grâce entre 'exit' et 'close' pour la dernière ligne stdout.
const KILL_GRACE_MS = 5000;
const HARD_SETTLE_GRACE_MS = 20000;
const EXIT_GRACE_MS = 2000;
const STDERR_MAX_CHARS = 20000;

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
  // Borné : un run bavard sur stderr pendant 20 min ne doit pas gonfler la
  // mémoire du process serveur -- seule la fin sert au diagnostic.
  proc.stderr.on('data', (d) => { stderr = (stderr + d).slice(-STDERR_MAX_CHARS); });

  // ── Délai DUR (incident du 01/10/2026) ───────────────────────────────────
  // Avant : `setTimeout(() => proc.kill(), timeoutMs)` puis on attendait
  // l'événement 'close' pour régler la promesse. Constaté en production :
  // 6 articles toujours "en_cours" 26 min après leur lancement, dans un
  // processus serveur pourtant vivant (délai réglé à 20 min) -- aucune
  // erreur, aucun réessai, et leurs 6 créneaux de concurrence bloqués. Or
  // 'close' n'arrive qu'une fois le process terminé ET tous ses flux stdio
  // fermés : un SIGTERM ignoré/en attente, ou un descendant qui garde un flux
  // ouvert, et la promesse ne se règle JAMAIS. Désormais : SIGTERM au délai,
  // SIGKILL 5 s plus tard, on règle dès 'exit' (après une courte grâce pour
  // laisser arriver la dernière ligne stdout), et un filet absolu règle de
  // toute façon la promesse si ni 'exit' ni 'close' ne viennent. Quoi qu'il
  // arrive côté enfant, l'item est libéré et passe par handleFailure.
  let settled = false;
  let timedOut = false;
  let killTimer = null;
  let exitGraceTimer = null;
  let hardTimer = null;
  const timeoutError = () => Object.assign(
    new Error(`Délai dépassé (${Math.round(timeoutMs / 60000)} min) -- article interrompu`),
    { steps, stderr },
  );
  const settle = (fn) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    clearTimeout(killTimer);
    clearTimeout(exitGraceTimer);
    clearTimeout(hardTimer);
    fn();
  };
  const finish = () => settle(() => {
    if (!resultLine) {
      reject(timedOut
        ? timeoutError()
        : Object.assign(new Error('Le runner n\'a renvoyé aucun résultat'), { steps, stderr }));
      return;
    }
    if (!resultLine.ok) {
      reject(Object.assign(new Error(resultLine.error || 'Échec du pipeline'), { steps, resultLine }));
      return;
    }
    resolve({ ...resultLine, steps });
  });

  const timer = setTimeout(() => {
    timedOut = true;
    try { proc.kill('SIGTERM'); } catch { /* déjà mort */ }
    killTimer = setTimeout(() => { try { proc.kill('SIGKILL'); } catch { /* déjà mort */ } }, KILL_GRACE_MS);
    hardTimer = setTimeout(() => settle(() => reject(timeoutError())), HARD_SETTLE_GRACE_MS);
  }, timeoutMs);

  proc.on('exit', () => {
    // Le process est terminé ; ses flux peuvent encore être tenus ouverts par
    // un descendant -- on laisse une courte grâce à 'close' (dernière ligne
    // stdout éventuelle), puis on règle sans lui.
    exitGraceTimer = setTimeout(finish, EXIT_GRACE_MS);
  });
  proc.on('close', finish);
  proc.on('error', (e) => {
    settle(() => reject(new Error(`Impossible de démarrer le runner : ${e.message}`)));
  });

  // Un enfant qui meurt avant d'avoir lu stdin (crash au démarrage, mémoire
  // refusée par l'hébergement...) ferait émettre EPIPE sur ce flux -- capté
  // ici plutôt que de remonter en exception non gérée dans le serveur.
  if (proc.stdin && typeof proc.stdin.on === 'function') proc.stdin.on('error', () => {});
  try {
    proc.stdin.write(JSON.stringify(input));
    proc.stdin.end();
  } catch (e) {
    try { proc.kill('SIGKILL'); } catch { /* déjà mort */ }
    settle(() => reject(new Error(`Impossible de démarrer le runner : ${e.message}`)));
  }
});

module.exports = { spawnPipeline, DEFAULT_CLI_PATH, DEFAULT_TIMEOUT_MS };
