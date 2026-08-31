/**
 * originFromApiBase.js — extrait un module à part pour rester testable sous
 * Jest : pipelineCli.js (qui l'utilise) démarre par `require('esbuild-register')`,
 * incompatible avec le realm sandboxé de Jest ("Buffer.from('') instanceof
 * Uint8Array is incorrectly false") -- le require() direct de pipelineCli.js
 * dans un test plante donc AVANT même d'atteindre cette fonction.
 *
 * Les modules ESM du navigateur (agent.js, search.js) appellent axios avec
 * des chemins DÉJÀ préfixés par /api (ex. '/api/claude-job', '/api/brave'),
 * exactement comme ils le font dans un vrai navigateur -- même origine, sans
 * baseURL. `apiBaseUrl` (fourni par l'appelant du runner headless) se
 * termine LUI-MÊME par '/api' (voir pipeline.js, qui l'utilise tel quel comme
 * baseURL de sa propre instance axios dédiée). Fixer `axios.defaults.baseURL`
 * sur `apiBaseUrl` tel quel doublait donc le préfixe : combineURLs('.../api',
 * '/api/claude-job') = '.../api/api/claude-job' -- une route inexistante qui
 * retombait sur le catch-all SPA de proxy.js (du HTML renvoyé en 200, jamais
 * rejeté). Constaté en prod le 31 août 2026, une fois le bug skills/knowledge
 * corrigé et le pipeline arrivé assez loin pour atteindre le premier appel
 * Claude : "Audit illisible ou échoué" (le job ne pouvait pas aboutir) et des
 * recherches web Brave/Tavily en "Request failed with status code 500" --
 * même cause, deux symptômes.
 *
 * `apiBaseUrl` manquant est une entrée invalide -- déjà rejetée proprement
 * par la validation de runArticlePipeline() (dans son propre try/catch, donc
 * renvoyée en {ok:false} propre). Cette fonction ne doit jamais planter
 * elle-même, sinon l'erreur remonte brute, sans passer par pipelineCli.js.
 */
const originFromApiBase = (apiBaseUrl) => (apiBaseUrl || '').replace(/\/api\/?$/, '');

module.exports = { originFromApiBase };
