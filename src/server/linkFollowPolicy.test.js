/**
 * @jest-environment node
 */
// Environnement NODE : ce test construit le DOM avec la bibliothèque jsdom, comme
// le serveur (elle ne se charge pas dans l'environnement jsdom de Jest).
/* eslint-env jest */
/**
 * VERROU SERVEUR — liens externes en nofollow (décision Andrianina, 21/10/2026).
 * `politiqueSuiviHtml` est appelée par `wp_update_post` (proxy.js) sur tout
 * contenu envoyé à WordPress.
 */
const fs = require('fs');
const path = require('path');
const { politiqueSuiviHtml } = require('./linkFollowPolicy');

const SITE = 'https://ludikbazar.com';

describe('politiqueSuiviHtml — ce que le serveur envoie à WordPress', () => {
  test('un lien EXTERNE reçoit nofollow, ses autres jetons sont conservés', () => {
    const r = politiqueSuiviHtml('<p>Voir <a href="https://ademe.fr/guide" rel="noopener" target="_blank">le guide</a>.</p>', SITE);
    expect(r.html).toBe('<p>Voir <a href="https://ademe.fr/guide" rel="noopener nofollow" target="_blank">le guide</a>.</p>');
    expect(r.nofollowAjoutes).toBe(1);
  });

  test('sans rel, nofollow est posé ; sponsored déjà présent est gardé', () => {
    const r = politiqueSuiviHtml('<p><a href="https://ludum.fr/?aff=1">a</a> <a href="https://b.fr" rel="sponsored">b</a></p>', SITE);
    expect(r.html).toBe('<p><a href="https://ludum.fr/?aff=1" rel="nofollow">a</a> <a href="https://b.fr" rel="sponsored nofollow">b</a></p>');
    expect(r.nofollowAjoutes).toBe(2);
  });

  test('protocol-relative vers un autre site = externe', () => {
    expect(politiqueSuiviHtml('<a href="//evil.com/x">x</a>', SITE).html).toBe('<a href="//evil.com/x" rel="nofollow">x</a>');
  });

  test('un lien INTERNE (relatif, absolu, avec ou sans www) perd ses bloqueurs', () => {
    const r = politiqueSuiviHtml('<p><a href="/guide" rel="nofollow">a</a> <a href="https://www.ludikbazar.com/b" rel="nofollow noopener">b</a></p>', SITE);
    expect(r.html).toBe('<p><a href="/guide">a</a> <a href="https://www.ludikbazar.com/b" rel="noopener">b</a></p>');
    expect(r.bloqueursRetires).toBe(2);
  });

  test('mailto, tel et ancres ne sont jamais touchés', () => {
    const html = '<p><a href="mailto:a@b.fr">m</a> <a href="tel:0102">t</a> <a href="#faq">f</a></p>';
    expect(politiqueSuiviHtml(html, SITE).html).toBe(html);
  });

  test('contenu déjà conforme : rendu OCTET POUR OCTET, sans re-sérialisation', () => {
    const html = '<!-- MAJ par Andy le 2026-10-21 -->\n<p><a href="https://ademe.fr"  rel="nofollow">x</a>&nbsp;<br></p>';
    const r = politiqueSuiviHtml(html, SITE);
    expect(r.html).toBe(html);
    expect(r.nofollowAjoutes + r.bloqueursRetires).toBe(0);
  });

  test('commentaire de signature et JSON-LD survivent à la réécriture', () => {
    const html = '<!-- MAJ par Andy le 2026-10-21 -->\n<p><a href="https://ademe.fr">x</a></p>'
      + '<script type="application/ld+json">{"@type":"FAQPage","a":"<b>"}</script>';
    const r = politiqueSuiviHtml(html, SITE);
    expect(r.html).toContain('<!-- MAJ par Andy le 2026-10-21 -->');
    expect(r.html).toContain('<script type="application/ld+json">{"@type":"FAQPage","a":"<b>"}</script>');
    expect(r.html).toContain('rel="nofollow"');
  });

  test('contenu sans lien ou non textuel : renvoyé tel quel', () => {
    expect(politiqueSuiviHtml('<p>Rien.</p>', SITE).html).toBe('<p>Rien.</p>');
    expect(politiqueSuiviHtml(undefined, SITE).html).toBeUndefined();
  });
});

describe('VERROU proxy.js — wp_update_post passe par la politique', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'proxy.js'), 'utf8');
  test('le contenu envoyé à WordPress est celui rendu par politiqueSuiviHtml, avec l\'URL du site', () => {
    const route = src.slice(src.indexOf("case 'wp_update_post'"), src.indexOf("case 'wp_update_post'") + 2500);
    expect(route).toMatch(/politiqueSuiviHtml\(content, site\.url\)/);
    expect(route).toMatch(/body\.content = suivi\.html;/);
    expect(route).not.toMatch(/body\.content\s*=\s*content;/);
  });
});
