// Le parcours en quatre phases : ordre, navigation et contrôle de longueur.
// Règle de navigation retenue : retour en arrière toujours permis, saut en avant
// interdit — sans quoi les artefacts enregistrés ne correspondent plus entre eux
// (vérifier l'obsolescence d'un texte qui n'a pas encore été généré n'a pas de sens).
/* eslint-env jest */
import {
  PHASE_AUDIT, PHASE_GENERATION, PHASE_OBSOLESCENCE, PHASE_RELECTURE, PHASE_ORDER,
  PHASES, TODO, DONE, RUNNING, ERROR, initialPhaseStatus,
  phaseMeta, phaseIndex, nextPhase, prevPhase, maxReachablePhase, canEnterPhase, derivePhaseStatus,
  SCOPE_SIMPLE, SCOPE_REFONTE, MAJ_SCOPES, MIN_WORDS_ADDED_SIMPLE,
  scopeProposedByAudit, scopeRecommendationSource, wordCount, wordsAddedReport,
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

describe('derivePhaseStatus — rouvrir un article au bon endroit', () => {
  test('un enregistrement au nouveau format est repris tel quel', () => {
    const s = derivePhaseStatus({ phaseStatus: { [PHASE_AUDIT]: DONE, [PHASE_GENERATION]: DONE } });
    expect(s[PHASE_AUDIT]).toBe(DONE);
    expect(s[PHASE_GENERATION]).toBe(DONE);
    expect(s[PHASE_OBSOLESCENCE]).toBe(TODO);   // les clés absentes restent à faire
  });

  // Régression réelle : obsolescence et relecture restaient grisées après un
  // vidage de cache. Le lancement écrit `{ audit: done }` dans l'enregistrement
  // et ne le complète jamais ; ce statut partiel écrasait la preuve au contenu,
  // puis l'autosave recopiait le recul dans le brouillon.
  test('un avancement PARTIEL ne rabaisse pas une phase prouvée par le contenu', () => {
    const s = derivePhaseStatus({
      phaseStatus: { [PHASE_AUDIT]: DONE },        // périmé : écrit au lancement
      auditJson: { scores: {} },
      qatArticle: { wordCount: 2200 },             // la phase 2 a bel et bien tourné
      obsolescenceReport: { suggestions: [{}] },   // et la phase 3 aussi
    });
    expect(s[PHASE_GENERATION]).toBe(DONE);
    expect(s[PHASE_OBSOLESCENCE]).toBe(DONE);
    expect(maxReachablePhase(s)).toBe(PHASE_RELECTURE);
    PHASE_ORDER.forEach(id => expect(canEnterPhase(id, s)).toBe(true));
  });

  test('l\'avancement explicite renseigne ce que le contenu ne prouve pas', () => {
    // La relecture n'a pas d'artefact : seul « Terminer » la marque faite.
    const s = derivePhaseStatus({
      phaseStatus: { [PHASE_RELECTURE]: DONE },
      qatArticle: { wordCount: 900 },
      obsolescenceReport: { suggestions: [] },
    });
    expect(s[PHASE_RELECTURE]).toBe(DONE);
  });

  test('un audit seul laisse la phase 2 à faire — on ne déverrouille rien à tort', () => {
    // Sortie exacte du lancement : audit fait, aucune génération.
    const s = derivePhaseStatus({
      phaseStatus: { [PHASE_AUDIT]: DONE },
      auditJson: { scores: {} }, qatArticle: null, diff: [],
    });
    expect(s[PHASE_AUDIT]).toBe(DONE);
    expect(s[PHASE_GENERATION]).toBe(TODO);
    expect(maxReachablePhase(s)).toBe(PHASE_GENERATION);
    expect(canEnterPhase(PHASE_OBSOLESCENCE, s)).toBe(false);
  });

  // Garde-fou pour « Relancer l'audit » (PhaseAudit) : la remise a zero des
  // phases 2 a 4 ne tient QUE si les artefacts partent avec les statuts. Garder
  // `qatArticle` ferait re-deduire « generation terminee » au rechargement, et
  // annulerait silencieusement la remise a zero.
  test('apres un nouvel audit, la remise à zéro survit au rechargement', () => {
    const apresReAudit = {
      phaseStatus: { [PHASE_AUDIT]: DONE, [PHASE_GENERATION]: TODO, [PHASE_OBSOLESCENCE]: TODO, [PHASE_RELECTURE]: TODO },
      auditJson: { scores: { global: 5 } },
      qatArticle: null, obsolescenceReport: null, diff: [],
    };
    const s = derivePhaseStatus(apresReAudit);
    expect(s[PHASE_AUDIT]).toBe(DONE);
    expect(s[PHASE_GENERATION]).toBe(TODO);
    expect(maxReachablePhase(s)).toBe(PHASE_GENERATION);
    expect(canEnterPhase(PHASE_RELECTURE, s)).toBe(false);
  });

  test('un statut d\'échec ne verrouille pas une génération déjà produite', () => {
    // Un second essai en erreur ne doit pas condamner l'article réécrit du premier.
    const s = derivePhaseStatus({
      phaseStatus: { [PHASE_GENERATION]: ERROR },
      qatArticle: { wordCount: 1500 },
    });
    expect(s[PHASE_GENERATION]).toBe(DONE);
  });

  test('article QAT ancien (audit + article réécrit) → phases 1 et 2 faites', () => {
    const s = derivePhaseStatus({ auditJson: { scores: {} }, qatArticle: { wordCount: 2200 } });
    expect(s[PHASE_AUDIT]).toBe(DONE);
    expect(s[PHASE_GENERATION]).toBe(DONE);
  });

  test('article classique ancien (audit markdown + updates) → phases 1 et 2 faites', () => {
    const s = derivePhaseStatus({ audit: 'RAPPORT...', diff: [{ original: 'a', updated: 'b' }] });
    expect(s[PHASE_AUDIT]).toBe(DONE);
    expect(s[PHASE_GENERATION]).toBe(DONE);
  });

  test('AUDIT SEUL : updatedContent ne doit PAS faire croire à une génération', () => {
    // Depuis la séparation des phases, updatedContent porte l'article d'origine
    // dès la fin de l'audit. Le compter marquerait la phase 2 faite à tort et
    // sauterait l'étape de génération.
    const s = derivePhaseStatus({ auditJson: { scores: {} }, updatedContent: '<p>article d\'origine</p>', diff: [] });
    expect(s[PHASE_AUDIT]).toBe(DONE);
    expect(s[PHASE_GENERATION]).toBe(TODO);
  });

  test('une génération sans audit conservé implique quand même l\'audit', () => {
    const s = derivePhaseStatus({ qatArticle: { wordCount: 1 } });
    expect(s[PHASE_AUDIT]).toBe(DONE);
  });

  test('vérification enregistrée → phase 3 faite', () => {
    const s = derivePhaseStatus({ auditJson: {}, qatArticle: {}, obsolescenceReport: { items: [] } });
    expect(s[PHASE_OBSOLESCENCE]).toBe(DONE);
  });

  test('enregistrement vide ou absent → tout à faire', () => {
    expect(derivePhaseStatus(null)).toEqual(initialPhaseStatus());
    expect(derivePhaseStatus({})).toEqual(initialPhaseStatus());
    expect(derivePhaseStatus(undefined)).toEqual(initialPhaseStatus());
  });
});

describe('scopeProposedByAudit — l\'audit propose, le rédacteur tranche', () => {
  test('une MAJ ciblée est la seule décision qui présélectionne « MAJ simple »', () => {
    expect(scopeProposedByAudit({ ampleur: { decision: 'maj_ciblee' } })).toBe(SCOPE_SIMPLE);
  });

  test('une restructuration relève de la refonte : le plan change', () => {
    expect(scopeProposedByAudit({ ampleur: { decision: 'restructuration' } })).toBe(SCOPE_REFONTE);
  });

  test('une refonte totale présélectionne la refonte', () => {
    expect(scopeProposedByAudit({ ampleur: { decision: 'refonte_totale' } })).toBe(SCOPE_REFONTE);
  });

  test('décision inconnue → refonte, l\'option prudente', () => {
    expect(scopeProposedByAudit({ ampleur: { decision: 'n_importe_quoi' } })).toBe(SCOPE_REFONTE);
  });

  test('sans décision, on se rabat sur le SCORE GLOBAL de l\'audit', () => {
    // Constaté en test réel : l'audit omet parfois `ampleur` alors qu'il est par
    // ailleurs complet. Recommander une refonte en aveugle serait pauvre, alors
    // que le score global, lui, a bien été produit.
    expect(scopeProposedByAudit({ scores: { global: 8.4 } })).toBe(SCOPE_SIMPLE);
    expect(scopeProposedByAudit({ scores: { global: 7 } })).toBe(SCOPE_SIMPLE);   // borne incluse
    expect(scopeProposedByAudit({ scores: { global: 6.2 } })).toBe(SCOPE_REFONTE); // le cas mesuré
    expect(scopeProposedByAudit({ scores: { global: 4.8 } })).toBe(SCOPE_REFONTE);
  });

  test('une décision explicite PRIME sur les scores', () => {
    expect(scopeProposedByAudit({ ampleur: { decision: 'maj_ciblee' }, scores: { global: 2 } })).toBe(SCOPE_SIMPLE);
    expect(scopeProposedByAudit({ ampleur: { decision: 'refonte_totale' }, scores: { global: 9.5 } })).toBe(SCOPE_REFONTE);
  });

  test('scores absents, nuls ou illisibles → refonte, l\'option prudente', () => {
    expect(scopeProposedByAudit({ scores: {} })).toBe(SCOPE_REFONTE);
    expect(scopeProposedByAudit({ scores: { global: 0 } })).toBe(SCOPE_REFONTE);
    expect(scopeProposedByAudit({ scores: { global: 'six' } })).toBe(SCOPE_REFONTE);
    expect(scopeProposedByAudit({})).toBe(SCOPE_REFONTE);
    expect(scopeProposedByAudit(null)).toBe(SCOPE_REFONTE);
    expect(scopeProposedByAudit(undefined)).toBe(SCOPE_REFONTE);
  });

  test('la SOURCE de la recommandation est explicite — ne jamais faire passer une déduction pour une décision', () => {
    expect(scopeRecommendationSource({ ampleur: { decision: 'maj_ciblee' } })).toBe('ampleur');
    expect(scopeRecommendationSource({ scores: { global: 6.2 } })).toBe('scores');
    expect(scopeRecommendationSource({})).toBe('defaut');
    expect(scopeRecommendationSource(null)).toBe('defaut');
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
