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
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

// Jeton d'accès mis en cache ~55 min (durée réelle 1h côté Google) -- évite
// de re-signer un JWT et de ré-échanger un jeton à CHAQUE tick du cron
// (toutes les 5 min), pour rien : le compte de service ne change jamais.
let cachedToken = null;
let cachedTokenExpiry = 0;

const fetchAccessToken = async (serviceAccount) => {
  const now = Math.floor(Date.now() / 1000);
  const assertion = jwt.sign(
    {
      iss: serviceAccount.client_email,
      scope: SCOPE,
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

const getAccessToken = async (serviceAccount) => {
  if (cachedToken && Date.now() < cachedTokenExpiry) return cachedToken;
  const token = await fetchAccessToken(serviceAccount);
  cachedToken = token;
  cachedTokenExpiry = Date.now() + 55 * 60 * 1000;
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

module.exports = { fetchSheetValues, extractSpreadsheetId, getAccessToken };
