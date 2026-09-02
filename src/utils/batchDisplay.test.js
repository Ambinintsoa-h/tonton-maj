import { fmtDuration, fmtCost, deriveDisplayStatus, groupCostByDay } from './batchDisplay';

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
