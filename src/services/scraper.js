import axios from 'axios';
import { stripNonEditorialLinks, stripNonEditorialUrlsFromText } from '../utils/scrapeClean';

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
      // Boutons de suivi Google (« Discover », « Ajouter comme source préférée »)
      // retirés AVANT que le contenu n'entre dans le parcours : le verrou liens
      // externes exigerait ensuite que l'IA les reproduise dans l'article, ce qui
      // a déjà fait échouer des générations entières (voir utils/scrapeClean.js).
      const propre = stripNonEditorialLinks(titleHtml + content);
      if (propre.removed.length) {
        console.warn(`[scrape] ${propre.removed.length} lien(s) non éditorial(aux) retiré(s) :`, propre.removed);
      }
      return {
        success:     true,
        content:     propre.html,                                     // HTML structuré
        textContent: stripNonEditorialUrlsFromText(textContent || content), // texte brut pour Claude
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

    const brut = typeof resp.data?.data === 'string' ? resp.data.data : '';
    if (!brut || brut.trim().length < 100) throw new Error('Contenu insuffisant');
    // Jina rend du texte, pas du HTML : les widgets y apparaissent en URL nues.
    const text = stripNonEditorialUrlsFromText(brut);

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
