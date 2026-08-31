const { createGoogleSheetSync } = require('./googleSheetSync');

const HEADER = ['Site', 'N°', 'Keyword', 'Titre', 'GDocs', 'WP', 'URL article mise en ligne', 'Date', 'Mots cible', 'Capture', 'Mots livrés', 'Validation', 'Typologie', 'Malus', 'Sanction'];
const sheetRow = (rowRef, keyword, url) => ['site.com', rowRef, keyword, '', '', '', url, '', '', '', '', '', '', '', ''];

function makeDeps({ sheetRows, affectedRows = 0, query } = {}) {
  const queryMock = query || jest.fn().mockResolvedValue([{ affectedRows }]);
  const pool = { query: queryMock };
  const getPool = jest.fn(() => pool);
  const fetchSheetValuesFn = jest.fn().mockResolvedValue(sheetRows || [HEADER]);
  const onLog = jest.fn();
  const deps = { getPool, fetchSheetValuesFn, now: () => 1234567890, onLog };
  return { deps, pool, getPool, fetchSheetValuesFn, onLog, queryMock };
}

describe('createGoogleSheetSync', () => {
  it('ne touche pas la base quand aucune ligne n\'a de "N°"', async () => {
    const { deps, queryMock } = makeDeps({ sheetRows: [HEADER, sheetRow('', '[MAJ] mot', 'https://a.test')] });
    const sync = createGoogleSheetSync(deps);
    const result = await sync.runSync({ client_email: 'x', private_key: 'y' }, 'SHEET_ID');
    expect(queryMock).not.toHaveBeenCalled();
    expect(result).toEqual({ scanned: 1, inserted: 0, skippedNoRowRef: 1, skippedNoUrl: 0, skippedNoKeyword: 0 });
  });

  it('insère les lignes valides via INSERT IGNORE, dédoublonnées par (spreadsheet_id, row_ref)', async () => {
    const { deps, queryMock, fetchSheetValuesFn } = makeDeps({
      sheetRows: [HEADER, sheetRow('m1', '[MAJ] mot un', 'https://a.test/1'), sheetRow('m2', '[REFONTE] mot deux', 'https://a.test/2')],
      affectedRows: 2,
    });
    const sync = createGoogleSheetSync(deps);
    const sa = { client_email: 'x', private_key: 'y' };
    const result = await sync.runSync(sa, 'SHEET_ID');

    expect(fetchSheetValuesFn).toHaveBeenCalledWith(sa, 'SHEET_ID');
    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toMatch(/INSERT IGNORE INTO gsheet_staged_items/);
    expect(params).toEqual(expect.arrayContaining(['m1', 'm2', 'https://a.test/1', 'https://a.test/2', 'mot un', 'mot deux', 'maj', 'refonte', 'SHEET_ID']));
    expect(result).toEqual({ scanned: 2, inserted: 2, skippedNoRowRef: 0, skippedNoUrl: 0, skippedNoKeyword: 0 });
  });

  it('des lignes déjà connues (doublons) ne comptent pas dans "inserted"', async () => {
    const { deps } = makeDeps({
      sheetRows: [HEADER, sheetRow('m1', '[MAJ] mot un', 'https://a.test/1')],
      affectedRows: 0, // INSERT IGNORE : ligne déjà présente -- 0 ligne réellement insérée
    });
    const sync = createGoogleSheetSync(deps);
    const result = await sync.runSync({ client_email: 'x', private_key: 'y' }, 'SHEET_ID');
    expect(result.inserted).toBe(0);
  });

  it('remonte les compteurs "sans URL" / "sans mot-clé" du parseur sans planter', async () => {
    const { deps } = makeDeps({
      sheetRows: [HEADER, sheetRow('m1', '[MAJ] mot', ''), sheetRow('m2', '', 'https://a.test/2')],
    });
    const sync = createGoogleSheetSync(deps);
    const result = await sync.runSync({ client_email: 'x', private_key: 'y' }, 'SHEET_ID');
    expect(result.skippedNoUrl).toBe(1);
    expect(result.skippedNoKeyword).toBe(1);
    expect(result.inserted).toBe(0);
  });

  it('feuille vide -> aucun appel DB, aucune exception', async () => {
    const { deps, queryMock } = makeDeps({ sheetRows: [] });
    const sync = createGoogleSheetSync(deps);
    const result = await sync.runSync({ client_email: 'x', private_key: 'y' }, 'SHEET_ID');
    expect(queryMock).not.toHaveBeenCalled();
    expect(result.inserted).toBe(0);
  });
});
