// Tests d'intégration de l'étape A (audit) du mode « Audit QAT + Refonte ».
//
// Pourquoi ce fichier existe : le 2026-08-17, en production, un article a consommé
// 0,55 $ (3 essais Sonnet 5 : 17 450, 11 790 puis 12 096 tokens de sortie) sans
// produire un seul audit exploitable — le JSON était tronqué par un `max_tokens`
// calibré pour Sonnet 4.5, dont le tokenizer compte ~30 % de tokens en moins pour
// le même texte. Rien ne verrouillait ni l'enveloppe de sortie, ni le contrat
// « audit illisible → audit null » sur lequel repose le garde-fou de la file
// d'attente (MajEnAttente.jsx). C'est l'objet des tests ci-dessous.
/* eslint-env jest */
import { ReadableStream as NodeReadableStream } from 'stream/web';
import { TextEncoder as NodeTextEncoder, TextDecoder as NodeTextDecoder } from 'util';

if (typeof global.ReadableStream === 'undefined') global.ReadableStream = NodeReadableStream;
if (typeof global.TextEncoder === 'undefined') global.TextEncoder = NodeTextEncoder;
if (typeof global.TextDecoder === 'undefined') global.TextDecoder = NodeTextDecoder;

// Streaming simulé indisponible : le pipeline se rabat sur callClaudeWithProgress,
// qui porte les réponses de test. Même montage que runQatRewrite.test.js.
// ⚠️ react-scripts active `resetMocks: true` — les implémentations sont reposées
// dans le beforeEach, sinon les mocks renvoient undefined.
jest.mock('./agent', () => {
  const actual = jest.requireActual('./agent');
  return {
    ...actual,
    callClaudeStream: jest.fn(),
    callClaudeWithProgress: jest.fn(),
    callClaude: jest.fn(),
    scrapeSource: jest.fn(),
    callWpTool: jest.fn(),
    // PR2 (chantier "fiabilité des liens injectés") : fait un VRAI appel
    // réseau (axios) en dehors de ce mock. Repli par défaut = "aucun
    // sitemap disponible", même valeur que le cas réel d'un site sans
    // sitemap : aucun comportement existant n'est modifié par ce mock.
    fetchSiteUrls: jest.fn(),
  };
});
jest.mock('./search', () => ({ searchWeb: jest.fn() }));

// eslint-disable-next-line import/first
import { runQatAudit } from './agentQat';
// eslint-disable-next-line import/first
import { callClaudeWithProgress, callClaudeStream, callClaude, fetchSiteUrls } from './agent';
// eslint-disable-next-line import/first
import { searchWeb } from './search';

const SKILLS = [{
  name: 'tonton', format: 'skillmd', active: true,
  body: '# Méthode\nAudit QAT puis refonte.',
  resources: [{ name: 'audit.md', content: 'Schéma JSON de l\'audit.' }],
}];

const ARTICLE_URL = 'https://isolation-phonique.com/mon-article';
const ARTICLE_HTML = '<h1>Isolation phonique du plafond</h1><p>Comptez 40 €/m² en 2024.</p>';

const AUDIT_OK = {
  ampleur: { decision: 'refonte_totale', justification: 'chiffres de 2024' },
  scores: { global: 4 },
  executive_summary: 'Article à refondre.',
  priority_actions: [],
};

const usage = { model: 'claude-sonnet-5', input_tokens: 10, output_tokens: 20 };
const reply = (obj) => ({ text: JSON.stringify(obj), usage });

const baseArgs = () => ({
  content: ARTICLE_HTML,
  contentHtml: ARTICLE_HTML,
  skills: SKILLS,
  articleUrl: ARTICLE_URL,
  targetKeyword: 'isolation phonique plafond',
});

beforeEach(() => {
  callClaudeStream.mockRejectedValue(new Error('STREAM_UNAVAILABLE'));
  // Extraction des requêtes de fraîcheur (Haiku) — hors sujet ici.
  callClaude.mockResolvedValue({ text: '[]', usage: {} });
  searchWeb.mockResolvedValue([]);
  fetchSiteUrls.mockResolvedValue([]);
});

describe('runQatAudit — enveloppe de sortie', () => {
  test('demande 32 000 tokens de sortie, pas les 20 000 calibrés pour Sonnet 4.5', async () => {
    callClaudeWithProgress.mockResolvedValueOnce(reply(AUDIT_OK));
    await runQatAudit(baseArgs());
    // Signature : callClaudeWithProgress(apiKey, params, …) — les params sont le 2e.
    const params = callClaudeWithProgress.mock.calls[0][1];
    expect(params.max_tokens).toBe(32000);
    // Le raisonnement adaptatif de Sonnet 5 partagerait ce plafond avec le texte
    // produit : il doit rester explicitement coupé (étape 1 de la bascule).
    expect(params.thinking).toEqual({ type: 'disabled' });
  });

  test('borne les liens internes suggérés à 10, avec un plancher de 6', async () => {
    callClaudeWithProgress.mockResolvedValueOnce(reply(AUDIT_OK));
    await runQatAudit(baseArgs());
    const prompt = callClaudeWithProgress.mock.calls[0][1].messages[0].content;
    // Plancher porté de 3 à 6 le 2026-08-17 (décision Andrianina). Le skill dit la
    // même chose ; ce test verrouille la version code, qu'une édition de skill ne
    // peut pas contredire.
    expect(prompt).toMatch(/\*\*au moins 6\*\*/);
    expect(prompt).toMatch(/au maximum 10/);
    // Le plafond doit primer sur ce que dirait le skill : sans cette phrase, une
    // édition de skill (« pas de limite ») reprenait le dessus et le JSON
    // retombait tronqué.
    expect(prompt).toMatch(/prime sur toute autre limite/);
  });
});

describe('runQatAudit — audit illisible', () => {
  test('3 réponses non-JSON → audit null et parseFailed, JAMAIS un audit vide silencieux', async () => {
    // Le contrat sur lequel repose le garde-fou de MajEnAttente : sans `audit`,
    // la phase 1 NE DOIT PAS être marquée terminée.
    const brut = { text: 'Voici mon analyse en prose, sans JSON.', usage };
    callClaudeWithProgress.mockResolvedValue(brut);
    const res = await runQatAudit(baseArgs());
    expect(res.audit).toBeNull();
    expect(res.parseFailed).toBe(true);
    expect(res.apiError).toBeNull();          // l'API a répondu : ce n'est pas une panne
    expect(callClaudeWithProgress).toHaveBeenCalledTimes(3);
  });

  test('la reprise instruite du 2e essai demande explicitement du JSON seul', async () => {
    callClaudeWithProgress
      .mockResolvedValueOnce({ text: 'pas du JSON', usage })
      .mockResolvedValueOnce(reply(AUDIT_OK));
    const res = await runQatAudit(baseArgs());
    expect(res.audit).toMatchObject({ scores: { global: 4 } });
    const relance = callClaudeWithProgress.mock.calls[1][1].messages[0].content;
    expect(relance).toMatch(/L'ESSAI PRÉCÉDENT A ÉCHOUÉ/);
    // L'essai perdu doit être COMPTÉ : le masquer sous-estimerait la dépense
    // réelle — c'est exactement ce qui a laissé passer 0,55 $ sans trace lisible.
    // 3 appels : 1 extraction de requêtes (Haiku) + les 2 essais d'audit.
    expect(res.tokenUsage.calls.length).toBe(3);
  });
});
