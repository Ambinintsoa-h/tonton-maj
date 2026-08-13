// Tests du volet R1 — REPRISE DES LIENS INTERNES DE L'ARTICLE D'ORIGINE.
//
// Règle métier : « tout lien présent dans l'article AVANT est repris et
// réintégré dans le texte généré ». Le verrou de la règle 8 ne couvrait que les
// liens EXTERNES ; un lien INTERNE perdu ne déclenchait rien.
//
// SANCTION ASYMÉTRIQUE, testée ici explicitement :
//   • lien EXTERNE perdu    → REJET (règle 8, statu quo — non-régression) ;
//   • lien INTERNE perdu    → ré-enveloppé si possible, sinon AVERTISSEMENT
//                             NON BLOQUANT (jamais un rejet).
/* eslint-env jest */
import {
  listInternalLinks, carryOverInternalLinks, enforceInternalLinkCarryOver, applyAllDiffs,
} from './diff';

const ARTICLE_URL = 'https://isolation-phonique.com/mon-article';

describe('listInternalLinks — inventaire injecté dans le prompt de refonte', () => {
  test('retient le relatif ET l\'absolu de même domaine, avec leur ancre', () => {
    const html = `<p>Voir <a href="/prix">nos prix</a> et
      <a href="https://isolation-phonique.com/faq">la FAQ</a>.</p>`;
    expect(listInternalLinks(html, ARTICLE_URL)).toEqual([
      { href: '/prix', text: 'nos prix' },
      { href: 'https://isolation-phonique.com/faq', text: 'la FAQ' },
    ]);
  });

  test('ignore les liens EXTERNES (c\'est le verrou de la règle 8 qui les traite)', () => {
    const html = '<p><a href="https://ademe.fr/guide">le guide</a> et <a href="/prix">nos prix</a></p>';
    expect(listInternalLinks(html, ARTICLE_URL)).toEqual([{ href: '/prix', text: 'nos prix' }]);
  });

  test('ignore les ancres purement locales #slug — le sommaire est régénéré à chaque refonte', () => {
    const html = '<p><a href="#tarifs">Tarifs</a> <a href="#faq">FAQ</a> <a href="/prix">Prix</a></p>';
    expect(listInternalLinks(html, ARTICLE_URL)).toEqual([{ href: '/prix', text: 'Prix' }]);
  });

  test('ignore mailto:, tel: et javascript: — ce ne sont pas des liens de maillage', () => {
    const html = '<p><a href="mailto:a@b.fr">écrire</a> <a href="tel:+33100">appeler</a>'
      + ' <a href="javascript:void(0)">rien</a> <a href="/prix">Prix</a></p>';
    expect(listInternalLinks(html, ARTICLE_URL)).toEqual([{ href: '/prix', text: 'Prix' }]);
  });

  test('« /prix » et « https://isolation-phonique.com/prix » = UN SEUL lien (normalisation)', () => {
    const html = '<p><a href="/prix">A</a> puis <a href="https://isolation-phonique.com/prix">B</a>'
      + ' puis <a href="https://www.isolation-phonique.com/prix/">C</a></p>';
    const links = listInternalLinks(html, ARTICLE_URL);
    expect(links).toHaveLength(1);
    expect(links[0].href).toBe('/prix');   // la 1re forme rencontrée est conservée telle quelle
  });

  test('protocol-relative de même hôte → interne', () => {
    const html = '<p><a href="//isolation-phonique.com/prix">Prix</a></p>';
    expect(listInternalLinks(html, ARTICLE_URL)).toEqual([
      { href: '//isolation-phonique.com/prix', text: 'Prix' },
    ]);
  });

  test('sans URL d\'article : seuls les chemins relatifs sont internes (protection maximale)', () => {
    const html = '<p><a href="/prix">Prix</a> <a href="https://isolation-phonique.com/faq">FAQ</a></p>';
    expect(listInternalLinks(html, '')).toEqual([{ href: '/prix', text: 'Prix' }]);
  });

  test('aucun lien interne → tableau vide', () => {
    expect(listInternalLinks('<p>Texte nu</p>', ARTICLE_URL)).toEqual([]);
  });
});

describe('carryOverInternalLinks — reprise des liens internes de l\'original', () => {
  test('lien interne RELATIF conservé par l\'IA → aucune retouche, aucun manquant', () => {
    const original  = '<p>Voir <a href="/prix">nos prix</a>.</p>';
    const rewritten = '<h2>Tarifs</h2><p>Consultez <a href="/prix">nos prix</a> avant de choisir.</p>';
    const r = carryOverInternalLinks(original, rewritten, ARTICLE_URL);
    expect(r.html).toBe(rewritten);
    expect(r.missing).toEqual([]);
    expect(r.restored).toEqual([]);
  });

  test('lien interne ABSOLU de même domaine conservé → aucune retouche', () => {
    const original  = '<p>Voir <a href="https://isolation-phonique.com/faq">la FAQ</a>.</p>';
    const rewritten = '<p>Notre <a href="https://isolation-phonique.com/faq">la FAQ</a> répond à tout.</p>';
    const r = carryOverInternalLinks(original, rewritten, ARTICLE_URL);
    expect(r.html).toBe(rewritten);
    expect(r.missing).toEqual([]);
  });

  test('« /prix » rendu en absolu par l\'IA → reconnu comme LE MÊME lien, rien à réparer', () => {
    const original  = '<p>Voir <a href="/prix">nos prix</a>.</p>';
    const rewritten = '<p>Voir <a href="https://isolation-phonique.com/prix/">nos prix</a>.</p>';
    const r = carryOverInternalLinks(original, rewritten, ARTICLE_URL);
    expect(r.missing).toEqual([]);
    expect(r.restored).toEqual([]);
    expect(r.html).toBe(rewritten);
  });

  test('ancre #slug disparue du nouveau texte → JAMAIS comptée comme lien perdu', () => {
    const original  = '<p><a href="#tarifs">Aller aux tarifs</a></p><p>Texte.</p>';
    const rewritten = '<p>Texte réécrit sans sommaire.</p>';
    const r = carryOverInternalLinks(original, rewritten, ARTICLE_URL);
    expect(r.missing).toEqual([]);
    expect(r.html).toBe(rewritten);
  });

  test('lien interne PERDU mais ancre encore en clair → RÉ-ENVELOPPÉ avec ses attributs', () => {
    const original  = '<p>Voir <a href="/prix" class="lien-prix">nos prix</a>.</p>';
    const rewritten = '<h2>Tarifs</h2><p>Comptez 55 €/m², voir nos prix pour le détail.</p>';
    const r = carryOverInternalLinks(original, rewritten, ARTICLE_URL);
    expect(r.html).toContain('href="/prix"');
    expect(r.html).toContain('class="lien-prix"');
    expect(r.html).toContain('>nos prix</a>');
    expect(r.missing).toEqual([]);
    expect(r.restored).toEqual([{ href: '/prix', text: 'nos prix' }]);
  });

  test('ré-enveloppe DANS LE CORPS plutôt que dans un titre quand les deux sont possibles', () => {
    const original  = '<p><a href="/prix">nos prix</a></p>';
    const rewritten = '<h2>nos prix</h2><p>Détail de nos prix pour 2026.</p>';
    const r = carryOverInternalLinks(original, rewritten, ARTICLE_URL);
    expect(r.html).toContain('<h2>nos prix</h2>');            // titre intact
    expect(r.html).toContain('<a href="/prix">nos prix</a>');  // lien posé dans le <p>
  });

  test('lien interne PERDU et ancre DISPARUE → AVERTISSEMENT non bloquant, HTML inchangé', () => {
    const original  = '<p>Voir <a href="/prix">nos prix</a>.</p>';
    const rewritten = '<h2>Tarifs 2026</h2><p>Comptez 55 €/m² pose comprise.</p>';
    const r = carryOverInternalLinks(original, rewritten, ARTICLE_URL);
    expect(r.missing).toEqual([{ href: '/prix', text: 'nos prix' }]);
    expect(r.html).toBe(rewritten);   // rien n'est rejeté, rien n'est inventé
  });

  test('original VIDE → no-op strict (cas F5 + contenu offloadé : aucune référence connue)', () => {
    const rewritten = '<p>Texte sans aucun lien.</p>';
    expect(carryOverInternalLinks('', rewritten, ARTICLE_URL)).toEqual({
      html: rewritten, missing: [], restored: [],
    });
  });

  test('nouveau HTML vide → no-op, jamais d\'exception', () => {
    expect(carryOverInternalLinks('<p><a href="/prix">prix</a></p>', '', ARTICLE_URL).missing).toEqual([]);
  });

  test('ne pose JAMAIS le lien sur un texte en instance de suppression (<del>)', () => {
    const original  = '<p>Voir <a href="/prix">nos prix</a>.</p>';
    const rewritten = '<p><del class="deleted-content">nos prix</del> ont changé.</p>';
    const r = carryOverInternalLinks(original, rewritten, ARTICLE_URL);
    expect(r.html).not.toContain('<a href="/prix"');
    expect(r.missing).toEqual([{ href: '/prix', text: 'nos prix' }]);
  });

  // ── EMPLACEMENTS : R1 respecte les MÊMES interdits que le maillage ───────────
  // La version d'origine n'excluait que « déjà lié » et « <del> » : elle reposait
  // donc les liens dans les tableaux, la FAQ, les titres, le TL;DR, le sommaire et
  // les CITATIONS — tout ce que la règle affichée au rédacteur interdit, et ce que
  // R2 s'interdisait déjà de son côté. Interdits partagés : src/utils/linkZones.js.
  test('ancre présente UNIQUEMENT dans un titre → rien n\'est posé, seulement signalé', () => {
    const original  = '<p>Voir <a href="/prix">nos prix</a>.</p>';
    const rewritten = '<h2>Découvrez nos prix</h2><p>Comptez 55 €/m² pose comprise.</p>';
    const r = carryOverInternalLinks(original, rewritten, ARTICLE_URL);
    expect(r.html).toBe(rewritten);
    expect(r.missing).toEqual([{ href: '/prix', text: 'nos prix' }]);
  });

  test('ancre présente UNIQUEMENT dans une CITATION → rien n\'est posé', () => {
    const original  = '<p>Voir <a href="/prix">nos prix</a>.</p>';
    const rewritten = '<blockquote><p>Vos nos prix sont scandaleux, dit-il.</p></blockquote>';
    const r = carryOverInternalLinks(original, rewritten, ARTICLE_URL);
    expect(r.html).toBe(rewritten);
    expect(r.missing).toHaveLength(1);
  });

  test('ancre présente UNIQUEMENT dans la FAQ ou le TL;DR → rien n\'est posé', () => {
    const original  = '<p>Voir <a href="/prix">nos prix</a>.</p>';
    ['FAQ', 'Résumé de l\'article', 'Sommaire'].forEach((titre) => {
      const rewritten = `<h2>${titre}</h2><p>Tout sur nos prix.</p>`;
      const r = carryOverInternalLinks(original, rewritten, ARTICLE_URL);
      expect(r.html).toBe(rewritten);
      expect(r.missing).toHaveLength(1);
    });
  });

  test('un TABLEAU reste un repli acceptable pour une REPRISE (le lien existait avant)', () => {
    // Nuance volontaire : un lien PRÉEXISTANT a très bien pu vivre dans une
    // cellule, et le perdre serait pire que de le remettre là où son texte est.
    // Un lien NOUVEAU (maillage, R2) n'a pas ce droit.
    const original  = '<p>Voir <a href="/prix">nos prix</a>.</p>';
    const rewritten = '<table><tbody><tr><td>Grille : nos prix 2026</td></tr></tbody></table>';
    const r = carryOverInternalLinks(original, rewritten, ARTICLE_URL);
    expect(r.html).toContain('<a href="/prix">nos prix</a>');
    expect(r.missing).toEqual([]);
  });

  test('le CORPS est préféré au tableau quand les deux portent l\'ancre', () => {
    const original  = '<p><a href="/prix">nos prix</a></p>';
    const rewritten = '<table><tbody><tr><td>nos prix</td></tr></tbody></table><p>Détail de nos prix pour 2026.</p>';
    const r = carryOverInternalLinks(original, rewritten, ARTICLE_URL);
    expect(r.html).toContain('<td>nos prix</td>');                       // cellule intacte
    expect(r.html).toContain('Détail de <a href="/prix">nos prix</a>');   // posé dans le corps
  });

  test('href protocol-relative d\'un AUTRE domaine n\'est pas « interne » (règle 8)', () => {
    const original  = '<p>Voir <a href="//evil.com/x">la page</a>.</p>';
    const rewritten = '<p>Voir la page pour le détail.</p>';
    const r = carryOverInternalLinks(original, rewritten, ARTICLE_URL);
    expect(r.html).toBe(rewritten);          // hors périmètre de R1
    expect(r.restored).toEqual([]);
    expect(listInternalLinks(original, ARTICLE_URL)).toEqual([]);
  });

  test('lien EXTERNE perdu → hors périmètre de R1 (le verrou règle 8 s\'en charge seul)', () => {
    const original  = '<p>Voir <a href="https://ademe.fr/guide">le guide</a>.</p>';
    const rewritten = '<p>Texte réécrit.</p>';
    const r = carryOverInternalLinks(original, rewritten, ARTICLE_URL);
    expect(r.missing).toEqual([]);
    expect(r.restored).toEqual([]);
  });
});

describe('enforceInternalLinkCarryOver — flux updates (passe 2), NE BLOQUE JAMAIS', () => {
  test('remplacement qui délie un lien interne → ré-enveloppé dans l\'update', () => {
    const { update, missing } = enforceInternalLinkCarryOver({
      original: '<p>Voir <a href="/prix">nos prix</a> pour 2024.</p>',
      updated:  '<p>Voir nos prix pour 2026.</p>',
    }, ARTICLE_URL);
    expect(update.updated).toContain('<a href="/prix">nos prix</a>');
    expect(missing).toEqual([]);
  });

  test('ancre disparue → l\'update passe quand même, le manquant est seulement signalé', () => {
    const { update, missing } = enforceInternalLinkCarryOver({
      original: '<p>Voir <a href="/prix">nos prix</a> pour 2024.</p>',
      updated:  '<p>Les tarifs ont augmenté en 2026.</p>',
    }, ARTICLE_URL);
    expect(update.updated).toBe('<p>Les tarifs ont augmenté en 2026.</p>');
    expect(missing).toEqual([{ href: '/prix', text: 'nos prix' }]);
  });

  test('une addition n\'écrase rien → jamais de manquant', () => {
    const { missing } = enforceInternalLinkCarryOver({
      type: 'addition', updated: '<p>Nouveau paragraphe.</p>',
    }, ARTICLE_URL);
    expect(missing).toEqual([]);
  });

  test('suppression pure : les liens internes du passage sont signalés, la suppression passe', () => {
    const { update, missing } = enforceInternalLinkCarryOver({
      type: 'suppression', original: '<p>Bloc obsolète, voir <a href="/prix">nos prix</a>.</p>',
    }, ARTICLE_URL);
    expect(update.type).toBe('suppression');
    expect(missing).toEqual([{ href: '/prix', text: 'nos prix' }]);
  });
});

describe('applyAllDiffs — R1 câblée à côté du verrou externe (sanction asymétrique)', () => {
  test('un lien INTERNE délié par l\'IA est ré-enveloppé et l\'update est APPLIQUÉE', () => {
    const html = '<p>Voir <a href="/prix">nos prix</a> pour 2024.</p>';
    const { html: out, updates } = applyAllDiffs(html, [{
      original: 'Voir <a href="/prix">nos prix</a> pour 2024.',
      updated:  'Voir nos prix pour 2026.',
    }], 2, ARTICLE_URL);
    expect(updates[0].applied).toBe(true);
    expect(out).toContain('href="/prix"');
  });

  test('lien INTERNE non récupérable → update APPLIQUÉE malgré tout, manquant signalé', () => {
    const html = '<p>Voir <a href="/prix">nos prix</a> pour 2024.</p>';
    const { updates } = applyAllDiffs(html, [{
      original: 'Voir <a href="/prix">nos prix</a> pour 2024.',
      updated:  'Les tarifs ont bougé en 2026.',
    }], 2, ARTICLE_URL);
    expect(updates[0].applied).toBe(true);
    expect(updates[0].blockedReason).toBeUndefined();
    expect(updates[0].missingInternalLinks).toEqual([{ href: '/prix', text: 'nos prix' }]);
  });

  test('NON-RÉGRESSION RÈGLE 8 : un lien EXTERNE non récupérable BLOQUE toujours l\'update', () => {
    const html = '<p>Selon <a href="https://ademe.fr/guide">le guide</a>, comptez 40 euros.</p>';
    const { html: out, updates } = applyAllDiffs(html, [{
      original: 'Selon <a href="https://ademe.fr/guide">le guide</a>, comptez 40 euros.',
      updated:  'Comptez 55 euros en 2026.',
    }], 2, ARTICLE_URL);
    expect(updates[0].applied).toBe(false);
    expect(updates[0].blockedReason).toBe('lien-externe');
    expect(out).toContain('href="https://ademe.fr/guide"');   // passage d'origine intact
    expect(out).toContain('40 euros');
  });
});
