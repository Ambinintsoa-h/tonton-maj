const { fetchSitePostUrls, extractLocs, isSitemapIndex, looksLikePostSitemap, MAX_URLS } = require('./sitemapFetch');

const lookupPublic = () => jest.fn().mockResolvedValue({ address: '93.184.216.34' });

const SITEMAP_INDEX = `<?xml version="1.0"?>
<sitemapindex><sitemap><loc>https://site.fr/page-sitemap.xml</loc></sitemap>
<sitemap><loc>https://site.fr/post-sitemap.xml</loc></sitemap></sitemapindex>`;

const POST_SITEMAP = `<?xml version="1.0"?>
<urlset><url><loc>https://site.fr/article-un/</loc></url>
<url><loc>https://site.fr/article-deux/</loc></url></urlset>`;

const FLAT_SITEMAP = `<?xml version="1.0"?>
<urlset><url><loc>https://site.fr/seule-page/</loc></url></urlset>`;

describe('extractLocs / isSitemapIndex / looksLikePostSitemap', () => {
  it('extrait les <loc> d\'un sitemap', () => {
    expect(extractLocs(POST_SITEMAP)).toEqual(['https://site.fr/article-un/', 'https://site.fr/article-deux/']);
  });

  it('reconnaît un index de sitemaps', () => {
    expect(isSitemapIndex(SITEMAP_INDEX)).toBe(true);
    expect(isSitemapIndex(POST_SITEMAP)).toBe(false);
  });

  it('reconnaît un sous-sitemap "post" par son URL', () => {
    expect(looksLikePostSitemap('https://site.fr/post-sitemap.xml')).toBe(true);
    expect(looksLikePostSitemap('https://site.fr/post_sitemap.xml')).toBe(true);
    expect(looksLikePostSitemap('https://site.fr/page-sitemap.xml')).toBe(false);
  });
});

describe('fetchSitePostUrls', () => {
  it('URL d\'article invalide → liste vide, aucun appel réseau', async () => {
    const axiosGet = jest.fn();
    expect(await fetchSitePostUrls('pas-une-url', { axiosGet, lookup: lookupPublic() })).toEqual([]);
    expect(axiosGet).not.toHaveBeenCalled();
  });

  it('sitemap.xml est un index → suit le sous-sitemap "post" et renvoie ses URLs', async () => {
    const axiosGet = jest.fn()
      .mockResolvedValueOnce({ status: 200, data: SITEMAP_INDEX })
      .mockResolvedValueOnce({ status: 200, data: POST_SITEMAP });
    const urls = await fetchSitePostUrls('https://site.fr/un-article/', { axiosGet, lookup: lookupPublic() });
    expect(urls).toEqual(['https://site.fr/article-un/', 'https://site.fr/article-deux/']);
    expect(axiosGet).toHaveBeenNthCalledWith(1, 'https://site.fr/sitemap.xml', expect.anything());
    expect(axiosGet).toHaveBeenNthCalledWith(2, 'https://site.fr/post-sitemap.xml', expect.anything());
  });

  it('sitemap.xml est un urlset plat (pas d\'index) → utilisé directement', async () => {
    const axiosGet = jest.fn().mockResolvedValueOnce({ status: 200, data: FLAT_SITEMAP });
    const urls = await fetchSitePostUrls('https://site.fr/un-article/', { axiosGet, lookup: lookupPublic() });
    expect(urls).toEqual(['https://site.fr/seule-page/']);
  });

  it('sitemap.xml absent (404) → tente sitemap_index.xml en repli', async () => {
    const axiosGet = jest.fn()
      .mockRejectedValueOnce(new Error('404'))
      .mockResolvedValueOnce({ status: 200, data: FLAT_SITEMAP });
    const urls = await fetchSitePostUrls('https://site.fr/un-article/', { axiosGet, lookup: lookupPublic() });
    expect(urls).toEqual(['https://site.fr/seule-page/']);
    expect(axiosGet).toHaveBeenNthCalledWith(2, 'https://site.fr/sitemap_index.xml', expect.anything());
  });

  it('les deux chemins échouent → liste vide, jamais une exception', async () => {
    const axiosGet = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(fetchSitePostUrls('https://site.fr/un-article/', { axiosGet, lookup: lookupPublic() }))
      .resolves.toEqual([]);
  });

  it('index sans aucun sous-sitemap "post" reconnu → replie sur le premier sous-sitemap listé', async () => {
    const indexSansPost = `<sitemapindex><sitemap><loc>https://site.fr/page-sitemap.xml</loc></sitemap></sitemapindex>`;
    const axiosGet = jest.fn()
      .mockResolvedValueOnce({ status: 200, data: indexSansPost })
      .mockResolvedValueOnce({ status: 200, data: FLAT_SITEMAP });
    const urls = await fetchSitePostUrls('https://site.fr/un-article/', { axiosGet, lookup: lookupPublic() });
    expect(urls).toEqual(['https://site.fr/seule-page/']);
  });

  it('plafonne à MAX_URLS entrées', async () => {
    const manyUrls = Array.from({ length: MAX_URLS + 50 }, (_, i) => `<url><loc>https://site.fr/a-${i}/</loc></url>`).join('\n');
    const bigSitemap = `<urlset>${manyUrls}</urlset>`;
    const axiosGet = jest.fn().mockResolvedValueOnce({ status: 200, data: bigSitemap });
    const urls = await fetchSitePostUrls('https://site.fr/un-article/', { axiosGet, lookup: lookupPublic() });
    expect(urls).toHaveLength(MAX_URLS);
  });
});
