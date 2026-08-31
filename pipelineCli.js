#!/usr/bin/env node
/**
 * pipelineCli.js — point d'entrée PROCESS du runner headless.
 *
 * Toujours lancé en PROCESS SÉPARÉ (child_process.spawn depuis proxy.js),
 * jamais importé en direct dans le process du serveur. Deux raisons, aucune
 * des deux négociable :
 *
 *   1. `esbuild-register` (ci-dessous) monkey-patche `require.extensions['.js']`
 *      pour tout le process — nécessaire pour charger tel quel le code ESM de
 *      `src/services/*.js` (écrit pour l'UI, jamais pour Node), mais une
 *      pollution qu'on ne veut PAS infliger au process proxy.js lui-même.
 *      Incompatible avec le realm sandboxé de Jest pour la même raison (voir
 *      src/server/originFromApiBase.js, extrait de ce fichier pour rester
 *      testable).
 *   2. Les modules requis (`agent.js`, `search.js`, ...) appellent `axios`
 *      SANS baseURL (ils tapent des chemins relatifs comme le fait le
 *      navigateur, ex. `/api/claude-job`) — on doit fixer `axios.defaults.
 *      baseURL` en GLOBAL pour que ça marche hors navigateur. Faire ça dans
 *      le process de proxy.js casserait TOUS ses propres appels sortants
 *      (Anthropic, Haloscan, Brave...) qui partagent la même instance axios.
 *
 * Isoler tout ça dans un process jetable, qui se termine à la fin de l'article,
 * rend cette pollution totalement sans consequence.
 *
 * Entrée : un JSON sur stdin (voir `src/server/pipeline.js` pour la forme
 * exacte attendue). Sortie : une ligne JSON par étape de progression
 * (`{"type":"step","text":"..."}`) puis une ligne finale
 * (`{"type":"result","ok":true,...}` ou `{"type":"result","ok":false,"error":"..."}`).
 */

require('esbuild-register');

// Simulation du strict nécessaire pour que diff.js/internalWeave.js/export.js
// (document.createElement en global brut, jamais injecté) et agent.js
// (sessionStorage pour l'auth du flux SSE) fonctionnent hors navigateur.
// Gardé par un test d'existence : sous Jest ces globales existent déjà
// (jest-environment-jsdom) et ne doivent jamais être remplacées.
if (typeof global.document === 'undefined') {
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM('', { url: 'http://localhost/' });
  global.window = dom.window;
  global.document = dom.window.document;
  global.NodeFilter = dom.window.NodeFilter;
  global.Node = dom.window.Node;
}
if (typeof global.sessionStorage === 'undefined') {
  const store = {};
  global.sessionStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
}

const axios = require('axios');
const { originFromApiBase } = require('./src/server/originFromApiBase');

const readStdin = () => new Promise((resolve, reject) => {
  let data = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => { data += chunk; });
  process.stdin.on('end', () => resolve(data));
  process.stdin.on('error', reject);
});

const emit = (obj) => process.stdout.write(JSON.stringify(obj) + '\n');

(async () => {
  let input;
  try {
    input = JSON.parse(await readStdin());
  } catch (e) {
    emit({ type: 'result', ok: false, error: `JSON d'entrée invalide : ${e.message}` });
    process.exitCode = 1;
    return;
  }

  // Doit être fixé AVANT le premier require() de src/server/pipeline.js (qui
  // require() à son tour agent.js/search.js — leurs appels axios à chemin
  // relatif ne prennent le baseURL courant qu'au moment de l'appel, donc
  // l'ordre exact d'affectation vs require importe peu ICI, mais on le fait
  // tôt par clarté. Voir originFromApiBase.js pour le pourquoi du strip /api.
  axios.defaults.baseURL = originFromApiBase(input.apiBaseUrl);

  const { runArticlePipeline } = require('./src/server/pipeline');

  try {
    const result = await runArticlePipeline({
      ...input,
      onStep: (text) => emit({ type: 'step', text }),
    });
    emit({ type: 'result', ok: true, ...result });
  } catch (e) {
    emit({ type: 'result', ok: false, error: e.message });
    process.exitCode = 1;
  }
})();
