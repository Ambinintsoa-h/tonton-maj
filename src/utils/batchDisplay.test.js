import { fmtDuration, fmtCost, deriveDisplayStatus, groupCostByDay, aggregateByLauncher } from './batchDisplay';

describe('fmtDuration', () => {
  it('formate en minutes + secondes au-delà de 60s', () => {
    expect(fmtDuration(421000)).toBe('7 min 1s');
  });
  it('formate en secondes seules sous la minute', () => {
    expect(fmtDuration(45000)).toBe('45s');
  });
  it('renvoie un tiret si absent/négatif', () => {
    expect(fmtDuration(null)).toBe('—');
    expect(fmtDuration(-1)).toBe('—');
  });
});

describe('fmtCost', () => {
  it('affiche 4 décimales sous 1 centime, 2 sinon', () => {
    expect(fmtCost(0.0034)).toBe('$0.0034');
    expect(fmtCost(0.55)).toBe('$0.55');
  });
  it('renvoie un tiret si absent', () => {
    expect(fmtCost(null)).toBe('—');
  });
});

describe('deriveDisplayStatus', () => {
  it('"en_attente"/"en_cours" -> à traiter', () => {
    expect(deriveDisplayStatus({ status: 'en_attente' })).toBe('a_traiter');
    expect(deriveDisplayStatus({ status: 'en_cours' })).toBe('a_traiter');
  });
  it('"fait" sans publication -> à relire', () => {
    expect(deriveDisplayStatus({ status: 'fait', publishedAt: null })).toBe('a_relire');
  });
  it('"fait" avec publication -> publié', () => {
    expect(deriveDisplayStatus({ status: 'fait', publishedAt: 1735689600000 })).toBe('publie');
  });
  it('"erreur"/"a_revoir" -> erreur', () => {
    expect(deriveDisplayStatus({ status: 'erreur' })).toBe('erreur');
    expect(deriveDisplayStatus({ status: 'a_revoir' })).toBe('erreur');
  });
});

describe('groupCostByDay', () => {
  it('regroupe par jour local et cumule coût/nombre', () => {
    const items = [
      { completedAt: new Date('2026-08-30T09:00:00').getTime(), costUsd: 0.5 },
      { completedAt: new Date('2026-08-30T18:00:00').getTime(), costUsd: 0.3 },
      { completedAt: new Date('2026-08-31T10:00:00').getTime(), costUsd: 0.6 },
    ];
    const grouped = groupCostByDay(items);
    expect(grouped).toEqual([
      { day: '2026-08-31', count: 1, costUsd: 0.6 },
      { day: '2026-08-30', count: 2, costUsd: 0.8 },
    ]);
  });

  it('ignore les items sans horodatage, ne plante jamais', () => {
    expect(groupCostByDay([{ costUsd: 1 }])).toEqual([]);
  });

  it('retombe sur startedAt si completedAt est absent', () => {
    const ts = new Date('2026-08-30T09:00:00').getTime();
    expect(groupCostByDay([{ startedAt: ts, costUsd: 0.2 }])).toEqual([{ day: '2026-08-30', count: 1, costUsd: 0.2 }]);
  });
});

describe('aggregateByLauncher', () => {
  it('compte, calcule le taux d\'erreur et les moyennes par lanceur', () => {
    const items = [
      { launchedByName: 'Andrianina', status: 'fait', startedAt: 1000, completedAt: 101000, costUsd: 0.4 },
      { launchedByName: 'Andrianina', status: 'erreur', startedAt: 1000, completedAt: 201000, costUsd: 0.6 },
      { launchedByName: 'Sahara', status: 'fait', startedAt: 1000, completedAt: 301000, costUsd: 1 },
    ];
    const result = aggregateByLauncher(items);
    expect(result).toEqual([
      { launcher: 'Andrianina', count: 2, errorRate: 0.5, avgDurationMs: 150000, avgCostUsd: 0.5, totalCostUsd: 1 },
      { launcher: 'Sahara', count: 1, errorRate: 0, avgDurationMs: 300000, avgCostUsd: 1, totalCostUsd: 1 },
    ]);
  });

  it('trié par nombre d\'articles décroissant', () => {
    const items = [
      { launchedByName: 'A', status: 'fait' },
      { launchedByName: 'B', status: 'fait' },
      { launchedByName: 'B', status: 'fait' },
    ];
    expect(aggregateByLauncher(items).map((r) => r.launcher)).toEqual(['B', 'A']);
  });

  it('un item sans durée/coût connu n\'écrase pas la moyenne des autres (null, pas 0)', () => {
    const items = [
      { launchedByName: 'A', status: 'erreur' }, // pas de startedAt/completedAt/costUsd
    ];
    expect(aggregateByLauncher(items)).toEqual([
      { launcher: 'A', count: 1, errorRate: 1, avgDurationMs: null, avgCostUsd: null, totalCostUsd: 0 },
    ]);
  });

  it('launchedByName absent -> replie sur launchedBy, puis "Inconnu"', () => {
    expect(aggregateByLauncher([{ launchedBy: 'uid-1', status: 'fait' }])[0].launcher).toBe('uid-1');
    expect(aggregateByLauncher([{ status: 'fait' }])[0].launcher).toBe('Inconnu');
  });

  it('liste vide -> []', () => {
    expect(aggregateByLauncher([])).toEqual([]);
  });
});

// ── SUIVI DES RÉDACTEURS (15/09/2026) ────────────────────────────────────────
describe('aggregateByDayAndUser', () => {
  const { aggregateByDayAndUser, filterRelectureByPeriod, fmtMinutes } = require('./batchDisplay');
  // Heure LOCALE : le regroupement par jour l'est aussi (jamais toISOString),
  // un littéral UTC ferait basculer le test d'un jour selon le fuseau.
  const t = (y, m, d, h) => new Date(y, m - 1, d, h, 0, 0).getTime();

  const ITEMS = [
    { launchedBy: 'u1', launchedByName: 'Andrianina', startedAt: t(2026, 9, 3, 9), completedAt: t(2026, 9, 3, 9) + 120000, costUsd: 0.4 },
    { launchedBy: 'u1', launchedByName: 'Andrianina', startedAt: t(2026, 9, 3, 14), completedAt: t(2026, 9, 3, 14) + 240000, costUsd: 0.6 },
    { launchedBy: 'u2', launchedByName: 'Sahara', startedAt: t(2026, 9, 4, 9), completedAt: t(2026, 9, 4, 9) + 60000, costUsd: 0.1 },
  ];
  const RELECTURES = [
    { articleId: 'a', userId: 'u2', userName: 'Sahara', date: '2026-09-03', horsTontonSeconds: 1200, avecTontonSeconds: 1500 },
    { articleId: 'b', userId: 'u2', userName: 'Sahara', date: '2026-09-03', horsTontonSeconds: 600, avecTontonSeconds: 600 },
  ];

  it('agrège volume, coût et temps machine par jour et par personne', () => {
    const rows = aggregateByDayAndUser(ITEMS, []);
    const andri = rows.find((r) => r.day === '2026-09-03' && r.userId === 'u1');
    expect(andri.articles).toBe(2);
    expect(andri.costUsd).toBeCloseTo(1.0, 6);
    expect(andri.tontonMs).toBe(360000);
    expect(andri.tontonCount).toBe(2);
  });

  it('additionne le temps de relecture du MÊME jour, tous articles confondus', () => {
    const rows = aggregateByDayAndUser([], RELECTURES);
    expect(rows).toHaveLength(1);
    expect(rows[0].relectureSeconds).toBe(1800);
    expect(rows[0].relectureAvecTontonSeconds).toBe(2100);
  });

  // Le point à ne pas maquiller : le lanceur n'est pas toujours le relecteur.
  // Une personne qui n'a QUE relu doit apparaître, avec 0 article.
  it('crée une ligne pour qui a relu sans rien lancer, et inversement', () => {
    const rows = aggregateByDayAndUser(ITEMS, RELECTURES);
    const sahara3 = rows.find((r) => r.day === '2026-09-03' && r.userId === 'u2');
    expect(sahara3.articles).toBe(0);
    expect(sahara3.relectureSeconds).toBe(1800);
    const andri3 = rows.find((r) => r.day === '2026-09-03' && r.userId === 'u1');
    expect(andri3.relectureSeconds).toBe(0);
  });

  // Le rapprochement se fait sur l'UID : « Sahara » et « sahara_razafindrakoto »
  // sont la même personne et deux chaînes différentes.
  it('rapproche sur l\'identifiant, pas sur le nom affiché', () => {
    const rows = aggregateByDayAndUser(
      [{ launchedBy: 'u2', launchedByName: 'sahara_razafindrakoto', startedAt: t(2026, 9, 3, 8), completedAt: t(2026, 9, 3, 8) + 1000, costUsd: 0.2 }],
      RELECTURES,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].articles).toBe(1);
    expect(rows[0].relectureSeconds).toBe(1800);
  });

  it('trie du jour le plus récent au plus ancien', () => {
    const rows = aggregateByDayAndUser(ITEMS, RELECTURES);
    expect(rows[0].day).toBe('2026-09-04');
  });

  it('ne plante pas sans donnée', () => {
    expect(aggregateByDayAndUser()).toEqual([]);
    expect(aggregateByDayAndUser([], [])).toEqual([]);
  });

  // La route /relecture-time renvoie TOUTE la table : sans ce bornage, l'export
  // contiendrait des jours hors de la période affichée à l'écran.
  it('filterRelectureByPeriod borne aux jours inclus', () => {
    const list = [
      { date: '2026-09-02' }, { date: '2026-09-03' }, { date: '2026-09-04' }, { date: '2026-09-05' }, {},
    ];
    expect(filterRelectureByPeriod(list, '2026-09-03', '2026-09-04').map((r) => r.date))
      .toEqual(['2026-09-03', '2026-09-04']);
  });

  it('fmtMinutes bascule en heures au-delà de 60 minutes', () => {
    // 0 est une MESURE (« personne n'a relu »), pas une absence de mesure :
    // « 0 min » et « — » ne disent pas la même chose, seul `null` vaut « — ».
    expect(fmtMinutes(0)).toBe('0 min');
    expect(fmtMinutes(null)).toBe('—');
    expect(fmtMinutes(1800)).toBe('30 min');
    expect(fmtMinutes(3600)).toBe('1 h 00');
    expect(fmtMinutes(5400)).toBe('1 h 30');
  });
});
