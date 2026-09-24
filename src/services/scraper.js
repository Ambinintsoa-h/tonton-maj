import axios from 'axios';
import { SCRAPE_RETRY_DELAYS_MS, avecReessaiScrape } from '../utils/scrapeRetry';

const PROXY_SCRAPE = '/api/scrape';
const PROXY_JINA   = '/api/jina';   // Jina via proxy — évite l'appel direct depuis le browser

// ── RÉESSAI DU SCRAPE — décision Andrianina, 16 septembre 2026 ───────────────
// Politique (délais, statuts transitoires retentés) déplacée dans
// utils/scrapeRetry.js le 24 septembre 2026 : le pipeline headless ("MAJ en
// lot", server/pipeline.js) en a besoin aussi et ne doit jamais en dériver.
// Voir ce fichier pour le détail de l'incident qui a motivé ces valeurs.

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
/**
 * Rejoue `appel` tant que l'échec est transitoire (voir `scrapeRetryable`).
 * Relance la DERNIÈRE erreur si les essais sont épuisés : l'appelant doit voir
 * le vrai motif, pas une erreur générique de réessai.
 */
const avecReessai = (appel) => avecReessaiScrape(appel, {
  onRetry: (err, delayMs) => {
    console.warn(`[scrape] échec transitoire (${err.response?.status}) — nouvel essai dans ${delayMs / 1000} s`);
  },
});

export const scrapeUrl = async (url, signal) => {

  // ── Stratégie 1 : proxy local avec Readability (HTML complet) ──────────────
  try {
    // Le plafond client (50 s) doit rester AU-DESSUS de celui du serveur (45 s,
    // proxy.js) : l'inverse ferait abandonner l'appelant pendant que la route
    // travaille encore, et l'erreur remontée décrirait le mauvais problème.
    const resp = await avecReessai(
      () => axios.post(PROXY_SCRAPE, { url }, { timeout: 50000, ...(signal ? { signal } : {}) }),
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
