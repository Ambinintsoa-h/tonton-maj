import axios from 'axios';

// ─── Brave Search ──────────────────────────────────────────────────────────────
const searchBrave = async (query, apiKey) => {
  // Essai 1 : 6 derniers mois (freshness=pm = past month, mais on veut ~6 mois → pm+py)
  // Brave ne propose que pd/pw/pm/py. On essaie pm (mois), puis py (an) en fallback.
  let results = [];
  for (const freshness of ['pm', 'py']) {
    try {
      const response = await axios.get('https://api.search.brave.com/res/v1/web/search', {
        headers: { 'Accept': 'application/json', 'X-Subscription-Token': apiKey },
        params: { q: query, count: 8, country: 'us', search_lang: 'en', freshness },
        timeout: 10000,
      });
      results = (response.data?.web?.results || []).map(r => ({
        title: r.title,
        url: r.url,
        description: r.description,
        age: r.age,
        content: null,
        source: 'brave',
      }));
      if (results.length >= 3) break; // assez de résultats → stop
    } catch {}
  }
  return results;
};

// ─── Tavily Search ─────────────────────────────────────────────────────────────
// Clé gratuite : 1 000 req/mois — https://tavily.com
// Retourne le contenu complet des pages → élimine le besoin de scraping séparé
const searchTavily = async (query, apiKey) => {
  try {
    const response = await axios.post('https://api.tavily.com/search', {
      api_key: apiKey,
      query,
      search_depth: 'advanced',
      include_answer: false,
      include_raw_content: false,
      max_results: 8,
      days: 180,
      include_domains: [],
      exclude_domains: EXCLUDED_DOMAINS,
    }, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 20000,
    });
    return (response.data?.results || []).map(r => ({
      title: r.title,
      url: r.url,
      description: r.content?.substring(0, 300) || '',
      age: r.published_date || null,
      content: r.content || null,
      source: 'tavily',
    }));
  } catch { return []; }
};

// ─── SearXNG ───────────────────────────────────────────────────────────────────
// Méta-moteur open source — agrège Google, Bing, DuckDuckGo, Wikipedia…
// Aucune clé requise. Utilise une instance publique stable.
// Liste des instances : https://searx.space
const SEARXNG_INSTANCES = [
  'https://searx.be',
  'https://search.mdosch.de',
  'https://searx.fmac.xyz',
];

const searchSearXNG = async (query, instance = SEARXNG_INSTANCES[0]) => {
  try {
    const response = await axios.get(`${instance}/search`, {
      params: {
        q: query,
        format: 'json',
        language: 'en',
        time_range: 'month',
        categories: 'general',
      },
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (compatible; TontonAI/1.0)',
      },
      timeout: 12000,
    });
    return (response.data?.results || []).slice(0, 8).map(r => ({
      title: r.title,
      url: r.url,
      description: r.content || '',
      age: null,
      content: null,
      source: 'searxng',
    }));
  } catch { return []; }
};

// Essayer les instances SearXNG dans l'ordre jusqu'à en trouver une qui répond
const searchSearXNGWithFallback = async (query) => {
  for (const instance of SEARXNG_INSTANCES) {
    try {
      const results = await searchSearXNG(query, instance);
      if (results.length > 0) return results;
    } catch {}
  }
  return [];
};

// ─── Jina AI Search ────────────────────────────────────────────────────────────
// Gratuit, sans clé. Passe par le proxy local pour éviter que le navigateur
// envoie les requêtes de recherche (et donc le sujet des articles) directement à Jina.
const PROXY_JINA = '/api/jina';

const searchJina = async (query) => {
  try {
    const resp = await axios.post(
      PROXY_JINA,
      { url: query, mode: 'search' },
      { timeout: 20000 }
    );
    const data = resp.data?.data;
    if (Array.isArray(data?.data)) {
      return data.data.slice(0, 6).map(r => ({
        title: r.title || r.url,
        url: r.url,
        description: r.description || r.content?.substring(0, 300) || '',
        age: null,
        content: r.content?.substring(0, 2000) || null,
        source: 'jina',
      }));
    }
    return [];
  } catch { return []; }
};

// ─── Domaines à exclure des résultats ─────────────────────────────────────────
// Sources qui n'apportent pas d'informations factuelles fiables pour les MAJ
const EXCLUDED_DOMAINS = [
  'youtube.com', 'youtu.be',
  'reddit.com', 'quora.com',
  'twitter.com', 'x.com', 'facebook.com', 'instagram.com', 'tiktok.com',
  'pinterest.com', 'linkedin.com',
  'medium.com',  // articles souvent non datés / peu fiables
  'slideshare.net', 'scribd.com',
];

const isExcluded = (url = '') => EXCLUDED_DOMAINS.some(d => url.includes(d));

// ─── Circuit-breaker SearXNG ───────────────────────────────────────────────────
// Si SearXNG échoue pour une requête, on le désactive pour le reste de la session
// pour éviter d'accumuler N×3 timeouts de 12s sur les requêtes parallèles.
let _searxngDisabled = false;

// ─── Interface publique : searchWeb avec cascade automatique ──────────────────
/**
 * Lance une recherche web avec cascade automatique selon les clés disponibles :
 * 1. Brave (si braveKey fournie)     → meilleure qualité + fraîcheur
 * 2. Tavily (si tavilyKey fournie)   → contenu complet des pages, idéal pour IA
 * 3. SearXNG (aucune clé requise)    → méta-moteur gratuit, désactivé si timeout
 * 4. Jina Search (aucune clé)        → contenu complet, en dernier recours
 *
 * @param {string} query
 * @param {string|null} braveKey
 * @param {string|null} tavilyKey
 * @returns {Promise<Array>}
 */
export const searchWeb = async (query, braveKey = null, tavilyKey = null) => {
  let results = [];

  // 1. Brave
  if (braveKey) {
    results = await searchBrave(query, braveKey);
  }

  // 2. Tavily
  if (!results.length && tavilyKey) {
    results = await searchTavily(query, tavilyKey);
  }

  // 3. SearXNG — court-circuité si déjà en échec cette session
  if (!results.length && !_searxngDisabled) {
    results = await searchSearXNGWithFallback(query);
    if (!results.length) {
      _searxngDisabled = true; // évite les timeouts répétés sur les requêtes suivantes
      console.warn('[search] SearXNG indisponible — basculement définitif sur Jina');
    }
  }

  // 4. Jina Search (dernier recours, toujours gratuit)
  if (!results.length) {
    results = await searchJina(query);
  }

  // Filtre final : exclure YouTube, Reddit, réseaux sociaux…
  return results.filter(r => !isExcluded(r.url));
};

