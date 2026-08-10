// Phase 2 : fusion de la vision du rédacteur et de l'audit.
// Exigence centrale — le prompt ne doit RIEN inventer : ce qui vient de l'audit y
// figure tel quel, et un audit vide se dit au lieu de se combler.
/* eslint-env jest */
import { buildGenerationPrompt, DEFAULT_GENERATION_TEMPLATE } from './generationPrompt';
import { SCOPE_SIMPLE, SCOPE_REFONTE, MIN_WORDS_ADDED_SIMPLE } from '../constants/majPhases';

const AUDIT = {
  executive_summary: 'Article dense mais penalise par des incoherences de pente et des prix en USD.',
  priority_actions: [
    { priority: 'P2', title: 'Reduire la longueur', detail: 'De 3452 a 2500 mots.' },
    { priority: 'P1', title: 'Corriger la pente DTU 43.1', detail: '1 % mini inaccessible, 1,5 % accessible.' },
    { priority: 'P1', title: 'Convertir les prix en EUR', detail: 'Aucun prix en USD dans un article francophone.' },
  ],
  recent_context: {
    donnees_obsoletes: [
      { element: 'Prix du bac acier', valeur_article: '40 EUR/m2', valeur_actuelle: '60 a 180 EUR/m2' },
      { element: 'Bareme MaPrimeRenov', valeur_actuelle: '15 000 EUR en 2026' },
    ],
  },
};

describe('mes directives', () => {
  test('le modèle du rédacteur est reproduit tel quel', () => {
    const p = buildGenerationPrompt({ template: 'Jamais de superlatif.\nToujours une source chiffrée.' });
    expect(p).toContain('## Mes directives');
    expect(p).toContain('Jamais de superlatif.');
    expect(p).toContain('Toujours une source chiffrée.');
  });

  test('modèle vide ou blanc → le modèle par défaut, jamais une section vide', () => {
    ['', '   ', '\n\n', null, undefined].forEach((t) => {
      const p = buildGenerationPrompt({ template: t });
      expect(p).toContain(DEFAULT_GENERATION_TEMPLATE.split('\n')[0]);
    });
  });
});

describe('ampleur — la consigne change vraiment selon le choix de phase 2', () => {
  test('MAJ simple : le minimum de 200 mots est annoncé comme STRICT', () => {
    const p = buildGenerationPrompt({ scope: SCOPE_SIMPLE });
    expect(p).toContain('## Ampleur : MAJ simple');
    expect(p).toContain(`${MIN_WORDS_ADDED_SIMPLE} mots au minimum`);
    expect(p).toMatch(/minimum strict/i);
    expect(p).not.toContain('## Ampleur : refonte');
  });

  test('refonte : réécriture intégrale, et interdiction de perdre l\'existant valable', () => {
    const p = buildGenerationPrompt({ scope: SCOPE_REFONTE });
    expect(p).toContain('## Ampleur : refonte');
    expect(p).toMatch(/intégralement/i);
    expect(p).toMatch(/conserv/i);
    expect(p).not.toContain('mots au minimum');   // aucun seuil sur une refonte
  });
});

describe('mot-clé', () => {
  test('présent, il est cité et la règle « à la lettre près » rappelée', () => {
    const p = buildGenerationPrompt({ targetKeyword: 'toiture bac acier' });
    expect(p).toContain('« toiture bac acier »');
    expect(p).toMatch(/à la lettre près/);
  });

  test('absent, aucune section vide n\'est produite', () => {
    expect(buildGenerationPrompt({ targetKeyword: '' })).not.toContain('## Mot-clé cible');
  });
});

describe('ce que l\'audit demande — reproduit, jamais reformulé', () => {
  test('le résumé exécutif est reporté tel quel', () => {
    const p = buildGenerationPrompt({ audit: AUDIT });
    expect(p).toContain(AUDIT.executive_summary);
  });

  test('les P1 passent avant les P2, quel que soit l\'ordre du JSON', () => {
    const p = buildGenerationPrompt({ audit: AUDIT });
    const iPente = p.indexOf('Corriger la pente DTU 43.1');
    const iPrix  = p.indexOf('Convertir les prix en EUR');
    const iLong  = p.indexOf('Reduire la longueur');
    expect(iPente).toBeGreaterThan(-1);
    expect(iPente).toBeLessThan(iLong);   // P1 avant P2
    expect(iPrix).toBeLessThan(iLong);
  });

  test('deux P1 gardent leur ordre d\'origine (tri stable)', () => {
    const p = buildGenerationPrompt({ audit: AUDIT });
    expect(p.indexOf('Corriger la pente DTU 43.1')).toBeLessThan(p.indexOf('Convertir les prix en EUR'));
  });

  test('titre et détail sont tous deux repris, avec la priorité', () => {
    const p = buildGenerationPrompt({ audit: AUDIT });
    expect(p).toContain('[P1] Corriger la pente DTU 43.1 — 1 % mini inaccessible, 1,5 % accessible.');
  });

  test('un détail identique au titre n\'est pas répété', () => {
    const p = buildGenerationPrompt({ audit: { priority_actions: [{ priority: 'P1', title: 'Ajouter le TL;DR', detail: 'Ajouter le TL;DR' }] } });
    expect(p).toContain('[P1] Ajouter le TL;DR');
    expect(p).not.toContain('Ajouter le TL;DR — Ajouter le TL;DR');
  });

  test('les données obsolètes sont rendues sous forme avant → après', () => {
    const p = buildGenerationPrompt({ audit: AUDIT });
    expect(p).toContain('Prix du bac acier : « 40 EUR/m2 » devient « 60 a 180 EUR/m2 »');
  });

  test('une donnée obsolète sans valeur d\'origine reste lisible', () => {
    const p = buildGenerationPrompt({ audit: AUDIT });
    expect(p).toContain('Bareme MaPrimeRenov : 15 000 EUR en 2026');
  });

  test('plafond de 8 actions — au-delà, on ne gonfle pas le prompt', () => {
    const actions = Array.from({ length: 14 }, (_, i) => ({ priority: 'P1', title: `Action ${i}` }));
    const p = buildGenerationPrompt({ audit: { priority_actions: actions } });
    const n = (p.match(/\[P1\] Action \d+/g) || []).length;
    expect(n).toBe(8);
  });
});

describe('audit vide ou absent — on le DIT, on ne comble pas', () => {
  test('audit null → mention explicite, aucune recommandation fabriquée', () => {
    const p = buildGenerationPrompt({ audit: null });
    expect(p).toMatch(/Aucune recommandation exploitable/);
    expect(p).not.toContain('## Ce que l\'audit demande de corriger');
  });

  test('audit présent mais sans contenu utile → même traitement', () => {
    [{}, { priority_actions: [] }, { priority_actions: null }, { recent_context: {} }].forEach((a) => {
      expect(buildGenerationPrompt({ audit: a })).toMatch(/Aucune recommandation exploitable/);
    });
  });

  test('les actions sans titre ni détail sont ignorées, pas rendues vides', () => {
    const p = buildGenerationPrompt({ audit: { priority_actions: [{ priority: 'P1' }, { priority: 'P1', title: 'Vraie action' }] } });
    expect(p).toContain('Vraie action');
    expect(p).not.toContain('[P1] \n');
  });
});

describe('robustesse', () => {
  test('appel sans aucun argument → un prompt utilisable quand même', () => {
    const p = buildGenerationPrompt();
    expect(p).toContain('## Mes directives');
    expect(p).toContain('## Ampleur : MAJ simple');   // défaut
  });

  test('types inattendus dans l\'audit ne font pas planter', () => {
    expect(() => buildGenerationPrompt({ audit: { priority_actions: 'pas un tableau', recent_context: { donnees_obsoletes: 42 } } })).not.toThrow();
    expect(() => buildGenerationPrompt({ audit: { executive_summary: { a: 1 } } })).not.toThrow();
  });

  test('les retours à la ligne des champs d\'audit sont aplatis (une action = une ligne)', () => {
    const p = buildGenerationPrompt({ audit: { priority_actions: [{ priority: 'P1', title: 'Titre\nsur deux lignes', detail: 'Detail\n\navec trous' }] } });
    expect(p).toContain('[P1] Titre sur deux lignes — Detail avec trous');
  });
});
