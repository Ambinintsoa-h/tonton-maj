const { COMMANDE_TAB, COMMANDE_HEADER, parseCommandeRows, parseTypeCell } = require('./commandeMajSheet');
const { createGoogleSheetSync } = require('./googleSheetSync');

const cmd = (ref, url, keyword, type = '', consigne = '', assigned = '') => [ref, url, keyword, type, consigne, assigned];

describe('constantes', () => {
  it('onglet et en-tête de la commande', () => {
    expect(COMMANDE_TAB).toBe('Commande MAJ');
    expect(COMMANDE_HEADER).toEqual(['N°', 'URL', 'Mot-clé cible', 'Type de MAJ', 'Consigne', 'Attribué à']);
  });
});

describe('parseTypeCell', () => {
  it.each([
    ['MAJ', 'maj'], ['maj', 'maj'], ['MAJ ciblée', 'ciblee'], ['maj ciblee', 'ciblee'],
    ['Refonte', 'refonte'], ['REFONTE', 'refonte'], ['autre', 'maj'],
  ])('%s -> %s', (raw, expected) => expect(parseTypeCell(raw)).toBe(expected));
  it('vide -> null (on retombe sur le type du mot-clé)', () => {
    expect(parseTypeCell('')).toBeNull();
    expect(parseTypeCell(undefined)).toBeNull();
  });
});

describe('parseCommandeRows', () => {
  it('lit les six colonnes par nom d\'en-tête', () => {
    const { rows, skipped } = parseCommandeRows([
      COMMANDE_HEADER,
      cmd('c1', 'https://www.evenement.com/billetterie', 'billetterie en ligne', 'MAJ ciblée', 'Change les H2', 'sahara'),
    ]);
    expect(skipped).toEqual({ noUrl: 0, noKeyword: 0 });
    expect(rows).toEqual([{
      rowRef: 'c1',
      site: 'evenement.com',
      articleUrl: 'https://www.evenement.com/billetterie',
      targetKeyword: 'billetterie en ligne',
      majType: 'ciblee',
      consigne: 'Change les H2',
      assignedTo: 'sahara',
    }]);
  });

  it('colonnes dans un autre ordre, ou en-têtes sans accent / casse différente', () => {
    const { rows } = parseCommandeRows([
      ['consigne', 'attribue a', 'TYPE DE MAJ', 'mot-cle cible', 'url', 'n°'],
      ['x', 'andrianina', 'Refonte', 'mot', 'https://a.test/p', 'c9'],
    ]);
    expect(rows[0]).toMatchObject({ rowRef: 'c9', articleUrl: 'https://a.test/p', targetKeyword: 'mot', majType: 'refonte', consigne: 'x', assignedTo: 'andrianina' });
  });

  it('Consigne et Attribué à facultatifs : vides, pas d\'erreur', () => {
    const { rows } = parseCommandeRows([COMMANDE_HEADER, cmd('c1', 'https://a.test/1', 'mot')]);
    expect(rows[0]).toMatchObject({ consigne: '', assignedTo: null, majType: 'maj' });
  });

  it('colonnes Consigne / Attribué à absentes du Sheet : toléré', () => {
    const { rows } = parseCommandeRows([['N°', 'URL', 'Mot-clé cible'], ['c1', 'https://a.test/1', 'mot']]);
    expect(rows).toHaveLength(1);
    expect(rows[0].consigne).toBe('');
  });

  it('mot-clé « [REFONTE] mot » toléré, la colonne Type l\'emporte quand elle est remplie', () => {
    const { rows } = parseCommandeRows([
      COMMANDE_HEADER,
      cmd('a', 'https://a.test/1', '[REFONTE] mot un'),
      cmd('b', 'https://a.test/2', '[REFONTE] mot deux', 'MAJ'),
    ]);
    expect(rows[0]).toMatchObject({ targetKeyword: 'mot un', majType: 'refonte' });
    expect(rows[1]).toMatchObject({ targetKeyword: 'mot deux', majType: 'maj' });
  });

  it('écarte et compte les lignes sans URL ou sans mot-clé ; ignore les lignes vides', () => {
    const { rows, skipped } = parseCommandeRows([
      COMMANDE_HEADER,
      cmd('a', '', 'mot'),
      cmd('b', 'https://a.test/1', ''),
      ['', '', '', '', '', ''],
      cmd('c', 'https://a.test/2', 'ok'),
    ]);
    expect(rows.map((r) => r.rowRef)).toEqual(['c']);
    expect(skipped).toEqual({ noUrl: 1, noKeyword: 1 });
  });

  it('feuille vide ou en-tête seul : rien', () => {
    expect(parseCommandeRows([]).rows).toEqual([]);
    expect(parseCommandeRows(undefined).rows).toEqual([]);
    expect(parseCommandeRows([COMMANDE_HEADER]).rows).toEqual([]);
  });

  it('sans « N° » : rowRef null (la synchro l\'ignorera, dédoublonnage impossible)', () => {
    const { rows } = parseCommandeRows([COMMANDE_HEADER, cmd('', 'https://a.test/1', 'mot')]);
    expect(rows[0].rowRef).toBeNull();
  });
});

describe('circuit complet avec createGoogleSheetSync', () => {
  it('les commandes sont MISES EN ATTENTE (INSERT IGNORE gsheet_staged_items), avec consigne, type et attribution', async () => {
    const query = jest.fn().mockResolvedValueOnce([[]]).mockResolvedValue([{ affectedRows: 1 }]);
    const fetchSheetValuesFn = jest.fn().mockResolvedValue([
      COMMANDE_HEADER,
      cmd('c1', 'https://a.test/1', 'mot un', 'MAJ ciblée', 'Change les H2', 'sahara'),
    ]);
    const sync = createGoogleSheetSync({
      getPool: () => ({ query }),
      fetchSheetValuesFn,
      parseSheetRowsFn: parseCommandeRows,
      now: () => 111,
      onLog: () => {},
    });
    const result = await sync.runSync({}, 'EXPORT_SHEET');
    expect(result.inserted).toBe(1);
    const [sql, params] = query.mock.calls[1];
    expect(sql).toMatch(/INSERT IGNORE INTO gsheet_staged_items/);
    expect(params).toEqual(expect.arrayContaining(['EXPORT_SHEET', 'c1', 'https://a.test/1', 'mot un', 'ciblee', 'Change les H2', 'sahara', 'nouveau']));
    // Rien d'autre que de la mise en attente : aucun batch créé.
    query.mock.calls.forEach(([q]) => expect(q).not.toMatch(/INSERT[^;]*INTO batches|INTO batch_items/i));
  });
});
