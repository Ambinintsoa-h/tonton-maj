// Le parcours en quatre phases : ordre, navigation et contrôle de longueur.
// Règle de navigation retenue : retour en arrière toujours permis, saut en avant
// interdit — sans quoi les artefacts enregistrés ne correspondent plus entre eux
// (vérifier l'obsolescence d'un texte qui n'a pas encore été généré n'a pas de sens).
/* eslint-env jest */
import {
  PHASE_AUDIT, PHASE_GENERATION, PHASE_OBSOLESCENCE, PHASE_RELECTURE, PHASE_ORDER,
  PHASES, TODO, DONE, RUNNING, initialPhaseStatus,
  phaseMeta, phaseIndex, nextPhase, prevPhase, maxReachablePhase, canEnterPhase,
  SCOPE_SIMPLE, SCOPE_REFONTE, MAJ_SCOPES, MIN_WORDS_ADDED_SIMPLE,
  wordCount, wordsAddedReport,
} from './majPhases';

describe('ordre et métadonnées des phases', () => {
  test('quatre phases, numérotées 1 à 4 dans l\'ordre du parcours', () => {
    expect(PHASE_ORDER).toEqual([PHASE_AUDIT, PHASE_GENERATION, PHASE_OBSOLESCENCE, PHASE_RELECTURE]);
    expect(PHASE_ORDER.map(id => PHASES[id].num)).toEqual([1, 2, 3, 4]);
  });

  test('chaque phase porte un libellé, une description et une action', () => {
    PHASE_ORDER.forEach((id) => {
      const m = PHASES[id];
      expect(m.label).toBeTruthy();
      expect(m.description).toBeTruthy();
      expect(m.action).toBeTruthy();
    });
  });

  test('phaseMeta retombe sur l\'audit pour un identifiant inconnu (jamais undefined)', () => {
    expect(phaseMeta('n_importe_quoi')).toBe(PHASES[PHASE_AUDIT]);
    expect(phaseMeta(undefined).label).toBe('Audit');
  });

  test('enchaînement avant / arrière, bornes incluses', () => {
    expect(nextPhase(PHASE_AUDIT)).toBe(PHASE_GENERATION);
    expect(nextPhase(PHASE_RELECTURE)).toBeNull();
    expect(prevPhase(PHASE_AUDIT)).toBeNull();
    expect(prevPhase(PHASE_OBSOLESCENCE)).toBe(PHASE_GENERATION);
    expect(phaseIndex(PHASE_RELECTURE)).toBe(3);
  });

  test('état initial : les quatre phases sont à faire', () => {
    expect(initialPhaseStatus()).toEqual({
      [PHASE_AUDIT]: TODO, [PHASE_GENERATION]: TODO,
      [PHASE_OBSOLESCENCE]: TODO, [PHASE_RELECTURE]: TODO,
    });
  });
});

describe('navigation — retour libre, pas de saut en avant', () => {
  test('au départ, seul l\'audit est ouvert', () => {
    const s = initialPhaseStatus();
    expect(maxReachablePhase(s)).toBe(PHASE_AUDIT);
    expect(canEnterPhase(PHASE_AUDIT, s)).toBe(true);
    expect(canEnterPhase(PHASE_GENERATION, s)).toBe(false);
    expect(canEnterPhase(PHASE_RELECTURE, s)).toBe(false);
  });

  test('audit terminé → la génération s\'ouvre, et on peut revenir à l\'audit', () => {
    const s = { ...initialPhaseStatus(), [PHASE_AUDIT]: DONE };
    expect(maxReachablePhase(s)).toBe(PHASE_GENERATION);
    expect(canEnterPhase(PHASE_AUDIT, s)).toBe(true);        // retour en arrière
    expect(canEnterPhase(PHASE_GENERATION, s)).toBe(true);
    expect(canEnterPhase(PHASE_OBSOLESCENCE, s)).toBe(false);
  });

  test('une phase EN COURS n\'ouvre pas la suivante', () => {
    const s = { ...initialPhaseStatus(), [PHASE_AUDIT]: RUNNING };
    expect(maxReachablePhase(s)).toBe(PHASE_AUDIT);
    expect(canEnterPhase(PHASE_GENERATION, s)).toBe(false);
  });

  test('un statut « done » isolé plus loin ne permet pas de sauter le trou', () => {
    // Cas incohérent (données héritées d'un ancien enregistrement) : l'obsolescence
    // est marquée faite alors que la génération ne l'est pas. On s'arrête au trou.
    const s = { [PHASE_AUDIT]: DONE, [PHASE_GENERATION]: TODO, [PHASE_OBSOLESCENCE]: DONE, [PHASE_RELECTURE]: TODO };
    expect(maxReachablePhase(s)).toBe(PHASE_GENERATION);
    expect(canEnterPhase(PHASE_OBSOLESCENCE, s)).toBe(false);
  });

  test('tout terminé → la relecture reste la phase courante, tout est accessible', () => {
    const s = PHASE_ORDER.reduce((a, id) => ({ ...a, [id]: DONE }), {});
    expect(maxReachablePhase(s)).toBe(PHASE_RELECTURE);
    PHASE_ORDER.forEach(id => expect(canEnterPhase(id, s)).toBe(true));
  });

  test('statuts absents ou identifiant inconnu → aucun crash, rien ne s\'ouvre à tort', () => {
    expect(maxReachablePhase()).toBe(PHASE_AUDIT);
    expect(maxReachablePhase({})).toBe(PHASE_AUDIT);
    expect(canEnterPhase('inconnue', { [PHASE_AUDIT]: DONE })).toBe(false);
  });
});

describe('ampleur décidée en phase 2', () => {
  test('deux ampleurs, chacune décrite pour le rédacteur', () => {
    expect(Object.keys(MAJ_SCOPES)).toEqual([SCOPE_SIMPLE, SCOPE_REFONTE]);
    expect(MAJ_SCOPES[SCOPE_SIMPLE].label).toBe('MAJ simple');
    expect(MAJ_SCOPES[SCOPE_REFONTE].label).toBe('Refonte');
    Object.values(MAJ_SCOPES).forEach(s => expect(s.description).toBeTruthy());
  });
});

describe('wordCount', () => {
  test('compte les mots à travers le balisage HTML', () => {
    expect(wordCount('<h2>Quel est le coût ?</h2><p>Comptez 60 EUR.</p>')).toBe(8);
  });

  test('les entités HTML ne sont pas comptées comme des mots', () => {
    expect(wordCount('<p>a&nbsp;b&amp;c</p>')).toBe(3);
  });

  test('balises collées sans espace : les mots ne fusionnent pas', () => {
    // <p>un</p><p>deux</p> doit valoir 2 mots, pas 1 (« undeux »)
    expect(wordCount('<p>un</p><p>deux</p>')).toBe(2);
  });

  test('entrées vides', () => {
    expect(wordCount('')).toBe(0);
    expect(wordCount()).toBe(0);
    expect(wordCount('   ')).toBe(0);
    expect(wordCount('<p></p>')).toBe(0);
  });
});

describe('les 200 mots — minimum STRICT, calculé et affiché', () => {
  const avant = '<p>' + Array(300).fill('mot').join(' ') + '</p>';

  test('MAJ simple conforme : le décompte réel est rendu au rédacteur', () => {
    const apres = '<p>' + Array(520).fill('mot').join(' ') + '</p>';
    expect(wordsAddedReport(avant, apres, SCOPE_SIMPLE)).toEqual({
      before: 300, after: 520, added: 220,
      minimum: MIN_WORDS_ADDED_SIMPLE, conforme: true, manque: 0,
    });
  });

  test('MAJ simple sous le minimum → NON CONFORME, avec le reste à ajouter', () => {
    const apres = '<p>' + Array(340).fill('mot').join(' ') + '</p>';
    const r = wordsAddedReport(avant, apres, SCOPE_SIMPLE);
    expect(r.added).toBe(40);
    expect(r.conforme).toBe(false);
    expect(r.manque).toBe(160);        // 200 - 40 → chiffre affiché, pas une formule vague
  });

  test('exactement 200 mots ajoutés → conforme (borne incluse)', () => {
    const apres = '<p>' + Array(500).fill('mot').join(' ') + '</p>';
    const r = wordsAddedReport(avant, apres, SCOPE_SIMPLE);
    expect(r.conforme).toBe(true);
    expect(r.manque).toBe(0);
  });

  test('MAJ simple qui RACCOURCIT l\'article → non conforme, manque calculé sur l\'écart réel', () => {
    const apres = '<p>' + Array(250).fill('mot').join(' ') + '</p>';
    const r = wordsAddedReport(avant, apres, SCOPE_SIMPLE);
    expect(r.added).toBe(-50);
    expect(r.conforme).toBe(false);
    expect(r.manque).toBe(250);        // il faut 200 de plus que l'original, pas 200 de plus qu'ici
  });

  test('une refonte n\'est pas soumise au minimum : elle peut raccourcir l\'article', () => {
    const apres = '<p>' + Array(230).fill('mot').join(' ') + '</p>';
    const r = wordsAddedReport(avant, apres, SCOPE_REFONTE);
    expect(r.added).toBe(-70);
    expect(r.minimum).toBeNull();      // aucun minimum applicable, et non « minimum = 0 »
    expect(r.conforme).toBe(true);
    expect(r.manque).toBe(0);
  });
});
