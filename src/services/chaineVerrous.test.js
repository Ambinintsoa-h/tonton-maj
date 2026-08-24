/**
 * chaineVerrous.test.js — L'ORDRE DES VERROUS, TENU PAR UN TEST.
 *
 * ── POURQUOI CE FICHIER EXISTE ───────────────────────────────────────────────
 * Les verrous métier de la refonte s'enchaînent dans un ordre PRÉCIS, et cet
 * ordre n'était tenu que par des commentaires :
 *
 *   R1  carryOverInternalLinks        reprend les liens internes perdus
 *   R2a unwrapForbiddenInternalLinks  délie ce que l'IA a posé en zone interdite
 *   R2  weaveBriefLinks              place les paires du brief (100 %)
 *   R6  promoteInlineRenvois         sort les « À lire aussi » de la prose
 *   R4  carryOverImages              remet les images oubliées
 *   R5  carryOverBold                remet le gras d'origine
 *
 * Les autres fichiers de test sont unitaires : aucun n'enchaîne les verrous. Un
 * réordonnancement malheureux passerait donc toute la suite au vert, alors qu'il
 * casserait des garanties que le projet paie cher :
 *
 *   • R2a AVANT R2 — c'est la raison d'être de R2a. Le lien délié redevient
 *     « absent » aux yeux de R2, qui le REPLACE dans le corps. Inversé, le lien
 *     serait délié et perdu : une violation deviendrait une suppression.
 *   • R6 APRÈS R2 — le tissage doit voir la prose du modèle telle qu'elle est.
 *   • R4 et R5 EN DERNIER — R1 et R2 posent des liens dans la PROSE, et doivent
 *     travailler sur celle du modèle, pas sur du HTML que le code vient de
 *     réinjecter. R5 en dernier pour ne pas baliser des mots que le code
 *     s'apprête à réécrire.
 *
 * ── CE QUE CE TEST N'EST PAS ─────────────────────────────────────────────────
 * Ce n'est pas un test d'implémentation. L'ordre est verifié DEUX fois :
 *   1. par ses EFFETS observables sur le HTML produit — c'est ce qui compte ;
 *   2. par la trace des appels — parce qu'un effet peut se produire par accident,
 *      et parce que le prochain lecteur doit voir l'ordre écrit noir sur blanc.
 * Si la trace casse mais que les effets tiennent, l'ordre a changé sans dommage
 * visible : c'est exactement le signal qu'on veut recevoir AVANT la régression.
 */
/* eslint-env jest */
import { ReadableStream as NodeReadableStream } from 'stream/web';
import { TextEncoder as NodeTextEncoder, TextDecoder as NodeTextDecoder } from 'util';

if (typeof global.ReadableStream === 'undefined') global.ReadableStream = NodeReadableStream;
if (typeof global.TextEncoder === 'undefined') global.TextEncoder = NodeTextEncoder;
if (typeof global.TextDecoder === 'undefined') global.TextDecoder = NodeTextDecoder;

// Streaming simulé indisponible → le pipeline passe par callClaudeWithProgress,
// qui porte les réponses de test. Même harnais que runQatRewrite.test.js.
jest.mock('./agent', () => {
  const actual = jest.requireActual('./agent');
  return {
    ...actual,
    callClaudeStream: jest.fn(),
    callClaudeWithProgress: jest.fn(),
    callClaude: jest.fn(),
    scrapeSource: jest.fn(),
  };
});

// ── TRACE DE L'ORDRE ────────────────────────────────────────────────────────
// Les implémentations RÉELLES sont conservées (`requireActual`) : on observe la
// chaîne, on ne la simule pas. Un mock qui renverrait du HTML bidon ne dirait
// rien des effets, et ce sont les effets qui portent la garantie.
//
// `global` et non une variable de module : les factories `jest.mock` sont hissées
// au-dessus des imports, donc au-dessus de toute initialisation locale.
global.__ORDRE_VERROUS = [];
const trace = (nom, fn) => (...args) => { global.__ORDRE_VERROUS.push(nom); return fn(...args); };

jest.mock('../utils/diff', () => {
  const actual = jest.requireActual('../utils/diff');
  const t = (nom, fn) => (...a) => { global.__ORDRE_VERROUS.push(nom); return fn(...a); };
  return { ...actual, carryOverInternalLinks: t('R1', actual.carryOverInternalLinks) };
});

jest.mock('../utils/internalWeave', () => {
  const actual = jest.requireActual('../utils/internalWeave');
  const t = (nom, fn) => (...a) => { global.__ORDRE_VERROUS.push(nom); return fn(...a); };
  return {
    ...actual,
    unwrapForbiddenInternalLinks: t('R2a', actual.unwrapForbiddenInternalLinks),
    weaveBriefLinks:              t('R2',  actual.weaveBriefLinks),
    promoteInlineRenvois:         t('R6',  actual.promoteInlineRenvois),
  };
});

jest.mock('../utils/imageCarry', () => {
  const actual = jest.requireActual('../utils/imageCarry');
  const t = (nom, fn) => (...a) => { global.__ORDRE_VERROUS.push(nom); return fn(...a); };
  return { ...actual, carryOverImages: t('R4', actual.carryOverImages) };
});

jest.mock('../utils/boldCarry', () => {
  const actual = jest.requireActual('../utils/boldCarry');
  const t = (nom, fn) => (...a) => { global.__ORDRE_VERROUS.push(nom); return fn(...a); };
  return { ...actual, carryOverBold: t('R5', actual.carryOverBold) };
});

// eslint-disable-next-line import/first
import { runQatRewrite } from './agentQat';
// eslint-disable-next-line import/first
import { callClaudeWithProgress, callClaudeStream, callClaude, scrapeSource } from './agent';

const SITE = 'https://isolation-phonique.com';
const ARTICLE_URL = `${SITE}/isoler-un-plafond`;

// ── L'ARTICLE D'ORIGINE, PORTEUR DES SIX PIÈGES ─────────────────────────────
//  1. un lien EXTERNE dans une phrase du corps      → règle 8, ne doit pas bouger
//  2. un lien INTERNE existant                      → R1 doit le reprendre
//  3. une image dans <figure> avec <figcaption>      → R4 doit la replacer ENTIÈRE
//  4. deux passages en <strong>                     → R5 doit les remettre
//  5. une paire du brief dont l'ancre est absente    → R2 doit RÉDIGER la clause
//  6. un lien interne posé par l'IA dans la FAQ      → R2a délie, R2 replace
const ORIGINAL = [
  '<h2>Le principe de la masse-ressort-masse</h2>',
  '<p>Un doublage bien posé change tout, comme le rappelle ',
  '<a href="https://acermi.fr/fiche-technique">la fiche technique ACERMI</a>',
  ' sur les performances mesurées en laboratoire.</p>',
  '<p>Notre <a href="', SITE, '/laine-de-roche">guide de la laine de roche</a> compare les solutions.</p>',
  '<figure><img src="', SITE, '/img/plafond-isole.jpg" alt="Plafond isolé en cours de pose">',
  '<figcaption>Pose d\'un plafond suspendu sur suspentes antivibratiles</figcaption></figure>',
  '<h2>Les chiffres qui comptent</h2>',
  '<p>Le <strong>coefficient Rw</strong> progresse vite, et le ',
  '<strong>budget au mètre carré</strong> reste tenable sur un chantier ordinaire.</p>',
].join('');

// ── LA RÉPONSE DU MODÈLE, QUI PERD TOUT SAUF L'EXTERNE ──────────────────────
// Le lien externe est CONSERVÉ à dessein : le perdre déclencherait un rejet
// (règle 8) et la génération repartirait — on ne testerait plus la chaîne mais la
// boucle de reprise, déjà couverte par runQatRewrite.test.js.
const REPONSE_HTML = [
  '<h2>Le principe de la masse-ressort-masse</h2>',
  '<p>Un doublage bien posé change tout, comme le rappelle ',
  '<a href="https://acermi.fr/fiche-technique">la fiche technique ACERMI</a>',
  ' sur les performances mesurées en laboratoire.</p>',
  // le lien interne a disparu, mais son ANCRE est encore là → R1 peut réenvelopper
  '<p>Notre guide de la laine de roche compare les solutions disponibles aujourd\'hui.',
  // un renvoi écrit PAR LE MODÈLE, collé en fin de phrase → R6 doit le sortir
  ' À lire aussi les <a href="', SITE, '/actualites">actualités du bâtiment</a>.</p>',
  // l'image et les deux <strong> ont disparu
  '<h2>Les chiffres qui comptent</h2>',
  '<p>Le coefficient Rw progresse vite, et le budget au mètre carré reste tenable.</p>',
  '<h2>FAQ</h2>',
  '<h3>Faut-il demander un devis ?</h3>',
  // ZONE INTERDITE : l'IA pose un lien dans la FAQ → R2a délie, R2 replace
  '<p>Oui, consultez notre <a href="', SITE, '/tarifs">page des tarifs</a> avant de commencer.</p>',
].join('');

const BRIEF_LINKS = [
  // ancre ABSENTE du texte produit → R2 doit rédiger une clause marquée
  { anchor: 'devis acoustique personnalisé', url: `${SITE}/devis` },
  // ancre présente UNIQUEMENT dans la FAQ → R2a la libère, R2 la replace ailleurs
  { anchor: 'page des tarifs', url: `${SITE}/tarifs` },
];

const SKILLS = [{
  name: 'tonton', format: 'skillmd', active: true,
  body: '# Méthode\nAudit puis refonte.',
  resources: [{ name: 'refonte-integrale.md', content: 'Gabarits.' }],
}];

const AUDIT = {
  ampleur: { decision: 'refonte_totale', justification: 'contenu obsolète' },
  priority_actions: [], recent_context: {}, seo_geo_gaps: [],
};

const reply = (obj) => ({
  text: JSON.stringify(obj),
  usage: { model: 'claude-sonnet-5', input_tokens: 10, output_tokens: 20 },
});

/** Lance la chaîne complète et rend le HTML final + la trace d'ordre. */
const lancerChaine = async () => {
  callClaudeWithProgress.mockResolvedValueOnce(reply({
    h1: 'Isoler un plafond', titre_seo: 'Isoler un plafond', meta_description: 'x',
    article_html: REPONSE_HTML, mot_cle_retenu: 'isolation phonique plafond',
  }));
  // Passe de gras et appels suivants : réponse valide mais vide, pour que la
  // chaîne aille jusqu'au bout sans que le gras neuf brouille les assertions.
  callClaudeWithProgress.mockResolvedValue(reply({ sections: [] }));

  const res = await runQatRewrite({
    content: ORIGINAL,
    contentHtml: ORIGINAL,
    audit: AUDIT,
    skills: SKILLS,
    articleUrl: ARTICLE_URL,
    targetKeyword: 'isolation phonique plafond',
    internalLinks: BRIEF_LINKS,
    depth: 'auto',
  });
  return { html: res.article.html, article: res.article, ordre: global.__ORDRE_VERROUS.slice() };
};

/** Le contenu de la FAQ seule — pour vérifier qu'aucun lien n'y survit. */
const blocFaq = (html) => {
  const i = html.indexOf('<h2>FAQ</h2>');
  return i === -1 ? '' : html.slice(i);
};

/** Le corps hors FAQ — c'est là que les liens doivent atterrir. */
const horsFaq = (html) => {
  const i = html.indexOf('<h2>FAQ</h2>');
  return i === -1 ? html : html.slice(0, i);
};

beforeEach(() => {
  global.__ORDRE_VERROUS = [];
  callClaudeStream.mockRejectedValue(new Error('STREAM_UNAVAILABLE'));
  callClaude.mockResolvedValue({ text: '[]', usage: {} });
  scrapeSource.mockResolvedValue(null);
});

describe('les six pièges, en une seule chaîne', () => {
  test('1. le lien EXTERNE traverse la chaîne INTACT — href et ancre au caractère près', async () => {
    // Règle 8, le verrou le plus cher du projet. Aucun verrou de la chaîne ne
    // doit y toucher : R2a ne délie que l'interne, R6 ne déplace que l'interne.
    const { html } = await lancerChaine();
    expect(html).toContain('<a href="https://acermi.fr/fiche-technique">la fiche technique ACERMI</a>');
    // et il reste UNIQUE : ni dupliqué par un verrou, ni déplacé en encart
    expect((html.match(/acermi\.fr/g) || []).length).toBe(1);
  });

  test('2. R1 — le lien INTERNE d\'origine est réenveloppé sur son ancre', async () => {
    const { html } = await lancerChaine();
    expect(html).toMatch(/<a[^>]+href="[^"]*\/laine-de-roche"[^>]*>guide de la laine de roche<\/a>/);
  });

  test('3. R4 — l\'image revient DANS son <figure>, avec sa <figcaption>', async () => {
    // Replacer l'image seule perdrait la légende, qui est du texte rédigé.
    const { html } = await lancerChaine();
    expect(html).toContain('plafond-isole.jpg');
    expect(html).toMatch(/<figure>[\s\S]*plafond-isole\.jpg[\s\S]*<figcaption>[\s\S]*<\/figcaption>[\s\S]*<\/figure>/);
    expect(html).toContain('suspentes antivibratiles');
  });

  test('4. R5 — les deux passages en gras d\'origine sont remis', async () => {
    // Un <strong> est un choix éditorial déjà validé : le perdre à la réécriture
    // est une régression que personne ne voit.
    const { html } = await lancerChaine();
    expect(html).toMatch(/<strong>coefficient Rw<\/strong>/);
    expect(html).toMatch(/<strong>budget au mètre carré<\/strong>/);
  });

  test('5. R2 — la paire sans ancre produit une clause MARQUÉE', async () => {
    // Le code a le droit de rédiger, à une condition non négociable : que ce
    // soit VISIBLE dans l'éditeur pour être relu.
    const { html } = await lancerChaine();
    expect(html).toContain(`${SITE}/devis`);
    expect(html).toMatch(/data-lien-redige/);
    expect(html).toContain('devis acoustique personnalisé');
  });

  test('6. R2a + R2 — le lien de la FAQ est DÉLIÉ puis REPLACÉ dans le corps', async () => {
    // Le cœur de l'enchaînement. Trois choses à la fois :
    //   • la FAQ ne porte plus AUCUN lien ;
    //   • le TEXTE de l'ancre y est conservé — on retire la balise, pas les mots ;
    //   • l'URL réapparaît dans le corps, donc le lien n'est pas perdu.
    const { html } = await lancerChaine();
    const faq = blocFaq(html);
    expect(faq).not.toMatch(/<a[^>]*>/);
    expect(faq).toContain('page des tarifs');          // les mots restent
    expect(horsFaq(html)).toContain(`${SITE}/tarifs`); // le lien est ailleurs
  });

  test('R6 — le renvoi écrit par le MODÈLE sort dans son propre encart', async () => {
    // Constaté en production : « À lire aussi LES actualités… » collé en fin de
    // phrase, sans `data-lien-redige` — donc écrit par le modèle, pas par le code.
    const { html } = await lancerChaine();
    expect(html).toMatch(/class="[^"]*lien-connexe/);
    expect(html).toContain('/actualites');
    // DÉPLACEMENT, pas réécriture : le texte de l'ancre est conservé.
    expect(html).toContain('actualités du bâtiment');
  });
});

describe('l\'ORDRE de la chaîne', () => {
  test('les six verrous ont tous tourné, une fois chacun', async () => {
    // Si l'un disparaît du pipeline, les assertions d'ordre ci-dessous
    // deviendraient vraies par vacuité — d'où ce garde-fou en premier.
    const { ordre } = await lancerChaine();
    ['R1', 'R2a', 'R2', 'R6', 'R4', 'R5'].forEach((r) => {
      expect(ordre).toContain(r);
    });
  });

  test('R2a passe AVANT R2 — sinon le lien de FAQ est délié puis PERDU', async () => {
    const { ordre } = await lancerChaine();
    expect(ordre.indexOf('R2a')).toBeGreaterThan(-1);
    expect(ordre.indexOf('R2a')).toBeLessThan(ordre.indexOf('R2'));
  });

  test('R6 passe APRÈS R2 — le tissage doit voir la prose du modèle telle quelle', async () => {
    const { ordre } = await lancerChaine();
    expect(ordre.indexOf('R6')).toBeGreaterThan(ordre.indexOf('R2'));
  });

  test('R4 et R5 passent EN DERNIER, après tous les verrous de liens', async () => {
    // R1 et R2 posent des liens dans la PROSE : ils doivent travailler sur celle
    // du modèle, pas sur du HTML que le code vient de réinjecter.
    const { ordre } = await lancerChaine();
    const dernierLien = Math.max(ordre.lastIndexOf('R1'), ordre.lastIndexOf('R2a'),
      ordre.lastIndexOf('R2'), ordre.lastIndexOf('R6'));
    expect(ordre.indexOf('R4')).toBeGreaterThan(dernierLien);
    expect(ordre.indexOf('R5')).toBeGreaterThan(dernierLien);
  });

  test('R5 passe après R4 — on ne balise pas des mots que le code va réécrire', async () => {
    const { ordre } = await lancerChaine();
    expect(ordre.indexOf('R5')).toBeGreaterThan(ordre.indexOf('R4'));
  });

  test('la chaîne complète, dans l\'ordre attendu', async () => {
    // Assertion la plus lisible du fichier : elle DIT l'ordre, au lieu de le
    // déduire de cinq comparaisons. C'est celle que le prochain lecteur lira.
    const { ordre } = await lancerChaine();
    const premiers = ['R1', 'R2a', 'R2', 'R6'];
    const derniers = ['R4', 'R5'];
    const vus = ordre.filter((r) => premiers.includes(r) || derniers.includes(r));
    // dédoublonné : un verrou peut être appelé plusieurs fois (deuxième passe)
    const uniques = vus.filter((r, i) => vus.indexOf(r) === i);
    expect(uniques).toEqual(['R1', 'R2a', 'R2', 'R6', 'R4', 'R5']);
  });
});

describe('ce que la chaîne ne doit PAS faire', () => {
  test('aucun lien EXTERNE nouveau n\'apparaît — y compris par la porte du maillage', async () => {
    const { html } = await lancerChaine();
    const hotes = [...html.matchAll(/href="https?:\/\/([^/"]+)/g)].map((m) => m[1]);
    const externes = [...new Set(hotes.filter((h) => !h.includes('isolation-phonique.com')))];
    // Le seul externe autorisé est celui de l'article d'origine.
    expect(externes).toEqual(['acermi.fr']);
  });

  test('la clause rédigée par le code n\'atterrit jamais dans la FAQ', async () => {
    const { html } = await lancerChaine();
    expect(blocFaq(html)).not.toMatch(/data-lien-redige/);
  });

  test('le rapport de la génération dit ce que les verrous ont fait', async () => {
    // Sans ces champs, on ne saurait pas APRÈS COUP pourquoi un article est sorti
    // comme ça — le travers corrigé pour la passe de gras (`boldPass` persisté).
    const { article } = await lancerChaine();
    expect(Array.isArray(article.restoredImages)).toBe(true);        // R4
    expect(Array.isArray(article.missingImages)).toBe(true);         // R4, non replacées
    expect(Array.isArray(article.restoredInternalLinks)).toBe(true); // R1
    expect(Array.isArray(article.missingInternalLinks)).toBe(true);  // R1, avertissement
    expect(Array.isArray(article.ancresBrief)).toBe(true);           // R2, constat recompté
    expect(article.constatGras).toBeTruthy();                        // mesure du gras
  });

  test('TROU CONNU — le rapport de R5 ne franchit PAS le retour', async () => {
    // `sanitized.restoredBold` et `sanitized.missingBold` sont bien calculés, et
    // s'arrêtent là : ils ne sont pas exposés sur `article`, donc jamais
    // persistés. C'est EXACTEMENT le défaut corrigé pour `constatGras` et
    // `boldPass` — trois mesures avaient été oubliées dans ce geste, et R5 est la
    // quatrième. Conséquence : on ne peut pas signaler à la publication le gras
    // d'origine perdu, faute de savoir lequel manquait.
    //
    // Ce test CONSTATE le trou au lieu de le taire. Il est à INVERSER dès que les
    // champs sont renvoyés — c'est le signal qui dit que le travail est fait.
    const { article } = await lancerChaine();
    expect(article.restoredBold).toBeUndefined();
    expect(article.missingBold).toBeUndefined();
  });
});
