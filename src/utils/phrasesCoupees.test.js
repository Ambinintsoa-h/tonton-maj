/**
 * phrasesCoupees.test.js — VERROU : les amputations réelles sont détectées.
 *
 * Les cas de ce fichier ne sont pas inventés. Ils viennent d'un article généré le
 * 18 août 2026 (« quel ordre suivre god of war »), où QUATRE phrases sont sorties
 * amputées d'un mot porteur sans qu'aucun compteur ne s'en aperçoive. La phase 4
 * mesurait onze familles de défauts de style — et pas celle-ci, la seule qui rend
 * le texte illisible.
 *
 * Un test qui passerait sur des exemples fabriqués ne prouverait rien : c'est la
 * raison pour laquelle les extraits sont recopiés tels quels.
 */
import { phrasesCoupees, detectStylePatterns, MOTIFS_COUPURE } from './stylePatterns';

const p = (t) => `<p>${t}</p>`;
const motifs = (html) => phrasesCoupees(html).map((o) => o.motif);

describe('cas réels du 18 août 2026', () => {
  it('détecte une fin suspendue — « un nouveau jeu Kratos déjà en. »', () => {
    const html = p('God of War: Laufey sortira le 16 février 2027, un nouveau jeu Kratos est déjà en.');
    expect(motifs(html)).toContain('suspendue');
    expect(phrasesCoupees(html)[0].terme).toBe('en');
  });

  it('détecte la ponctuation fusionnée — « cette période complète., elle débute »', () => {
    const html = p('Sept jeux canoniques couvrent cette période complète., elle débute avec Ascension.');
    expect(motifs(html)).toContain('ponctuation');
  });

  it('détecte la reprise en minuscule après un point', () => {
    const html = p('Le studio a communiqué la date. elle reste à confirmer selon les annonces.');
    expect(motifs(html)).toContain('minuscule');
  });

  it('NE signale PAS une phrase nominale courte — « L\'assaut final. »', () => {
    // Un quatrième motif avait été écrit pour les segments de deux mots ponctués
    // comme une phrase. Il a été RETIRÉ avant livraison : « L'assaut final. » fait
    // exactement deux mots et c'est une tournure journalistique VOULUE, présente
    // dans l'article même qui a motivé ce module. Un panneau de phase 4 qui crie
    // au loup sur de la prose correcte cesse d'être lu.
    const html = p('L\'assaut final. Kratos et les Titans escaladent le mont Olympe ensemble.');
    expect(phrasesCoupees(html)).toEqual([]);
  });

  it('NE prétend PAS détecter un mot substitué — « un accueil polaire »', () => {
    // « polaire » à la place de « mitigé » : la phrase est syntaxiquement valide.
    // Aucun détecteur sans compréhension ne peut la signaler, et prétendre le
    // contraire donnerait une fausse garantie — c'est le genre de promesse
    // « exacte mais à effet nul » que ce projet a déjà payée.
    const html = p('Sorti sur PS3 en 2013, Ascension reçoit un accueil polaire de la presse.');
    expect(phrasesCoupees(html)).toEqual([]);
  });
});

describe('pas de faux positifs sur du texte correct', () => {
  it('un paragraphe propre ne remonte rien', () => {
    const html = p(
      'God of War débarque en 2005 sur PlayStation 2. Le studio Santa Monica façonne '
      + 'un hack and slash brutal. David Jaffe mêle la sauvagerie des combats aux mythes grecs.',
    );
    expect(phrasesCoupees(html)).toEqual([]);
  });

  it('une abréviation suivie d\'un point n\'est pas une reprise fautive', () => {
    expect(phrasesCoupees(p('Les préquels, Ascension, Ghost of Sparta, etc. sont sortis sur PSP.'))).toEqual([]);
  });

  it('un nombre décimal n\'est pas une reprise en minuscule', () => {
    expect(phrasesCoupees(p('Les ventes dépassent 4.6 millions d\'exemplaires sur PS2.'))).toEqual([]);
  });

  it('les TABLEAUX et les LISTES sont hors périmètre', () => {
    // Un tableau aplati finit sur n'importe quel mot : le compter ferait de cette
    // règle une règle FAUSSE, exactement comme pour `phrasesTropLongues` (9
    // « phrases trop longues » annoncées, 5 réelles, le reste était le tableau).
    const html = '<table><tr><td>Parcours</td><td>Ordre de sortie</td><td>50 à</td></tr></table>'
      + '<ul><li>trois ordres possibles : sortie, chronologique ou</li></ul>';
    expect(phrasesCoupees(html)).toEqual([]);
  });
});

describe('intégration dans la phase 4', () => {
  it('remonte comme anomalie « coupees », en PREMIER', () => {
    // Une phrase amputée n'est pas un défaut de style : c'est du texte illisible.
    // La ranger onzième reproduirait le travers que l'audit reproche aux articles
    // (la réponse attendue reléguée en 16e position sur 22).
    const html = p('Un nouveau jeu Kratos est déjà en.') + p('Ce volet offre une expérience complète.');
    const { findings } = detectStylePatterns(html);
    expect(findings[0].id).toBe('coupees');
    expect(findings[0].count).toBeGreaterThan(0);
    // Les autres règles continuent de fonctionner : « offre » est un verbe interdit.
    expect(findings.map((f) => f.id)).toContain('verbes');
  });

  it('un article sain ne fait apparaître aucune anomalie « coupees »', () => {
    const { findings } = detectStylePatterns(p('Le studio confirme la date. La sortie visée reste février 2027.'));
    expect(findings.map((f) => f.id)).not.toContain('coupees');
  });

  it('chaque motif détecté porte un libellé', () => {
    Object.keys(MOTIFS_COUPURE).forEach((k) => expect(MOTIFS_COUPURE[k]).toBeTruthy());
  });

  it('chaque occurrence porte un extrait localisable dans l\'éditeur', () => {
    // Sans extrait exploitable, « Situer » répond « Passage introuvable » — le
    // défaut corrigé en phase 4 sur les autres règles, à ne pas réintroduire.
    const html = p('Sept jeux couvrent cette période complète., elle débute avec Ascension.');
    phrasesCoupees(html).forEach((o) => {
      expect(o.extrait.length).toBeGreaterThan(10);
      expect(typeof o.motif).toBe('string');
    });
  });
});
