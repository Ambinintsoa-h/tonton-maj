jest.mock('axios');
jest.mock('jsonwebtoken');

const SA = { client_email: 'robot@proj.iam.gserviceaccount.com', private_key: 'KEY' };

// resetModules : le cache de jetons du module repart à vide à chaque test ;
// axios/jwt sont donc relus APRÈS le reset (même instance que celle du client).
// Les implémentations sont posées ici : CRA vide les mocks entre deux tests.
let client; let axios; let jwt;
beforeEach(() => {
  jest.resetModules();
  axios = require('axios');
  jwt = require('jsonwebtoken');
  client = require('./googleSheetsClient');
  jwt.sign.mockImplementation((payload) => `jwt:${payload.scope}`);
  axios.post.mockImplementation(async (url) => (
    url === 'https://oauth2.googleapis.com/token' ? { data: { access_token: 'tok' } } : { data: {} }
  ));
  axios.get.mockResolvedValue({ data: { sheets: [{ properties: { title: 'MAJ' } }] } });
  axios.put.mockResolvedValue({ data: {} });
});

describe('cache du jeton par scope', () => {
  it('la lecture garde le scope lecture seule', async () => {
    await client.getAccessToken(SA);
    expect(jwt.sign.mock.calls[0][0].scope).toBe('https://www.googleapis.com/auth/spreadsheets.readonly');
  });

  it('lecture et écriture ont chacune leur jeton, jamais partagé', async () => {
    await client.getAccessToken(SA);                       // lecture
    await client.getAccessToken(SA, client.SCOPE_WRITE);   // écriture
    expect(jwt.sign).toHaveBeenCalledTimes(2);
    expect(jwt.sign.mock.calls[1][0].scope).toBe('https://www.googleapis.com/auth/spreadsheets');
    await client.getAccessToken(SA);                       // lecture, en cache
    await client.getAccessToken(SA, client.SCOPE_WRITE);   // écriture, en cache
    expect(jwt.sign).toHaveBeenCalledTimes(2);
  });
});

describe('replaceTabValues', () => {
  const rows = [['Site', 'URL'], ['a.com', 'https://a.com/x'], ['=1+1', 'b']];

  it('vide puis écrit, UNIQUEMENT dans l\'onglet demandé, en RAW, avec le scope écriture', async () => {
    const out = await client.replaceTabValues(SA, 'https://docs.google.com/spreadsheets/d/SHEET123/edit', 'MAJ', rows);
    expect(out).toEqual({ rows: 3 });
    expect(jwt.sign.mock.calls[0][0].scope).toBe('https://www.googleapis.com/auth/spreadsheets');

    const clear = axios.post.mock.calls.find(([u]) => u.includes(':clear'));
    expect(decodeURIComponent(clear[0])).toBe("https://sheets.googleapis.com/v4/spreadsheets/SHEET123/values/'MAJ':clear");

    const [putUrl, body] = axios.put.mock.calls[0];
    expect(decodeURIComponent(putUrl)).toBe("https://sheets.googleapis.com/v4/spreadsheets/SHEET123/values/'MAJ'!A1?valueInputOption=RAW");
    expect(body.values).toBe(rows);

    // clear avant update
    expect(axios.post.mock.invocationCallOrder[axios.post.mock.calls.indexOf(clear)])
      .toBeLessThan(axios.put.mock.invocationCallOrder[0]);
  });

  it('ne crée pas l\'onglet quand il existe déjà', async () => {
    await client.replaceTabValues(SA, 'SHEET123', 'MAJ', rows);
    expect(axios.post.mock.calls.some(([u]) => u.endsWith(':batchUpdate'))).toBe(false);
  });

  it('crée l\'onglet manquant (seul changement de structure), puis écrit', async () => {
    axios.get.mockResolvedValue({ data: { sheets: [{ properties: { title: 'Autre' } }] } });
    await client.replaceTabValues(SA, 'SHEET123', 'MAJ', rows);
    const add = axios.post.mock.calls.find(([u]) => u.endsWith(':batchUpdate'));
    expect(add[1]).toEqual({ requests: [{ addSheet: { properties: { title: 'MAJ' } } }] });
  });

  it('double les apostrophes d\'un nom d\'onglet', async () => {
    axios.get.mockResolvedValue({ data: { sheets: [{ properties: { title: "L'onglet" } }] } });
    await client.replaceTabValues(SA, 'SHEET123', "L'onglet", rows);
    expect(decodeURIComponent(axios.put.mock.calls[0][0])).toContain("values/'L''onglet'!A1");
  });

  it('refuse un onglet vide ou un Sheet vide : aucun appel réseau', async () => {
    await expect(client.replaceTabValues(SA, 'SHEET123', '  ', rows)).rejects.toThrow(/onglet/i);
    await expect(client.replaceTabValues(SA, '', 'MAJ', rows)).rejects.toThrow(/identifiant/i);
    expect(axios.post).not.toHaveBeenCalled();
    expect(axios.put).not.toHaveBeenCalled();
  });
});

describe('ensureTab', () => {
  const header = ['N°', 'URL'];

  it('onglet absent : le crée et n\'y écrit QUE l\'en-tête', async () => {
    axios.get.mockResolvedValue({ data: { sheets: [{ properties: { title: 'MAJ' } }] } });
    const out = await client.ensureTab(SA, 'SHEET123', 'Commande MAJ', header);
    expect(out).toEqual({ created: true });
    const add = axios.post.mock.calls.find(([u]) => u.endsWith(':batchUpdate'));
    expect(add[1]).toEqual({ requests: [{ addSheet: { properties: { title: 'Commande MAJ' } } }] });
    expect(axios.put).toHaveBeenCalledTimes(1);
    const [putUrl, body] = axios.put.mock.calls[0];
    expect(decodeURIComponent(putUrl)).toContain("values/'Commande MAJ'!A1");
    expect(body.values).toEqual([header]);
    expect(axios.post.mock.calls.some(([u]) => u.includes(':clear'))).toBe(false);
  });

  it('onglet déjà là (rempli par la console) : aucune écriture, aucun effacement', async () => {
    axios.get.mockResolvedValue({ data: { sheets: [{ properties: { title: 'Commande MAJ' } }] } });
    const out = await client.ensureTab(SA, 'SHEET123', 'Commande MAJ', header);
    expect(out).toEqual({ created: false });
    expect(axios.put).not.toHaveBeenCalled();
    expect(axios.post.mock.calls.some(([u]) => u.endsWith(':batchUpdate') || u.includes(':clear'))).toBe(false);
  });
});
