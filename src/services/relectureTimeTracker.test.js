/**
 * relectureTimeTracker.test.js — le second chrono, scopé aux phases 3/4
 * uniquement, séparé d'articleTimeTracker.js (qui reste inchangé et n'est pas
 * concerné par ce fichier).
 *
 * Points vérifiés : le heartbeat idle-gaté (comme articleTimeTracker),
 * `markAiCallStart` qui filtre par PHASE COURANTE (au moment de l'appel, pas
 * à l'ouverture du panneau — RewritePanel/SectionRewritePanel/runReview ne
 * sont pas filtrés côté interface), et `markAiCallEnd` qui ne bloque jamais.
 *
 * `_tick()`/`_lastEvent` sont manipulés DIRECTEMENT (préfixe `_`, pas
 * d'enforcement de visibilité en JS) plutôt que de faire avancer un vrai
 * `setInterval` sous fake timers : mélanger minuteurs simulés et chaînes de
 * promesses internes (`_ensureDoc().then(...)`) est notoirement fragile côté
 * timing des microtâches. Appeler directement la méthode interne teste le
 * même comportement de façon déterministe.
 */
jest.mock('./firebase', () => ({
  ensureRelectureTimeDoc: jest.fn(() => Promise.resolve()),
  recordRelectureTime: jest.fn(() => Promise.resolve()),
  recordRelectureAiTime: jest.fn(() => Promise.resolve()),
}));
jest.mock('../store', () => ({ store: { getState: jest.fn() } }));

import relectureTimeTracker from './relectureTimeTracker';
import { ensureRelectureTimeDoc, recordRelectureTime, recordRelectureAiTime } from './firebase';
import { store } from '../store';
import { PHASE_OBSOLESCENCE, PHASE_RELECTURE, PHASE_GENERATION, PHASE_AUDIT } from '../constants/majPhases';

const enPhase = (phase) => store.getState.mockReturnValue({ agent: { phase } });
const flush = async () => { for (let i = 0; i < 5; i += 1) await Promise.resolve(); };

const ARTICLE = { articleId: 'art-1', title: 'Un titre', url: 'https://exemple.fr/a', userId: 'u1', userName: 'Andrianina', userRole: 'super_admin' };

beforeEach(() => {
  // CRA active `resetMocks: true` (createJestConfig.js) : l'implémentation
  // posée par le factory de `jest.mock('./firebase', ...)` est réinitialisée
  // avant CHAQUE test — il faut la reposer ici, sinon ces mocks renvoient
  // `undefined` au lieu d'une promesse dès le premier `.catch()` direct.
  ensureRelectureTimeDoc.mockResolvedValue(undefined);
  recordRelectureTime.mockResolvedValue(undefined);
  recordRelectureAiTime.mockResolvedValue(undefined);
  enPhase(PHASE_RELECTURE);
});

afterEach(() => {
  relectureTimeTracker.leaveWindow();
});

describe('enterWindow / heartbeat', () => {
  it('crée la ligne du jour à l\'entrée dans la fenêtre', async () => {
    relectureTimeTracker.enterWindow(ARTICLE);
    await flush();
    expect(ensureRelectureTimeDoc).toHaveBeenCalledWith('art-1', 'u1', expect.any(String), {
      userName: 'Andrianina', userRole: 'super_admin', title: 'Un titre', url: 'https://exemple.fr/a',
    });
  });

  it('crédite 60 secondes par minute active, sur les DEUX compteurs (record générique)', async () => {
    relectureTimeTracker.enterWindow(ARTICLE);
    await flush();
    relectureTimeTracker._tick();
    await flush();
    expect(recordRelectureTime).toHaveBeenCalledWith('art-1', 'u1', expect.any(String), 60);
  });

  it('ne crédite rien une fois l\'inactivité au-delà de 5 minutes (idle-gate)', async () => {
    relectureTimeTracker.enterWindow(ARTICLE);
    await flush();
    relectureTimeTracker._lastEvent = Date.now() - (6 * 60 * 1000); // > IDLE_MS
    relectureTimeTracker._tick();
    await flush();
    expect(recordRelectureTime).not.toHaveBeenCalled();
  });

  it('reste sous IDLE_MS → toujours crédité', async () => {
    relectureTimeTracker.enterWindow(ARTICLE);
    await flush();
    relectureTimeTracker._lastEvent = Date.now() - (4 * 60 * 1000); // < IDLE_MS (5 min)
    relectureTimeTracker._tick();
    await flush();
    expect(recordRelectureTime).toHaveBeenCalledWith('art-1', 'u1', expect.any(String), 60);
  });

  it('leaveWindow arrête le heartbeat — un tick après coup ne crédite rien', async () => {
    relectureTimeTracker.enterWindow(ARTICLE);
    await flush();
    relectureTimeTracker.leaveWindow();
    relectureTimeTracker._tick();
    await flush();
    expect(recordRelectureTime).not.toHaveBeenCalled();
  });

  it('sans articleId ou userId, ne démarre rien', () => {
    relectureTimeTracker.enterWindow({ ...ARTICLE, articleId: null });
    expect(ensureRelectureTimeDoc).not.toHaveBeenCalled();
    relectureTimeTracker.enterWindow({ ...ARTICLE, userId: null });
    expect(ensureRelectureTimeDoc).not.toHaveBeenCalled();
  });
});

describe('markAiCallStart — filtre par la phase COURANTE, pas par l\'ouverture du panneau', () => {
  it('renvoie un jeton en phase Obsolescence ou Relecture', () => {
    relectureTimeTracker.enterWindow(ARTICLE);
    enPhase(PHASE_OBSOLESCENCE);
    expect(relectureTimeTracker.markAiCallStart()).not.toBeNull();
    enPhase(PHASE_RELECTURE);
    expect(relectureTimeTracker.markAiCallStart()).not.toBeNull();
  });

  it('renvoie null en Audit ou Génération — RewritePanel/SectionRewritePanel/runReview ne sont pas filtrés côté UI', () => {
    relectureTimeTracker.enterWindow(ARTICLE);
    enPhase(PHASE_AUDIT);
    expect(relectureTimeTracker.markAiCallStart()).toBeNull();
    enPhase(PHASE_GENERATION);
    expect(relectureTimeTracker.markAiCallStart()).toBeNull();
  });

  it('renvoie null hors fenêtre (aucun enterWindow actif)', () => {
    relectureTimeTracker.leaveWindow();
    expect(relectureTimeTracker.markAiCallStart()).toBeNull();
  });

  it('ne lève jamais, même si le store est cassé', () => {
    store.getState.mockImplementation(() => { throw new Error('store KO'); });
    relectureTimeTracker.enterWindow(ARTICLE);
    expect(() => relectureTimeTracker.markAiCallStart()).not.toThrow();
    expect(relectureTimeTracker.markAiCallStart()).toBeNull();
  });
});

describe('markAiCallEnd — crédite avec_tonton SEUL, jamais bloquant', () => {
  it('crédite la durée écoulée sur avec_tonton_seconds uniquement', async () => {
    relectureTimeTracker.enterWindow(ARTICLE);
    const token = relectureTimeTracker.markAiCallStart();
    token.startedAt -= 4_200; // appel IA « long » de 4,2 s → arrondi à 4
    relectureTimeTracker.markAiCallEnd(token);
    await flush();
    expect(recordRelectureAiTime).toHaveBeenCalledWith('art-1', 'u1', expect.any(String), 4);
    expect(recordRelectureTime).not.toHaveBeenCalled(); // pas le chemin heartbeat
  });

  it('un jeton null ne fait rien (appel hors phase 3/4)', () => {
    relectureTimeTracker.markAiCallEnd(null);
    expect(recordRelectureAiTime).not.toHaveBeenCalled();
  });

  it('n\'écrit rien pour une durée nulle/négative (horloge qui ne bouge pas)', () => {
    const token = { articleId: 'art-1', userId: 'u1', startedAt: Date.now() };
    relectureTimeTracker.markAiCallEnd(token);
    expect(recordRelectureAiTime).not.toHaveBeenCalled();
  });

  it('le jeton garde son attribution même si l\'utilisateur change d\'article entretemps', async () => {
    relectureTimeTracker.enterWindow(ARTICLE);
    const token = relectureTimeTracker.markAiCallStart();
    // L'utilisateur change d'article PENDANT l'appel IA en vol.
    relectureTimeTracker.enterWindow({ ...ARTICLE, articleId: 'art-2' });
    token.startedAt -= 2_000;
    relectureTimeTracker.markAiCallEnd(token);
    await flush();
    expect(recordRelectureAiTime).toHaveBeenCalledWith('art-1', 'u1', expect.any(String), 2);
  });
});
