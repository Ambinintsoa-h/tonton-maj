import * as XLSX from 'xlsx';
import { exportStatsToExcel } from './exportStatsXlsx';
import { aggregateByLauncher, aggregateByDayAndUser, groupCostByDay } from './batchDisplay';

// XLSX.writeFile déclenche un téléchargement navigateur (Blob/anchor) que
// jsdom ne supporte pas fidèlement -- mocké pour capturer le classeur produit
// et vérifier son CONTENU (sheet_to_json), pas le mécanisme de téléchargement.
jest.mock('xlsx', () => {
  const actual = jest.requireActual('xlsx');
  return { ...actual, writeFile: jest.fn() };
});

// Horodatages construits en heure LOCALE : le regroupement par jour l'est aussi
// (jamais toISOString), un littéral UTC ferait basculer le test d'un jour selon
// le fuseau de la machine qui l'exécute.
const t = (y, m, d, h = 10) => new Date(y, m - 1, d, h, 0, 0).getTime();

const ITEMS = [
  {
    articleId: 'art-a',
    articleUrl: 'https://site.fr/a', site: 'site.fr', targetKeyword: 'kw a',
    launchedBy: 'uid-andri', launchedByName: 'Andrianina',
    launchedAt: t(2026, 9, 3, 8), startedAt: t(2026, 9, 3, 9), completedAt: t(2026, 9, 3, 9) + 300000,
    costUsd: 0.5821, status: 'fait', publishedAt: t(2026, 9, 3, 12),
  },
  {
    articleId: 'art-b',
    articleUrl: 'https://site.fr/b', site: 'site.fr', targetKeyword: 'kw b',
    launchedBy: 'uid-sahara', launchedByName: 'Sahara',
    launchedAt: t(2026, 9, 4, 8), startedAt: t(2026, 9, 4, 9), completedAt: null,
    costUsd: null, status: 'erreur', publishedAt: null,
  },
];

// relecture_time : par (article, personne, JOUR local), deux compteurs.
const RELECTURES = [
  {
    articleId: 'art-a', userId: 'uid-sahara', userName: 'Sahara RAZAFINDRAKOTO',
    date: '2026-09-03', horsTontonSeconds: 1800, avecTontonSeconds: 2100,
  },
  {
    articleId: 'art-a', userId: 'uid-sahara', userName: 'Sahara RAZAFINDRAKOTO',
    date: '2026-09-04', horsTontonSeconds: 600, avecTontonSeconds: 600,
  },
];

describe('exportStatsToExcel', () => {
  beforeEach(() => { XLSX.writeFile.mockClear(); });

  it('produit une feuille "Détail" avec une ligne par article, timestamps et durées', () => {
    const byLauncher = aggregateByLauncher(ITEMS);
    exportStatsToExcel({ items: ITEMS, byLauncher, relectures: RELECTURES, from: '2026-09-01', to: '2026-09-07' });

    expect(XLSX.writeFile).toHaveBeenCalledTimes(1);
    const [wb, filename] = XLSX.writeFile.mock.calls[0];
    expect(filename).toBe('tonton-suivi-redacteurs_2026-09-01_au_2026-09-07.xlsx');

    const detail = XLSX.utils.sheet_to_json(wb.Sheets['Détail']);
    expect(detail).toHaveLength(2);
    expect(detail[0].Article).toBe('https://site.fr/a');
    expect(detail[0]['Traitement Tonton (s)']).toBe(300);
    expect(detail[0]['Coût ($)']).toBeCloseTo(0.5821, 4);
    // Relecture CUMULÉE sur l'article, tous jours confondus : 1800 + 600 = 2400 s = 40 min
    expect(detail[0]['Relecture humaine (min)']).toBe(40);
    // L'ÉCART, pas un doublon : (2100+600) − (1800+600) = 300 s d'attente IA.
    expect(detail[0]['dont attente IA (s)']).toBe(300);
    expect(detail[0]['Relu par']).toBe('Sahara RAZAFINDRAKOTO');
    // Item en échec, sans complétion ni coût : champs vides, pas "undefined"/NaN.
    expect(detail[1]['Traitement Tonton (s)']).toBe('');
    expect(detail[1]['Coût ($)']).toBe('');
    expect(detail[1]['Relecture humaine (min)']).toBe('');
    expect(detail[1]['dont attente IA (s)']).toBe('');
  });

  // LA feuille demandée le 15/09/2026 : volume, coût, temps machine, temps humain.
  it('produit une feuille "Par jour et par rédacteur" avec les quatre chiffres demandés', () => {
    const byDayUser = aggregateByDayAndUser(ITEMS, RELECTURES);
    exportStatsToExcel({ items: ITEMS, byLauncher: aggregateByLauncher(ITEMS), byDayUser, relectures: RELECTURES });
    const [wb] = XLSX.writeFile.mock.calls[0];
    const rows = XLSX.utils.sheet_to_json(wb.Sheets['Par jour et par rédacteur']);

    const andri = rows.find((r) => r.Jour === '2026-09-03' && r.Rédacteur === 'Andrianina');
    expect(andri['Articles traités']).toBe(1);
    expect(andri['Coût ($)']).toBeCloseTo(0.5821, 4);
    // UNE SEULE colonne de durée machine : « Tonton moyen (s) » a été retiré de
    // cette feuille (demande du 16/09), il ne reste que le total en minutes.
    expect(andri).not.toHaveProperty('Traitement Tonton moyen (s)');
    expect(andri['Traitement Tonton (min)']).toBe(5);
    // Andrianina a LANCÉ, il n'a pas relu : la colonne reste à zéro, elle
    // n'emprunte pas le temps de quelqu'un d'autre.
    expect(andri['Relecture humaine (min)']).toBe(0);

    const sahara3 = rows.find((r) => r.Jour === '2026-09-03' && r.Rédacteur === 'Sahara RAZAFINDRAKOTO');
    expect(sahara3['Articles traités']).toBe(0);   // elle n'a rien lancé ce jour-là
    expect(sahara3['Relecture humaine (min)']).toBe(30);
    expect(sahara3['dont attente IA (s)']).toBe(300);
    // Plus aucune colonne qui répète le même nombre que sa voisine.
    expect(sahara3).not.toHaveProperty('Relecture avec Tonton (min)');
  });

  it('produit une feuille "Par utilisateur" avec les agrégats et le temps de relecture', () => {
    const byDayUser = aggregateByDayAndUser(ITEMS, RELECTURES);
    exportStatsToExcel({ items: ITEMS, byLauncher: aggregateByLauncher(ITEMS), byDayUser, relectures: RELECTURES });
    const [wb] = XLSX.writeFile.mock.calls[0];
    const parUtilisateur = XLSX.utils.sheet_to_json(wb.Sheets['Par utilisateur']);
    expect(parUtilisateur.map((r) => r.Rédacteur).sort()).toEqual(['Andrianina', 'Sahara']);
    const sahara = parUtilisateur.find((r) => r.Rédacteur === 'Sahara');
    expect(sahara.Articles).toBe(1);
    expect(sahara["Taux d'erreur (%)"]).toBe(100);
  });

  it('produit une feuille "Par jour" pour toute l\'équipe', () => {
    exportStatsToExcel({
      items: ITEMS, byLauncher: aggregateByLauncher(ITEMS), byDay: groupCostByDay(ITEMS),
    });
    const [wb] = XLSX.writeFile.mock.calls[0];
    const parJour = XLSX.utils.sheet_to_json(wb.Sheets['Par jour']);
    expect(parJour.map((r) => r.Jour)).toEqual(['2026-09-04', '2026-09-03']);
  });

  // Une feuille absente se lirait « la donnée n'existe pas » ; on garde
  // l'en-tête et on retire les lignes.
  it('garde les quatre feuilles même sans donnée de relecture', () => {
    exportStatsToExcel({ items: ITEMS, byLauncher: aggregateByLauncher(ITEMS) });
    const [wb] = XLSX.writeFile.mock.calls[0];
    expect(wb.SheetNames).toEqual(['Détail', 'Par jour et par rédacteur', 'Par utilisateur', 'Par jour']);
  });

  // « fait » / « erreur » bruts sont illisibles dans un fichier ouvert des
  // semaines plus tard — et « fait » est FAUX par omission : il veut dire
  // « Tonton a fini », pas « publié » (demande Andrianina, 16/09/2026).
  it('écrit des statuts en clair, et distingue « traité » de « publié »', () => {
    const items = [
      { ...ITEMS[0], status: 'fait', publishedAt: t(2026, 9, 3, 12) },
      { ...ITEMS[0], articleId: 'art-c', status: 'fait', publishedAt: null },
      { ...ITEMS[1], status: 'erreur' },
      { ...ITEMS[1], articleId: 'art-d', status: 'en_attente' },
    ];
    exportStatsToExcel({ items, byLauncher: aggregateByLauncher(items) });
    const [wb] = XLSX.writeFile.mock.calls[0];
    const detail = XLSX.utils.sheet_to_json(wb.Sheets['Détail']);
    expect(detail.map((r) => r.Statut)).toEqual([
      'Publié sur WordPress',
      'Traité par Tonton — en attente de relecture',
      'Erreur de traitement',
      'En attente de traitement par Tonton',
    ]);
  });

  it('sans dates fournies, le nom de fichier n\'a pas de suffixe de période', () => {
    exportStatsToExcel({ items: [], byLauncher: [] });
    const [, filename] = XLSX.writeFile.mock.calls[0];
    expect(filename).toBe('tonton-suivi-redacteurs.xlsx');
  });
});
