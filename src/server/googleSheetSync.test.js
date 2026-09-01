const { createGoogleSheetSync } = require('./googleSheetSync');

const HEADER = ['Site', 'N°', 'Keyword', 'Titre', 'GDocs', 'WP', 'URL article mise en ligne', 'Date', 'Mots cible', 'Capture', 'Mots livrés', 'Validation', 'Typologie', 'Malus', 'Sanction'];
const sheetRow = (rowRef, keyword, url) => ['site.com', rowRef, keyword, '', '', '', url, '', '', '', '', '', '', '', ''];

// 1er appel : SELECT des row_ref déjà connus pour ce spreadsheet_id.
// 2e appel (s'il a lieu) : INSERT IGNORE des lignes fraîches.
function makeDeps({ sheetRows, affectedRows = 0, existingRows = [], query } = {}) {
  const queryMock = query || jest.fn()
    .mockResolvedValueOnce([existingRows])
    .mockResolvedValue([{ affectedRows }]);
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
    expect(result).toEqual({ scanned: 1, inserted: 0, duplicateRowRef: 0, skippedNoRowRef: 1, skippedNoUrl: 0, skippedNoKeyword: 0 });
  });

  it('insère les lignes fraîches (aucun "N°" connu) via INSERT IGNORE', async () => {
    const { deps, queryMock, fetchSheetValuesFn } = makeDeps({
      sheetRows: [HEADER, sheetRow('m1', '[MAJ] mot un', 'https://a.test/1'), sheetRow('m2', '[REFONTE] mot deux', 'https://a.test/2')],
      existingRows: [],
      affectedRows: 2,
    });
    const sync = createGoogleSheetSync(deps);
    const sa = { client_email: 'x', private_key: 'y' };
    const result = await sync.runSync(sa, 'SHEET_ID');

    expect(fetchSheetValuesFn).toHaveBeenCalledWith(sa, 'SHEET_ID');
    const [selectSql, selectParams] = queryMock.mock.calls[0];
    expect(selectSql).toMatch(/SELECT row_ref, article_url FROM gsheet_staged_items/);
    expect(selectParams).toEqual(['SHEET_ID']);
    const [insertSql, insertParams] = queryMock.mock.calls[1];
    expect(insertSql).toMatch(/INSERT IGNORE INTO gsheet_staged_items/);
    expect(insertParams).toEqual(expect.arrayContaining(['m1', 'm2', 'https://a.test/1', 'https://a.test/2', 'mot un', 'mot deux', 'maj', 'refonte', 'SHEET_ID']));
    expect(result).toEqual({ scanned: 2, inserted: 2, duplicateRowRef: 0, skippedNoRowRef: 0, skippedNoUrl: 0, skippedNoKeyword: 0 });
  });

  it('une ligne déjà connue avec la MÊME URL n\'est ni réinsérée ni comptée comme doublon suspect', async () => {
    const { deps, queryMock } = makeDeps({
      sheetRows: [HEADER, sheetRow('m1', '[MAJ] mot un', 'https://a.test/1')],
      existingRows: [{ row_ref: 'm1', article_url: 'https://a.test/1' }],
    });
    const sync = createGoogleSheetSync(deps);
    const result = await sync.runSync({ client_email: 'x', private_key: 'y' }, 'SHEET_ID');
    expect(result).toEqual({ scanned: 1, inserted: 0, duplicateRowRef: 0, skippedNoRowRef: 0, skippedNoUrl: 0, skippedNoKeyword: 0 });
    // Rien de nouveau à insérer -- l'INSERT ne doit même pas être tenté.
    expect(queryMock).toHaveBeenCalledTimes(1);
  });

  // Régression du 1er septembre 2026 : une ligne du Sheet dont le "N°" est déjà
  // connu mais dont l'URL diffère (ligne dupliquée en modèle, "N°" pas changé)
  // était silencieusement avalée par INSERT IGNORE -- "inserted" restait à 0
  // sans qu'aucun compteur ne dise pourquoi.
  it('une ligne dont le "N°" est déjà connu mais l\'URL diffère est comptée comme duplicateRowRef, jamais insérée', async () => {
    const { deps, queryMock } = makeDeps({
      sheetRows: [HEADER, sheetRow('m1', '[MAJ] mot un', 'https://a.test/AUTRE-ARTICLE')],
      existingRows: [{ row_ref: 'm1', article_url: 'https://a.test/1' }],
    });
    const sync = createGoogleSheetSync(deps);
    const result = await sync.runSync({ client_email: 'x', private_key: 'y' }, 'SHEET_ID');
    expect(result.duplicateRowRef).toBe(1);
    expect(result.inserted).toBe(0);
    expect(queryMock).toHaveBeenCalledTimes(1); // pas d'INSERT si rien de frais
  });

  it('mélange de lignes fraîches et de "N°" dupliqués avec URL différente', async () => {
    const { deps } = makeDeps({
      sheetRows: [
        HEADER,
        sheetRow('m1', '[MAJ] mot un', 'https://a.test/AUTRE'), // même N°, URL différente -> doublon suspect
        sheetRow('m2', '[MAJ] mot deux', 'https://a.test/2'),   // nouveau
      ],
      existingRows: [{ row_ref: 'm1', article_url: 'https://a.test/1' }],
      affectedRows: 1,
    });
    const sync = createGoogleSheetSync(deps);
    const result = await sync.runSync({ client_email: 'x', private_key: 'y' }, 'SHEET_ID');
    expect(result).toEqual({ scanned: 2, inserted: 1, duplicateRowRef: 1, skippedNoRowRef: 0, skippedNoUrl: 0, skippedNoKeyword: 0 });
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
