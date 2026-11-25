// Tests d'intégration de l'étape B (réécriture) du mode « Audit QAT + Refonte ».
// Objectif : exercer la BOUCLE DE REPRISE et le VERROU LIENS EXTERNES de bout en
// bout, avec l'appel Claude simulé — c'est le seul endroit où l'on vérifie que le
// pipeline se comporte correctement quand le modèle répond mal.
/* eslint-env jest */
import { ReadableStream as NodeReadableStream } from 'stream/web';
import { TextEncoder as NodeTextEncoder, TextDecoder as NodeTextDecoder } from 'util';

if (typeof global.ReadableStream === 'undefined') global.ReadableStream = NodeReadableStream;
if (typeof global.TextEncoder === 'undefined') global.TextEncoder = NodeTextEncoder;
if (typeof global.TextDecoder === 'undefined') global.TextDecoder = NodeTextDecoder;

// Le streaming est simulé indisponible : le pipeline doit se rabattre sur
// callClaudeWithProgress, qui porte les réponses de test.
// ⚠️ react-scripts active `resetMocks: true` : les implémentations posées dans
// cette factory sont EFFACÉES avant chaque test. Elles sont donc (re)posées dans
// le beforeEach ci-dessous, sinon les mocks renvoient undefined.
jest.mock('./agent', () => {
  const actual = jest.requireActual('./agent');
  return {
    ...actual,
    callClaudeStream: jest.fn(),
    callClaudeWithProgress: jest.fn(),
    callClaude: jest.fn(),
    scrapeSource: jest.fn(),
    // PR2 (chantier "fiabilité des liens injectés") : ces deux helpers font
    // de VRAIS appels réseau (axios) en dehors de ce mock -- sans lui, chaque
    // test déclenchait une requête réelle (échouée, silencieusement
    // absorbée par leur propre try/catch, mais bruyante et lente). Repli par
    // défaut = "aucun grounding disponible" (mêmes valeurs que le cas réel
    // d'un site sans sitemap), donc AUCUN comportement existant n'est modifié
    // par ce mock : les tests qui suivent portent sur ce qui se passait déjà
    // avant ce chantier.
    checkLinksLive: jest.fn(),
    fetchSiteUrls: jest.fn(),
  };
});

// La recherche web guidée par la consigne (gatherConsigneSources) appelle searchWeb :
// simulé, jamais de réseau réel. Retour par défaut = undefined (aucune source).
jest.mock('./search', () => ({ searchWeb: jest.fn() }));

// eslint-disable-next-line import/first
import { runQatRewrite } from './agentQat';
// eslint-disable-next-line import/first
import { searchWeb } from './search';
// eslint-disable-next-line import/first
import { callClaudeWithProgress, callClaudeStream, callClaude, scrapeSource, checkLinksLive, fetchSiteUrls } from './agent';

/**
 * Nombre d'appels de GÉNÉRATION, la passe de gras exclue.
 *
 * Depuis le 19/08/2026, `runQatRewrite` émet un SECOND appel IA — la passe de
 * gras dédiée (`agentBold.js`). Compter les appels bruts rendait donc l'assertion
 * ambiguë : « 2 » pouvait signifier « génération + gras » ou « deux tentatives de
 * génération », et c'est le second sens que ces tests protègent (un rejet relance
 * la génération, ce qui coûte cher et doit rester exceptionnel).
 * On filtre sur le LABEL, qui est le 5e argument de callClaudeWithProgress.
 */
const appelsGeneration = () => callClaudeWithProgress.mock.calls
  .filter(([, , , , label]) => !/Mise en gras/i.test(String(label || ''))).length;

/** Nombre d'appels de la PASSE DE GRAS. */
const appelsGras = () => callClaudeWithProgress.mock.calls
  .filter(([, , , , label]) => /Mise en gras/i.test(String(label || ''))).length;

const SKILLS = [{
  name: 'tonton', format: 'skillmd', active: true,
  body: '# Méthode\nAudit puis refonte.',
  resources: [{ name: 'refonte-integrale.md', content: 'Gabarits.' }],
}];

const AUDIT = {
  ampleur: { decision: 'refonte_totale', justification: 'contenu obsolète' },
  priority_actions: [], recent_context: {}, seo_geo_gaps: [],
};

const ARTICLE_URL = 'https://isolation-phonique.com/mon-article';

const reply = (obj) => ({ text: JSON.stringify(obj), usage: { model: 'claude-sonnet-4-5', input_tokens: 10, output_tokens: 20 } });

const baseArgs = (contentHtml) => ({
  content: contentHtml,
  contentHtml,
  audit: AUDIT,
  skills: SKILLS,
  articleUrl: ARTICLE_URL,
  targetKeyword: 'isolation phonique plafond',
  depth: 'auto',
});

beforeEach(() => {
  // Streaming indisponible → le pipeline passe par callClaudeWithProgress.
  callClaudeStream.mockRejectedValue(new Error('STREAM_UNAVAILABLE'));
  callClaude.mockResolvedValue({ text: '[]', usage: {} });
  scrapeSource.mockResolvedValue(null);
  checkLinksLive.mockResolvedValue({});
  fetchSiteUrls.mockResolvedValue([]);
});

// ── Contraintes rédactionnelles tenues EN DUR (demande d'Andrianina) ──────────
// Elles vivaient côté skill sous une forme trop molle pour tenir : « MAJORITÉ de
// phrases sous 20 mots » autorise explicitement le dépassement, et le gras
// sémantique n'était nulle part dans le prompt de refonte. Un test les verrouille
// donc côté code, qu'une édition de skill ne peut plus contredire.
describe('contraintes rédactionnelles en dur dans le prompt de refonte', () => {
  const promptDeRefonte = async () => {
    callClaudeWithProgress.mockResolvedValueOnce(reply({
      h1: 'T', article_html: '<h2>A</h2><p>B</p>', mot_cle_retenu: 'x',
    }));
    await runQatRewrite(baseArgs('<p>Ancien texte.</p>'));
    return callClaudeWithProgress.mock.calls[0][1].messages[0].content;
  };

  test('le plafond de 20 mots est un PLAFOND, pas une moyenne', async () => {
    const p = await promptDeRefonte();
    expect(p).toMatch(/AUCUNE phrase de plus de 20 mots/);
    expect(p).toMatch(/C'est un PLAFOND, pas une moyenne/);
    // La nuance qui faisait échouer la version « skill » : autoriser la variation
    // de rythme SOUS le plafond, jamais au-dessus.
    expect(p).toMatch(/EN DESSOUS de 20 mots/);
  });

  test('le gras sémantique nomme le mot-clé — sinon la consigne ne guide rien', async () => {
    const p = await promptDeRefonte();
    expect(p).toMatch(/PRIORITÉ HAUTE — mets en GRAS les mots importants liés au mot-clé/);
    expect(p).toContain('isolation phonique plafond');   // le mot-clé du brief
    expect(p).toMatch(/<strong>/);
  });

  // ── R5 (demande d'Andrianina, août 2026) ──────────────────────────────────
  test('le gras passe en PRIORITÉ HAUTE, et le gras d\'origine doit être repris', async () => {
    const p = await promptDeRefonte();
    expect(p).toMatch(/### 1\. PRIORITÉ HAUTE — mets en GRAS/);
    expect(p).toMatch(/REPRENDS LE GRAS DE L'ARTICLE D'ORIGINE/);
  });

  test('les tournures comptées en phase 4 sont listées AVANT la génération', async () => {
    // Objectif : ne plus corriger 35 points à la main après coup. Les listes
    // viennent de stylePatterns.js — MÊMES littéraux que la détection, donc la
    // consigne et le décompte ne peuvent pas diverger.
    const p = await promptDeRefonte();
    expect(p).toMatch(/TOURNURES QUI SERONT COMPTÉES APRÈS/);
    expect(p).toMatch(/Adverbes en -ment/);
    expect(p).toContain('constitue');            // un verbe interdit réel de la liste
    expect(p).toContain('permettant');           // un participe réel de la liste
    expect(p).toMatch(/Titres de plus de 10 mots/);
  });

  test('le gras est BORNÉ — un texte tout en gras ne met plus rien en avant', async () => {
    const p = await promptDeRefonte();
    expect(p).toMatch(/2 à 4 passages en gras par section H2/);
    expect(p).toMatch(/JAMAIS une phrase entière/);
    expect(p).toMatch(/jamais\*\* de gras dans un titre/);
  });

  test('les contraintes sont dans le message UTILISATEUR, pas dans le socle caché', async () => {
    // Le socle système porte `cache_control` et doit rester identique octet pour
    // octet entre l'audit et la refonte : y mettre le mot-clé invaliderait le cache
    // de préfixe à chaque article.
    callClaudeWithProgress.mockResolvedValueOnce(reply({
      h1: 'T', article_html: '<h2>A</h2><p>B</p>', mot_cle_retenu: 'x',
    }));
    await runQatRewrite(baseArgs('<p>Ancien texte.</p>'));
    const params = callClaudeWithProgress.mock.calls[0][1];
    const socle = JSON.stringify(params.system);
    expect(socle).not.toMatch(/AUCUNE phrase de plus de/);
  });
});

// ── La consigne d'une ligne de lot est le FIL CONDUCTEUR (17/11/2026) ──────────
// Avant : « CONCLUSIONS DE L'AUDIT (elles pilotent la réécriture) » juste sous une
// consigne censée mener — deux chefs, et l'audit, plus long, l'emportait. Le
// cadrage ne s'inverse QUE sur demande explicite ; l'écran interactif, où
// l'instruction est le texte pré-rempli d'après l'audit, garde ses prompts.
describe('runQatRewrite — consigne = fil conducteur', () => {
  const lancer = async (extra) => {
    callClaudeWithProgress.mockResolvedValueOnce(reply({
      h1: 'T', article_html: '<h2>A</h2><p>B</p>', mot_cle_retenu: 'x',
    }));
    await runQatRewrite({ ...baseArgs('<p>Ancien texte.</p>'), ...extra });
    const params = callClaudeWithProgress.mock.calls[0][1];
    return { systeme: JSON.stringify(params.system), message: params.messages[0].content };
  };

  test('avec le fil conducteur : la consigne est nommée ainsi et prime sur les conclusions de l\'audit', async () => {
    const { systeme } = await lancer({ instruction: 'Ajoute une section prix.', consigneFilConducteur: true });
    expect(systeme).toMatch(/FIL CONDUCTEUR DE CETTE MAJ/);
    expect(systeme).toContain('Ajoute une section prix.');
    expect(systeme).toMatch(/prime sur les règles générales et sur les conclusions de l'audit/);
    expect(systeme).not.toMatch(/INSTRUCTION SPÉCIFIQUE DE L'ÉQUIPE — PRIORITÉ HAUTE/);
  });

  test('avec le fil conducteur : l\'audit COMPLÈTE, il ne pilote plus la réécriture', async () => {
    const { message } = await lancer({ instruction: 'Ajoute une section prix.', consigneFilConducteur: true });
    expect(message).toMatch(/COMPLÉMENTAIRES \(la consigne de l'équipe mène\)/);
    expect(message).toMatch(/n'en retiens que le NÉCESSAIRE/i);
    expect(message).not.toMatch(/elles pilotent la réécriture/);
  });

  test('SANS le drapeau (écran interactif) : prompts INCHANGÉS, l\'audit pilote toujours', async () => {
    const { systeme, message } = await lancer({ instruction: 'Directives rédigées.' });
    expect(systeme).toMatch(/INSTRUCTION SPÉCIFIQUE DE L'ÉQUIPE — PRIORITÉ HAUTE/);
    expect(systeme).not.toMatch(/FIL CONDUCTEUR/);
    expect(message).toMatch(/CONCLUSIONS DE L'AUDIT \(elles pilotent la réécriture\)/);
    expect(message).not.toMatch(/COMPLÉMENTAIRES/);
  });

  test('le drapeau sans texte de consigne n\'ajoute aucun bloc : rien à faire mener', async () => {
    const { systeme } = await lancer({ instruction: '', consigneFilConducteur: true });
    expect(systeme).not.toMatch(/FIL CONDUCTEUR/);
  });

  // ── MAJ ciblée menée par une consigne (23/11/2026) ──────────────────────────
  // Constaté en production (article réel, consigne « Change les H2, le chapô et
  // l'introduction ») : chapô réécrit, mais introduction seulement reformulée. Le bloc
  // générique « MAJ CIBLÉE » ordonnait de conserver « à leur texte d'origine » et de se
  // limiter à une liste qui ne citait pas la consigne : deux ordres opposés.
  describe('MAJ ciblée menée par la consigne', () => {
    const ciblee = (extra) => lancer({ depth: 'ciblee', instruction: 'Change l\'introduction.', ...extra });

    test('ce que la consigne vise est RÉÉCRIT, une reformulation à la marge ne compte pas', async () => {
      const { systeme } = await ciblee({ consigneFilConducteur: true });
      expect(systeme).toMatch(/MAJ CIBLÉE, MENÉE PAR LA CONSIGNE DE L'ÉQUIPE/);
      expect(systeme).toMatch(/RÉÉCRIT POUR DE BON/);
      expect(systeme).toMatch(/reformulation à la marge/);
      expect(systeme).toMatch(/tu ne reprends aucune phrase d'origine de ce passage/);
    });

    test('le reste de l\'article reste à l\'identique, et l\'article est toujours renvoyé en entier', async () => {
      const { systeme } = await ciblee({ consigneFilConducteur: true });
      expect(systeme).toMatch(/ce que la consigne de l'équipe ne vise pas reste à son texte/);
      expect(systeme).toMatch(/l'article ENTIER/);
    });

    test('le bloc générique, qui contredisait la consigne, n\'est plus servi', async () => {
      const { systeme } = await ciblee({ consigneFilConducteur: true });
      expect(systeme).not.toMatch(/Limite-toi à : corriger/);
      expect(systeme).not.toMatch(/Conserve la structure et les sections qui fonctionnent/);
    });

    test('SANS consigne meneuse : le bloc générique est INCHANGÉ', async () => {
      const { systeme } = await ciblee({});
      expect(systeme).toMatch(/AMPLEUR RETENUE : MAJ CIBLÉE ═/);
      expect(systeme).toMatch(/Conserve la structure et les sections qui fonctionnent/);
      expect(systeme).not.toMatch(/MENÉE PAR LA CONSIGNE/);
    });

    test('le drapeau sans texte de consigne ne change rien au bloc', async () => {
      const { systeme } = await ciblee({ consigneFilConducteur: true, instruction: '' });
      expect(systeme).not.toMatch(/MENÉE PAR LA CONSIGNE/);
      expect(systeme).toMatch(/Conserve la structure et les sections qui fonctionnent/);
    });

    test('une REFONTE menée par la consigne garde son bloc de refonte', async () => {
      const { systeme } = await lancer({ depth: 'refonte', instruction: 'Change l\'angle.', consigneFilConducteur: true });
      expect(systeme).toMatch(/REFONTE TOTALE/);
      expect(systeme).not.toMatch(/MENÉE PAR LA CONSIGNE/);
    });
  });

  test('le socle système (mis en cache) n\'est PAS touché par le fil conducteur', async () => {
    const a = await lancer({ instruction: 'X.', consigneFilConducteur: true });
    callClaudeWithProgress.mockClear();
    const b = await lancer({ instruction: 'Y.', consigneFilConducteur: false });
    const socle = (s) => JSON.parse(s)[0];
    expect(socle(a.systeme)).toEqual(socle(b.systeme));
  });
});

describe('runQatRewrite — cas nominal', () => {
  test('retourne l\'article assaini, avec le chapô replacé en tête du corps', async () => {
    callClaudeWithProgress.mockResolvedValueOnce(reply({
      titre_seo: 'Isolation phonique plafond : prix 2026',
      meta_description: 'Tarifs, techniques et aides pour isoler un plafond.',
      h1: 'Isolation phonique du plafond',
      chapo_html: '<p><strong><em>Le chapô.</em></strong></p>',
      article_html: '<h2>Tarifs</h2><p>Comptez 55 €/m².</p>',
      mot_cle_retenu: 'isolation phonique plafond',
      ancres_placees: [{ ancre: 'prix au m²', url: '/prix', section: 'Tarifs' }],
    }));

    const { article } = await runQatRewrite(baseArgs('<p>Ancien texte.</p>'));

    expect(article.titreSeo).toBe('Isolation phonique plafond : prix 2026');
    expect(article.h1).toBe('Isolation phonique du plafond');
    expect(article.html).toContain('Le chapô');            // chapô intégré au corps
    expect(article.html.indexOf('Le chapô')).toBeLessThan(article.html.indexOf('Tarifs'));
    expect(article.ampleurAppliquee).toBe('refonte');
    expect(article.wordCount).toBeGreaterThan(0);
    // R2 — `ancresPlacees` n'est PLUS l'auto-déclaration du modèle mais le
    // CONSTAT sur le HTML final. Ce cas ne passe AUCUN `internalLinks` : il n'y a
    // donc aucune paire de brief à constater, et le constat est vide — même si le
    // modèle prétend (`ancres_placees`) avoir posé une ancre. C'est exactement la
    // confusion que R2 supprime : ce que le modèle DIT est conservé à part.
    expect(article.ancresPlacees).toHaveLength(0);
    expect(article.ancresDeclareesIa).toHaveLength(1);
    expect(appelsGeneration()).toBe(1);
  });

  test('l\'ampleur imposée par le rédacteur prime sur l\'audit et lève overridden', async () => {
    callClaudeWithProgress.mockResolvedValueOnce(reply({ article_html: '<p>Texte ciblé.</p>' }));
    const { article } = await runQatRewrite({ ...baseArgs('<p>x</p>'), depth: 'legere' });
    expect(article.ampleurAppliquee).toBe('ciblee');
    expect(article.ampleurSource).toBe('redacteur');
    expect(article.ampleurOverridden).toBe(true);
  });
});

describe('runQatRewrite — verrou liens externes', () => {
  const withLink = '<p>Voir <a href="https://ademe.fr/guide">le guide ADEME</a>.</p>';

  test('lien externe ajouté par l\'IA → retiré et signalé, la génération passe', async () => {
    callClaudeWithProgress.mockResolvedValueOnce(reply({
      article_html: '<p>Prix 2026 selon <a href="https://concurrent.com/x">cette étude</a>.</p>',
    }));
    const { article } = await runQatRewrite(baseArgs('<p>Ancien texte.</p>'));
    expect(article.html).not.toContain('concurrent.com');
    expect(article.html).toContain('cette étude');
    expect(article.strippedExternalLinks).toEqual(['https://concurrent.com/x']);
  });

  test('lien externe perdu → reprise INSTRUITE : le 2e prompt nomme le lien manquant', async () => {
    callClaudeWithProgress
      .mockResolvedValueOnce(reply({ article_html: '<p>Texte sans le lien.</p>' }))
      .mockResolvedValueOnce(reply({ article_html: `<p>Texte avec <a href="https://ademe.fr/guide">le guide ADEME</a>.</p>` }));

    const { article } = await runQatRewrite(baseArgs(withLink));

    expect(article.html).toContain('https://ademe.fr/guide');
    expect(appelsGeneration()).toBe(2);
    // Le second appel doit porter la consigne de reprise ET l'URL perdue.
    const secondPrompt = callClaudeWithProgress.mock.calls[1][1].messages[0].content;
    expect(secondPrompt).toContain('VERROU LIENS EXTERNES DÉCLENCHÉ');
    expect(secondPrompt).toContain('https://ademe.fr/guide');
  });

  test('lien externe perdu 3 fois → échec explicite, jamais un article amputé', async () => {
    callClaudeWithProgress.mockResolvedValue(reply({ article_html: '<p>Toujours sans le lien.</p>' }));
    await expect(runQatRewrite(baseArgs(withLink)))
      .rejects.toThrow(/Verrou liens externes/);
    expect(appelsGeneration()).toBe(3);
  });
});

// R1 — volet INTERNE. Sanction ASYMÉTRIQUE : un lien interne perdu ne fait
// JAMAIS rejeter la génération (un 4e motif de rejet écraserait le message de
// reprise du verrou externe et affaiblirait la règle 8).
describe('runQatRewrite — R1 liens internes', () => {
  const withInternal = '<p>Voir <a href="/prix">nos prix</a> et <a href="https://isolation-phonique.com/faq">la FAQ</a>.</p>';

  test('les liens internes existants sont NOMMÉS dans le prompt (prévenir plutôt que réparer)', async () => {
    callClaudeWithProgress.mockResolvedValueOnce(reply({ article_html: withInternal }));
    await runQatRewrite(baseArgs(withInternal));
    const prompt = callClaudeWithProgress.mock.calls[0][1].messages[0].content;
    expect(prompt).toContain('LIENS INTERNES DÉJÀ PRÉSENTS — À REPRODUIRE (2)');
    expect(prompt).toContain('<a href="/prix">nos prix</a>');
    expect(prompt).toContain('la FAQ');
  });

  test('lien interne délié par l\'IA → ré-enveloppé, UN SEUL appel (aucun rejet)', async () => {
    callClaudeWithProgress.mockResolvedValueOnce(reply({
      article_html: '<h2>Tarifs</h2><p>Consultez nos prix et la FAQ avant travaux.</p>',
    }));
    const { article } = await runQatRewrite(baseArgs(withInternal));
    expect(article.html).toContain('href="/prix"');
    expect(article.html).toContain('href="https://isolation-phonique.com/faq"');
    expect(article.missingInternalLinks).toEqual([]);
    expect(article.restoredInternalLinks.map(l => l.href))
      .toEqual(['/prix', 'https://isolation-phonique.com/faq']);
    expect(appelsGeneration()).toBe(1);   // jamais de relance
    // La passe de gras est INCONTOURNABLE (décision d'Andrianina) : elle part
    // automatiquement, sans bouton. Un bouton qu'on oublie de cliquer ramènerait
    // exactement le défaut mesuré — 5 sections H2 sans aucun gras.
    expect(appelsGras()).toBe(1);
  });

  test('la passe de gras ne part PAS sans mot-clé cible — on ne paie pas sans critère', async () => {
    callClaudeWithProgress.mockResolvedValueOnce(reply({
      article_html: '<h2>Tarifs</h2><p>Consultez nos prix avant de lancer les travaux.</p>',
    }));
    await runQatRewrite({ ...baseArgs(), targetKeyword: '' });
    expect(appelsGras()).toBe(0);
  });

  test('un ÉCHEC de la passe de gras ne perd PAS l\'article généré', async () => {
    // L'article a coûté un appel bien plus cher que la passe de gras. Le perdre
    // pour un gras manquant serait une très mauvaise affaire.
    callClaudeWithProgress
      .mockResolvedValueOnce(reply({
        article_html: '<h2>Tarifs</h2><p>Consultez nos prix avant de lancer les travaux.</p>',
      }))
      .mockRejectedValueOnce(new Error('surcharge API'));
    const { article } = await runQatRewrite(baseArgs());
    expect(article).toBeTruthy();
    expect(article.html).toContain('Consultez nos prix');
  });

  test('ancre disparue → AVERTISSEMENT non bloquant : l\'article est livré quand même', async () => {
    callClaudeWithProgress.mockResolvedValueOnce(reply({
      article_html: '<h2>Tarifs 2026</h2><p>Comptez 55 €/m² pose comprise.</p>',
    }));
    const { article } = await runQatRewrite(baseArgs(withInternal));
    expect(article.html).toContain('55');
    expect(article.missingInternalLinks.map(l => l.href))
      .toEqual(['/prix', 'https://isolation-phonique.com/faq']);
    expect(appelsGeneration()).toBe(1);   // aucun rejet déclenché
  });

  test('brief de maillage VIDE : la consigne distingue reproduire l\'existant d\'ajouter du neuf', async () => {
    callClaudeWithProgress.mockResolvedValueOnce(reply({ article_html: '<p>Texte.</p>' }));
    await runQatRewrite({ ...baseArgs('<p>x</p>'), internalLinks: [] });
    const system = callClaudeWithProgress.mock.calls[0][1].system;
    const consigne = system.map(b => b.text).join('\n');
    expect(consigne).toContain('AUCUN lien NOUVEAU');
    expect(consigne).toContain('REPRODUIRE L\'EXISTANT');
    // L'ancienne formule, contradictoire avec R1, ne doit plus apparaître.
    expect(consigne).not.toContain('n\'ajoute AUCUN lien.');
    expect(consigne).not.toContain('les seuls liens que tu ajoutes sont les liens INTERNES du brief');
  });
});

// ── R2 — GARANTIE 100 % : toutes les suggestions du brief sont dans le HTML ────
// La garantie ne valait rien tant qu'elle n'était vérifiée que sur le prompt :
// `ancres_placees` était une auto-déclaration du modèle, jamais recomptée. Ces
// tests portent sur le HTML RÉELLEMENT produit.
describe('runQatRewrite — R2 : maillage interne garanti à 100 %', () => {
  const LIENS = [
    { anchor: 'prix au m²', url: '/prix-isolation' },      // ancre présente → tissage
    { anchor: 'aides MaPrimeRénov', url: '/aides' },        // ancre ABSENTE → forçage rédigé
  ];

  test('ancre présente → tissée sur place ; ancre absente → clause RÉDIGÉE et marquée', async () => {
    callClaudeWithProgress.mockResolvedValueOnce(reply({
      // Le modèle n'a posé AUCUN des deux liens, et n'en déclare aucun.
      article_html: '<h2>Tarifs</h2><p>Le prix au m² dépend de la technique retenue et du support.</p>',
    }));

    const { article } = await runQatRewrite({ ...baseArgs('<p>Ancien texte.</p>'), internalLinks: LIENS });

    // Les DEUX liens sont dans le HTML final — c'est la garantie R2.
    expect(article.html).toContain('href="/prix-isolation"');
    expect(article.html).toContain('href="/aides"');
    expect(article.ancresPlacees).toHaveLength(2);

    // Le premier a été TISSÉ : pas de clause rédigée, l'ancre existait.
    expect(article.html).toMatch(/<a href="\/prix-isolation">prix au m²<\/a>/);

    // Le second a été RÉDIGÉ par le code → marqué pour relecture.
    expect(article.ancresRedigees).toHaveLength(1);
    expect(article.ancresRedigees[0].url).toBe('/aides');
    expect(article.html).toContain('data-lien-redige');
  });

  test('une URL HORS DOMAINE du brief est écartée, jamais posée (règle 8)', async () => {
    callClaudeWithProgress.mockResolvedValueOnce(reply({ article_html: '<p>Un texte de corps assez long pour accueillir une clause.</p>' }));

    const { article } = await runQatRewrite({
      ...baseArgs('<p>x</p>'),
      internalLinks: [{ anchor: 'un concurrent', url: 'https://concurrent.com/page' }],
    });

    // Poser cette URL aurait été un LIEN EXTERNE AJOUTÉ — violation de la règle 8
    // par la porte du maillage, exactement ce que filterSameSiteLinks empêche.
    expect(article.html).not.toContain('concurrent.com');
    expect(article.ancresPlacees).toHaveLength(0);
    expect(article.ancresHorsDomaine).toHaveLength(1);
  });

  test('un lien du brief DÉJÀ posé par l\'IA n\'est pas dupliqué', async () => {
    callClaudeWithProgress.mockResolvedValueOnce(reply({
      article_html: '<h2>Tarifs</h2><p>Voir le <a href="/prix-isolation">prix au m²</a> selon la technique.</p>',
    }));

    const { article } = await runQatRewrite({
      ...baseArgs('<p>x</p>'),
      internalLinks: [{ anchor: 'prix au m²', url: '/prix-isolation' }],
    });

    expect((article.html.match(/href="\/prix-isolation"/g) || [])).toHaveLength(1);
    expect(article.ancresPlacees).toHaveLength(1);
    expect(article.ancresRedigees).toHaveLength(0);   // rien à rédiger, l'IA l'avait fait
  });
});

describe('runQatRewrite — réponses non conformes', () => {
  test('3 réponses illisibles → message clair, et non une TypeError opaque', async () => {
    callClaudeWithProgress.mockResolvedValue({ text: 'Voilà votre article !', usage: {} });
    await expect(runQatRewrite(baseArgs('<p>x</p>')))
      .rejects.toThrow(/pas produit d'article exploitable après 3 essais/);
    expect(appelsGeneration()).toBe(3);
  });

  test('article_html vide → traité comme illisible, avec consigne de reprise', async () => {
    callClaudeWithProgress
      .mockResolvedValueOnce(reply({ article_html: '' }))
      .mockResolvedValueOnce(reply({ article_html: '<p>Cette fois-ci ça va.</p>' }));
    const { article } = await runQatRewrite(baseArgs('<p>x</p>'));
    expect(article.html).toContain('ça va');
    const secondPrompt = callClaudeWithProgress.mock.calls[1][1].messages[0].content;
    expect(secondPrompt).toContain("L'ESSAI PRÉCÉDENT A ÉCHOUÉ");
  });

  test('aucun skill cerveau actif → refus immédiat, sans appel à l\'IA', async () => {
    await expect(runQatRewrite({ ...baseArgs('<p>x</p>'), skills: [] }))
      .rejects.toThrow(/skill cerveau/);
    expect(callClaudeWithProgress).not.toHaveBeenCalled();
  });
});

// ── La consigne nomme des passages : on VÉRIFIE, puis on relance une fois ────────
// Mesuré en production le 23/11/2026 (même article, trois essais) : introduction
// à 0,44 / 0,54 / 0,14 de proximité avec l'original, H2 changés 0 / 4 / 1 sur 9.
// Le bloc de prompt ne suffit pas ; le code mesure et relance UNE fois.
describe('runQatRewrite — la consigne nommée est vérifiée, puis relancée (2 fois au plus)', () => {
  const CHAPO = 'Fondée en 1976 aux États-Unis et implantée en France via Ticketnet en 1997, la plateforme distribue des millions de places.';
  const INTRO = 'Acheter une place de concert sur une billetterie en ligne semble d’une simplicité enfantine, mais le parcours reste complexe pour beaucoup.';
  const SOURCE = `<p>${CHAPO}</p><p>${INTRO}</p>`
    + '<h2>Ticketnet, entité française</h2><p>a</p><h2>Compte et inscription</h2><p>b</p>'
    + '<h2>Transférer un billet</h2><p>c</p><h2>Sécurité et tarification</h2><p>d</p><h2>FAQ</h2><p>e</p>';
  const REECRIT = '<p>Un clic suffit parfois pour réserver, mais la mécanique derrière reste méconnue des acheteurs et de leurs proches.</p>'
    + '<p>Voici comment réserver, transférer et se faire rembourser sans stress ni mauvaise surprise sur la billetterie officielle.</p>'
    + '<h2>Qui se cache derrière la billetterie</h2><p>a</p><h2>Créer son profil client</h2><p>b</p>'
    + '<h2>Passer un billet à un ami</h2><p>c</p><h2>Prix dynamiques et protection</h2><p>d</p><h2>FAQ</h2><p>e</p>';

  /** Génère dans l'ordre donné ; la passe de gras reçoit une réponse vide. */
  const lancer = async (generations, extra = {}) => {
    const file = [...generations];
    callClaudeWithProgress.mockImplementation(async (...args) => {
      if (/Mise en gras/i.test(String(args[4] || ''))) return reply({ passages: [] });
      const next = file.shift();
      if (next instanceof Error) throw next;
      return reply(next);
    });
    const steps = [];
    const r = await runQatRewrite({
      ...baseArgs(SOURCE), depth: 'ciblee', consigneFilConducteur: true,
      instruction: 'Change les H2 et le chapô et l\'introduction',
      onStep: (m) => steps.push(m), ...extra,
    });
    return { ...r, steps };
  };

  const gen = (html) => ({ h1: 'T', article_html: html, mot_cle_retenu: 'x' });

  test('génération déjà conforme : AUCUNE relance, un seul appel', async () => {
    const { article } = await lancer([gen(REECRIT)]);
    expect(appelsGeneration()).toBe(1);
    expect(article.constatConsigne.relance).toBe(false);
  });

  test('cibles restées identiques : UNE relance, dont le prompt cite le texte d\'origine', async () => {
    const { article, steps } = await lancer([gen(SOURCE), gen(REECRIT)]);
    expect(appelsGeneration()).toBe(2);
    const second = callClaudeWithProgress.mock.calls
      .filter(([, , , , label]) => !/Mise en gras/i.test(String(label || '')))[1][1].messages[0].content;
    expect(second).toMatch(/LA CONSIGNE DE L'ÉQUIPE N'A PAS ÉTÉ APPLIQUÉE/);
    expect(second).toContain(INTRO);
    expect(article.html).toContain('Un clic suffit');
    expect(article.constatConsigne.relance).toBe(true);
    expect(article.constatConsigne.retenue).toBe('reprise');
    expect(steps.join('\n')).toMatch(/nouvelle rédaction ciblée/);
  });

  test('JAMAIS plus de deux relances, même si elles ne changent rien', async () => {
    const { article } = await lancer([gen(SOURCE), gen(SOURCE), gen(SOURCE)]);
    expect(appelsGeneration()).toBe(3);
    expect(article.constatConsigne.relances).toBe(2);
  });

  test('2e relance : l\'introduction seule restée trop proche est reprise une 2e fois', async () => {
    // 1re : tout identique ; 2e : H2 et chapô neufs mais introduction identique ; 3e : tout neuf.
    const introIdentique = REECRIT.replace(/<p>Voici comment[^<]*<\/p>/, `<p>${INTRO}</p>`);
    const { article } = await lancer([gen(SOURCE), gen(introIdentique), gen(REECRIT)]);
    expect(appelsGeneration()).toBe(3);
    const troisieme = callClaudeWithProgress.mock.calls
      .filter(([, , , , label]) => !/Mise en gras/i.test(String(label || '')))[2][1].messages[0].content;
    expect(troisieme).toMatch(/l'INTRODUCTION : trop proche/);
    expect(troisieme).not.toMatch(/les TITRES H2/);   // déjà changés à la 2e génération
    expect(article.html).toContain('Voici comment');
    expect(article.constatConsigne.relances).toBe(2);
    expect(article.constatConsigne.retenue).toBe('reprise');
  });

  test('le constat persisté ne porte pas les textes d\'origine (déjà dans l\'article d\'origine)', async () => {
    const { article } = await lancer([gen(SOURCE), gen(REECRIT)]);
    expect(JSON.stringify(article.constatConsigne)).not.toContain('Fondée en 1976');
  });

  test('une relance PIRE que la première n\'est pas retenue', async () => {
    const un = REECRIT.replace(/<h2>[^<]*<\/h2>/g, '<h2>Ticketnet, entité française</h2>');   // chapô/intro neufs, H2 identiques
    const { article } = await lancer([gen(un), gen(SOURCE), gen(SOURCE)]);
    expect(article.html).toContain('Un clic suffit');
    expect(article.constatConsigne.retenue).toBe('premiere');
  });

  test('une relance illisible : la première génération est CONSERVÉE, pas d\'erreur', async () => {
    const { article, steps } = await lancer([gen(SOURCE), { h1: 'vide' }]);
    expect(article.html).toContain('Fondée en 1976');
    expect(steps.join('\n')).toMatch(/génération précédente conservée/);
  });

  test('une relance qui perd un lien externe : la première génération est conservée', async () => {
    const avecLien = SOURCE.replace('<p>a</p>', '<p>a <a href="https://exemple.org/x">source</a></p>');
    const sansLien = REECRIT;   // le lien externe a disparu
    const { article } = await lancer([gen(avecLien), gen(sansLien)], { contentHtml: avecLien, content: avecLien });
    expect(article.html).toContain('https://exemple.org/x');
  });

  test('consigne qui ne nomme rien : aucune mesure, aucune relance', async () => {
    const { article } = await lancer([gen(SOURCE)], { instruction: 'Mets à jour les prix 2026.' });
    expect(appelsGeneration()).toBe(1);
    expect(article.constatConsigne).toBeNull();
  });

  test('cible niée (« garde les H2 ») : les H2 identiques ne déclenchent rien', async () => {
    const memesH2 = REECRIT.replace(/<h2>[^<]*<\/h2>/g, (m, i) => m).replace('Qui se cache derrière la billetterie', 'Ticketnet, entité française');
    const { article } = await lancer([gen(SOURCE.replace(CHAPO, 'Un clic suffit parfois pour réserver, mais la mécanique derrière reste méconnue des acheteurs.').replace(INTRO, 'Voici comment réserver, transférer et se faire rembourser sans stress sur la billetterie officielle.'))],
      { instruction: 'Garde les H2, change le chapô et l\'introduction' });
    expect(appelsGeneration()).toBe(1);
    expect(article.constatConsigne.cibles).toEqual(['chapo', 'intro']);
    expect(memesH2).toBeTruthy();
  });

  test('hors MAJ ciblée (refonte) : aucune vérification', async () => {
    const { article } = await lancer([gen(SOURCE)], { depth: 'refonte' });
    expect(appelsGeneration()).toBe(1);
    expect(article.constatConsigne).toBeNull();
  });
});

// ── RECHERCHE WEB GUIDÉE PAR LA CONSIGNE (25/11/2026) ──────────────────────────
// Article réel : consigne « parle du gagnant de la saison 2026… ». Les requêtes de
// l'audit venaient du début de l'article, jamais de la consigne : le gagnant n'était
// dans aucune source, le garde-fou « limite de mémoire » interdisait de l'affirmer.
describe('recherche web guidée par la consigne', () => {
  const OK = reply({ h1: 'T', article_html: '<h2>A</h2><p>B</p>', mot_cle_retenu: 'x' });
  const GAGNANT = { title: 'Les Intrépides sacrés', url: 'https://exemple.fr/gagnant', content: 'Les Intrépides ont remporté la finale du 29 mai 2026.' };
  const CONSIGNE = 'Parle de la liste des participants, du gagnant de la saison 2026 et du déroulement de cette année.';

  const lancer = async (extra = {}) => {
    callClaudeWithProgress.mockResolvedValue(OK);
    await runQatRewrite({ ...baseArgs('<p>Ancien texte sur la saison 10.</p>'), ...extra });
    const call = callClaudeWithProgress.mock.calls.find(([, , , , label]) => !/Mise en gras/i.test(String(label || '')));
    return {
      user: call[1].messages[0].content,
      system: (call[1].system || []).map((b) => b.text).join('\n'),
    };
  };

  test('une consigne qui réclame des faits déclenche une requête dédiée, et ses sources passent EN TÊTE', async () => {
    callClaude.mockResolvedValue({ text: '["La meilleure boulangerie de France saison 13 gagnant finale 2026"]', usage: {} });
    searchWeb.mockResolvedValue([GAGNANT]);
    const { user } = await lancer({
      instruction: CONSIGNE,
      sources: [{ title: 'Ancien jury', url: 'https://a.test/old', content: 'Bruno Cormerais, saison 10.' }],
    });
    expect(searchWeb).toHaveBeenCalledWith('La meilleure boulangerie de France saison 13 gagnant finale 2026');
    expect(user).toContain('[CONSIGNE] Les Intrépides sacrés');
    expect(user).toContain('ont remporté la finale du 29 mai 2026');
    expect(user.indexOf('[CONSIGNE] Les Intrépides')).toBeLessThan(user.indexOf('Ancien jury'));
    expect(user).toMatch(/cherchées pour répondre à la consigne/);
    expect(user).toMatch(/la règle « sans source, abstiens-toi » ne s'applique plus/);
  });

  test('la requête est écrite à partir de la CONSIGNE (Haiku la reçoit)', async () => {
    callClaude.mockResolvedValue({ text: '[]', usage: {} });
    await lancer({ instruction: CONSIGNE });
    const envoye = callClaude.mock.calls[0][1].messages[0].content;
    expect(envoye).toContain('gagnant de la saison 2026');
    expect(envoye).toMatch(/FAITS PRÉCIS OU RÉCENTS/);
  });

  test('consigne de style : Haiku répond [] → aucune recherche, aucun bloc [CONSIGNE]', async () => {
    callClaude.mockResolvedValue({ text: '[]', usage: {} });
    const { user } = await lancer({ instruction: 'Change les H2 et le chapô.' });
    expect(searchWeb).not.toHaveBeenCalled();
    expect(user).not.toContain('[CONSIGNE]');
    expect(user).not.toMatch(/cherchées pour répondre/);
  });

  test('sans consigne : aucun appel de requête, aucune recherche (comportement inchangé)', async () => {
    await lancer({});
    expect(callClaude).not.toHaveBeenCalled();
    expect(searchWeb).not.toHaveBeenCalled();
  });

  test("une source déjà fournie par l'audit n'est pas dupliquée", async () => {
    callClaude.mockResolvedValue({ text: '["gagnant saison 13 2026"]', usage: {} });
    searchWeb.mockResolvedValue([GAGNANT, { title: 'Déjà là', url: 'https://a.test/old', content: 'x' }]);
    const { user } = await lancer({
      instruction: CONSIGNE,
      sources: [{ title: 'Déjà là', url: 'https://a.test/old', content: 'x' }],
    });
    expect(user.match(/Déjà là/g)).toHaveLength(1);
    expect(user).toContain('[CONSIGNE] Les Intrépides sacrés');
  });

  test('une recherche qui échoue ne bloque pas la génération', async () => {
    callClaude.mockResolvedValue({ text: '["gagnant saison 13 2026"]', usage: {} });
    searchWeb.mockRejectedValue(new Error('429'));
    const { user } = await lancer({ instruction: CONSIGNE });
    expect(user).not.toContain('[CONSIGNE]');
    expect(appelsGeneration()).toBe(1);
  });

  test("l'extraction des requêtes qui échoue ne bloque pas la génération", async () => {
    callClaude.mockRejectedValue(new Error('overloaded'));
    await lancer({ instruction: CONSIGNE });
    expect(searchWeb).not.toHaveBeenCalled();
    expect(appelsGeneration()).toBe(1);
  });

  test('jamais plus de 2 requêtes ni de 4 sources ajoutées', async () => {
    callClaude.mockResolvedValue({ text: '["a","b","c"]', usage: {} });
    searchWeb.mockImplementation(async (q) => [1, 2, 3].map((n) => ({ title: `R-${q}-${n}`, url: `https://x.test/${q}/${n}`, content: 'c' })));
    const { user } = await lancer({ instruction: CONSIGNE });
    expect(searchWeb).toHaveBeenCalledTimes(2);
    expect(user.match(/### SOURCE \d+ — \[CONSIGNE\]/g)).toHaveLength(4);
  });

  test("une exclusion (« ne parle pas des autres saisons ») prime sur « conservé à l'identique » — consigne de lot", async () => {
    const { system } = await lancer({
      instruction: 'Ne parle pas des autres saisons, seulement de cette année.', consigneFilConducteur: true, depth: 'ciblee',
    });
    expect(system).toMatch(/Quand la consigne EXCLUT un sujet/);
    expect(system).toMatch(/ce retrait prime sur « conservé à l'identique »/);
  });

  test("la même règle est portée par la consigne de l'écran interactif", async () => {
    const { system } = await lancer({ instruction: 'Ne parle pas des autres saisons.' });
    expect(system).toMatch(/INSTRUCTION SPÉCIFIQUE DE L'ÉQUIPE/);
    expect(system).toMatch(/Quand la consigne EXCLUT un sujet/);
  });

  test("sans consigne : la règle d'exclusion n'est pas ajoutée", async () => {
    const { system } = await lancer({});
    expect(system).not.toMatch(/EXCLUT un sujet/);
  });
});
