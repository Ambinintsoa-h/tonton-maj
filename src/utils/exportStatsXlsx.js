/**
 * exportStatsXlsx.js — export .xlsx des stats "Mes MAJ" (demande Andrianina,
 * septembre 2026). 100 % client : `XLSX.writeFile` déclenche le téléchargement
 * directement dans le navigateur, aucun aller-retour serveur. `xlsx` (SheetJS)
 * est déjà une dépendance du projet (import de fichiers Sheet sur /lots et
 * /skills) -- c'est son premier usage en ÉCRITURE.
 *
 * QUATRE FEUILLES, et chacune répond à une question posée :
 *   • Détail             — une ligne par article (timestamps réels compris) ;
 *   • Par jour et par rédacteur — « quel volume par jour par quel user,
 *     combien en $, combien de temps tonton ai traite, et combien de temps
 *     l'utilisateur fasse la relecture » (demande du 15/09/2026, mot pour mot) ;
 *   • Par utilisateur    — les mêmes agrégats, sans le découpage par jour ;
 *   • Par jour           — volume et coût de toute l'équipe, jour par jour.
 *
 * DEUX DURÉES QUI NE SE MÉLANGENT JAMAIS, et c'est le point à ne pas perdre :
 *   • « Tonton » = temps MACHINE (completedAt − startedAt d'un batch_item) ;
 *   • « Relecture » = temps HUMAIN actif, phases 3 et 4 seulement, pauses de
 *     plus de 5 minutes exclues.
 * Les additionner donnerait un « temps total » qui ne veut rien dire : pendant
 * que Tonton traite un article, le rédacteur en relit un autre.
 */
import * as XLSX from 'xlsx';
import { fmtDate, relectureByArticle } from './batchDisplay';

const min = (s) => (s ? Math.round(s / 60) : 0);
const usd = (n) => (n != null ? Number(n.toFixed(4)) : '');

/**
 * @param {object} args
 * @param {Array} args.items — batch_items filtrés (déjà scopés à la période)
 * @param {Array} args.byLauncher — sortie de `aggregateByLauncher(items)`
 * @param {Array} [args.byDayUser] — sortie de `aggregateByDayAndUser(items, relectures)`
 * @param {Array} [args.byDay] — sortie de `groupCostByDay(items)`
 * @param {Array} [args.relectures] — lignes relecture_time bornées à la période
 * @param {string} [args.from] — date de début (YYYY-MM-DD), pour le nom de fichier
 * @param {string} [args.to] — date de fin (YYYY-MM-DD), pour le nom de fichier
 */
export const exportStatsToExcel = ({
  items, byLauncher, byDayUser = [], byDay = [], relectures = [], from, to,
}) => {
  // Temps de relecture rattaché à CHAQUE article : sans ça, la feuille Détail
  // ne dirait rien du travail humain passé sur l'article de la ligne.
  const relecture = relectureByArticle(relectures);

  const detailRows = items.map((it) => {
    const r = relecture.get(it.articleId) || null;
    return {
      Article: it.articleUrl || '',
      Site: it.site || '',
      'Mot-clé': it.targetKeyword || '',
      'Lancé par': it.launchedByName || it.launchedBy || '',
      'Lancé le': fmtDate(it.launchedAt),
      'Démarré le': fmtDate(it.startedAt),
      'Terminé le': fmtDate(it.completedAt),
      'Traitement Tonton (s)': it.startedAt && it.completedAt ? Math.round((it.completedAt - it.startedAt) / 1000) : '',
      'Relecture humaine (min)': r ? min(r.horsTontonSeconds) : '',
      'Relecture avec Tonton (min)': r ? min(r.avecTontonSeconds) : '',
      'Relu par': r ? r.relecteurs.join(', ') : '',
      'Coût ($)': usd(it.costUsd),
      Statut: it.status || '',
      'Publié le': fmtDate(it.publishedAt),
    };
  });

  // LA feuille demandée. « Articles » compte les articles LANCÉS ce jour-là par
  // cette personne ; « Relecture » compte le temps qu'elle a passé en relecture
  // ce jour-là — pas forcément sur les mêmes articles, et c'est assumé (voir
  // aggregateByDayAndUser).
  const dayUserRows = byDayUser.map((r) => ({
    Jour: r.day,
    Rédacteur: r.user,
    'Articles traités': r.articles,
    'Coût ($)': usd(r.costUsd),
    'Traitement Tonton (min)': r.tontonCount ? min(r.tontonMs / 1000) : '',
    'Traitement Tonton moyen (s)': r.tontonCount ? Math.round(r.tontonMs / r.tontonCount / 1000) : '',
    'Relecture humaine (min)': min(r.relectureSeconds),
    'Relecture avec Tonton (min)': min(r.relectureAvecTontonSeconds),
  }));

  // Totaux de relecture par personne, pour compléter la vue « Par utilisateur »
  // qui, elle, ne connaît que les batch_items.
  const relectureParUser = new Map();
  byDayUser.forEach((r) => {
    const e = relectureParUser.get(r.user) || { hors: 0, avec: 0 };
    e.hors += r.relectureSeconds;
    e.avec += r.relectureAvecTontonSeconds;
    relectureParUser.set(r.user, e);
  });

  const launcherRows = byLauncher.map((l) => {
    const r = relectureParUser.get(l.launcher) || { hors: 0, avec: 0 };
    return {
      Rédacteur: l.launcher,
      Articles: l.count,
      "Taux d'erreur (%)": Number((l.errorRate * 100).toFixed(1)),
      'Traitement Tonton moyen (s)': l.avgDurationMs != null ? Math.round(l.avgDurationMs / 1000) : '',
      'Relecture humaine (min)': min(r.hors),
      'Relecture avec Tonton (min)': min(r.avec),
      'Coût moyen ($)': usd(l.avgCostUsd),
      'Coût total ($)': l.totalCostUsd != null ? Number(l.totalCostUsd.toFixed(2)) : '',
    };
  });

  const dayRows = byDay.map((d) => ({
    Jour: d.day,
    'Articles traités': d.count,
    'Coût ($)': Number((d.costUsd || 0).toFixed(4)),
  }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(detailRows), 'Détail');
  // Une feuille VIDE est ajoutée quand même : son absence se lirait « la donnée
  // n'existe pas », alors qu'elle veut dire « personne n'a relu sur la période »
  // — ou, pour un rôle sans accès à relecture_time, « je n'ai pas le droit de
  // la lire ». Deux états, deux lectures : l'en-tête reste là, les lignes non.
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(dayUserRows), 'Par jour et par rédacteur');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(launcherRows), 'Par utilisateur');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(dayRows), 'Par jour');

  const period = from && to ? `_${from}_au_${to}` : '';
  XLSX.writeFile(wb, `tonton-suivi-redacteurs${period}.xlsx`);
  // Le total est renvoyé pour que l'écran puisse le DIRE (« 42 lignes
  // exportées »). Un fichier qui tombe dans les téléchargements sans un mot
  // laisse le doute sur ce qu'il contient.
  return { detail: detailRows.length, jourUtilisateur: dayUserRows.length, utilisateurs: launcherRows.length };
};
