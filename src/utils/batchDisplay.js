/**
 * batchDisplay.js — mise en forme partagée pour tout ce qui affiche des
 * `batch_items` (coût, durée, statut) : LotsBatch.jsx ("MAJ en lot") et
 * MajEnAttente.jsx ("Mes MAJ"). Extrait de LotsBatch.jsx (chantier "Mes MAJ",
 * septembre 2026) pour que les deux écrans ne dérivent jamais l'un de
 * l'autre sur ce qui est, au fond, la même donnée présentée deux fois.
 */

export const fmtDate = (ts) => {
  if (!ts) return '—';
  try {
    return new Date(ts).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch { return '—'; }
};

export const fmtDuration = (ms) => {
  if (ms == null || ms < 0) return '—';
  const totalSec = Math.round(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return min > 0 ? `${min} min ${sec}s` : `${sec}s`;
};

export const fmtCost = (usd) => (usd == null ? '—' : `$${usd < 0.01 ? usd.toFixed(4) : usd.toFixed(2)}`);

export const BATCH_STATUS_META = {
  pending: { label: 'En attente', color: 'text-amber-600  bg-amber-50  border-amber-200' },
  running: { label: 'En cours',   color: 'text-blue-600   bg-blue-50   border-blue-200' },
  done:    { label: 'Terminé',    color: 'text-emerald-600 bg-emerald-50 border-emerald-200' },
  error:   { label: 'Erreur',     color: 'text-red-600    bg-red-50    border-red-200' },
};

export const ITEM_STATUS_META = {
  en_attente: { label: 'En attente', color: 'text-amber-600  bg-amber-50  border-amber-200' },
  en_cours:   { label: 'En cours',   color: 'text-blue-600   bg-blue-50   border-blue-200' },
  fait:       { label: 'Fait',       color: 'text-emerald-600 bg-emerald-50 border-emerald-200' },
  erreur:     { label: 'Erreur',     color: 'text-red-600    bg-red-50    border-red-200' },
  a_revoir:   { label: 'À revoir',   color: 'text-purple-600 bg-purple-50 border-purple-200' },
};

// ── "Mes MAJ" : distingue "à relire" de "publié", que batch_items seul ne
// sait pas dire (son statut 'fait' veut juste dire "prêt pour la relecture
// humaine" -- la publication est un fait distinct, tracé dans article_time).
export const DISPLAY_STATUS = {
  a_traiter: { key: 'a_traiter', label: 'À traiter', color: 'text-amber-600  bg-amber-50  border-amber-200' },
  a_relire:  { key: 'a_relire',  label: 'À relire',   color: 'text-blue-600   bg-blue-50   border-blue-200' },
  publie:    { key: 'publie',    label: 'Publié',     color: 'text-emerald-600 bg-emerald-50 border-emerald-200' },
  erreur:    { key: 'erreur',    label: 'Erreur',     color: 'text-red-600    bg-red-50    border-red-200' },
};

/**
 * @param {{status:string, publishedAt?:number|null}} item
 * @returns {keyof typeof DISPLAY_STATUS}
 */
export const deriveDisplayStatus = (item) => {
  if (item.status === 'erreur' || item.status === 'a_revoir') return 'erreur';
  if (item.status === 'fait') return item.publishedAt ? 'publie' : 'a_relire';
  return 'a_traiter'; // en_attente | en_cours
};

/**
 * Regroupe une liste de batch_items (avec costUsd/completedAt) par jour local
 * (YYYY-MM-DD, fuseau du lecteur -- pas UTC, pour ne pas décaler les articles
 * traités près de minuit). Jours triés du plus récent au plus ancien.
 * @returns {Array<{day:string, count:number, costUsd:number}>}
 */
export const groupCostByDay = (items) => {
  const byDay = new Map();
  items.forEach((it) => {
    const ts = it.completedAt || it.startedAt;
    if (!ts) return;
    const d = new Date(ts);
    const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const entry = byDay.get(day) || { day, count: 0, costUsd: 0 };
    entry.count += 1;
    entry.costUsd += it.costUsd || 0;
    byDay.set(day, entry);
  });
  return [...byDay.values()].sort((a, b) => (a.day < b.day ? 1 : -1));
};

/**
 * Regroupe une liste de batch_items par lanceur (launchedByName), pour la
 * vue "Par utilisateur" de Mes MAJ et son export Excel. N, taux d'erreur,
 * durée moyenne (seulement sur les items qui ont un début ET une fin -- une
 * erreur précoce n'a pas de durée exploitable), coût moyen et total
 * (seulement sur les items dont le coût est connu). Trié par N décroissant.
 * @returns {Array<{launcher:string, count:number, errorRate:number,
 *   avgDurationMs:number|null, avgCostUsd:number|null, totalCostUsd:number}>}
 */
export const aggregateByLauncher = (items) => {
  const byLauncher = new Map();
  items.forEach((it) => {
    const key = it.launchedByName || it.launchedBy || 'Inconnu';
    const entry = byLauncher.get(key) || {
      launcher: key, count: 0, errorCount: 0,
      durationSum: 0, durationCount: 0,
      costSum: 0, costCount: 0,
    };
    entry.count += 1;
    if (it.status === 'erreur' || it.status === 'a_revoir') entry.errorCount += 1;
    if (it.startedAt && it.completedAt) {
      entry.durationSum += (it.completedAt - it.startedAt);
      entry.durationCount += 1;
    }
    if (it.costUsd != null) {
      entry.costSum += it.costUsd;
      entry.costCount += 1;
    }
    byLauncher.set(key, entry);
  });
  return [...byLauncher.values()]
    .map((e) => ({
      launcher: e.launcher,
      count: e.count,
      errorRate: e.count ? e.errorCount / e.count : 0,
      avgDurationMs: e.durationCount ? e.durationSum / e.durationCount : null,
      avgCostUsd: e.costCount ? e.costSum / e.costCount : null,
      totalCostUsd: e.costSum,
    }))
    .sort((a, b) => b.count - a.count);
};

// ─────────────────────────────────────────────────────────────────────────────
// SUIVI DES RÉDACTEURS — demande Andrianina, 15 septembre 2026 :
// « quel volume par jour par quel user, combien en $, combien de temps tonton ai
//   traite, et combien de temps l'utilisateur fasse la relecture ».
//
// Ces quatre chiffres vivaient dans DEUX tables qui ne se parlaient pas :
//   • `batch_items` — volume, coût, et durée de TRAITEMENT (completedAt −
//     startedAt : la machine, pas l'humain) ;
//   • `relecture_time` — durée de RELECTURE humaine (phases 3 et 4 seulement),
//     déjà découpée par JOUR et par personne, en deux compteurs « hors Tonton »
//     (temps actif humain) et « avec Tonton » (le même, PLUS la durée des appels
//     IA déclenchés pendant la fenêtre).
//
// Le rapprochement se fait sur l'IDENTIFIANT (uid), jamais sur le nom affiché :
// « Sahara RAZAFINDRAKOTO » et « sahara_razafindrakoto » désignent la même
// personne et deux clés différentes. Le nom ne sert qu'à l'affichage.
//
// LE LANCEUR N'EST PAS TOUJOURS LE RELECTEUR, et on ne le maquille pas : une
// personne qui n'a que relu apparaît avec 0 article et son temps de relecture,
// une personne qui n'a que lancé apparaît sans temps de relecture. Fondre les
// deux dans une seule ligne « par article » ferait croire à un lien qui n'existe
// pas dans la donnée.
// ─────────────────────────────────────────────────────────────────────────────

/** Jour local YYYY-MM-DD — jamais toISOString (décalage UTC près de minuit). */
const localDay = (ts) => {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/**
 * Secondes → « 30 min » / « 1 h 30 ». `null` seul vaut « — » : ZÉRO est une
 * mesure (« personne n'a relu sur la période »), pas une absence de mesure.
 * Les confondre ferait lire « pas de donnée » là où la donnée dit zéro.
 */
export const fmtMinutes = (seconds) => {
  if (seconds == null) return '—';
  const min = Math.round(seconds / 60);
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`;
};

/**
 * Temps de relecture cumulé PAR ARTICLE, tous jours et tous relecteurs confondus.
 * Sert à la feuille « Détail » de l'export : une ligne = un article.
 * @returns {Map<string, {horsTontonSeconds:number, avecTontonSeconds:number, relecteurs:string[]}>}
 */
export const relectureByArticle = (relectures = []) => {
  const out = new Map();
  (relectures || []).forEach((r) => {
    if (!r?.articleId) return;
    const e = out.get(r.articleId) || { horsTontonSeconds: 0, avecTontonSeconds: 0, relecteurs: [] };
    e.horsTontonSeconds += r.horsTontonSeconds || 0;
    e.avecTontonSeconds += r.avecTontonSeconds || 0;
    const nom = r.userName || r.userId;
    if (nom && !e.relecteurs.includes(nom)) e.relecteurs.push(nom);
    out.set(r.articleId, e);
  });
  return out;
};

/**
 * LE TABLEAU DEMANDÉ : une ligne par (jour × personne).
 *
 * `items` = batch_items déjà filtrés à l'écran ; `relectures` = lignes
 * relecture_time (bornées à la même période par l'appelant — la route
 * `/relecture-time` renvoie TOUT, elle n'a pas de filtre de date).
 *
 * @returns {Array<{day:string, userId:string, user:string, articles:number,
 *   costUsd:number, tontonMs:number, tontonCount:number,
 *   relectureSeconds:number, relectureAvecTontonSeconds:number}>}
 *   Trié du jour le plus récent au plus ancien, puis par volume décroissant.
 */
export const aggregateByDayAndUser = (items = [], relectures = []) => {
  const rows = new Map();
  const cle = (day, userId) => `${day}|${userId}`;
  const entree = (day, userId, user) => {
    const k = cle(day, userId);
    if (!rows.has(k)) {
      rows.set(k, {
        day, userId, user: user || userId || 'Inconnu',
        articles: 0, costUsd: 0, tontonMs: 0, tontonCount: 0,
        relectureSeconds: 0, relectureAvecTontonSeconds: 0,
      });
    }
    const e = rows.get(k);
    // Le nom le plus lisible gagne : `launched_by_name` porte « Prénom NOM »,
    // alors qu'une ligne de relecture peut n'avoir que l'identifiant.
    if (user && (!e.user || e.user === e.userId)) e.user = user;
    return e;
  };

  (items || []).forEach((it) => {
    const ts = it.completedAt || it.startedAt || it.launchedAt;
    if (!ts) return;
    const e = entree(localDay(ts), it.launchedBy || it.launchedByName || 'inconnu', it.launchedByName);
    e.articles += 1;
    e.costUsd += it.costUsd || 0;
    if (it.startedAt && it.completedAt) {
      e.tontonMs += (it.completedAt - it.startedAt);
      e.tontonCount += 1;
    }
  });

  (relectures || []).forEach((r) => {
    if (!r?.date || !r?.userId) return;
    const e = entree(r.date, r.userId, r.userName);
    e.relectureSeconds += r.horsTontonSeconds || 0;
    e.relectureAvecTontonSeconds += r.avecTontonSeconds || 0;
  });

  return [...rows.values()].sort((a, b) => (a.day === b.day
    ? b.articles - a.articles || a.user.localeCompare(b.user)
    : (a.day < b.day ? 1 : -1)));
};

/**
 * Borne une liste relecture_time à une période [from, to] de jours INCLUS
 * (YYYY-MM-DD). La route serveur renvoie toute la table : sans ce filtre,
 * l'export contiendrait des jours hors de la période affichée à l'écran — et
 * l'écran et le fichier ne diraient pas la même chose.
 */
export const filterRelectureByPeriod = (relectures = [], from = '', to = '') =>
  (relectures || []).filter((r) => {
    if (!r?.date) return false;
    if (from && r.date < from) return false;
    if (to && r.date > to) return false;
    return true;
  });
