/**
 * sitemapFetch.js — récupère la liste RÉELLE des URLs "post" d'un site à
 * partir de son sitemap public (/sitemap.xml puis /sitemap_index.xml), pour
 * ancrer les suggestions de maillage interne dans des pages qui existent
 * VRAIMENT, au lieu de laisser l'IA deviner des slugs plausibles.
 *
 * Contexte : `internal_linking.liens_entrants` (agentQat.js) était deviné
 * par l'IA à partir du seul article en cours, sans jamais savoir quelles
 * pages existent réellement sur le site — un vrai risque de 404, constaté en
 * production. Décision Andrianina (chantier "fiabilité des liens injectés",
 * septembre 2026) : la vérité terrain est le sitemap public du site, pas une
 * recherche via l'API WordPress (qui exigerait des identifiants stockés et
 * ne fonctionnerait que pour un site déjà connecté).
 *
 * Échec silencieux et NON BLOQUANT à chaque étape : sitemap absent, 404, ou
 * mal formé → liste vide. Le reste du dispositif se dégrade proprement
 * (l'IA propose sans grounding, comportement d'aujourd'hui).
 */
const { fetchFollowingSafeRedirects, assertSafeUrl } = require('./safeFetch');

// Plafond de sécurité : les sitemaps volumineux sont généralement triés du
// plus récent au plus ancien -- au-delà, le gain marginal pour le maillage
// ne justifie pas d'alourdir le prompt de l'audit.
const MAX_URLS = 500;
const TIMEOUT_MS = 8000;

// Conventions Yoast/RankMath/WP natif les plus courantes pour le sous-sitemap
// des articles : post-sitemap.xml, post_sitemap.xml, sitemap-pt-post-p1.xml...
const looksLikePostSitemap = (url) => /post/i.test(String(url || ''));

const extractLocs = (xml) => {
  const matches = [...String(xml || '').matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)];
  return matches.map((m) => m[1].trim()).filter(Boolean);
};

const isSitemapIndex = (xml) => /<sitemapindex[\s>]/i.test(String(xml || ''));

const fetchXml = async (url, deps = {}) => {
  await assertSafeUrl(url, 'URL du sitemap', deps);
  const res = await fetchFollowingSafeRedirects(url, {
    timeout: TIMEOUT_MS,
    headers: { Accept: 'application/xml, text/xml, */*' },
  }, deps);
  return String(res.data || '');
};

/**
 * @param {string} articleUrl — sert uniquement à déduire l'origine du site
 * @param {object} [deps] — injectables pour les tests (voir safeFetch.js)
 * @returns {Promise<string[]>} URLs réelles du site (post-sitemap si trouvé,
 *   sinon le sitemap racine tel quel), plafonnées à MAX_URLS. [] si le
 *   sitemap est absent/illisible.
 */
const fetchSitePostUrls = async (articleUrl, deps = {}) => {
  let origin;
  try { origin = new URL(articleUrl).origin; } catch { return []; }

  for (const path of ['/sitemap.xml', '/sitemap_index.xml']) {
    let xml;
    try { xml = await fetchXml(`${origin}${path}`, deps); } catch { continue; }
    if (!xml.trim()) continue;

    if (isSitemapIndex(xml)) {
      const subSitemaps = extractLocs(xml);
      const postSitemap = subSitemaps.find(looksLikePostSitemap) || subSitemaps[0];
      if (!postSitemap) continue;
      try {
        const postsXml = await fetchXml(postSitemap, deps);
        const urls = extractLocs(postsXml);
        if (urls.length) return urls.slice(0, MAX_URLS);
      } catch { continue; }
    } else {
      const urls = extractLocs(xml);
      if (urls.length) return urls.slice(0, MAX_URLS);
    }
  }
  return [];
};

module.exports = { fetchSitePostUrls, extractLocs, isSitemapIndex, looksLikePostSitemap, MAX_URLS };
