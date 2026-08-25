/* eslint-env jest */
import { recentAvgForPass, N_RECENTS } from './modelCosts';

const entry = (passId, costUsd) => ({ byPass: { [passId]: { costUsd } } });

describe('recentAvgForPass', () => {
  test('moyenne simple sur des entrées consécutives', () => {
    const history = [entry('gras', 0.02), entry('gras', 0.04)];
    expect(recentAvgForPass(history, 'gras')).toEqual({ avg: 0.03, n: 2 });
  });

  test('ignore les entrées qui ne portent pas cette passe', () => {
    const history = [entry('gras', 0.02), entry('style', 0.10), entry('gras', 0.04)];
    expect(recentAvgForPass(history, 'gras')).toEqual({ avg: 0.03, n: 2 });
  });

  test('aucune entrée pour cette passe → null (jamais 0 ni NaN)', () => {
    expect(recentAvgForPass([entry('style', 0.10)], 'gras')).toBeNull();
    expect(recentAvgForPass([], 'gras')).toBeNull();
    expect(recentAvgForPass(null, 'gras')).toBeNull();
    expect(recentAvgForPass(undefined, 'gras')).toBeNull();
  });

  test('se limite aux N premières entrées (les plus récentes — history est trié du plus récent au plus ancien)', () => {
    const history = [
      entry('gras', 100), // le seul qu'on garde avec n=1
      entry('gras', 0.02),
    ];
    expect(recentAvgForPass(history, 'gras', 1)).toEqual({ avg: 100, n: 1 });
  });

  test("N_RECENTS est bien la valeur par défaut utilisée sans n explicite", () => {
    const history = Array.from({ length: N_RECENTS + 10 }, () => entry('gras', 1));
    // 1 partout → peu importe combien sont pris, la moyenne reste 1, mais le
    // COMPTE doit être plafonné à N_RECENTS, pas N_RECENTS + 10.
    expect(recentAvgForPass(history, 'gras')).toEqual({ avg: 1, n: N_RECENTS });
  });
});
