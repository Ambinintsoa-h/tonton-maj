'use strict';
/**
 * src/server/linkFollowPolicy.js — VERROU SERVEUR de la politique des liens.
 *
 * Décision Andrianina du 21/10/2026 : « les liens externes dans Tonton doivent
 * TOUS être en nofollow » — point déclaré très important.
 *
 * La politique existait déjà côté client (`applyLinkFollowPolicy`,
 * src/utils/export.js, appelée par `exportAsHtml` au moment de publier). Mais
 * c'était une garantie CLIENT : un autre chemin d'écriture vers WordPress (un
 * futur bouton, un script, l'outil `wp_update_post` exposé au modèle, une version
 * du navigateur restée en cache) l'aurait contournée sans bruit. Ce module la
 * rejoue sur le SERVEUR, dans `wp_update_post` (proxy.js), dernière porte avant
 * WordPress : plus rien ne part avec un lien externe suivi.
 *
 * MIROIR EXACT de `applyLinkFollowPolicy` (même règles, mêmes jetons) — la
 * parité est verrouillée par linkFollowPolicy.parite.test.js :
 *   • EXTERNE (autre domaine que le site WordPress) → `nofollow` AJOUTÉ ;
 *     `noopener`, `noreferrer`, `sponsored`, `ugc` et tout autre jeton conservés.
 *   • INTERNE (même domaine, ou chemin relatif) → `nofollow`, `ugc`,
 *     `sponsored` RETIRÉS (le maillage interne doit transmettre).
 * La référence est l'URL du SITE où l'on publie (site.url), pas celle saisie
 * côté client : c'est le seul fait certain au moment d'écrire.
 */

const BLOQUEURS = new Set(['nofollow', 'ugc', 'sponsored']);

const hostDe = (u = '') => {
  try { return new URL(String(u), 'https://x.invalid').hostname.replace(/^www\./, '') || null; }
  catch { return null; }
};

/**
 * Applique la politique aux <a> d'un élément DOM (n'importe quelle implémentation).
 * @returns {{ nofollowAjoutes: number, bloqueursRetires: number }}
 */
const appliquerPolitiqueSuivi = (root, siteUrl = '') => {
  const bilan = { nofollowAjoutes: 0, bloqueursRetires: 0 };
  if (!root || typeof root.querySelectorAll !== 'function') return bilan;
  const siteHost = hostDe(siteUrl);
  root.querySelectorAll('a[href]').forEach((a) => {
    const href = (a.getAttribute('href') || '').trim();
    if (!href || /^(mailto:|tel:|javascript:|#)/i.test(href)) return;
    const absolu = /^(https?:)?\/\//i.test(href);
    const cible = absolu ? hostDe(href.startsWith('//') ? `https:${href}` : href) : null;
    const externe = absolu && (!siteHost || !cible || cible !== siteHost);
    const tokens = (a.getAttribute('rel') || '').split(/\s+/).filter(Boolean);
    if (externe) {
      if (!tokens.some((t) => t.toLowerCase() === 'nofollow')) {
        tokens.push('nofollow');
        bilan.nofollowAjoutes += 1;
      }
      a.setAttribute('rel', tokens.join(' '));
    } else {
      const kept = tokens.filter((t) => !BLOQUEURS.has(t.toLowerCase()));
      if (kept.length === tokens.length) return;
      if (kept.length === 0) a.removeAttribute('rel');
      else a.setAttribute('rel', kept.join(' '));
      bilan.bloqueursRetires += 1;
    }
  });
  return bilan;
};

/**
 * Même politique sur le HTML envoyé à WordPress. Le contenu n'est re-sérialisé
 * QUE si un lien a changé : un article déjà conforme (le cas normal, puisque le
 * client a déjà appliqué la politique) repart octet pour octet identique.
 *
 * @param {string} html
 * @param {string} siteUrl  URL du site WordPress cible
 * @param {{ JSDOM?: Function }} [deps]
 * @returns {{ html: string, nofollowAjoutes: number, bloqueursRetires: number }}
 */
const politiqueSuiviHtml = (html, siteUrl, deps = {}) => {
  const rien = { html, nofollowAjoutes: 0, bloqueursRetires: 0 };
  if (typeof html !== 'string' || !/<a\b/i.test(html)) return rien;
  const JSDOM = deps.JSDOM || require('jsdom').JSDOM;
  const dom = new JSDOM(`<!DOCTYPE html><html><body>${html}</body></html>`);
  const body = dom.window.document.body;
  const bilan = appliquerPolitiqueSuivi(body, siteUrl);
  if (!bilan.nofollowAjoutes && !bilan.bloqueursRetires) return rien;
  return { html: body.innerHTML, ...bilan };
};

module.exports = { appliquerPolitiqueSuivi, politiqueSuiviHtml, BLOQUEURS };
