/* eslint-env jest */
/**
 * PARITÉ — la politique des liens existe en DEUX exemplaires : client
 * (`applyLinkFollowPolicy`, src/utils/export.js, publication) et serveur
 * (`appliquerPolitiqueSuivi`, src/server/linkFollowPolicy.js, wp_update_post).
 * Deux implémentations qui divergent, c'est un faux verrou : ce test les fait
 * tourner sur la même table de cas et exige le même résultat.
 */
import { applyLinkFollowPolicy, applyLinkFollowPolicyHtml, applyLinkFollowPolicyToUpdates } from '../utils/export';

const { appliquerPolitiqueSuivi } = require('./linkFollowPolicy');

const SITE = 'https://ludikbazar.com/article/';
const CAS = [
  '<p><a href="https://ademe.fr/guide" rel="noopener">x</a></p>',
  '<p><a href="https://ludum.fr/?aff=1">x</a></p>',
  '<p><a href="https://b.fr" rel="sponsored">x</a></p>',
  '<p><a href="https://b.fr" rel="NoFollow">x</a></p>',
  '<p><a href="//evil.com/x">x</a></p>',
  '<p><a href="/guide" rel="nofollow">x</a></p>',
  '<p><a href="https://www.ludikbazar.com/b" rel="nofollow noopener">x</a></p>',
  '<p><a href="https://ludikbazar.com/c" rel="ugc sponsored">x</a></p>',
  '<p><a href="mailto:a@b.fr">m</a><a href="#faq">f</a><a href="tel:01">t</a></p>',
  '<p><a href="/a" rel="  noopener   noreferrer  ">x</a></p>',
];

const rejouer = (fn, html) => {
  const div = document.createElement('div');
  div.innerHTML = html;
  const bilan = fn(div, SITE);
  return { html: div.innerHTML, bilan };
};

describe('client et serveur appliquent EXACTEMENT la même politique', () => {
  test.each(CAS)('%s', (html) => {
    const client = rejouer(applyLinkFollowPolicy, html);
    const serveur = rejouer(appliquerPolitiqueSuivi, html);
    expect(serveur.html).toBe(client.html);
    expect(serveur.bilan).toEqual(client.bilan);
  });
});

describe('applyLinkFollowPolicyHtml — la politique DANS l\'outil (21/10/2026)', () => {
  test('externe passé en nofollow, compté', () => {
    const r = applyLinkFollowPolicyHtml('<p><a href="https://ademe.fr">x</a></p>', SITE);
    expect(r.html).toBe('<p><a href="https://ademe.fr" rel="nofollow">x</a></p>');
    expect(r.nofollowAjoutes).toBe(1);
  });

  test('rien à changer : la chaîne d\'origine est rendue telle quelle', () => {
    const html = '<p><a href="https://ademe.fr"   rel="nofollow">x</a>&nbsp;</p>';
    expect(applyLinkFollowPolicyHtml(html, SITE).html).toBe(html);
  });

  test('propositions d\'obsolescence : `updated` traité, le reste intact ; sans URL, rien ne bouge', () => {
    const updates = [
      { original: 'a', updated: '<p>Selon <a href="https://insee.fr/x">l\'Insee</a>.</p>', source: 'https://insee.fr/x' },
      { type: 'suppression', original: 'b', updated: '' },
    ];
    const r = applyLinkFollowPolicyToUpdates(updates, SITE);
    expect(r[0].updated).toBe('<p>Selon <a href="https://insee.fr/x" rel="nofollow">l\'Insee</a>.</p>');
    expect(r[0].source).toBe('https://insee.fr/x');
    expect(r[1]).toEqual(updates[1]);
    expect(applyLinkFollowPolicyToUpdates(updates, '')).toBe(updates);
  });
});
