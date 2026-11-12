/**
 * Verrou : le titre validé par un humain PART sur WordPress.
 *
 * Constaté en production le 12 novembre 2026 (tourismefrance.org, article du
 * Mont-Dore) : contenu et métas SEO publiés, H1 — le titre WordPress — inchangé.
 * Le drapeau `titleDirty` était retombé à faux sans que le champ ne change.
 */
import { mustResetTitle, titleToPublish } from './titlePublish';

const TITRE = 'Mont Dore Tourisme : thermes, nature et sports au Sancy';

describe('mustResetTitle — un effet ne doit pas effacer l intention d un humain', () => {
  it('le cas reel : meme article, titre dirty, le titre enregistre vient de changer -> PAS de reset', () => {
    expect(mustResetTitle({ previousArticleKey: 'art-1', articleKey: 'art-1', titleDirty: true })).toBe(false);
  });

  it('premier passage (montage) : toujours initialise, comme avant', () => {
    expect(mustResetTitle({ previousArticleKey: undefined, articleKey: 'art-1', titleDirty: false })).toBe(true);
    // meme sans identifiant d article (collage) : undefined !== null
    expect(mustResetTitle({ previousArticleKey: undefined, articleKey: null, titleDirty: true })).toBe(true);
  });

  it('un AUTRE article : on repart de zero meme si l ancien etait dirty', () => {
    expect(mustResetTitle({ previousArticleKey: 'art-1', articleKey: 'art-2', titleDirty: true })).toBe(true);
  });

  it('meme article, rien de saisi : le titre WP qui arrive en retard est bien pris en compte', () => {
    expect(mustResetTitle({ previousArticleKey: 'art-1', articleKey: 'art-1', titleDirty: false })).toBe(true);
  });
});

describe('titleToPublish — ce qui part reellement sur le site', () => {
  it('titre saisi : il part tel que saisi, sans normalisation', () => {
    expect(titleToPublish({ titleDirty: true, editedTitle: `  ${TITRE} `, savedEditedTitle: '' })).toBe(`  ${TITRE} `);
  });

  it('LE BUG : drapeau retombe a faux, mais le champ reprend le titre deja valide et enregistre -> il part', () => {
    expect(titleToPublish({ titleDirty: false, editedTitle: TITRE, savedEditedTitle: TITRE })).toBe(TITRE);
  });

  it('la comparaison ignore les espaces de bord, pas le texte', () => {
    expect(titleToPublish({ titleDirty: false, editedTitle: TITRE, savedEditedTitle: `${TITRE} ` })).toBe(TITRE);
    expect(titleToPublish({ titleDirty: false, editedTitle: TITRE, savedEditedTitle: 'Autre titre' })).toBeNull();
  });

  it('TITRE PARASITE : affiche dans le champ, jamais valide -> ne part PAS', () => {
    // Titre de widget capte par le scraping : jamais dirty, donc jamais persiste
    // comme `editedTitle`.
    expect(titleToPublish({ titleDirty: false, editedTitle: 'Suivez-nous', savedEditedTitle: '' })).toBeNull();
    expect(titleToPublish({ titleDirty: false, editedTitle: 'Suivez-nous', savedEditedTitle: undefined })).toBeNull();
  });

  it('titre WP lu a l ouverture (jamais touche) : ne part pas, WordPress le garde', () => {
    expect(titleToPublish({ titleDirty: false, editedTitle: 'Titre WP actuel', savedEditedTitle: '' })).toBeNull();
  });

  it('champ vide : rien ne part, meme dirty', () => {
    expect(titleToPublish({ titleDirty: true, editedTitle: '', savedEditedTitle: TITRE })).toBeNull();
    expect(titleToPublish({ titleDirty: false, editedTitle: '', savedEditedTitle: TITRE })).toBeNull();
  });
});

describe('le branchement dans ArticleResult est verrouille', () => {
  // Les deux filets n'ont d'effet que s'ils sont appeles : un test sur la source
  // empeche qu'un refactor remette `titleDirty && editedTitle` en direct.
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'components', 'agent', 'ArticleResult.jsx'), 'utf8');

  it('la publication passe par titleToPublish, plus par le drapeau seul', () => {
    expect(src).toMatch(/titleToPublish\(\{/);
    expect(src).not.toMatch(/if \(titleDirty && editedTitle\) postData\.title = editedTitle;/);
  });

  it('l effet de reinitialisation passe par mustResetTitle', () => {
    expect(src).toMatch(/mustResetTitle\(\{/);
  });
});
