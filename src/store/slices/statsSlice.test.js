/* eslint-env jest */
/**
 * totalByPass — cumul équipe par passe du registre IA (MODEL_PASSES, agent.js).
 *
 * Alimenté par `byPass` (issu de `aggregateCallsByPass`) sur chaque
 * `addArticleStat`. Le point délicat : une mise à jour d'une entrée EXISTANTE
 * (relancer une passe sur le même article) doit RETIRER l'ancien détail avant
 * d'ajouter le nouveau, sinon le cumul double le coût à chaque relance.
 */
import reducer, { addArticleStat, resetStats, setStats } from './statsSlice';

const BASE = {
  totalArticles: 0,
  totalInputTokens: 0,
  totalOutputTokens: 0,
  totalCostUsd: 0,
  history: [],
  totalByPass: {},
};

describe('addArticleStat — cumul par passe', () => {
  test('une nouvelle entrée avec byPass alimente totalByPass', () => {
    const state = reducer(BASE, addArticleStat({
      id: 'a1', title: 'Article 1', inputTokens: 1000, outputTokens: 500, costUsd: 0.01,
      createdAt: '2026-08-24', pass: 1,
      byPass: { audit_qat: { model: 'claude-sonnet-5', input: 1000, output: 500, costUsd: 0.01 } },
    }));
    expect(state.totalByPass.audit_qat).toEqual({ model: 'claude-sonnet-5', input: 1000, output: 500, costUsd: 0.01 });
  });

  test('deux articles différents s\'additionnent dans la même passe', () => {
    let state = reducer(BASE, addArticleStat({
      id: 'a1', title: 'A1', inputTokens: 100, outputTokens: 50, costUsd: 0.001, createdAt: 't1', pass: 1,
      byPass: { gras: { model: 'claude-sonnet-5', input: 100, output: 50, costUsd: 0.001 } },
    }));
    state = reducer(state, addArticleStat({
      id: 'a2', title: 'A2', inputTokens: 200, outputTokens: 80, costUsd: 0.002, createdAt: 't2', pass: 1,
      byPass: { gras: { model: 'claude-sonnet-5', input: 200, output: 80, costUsd: 0.002 } },
    }));
    expect(state.totalByPass.gras.input).toBe(300);
    expect(state.totalByPass.gras.output).toBe(130);
    expect(state.totalByPass.gras.costUsd).toBeCloseTo(0.003, 6);
  });

  test('sans byPass (article traité avant ce dispositif), totalByPass ne bouge pas', () => {
    const state = reducer(BASE, addArticleStat({
      id: 'a1', title: 'A1', inputTokens: 100, outputTokens: 50, costUsd: 0.001, createdAt: 't1', pass: 1,
    }));
    expect(state.totalByPass).toEqual({});
  });

  test('RELANCER une passe sur le MÊME article (id + pass identiques) remplace son détail au lieu de le doubler', () => {
    let state = reducer(BASE, addArticleStat({
      id: 'a1', title: 'A1', inputTokens: 1000, outputTokens: 500, costUsd: 0.01, createdAt: 't1', pass: 2,
      byPass: { refonte: { model: 'claude-sonnet-5', input: 1000, output: 500, costUsd: 0.01 } },
    }));
    // Même id + même pass (2) → chemin de MISE À JOUR (existingIdx !== -1), pas une nouvelle entrée.
    state = reducer(state, addArticleStat({
      id: 'a1', title: 'A1', inputTokens: 300, outputTokens: 150, costUsd: 0.003, createdAt: 't2', pass: 2,
      byPass: { refonte: { model: 'claude-sonnet-5', input: 300, output: 150, costUsd: 0.003 } },
    }));
    expect(state.totalByPass.refonte).toEqual({ model: 'claude-sonnet-5', input: 300, output: 150, costUsd: 0.003 });
    expect(state.history).toHaveLength(1);
  });

  test('une passe qui disparaît d\'une relance (0 appel cette fois) retombe à zéro, pas en négatif ni fantôme', () => {
    let state = reducer(BASE, addArticleStat({
      id: 'a1', title: 'A1', inputTokens: 100, outputTokens: 50, costUsd: 0.001, createdAt: 't1', pass: 1,
      byPass: { seo_meta: { model: 'claude-haiku-4-5', input: 100, output: 50, costUsd: 0.001 } },
    }));
    state = reducer(state, addArticleStat({
      id: 'a1', title: 'A1', inputTokens: 0, outputTokens: 0, costUsd: 0, createdAt: 't2', pass: 1,
      byPass: {},
    }));
    expect(state.totalByPass.seo_meta).toEqual({ model: 'claude-haiku-4-5', input: 0, output: 0, costUsd: 0 });
  });

  test('deux passes distinctes du même article restent séparées', () => {
    const state = reducer(BASE, addArticleStat({
      id: 'a1', title: 'A1', inputTokens: 300, outputTokens: 150, costUsd: 0.01, createdAt: 't1', pass: 2,
      byPass: {
        refonte: { model: 'claude-sonnet-5', input: 200, output: 100, costUsd: 0.007 },
        gras:    { model: 'claude-sonnet-5', input: 100, output: 50,  costUsd: 0.003 },
      },
    }));
    expect(Object.keys(state.totalByPass).sort()).toEqual(['gras', 'refonte']);
  });
});

describe('resetStats — remet totalByPass à zéro avec le reste', () => {
  test('resetStats vide totalByPass', () => {
    const withData = reducer(BASE, addArticleStat({
      id: 'a1', title: 'A1', inputTokens: 100, outputTokens: 50, costUsd: 0.001, createdAt: 't1', pass: 1,
      byPass: { style: { model: 'claude-sonnet-5', input: 100, output: 50, costUsd: 0.001 } },
    }));
    const state = reducer(withData, resetStats());
    expect(state.totalByPass).toEqual({});
  });
});

describe('UN ARTICLE, QUATRE PHASES — pass:1..4 s\'additionnent sans collision', () => {
  // Trouvé en testant en réel (25/08/2026) : seule la génération (pass:2)
  // alimentait les stats équipe — Obsolescence et Style tournaient (et
  // coûtaient) sans jamais remonter au Dashboard ni au panneau de coût par
  // passe. Correctif : chaque phase dispatche sous SON PROPRE numéro de passe
  // (1=audit, 2=génération, 3=obsolescence, 4=style), chacune avec SES PROPRES
  // calls dans byPass — jamais les calls fusionnés d'une autre phase, sinon
  // audit_qat/query_extraction seraient comptés deux fois (pass:1 ET pass:2).
  test('les 4 dispatches du MÊME article s\'additionnent, un seul comptage d\'article', () => {
    let state = BASE;
    state = reducer(state, addArticleStat({
      id: 'a1', title: 'A1', inputTokens: 1000, outputTokens: 500, costUsd: 0.01, createdAt: 't1', pass: 1,
      byPass: { audit_qat: { model: 'claude-haiku-4-5', input: 900, output: 400, costUsd: 0.0029 }, query_extraction: { model: 'claude-haiku-4-5', input: 100, output: 100, costUsd: 0.0006 } },
    }));
    state = reducer(state, addArticleStat({
      id: 'a1', title: 'A1', inputTokens: 2000, outputTokens: 1000, costUsd: 0.007, createdAt: 't2', pass: 2,
      byPass: { refonte: { model: 'claude-haiku-4-5', input: 1500, output: 800, costUsd: 0.0055 }, gras: { model: 'claude-haiku-4-5', input: 500, output: 200, costUsd: 0.0015 } },
    }));
    state = reducer(state, addArticleStat({
      id: 'a1', title: 'A1', inputTokens: 800, outputTokens: 300, costUsd: 0.0023, createdAt: 't3', pass: 3,
      byPass: { obsolescence: { model: 'claude-haiku-4-5', input: 800, output: 300, costUsd: 0.0023 } },
    }));
    state = reducer(state, addArticleStat({
      id: 'a1', title: 'A1', inputTokens: 100, outputTokens: 50, costUsd: 0.0004, createdAt: 't4', pass: 4,
      byPass: { style: { model: 'claude-haiku-4-5', input: 100, output: 50, costUsd: 0.0004 } },
    }));

    // Un seul article compté, malgré 4 dispatches.
    expect(state.totalArticles).toBe(1);
    // 4 lignes distinctes dans l'historique (une par phase).
    expect(state.history).toHaveLength(4);
    // Totaux : somme des 4 contributions, aucune perte, aucun doublon.
    expect(state.totalInputTokens).toBe(1000 + 2000 + 800 + 100);
    expect(state.totalOutputTokens).toBe(500 + 1000 + 300 + 50);
    expect(state.totalCostUsd).toBeCloseTo(0.01 + 0.007 + 0.0023 + 0.0004, 6);
    // Chaque passe du registre apparaît UNE SEULE FOIS, avec ses propres chiffres —
    // c'est exactement le double-comptage (audit_qat/query_extraction via pass:1
    // ET pass:2) que ce test verrouille contre une régression future.
    expect(Object.keys(state.totalByPass).sort()).toEqual(
      ['audit_qat', 'gras', 'obsolescence', 'query_extraction', 'refonte', 'style'].sort()
    );
    expect(state.totalByPass.audit_qat.input).toBe(900);
    expect(state.totalByPass.query_extraction.input).toBe(100);
    expect(state.totalByPass.refonte.input).toBe(1500);
    expect(state.totalByPass.gras.input).toBe(500);
    expect(state.totalByPass.obsolescence.input).toBe(800);
    expect(state.totalByPass.style.input).toBe(100);
  });
});

describe('setStats — restauration depuis le serveur (GET /api/data/stats)', () => {
  test('une base migrée après coup (totalByPass absent du document) ne casse rien — le champ reste vide', () => {
    // Simule getStats() sur une ligne écrite avant migration/alter-stats-by-pass.sql :
    // { totalArticles, totalInputTokens, ... } SANS clé totalByPass du tout.
    const legacyServerDoc = {
      totalArticles: 5, totalInputTokens: 1000, totalOutputTokens: 500, totalCostUsd: 0.05, history: [],
    };
    const state = reducer(BASE, setStats(legacyServerDoc));
    expect(state.totalByPass).toEqual({});
    expect(state.totalArticles).toBe(5);
  });
});
