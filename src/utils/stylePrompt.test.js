// Phase 4, moitié IA de l'option C. Exigence : un contrat étroit et un
// rattachement par NUMÉRO, jamais par correspondance de texte approximative.
/* eslint-env jest */
import {
  flattenAiOccurrences, buildStyleFixPrompt, normalizeStyleProposals,
} from './stylePrompt';

const FINDINGS = [
  { id: 'verbes', exemples: [
    { terme: "s'impose", extrait: "La toiture bac acier s'impose comme une solution durable." },
    { terme: 'offrent',  extrait: 'Les finitions laquées offrent une palette de coloris.' },
  ] },
  // Mécanique : ne doit PAS partir à l'IA
  { id: 'adverbes', exemples: [{ terme: 'fortement', extrait: 'Le prix varie fortement selon la région.' }] },
  { id: 'passive', exemples: [{ extrait: 'La page est indexée par Google en quelques heures.' }] },
];

describe('flattenAiOccurrences — seules les règles qui demandent du sens', () => {
  test('les occurrences IA sont numérotées en continu', () => {
    const o = flattenAiOccurrences(FINDINGS);
    expect(o.map(x => x.n)).toEqual([1, 2, 3]);
    expect(o.map(x => x.id)).toEqual(['verbes', 'verbes', 'passive']);
  });

  test('les règles MÉCANIQUES sont exclues — elles sont déjà traitées gratuitement', () => {
    const o = flattenAiOccurrences(FINDINGS);
    expect(o.some(x => x.id === 'adverbes')).toBe(false);
    expect(o.some(x => /fortement/.test(x.extrait))).toBe(false);
  });

  test('les extraits vides sont ignorés', () => {
    const o = flattenAiOccurrences([{ id: 'verbes', exemples: [{ extrait: '' }, { extrait: '   ' }, { extrait: 'Vrai.' }] }]);
    expect(o).toHaveLength(1);
  });

  test('entrées dégénérées', () => {
    expect(flattenAiOccurrences()).toEqual([]);
    expect(flattenAiOccurrences(null)).toEqual([]);
    expect(flattenAiOccurrences([{ id: 'verbes' }])).toEqual([]);
    expect(flattenAiOccurrences('pas un tableau')).toEqual([]);
  });
});

describe('buildStyleFixPrompt', () => {
  test('les occurrences sont numérotées et regroupées par règle', () => {
    const p = buildStyleFixPrompt(flattenAiOccurrences(FINDINGS));
    expect(p).toContain("1. [s'impose] La toiture bac acier s'impose");
    expect(p).toContain('2. [offrent] Les finitions laquées offrent');
    expect(p).toContain('3. La page est indexée par Google');
  });

  test('chaque règle porte sa consigne, pas seulement son interdit', () => {
    const p = buildStyleFixPrompt(flattenAiOccurrences(FINDINGS));
    expect(p).toMatch(/verbe précis et concret/);
    expect(p).toMatch(/Mets le sujet en action/);
  });

  test('les garde-fous du contenu sont explicites', () => {
    const p = buildStyleFixPrompt(flattenAiOccurrences(FINDINGS));
    expect(p).toMatch(/UNIQUEMENT la phrase fournie/);
    expect(p).toMatch(/aucun chiffre, aucune date/);
    expect(p).toMatch(/ni ne supprime aucun lien/);   // le verrou liens vaut aussi ici
  });

  test('aucune occurrence → prompt vide, donc aucun appel à faire', () => {
    expect(buildStyleFixPrompt([])).toBe('');
    expect(buildStyleFixPrompt()).toBe('');
  });
});

describe('normalizeStyleProposals — rattachement par numéro', () => {
  const occ = flattenAiOccurrences(FINDINGS);

  test('les propositions valides sont rattachées à leur occurrence', () => {
    const r = normalizeStyleProposals([
      { n: 1, apres: 'La toiture bac acier domine les projets contemporains.' },
      { n: 3, apres: 'Google indexe la page en quelques heures.' },
    ], occ);
    expect(r).toHaveLength(2);
    expect(r[0]).toEqual({ n: 1, id: 'verbes', avant: occ[0].extrait, apres: 'La toiture bac acier domine les projets contemporains.' });
    expect(r[1].id).toBe('passive');
  });

  test('un numéro inconnu est écarté', () => {
    expect(normalizeStyleProposals([{ n: 99, apres: 'Hors sujet.' }], occ)).toEqual([]);
  });

  test('une proposition IDENTIQUE à l\'original est écartée — rien à accepter', () => {
    expect(normalizeStyleProposals([{ n: 1, apres: occ[0].extrait }], occ)).toEqual([]);
  });

  test('une proposition vide est écartée', () => {
    expect(normalizeStyleProposals([{ n: 1, apres: '' }, { n: 2, apres: '   ' }], occ)).toEqual([]);
  });

  test('un modèle qui réécrit tout le paragraphe est écarté', () => {
    // La consigne dit « uniquement la phrase » ; une reponse demesurement longue
    // signale qu'il a deborde, et l'accepter remplacerait une phrase par un pave.
    const pave = 'x '.repeat(400);
    expect(normalizeStyleProposals([{ n: 1, apres: pave }], occ)).toEqual([]);
  });

  test('doublons sur le même numéro : la dernière gagne, pas de duplication', () => {
    const r = normalizeStyleProposals([
      { n: 1, apres: 'Première version.' },
      { n: 1, apres: 'Seconde version.' },
    ], occ);
    expect(r).toHaveLength(1);
    expect(r[0].apres).toBe('Seconde version.');
  });

  test('accepte aussi la forme { propositions: [...] }', () => {
    const r = normalizeStyleProposals({ propositions: [{ n: 2, apres: 'Les finitions laquées proposent des coloris.' }] }, occ);
    expect(r).toHaveLength(1);
    expect(r[0].n).toBe(2);
  });

  test('numéro en chaîne de caractères toléré', () => {
    expect(normalizeStyleProposals([{ n: '1', apres: 'La toiture domine.' }], occ)).toHaveLength(1);
  });

  // VERROU LIENS (règle 8). Le prompt l'interdit déjà, mais une consigne n'est
  // pas un verrou : la proposition part directement dans innerHTML sans passer
  // par enforceExternalLinkPolicy. Reproduit sur le vrai code : une proposition
  // porteuse d'une ancre s'insérait telle quelle dans l'article publié.
  test('une proposition porteuse de BALISAGE est écartée', () => {
    expect(normalizeStyleProposals([
      { n: 1, apres: 'La toiture domine, voir <a href="https://source-x.com">cette étude</a>.' },
    ], occ)).toEqual([]);
    expect(normalizeStyleProposals([{ n: 1, apres: 'Toiture <strong>bac acier</strong> partout.' }], occ)).toEqual([]);
  });

  test('une proposition qui AJOUTE une URL est écartée, même sans balise', () => {
    expect(normalizeStyleProposals([
      { n: 1, apres: 'La toiture domine, source : https://concurrent.com/etude' },
    ], occ)).toEqual([]);
    expect(normalizeStyleProposals([{ n: 1, apres: 'La toiture domine, voir www.concurrent.com' }], occ)).toEqual([]);
  });

  test('une URL DÉJÀ présente dans l\'original reste autorisée — sinon on écarterait une correction légitime', () => {
    const source = [{
      id: 'verbes',
      exemples: [{ extrait: 'Le site https://ademe.fr/guide est une ressource qui est utile.', terme: 'est' }],
    }];
    const o = flattenAiOccurrences(source);
    const r = normalizeStyleProposals([
      // Pas « reste » : ce verbe est dans VERBES_INTERDITS, et depuis le 18 août
      // 2026 une proposition qui réintroduit un pattern proscrit est écartée. Ce
      // test-ci porte sur les URL — sa formulation ne doit pas déclencher l'autre
      // verrou, sinon il ne mesure plus ce qu'il annonce.
      { n: 1, apres: 'Le site https://ademe.fr/guide rassemble des ressources utiles.' },
    ], o);
    expect(r).toHaveLength(1);
    expect(r[0].apres).toContain('ademe.fr/guide');
  });

  test('entrées dégénérées → aucun crash, tableau vide', () => {
    expect(normalizeStyleProposals(null, occ)).toEqual([]);
    expect(normalizeStyleProposals('pas du json', occ)).toEqual([]);
    expect(normalizeStyleProposals([null, undefined, 42], occ)).toEqual([]);
    expect(normalizeStyleProposals([{ n: 1, apres: 'x' }], null)).toEqual([]);
  });
});
