/**
 * safeFetch.js — protection SSRF (bloque IP internes/loopback/link-local +
 * DNS rebinding) et suivi de redirections qui la préserve à chaque saut.
 *
 * Extrait de proxy.js pour être testable : le fichier historique définissait
 * ces fonctions inline, jamais couvertes par un test malgré leur rôle
 * sécurité (empêcher un utilisateur de faire fetcher au serveur une URL
 * interne via /api/scrape, /api/wordpress, une image, une feuille CSS...).
 *
 * `maxRedirects: 0` seul (utilisé historiquement par /api/scrape) ne protège
 * de rien s'il se contente de BLOQUER toute redirection : une simple
 * normalisation de site (trailing slash, http → https, changement de slug --
 * très courant sur un article existant) faisait alors échouer tout le
 * scraping avec "Request failed with status code 301", message qui ne dit
 * même pas vers où. Constaté en prod le 31 août 2026 sur un lot réel.
 * `fetchFollowingSafeRedirects` suit un nombre borné de sauts en revalidant
 * CHAQUE cible via `assertSafeUrl` avant de la suivre -- même garantie
 * contre le SSRF-via-redirection (un domaine public ne peut toujours pas
 * rediriger le serveur vers une ressource interne), une redirection
 * légitime est suivie en plus.
 */
const net = require('net');
const dns = require('dns').promises;
const axios = require('axios');

const isPrivateHost = (hostname) => {
  // Résolution IPv4 directe
  if (net.isIPv4(hostname)) {
    const [a, b] = hostname.split('.').map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) // link-local / AWS IMDS
    );
  }
  // IPv6 loopback / ULA / link-local
  if (net.isIPv6(hostname)) {
    const h = hostname.toLowerCase();
    return h === '::1' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80');
  }
  // Noms d'hôtes locaux
  const h = hostname.toLowerCase();
  return h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.localhost');
};

/**
 * @param {string} raw
 * @param {string} [label]
 * @param {{lookup?: function}} [deps] — `dns.lookup` injectable pour les tests
 * @returns {Promise<URL>}
 */
const assertSafeUrl = async (raw, label = 'URL', deps = {}) => {
  const { lookup = dns.lookup } = deps;
  let parsed;
  try { parsed = new URL(raw); } catch { throw new Error(`${label} invalide`); }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`Protocole non autorisé : ${parsed.protocol}`);
  }
  if (isPrivateHost(parsed.hostname)) {
    throw new Error(`Accès réseau interne interdit (${parsed.hostname})`);
  }
  // Résolution DNS : bloque le DNS rebinding (domaine public → IP privée)
  try {
    const { address } = await lookup(parsed.hostname);
    if (isPrivateHost(address)) {
      throw new Error(`Accès réseau interne interdit via DNS (${address})`);
    }
  } catch (e) {
    if (e.message.startsWith('Accès')) throw e;
    throw new Error(`${label} : hostname non résolvable (${parsed.hostname})`);
  }
  return parsed;
};

const DEFAULT_MAX_REDIRECTS = 5;

/**
 * @param {string} initialUrl
 * @param {object} [axiosOpts] — passés tels quels à axios.get (timeout, headers...)
 * @param {{axiosGet?: function, maxRedirects?: number, lookup?: function}} [deps]
 * @returns {Promise<object>} la réponse axios finale (statut < 300)
 */
const fetchFollowingSafeRedirects = async (initialUrl, axiosOpts = {}, deps = {}) => {
  const { axiosGet = axios.get, maxRedirects = DEFAULT_MAX_REDIRECTS, lookup } = deps;
  let url = initialUrl;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const response = await axiosGet(url, {
      ...axiosOpts,
      maxRedirects: 0,
      validateStatus: (s) => (s >= 200 && s < 300) || (s >= 300 && s < 400),
    });
    if (response.status < 300) return response;
    const location = response.headers?.location;
    if (!location) throw new Error(`Redirection ${response.status} sans en-tête Location`);
    const next = new URL(location, url).href;
    await assertSafeUrl(next, 'URL de redirection', { lookup });
    url = next;
  }
  throw new Error(`Trop de redirections (> ${maxRedirects})`);
};

module.exports = { isPrivateHost, assertSafeUrl, fetchFollowingSafeRedirects, DEFAULT_MAX_REDIRECTS };
