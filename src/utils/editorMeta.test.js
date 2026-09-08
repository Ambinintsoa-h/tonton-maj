/**
 * Verrou : les métas d'un article ne s'affichent JAMAIS sur un autre.
 *
 * Constaté en production le 20 août 2026 — un article de terrassier.net rouvert
 * depuis l'Historique portait le titre, le meta title, la meta description et le
 * mot-clé cible d'un article de fosseseptique.fr, et ces métas étaient
 * PUBLIABLES (`postData.seoMeta`).
 */
import { editorMetaForArticle, defaultPublishDate } from './editorMeta';

const METAS_FOSSE = {
  articleId:      'art-fosse-septique',
  editedTitle:    'Fosse septique - Comment choisir entre PVC, beton ou plastique ?',
  seoTitle:       'Fosse septique PVC, beton ou plastique : comment choisir',
  seoDescription: 'Decouvrez comment bien choisir votre fosse septique entre PVC, beton et plastique.',
  publishDate:    '2026-07-02T10:30',
};

describe('le brouillon d un AUTRE article est refuse', () => {
  it('le cas reel : les metas de fosseseptique.fr sur un article de terrassier.net', () => {
    expect(editorMetaForArticle(METAS_FOSSE, 'art-pelle-hydraulique')).toBeNull();
  });

  it('le refus porte sur le brouillon ENTIER, pas seulement les metas SEO', () => {
    // `editedTitle`, `publishDate`, l ALT de l image et les categories fuyaient
    // par le meme trou — et une categorie erronee change le permalien (404).
    const recu = editorMetaForArticle({
      articleId: 'autre', editedTitle: 'Titre d un autre article',
      selectedCategories: [12], catsDirty: true,
      featuredImgMeta: { alt: 'ALT d un autre article', caption: '' },
    }, 'celui-ci');
    expect(recu).toBeNull();
  });
});

describe('ce qui doit PASSER — refuser par defaut serait un second defaut', () => {
  it('le brouillon du BON article passe', () => {
    const m = { ...METAS_FOSSE };
    expect(editorMetaForArticle(m, 'art-fosse-septique')).toBe(m);
  });

  it('un brouillon SANS articleId passe — ecrit avant ce correctif', () => {
    // Le refuser ferait perdre les retouches en cours de tous les brouillons
    // existants. Le prochain autosave posera la marque.
    const ancien = { seoTitle: 'Retouche a la main', seoDescription: '' };
    expect(editorMetaForArticle(ancien, 'peu-importe')).toBe(ancien);
  });

  it('article jamais enregistre (currentArticleId nul) : un brouillon sans marque passe', () => {
    const m = { seoTitle: 'En cours de saisie' };
    expect(editorMetaForArticle(m, null)).toBe(m);
  });

  it('un brouillon MARQUE ne passe pas sur un article sans id', () => {
    // Sinon un nouvel article heriterait des metas du precedent — le defaut
    // d origine, pris par l autre bout.
    expect(editorMetaForArticle(METAS_FOSSE, null)).toBeNull();
  });

  it('absence de brouillon : null, jamais undefined', () => {
    expect(editorMetaForArticle(null, 'x')).toBeNull();
    expect(editorMetaForArticle(undefined, 'x')).toBeNull();
  });
});

describe('defaultPublishDate — Date MAJ pré-remplie à J-2 (SEO Meta)', () => {
  it('recule de deux jours, au format datetime-local (YYYY-MM-DDTHH:mm)', () => {
    expect(defaultPublishDate(new Date(2026, 8, 8, 14, 30))).toBe('2026-09-06T14:30');
  });

  it('traverse correctement un changement de mois', () => {
    expect(defaultPublishDate(new Date(2026, 2, 1, 9, 5))).toBe('2026-02-27T09:05');
  });

  it('traverse correctement un changement d\'année', () => {
    expect(defaultPublishDate(new Date(2027, 0, 1, 0, 0))).toBe('2026-12-30T00:00');
  });

  it('les heures et minutes à un seul chiffre sont bien paddées (format valide pour l\'input)', () => {
    expect(defaultPublishDate(new Date(2026, 8, 10, 3, 5))).toBe('2026-09-08T03:05');
  });
});
