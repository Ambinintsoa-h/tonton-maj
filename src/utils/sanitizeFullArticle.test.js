// Tests du VERROU LIENS EXTERNES en mode ARTICLE ENTIER (règle absolue)
// → sanitizeFullArticle rejoue la politique de enforceExternalLinkPolicy à
//   l'échelle d'un article complet réécrit d'un bloc (mode Audit QAT + Refonte).
/* eslint-env jest */
import { sanitizeFullArticle, listExternalLinks } from './diff';

const ARTICLE_URL = 'https://isolation-phonique.com/mon-article';

describe('listExternalLinks — liste injectée dans le prompt de refonte', () => {
  test('ne retient que les liens externes, avec leur ancre', () => {
    const html = `<p>Voir <a href="https://ademe.fr/guide" rel="noopener">le guide ADEME</a>,
      <a href="https://isolation-phonique.com/prix">nos prix</a> et <a href="/faq">la FAQ</a>.</p>`;
    expect(listExternalLinks(html, ARTICLE_URL)).toEqual([
      { href: 'https://ademe.fr/guide', text: 'le guide ADEME' },
    ]);
  });

  test('dédoublonne par href', () => {
    const html = '<p><a href="https://ademe.fr/g">A</a> puis <a href="https://ademe.fr/g">B</a></p>';
    expect(listExternalLinks(html, ARTICLE_URL)).toHaveLength(1);
  });

  test('aucun lien externe → tableau vide', () => {
    expect(listExternalLinks('<p>Texte nu</p>', ARTICLE_URL)).toEqual([]);
  });
});

describe('sanitizeFullArticle — liens externes', () => {
  test('lien externe AJOUTÉ par l\'IA → désenveloppé, texte conservé, signalé dans stripped', () => {
    const original = '<h2>Prix</h2><p>Le prix moyen est de 40 €/m².</p>';
    const rewritten = '<h2>Prix</h2><p>Comptez 55 €/m² selon <a href="https://concurrent.com/etude">cette étude</a>.</p>';
    const { html, stripped, missing } = sanitizeFullArticle(original, rewritten, ARTICLE_URL);
    expect(html).not.toContain('concurrent.com');
    expect(html).toContain('cette étude');
    expect(stripped).toEqual(['https://concurrent.com/etude']);
    expect(missing).toEqual([]);
  });

  test('lien externe D\'ORIGINE conservé à l\'identique → aucune alerte', () => {
    const original = '<p>Voir <a href="https://ademe.fr/guide" rel="noopener">le guide ADEME</a>.</p>';
    const rewritten = '<h2>Aides</h2><p>Consultez <a href="https://ademe.fr/guide" rel="noopener">le guide ADEME</a> avant vos travaux.</p>';
    const { html, stripped, missing } = sanitizeFullArticle(original, rewritten, ARTICLE_URL);
    expect(html).toContain('https://ademe.fr/guide');
    expect(stripped).toEqual([]);
    expect(missing).toEqual([]);
  });

  test('lien externe d\'origine DÉLIÉ mais ancre encore présente → ré-enveloppé automatiquement', () => {
    const original = '<p>Voir <a href="https://ademe.fr/guide" rel="noopener">le guide ADEME</a>.</p>';
    const rewritten = '<p>Le guide ADEME détaille les aides. Consultez le guide ADEME pour le détail.</p>';
    const { html, missing } = sanitizeFullArticle(original, rewritten, ARTICLE_URL);
    expect(html).toContain('href="https://ademe.fr/guide"');
    expect(html).toContain('rel="noopener"');
    expect(missing).toEqual([]);
  });

  test('lien externe d\'origine SUPPRIMÉ sans ancre récupérable → reporté dans missing', () => {
    const original = '<p>Source : <a href="https://ademe.fr/guide">le guide ADEME</a>.</p>';
    const rewritten = '<h2>Tarifs 2026</h2><p>Comptez 55 €/m² pose comprise.</p>';
    const { missing } = sanitizeFullArticle(original, rewritten, ARTICLE_URL);
    expect(missing).toEqual(['https://ademe.fr/guide']);
  });

  test('liens INTERNES (même domaine) librement ajoutés — hors périmètre du verrou', () => {
    const original = '<p>Texte d\'origine sans lien.</p>';
    const rewritten = '<p>Voir <a href="https://isolation-phonique.com/prix-plafond">le prix au m²</a> et <a href="/faq">la FAQ</a>.</p>';
    const { html, stripped, missing } = sanitizeFullArticle(original, rewritten, ARTICLE_URL);
    expect(html).toContain('/prix-plafond');
    expect(html).toContain('href="/faq"');
    expect(stripped).toEqual([]);
    expect(missing).toEqual([]);
  });
});

describe('sanitizeFullArticle — variations cosmétiques d\'URL', () => {
  // Sans le réalignement, chacun de ces cas comptait le lien SIMULTANÉMENT comme
  // ajouté (désenveloppé, donc détruit) et comme supprimé (missing → 3 essais de
  // 8-9 min puis échec dur), pour une différence purement cosmétique.
  const cases = [
    ['slash final ajouté',        'https://ademe.fr/guide',  'https://ademe.fr/guide/'],
    ['slash final retiré',        'https://ademe.fr/guide/', 'https://ademe.fr/guide'],
    ['www ajouté',                'https://ademe.fr/guide',  'https://www.ademe.fr/guide'],
    ['casse de l\'hôte',          'https://ademe.fr/guide',  'https://ADEME.fr/guide'],
  ];

  test.each(cases)('%s → réaligné sur l\'href d\'origine, aucun rejet', (_label, orig, rewritten) => {
    const { html, stripped, missing } = sanitizeFullArticle(
      `<p>Voir <a href="${orig}">le guide ADEME</a>.</p>`,
      `<p>Consultez <a href="${rewritten}">le guide ADEME</a> avant vos travaux.</p>`,
      ARTICLE_URL,
    );
    expect(missing).toEqual([]);
    expect(stripped).toEqual([]);
    expect(html).toContain(`href="${orig}"`);   // l'URL publiée reste celle de l'origine
  });

  test('un lien réellement DIFFÉRENT reste traité comme un ajout', () => {
    const { html, stripped } = sanitizeFullArticle(
      '<p><a href="https://ademe.fr/guide">le guide</a></p>',
      '<p><a href="https://ademe.fr/autre-page">le guide</a></p>',
      ARTICLE_URL,
    );
    expect(stripped).toEqual(['https://ademe.fr/autre-page']);
    expect(html).toContain('href="https://ademe.fr/guide"'); // l'original ré-injecté
  });
});

describe('sanitizeFullArticle — sécurité structure', () => {
  test('balise de bloc restée OUVERTE → refermée dans le fragment', () => {
    const { html } = sanitizeFullArticle('<p>x</p>', '<h2>Titre</h2><p>Paragraphe non fermé', ARTICLE_URL);
    expect(html).toContain('</p>');
  });

  test('FAQ déplacée en fin d\'article', () => {
    const rewritten = '<h2>FAQ</h2><p>Question ?</p><h2>Tarifs 2026</h2><p>55 €/m².</p>';
    const { html } = sanitizeFullArticle('<p>x</p>', rewritten, ARTICLE_URL);
    expect(html.indexOf('Tarifs 2026')).toBeLessThan(html.indexOf('FAQ'));
  });

  test('entrée vide → passe-plat sans crash', () => {
    expect(sanitizeFullArticle('<p>x</p>', '', ARTICLE_URL)).toEqual({ html: '', stripped: [], missing: [] });
  });
});
