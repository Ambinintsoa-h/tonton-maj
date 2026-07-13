// Tests du VERROU LIENS EXTERNES (règle absolue) — enforceExternalLinkPolicy
/* eslint-env jest */
import { enforceExternalLinkPolicy, applyAllDiffs, filterSameSiteLinks } from './diff';

const ARTICLE_URL = 'https://isolation-phonique.com/mon-article';

describe('enforceExternalLinkPolicy', () => {
  test('lien externe AJOUTÉ par l\'IA → désenveloppé (texte conservé, balise retirée)', () => {
    const { update, blocked } = enforceExternalLinkPolicy({
      original: '<p>Le prix moyen est de 40 €/m².</p>',
      updated:  '<p>Le prix moyen est de 50 €/m² selon <a href="https://concurrent.com/etude">cette étude</a>.</p>',
    }, ARTICLE_URL);
    expect(blocked).toBe(false);
    expect(update.updated).not.toContain('<a');
    expect(update.updated).toContain('cette étude');
  });

  test('lien externe PRÉSERVÉ tel quel dans updated → aucune modification', () => {
    const upd = {
      original: '<p>Voir <a href="https://ademe.fr/guide" rel="noopener">le guide ADEME</a> pour 2024.</p>',
      updated:  '<p>Voir <a href="https://ademe.fr/guide" rel="noopener">le guide ADEME</a> pour 2026.</p>',
    };
    const { update, blocked } = enforceExternalLinkPolicy(upd, ARTICLE_URL);
    expect(blocked).toBe(false);
    expect(update.updated).toBe(upd.updated);
  });

  test('lien externe SUPPRIMÉ mais ancre encore présente → ré-enveloppé avec ses attributs', () => {
    const { update, blocked } = enforceExternalLinkPolicy({
      original: '<p>Selon <a href="https://ademe.fr/guide" rel="noopener">le guide ADEME</a>, comptez 40 €.</p>',
      updated:  '<p>Selon le guide ADEME, comptez 55 € en 2026.</p>',
    }, ARTICLE_URL);
    expect(blocked).toBe(false);
    expect(update.updated).toContain('href="https://ademe.fr/guide"');
    expect(update.updated).toContain('rel="noopener"');
    expect(update.updated).toContain('>le guide ADEME</a>');
  });

  test('lien externe SUPPRIMÉ et ancre disparue → update REJETÉE', () => {
    const { blocked } = enforceExternalLinkPolicy({
      original: '<p>Selon <a href="https://ademe.fr/guide">le guide ADEME</a>, comptez 40 €.</p>',
      updated:  '<p>Comptez environ 55 € en 2026.</p>',
    }, ARTICLE_URL);
    expect(blocked).toBe(true);
  });

  test('liens INTERNES (même domaine) : ajout et retrait libres', () => {
    const add = enforceExternalLinkPolicy({
      original: '<p>Voir notre guide.</p>',
      updated:  '<p>Voir <a href="https://isolation-phonique.com/guide">notre guide</a>.</p>',
    }, ARTICLE_URL);
    expect(add.blocked).toBe(false);
    expect(add.update.updated).toContain('href="https://isolation-phonique.com/guide"');

    const remove = enforceExternalLinkPolicy({
      original: '<p>Voir <a href="https://www.isolation-phonique.com/guide">notre guide</a>.</p>',
      updated:  '<p>Voir notre guide mis à jour.</p>',
    }, ARTICLE_URL);
    expect(remove.blocked).toBe(false);
  });

  test('suppression pure d\'un passage contenant un lien externe → REJETÉE', () => {
    const { blocked } = enforceExternalLinkPolicy({
      type: 'suppression',
      original: '<p>Paragraphe redondant avec <a href="https://source.org/x">une source</a>.</p>',
    }, ARTICLE_URL);
    expect(blocked).toBe(true);
  });

  test('addition : tout lien externe inséré est désenveloppé', () => {
    const { update, blocked } = enforceExternalLinkPolicy({
      type: 'addition',
      anchor: 'Une phrase.',
      updated: '<p>Nouveau paragraphe avec <a href="https://exemple.org">un lien</a> et <a href="/interne">un relatif</a>.</p>',
    }, ARTICLE_URL);
    expect(blocked).toBe(false);
    expect(update.updated).not.toContain('exemple.org');
    expect(update.updated).toContain('un lien');
    expect(update.updated).toContain('href="/interne"'); // relatif = interne, conservé
  });

  test('sans URL d\'article connue : tout lien http absolu est traité comme externe', () => {
    const { update } = enforceExternalLinkPolicy({
      original: '<p>Texte.</p>',
      updated:  '<p>Texte avec <a href="https://nimporte.com">lien</a>.</p>',
    }, '');
    expect(update.updated).not.toContain('<a');
  });
});

describe('applyAllDiffs — intégration du verrou', () => {
  test('une update qui supprimerait un lien externe est bloquée (article intact)', () => {
    const html = '<p>Selon <a href="https://ademe.fr/guide">le guide officiel</a>, comptez 40 euros.</p>';
    const { html: out, updates } = applyAllDiffs(html, [{
      original: 'Selon <a href="https://ademe.fr/guide">le guide officiel</a>, comptez 40 euros.',
      updated:  'Comptez 55 euros en 2026.',
      reason:   'prix 2026',
    }], 1, ARTICLE_URL);
    expect(updates[0].applied).toBe(false);
    expect(updates[0].blockedReason).toBe('lien-externe');
    expect(out).toContain('href="https://ademe.fr/guide"');
  });

  test('une update qui garde le lien externe passe normalement', () => {
    const html = '<p>Selon <a href="https://ademe.fr/guide">le guide officiel</a>, comptez 40 euros.</p>';
    const { html: out, updates } = applyAllDiffs(html, [{
      original: 'comptez 40 euros',
      updated:  'comptez 55 euros',
      reason:   'prix 2026',
    }], 1, ARTICLE_URL);
    expect(updates[0].applied).toBe(true);
    expect(out).toContain('href="https://ademe.fr/guide"');
    expect(out).toContain('55 euros');
  });
});

describe('filterSameSiteLinks — verrou maillage (URLs hallucinées)', () => {
  const links = [
    { anchor: 'a', url: 'https://monsite.fr/guide', title: 'Guide' },
    { anchor: 'b', url: 'https://www.monsite.fr/prix', title: 'Prix' },
    { anchor: 'c', url: '/relatif', title: 'Relatif' },
    { anchor: 'd', url: 'https://concurrent.com/page', title: 'Externe halluciné' },
    { anchor: 'e', url: 'mailto:x@y.z', title: 'Mail' },
  ];

  it('ne garde que le domaine de l\'article (www ignoré) + chemins relatifs', () => {
    const kept = filterSameSiteLinks(links, 'https://monsite.fr/article');
    expect(kept.map(l => l.anchor)).toEqual(['a', 'b', 'c']);
  });

  it('sans URL d\'article : seuls les chemins relatifs passent (protection max)', () => {
    const kept = filterSameSiteLinks(links, '');
    expect(kept.map(l => l.anchor)).toEqual(['c']);
  });

  it('liste vide / entrées invalides → rien ne casse', () => {
    expect(filterSameSiteLinks([], 'https://monsite.fr')).toEqual([]);
    expect(filterSameSiteLinks([{ anchor: 'x' }], 'https://monsite.fr')).toEqual([]);
  });
});
