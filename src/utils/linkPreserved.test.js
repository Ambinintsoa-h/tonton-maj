/**
 * linkPreserved.test.js — VERROU du bouton « Réécrire » manuel sur un passage
 * avec lien : un lien de l'original doit ressortir À L'IDENTIQUE, sinon la
 * réécriture est refusée (voir ArticleResult.jsx, applyRewrite).
 */
import { liensManquants } from './linkPreserved';

describe('liensManquants', () => {
  it('rien à signaler quand l\'original ne contenait aucun lien', () => {
    expect(liensManquants('<p>Aucun lien ici.</p>', '<p>Toujours aucun.</p>')).toEqual([]);
  });

  it('rien à signaler quand le lien ressort à l\'identique', () => {
    const original = 'Le <a href="/guide">guide complet</a> explique tout.';
    const reecrit = 'Consultez le <a href="/guide">guide complet</a> pour tout savoir.';
    expect(liensManquants(original, reecrit)).toEqual([]);
  });

  it('signale un lien dont le HREF a changé', () => {
    const original = 'Voir <a href="/guide">le guide</a>.';
    const reecrit = 'Voir <a href="/autre-page">le guide</a>.';
    expect(liensManquants(original, reecrit)).toEqual([{ href: '/guide', texte: 'le guide' }]);
  });

  it('signale un lien dont le TEXTE D\'ANCRE a changé', () => {
    const original = 'Voir <a href="/guide">le guide</a>.';
    const reecrit = 'Voir <a href="/guide">notre dossier</a>.';
    expect(liensManquants(original, reecrit)).toEqual([{ href: '/guide', texte: 'le guide' }]);
  });

  it('signale un lien totalement disparu (délié)', () => {
    const original = 'Voir <a href="/guide">le guide</a>.';
    const reecrit = 'Voir le guide.';
    expect(liensManquants(original, reecrit)).toEqual([{ href: '/guide', texte: 'le guide' }]);
  });

  it('gère plusieurs liens indépendamment', () => {
    const original = '<a href="/a">Un</a> et <a href="/b">Deux</a>.';
    const reecrit = '<a href="/a">Un</a> seulement.'; // « Deux » perdu
    expect(liensManquants(original, reecrit)).toEqual([{ href: '/b', texte: 'Deux' }]);
  });

  it('un lien INTERNE compte autant qu\'un lien EXTERNE — pas de filtre par domaine', () => {
    // Contrairement à enforceExternalLinkPolicy (diff.js), qui ne couvre QUE
    // l'externe : ici les deux domaines sont traités pareil (« garder
    // ABSOLUMENT les liens »).
    const original = '<a href="/page-interne">interne</a> et <a href="https://autre-site.fr">externe</a>.';
    expect(liensManquants(original, '<a href="/page-interne">interne</a>.'))
      .toEqual([{ href: 'https://autre-site.fr', texte: 'externe' }]);
  });

  it('les espaces internes du texte d\'ancre sont normalisés avant comparaison', () => {
    const original = 'Voir <a href="/guide">le   guide\ncomplet</a>.';
    const reecrit = 'Voir <a href="/guide">le guide complet</a>, très bien fait.';
    expect(liensManquants(original, reecrit)).toEqual([]);
  });
});
