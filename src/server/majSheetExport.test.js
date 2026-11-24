const {
  createMajSheetExport, buildRows, reviewerOf, domainOf, formatTimestamp, HEADER, MAJ_TAB,
} = require('./majSheetExport');

// 2026-11-24T13:05:00Z = 14:05:00 à Paris (UTC+1 en novembre).
const T_DONE = Date.UTC(2026, 10, 24, 13, 5, 0);
const T_LAUNCH = Date.UTC(2026, 10, 24, 12, 0, 0);
const T_PUBLISHED = Date.UTC(2026, 10, 24, 15, 30, 0);

const item = (over = {}) => ({
  id: 'it1',
  batch_id: 'b1',
  site: 'evenement',
  article_url: 'https://www.evenement.com/billetterie',
  article_db_url: null,
  target_keyword: 'billetterie en ligne',
  maj_type: 'ciblee',
  status: 'fait',
  article_id: 'art1',
  completed_at: T_DONE,
  launched_at: T_LAUNCH,
  launched_by_name: 'Sahara',
  ...over,
});
const timeMap = (rows) => new Map(Object.entries(rows));

describe('HEADER', () => {
  it('liste les colonnes exportées, dans l\'ordre', () => {
    expect(HEADER).toEqual([
      'Site', 'URL', 'Mot-clé cible', 'Type de MAJ', 'Statut', 'Date de mise à jour', 'Lot',
      'Lot lancé le', 'Lot lancé par', 'Fin de traitement', 'Relecteur', 'ID article', 'ID item',
    ]);
  });
});

describe('formatTimestamp / domainOf', () => {
  it('formate en heure de Paris, triable alphabétiquement', () => {
    expect(formatTimestamp(T_DONE)).toBe('2026-11-24 14:05:00');
  });
  it('rend vide pour absent, nul ou invalide', () => {
    expect(formatTimestamp(null)).toBe('');
    expect(formatTimestamp(undefined)).toBe('');
    expect(formatTimestamp(0)).toBe('');
    expect(formatTimestamp('abc')).toBe('');
  });
  it('extrait le domaine sans www, tolère un href sans schéma', () => {
    expect(domainOf('https://www.evenement.com/a/b?x=1')).toBe('evenement.com');
    expect(domainOf('blog.exemple.fr/page')).toBe('blog.exemple.fr');
    expect(domainOf('')).toBe('');
    expect(domainOf(null)).toBe('');
  });
});

describe('reviewerOf', () => {
  it('rien d\'enregistré -> relecteur vide, pas de date', () => {
    expect(reviewerOf([])).toEqual({ name: '', publishedAt: null });
    expect(reviewerOf(undefined)).toEqual({ name: '', publishedAt: null });
  });
  it('prend celui qui a publié (le plus récent) et sa date', () => {
    const r = reviewerOf([
      { user_name: 'Ancien', published_at: 100, total_active_minutes: 90 },
      { user_name: 'Récent', published_at: 200, total_active_minutes: 5 },
      { user_name: 'Lecteur', published_at: null, total_active_minutes: 300 },
    ]);
    expect(r).toEqual({ name: 'Récent', publishedAt: 200 });
  });
  it('sans publication : celui qui a passé le plus de temps', () => {
    const r = reviewerOf([
      { user_name: 'A', total_active_minutes: 4 },
      { user_name: 'B', total_active_minutes: 12 },
    ]);
    expect(r).toEqual({ name: 'B', publishedAt: null });
  });
  it('retombe sur user_id quand le nom manque', () => {
    expect(reviewerOf([{ user_id: 'u9', total_active_minutes: 1 }]).name).toBe('u9');
  });
});

describe('buildRows', () => {
  it('ligne 1 = en-tête, puis une ligne par article de lot', () => {
    const rows = buildRows([item(), item({ id: 'it2' })], new Map());
    expect(rows[0]).toBe(HEADER);
    expect(rows).toHaveLength(3);
  });

  it('article publié : statut Publié, date de mise à jour = mise en ligne, relecteur', () => {
    const [, row] = buildRows([item()], timeMap({
      art1: [{ article_id: 'art1', user_id: 'u1', user_name: 'Sahara', published_at: T_PUBLISHED, total_active_minutes: 20 }],
    }));
    expect(row).toEqual([
      'evenement.com',
      'https://www.evenement.com/billetterie',
      'billetterie en ligne',
      'MAJ ciblée',
      'Publié',
      '2026-11-24 16:30:00',
      'b1',
      '2026-11-24 13:00:00',
      'Sahara',
      '2026-11-24 14:05:00',
      'Sahara',
      'art1',
      'it1',
    ]);
  });

  it('article traité mais pas publié : statut Traité, pas de date de mise à jour', () => {
    const [, row] = buildRows([item()], new Map());
    expect(row[4]).toBe('Traité');
    expect(row[5]).toBe('');
    expect(row[10]).toBe('');
  });

  it('statuts non terminés et libellés de type', () => {
    const rows = buildRows([
      item({ id: 'a', status: 'en_attente', completed_at: null, maj_type: 'maj', article_id: null }),
      item({ id: 'b', status: 'en_cours', maj_type: 'refonte' }),
      item({ id: 'c', status: 'erreur' }),
      item({ id: 'd', status: 'a_revoir' }),
    ], new Map());
    expect(rows.slice(1).map((r) => [r[4], r[3]])).toEqual([
      ['En attente', 'MAJ'], ['En cours', 'Refonte'], ['Erreur', 'MAJ ciblée'], ['À revoir', 'MAJ ciblée'],
    ]);
    expect(rows[1][9]).toBe('');   // pas de fin de traitement
    expect(rows[1][11]).toBe('');  // pas d'article
  });

  it('repli : domaine depuis site, URL depuis articles.url quand l\'item n\'en a pas', () => {
    const [, a] = buildRows([item({ article_url: null, article_db_url: 'https://blog.exemple.fr/p' })], new Map());
    expect(a[0]).toBe('blog.exemple.fr');
    expect(a[1]).toBe('https://blog.exemple.fr/p');
    const [, b] = buildRows([item({ article_url: null, article_db_url: null, site: 'monsite.com' })], new Map());
    expect(b[0]).toBe('monsite.com');
    expect(b[1]).toBe('');
  });

  it('aucune valeur null/undefined : chaque cellule est une chaîne', () => {
    const [, row] = buildRows([item({
      site: null, article_url: null, target_keyword: null, maj_type: null, status: null,
      article_id: null, completed_at: null, launched_at: null, launched_by_name: null,
    })], new Map());
    expect(row).toHaveLength(HEADER.length);
    row.forEach((c) => expect(typeof c).toBe('string'));
  });

  it('aucun lot -> l\'en-tête seul', () => {
    expect(buildRows([], new Map())).toEqual([HEADER]);
  });
});

describe('createMajSheetExport', () => {
  const makeDeps = ({ items = [item()], timeRows = [] } = {}) => {
    const query = jest.fn()
      .mockResolvedValueOnce([items])
      .mockResolvedValueOnce([timeRows]);
    const replaceTabValuesFn = jest.fn().mockResolvedValue({ rows: 0 });
    const ensureTabFn = jest.fn().mockResolvedValue({ created: false });
    const onLog = jest.fn();
    return { deps: { getPool: () => ({ query }), replaceTabValuesFn, ensureTabFn, onLog }, query, replaceTabValuesFn, ensureTabFn, onLog };
  };

  it('écrit l\'en-tête + les lignes dans l\'onglet « MAJ », et nulle part ailleurs', async () => {
    const { deps, replaceTabValuesFn } = makeDeps({
      timeRows: [{ article_id: 'art1', user_id: 'u1', user_name: 'Sahara', published_at: T_PUBLISHED, total_active_minutes: 3 }],
    });
    const sa = { client_email: 'x', private_key: 'y' };
    const result = await createMajSheetExport(deps).runExport(sa, 'SHEET_ID');
    expect(replaceTabValuesFn).toHaveBeenCalledTimes(1);
    const [gotSa, gotId, tab, rows] = replaceTabValuesFn.mock.calls[0];
    expect(gotSa).toBe(sa);
    expect(gotId).toBe('SHEET_ID');
    expect(tab).toBe('MAJ');
    expect(tab).toBe(MAJ_TAB);
    expect(rows[0]).toBe(HEADER);
    expect(rows[1][4]).toBe('Publié');
    expect(result).toEqual({ exported: 1, tab: 'MAJ' });
  });

  it("vérifie l'onglet « Commande MAJ » avec son en-tête, sans jamais y écrire de lignes", async () => {
    const { deps, replaceTabValuesFn, ensureTabFn } = makeDeps();
    await createMajSheetExport(deps).runExport({}, 'S');
    expect(ensureTabFn).toHaveBeenCalledWith({}, 'S', 'Commande MAJ', ['N°', 'URL', 'Mot-clé cible', 'Type de MAJ', 'Consigne', 'Attribué à']);
    // la seule écriture de lignes vise « MAJ »
    expect(replaceTabValuesFn.mock.calls.map((c) => c[2])).toEqual(['MAJ']);
  });

  it("un échec de vérification de l'onglet « Commande MAJ » ne fait pas échouer l'export", async () => {
    const { deps, ensureTabFn, onLog } = makeDeps();
    ensureTabFn.mockRejectedValueOnce(new Error('boom'));
    await expect(createMajSheetExport(deps).runExport({}, 'S')).resolves.toEqual({ exported: 1, tab: 'MAJ' });
    expect(onLog).toHaveBeenCalledWith(expect.stringContaining('non vérifié'));
  });

  it('ne fait que lire en base (SELECT uniquement)', async () => {
    const { deps, query } = makeDeps();
    await createMajSheetExport(deps).runExport({}, 'S');
    query.mock.calls.forEach(([sql]) => expect(sql.trim()).toMatch(/^SELECT/i));
  });

  it('deux exports simultanés partagent le même : un seul « clear puis update »', async () => {
    const { deps, replaceTabValuesFn } = makeDeps();
    const exp = createMajSheetExport(deps);
    await Promise.all([exp.runExport({}, 'S'), exp.runExport({}, 'S')]);
    expect(replaceTabValuesFn).toHaveBeenCalledTimes(1);
  });

  it('un échec d\'écriture remonte, et un nouvel export reste possible ensuite', async () => {
    const { deps, replaceTabValuesFn, query } = makeDeps();
    replaceTabValuesFn.mockRejectedValueOnce(new Error('403'));
    const exp = createMajSheetExport(deps);
    await expect(exp.runExport({}, 'S')).rejects.toThrow('403');
    query.mockResolvedValueOnce([[item()]]).mockResolvedValueOnce([[]]);
    await expect(exp.runExport({}, 'S')).resolves.toEqual({ exported: 1, tab: 'MAJ' });
  });
});
