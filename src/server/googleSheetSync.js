/**
 * googleSheetSync.js — détecte les lignes NEUVES du Google Sheet de suivi et
 * les met en attente (`gsheet_staged_items`), sans jamais créer de batch
 * toute seule. Décision Andrianina, août 2026 : la détection tourne en
 * automatique (cron 5 min, proxy.js) mais le LANCEMENT reste un clic humain
 * sur l'écran /lots -- exactement le même garde-fou que l'import .xlsx
 * manuel (voir src/utils/batchSheetImport.js), juste sans avoir à
 * exporter/réimporter le fichier à la main.
 *
 * Dédoublonnage sur (spreadsheet_id, row_ref) via la contrainte UNIQUE de la
 * table (migration alter-add-gsheet-staged-items.sql) + INSERT IGNORE :
 * MySQL lui-même refuse les doublons, aucune lecture préalable nécessaire et
 * aucune fenêtre de course entre deux ticks qui se chevaucheraient.
 *
 * Toutes les dépendances externes (lecture Sheet, horloge) sont injectées --
 * jamais lues en dur ici -- pour que les tests n'appellent jamais l'API
 * Google réelle.
 */
const crypto = require('crypto');
const { fetchSheetValues: defaultFetchSheetValues } = require('./googleSheetsClient');
const { parseSheetRows: defaultParseSheetRows } = require('./gsheetRowParser');

/**
 * @param {object} deps
 * @param {function} deps.getPool
 * @param {function} [deps.fetchSheetValuesFn]  (serviceAccount, spreadsheetId) => Promise<rows[][]>
 * @param {function} [deps.parseSheetRowsFn]     (rows[][]) => { rows, skipped }
 * @param {function} [deps.now]                  () => number, injecté pour les tests
 * @param {function} [deps.onLog]
 */
function createGoogleSheetSync(deps) {
  const {
    getPool,
    fetchSheetValuesFn = defaultFetchSheetValues,
    parseSheetRowsFn = defaultParseSheetRows,
    now = () => Date.now(),
    onLog = () => {},
  } = deps;

  /**
   * @param {object} serviceAccount  JSON.parse() de la clé de compte de service
   * @param {string} spreadsheetId
   * @returns {Promise<{ scanned:number, inserted:number, skippedNoRowRef:number, skippedNoUrl:number, skippedNoKeyword:number }>}
   */
  const runSync = async (serviceAccount, spreadsheetId) => {
    const sheetRows = await fetchSheetValuesFn(serviceAccount, spreadsheetId);
    const { rows, skipped } = parseSheetRowsFn(sheetRows);

    const withRowRef = rows.filter((r) => r.rowRef);
    const skippedNoRowRef = rows.length - withRowRef.length;
    if (skippedNoRowRef > 0) {
      onLog(`[gsheet-sync] ${skippedNoRowRef} ligne(s) sans "N°" -- ignorée(s), dédoublonnage impossible`);
    }
    if (!withRowRef.length) {
      return { scanned: rows.length, inserted: 0, skippedNoRowRef, skippedNoUrl: skipped.noUrl, skippedNoKeyword: skipped.noKeyword };
    }

    const pool = getPool();
    const detectedAt = now();
    const values = withRowRef.map((r) => [
      crypto.randomUUID(), spreadsheetId, r.rowRef, r.site, r.articleUrl,
      r.targetKeyword, r.majType, r.consigne || null, 'nouveau', detectedAt,
    ]);
    const placeholders = values.map(() => '(?,?,?,?,?,?,?,?,?,?)').join(',');
    const [result] = await pool.query(
      `INSERT IGNORE INTO gsheet_staged_items
         (id, spreadsheet_id, row_ref, site, article_url, target_keyword, maj_type, consigne, status, detected_at)
       VALUES ${placeholders}`,
      values.flat(),
    );

    const inserted = result.affectedRows || 0;
    if (inserted > 0) onLog(`[gsheet-sync] ${inserted} nouvelle(s) ligne(s) détectée(s) et mise(s) en attente`);
    return {
      scanned: rows.length,
      inserted,
      skippedNoRowRef,
      skippedNoUrl: skipped.noUrl,
      skippedNoKeyword: skipped.noKeyword,
    };
  };

  return { runSync };
}

module.exports = { createGoogleSheetSync };
