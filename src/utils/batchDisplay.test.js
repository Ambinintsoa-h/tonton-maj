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
