import * as XLSX from 'xlsx';
import { exportStatsToExcel } from './exportStatsXlsx';
import { aggregateByLauncher } from './batchDisplay';

// XLSX.writeFile déclenche un téléchargement navigateur (Blob/anchor) que
// jsdom ne supporte pas fidèlement -- mocké pour capturer le classeur produit
// et vérifier son CONTENU (sheet_to_json), pas le mécanisme de téléchargement.
jest.mock('xlsx', () => {
  const actual = jest.requireActual('xlsx');
  return { ...actual, writeFile: jest.fn() };
});

const ITEMS = [
  {
    articleUrl: 'https://site.fr/a', site: 'site.fr', targetKeyword: 'kw a',
    launchedByName: 'Andrianina', launchedAt: 1000, startedAt: 2000, completedAt: 302000,
    costUsd: 0.5821, status: 'fait', publishedAt: 400000,
  },
  {
    articleUrl: 'https://site.fr/b', site: 'site.fr', targetKeyword: 'kw b',
    launchedByName: 'Sahara', launchedAt: 1000, startedAt: 2000, completedAt: null,
    costUsd: null, status: 'erreur', publishedAt: null,
  },
];

describe('exportStatsToExcel', () => {
  beforeEach(() => { XLSX.writeFile.mockClear(); });

  it('produit une feuille "Détail" avec une ligne par article, timestamps et durée en secondes', () => {
    const byLauncher = aggregateByLauncher(ITEMS);
    exportStatsToExcel({ items: ITEMS, byLauncher, from: '2026-09-01', to: '2026-09-07' });

    expect(XLSX.writeFile).toHaveBeenCalledTimes(1);
    const [wb, filename] = XLSX.writeFile.mock.calls[0];
    expect(filename).toBe('tonton-stats_2026-09-01_au_2026-09-07.xlsx');

    const detail = XLSX.utils.sheet_to_json(wb.Sheets['Détail']);
    expect(detail).toHaveLength(2);
    expect(detail[0].Article).toBe('https://site.fr/a');
    expect(detail[0]['Durée (s)']).toBe(300); // (302000-2000)/1000
    expect(detail[0]['Coût ($)']).toBeCloseTo(0.5821, 4);
    // Item en échec, sans complétion ni coût : champs vides, pas "undefined"/NaN.
    expect(detail[1]['Durée (s)']).toBe('');
    expect(detail[1]['Coût ($)']).toBe('');
  });

  it('produit une feuille "Par utilisateur" avec les agrégats', () => {
    const byLauncher = aggregateByLauncher(ITEMS);
    exportStatsToExcel({ items: ITEMS, byLauncher });
    const [wb] = XLSX.writeFile.mock.calls[0];
    const parUtilisateur = XLSX.utils.sheet_to_json(wb.Sheets['Par utilisateur']);
    expect(parUtilisateur.map((r) => r.Lanceur).sort()).toEqual(['Andrianina', 'Sahara']);
    const sahara = parUtilisateur.find((r) => r.Lanceur === 'Sahara');
    expect(sahara.Articles).toBe(1);
    expect(sahara["Taux d'erreur (%)"]).toBe(100);
  });

  it('sans dates fournies, le nom de fichier n\'a pas de suffixe de période', () => {
    exportStatsToExcel({ items: [], byLauncher: [] });
    const [, filename] = XLSX.writeFile.mock.calls[0];
    expect(filename).toBe('tonton-stats.xlsx');
  });
});
