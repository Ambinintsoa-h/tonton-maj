/* eslint-env jest */
/**
 * Garde-fou « limite de mémoire » — verrous.
 *
 * Deux pannes à rendre impossibles sans qu'un test ne casse :
 *   1. un modèle ajouté (MODEL_CASCADE, MODELS) sans sa date de coupure : il
 *      tournerait avec la limite « au plus prudent », sans que personne le sache ;
 *   2. une nouvelle voie d'appel à Anthropic dans proxy.js qui construirait son
 *      corps de requête sans passer par withKnowledgeGuard.
 */
const fs = require('fs');
const path = require('path');
const {
  MODEL_KNOWLEDGE_CUTOFFS, CUTOFF_PAR_DEFAUT, MARQUEUR,
  normaliserModele, cutoffFor, buildKnowledgeGuard, withKnowledgeGuard,
} = require('./modelKnowledge');

const racine = path.join(__dirname, '..', '..');
const proxySrc = () => fs.readFileSync(path.join(racine, 'proxy.js'), 'utf8');
const agentSrc = () => fs.readFileSync(path.join(racine, 'src', 'services', 'agent.js'), 'utf8');
const AUJOURDHUI = new Date(2026, 9, 3, 10, 0, 0); // 3 octobre 2026, heure locale

describe('table des dates de coupure', () => {
  test('PANNE SILENCIEUSE — chaque modèle de MODEL_CASCADE (proxy.js) a sa date', () => {
    const bloc = proxySrc().match(/const MODEL_CASCADE = \[([\s\S]*?)\];/);
    expect(bloc).not.toBeNull();
    const modeles = [...bloc[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(modeles.length).toBeGreaterThan(0);
    expect(modeles.filter((m) => !MODEL_KNOWLEDGE_CUTOFFS[m])).toEqual([]);
  });

  test('PANNE SILENCIEUSE — chaque modèle du catalogue MODELS (agent.js) a sa date', () => {
    const bloc = agentSrc().match(/const MODELS = \{([\s\S]*?)\};/);
    expect(bloc).not.toBeNull();
    const modeles = [...bloc[1].matchAll(/:\s*'([^']+)'/g)].map((m) => m[1]);
    expect(modeles.length).toBeGreaterThan(0);
    expect(modeles.filter((m) => !MODEL_KNOWLEDGE_CUTOFFS[m])).toEqual([]);
  });

  test('les dates sont au format AAAA-MM, et la date « fiable » ne dépasse jamais celle d\'entraînement', () => {
    for (const [id, c] of Object.entries(MODEL_KNOWLEDGE_CUTOFFS)) {
      expect(`${id}:${c.fiable}`).toMatch(/:\d{4}-(0[1-9]|1[0-2])$/);
      if (c.entrainement) expect(c.fiable <= c.entrainement).toBe(true);
    }
  });

  test('le repli pour un modèle inconnu est la date la PLUS ANCIENNE de la table (prudence)', () => {
    const plusAncienne = Object.values(MODEL_KNOWLEDGE_CUTOFFS).map((c) => c.fiable).sort()[0];
    expect(CUTOFF_PAR_DEFAUT <= plusAncienne).toBe(true);
  });
});

describe('cutoffFor', () => {
  test('un identifiant daté ou « -latest » retrouve son modèle', () => {
    expect(normaliserModele('claude-haiku-4-5-20251001')).toBe('claude-haiku-4-5');
    expect(cutoffFor('claude-haiku-4-5-20251001')).toMatchObject({ fiable: '2025-02', connu: true });
    expect(cutoffFor('Claude-Sonnet-5')).toMatchObject({ model: 'claude-sonnet-5', fiable: '2026-01', connu: true });
    expect(cutoffFor('claude-opus-4-5-latest')).toMatchObject({ fiable: '2025-05', connu: true });
  });

  test('Sonnet 5.5 n\'est pas confondu avec Sonnet 5 (pas de correspondance par préfixe)', () => {
    expect(cutoffFor('claude-sonnet-5-5').fiable).toBe('2026-06');
  });

  test('modèle inconnu, vide ou repli CLI → limite la plus prudente, signalée', () => {
    for (const m of ['modele-mystere', '', null, 'cli-fallback']) {
      expect(cutoffFor(m)).toMatchObject({ fiable: CUTOFF_PAR_DEFAUT, connu: false });
    }
  });
});

describe('buildKnowledgeGuard', () => {
  test('donne la date du jour, la limite du modèle et l\'écart en mois', () => {
    const g = buildKnowledgeGuard('claude-sonnet-5', AUJOURDHUI);
    expect(g.startsWith(MARQUEUR)).toBe(true);
    expect(g).toContain('Date du jour : 3 octobre 2026');
    expect(g).toContain("Ta mémoire fiable s'arrête fin janvier 2026");
    expect(g).toContain('plus de 8 mois');
    expect(g).toContain('BARÈME STRICT');
  });

  test('suit le modèle : Haiku 4.5 s\'arrête plus tôt que Sonnet 5', () => {
    const g = buildKnowledgeGuard('claude-haiku-4-5', AUJOURDHUI);
    expect(g).toContain('fin février 2025');
    expect(g).toContain('plus de 19 mois');
  });

  test('un modèle inconnu est annoncé comme tel', () => {
    expect(buildKnowledgeGuard('modele-mystere', AUJOURDHUI)).toContain('absent de la table');
  });

  test('les 5 règles du barème sont présentes', () => {
    const g = buildKnowledgeGuard('claude-sonnet-5', AUJOURDHUI);
    for (const n of [1, 2, 3, 4, 5]) expect(g).toMatch(new RegExp(`\\n${n}\\. `));
    expect(g).toContain('tu t\'abstiens');
    expect(g).toContain('tu le laisses tel quel');
  });
});

describe('withKnowledgeGuard', () => {
  test('sans system : le garde-fou seul', () => {
    expect(withKnowledgeGuard(undefined, 'claude-sonnet-5', AUJOURDHUI)).toBe(buildKnowledgeGuard('claude-sonnet-5', AUJOURDHUI));
    expect(withKnowledgeGuard('', 'claude-sonnet-5', AUJOURDHUI)).toContain(MARQUEUR);
  });

  test('system chaîne : le prompt d\'origine reste intact, le garde-fou vient à la fin', () => {
    const r = withKnowledgeGuard('Tu rédiges un article.', 'claude-sonnet-5', AUJOURDHUI);
    expect(r.startsWith('Tu rédiges un article.\n\n')).toBe(true);
    expect(r.endsWith(buildKnowledgeGuard('claude-sonnet-5', AUJOURDHUI))).toBe(true);
  });

  test('system en blocs (prompt caching) : blocs d\'origine intacts, cache_control conservé, garde-fou en dernier bloc', () => {
    const b0 = { type: 'text', text: 'Skills…', cache_control: { type: 'ephemeral' } };
    const b1 = { type: 'text', text: 'Article…' };
    const r = withKnowledgeGuard([b0, b1], 'claude-sonnet-5', AUJOURDHUI);
    expect(r).toHaveLength(3);
    expect(r[0]).toBe(b0);
    expect(r[1]).toBe(b1);
    expect(r[2]).toEqual({ type: 'text', text: buildKnowledgeGuard('claude-sonnet-5', AUJOURDHUI) });
  });

  test('idempotent : jamais injecté deux fois', () => {
    const une = withKnowledgeGuard('Prompt', 'claude-sonnet-5', AUJOURDHUI);
    expect(withKnowledgeGuard(une, 'claude-sonnet-5', AUJOURDHUI)).toBe(une);
    const blocs = withKnowledgeGuard([{ type: 'text', text: 'x' }], 'claude-sonnet-5', AUJOURDHUI);
    expect(withKnowledgeGuard(blocs, 'claude-sonnet-5', AUJOURDHUI)).toBe(blocs);
  });

  test('forme inattendue : rendue telle quelle plutôt que de casser l\'appel', () => {
    const bizarre = { foo: 1 };
    expect(withKnowledgeGuard(bizarre, 'claude-sonnet-5', AUJOURDHUI)).toBe(bizarre);
  });
});

describe('VERROU proxy.js — toutes les voies vers Anthropic passent par le garde-fou', () => {
  test('chaque requête POST /v1/messages est construite avec withKnowledgeGuard', () => {
    const src = proxySrc();
    const morceaux = src.split("path: '/v1/messages'");
    expect(morceaux.length - 1).toBe(3); // clé API, OAuth, streaming
    morceaux.slice(0, -1).forEach((avant) => {
      const fonction = avant.slice(-3500);
      expect(fonction).toMatch(/requestBody\.system = [^\n]*withKnowledgeGuard\(/);
    });
  });

  test('aucune affectation brute de system dans un corps de requête', () => {
    const src = proxySrc();
    expect(src).not.toMatch(/requestBody\.system = (?:bodyObj\.)?system;/);
    expect(src).not.toMatch(/if \((?:bodyObj\.)?system\) requestBody\.system =/);
  });

  test('le repli CLI reçoit aussi le garde-fou', () => {
    expect(proxySrc()).toMatch(/withKnowledgeGuard\(system, 'cli-fallback'\)/);
  });

  test('noKnowledgeGuard : réservé au ping, jamais lu depuis le corps d\'une requête client', () => {
    const src = proxySrc();
    expect((src.match(/noKnowledgeGuard: true/g) || []).length).toBe(1);
    expect(src).not.toMatch(/const \{[^}]*noKnowledgeGuard[^}]*\} = req\.body/);
  });
});
