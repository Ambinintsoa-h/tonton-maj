const { isPrivateHost, assertSafeUrl, fetchFollowingSafeRedirects, DEFAULT_MAX_REDIRECTS } = require('./safeFetch');

describe('isPrivateHost', () => {
  it('détecte les plages IPv4 privées/loopback/link-local', () => {
    expect(isPrivateHost('127.0.0.1')).toBe(true);
    expect(isPrivateHost('10.0.0.5')).toBe(true);
    expect(isPrivateHost('172.16.0.1')).toBe(true);
    expect(isPrivateHost('172.31.255.255')).toBe(true);
    expect(isPrivateHost('192.168.1.1')).toBe(true);
    expect(isPrivateHost('169.254.169.254')).toBe(true); // AWS IMDS
  });

  it('laisse passer une IPv4 publique', () => {
    expect(isPrivateHost('8.8.8.8')).toBe(false);
    expect(isPrivateHost('172.32.0.1')).toBe(false); // juste hors de la plage 172.16-31
  });

  it('détecte les IPv6 loopback/ULA/link-local', () => {
    expect(isPrivateHost('::1')).toBe(true);
    expect(isPrivateHost('fd00::1')).toBe(true);
    expect(isPrivateHost('fe80::1')).toBe(true);
  });

  it('détecte les noms d\'hôtes locaux', () => {
    expect(isPrivateHost('localhost')).toBe(true);
    expect(isPrivateHost('machine.local')).toBe(true);
    expect(isPrivateHost('service.internal')).toBe(true);
  });

  it('laisse passer un domaine public', () => {
    expect(isPrivateHost('example.com')).toBe(false);
  });
});

describe('assertSafeUrl', () => {
  // CRA active resetMocks:true -- une config posée hors d'un beforeEach/it
  // (donc au moment de la collecte, une seule fois) est effacée avant le
  // premier test. Reconfigurée ici à chaque test.
  let lookupPublic;
  beforeEach(() => { lookupPublic = jest.fn().mockResolvedValue({ address: '93.184.216.34' }); });

  it('rejette une URL invalide', async () => {
    await expect(assertSafeUrl('pas-une-url', 'URL', { lookup: lookupPublic })).rejects.toThrow(/invalide/);
  });

  it('rejette un protocole non http(s)', async () => {
    await expect(assertSafeUrl('file:///etc/passwd', 'URL', { lookup: lookupPublic })).rejects.toThrow(/Protocole/);
  });

  it('rejette un hostname littéralement privé, sans même résoudre le DNS', async () => {
    await expect(assertSafeUrl('http://127.0.0.1/admin', 'URL', { lookup: lookupPublic })).rejects.toThrow(/interne/);
    expect(lookupPublic).not.toHaveBeenCalled();
  });

  it('rejette le DNS rebinding -- domaine public qui résout vers une IP privée', async () => {
    const lookupPrivate = jest.fn().mockResolvedValue({ address: '169.254.169.254' });
    await expect(assertSafeUrl('http://evil.example.com/', 'URL', { lookup: lookupPrivate })).rejects.toThrow(/interdit via DNS/);
  });

  it('accepte une URL publique qui résout normalement', async () => {
    const parsed = await assertSafeUrl('https://example.com/article', 'URL', { lookup: lookupPublic });
    expect(parsed.hostname).toBe('example.com');
  });

  it('échoue proprement si le hostname n\'est pas résolvable', async () => {
    const lookupFail = jest.fn().mockRejectedValue(new Error('ENOTFOUND'));
    await expect(assertSafeUrl('https://inexistant.invalid/', 'URL', { lookup: lookupFail })).rejects.toThrow(/non résolvable/);
  });
});

describe('fetchFollowingSafeRedirects', () => {
  // Voir le commentaire équivalent dans le describe assertSafeUrl ci-dessus
  // (CRA + resetMocks:true).
  let lookupPublic;
  beforeEach(() => { lookupPublic = jest.fn().mockResolvedValue({ address: '93.184.216.34' }); });

  it('renvoie directement la réponse quand il n\'y a pas de redirection', async () => {
    const axiosGet = jest.fn().mockResolvedValue({ status: 200, data: '<html></html>' });
    const res = await fetchFollowingSafeRedirects('https://example.com/article', {}, { axiosGet, lookup: lookupPublic });
    expect(res.status).toBe(200);
    expect(axiosGet).toHaveBeenCalledTimes(1);
    expect(axiosGet).toHaveBeenCalledWith('https://example.com/article', expect.objectContaining({ maxRedirects: 0 }));
  });

  // Régression du 31 août 2026 : maxRedirects:0 seul faisait échouer TOUT
  // scraping d'une URL qui redirige (trailing slash, changement de slug --
  // très courant), avec "Request failed with status code 301" -- message qui
  // ne disait même pas vers où. Une redirection légitime doit être suivie.
  it('suit une redirection 301 vers une URL publique', async () => {
    const axiosGet = jest.fn()
      .mockResolvedValueOnce({ status: 301, headers: { location: 'https://example.com/nouvel-article' } })
      .mockResolvedValueOnce({ status: 200, data: '<html>ok</html>' });
    const res = await fetchFollowingSafeRedirects('https://example.com/vieil-article', {}, { axiosGet, lookup: lookupPublic });
    expect(res.status).toBe(200);
    expect(axiosGet).toHaveBeenCalledTimes(2);
    expect(axiosGet).toHaveBeenNthCalledWith(2, 'https://example.com/nouvel-article', expect.anything());
  });

  it('résout une redirection vers un chemin relatif', async () => {
    const axiosGet = jest.fn()
      .mockResolvedValueOnce({ status: 302, headers: { location: '/nouvel-article/' } })
      .mockResolvedValueOnce({ status: 200, data: 'ok' });
    await fetchFollowingSafeRedirects('https://example.com/vieil-article', {}, { axiosGet, lookup: lookupPublic });
    expect(axiosGet).toHaveBeenNthCalledWith(2, 'https://example.com/nouvel-article/', expect.anything());
  });

  it('refuse une redirection vers une ressource interne (SSRF-via-redirection)', async () => {
    const axiosGet = jest.fn()
      .mockResolvedValueOnce({ status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data/' } });
    await expect(fetchFollowingSafeRedirects('https://example.com/article', {}, { axiosGet, lookup: lookupPublic }))
      .rejects.toThrow(/interne/);
  });

  it('échoue proprement sur une redirection sans en-tête Location', async () => {
    const axiosGet = jest.fn().mockResolvedValue({ status: 301, headers: {} });
    await expect(fetchFollowingSafeRedirects('https://example.com/article', {}, { axiosGet, lookup: lookupPublic }))
      .rejects.toThrow(/sans en-tête Location/);
  });

  it('borne le nombre de sauts -- jamais de boucle infinie sur des redirections en chaîne', async () => {
    const axiosGet = jest.fn().mockResolvedValue({ status: 301, headers: { location: 'https://example.com/boucle' } });
    await expect(fetchFollowingSafeRedirects('https://example.com/depart', {}, { axiosGet, lookup: lookupPublic, maxRedirects: 2 }))
      .rejects.toThrow(/Trop de redirections/);
    expect(axiosGet).toHaveBeenCalledTimes(3); // hop 0, 1, 2 -- puis échec
  });

  it('exporte une limite par défaut raisonnable', () => {
    expect(DEFAULT_MAX_REDIRECTS).toBeGreaterThan(0);
    expect(DEFAULT_MAX_REDIRECTS).toBeLessThanOrEqual(10);
  });
});
