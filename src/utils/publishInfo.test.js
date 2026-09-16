import { publicationPrecedente, lastPublishStamp } from './publishInfo';

const STAMP = (qui, jour) => `<!-- MAJ par ${qui} le ${jour} -->\n<p>Texte.</p>`;

describe('lastPublishStamp', () => {
  it('lit le tampon posé à la publication', () => {
    expect(lastPublishStamp(STAMP('Sahara RAZAFINDRAKOTO', '2026-09-15')))
      .toEqual({ auteur: 'Sahara RAZAFINDRAKOTO', jour: '2026-09-15' });
  });

  // Plusieurs mises à jour successives en laissent plusieurs : c'est la plus
  // récente qui décrit l'état du site, pas la première rencontrée.
  it('retient le PLUS RÉCENT quand il y en a plusieurs', () => {
    const html = STAMP('Ancien Auteur', '2026-08-01') + STAMP('Niampita NY ONJA', '2026-09-14');
    expect(lastPublishStamp(html).auteur).toBe('Niampita NY ONJA');
  });

  it('ne trouve rien dans un HTML ordinaire', () => {
    expect(lastPublishStamp('<p>Un article sans tampon.</p>')).toBeNull();
    expect(lastPublishStamp('')).toBeNull();
    expect(lastPublishStamp()).toBeNull();
  });
});

describe('publicationPrecedente', () => {
  it('rien à dire sur un article jamais publié', () => {
    expect(publicationPrecedente({ originalHtml: '<p>Neuf.</p>' })).toMatchObject({ publie: false, qui: '', quand: '' });
    expect(publicationPrecedente()).toMatchObject({ publie: false });
  });

  it('l\'enregistrement fait foi quand il est complet', () => {
    expect(publicationPrecedente({
      publishedAt: '2026-09-15T18:39:00.000Z',
      publishedBy: 'Sahara RAZAFINDRAKOTO',
      publishedUrl: 'https://site.fr/article/',
    })).toEqual({
      publie: true, quand: '2026-09-15T18:39:00.000Z', qui: 'Sahara RAZAFINDRAKOTO',
      url: 'https://site.fr/article/', approximatif: false,
    });
  });

  // Les articles publiés AVANT le 16/09/2026 n'ont pas de `publishedBy` : le
  // tampon présent dans le contenu re-scrapé le fournit sans rien inventer.
  it('complète l\'auteur manquant avec le tampon du contenu d\'origine', () => {
    const r = publicationPrecedente({
      publishedAt: '2026-09-15T18:39:00.000Z',
      originalHtml: STAMP('Sahara RAZAFINDRAKOTO', '2026-09-15'),
    });
    expect(r).toMatchObject({ publie: true, qui: 'Sahara RAZAFINDRAKOTO', approximatif: false });
  });

  // Une date sans nom reste une information ; un nom inventé serait une
  // désinformation — `lastModifiedBy` (qui a ÉDITÉ) n'est jamais emprunté.
  it('affiche la date SEULE plutôt qu\'un auteur deviné', () => {
    const r = publicationPrecedente({ publishedAt: '2026-09-07T13:32:54.668Z' });
    expect(r).toMatchObject({ publie: true, qui: '' });
  });

  it('détecte une publication attestée par le seul tampon', () => {
    const r = publicationPrecedente({ originalHtml: STAMP('Niampita NY ONJA', '2026-09-03') });
    expect(r).toMatchObject({ publie: true, quand: '2026-09-03', qui: 'Niampita NY ONJA', approximatif: true });
  });
});
