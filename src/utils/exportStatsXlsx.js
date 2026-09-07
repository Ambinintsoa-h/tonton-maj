/**
 * exportStatsXlsx.js — export .xlsx des stats "Mes MAJ" (demande Andrianina,
 * septembre 2026) : une feuille "Détail" (une ligne par article, timestamps
 * réels compris) et une feuille "Par utilisateur" (agrégats). 100 % client :
 * `XLSX.writeFile` déclenche le téléchargement directement dans le
 * navigateur, aucun aller-retour serveur. `xlsx` (SheetJS) est déjà une
 * dépendance du projet (import de fichiers Sheet sur /lots et /skills) --
 * c'est son premier usage en ÉCRITURE.
 */
import * as XLSX from 'xlsx';
import { fmtDate } from './batchDisplay';

/**
 * @param {object} args
 * @param {Array} args.items — batch_items filtrés (déjà scopés à la période)
 * @param {Array} args.byLauncher — sortie de `aggregateByLauncher(items)`
 * @param {string} [args.from] — date de début (YYYY-MM-DD), pour le nom de fichier
 * @param {string} [args.to] — date de fin (YYYY-MM-DD), pour le nom de fichier
 */
export const exportStatsToExcel = ({ items, byLauncher, from, to }) => {
  const detailRows = items.map((it) => ({
    Article: it.articleUrl || '',
    Site: it.site || '',
    'Mot-clé': it.targetKeyword || '',
    'Lancé par': it.launchedByName || it.launchedBy || '',
    'Lancé le': fmtDate(it.launchedAt),
    'Démarré le': fmtDate(it.startedAt),
    'Terminé le': fmtDate(it.completedAt),
    'Durée (s)': it.startedAt && it.completedAt ? Math.round((it.completedAt - it.startedAt) / 1000) : '',
    'Coût ($)': it.costUsd != null ? Number(it.costUsd.toFixed(4)) : '',
    Statut: it.status || '',
    'Publié le': fmtDate(it.publishedAt),
  }));

  const launcherRows = byLauncher.map((l) => ({
    Lanceur: l.launcher,
    Articles: l.count,
    "Taux d'erreur (%)": Number((l.errorRate * 100).toFixed(1)),
    'Durée moyenne (s)': l.avgDurationMs != null ? Math.round(l.avgDurationMs / 1000) : '',
    'Coût moyen ($)': l.avgCostUsd != null ? Number(l.avgCostUsd.toFixed(4)) : '',
    'Coût total ($)': Number(l.totalCostUsd.toFixed(2)),
  }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(detailRows), 'Détail');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(launcherRows), 'Par utilisateur');

  const period = from && to ? `_${from}_au_${to}` : '';
  XLSX.writeFile(wb, `tonton-stats${period}.xlsx`);
};
