import axios from 'axios';

// ─── Brave Search (via proxy /api/brave) ──────────────────────────────────────
const searchBrave = async (query) => {
  let results = [];
  for (const freshness of ['pm', 'py']) {
    try {
      const resp = await axios.get('/api/brave', {
        params: { q: query, freshness },
        timeout: 12000,
      });
      results = (resp.data?.web?.results || []).map(r => ({
        title: r.title, url: r.url, description: r.description,
        age: r.age, content: null, source: 'brave',
      }));
      if (results.length >= 3) break;
    } catch {}
  }
  return results;
};

// ─── Tavily (via proxy /api/tavily) ───────────────────────────────────────────
const searchTavily = async (query) => {
  try {
    const resp = await axios.post('/api/tavily', {
      query, search_depth: 'advanced', max_results: 8,
      days: 180, exclude_domains: EXCLUDED_DOMAINS,
    }, { timeout: 22000 });
    return (resp.data?.results || []).map(r => ({
      title: r.title, url: r.url,
      description: r.content?.substring(0, 300) || '',
      age: r.published_date || null,
      content: r.content || null,
      source: 'tavily',
    }));
  } catch { return []; }
};

// ─── SearXNG (via proxy /api/searxng — instances tierces côté serveur) ────────
let _searxngDisabled = false;

const searchSearXNG = async (query) => {
  if (_searxngDisabled) return [];
  try {
    const resp = await axios.get('/api/searxng', {
      params: { q: query, time_range: 'month', language: 'en' },
      timeout: 14000,
    });
    const results = (resp.data?.results || []).slice(0, 8).map(r => ({
      title: r.title, url: r.url,
      description: r.content || '',
      age: null, content: null, source: 'searxng',
    }));
    if (!results.length) _searxngDisabled = true;
    return results;
  } catch {
    _searxngDisabled = true;
    console.warn('[search] SearXNG indisponible — basculement définitif sur Jina');
    return [];
  }
};

// ─── Jina AI Search (via proxy /api/jina — déjà proxifié) ────────────────────
const searchJina = async (query) => {
  try {
    const resp = await axios.post('/api/jina', { url: query, mode: 'search' }, { timeout: 20000 });
    const data = resp.data?.data;
    if (Array.isArray(data?.data)) {
      return data.data.slice(0, 6).map(r => ({
        title: r.title || r.url, url: r.url,
        description: r.description || r.content?.substring(0, 300) || '',
        age: null, content: r.content?.substring(0, 2000) || null,
        source: 'jina',
      }));
    }
    return [];
  } catch { return []; }
};

// ─── Domaines exclus ──────────────────────────────────────────────────────────
const EXCLUDED_DOMAINS = [
  'youtube.com', 'youtu.be', 'reddit.com', 'quora.com',
  'twitter.com', 'x.com', 'facebook.com', 'instagram.com', 'tiktok.com',
  'pinterest.com', 'linkedin.com', 'medium.com', 'slideshare.net', 'scribd.com',
];
const isExcluded = (url = '') => EXCLUDED_DOMAINS.some(d => url.includes(d));

// ─── Interface publique : cascade automatique (aucune clé côté client) ────────
// Ordre : Brave → Tavily → SearXNG → Jina
// Les clés API sont lues côté serveur depuis data/settings.json.
// Si un service n'est pas configuré, le proxy répond 503 et on passe au suivant.
export const searchWeb = async (query) => {
  let results = [];

  // 1. Brave (proxy vérifie si braveKey configurée)
  results = await searchBrave(query);

  // 2. Tavily
  if (!results.length) results = await searchTavily(query);

  // 3. SearXNG
  if (!results.length) results = await searchSearXNG(query);

  // 4. Jina (dernier recours)
  if (!results.length) results = await searchJina(query);

  return results.filter(r => !isExcluded(r.url));
};
