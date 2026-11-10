/* eslint-env jest */
/**
 * seoEffect — bilan « Effet des MAJ ».
 *
 * Ces tests verrouillent surtout ce que le module REFUSE de faire : inventer
 * une position quand il n'y en a pas, compter une page plusieurs fois parce
 * qu'elle a été rejouée, et diviser un taux de réussite par un total qui
 * contient des pages jamais mesurées.
 */
import {
  effetSurUnePage, bilanGlobal, regrouperParPage, calculerEffetDesMaj, mediane,
  EFFET_PROGRESSE, EFFET_RECULE, EFFET_STABLE, EFFET_ENTRE_SERP, EFFET_SORT_SERP,
  EFFET_TROP_RECENT, EFFET_SANS_AVANT, EFFET_SANS_HISTORIQUE, EFFET_ERREUR,
  FENETRE_AVANT_JOURS, DELAI_EFFET_JOURS, MESURABLES_MIN,
} from './seoEffect';

const JOUR = 24 * 60 * 60 * 1000;
const ms = (d) => Date.parse(`${d}T12:00:00Z`);
const pt = (date, position) => ({ search_date: date, position });

const MAJ = ms('2026-08-01');
const APRES_TOUT = MAJ + 200 * JOUR; // « maintenant » largement au-delà des fenêtres

describe('effetSurUnePage — comparaison avant / après', () => {
  test('une page montée de #20 à #8 progresse, sur la médiane des deux fenêtres', () => {
    const r = effetSurUnePage({
      url: 'https://exemple.fr/a', keyword: 'kw', firstMajAt: MAJ, lastMajAt: MAJ,
      history: [
        pt('2026-06-15', '21'), pt('2026-07-01', '20'), pt('2026-07-20', '19'),
        pt('2026-08-20', '9'), pt('2026-09-10', '8'), pt('2026-10-01', '7'),
      ],
    }, APRES_TOUT);
    expect(r.avant).toBe(20);
    expect(r.apres).toBe(8);
    expect(r.diff).toBe(12);
    expect(r.statut).toBe(EFFET_PROGRESSE);
    expect(r.pointsAvant).toBe(3);
    expect(r.pointsApres).toBe(3);
  });

  test('une page descendue recule', () => {
    const r = effetSurUnePage({
      url: 'u', keyword: 'kw', firstMajAt: MAJ, lastMajAt: MAJ,
      history: [pt('2026-07-10', '5'), pt('2026-08-20', '18')],
    }, APRES_TOUT);
    expect(r.diff).toBe(-13);
    expect(r.statut).toBe(EFFET_RECULE);
  });

  test('un mouvement d\'une seule position est du bruit, pas un effet', () => {
    const r = effetSurUnePage({
      url: 'u', keyword: 'kw', firstMajAt: MAJ, lastMajAt: MAJ,
      history: [pt('2026-07-10', '12'), pt('2026-08-20', '11')],
    }, APRES_TOUT);
    expect(r.diff).toBe(1);
    expect(r.statut).toBe(EFFET_STABLE);
  });

  test('les points antérieurs à la fenêtre avant sont ignorés — ils décrivent une autre époque', () => {
    const r = effetSurUnePage({
      url: 'u', keyword: 'kw', firstMajAt: MAJ, lastMajAt: MAJ,
      history: [
        // 1 an avant la MAJ : hors fenêtre, ne doit pas tirer la médiane.
        pt('2025-08-01', '90'),
        pt('2026-07-10', '12'),
        pt('2026-08-20', '4'),
      ],
    }, APRES_TOUT);
    expect(r.pointsAvant).toBe(1);
    expect(r.avant).toBe(12);
  });

  test('les points de la semaine suivant la MAJ sont ignorés — ils mesurent le recrawl, pas l\'effet', () => {
    const r = effetSurUnePage({
      url: 'u', keyword: 'kw', firstMajAt: MAJ, lastMajAt: MAJ,
      history: [
        pt('2026-07-10', '12'),
        pt('2026-08-03', '40'), // J+2, dans le délai : écarté
        pt('2026-08-20', '6'),
      ],
    }, APRES_TOUT);
    expect(r.pointsApres).toBe(1);
    expect(r.apres).toBe(6);
    expect(r.statut).toBe(EFFET_PROGRESSE);
  });

  test('pour une page reprise plusieurs fois, l\'après part de la DERNIÈRE MAJ', () => {
    const derniere = MAJ + 60 * JOUR; // 2026-09-30
    const r = effetSurUnePage({
      url: 'u', keyword: 'kw', firstMajAt: MAJ, lastMajAt: derniere,
      history: [
        pt('2026-07-10', '12'),
        pt('2026-09-05', '9'),  // entre les deux MAJ : ni avant ni après
        pt('2026-10-20', '3'),
      ],
    }, APRES_TOUT);
    expect(r.pointsAvant).toBe(1);
    expect(r.pointsApres).toBe(1);
    expect(r.apres).toBe(3);
  });
});

describe('effetSurUnePage — ce qui n\'est PAS une position', () => {
  test('hors SERP avant, classée après → entrée dans la SERP, pas un gain chiffré inventé', () => {
    const r = effetSurUnePage({
      url: 'u', keyword: 'kw', firstMajAt: MAJ, lastMajAt: MAJ,
      history: [pt('2026-07-10', 'NA'), pt('2026-08-20', '14')],
    }, APRES_TOUT);
    expect(r.statut).toBe(EFFET_ENTRE_SERP);
    expect(r.avant).toBeNull();
    expect(r.diff).toBeNull();      // surtout pas 101 - 14
    expect(r.horsSerpAvant).toBe(1);
  });

  test('classée avant, hors SERP après → sortie de SERP', () => {
    const r = effetSurUnePage({
      url: 'u', keyword: 'kw', firstMajAt: MAJ, lastMajAt: MAJ,
      history: [pt('2026-07-10', '14'), pt('2026-08-20', null)],
    }, APRES_TOUT);
    expect(r.statut).toBe(EFFET_SORT_SERP);
    expect(r.diff).toBeNull();
  });

  test('une MAJ de la semaine dernière est « trop récente », pas un échec', () => {
    const recent = APRES_TOUT - 2 * JOUR;
    const r = effetSurUnePage({
      url: 'u', keyword: 'kw', firstMajAt: recent, lastMajAt: recent,
      history: [pt('2026-07-10', '12')],
    }, APRES_TOUT);
    expect(r.statut).toBe(EFFET_TROP_RECENT);
  });

  test('un appel Haloscan raté ne se confond pas avec une page inconnue', () => {
    const erreur = effetSurUnePage({ url: 'u', keyword: 'kw', firstMajAt: MAJ, lastMajAt: MAJ, history: [], error: 'timeout of 30000ms exceeded' }, APRES_TOUT);
    const vide = effetSurUnePage({ url: 'u', keyword: 'kw', firstMajAt: MAJ, lastMajAt: MAJ, history: [] }, APRES_TOUT);
    expect(erreur.statut).toBe(EFFET_ERREUR);
    expect(erreur.erreur).toMatch(/timeout/);
    expect(vide.statut).toBe(EFFET_SANS_HISTORIQUE);
  });

  test('un historique qui commence après la MAJ donne « sans avant », pas une progression', () => {
    const r = effetSurUnePage({
      url: 'u', keyword: 'kw', firstMajAt: MAJ, lastMajAt: MAJ,
      history: [pt('2026-08-20', '6'), pt('2026-09-20', '5')],
    }, APRES_TOUT);
    expect(r.statut).toBe(EFFET_SANS_AVANT);
    expect(r.apres).toBe(5.5);
    expect(r.diff).toBeNull();
  });
});

describe('regrouperParPage — les 29 rejeux de la même page ne font qu\'une ligne', () => {
  const suivis = [
    { articleId: 'a1', title: 'Bac acier', url: 'https://couvreurs.net/bac-acier', keywords: ['toiture bac acier'], createdAt: ms('2026-08-12') },
    { articleId: 'a2', title: 'Bac acier', url: 'https://couvreurs.net/bac-acier', keywords: ['toiture bac acier'], createdAt: ms('2026-08-12') },
    { articleId: 'a3', title: 'Bac acier', url: 'https://couvreurs.net/bac-acier', keywords: ['toiture bac acier'], createdAt: ms('2026-09-20') },
    { articleId: 'b1', title: 'Autre', url: 'https://couvreurs.net/autre', keywords: ['zinc'], createdAt: ms('2026-08-01') },
  ];

  test('une page + un mot-clé = une ligne, bornée par la première et la dernière MAJ', () => {
    const couples = regrouperParPage(suivis, []);
    expect(couples).toHaveLength(2);
    const bac = couples.find((c) => c.keyword === 'toiture bac acier');
    expect(bac.majCount).toBe(3);
    expect(bac.firstMajAt).toBe(ms('2026-08-12'));
    expect(bac.lastMajAt).toBe(ms('2026-09-20'));
  });

  test('deux mots-clés sur la même page font deux lignes — la position est par mot-clé', () => {
    const couples = regrouperParPage(
      [{ url: 'https://x.fr/p', keywords: ['un', 'deux'], createdAt: MAJ }], []);
    expect(couples.map((c) => c.keyword).sort()).toEqual(['deux', 'un']);
  });

  test('un suivi sans URL ou sans date est écarté : il n\'y a rien à mesurer', () => {
    const couples = regrouperParPage([
      { url: '', keywords: ['kw'], createdAt: MAJ },
      { url: 'https://x.fr/p', keywords: ['kw'], createdAt: null },
      { url: 'https://x.fr/p', keywords: ['  '], createdAt: MAJ },
    ], []);
    expect(couples).toHaveLength(0);
  });

  test('l\'historique du cache est rattaché au bon couple', () => {
    const couples = regrouperParPage(suivis, [
      { articleUrl: 'https://couvreurs.net/bac-acier', keyword: 'toiture bac acier', history: [pt('2026-07-01', '30')], fetchedAt: 123 },
    ]);
    const bac = couples.find((c) => c.keyword === 'toiture bac acier');
    const autre = couples.find((c) => c.keyword === 'zinc');
    expect(bac.history).toHaveLength(1);
    expect(bac.fetchedAt).toBe(123);
    expect(autre.history).toBeNull();
  });
});

describe('bilanGlobal — le dénominateur est affiché, pas choisi au mieux', () => {
  const page = (statut, diff = null) => ({ statut, diff });

  test('le taux de progression se calcule sur les pages mesurables, jamais sur le total', () => {
    const b = bilanGlobal([
      page(EFFET_PROGRESSE, 10), page(EFFET_PROGRESSE, 4), page(EFFET_RECULE, -3),
      page(EFFET_STABLE, 0),
      page(EFFET_SANS_HISTORIQUE), page(EFFET_SANS_HISTORIQUE), page(EFFET_TROP_RECENT),
    ]);
    expect(b.total).toBe(7);
    expect(b.mesurables).toBe(4);
    expect(b.tauxProgression).toBe(50); // 2/4, et surtout pas 2/7
    expect(b.gainMedian).toBe(2);       // médiane de [-3, 0, 4, 10]
  });

  test('un échantillon mince n\'est pas « fiable » — l\'interface doit pouvoir le dire', () => {
    const minces = Array.from({ length: MESURABLES_MIN - 1 }, () => page(EFFET_PROGRESSE, 5));
    const suffisant = Array.from({ length: MESURABLES_MIN }, () => page(EFFET_PROGRESSE, 5));
    expect(bilanGlobal(minces).fiable).toBe(false);
    expect(bilanGlobal(suffisant).fiable).toBe(true);
  });

  test('sans aucune page mesurable, le taux est null et non 0 % — « rien mesuré » n\'est pas « tout raté »', () => {
    const b = bilanGlobal([page(EFFET_SANS_HISTORIQUE), page(EFFET_ERREUR)]);
    expect(b.mesurables).toBe(0);
    expect(b.tauxProgression).toBeNull();
    expect(b.gainMedian).toBeNull();
  });

  test('les bascules SERP sont comptées à part, sans polluer le gain médian', () => {
    const b = bilanGlobal([page(EFFET_ENTRE_SERP), page(EFFET_SORT_SERP), page(EFFET_PROGRESSE, 6)]);
    expect(b.entreDansSerp).toBe(1);
    expect(b.sortDuSerp).toBe(1);
    expect(b.gainMedian).toBe(6);
  });
});

describe('repli sur le relevé J+0 quand l\'historique ne remonte pas avant la MAJ', () => {
  test('le relevé sert d\'« avant », et sa provenance est signalée', () => {
    const r = effetSurUnePage({
      url: 'u', keyword: 'kw', firstMajAt: MAJ, lastMajAt: MAJ,
      history: [pt('2026-08-20', '7')],   // rien avant la MAJ
      avantSnapshot: 19,                   // mais le suivi avait relevé #19 le jour même
    }, APRES_TOUT);
    expect(r.avant).toBe(19);
    expect(r.avantSource).toBe('releve_j0');
    expect(r.diff).toBe(12);
    expect(r.statut).toBe(EFFET_PROGRESSE);
  });

  test('l\'historique prime : une médiane vaut mieux qu\'un point unique', () => {
    const r = effetSurUnePage({
      url: 'u', keyword: 'kw', firstMajAt: MAJ, lastMajAt: MAJ,
      history: [pt('2026-07-05', '30'), pt('2026-07-20', '30'), pt('2026-08-20', '7')],
      avantSnapshot: 19,
    }, APRES_TOUT);
    expect(r.avant).toBe(30);
    expect(r.avantSource).toBe('historique');
  });

  test('un relevé sans position ne sert pas de repli — c\'est le défaut qu\'on corrige, pas qu\'on rejoue', () => {
    for (const valeur of [null, 'NA', '', 0, 'bidon']) {
      const r = effetSurUnePage({
        url: 'u', keyword: 'kw', firstMajAt: MAJ, lastMajAt: MAJ,
        history: [pt('2026-08-20', '7')], avantSnapshot: valeur,
      }, APRES_TOUT);
      expect(r.avant).toBeNull();
      expect(r.avantSource).toBeNull();
      expect(r.statut).toBe(EFFET_SANS_AVANT);
    }
  });

  test('le relevé retenu est celui du PREMIER passage, pas d\'un rejeu postérieur', () => {
    const couples = regrouperParPage(
      [
        { articleId: 'tardif',  url: 'https://x.fr/p', keywords: ['kw'], createdAt: ms('2026-09-20') },
        { articleId: 'premier', url: 'https://x.fr/p', keywords: ['kw'], createdAt: ms('2026-08-01') },
      ],
      [],
      [
        { articleId: 'premier', results: [{ keyword: 'kw', position: 40 }] },
        { articleId: 'tardif',  results: [{ keyword: 'kw', position: 6 }] },
      ]);
    // Le relevé du rejeu mesure un article DÉJÀ retravaillé : le présenter comme
    // un « avant » transformerait un gain réel en stagnation.
    expect(couples[0].avantSnapshot).toBe(40);
    expect(couples[0].firstArticleId).toBe('premier');
  });

  test('l\'appariement se fait par mot-clé, pas par position dans le tableau', () => {
    const couples = regrouperParPage(
      [{ articleId: 'a', url: 'https://x.fr/p', keywords: ['second'], createdAt: MAJ }],
      [],
      [{ articleId: 'a', results: [{ keyword: 'premier', position: 3 }, { keyword: 'second', position: 44 }] }]);
    expect(couples[0].avantSnapshot).toBe(44);
  });
});

describe('calculerEffetDesMaj — chaîne complète', () => {
  test('les rejeux fusionnent AVANT le calcul, donc une page ne pèse qu\'une fois dans le bilan', () => {
    const rejeux = Array.from({ length: 29 }, (_, i) => ({
      articleId: `r${i}`, title: 'Bac acier', url: 'https://couvreurs.net/bac-acier',
      keywords: ['toiture bac acier'], createdAt: MAJ,
    }));
    const autre = { articleId: 'z', title: 'Zinc', url: 'https://couvreurs.net/zinc', keywords: ['zinc'], createdAt: MAJ };
    const cache = [
      { articleUrl: 'https://couvreurs.net/bac-acier', keyword: 'toiture bac acier', history: [pt('2026-07-10', '30'), pt('2026-08-20', '4')] },
      { articleUrl: 'https://couvreurs.net/zinc', keyword: 'zinc', history: [pt('2026-07-10', '8'), pt('2026-08-20', '25')] },
    ];
    const { pages, bilan } = calculerEffetDesMaj([...rejeux, autre], cache, [], APRES_TOUT);
    expect(pages).toHaveLength(2);
    expect(bilan.mesurables).toBe(2);
    expect(bilan.tauxProgression).toBe(50); // une montée, une descente
  });
});

describe('mediane', () => {
  test('impair → valeur centrale, pair → moyenne des deux centrales, vide → null', () => {
    expect(mediane([5, 1, 3])).toBe(3);
    expect(mediane([4, 1, 3, 2])).toBe(2.5);
    expect(mediane([])).toBeNull();
  });
});

describe('constantes de réglage', () => {
  test('les fenêtres et le délai restent explicites et exportés', () => {
    expect(FENETRE_AVANT_JOURS).toBe(90);
    expect(DELAI_EFFET_JOURS).toBe(7);
  });
});
