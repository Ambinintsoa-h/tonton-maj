/**
 * majSheetExport.js — exporte l'état des mises à jour d'articles (lots et
 * articles de lot) vers un onglet « MAJ » d'un Google Sheet, que le module SEO
 * de la console lit. Sens SORTANT uniquement : rien ici ne lit le Sheet de suivi
 * (googleSheetSync.js reste la seule lecture entrante, inchangée).
 *
 * UNE LIGNE PAR ARTICLE DE LOT (`batch_items`) : un même article repassé dans
 * deux lots donne deux lignes — chaque ligne est une mise à jour distincte, avec
 * son lot, sa fin de traitement et son état de publication. Fusionner les deux
 * ferait perdre l'historique que le module SEO veut justement corréler.
 *
 * Le contenu de l'onglet est REMPLACÉ à chaque export (values.clear puis
 * values.update, voir googleSheetsClient.replaceTabValues) : l'onglet est un
 * miroir de la base, jamais un registre à compléter à la main.
 *
 * Dépendances externes (base, écriture Sheet, horloge) injectées, comme
 * googleSheetSync.js : les tests n'appellent jamais l'API Google ni MySQL.
 */
const { replaceTabValues: defaultReplaceTabValues } = require('./googleSheetsClient');

/** Onglet cible. Jamais autre chose : l'export n'écrit nulle part ailleurs. */
const MAJ_TAB = 'MAJ';
const TIME_ZONE = 'Europe/Paris';

const HEADER = [
  'Site',
  'URL',
  'Mot-clé cible',
  'Type de MAJ',
  'Statut',
  'Date de mise à jour',
  'Lot',
  'Lot lancé le',
  'Lot lancé par',
  'Fin de traitement',
  'Relecteur',
  'ID article',
  'ID item',
];

// Statuts bruts de batch_items -> libellé lisible pour le module SEO.
const STATUS_LABELS = {
  en_attente: 'En attente',
  en_cours: 'En cours',
  fait: 'Traité',
  a_revoir: 'À revoir',
  erreur: 'Erreur',
};
const MAJ_TYPE_LABELS = { maj: 'MAJ', ciblee: 'MAJ ciblée', refonte: 'Refonte' };

/** BIGINT (ms) -> "2026-11-24 14:05:00" en heure de Paris ; vide si absent/invalide. */
const formatTimestamp = (ms) => {
  const n = Number(ms);
  if (ms == null || ms === '' || !Number.isFinite(n) || n <= 0) return '';
  const d = new Date(n);
  if (Number.isNaN(d.getTime())) return '';
  // sv-SE donne déjà « AAAA-MM-JJ HH:mm:ss » : un format trié alphabétiquement = chronologiquement.
  return d.toLocaleString('sv-SE', { timeZone: TIME_ZONE });
};

/** Domaine sans « www. » ; vide si l'URL est illisible. */
const domainOf = (url) => {
  const s = String(url || '').trim();
  if (!s) return '';
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`).hostname.replace(/^www\./i, '');
  } catch {
    return '';
  }
};

/**
 * Statut exporté. Un article « fait » dont la publication est enregistrée
 * (article_time.published_at) est « Publié » : c'est l'état qui compte pour le
 * SEO — le texte est réellement en ligne, pas seulement généré.
 */
const statusOf = (row, publishedAt) => {
  if (row.status === 'fait' && publishedAt) return 'Publié';
  return STATUS_LABELS[row.status] || row.status || '';
};

/**
 * Relecteur = l'utilisateur qui a publié l'article ; à défaut, celui qui y a
 * passé le plus de temps. Vide si personne n'a ouvert l'article (lot jamais
 * relu) — « si disponible » : on n'invente pas de nom.
 * @param {Array<{user_name?:string, user_id?:string, total_active_minutes?:number, published_at?:number}>} timeRows
 */
const reviewerOf = (timeRows = []) => {
  if (!timeRows.length) return { name: '', publishedAt: null };
  const published = timeRows.filter((t) => t.published_at);
  const publishedAt = published.length ? Math.max(...published.map((t) => Number(t.published_at))) : null;
  const pick = published.length
    ? published.reduce((a, b) => (Number(b.published_at) > Number(a.published_at) ? b : a))
    : timeRows.reduce((a, b) => (Number(b.total_active_minutes || 0) > Number(a.total_active_minutes || 0) ? b : a));
  return { name: pick.user_name || pick.user_id || '', publishedAt };
};

/**
 * Construit les lignes de l'onglet (en-tête incluse, ligne 1).
 *
 * @param {Array<object>} items  batch_items JOIN batches JOIN articles (voir QUERY ci-dessous)
 * @param {Map<string, Array<object>>} timeByArticle  article_id -> lignes article_time
 * @returns {Array<Array<string|number>>}
 */
const buildRows = (items = [], timeByArticle = new Map()) => {
  const rows = items.map((r) => {
    const { name: reviewer, publishedAt } = reviewerOf(r.article_id ? timeByArticle.get(r.article_id) : []);
    const url = r.article_url || r.article_db_url || '';
    return [
      domainOf(url) || r.site || '',
      url,
      r.target_keyword || '',
      MAJ_TYPE_LABELS[r.maj_type] || r.maj_type || '',
      statusOf(r, publishedAt),
      // « Date de mise à jour » = mise en ligne effective ; vide tant que rien
      // n'est publié (un texte généré mais pas encore en ligne n'est pas une MAJ).
      formatTimestamp(publishedAt),
      r.batch_id || '',
      formatTimestamp(r.launched_at),
      r.launched_by_name || '',
      formatTimestamp(r.completed_at),
      reviewer,
      r.article_id || '',
      r.id || '',
    ];
  });
  return [HEADER, ...rows];
};

// Plus récent d'abord : le module SEO regarde d'abord ce qui vient de bouger.
const ITEMS_SQL = `
  SELECT bi.id, bi.batch_id, bi.site, bi.article_url, bi.target_keyword, bi.maj_type,
         bi.status, bi.article_id, bi.completed_at,
         b.launched_at, b.launched_by_name,
         a.url AS article_db_url
    FROM batch_items bi
    JOIN batches b ON b.id = bi.batch_id
    LEFT JOIN articles a ON a.id = bi.article_id
   ORDER BY COALESCE(bi.completed_at, bi.started_at, b.launched_at) DESC`;

const TIME_SQL = `
  SELECT article_id, user_id, user_name, total_active_minutes, published_at
    FROM article_time
   WHERE article_id IN (SELECT DISTINCT article_id FROM batch_items WHERE article_id IS NOT NULL)`;

/**
 * @param {object} deps
 * @param {function} deps.getPool
 * @param {function} [deps.replaceTabValuesFn] (serviceAccount, spreadsheetId, tab, rows) => Promise<{rows}>
 * @param {function} [deps.onLog]
 */
function createMajSheetExport(deps) {
  const {
    getPool,
    replaceTabValuesFn = defaultReplaceTabValues,
    onLog = () => {},
  } = deps;

  // Un export à la fois : le cron (15 min) et le déclenchement manuel peuvent se
  // chevaucher, et deux « clear puis update » entrelacés laisseraient l'onglet
  // dans un état mélangé.
  let running = null;

  const runExport = (serviceAccount, spreadsheetId) => {
    if (running) return running;
    running = (async () => {
      const pool = getPool();
      const [items] = await pool.query(ITEMS_SQL);
      const [timeRows] = await pool.query(TIME_SQL);
      const timeByArticle = new Map();
      timeRows.forEach((t) => {
        if (!timeByArticle.has(t.article_id)) timeByArticle.set(t.article_id, []);
        timeByArticle.get(t.article_id).push(t);
      });
      const rows = buildRows(items, timeByArticle);
      await replaceTabValuesFn(serviceAccount, spreadsheetId, MAJ_TAB, rows);
      onLog(`[maj-sheet-export] ${items.length} ligne(s) exportée(s) vers l'onglet « ${MAJ_TAB} »`);
      return { exported: items.length, tab: MAJ_TAB };
    })().finally(() => { running = null; });
    return running;
  };

  return { runExport };
}

module.exports = {
  createMajSheetExport,
  buildRows,
  reviewerOf,
  domainOf,
  formatTimestamp,
  HEADER,
  MAJ_TAB,
};
