/* eslint-env jest */
/**
 * pipelineCli.test.js — verrou sur `originFromApiBase` (extrait dans son
 * propre module, src/server/originFromApiBase.js, car pipelineCli.js démarre
 * par `require('esbuild-register')`, incompatible avec le realm sandboxé de
 * Jest -- un require() direct de pipelineCli.js dans un test plante avant
 * même d'atteindre cette fonction).
 *
 * Régression du 31 août 2026 : `axios.defaults.baseURL` était fixé sur
 * `apiBaseUrl` tel quel (ex. "https://maj.stomos.net/api"), alors que les
 * modules ESM du navigateur (agent.js, search.js) appellent axios avec des
 * chemins DÉJÀ préfixés par /api ("/api/claude-job", "/api/brave"). Le
 * préfixe se retrouvait doublé ("/api/api/claude-job"), route inexistante
 * qui retombait sur le catch-all SPA de proxy.js -- symptômes observés en
 * prod : "Audit illisible ou échoué" (le job Claude n'aboutissait jamais) et
 * des recherches web en "Request failed with status code 500".
 */
const { originFromApiBase } = require('./originFromApiBase');

describe('originFromApiBase', () => {
  test('retire le /api final -- même résultat que la résolution "même origine" du navigateur', () => {
    expect(originFromApiBase('https://maj.stomos.net/api')).toBe('https://maj.stomos.net');
  });

  test('fonctionne aussi en local (port explicite)', () => {
    expect(originFromApiBase('http://127.0.0.1:3001/api')).toBe('http://127.0.0.1:3001');
  });

  test('tolère un slash final après /api', () => {
    expect(originFromApiBase('https://maj.stomos.net/api/')).toBe('https://maj.stomos.net');
  });

  test('ne touche pas une URL qui ne se termine pas par /api (rien à retirer)', () => {
    expect(originFromApiBase('https://maj.stomos.net')).toBe('https://maj.stomos.net');
  });

  test('ne plante jamais sur une entrée manquante -- laisse la validation de runArticlePipeline() le dire proprement', () => {
    expect(originFromApiBase(undefined)).toBe('');
    expect(originFromApiBase('')).toBe('');
  });
});
