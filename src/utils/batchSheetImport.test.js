import { parseBatchSheetRows, parseKeywordCell, findColumnIndex } from './batchSheetImport';

// Colonnes réelles de "EXEMPLE FICHIER.xlsx" (fourni par Andrianina, 28/08/2026).
const HEADER = [
  'Site', 'N°', 'Keyword', 'Titre / sujet', 'URL Google docs', 'URL WP',
  'URL article mise en ligne', 'Date de la réalisation \nde la tâche',
  'Nbre de \nmots cible', 'Capture avant', 'Nb de mots livrés (EXACT)',
  'Validation', 'Typologie', 'Malus/Bonus', 'Sanction/Prime',
];

const row = (overrides = {}) => {
  const base = {
    site: 'guide-prix.com MAJ', rowRef: 'm10644', keyword: '[MAJ] tarif lessivage mur et plafond',
    titre: 'Prix du lessivage', gdocs: 'https://docs.google.com/x', wp: 'https://guide-prix.com/wp-admin/x',
    url: 'https://guide-prix.com/prix-lessivage-mur-ou-plafond/', date: '', motsCible: '',
    capture: '', motsLivres: '', validation: '', typologie: '', malus: '', sanction: '',
  };
  const r = { ...base, ...overrides };
  return [r.site, r.rowRef, r.keyword, r.titre, r.gdocs, r.wp, r.url, r.date, r.motsCible, r.capture, r.motsLivres, r.validation, r.typologie, r.malus, r.sanction];
};

describe('parseKeywordCell', () => {
  it('extrait le type et le mot-clé depuis "[MAJ] ..."', () => {
    expect(parseKeywordCell('[MAJ] tarif lessivage mur et plafond')).toEqual({ majType: 'maj', targetKeyword: 'tarif lessivage mur et plafond' });
  });

  it('extrait "[REFONTE] ..." insensible à la casse', () => {
    expect(parseKeywordCell('[refonte] gros dossier')).toEqual({ majType: 'refonte', targetKeyword: 'gros dossier' });
  });

  it('sans balise, tombe sur maj par défaut -- tout va à l\'audit (consigne Andrianina 28/08/2026)', () => {
    expect(parseKeywordCell('tractopelle location prix')).toEqual({ majType: 'maj', targetKeyword: 'tractopelle location prix' });
  });

  it('cellule vide -> mot-clé vide, jamais une exception', () => {
    expect(parseKeywordCell('')).toEqual({ majType: 'maj', targetKeyword: '' });
    expect(parseKeywordCell(undefined)).toEqual({ majType: 'maj', targetKeyword: '' });
  });
});

describe('findColumnIndex', () => {
  it('trouve "Validation" par égalité exacte normalisée', () => {
    expect(findColumnIndex(HEADER, ['validation'])).toBe(11);
  });

  it('trouve "N°" malgré le symbole degré', () => {
    expect(findColumnIndex(HEADER, ['n°', 'no', 'n'])).toBe(1);
  });

  it('renvoie -1 si aucune colonne ne correspond', () => {
    expect(findColumnIndex(HEADER, ['inexistant'])).toBe(-1);
  });
});

describe('parseBatchSheetRows -- format réel EXEMPLE FICHIER.xlsx', () => {
  it('ignore une ligne dont "Validation" est vide (constat du fichier exemple réel : les 12 lignes sont vides)', () => {
    const sheet = [HEADER, row({ validation: '' })];
    const { rows, skipped } = parseBatchSheetRows(sheet);
    expect(rows).toEqual([]);
    expect(skipped).toEqual({ notValidated: 1, noUrl: 0, noKeyword: 0 });
  });

  it('importe une ligne validée (n\'importe quel contenu non vide compte, pas seulement ✅)', () => {
    const sheet = [HEADER, row({ validation: '✅' })];
    const { rows, skipped } = parseBatchSheetRows(sheet);
    expect(rows).toEqual([{
      rowRef: 'm10644',
      site: 'guide-prix.com',
      articleUrl: 'https://guide-prix.com/prix-lessivage-mur-ou-plafond/',
      targetKeyword: 'tarif lessivage mur et plafond',
      majType: 'maj',
      consigne: '',
    }]);
    expect(skipped.notValidated).toBe(0);
  });

  it('accepte "OK" ou toute autre marque non vide comme validation', () => {
    const sheet = [HEADER, row({ validation: 'OK' })];
    expect(parseBatchSheetRows(sheet).rows).toHaveLength(1);
  });

  it('ignore les colonnes Typologie/Malus-Bonus/Sanction-Prime/Capture avant -- jamais utilisées', () => {
    const sheet = [HEADER, row({ validation: '✅', typologie: 'X', malus: 'Y', sanction: 'Z', capture: 'https://drive.google.com/whatever' })];
    const { rows } = parseBatchSheetRows(sheet);
    expect(rows[0]).not.toHaveProperty('typologie');
    expect(Object.keys(rows[0])).toEqual(['rowRef', 'site', 'articleUrl', 'targetKeyword', 'majType', 'consigne']);
  });

  it('ignore une ligne validée mais sans URL', () => {
    const sheet = [HEADER, row({ validation: '✅', url: '' })];
    const { rows, skipped } = parseBatchSheetRows(sheet);
    expect(rows).toEqual([]);
    expect(skipped.noUrl).toBe(1);
  });

  it('ignore une ligne validée mais sans mot-clé', () => {
    const sheet = [HEADER, row({ validation: '✅', keyword: '' })];
    const { rows, skipped } = parseBatchSheetRows(sheet);
    expect(rows).toEqual([]);
    expect(skipped.noKeyword).toBe(1);
  });

  it('ignore les lignes complètement vides (bas de feuille)', () => {
    const sheet = [HEADER, row({ validation: '✅' }), Array(15).fill('')];
    const { rows } = parseBatchSheetRows(sheet);
    expect(rows).toHaveLength(1);
  });

  it('reconnaît "[REFONTE]" dans le mot-clé', () => {
    const sheet = [HEADER, row({ validation: '✅', keyword: '[REFONTE] fosse septique guide complet' })];
    const { rows } = parseBatchSheetRows(sheet);
    expect(rows[0].majType).toBe('refonte');
    expect(rows[0].targetKeyword).toBe('fosse septique guide complet');
  });

  it('sans feuille ou sans en-tête, renvoie une liste vide sans lever', () => {
    expect(parseBatchSheetRows([])).toEqual({ rows: [], skipped: { notValidated: 0, noUrl: 0, noKeyword: 0 } });
    expect(parseBatchSheetRows(undefined)).toEqual({ rows: [], skipped: { notValidated: 0, noUrl: 0, noKeyword: 0 } });
  });

  it('plusieurs lignes validées sont toutes importées, dans l\'ordre', () => {
    const sheet = [
      HEADER,
      row({ rowRef: 'm1', validation: '✅', url: 'https://a.test/1', keyword: '[MAJ] mot un' }),
      row({ rowRef: 'm2', validation: '' /* non validée */, url: 'https://a.test/2', keyword: '[MAJ] mot deux' }),
      row({ rowRef: 'm3', validation: '✅', url: 'https://a.test/3', keyword: '[MAJ] mot trois' }),
    ];
    const { rows, skipped } = parseBatchSheetRows(sheet);
    expect(rows.map((r) => r.rowRef)).toEqual(['m1', 'm3']);
    expect(skipped.notValidated).toBe(1);
  });
});
