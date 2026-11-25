/**
 * commandeMajSheet.js — onglet « Commande MAJ » du Sheet d'export (réglage
 * googleSheetsMajExportId). SENS ENTRANT : la publiconsole y ajoute des
 * commandes de mise à jour, Tonton les lit. Tonton n'y écrit JAMAIS de ligne :
 * il se contente de créer l'onglet (avec son en-tête) s'il manque, pour que la
 * console sache quoi remplir.
 *
 * Les lignes lues passent par le même circuit que le Sheet de suivi
 * (googleSheetSync.js -> gsheet_staged_items) : elles arrivent EN ATTENTE sur
 * l'écran /lots, jamais lancées seules — le clic « Lancer » reste le garde-fou
 * humain (décision Andrianina, août 2026).
 *
 * Ce module ne contient que des constantes et le parseur : aucune dépendance
 * réseau, donc testable sans Google.
 */
const { findColumnIndex, parseKeywordCell } = require('./gsheetRowParser');

const COMMANDE_TAB = 'Commande MAJ';

/** Colonnes attendues, dans cet ordre (la lecture se fait par NOM d'en-tête). */
const COMMANDE_HEADER = ['N°', 'URL', 'Mot-clé cible', 'Type de MAJ', 'Consigne', 'Attribué à'];

// Motifs sans accent, en minuscules : findColumnIndex normalise les en-têtes, pas les motifs.
const HEADER_PATTERNS = {
  rowRef: ['n°'],
  url: ['url'],
  keyword: ['mot-cle cible', 'mot cle', 'keyword'],
  type: ['type de maj', 'type'],
  consigne: ['consigne'],
  assignedTo: ['attribue', 'assigne'],
};

const guessSite = (url) => {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return null; }
};

const stripAccents = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');

/** « MAJ ciblée » -> 'ciblee' ; « Refonte » -> 'refonte' ; le reste -> 'maj'. */
const parseTypeCell = (raw) => {
  const t = stripAccents(raw).toLowerCase().trim();
  if (!t) return null;
  if (t.includes('cible')) return 'ciblee';
  if (t.includes('refonte')) return 'refonte';
  return 'maj';
};

/**
 * Même forme de sortie que gsheetRowParser.parseSheetRows : { rows, skipped },
 * pour être injecté tel quel dans createGoogleSheetSync.
 * Une ligne sans URL ou sans mot-clé est écartée (et comptée). Un mot-clé écrit
 * « [REFONTE] mot » est toléré ; la colonne Type l'emporte quand elle est remplie.
 * Une ligne sans « N° » est lue mais ignorée plus loin (dédoublonnage impossible).
 */
const parseCommandeRows = (sheetRows) => {
  const [headerRow, ...dataRows] = sheetRows || [];
  const skipped = { noUrl: 0, noKeyword: 0 };
  if (!headerRow) return { rows: [], skipped };

  const idx = {};
  Object.keys(HEADER_PATTERNS).forEach((k) => { idx[k] = findColumnIndex(headerRow, HEADER_PATTERNS[k]); });
  const cell = (r, i) => (i >= 0 ? String(r[i] ?? '').trim() : '');

  const rows = [];
  dataRows.forEach((r) => {
    if (!Array.isArray(r) || !r.some((c) => String(c ?? '').trim())) return; // ligne vide

    const articleUrl = cell(r, idx.url);
    if (!articleUrl) { skipped.noUrl += 1; return; }

    const { majType: typeFromKeyword, targetKeyword } = parseKeywordCell(cell(r, idx.keyword));
    if (!targetKeyword) { skipped.noKeyword += 1; return; }

    rows.push({
      rowRef: cell(r, idx.rowRef) || null,
      site: guessSite(articleUrl),
      articleUrl,
      targetKeyword,
      majType: parseTypeCell(cell(r, idx.type)) || typeFromKeyword,
      consigne: cell(r, idx.consigne),
      assignedTo: cell(r, idx.assignedTo) || null,
    });
  });
  return { rows, skipped };
};

module.exports = { COMMANDE_TAB, COMMANDE_HEADER, parseCommandeRows, parseTypeCell };
