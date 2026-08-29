/**
 * batchSheetImport.js — lit le format d'export "Google Sheet" de la rédac
 * (chantier MAJ en masse, Phase 3) pour pré-remplir l'écran /lots.
 *
 * Décision Andrianina, 28 août 2026 : PAS d'API Google Sheets (pas de compte
 * de service, pas de credentials à gérer) -- la rédac exporte le Sheet en
 * .xlsx et l'importe directement dans /lots, où les lignes sont relues avant
 * de lancer le lot, exactement comme la saisie manuelle. Voir
 * `EXEMPLE FICHIER.xlsx` (fourni le même jour) pour le format exact.
 *
 * Colonnes IGNORÉES sur demande explicite : Typologie, Malus/Bonus,
 * Sanction/Prime, Capture avant -- aucun rapport avec la génération.
 * Colonnes non reprises pour l'instant (informatives côté rédac, pas
 * nécessaires au pipeline qui scrape l'URL en ligne) : Titre / sujet, URL
 * Google docs, URL WP, Date de la réalisation, Nbre de mots cible, Nb de mots
 * livrés.
 */

const stripAccents = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');
const normalizeHeader = (h) => stripAccents(h).toLowerCase().replace(/\s+/g, ' ').trim();

const HEADER_PATTERNS = {
  rowRef: ['n°', 'no', 'n'],
  keyword: ['keyword'],
  articleUrl: ['url article mise en ligne'],
  validation: ['validation'],
};

export const findColumnIndex = (headers, patterns) => {
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

/**
 * "[MAJ] tarif lessivage mur et plafond" -> { majType: 'maj', targetKeyword: 'tarif lessivage mur et plafond' }
 *
 * Sans balise reconnue, tout tombe sur 'maj' (donc sur l'audit, qui décide
 * seul de l'ampleur réelle -- voir pipeline.js, scopeProposedByAudit) :
 * consigne explicite d'Andrianina, 28 août 2026. Seule une future colonne
 * "refonte totale" (pas encore dans le Sheet) forcera vraiment la refonte.
 */
export const parseKeywordCell = (raw) => {
  const text = String(raw ?? '').trim();
  const m = text.match(/^\[(maj|refonte)\]\s*/i);
  if (m) return { majType: m[1].toLowerCase(), targetKeyword: text.slice(m[0].length).trim() };
  return { majType: 'maj', targetKeyword: text };
};

const guessSite = (url) => {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return null; }
};

/**
 * @param {Array<Array<any>>} sheetRows — sortie de XLSX.utils.sheet_to_json(ws, {header:1, defval:''})
 * @returns {{ rows: Array<{rowRef,site,articleUrl,targetKeyword,majType,consigne}>, skipped: {notValidated:number, noUrl:number, noKeyword:number} }}
 */
export const parseBatchSheetRows = (sheetRows) => {
  const [headerRow, ...dataRows] = sheetRows || [];
  const skipped = { notValidated: 0, noUrl: 0, noKeyword: 0 };
  if (!headerRow) return { rows: [], skipped };

  const idxRowRef = findColumnIndex(headerRow, HEADER_PATTERNS.rowRef);
  const idxKeyword = findColumnIndex(headerRow, HEADER_PATTERNS.keyword);
  const idxUrl = findColumnIndex(headerRow, HEADER_PATTERNS.articleUrl);
  const idxValidation = findColumnIndex(headerRow, HEADER_PATTERNS.validation);

  const rows = [];
  dataRows.forEach((r) => {
    if (!Array.isArray(r) || !r.some((c) => String(c ?? '').trim())) return; // ligne vide

    // Seules les lignes marquées prêtes (n'importe quel contenu non vide dans
    // "Validation" -- ✅, "OK"...) sont importées : les autres sont
    // probablement encore en rédaction humaine. Décision Andrianina, 28/08/2026.
    const isValidated = idxValidation < 0 || !!String(r[idxValidation] ?? '').trim();
    if (!isValidated) { skipped.notValidated += 1; return; }

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
      consigne: '', // pas de colonne consigne dans ce format -- l'audit la génère lui-même (voir pipeline.js)
    });
  });

  return { rows, skipped };
};
