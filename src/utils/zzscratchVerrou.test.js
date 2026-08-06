/* eslint-env jest */
/* FICHIER TEMPORAIRE D'AUDIT — à supprimer */
import { sanitizeFullArticle, listExternalLinks } from './diff';

const U = 'https://isolation-phonique.com/mon-article';

test('A1 protocol-relative AJOUTE', () => {
  const r = sanitizeFullArticle(
    '<p>Le prix moyen est de 40 EUR/m2.</p>',
    '<p>Comptez 55 EUR selon <a href="//concurrent.com/etude">cette etude</a>.</p>', U);
  console.log('A1', JSON.stringify(r));
});

test('A2 protocol-relative D ORIGINE supprime', () => {
  const r = sanitizeFullArticle(
    '<p>Source : <a href="//www.legifrance.gouv.fr/loi">Legifrance</a>.</p>',
    '<h2>Tarifs 2026</h2><p>Comptez 55 EUR/m2.</p>', U);
  console.log('A2', JSON.stringify(r));
  console.log('A2 listExternalLinks', JSON.stringify(listExternalLinks('<p><a href="//www.legifrance.gouv.fr/loi">Legifrance</a></p>', U)));
});

test('A3 href avec espace de tete AJOUTE', () => {
  const r = sanitizeFullArticle(
    '<p>Prix 40 EUR.</p>',
    '<p>Voir <a href=" https://concurrent.com/etude">cette etude</a>.</p>', U);
  console.log('A3', JSON.stringify(r));
});

test('A3b href avec retour ligne de tete AJOUTE', () => {
  const r = sanitizeFullArticle(
    '<p>Prix 40 EUR.</p>',
    '<p>Voir <a\n  href="\n    https://concurrent.com/etude">cette etude</a>.</p>', U);
  console.log('A3b', JSON.stringify(r));
});

test('A4 schema majuscules AJOUTE', () => {
  const r = sanitizeFullArticle(
    '<p>Prix 40 EUR.</p>',
    '<p>Voir <a href="HTTPS://concurrent.com/etude">cette etude</a>.</p>', U);
  console.log('A4', JSON.stringify(r));
});

test('B1 reinjection dans un H2 (premiere occurrence du document)', () => {
  const r = sanitizeFullArticle(
    '<p>Le <a href="https://ademe.fr/g" rel="noopener">guide ADEME</a> detaille les aides.</p>',
    '<h2>Que dit le guide ADEME ?</h2><p>Le guide ADEME detaille les aides 2026.</p>', U);
  console.log('B1', JSON.stringify(r));
});

test('B2 reinjection dans le TL;DR / un tableau / la FAQ', () => {
  const r = sanitizeFullArticle(
    '<p>Voir <a href="https://ademe.fr/g">le guide ADEME</a>.</p>',
    '<h2>Resume de l\'article</h2><ul><li>le guide ADEME fixe le bareme</li></ul>'
    + '<h2>Bareme</h2><table><tbody><tr><td>le guide ADEME</td></tr></tbody></table>'
    + '<p>Dans le corps : le guide ADEME reste la reference.</p>', U);
  console.log('B2', JSON.stringify(r));
});

test('B3 ancre courte = sous-chaine dans un mot', () => {
  const r = sanitizeFullArticle(
    '<p>Le bareme est detaille <a href="https://ademe.fr/g">ici</a>.</p>',
    '<p>Voici les aides 2026. Le detail complet est disponible ici.</p>', U);
  console.log('B3', JSON.stringify(r));
});

test('B4 ancre coupee par du balisage inline dans l original', () => {
  const r = sanitizeFullArticle(
    '<p><a href="https://ademe.fr/g">le <strong>guide</strong> ADEME</a> le dit.</p>',
    '<p>Le <strong>guide</strong> ADEME detaille toutes les aides.</p>', U);
  console.log('B4', JSON.stringify(r));
});

test('B5 ancre image (texte vide) = irrecuperable', () => {
  const orig = '<p><a href="https://ademe.fr/g"><img src="/logo-ademe.png" alt="ADEME"></a></p>';
  console.log('B5 list', JSON.stringify(listExternalLinks(orig, U)));
  const r = sanitizeFullArticle(orig, '<p>Article reecrit sans le logo.</p>', U);
  console.log('B5', JSON.stringify(r));
});

test('C1 variation cosmetique href, ancre INCHANGEE', () => {
  const r = sanitizeFullArticle(
    '<p>Voir <a href="https://ademe.fr/guide" rel="noopener">le guide ADEME</a>.</p>',
    '<p>Voir <a href="https://ademe.fr/guide/">le guide ADEME</a> avant travaux.</p>', U);
  console.log('C1', JSON.stringify(r));
});

test('C2 variation cosmetique href + ancre REFORMULEE', () => {
  const r = sanitizeFullArticle(
    '<p>Voir <a href="https://ademe.fr/guide">le guide ADEME</a>.</p>',
    '<p>Voir <a href="https://www.ademe.fr/guide">le guide de l\'ADEME</a> avant travaux.</p>', U);
  console.log('C2', JSON.stringify(r));
});

test('D1 articleUrl vide : liens INTERNES absolus du brief', () => {
  const r = sanitizeFullArticle(
    '<p>Texte colle sans lien.</p>',
    '<p>Voir <a href="https://isolation-phonique.com/prix">nos prix</a> et <a href="https://isolation-phonique.com/faq">la FAQ</a>.</p>', '');
  console.log('D1', JSON.stringify(r));
});

test('D2 articleUrl vide : liens internes absolus de l ORIGINE', () => {
  const r = sanitizeFullArticle(
    '<p>Voir <a href="https://isolation-phonique.com/prix">nos prix</a>.</p>',
    '<h2>Tarifs 2026</h2><p>Comptez 55 EUR/m2 pose comprise.</p>', '');
  console.log('D2', JSON.stringify(r));
});

test('E1 duplication d un lien externe autorise', () => {
  const r = sanitizeFullArticle(
    '<p>Voir <a href="https://ademe.fr/g">le guide</a>.</p>',
    '<p>A <a href="https://ademe.fr/g">un</a> B <a href="https://ademe.fr/g">deux</a> C <a href="https://ademe.fr/g">trois</a>.</p>', U);
  console.log('E1', JSON.stringify(r));
});

test('F1 moveFaqToEnd apres controle : lien externe dans la FAQ deplacee', () => {
  const r = sanitizeFullArticle(
    '<p>Voir <a href="https://ademe.fr/g">le guide ADEME</a>.</p>',
    '<h2>FAQ</h2><h3>Q ?</h3><p>Voir <a href="https://ademe.fr/g">le guide ADEME</a>.</p><h2>Tarifs</h2><p>55 EUR.</p>', U);
  console.log('F1', JSON.stringify(r));
});

test('F2 sous-domaine du meme site', () => {
  console.log('F2', JSON.stringify(listExternalLinks('<p><a href="https://blog.isolation-phonique.com/x">Notre blog</a></p>', U)));
});

test('F3 sous-domaine : ajout vers www du meme site', () => {
  const r = sanitizeFullArticle('<p>x</p>', '<p><a href="https://www.isolation-phonique.com/promo">promo</a></p>', U);
  console.log('F3', JSON.stringify(r));
});
