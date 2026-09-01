/**
 * gsheetRowParser.js — miroir CommonJS de src/utils/batchSheetImport.js pour
 * le cron serveur (proxy.js ne peut pas require() un module ESM `export
 * const` sans esbuild-register). Même mapping de colonnes, même règle de
 * validation, même parsing de mot-clé -- pour que l'import .xlsx manuel et
 * la synchronisation automatique produisent EXACTEMENT le même résultat sur
 * les mêmes données. Toute évolution des colonnes doit être répercutée dans
 * les deux fichiers.
 *
 * Ne PAS fusionner avec batchSheetImport.js : ce dernier reste utilisé tel
 * quel côté client (import .xlsx dans /lots), fonctionnalité existante qui
 * marche -- on n'y touche pas (règle 7, CLAUDE.md).
 */

const stripAccents = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');
const normalizeHeader = (h) => stripAccents(h).toLowerCase().replace(/\s+/g, ' ').trim();

const HEADER_PATTERNS = {
  rowRef: ['n°', 'no', 'n'],
  keyword: ['keyword'],
  articleUrl: ['url article mise en ligne'],
  validation: ['validation'],
  // "Attribué à" / "Assigné à" -- normalizeHeader retire les accents avant
  // comparaison, d'où "attribue"/"assigne" sans accent ici.
  assignedTo: ['attribue', 'assigne'],
};

const findColumnIndex = (headers, patterns) => {
  const normalized = (headers || []).map(normalizeHeader);
  for (const pattern of patterns) {
    const exact = normalized.findIndex((h) => h === pattern);
    if (exact >= 0) return exact;
  }
  for (const pattern of patterns) {
    const partial = normalized.findIndex((h) => h.includes(pattern));
    if (partial >= 0) return partial;
  }
  return -1;
};

// "[MAJ] tarif lessivage mur et plafond" -> { majType: 'maj', targetKeyword: '...' }
const parseKeywordCell = (raw) => {
  const text = String(raw ?? '').trim();
  const m = text.match(/^\[(maj|refonte)\]\s*/i);
  if (m) return { majType: m[1].toLowerCase(), targetKeyword: text.slice(m[0].length).trim() };
  return { majType: 'maj', targetKeyword: text };
};

const guessSite = (url) => {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return null; }
};

/**
 * Contrairement à l'import .xlsx manuel (batchSheetImport.js), la
 * synchronisation automatique NE filtre PAS sur la colonne "Validation" :
 * sur le Sheet réel, cette colonne est vide sur toutes les lignes (jamais
 * remplie par la rédac dans ce flux) -- l'appliquer ici rendrait la
 * détection totalement muette. Le garde-fou humain, ici, c'est l'écran de
 * mise en attente lui-même : une ligne détectée est STAGÉE, jamais lancée
 * seule ; c'est le clic sur "Lancer" qui vaut validation.
 *
 * @param {Array<Array<any>>} sheetRows — sortie brute de l'API Sheets (values.get)
 * @returns {{ rows: Array<{rowRef,site,articleUrl,targetKeyword,majType,consigne,assignedTo}>, skipped: {noUrl:number, noKeyword:number} }}
 */
const parseSheetRows = (sheetRows) => {
  const [headerRow, ...dataRows] = sheetRows || [];
  const skipped = { noUrl: 0, noKeyword: 0 };
  if (!headerRow) return { rows: [], skipped };

  const idxRowRef = findColumnIndex(headerRow, HEADER_PATTERNS.rowRef);
  const idxKeyword = findColumnIndex(headerRow, HEADER_PATTERNS.keyword);
  const idxUrl = findColumnIndex(headerRow, HEADER_PATTERNS.articleUrl);
  const idxAssignedTo = findColumnIndex(headerRow, HEADER_PATTERNS.assignedTo);

  const rows = [];
  dataRows.forEach((r) => {
    if (!Array.isArray(r) || !r.some((c) => String(c ?? '').trim())) return; // ligne vide

    const articleUrl = String(idxUrl >= 0 ? r[idxUrl] : '').trim();
    if (!articleUrl) { skipped.noUrl += 1; return; }

    const { majType, targetKeyword } = parseKeywordCell(idxKeyword >= 0 ? r[idxKeyword] : '');
    if (!targetKeyword) { skipped.noKeyword += 1; return; }

    rows.push({
      rowRef: idxRowRef >= 0 ? (String(r[idxRowRef] ?? '').trim() || null) : null,
      site: guessSite(articleUrl),
      articleUrl,
      targetKeyword,
      majType,
      consigne: '',
      assignedTo: idxAssignedTo >= 0 ? (String(r[idxAssignedTo] ?? '').trim() || null) : null,
    });
  });

  return { rows, skipped };
};

module.exports = { findColumnIndex, parseKeywordCell, parseSheetRows };
