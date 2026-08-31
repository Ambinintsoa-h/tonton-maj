/**
 * httpErrorDetail.js — déplie une erreur axios en un message qui dit VRAIMENT
 * ce qui a échoué, au lieu du générique "Request failed with status code
 * 500" (le seul message qu'expose `Error.message` par défaut sur une erreur
 * axios -- le corps de la réponse et l'appel en cause restent dans
 * `e.response`/`e.config`, jamais lus par défaut).
 *
 * Même principe que `wpRequest` (src/services/wordpress.js:18,
 * `e.response?.data?.error || e.message`), étendu ici avec la méthode/URL de
 * l'appel en échec -- indispensable dans le runner headless (pipelineCli.js)
 * où PLUSIEURS appels internes (/api/claude-job, /api/brave, /api/tavily,
 * /api/data/...) peuvent échouer et où le message nu ne dit pas LEQUEL.
 *
 * Point d'entrée UNIQUE et volontairement isolé : pipelineCli.js catche ICI
 * l'erreur de runArticlePipeline() (src/server/pipeline.js), qui elle-même
 * ne catche jamais les appels axios de agent.js/search.js -- ce fichier est
 * donc le seul endroit où TOUTES ces erreurs internes convergent avant
 * d'être sérialisées vers le process parent (batchOrchestrator.js). Un seul
 * point à corriger plutôt que d'ajouter un unwrap à chaque appelant.
 */

// Un corps de réponse HTML (page d'erreur Express par défaut, ou fallback
// SPA -- voir originFromApiBase.js) ne contient jamais la vraie cause dans
// un format exploitable : on le réduit à du texte brut, tronqué.
const stripHtml = (s) => String(s).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * @param {Error} e — erreur quelconque (axios ou non)
 * @returns {string} message enrichi, jamais vide
 */
const describeHttpError = (e) => {
  if (!e) return 'Erreur inconnue';
  const resp = e.response;
  if (!resp) return e.message || 'Erreur inconnue'; // pas une erreur axios (ou réseau sans réponse) -- rien à déplier

  const method = e.config?.method ? e.config.method.toUpperCase() : '?';
  const url = e.config?.url || '?';
  const body = resp.data;
  let detail;
  if (body && typeof body === 'object') {
    detail = body.error || body.detail || body.message || JSON.stringify(body).slice(0, 300);
  } else if (typeof body === 'string' && body.trim()) {
    detail = stripHtml(body).slice(0, 300);
  } else {
    detail = null;
  }

  return `HTTP ${resp.status} sur ${method} ${url}${detail ? ` — ${detail}` : ''}`;
};

module.exports = { describeHttpError };
