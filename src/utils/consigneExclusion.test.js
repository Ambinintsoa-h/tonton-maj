/* eslint-env jest */
import {
  detecterExclusionSaisons, verifierCitations, repriseExclusion, promptJugeExclusion,
  MAX_PASSAGES_EXCLUS,
} from './consigneExclusion';

describe('detecterExclusionSaisons — le périmètre de la consigne', () => {
  test.each([
    'parlez de la liste des participants, du gagnant de la saison 2026. Ne parle pas des autres saison mais seulement de cette année',
    'Ne parle pas des autres saisons',
    'Sans parler des éditions précédentes',
    'N\'évoque pas les anciennes saisons',
    'Pas d\'autres éditions, on reste sur la saison en cours',
    'Parle seulement de cette année',
    'Uniquement de la saison actuelle',
    'Évite les saisons précédentes',
    'Retire tout ce qui parle des autres saisons',
  ])('exclut : %s', (c) => {
    expect(detecterExclusionSaisons(c)).toBe(true);
  });

  test.each([
    '',
    'Parle aussi des autres saisons',
    'Compare avec les saisons précédentes',
    'N\'oublie pas de parler des autres saisons',
    'Il ne faut pas oublier les saisons précédentes',
    'Ne parle pas des prix. Parle des autres saisons',
    'Ajoute que cette saison est la plus suivie',
    'Change les H2 et le chapô',
    'Mets à jour les prix 2026',
    'Parle du gagnant de la saison 2026',
  ])('n\'exclut pas : %s', (c) => {
    expect(detecterExclusionSaisons(c)).toBe(false);
  });

  test('entrée absente ou non texte : false, jamais d\'exception', () => {
    expect(detecterExclusionSaisons()).toBe(false);
    expect(detecterExclusionSaisons(null)).toBe(false);
    expect(detecterExclusionSaisons(42)).toBe(false);
  });
});

describe('verifierCitations — une citation inventée ne déclenche rien', () => {
  const ARTICLE = 'La dixième saison s\'est achevée en mai 2023 sur un duel inédit. Jean-Baptiste Grangé, installé à Pau, affrontait Nicolas Gruel. Le gagnant de la saison 10 a construit sa notoriété.';

  test('garde une citation présente mot pour mot (casse, accents, ponctuation ignorés)', () => {
    const r = verifierCitations(ARTICLE, [{ citation: 'LA DIXIEME SAISON S\'EST ACHEVEE EN MAI 2023' }]);
    expect(r).toHaveLength(1);
  });

  test('écarte une citation absente du texte', () => {
    expect(verifierCitations(ARTICLE, [{ citation: 'La neuvième saison a été annulée à cause du froid polaire' }])).toEqual([]);
  });

  test('écarte une citation trop courte : « saison 10 » tomberait partout', () => {
    expect(verifierCitations(ARTICLE, [{ citation: 'saison 10' }])).toEqual([]);
  });

  test('retire les points de suspension du juge avant de comparer', () => {
    expect(verifierCitations(ARTICLE, [{ citation: '…Jean-Baptiste Grangé, installé à Pau, affrontait Nicolas Gruel…' }])).toHaveLength(1);
  });

  test('dédoublonne et accepte des chaînes nues', () => {
    const c = 'Le gagnant de la saison 10 a construit sa notoriété';
    expect(verifierCitations(ARTICLE, [c, { citation: c.toUpperCase() }])).toHaveLength(1);
  });

  test(`borne à ${MAX_PASSAGES_EXCLUS} passages`, () => {
    const texte = Array.from({ length: 12 }, (_, i) => `Passage numéro ${i} sur une autre saison déjà racontée ici.`).join(' ');
    const cites = Array.from({ length: 12 }, (_, i) => ({ citation: `Passage numéro ${i} sur une autre saison déjà racontée ici` }));
    expect(verifierCitations(texte, cites)).toHaveLength(MAX_PASSAGES_EXCLUS);
  });

  test('entrées invalides : [] sans exception', () => {
    expect(verifierCitations('', [{ citation: 'x'.repeat(40) }])).toEqual([]);
    expect(verifierCitations(ARTICLE, undefined)).toEqual([]);
    expect(verifierCitations(ARTICLE, 'pas un tableau')).toEqual([]);
    expect(verifierCitations(ARTICLE, [null, {}, { citation: 12 }])).toEqual([]);
  });
});

describe('textes envoyés au modèle', () => {
  test('la reprise cite chaque passage et rappelle la règle des liens externes', () => {
    const t = repriseExclusion(['Le gagnant de la saison 10 a construit sa notoriété', 'La dixième saison s\'est achevée en mai 2023']);
    expect(t).toContain('« Le gagnant de la saison 10 a construit sa notoriété »');
    expect(t).toContain('« La dixième saison s\'est achevée en mai 2023 »');
    expect(t).toMatch(/lien EXTERNE/);
    expect(t).toMatch(/section ENTIÈRE/);
  });

  test('le prompt du juge porte la consigne, l\'article et la consigne de ne pas lister dans le doute', () => {
    const p = promptJugeExclusion('Ne parle pas des autres saisons', 'Texte brut de l\'article.');
    expect(p).toContain('Ne parle pas des autres saisons');
    expect(p).toContain('Texte brut de l\'article.');
    expect(p).toMatch(/dans le doute, ne liste pas/);
    expect(p).toMatch(/{"passages":\[\]}/);
  });
});
