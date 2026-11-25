/**
 * googleSheetsClient.js — authentification "compte de service" (JWT Bearer,
 * RFC 7523) vers l'API Google Sheets, SANS dépendance supplémentaire :
 * `jsonwebtoken` (déjà utilisé pour les jetons internes) sait signer en
 * RS256, et `axios` (déjà une dépendance) suffit pour les deux appels HTTP
 * nécessaires (échange du jeton, puis lecture des valeurs). Ajouter
 * `googleapis` ou `google-auth-library` n'aurait fait qu'ajouter du poids
 * pour UNE seule opération en lecture seule.
 */
const jwt = require('jsonwebtoken');
const axios = require('axios');

const SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';
// Écriture : utilisée UNIQUEMENT par l'export « MAJ » (majSheetExport.js). La
// lecture entrante (gsheet-sync) garde son scope lecture seule, inchangé.
const SCOPE_WRITE = 'https://www.googleapis.com/auth/spreadsheets';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

// Jetons d'accès mis en cache ~55 min (durée réelle 1h côté Google) -- évite
// de re-signer un JWT et de ré-échanger un jeton à CHAQUE tick du cron
// (toutes les 5 min), pour rien : le compte de service ne change jamais.
// Un cache PAR SCOPE (et par compte) : avec un cache unique, un jeton en lecture
// seule serait resservi à une écriture (403), ou l'inverse -- un jeton
// d'écriture prêté à la lecture entrante élargirait ses droits sans le dire.
const tokenCache = new Map(); // `${client_email}|${scope}` -> { token, expiry }

const fetchAccessToken = async (serviceAccount, scope) => {
  const now = Math.floor(Date.now() / 1000);
  const assertion = jwt.sign(
    {
      iss: serviceAccount.client_email,
      scope,
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
    },
    serviceAccount.private_key,
    { algorithm: 'RS256' },
  );
  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion,
  }).toString();
  const { data } = await axios.post(TOKEN_URL, body, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  return data.access_token;
};

const getAccessToken = async (serviceAccount, scope = SCOPE) => {
  const key = `${serviceAccount.client_email}|${scope}`;
  const hit = tokenCache.get(key);
  if (hit && Date.now() < hit.expiry) return hit.token;
  const token = await fetchAccessToken(serviceAccount, scope);
  tokenCache.set(key, { token, expiry: Date.now() + 55 * 60 * 1000 });
  return token;
};

// "https://docs.google.com/spreadsheets/d/ID/edit?gid=0#gid=0" -> "ID".
// Tolère aussi un ID déjà nu, pour ne pas forcer un format précis dans le
// champ de réglage -- coller l'URL entière ou juste l'ID doivent marcher.
const extractSpreadsheetId = (urlOrId) => {
  const s = String(urlOrId || '').trim();
  const m = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : s;
};

/**
 * @param {object} serviceAccount — JSON.parse() du fichier de clé (client_email + private_key)
 * @param {string} spreadsheetIdOrUrl
 * @param {string} [range] — ex. "Feuille 1" ; par défaut, tout le premier onglet
 * @returns {Promise<Array<Array<string>>>} lignes brutes, même forme que
 *   XLSX.utils.sheet_to_json(ws, {header:1}) côté import .xlsx (src/utils/batchSheetImport.js)
 */
const fetchSheetValues = async (serviceAccount, spreadsheetIdOrUrl, range = 'A:Z') => {
  const spreadsheetId = extractSpreadsheetId(spreadsheetIdOrUrl);
  const token = await getAccessToken(serviceAccount);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`;
  const { data } = await axios.get(url, { headers: { Authorization: `Bearer ${token}` } });
  return data.values || [];
};

// ─── Écriture (export « MAJ ») ───────────────────────────────────────────────

// Nom d'onglet cité pour A1 : 'Mon onglet'!A1 (apostrophes doublées).
const quoteTab = (tab) => `'${String(tab).replace(/'/g, "''")}'`;

/**
 * REMPLACE tout le contenu d'UN onglet : values.clear puis values.update.
 * N'écrit jamais ailleurs : chaque plage est préfixée par le nom de l'onglet,
 * et un nom vide est refusé (une plage sans onglet viserait le premier onglet
 * du classeur -- potentiellement celui de la rédac). L'onglet est créé s'il
 * manque ; ni les autres onglets ni leurs cellules ne sont touchés.
 * Écriture en RAW : une valeur qui commence par « = » reste du texte, jamais
 * une formule évaluée (mots-clés, titres, consignes viennent d'humains).
 *
 * @param {object} serviceAccount
 * @param {string} spreadsheetIdOrUrl
 * @param {string} tabName
 * @param {Array<Array<string|number>>} rows  en-tête incluse (ligne 1)
 * @returns {Promise<{ rows:number }>}
 */
const replaceTabValues = async (serviceAccount, spreadsheetIdOrUrl, tabName, rows) => {
  const tab = String(tabName || '').trim();
  if (!tab) throw new Error("Nom d'onglet requis pour écrire dans le Google Sheet");
  const spreadsheetId = extractSpreadsheetId(spreadsheetIdOrUrl);
  if (!spreadsheetId) throw new Error('Identifiant du Google Sheet manquant');
  const token = await getAccessToken(serviceAccount, SCOPE_WRITE);
  const headers = { Authorization: `Bearer ${token}` };
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}`;

  const { data: meta } = await axios.get(`${base}?fields=sheets.properties.title`, { headers });
  const exists = (meta.sheets || []).some((s) => s.properties && s.properties.title === tab);
  if (!exists) {
    await axios.post(`${base}:batchUpdate`, { requests: [{ addSheet: { properties: { title: tab } } }] }, { headers });
  }

  const clearRange = encodeURIComponent(quoteTab(tab));
  await axios.post(`${base}/values/${clearRange}:clear`, {}, { headers });
  const updateRange = encodeURIComponent(`${quoteTab(tab)}!A1`);
  await axios.put(
    `${base}/values/${updateRange}?valueInputOption=RAW`,
    { majorDimension: 'ROWS', values: rows },
    { headers },
  );
  return { rows: rows.length };
};

/**
 * Crée l'onglet s'il manque et n'y écrit l'en-tête QUE dans ce cas. Un onglet
 * qui existe déjà n'est jamais touché : il est rempli par quelqu'un d'autre
 * (onglet « Commande MAJ », alimenté par la console).
 * @returns {Promise<{ created:boolean }>}
 */
const ensureTab = async (serviceAccount, spreadsheetIdOrUrl, tabName, headerRow) => {
  const tab = String(tabName || '').trim();
  if (!tab) throw new Error("Nom d'onglet requis pour écrire dans le Google Sheet");
  const spreadsheetId = extractSpreadsheetId(spreadsheetIdOrUrl);
  if (!spreadsheetId) throw new Error('Identifiant du Google Sheet manquant');
  const token = await getAccessToken(serviceAccount, SCOPE_WRITE);
  const headers = { Authorization: `Bearer ${token}` };
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}`;
  const { data: meta } = await axios.get(`${base}?fields=sheets.properties.title`, { headers });
  if ((meta.sheets || []).some((s) => s.properties && s.properties.title === tab)) return { created: false };
  await axios.post(`${base}:batchUpdate`, { requests: [{ addSheet: { properties: { title: tab } } }] }, { headers });
  await axios.put(
    `${base}/values/${encodeURIComponent(`${quoteTab(tab)}!A1`)}?valueInputOption=RAW`,
    { majorDimension: 'ROWS', values: [headerRow] },
    { headers },
  );
  return { created: true };
};

module.exports = { fetchSheetValues, replaceTabValues, ensureTab, quoteTab, extractSpreadsheetId, getAccessToken, SCOPE, SCOPE_WRITE };
