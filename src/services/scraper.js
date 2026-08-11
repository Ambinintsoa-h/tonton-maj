import axios from 'axios';

const PROXY_SCRAPE = '/api/scrape';
const PROXY_JINA   = '/api/jina';   // Jina via proxy — évite l'appel direct depuis le browser

/**
 * Scrape une URL et retourne le contenu de l'article.
 *
 * Retourne :
 *   { success: true, content: string (HTML), textContent: string (texte brut), title: string }
 *   { success: false, error: string }
 *
 * Stratégie :
 *  1. Proxy local → @mozilla/readability  →  HTML structuré (tableaux, titres, listes…)
 *  2. Fallback : Jina AI reader           →  texte brut (si proxy éteint)
 */
export const scrapeUrl = async (url, signal) => {

  // ── Stratégie 1 : proxy local avec Readability (HTML complet) ──────────────
  try {
    const resp = await axios.post(
      PROXY_SCRAPE,
      { url },
      { timeout: 25000, ...(signal ? { signal } : {}) }
    );

    const { content, textContent, title } = resp.data;

    if (content && content.trim().length >= 100) {
      // On préfixe le titre sous forme de <h1> s'il n'est pas déjà dans le contenu
      const titleHtml = (title && !content.includes(title))
        ? `<h1>${title}</h1>\n`
        : '';
      // Le filtre des boutons de suivi Google N'EST PLUS ici : un article
      // WordPress connecté ne passe pas par le scraping (branche `wpFetched` de
      // Articles.jsx), et c'était justement le cas qui échouait. Il vit désormais
      // au point de passage unique des trois sources, avant setOriginalContent.
      return {
        success:     true,
        content:     titleHtml + content,   // HTML structuré
        textContent: textContent || content, // texte brut pour Claude
        title,
      };
    }
  } catch (proxyErr) {
    const isProxyDown = !proxyErr.response; // pas de réponse HTTP = proxy éteint
    if (!isProxyDown) {
      // Le proxy répond mais avec une erreur métier (403, 422…)
      const msg = proxyErr.response?.data?.error
        || 'Ce site bloque le scraping. Copiez-collez le contenu manuellement.';
      return { success: false, error: msg };
    }
    // Proxy éteint → on continue vers Jina
  }

  // ── Stratégie 2 : Jina AI via proxy local (fallback sans proxy Readability) ─
  // Passe par localhost:3001/api/jina plutôt qu'appeler r.jina.ai directement
  // depuis le navigateur (évite d'exposer les URLs des articles à Jina en browser).
  try {
    const resp = await axios.post(
      PROXY_JINA,
      { url, mode: 'reader' },
      { timeout: 35000, ...(signal ? { signal } : {}) }
    );

    const text = typeof resp.data?.data === 'string' ? resp.data.data : '';
    if (!text || text.trim().length < 100) throw new Error('Contenu insuffisant');

    return {
      success:     true,
      content:     text,
      textContent: text,
      title:       '',
    };
  } catch {
    return {
      success: false,
      error:   'Ce site est protégé contre le scraping. Veuillez copier-coller le contenu de l\'article manuellement.',
    };
  }
};
