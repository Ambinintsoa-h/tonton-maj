// Le scraping captait le widget « Suivre sur Google Discover ». Le verrou liens
// externes (règle 8) exigeait alors que l'IA le reproduise dans l'article, ce qui
// a fini par faire ÉCHOUER la génération : « Verrou liens externes : 2 lien(s)
// externe(s) de l'article d'origine absent(s) de la réécriture après 3 essais ».
//
// Exigence de ces tests : retirer ces boutons, et RIEN d'autre. Un lien externe
// éditorial doit survivre — sinon on aurait affaibli le verrou par la porte de
// derrière, ce qui est précisément interdit.
/* eslint-env jest */
import {
  isNonEditorialLink, stripNonEditorialLinks, stripNonEditorialUrlsFromText,
} from './scrapeClean';

// Les deux URL réellement relevées sur couvreurs.net
const DISCOVER = 'https://profile.google.com/cp/Eg8KDWNvdXZyZXVycy5uZXQ=';
const SOURCE   = 'https://www.google.com/preferences/source?q=couvreurs.net&hl=fr_FR';
// Le lien externe éditorial du même article — il doit rester
const EDITORIAL = 'https://www.tolesmoinscheres.com/produit/toles-de-toiture';

describe('isNonEditorialLink — reconnaître les boutons de suivi Google', () => {
  test('les deux motifs relevés en production', () => {
    expect(isNonEditorialLink(DISCOVER)).toBe(true);
    expect(isNonEditorialLink(SOURCE)).toBe(true);
  });

  test('variantes de domaine Google et absence de www', () => {
    expect(isNonEditorialLink('https://google.com/preferences/source?q=x')).toBe(true);
    expect(isNonEditorialLink('https://www.google.fr/preferences/source?q=x')).toBe(true);
    expect(isNonEditorialLink('http://profile.google.com/cp/abc')).toBe(true);
  });

  test('un lien externe ÉDITORIAL n\'est pas concerné', () => {
    expect(isNonEditorialLink(EDITORIAL)).toBe(false);
  });

  test('les autres services Google restent de l\'éditorial', () => {
    // Une source citée reste une source, même chez Google.
    expect(isNonEditorialLink('https://www.google.com/search?q=bac+acier')).toBe(false);
    expect(isNonEditorialLink('https://developers.google.com/search/docs')).toBe(false);
    expect(isNonEditorialLink('https://profile.google.com/autre-chose')).toBe(false);
  });

  test('entrées dégénérées', () => {
    [null, undefined, '', '   ', 42, {}].forEach(v => expect(isNonEditorialLink(v)).toBe(false));
  });
});

describe('stripNonEditorialLinks', () => {
  test('les deux boutons Google disparaissent, avec leur libellé', () => {
    const html = `<p>Texte utile.</p><div><a href="${DISCOVER}">Discover</a><a href="${SOURCE}">Ajouter comme source préférée</a></div>`;
    const r = stripNonEditorialLinks(html);
    expect(r.removed).toEqual([DISCOVER, SOURCE]);
    expect(r.html).not.toContain('profile.google.com');
    expect(r.html).not.toContain('preferences/source');
    expect(r.html).not.toContain('Discover');
    expect(r.html).not.toContain('source préférée');
    expect(r.html).toContain('Texte utile.');
  });

  test('LE POINT CRITIQUE — un lien externe éditorial survit intact', () => {
    const html = `<p>Voir les <a href="${EDITORIAL}">bacs acier pour toiture</a> chez notre partenaire.</p>`
      + `<div><a href="${DISCOVER}">Discover</a></div>`;
    const r = stripNonEditorialLinks(html);
    expect(r.removed).toEqual([DISCOVER]);
    expect(r.html).toContain(EDITORIAL);
    expect(r.html).toContain('bacs acier pour toiture');   // href ET ancre préservés
  });

  test('le conteneur vidé par le retrait est supprimé, pas laissé vide', () => {
    const html = `<p>Avant.</p><div><a href="${DISCOVER}">Discover</a></div><p>Après.</p>`;
    const r = stripNonEditorialLinks(html);
    expect(r.html).not.toMatch(/<div>\s*<\/div>/);
    expect(r.html).toContain('Avant.');
    expect(r.html).toContain('Après.');
  });

  test('un conteneur qui garde du texte utile n\'est PAS supprimé', () => {
    const html = `<p>Suivez-nous <a href="${DISCOVER}">Discover</a> et lisez la suite.</p>`;
    const r = stripNonEditorialLinks(html);
    expect(r.html).toContain('Suivez-nous');
    expect(r.html).toContain('et lisez la suite.');
  });

  test('un conteneur ne gardant qu\'une image est conservé', () => {
    const html = `<div><img src="photo.jpg" alt="toit"><a href="${SOURCE}">Ajouter</a></div>`;
    const r = stripNonEditorialLinks(html);
    expect(r.html).toContain('photo.jpg');
  });

  test('aucun lien à retirer → le HTML est rendu À L\'IDENTIQUE', () => {
    const html = `<h2>Prix</h2><p>Voir <a href="${EDITORIAL}">les tôles</a>.</p>`;
    const r = stripNonEditorialLinks(html);
    expect(r.removed).toEqual([]);
    expect(r.html).toBe(html);   // pas de re-sérialisation inutile du DOM
  });

  test('structure et liens internes intacts', () => {
    const html = `<h2>Coût</h2><table><tr><td>60 EUR</td></tr></table>`
      + `<p><a href="/comparatif-tuile-bac-acier">comparer</a></p><div><a href="${DISCOVER}">Discover</a></div>`;
    const r = stripNonEditorialLinks(html);
    expect(r.html).toContain('<h2>Coût</h2>');
    expect(r.html).toContain('<table>');
    expect(r.html).toContain('/comparatif-tuile-bac-acier');
  });

  test('entrées dégénérées', () => {
    expect(stripNonEditorialLinks('')).toEqual({ html: '', removed: [] });
    expect(stripNonEditorialLinks(null)).toEqual({ html: '', removed: [] });
    expect(stripNonEditorialLinks(undefined).removed).toEqual([]);
  });
});

describe('stripNonEditorialUrlsFromText — même filtre sur du texte brut (repli Jina)', () => {
  test('les URL nues des widgets partent, le reste demeure', () => {
    const t = `Comptez 60 EUR/m². Suivez-nous ${DISCOVER} ou ${SOURCE} pour les mises à jour.`;
    const r = stripNonEditorialUrlsFromText(t);
    expect(r).not.toContain('profile.google.com');
    expect(r).not.toContain('preferences/source');
    expect(r).toContain('Comptez 60 EUR/m².');
  });

  test('une URL éditoriale en texte brut survit', () => {
    expect(stripNonEditorialUrlsFromText(`Voir ${EDITORIAL} pour les tarifs.`)).toContain(EDITORIAL);
  });

  test('ponctuation collée à l\'URL', () => {
    expect(stripNonEditorialUrlsFromText(`Suivez (${DISCOVER}).`)).not.toContain('profile.google.com');
  });

  test('liens MARKDOWN — la forme rendue par Jina', () => {
    // Découpé en mots, `[Discover](https://…)` ne commence pas par « http » :
    // le filtre d'URL nues le laissait passer. D'où une passe dédiée.
    const t = `Toiture en bac acier. [Discover](${DISCOVER}) [Ajouter comme source préférée](${SOURCE}) Fin.`;
    const r = stripNonEditorialUrlsFromText(t);
    expect(r).not.toContain('profile.google.com');
    expect(r).not.toContain('preferences/source');
    expect(r).not.toContain('Discover');
    expect(r).toContain('Toiture en bac acier.');
    expect(r).toContain('Fin.');
  });

  test('un lien markdown ÉDITORIAL est conservé en entier', () => {
    const t = `Voir [les tôles](${EDITORIAL}) chez le partenaire.`;
    const r = stripNonEditorialUrlsFromText(t);
    expect(r).toContain(`[les tôles](${EDITORIAL})`);
  });

  test('entrées dégénérées', () => {
    expect(stripNonEditorialUrlsFromText('')).toBe('');
    expect(stripNonEditorialUrlsFromText(null)).toBe('');
  });
});
