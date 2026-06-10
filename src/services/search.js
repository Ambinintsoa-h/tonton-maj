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
      days: 365, exclude_domains: EXCLUDED_DOMAINS,
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

// ─── Déduplique par URL ───────────────────────────────────────────────────────
const dedupeByUrl = (items) => {
  const seen = new Set();
  return items.filter(r => {
    if (!r.url || seen.has(r.url)) return false;
    seen.add(r.url); return true;
  });
};

// ─── Interface publique ───────────────────────────────────────────────────────
// Brave + Tavily lancés en PARALLÈLE : Brave apporte les URLs récentes,
// Tavily apporte le contenu complet (jusqu'à 3000 chars/source) indispensable
// pour que Claude génère de vraies mises à jour plutôt que des reformulations.
// SearXNG et Jina restent en fallback si les deux premiers échouent.
export const searchWeb = async (query) => {
  // 1. Brave + Tavily en parallèle
  const [braveRes, tavilyRes] = await Promise.allSettled([
    searchBrave(query),
    searchTavily(query),
  ]);

  const merged = [
    ...(braveRes.status  === 'fulfilled' ? braveRes.value  : []),
    ...(tavilyRes.status === 'fulfilled' ? tavilyRes.value : []),
  ];

  if (merged.length) return dedupeByUrl(merged).filter(r => !isExcluded(r.url));

  // 2. SearXNG (si Brave et Tavily ont tous les deux échoué)
  const searxng = await searchSearXNG(query);
  if (searxng.length) return searxng.filter(r => !isExcluded(r.url));

  // 3. Jina (dernier recours)
  return (await searchJina(query)).filter(r => !isExcluded(r.url));
};
