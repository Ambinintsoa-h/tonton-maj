/**
 * PASSE DE GRAS — l'IA nomme, le code applique.
 *
 * L'invariant central n'est pas « du gras apparaît » mais **le code n'applique que
 * ce qu'il a vérifié mot pour mot**. Sans ce filtre, une paraphrase du modèle
 * poserait le gras sur d'autres mots que ceux choisis — et personne ne le verrait.
 *
 * Les cas partent des deux échecs réels du 19/08/2026 : la consigne noyée dans le
 * prompt de refonte (19 gras sur 29 étaient des chiffres, 5 sections vides) et la
 * pose par le code (« War III », « jeu God »).
 */
import {
  buildBoldPrompt, normalizeBoldProposals, boldPassReportLine, formeInattendue,
} from './boldPrompt';
import { splitSectionsForBold, applyBoldPassages } from './boldApply';
import { constatGras } from './boldCarry';

const KW = 'Quel ordre suivre god of war';

const ARTICLE = '<p>Chapô avant le premier titre, hors périmètre.</p>'
  + '<h2>Quel ordre suivre god of war en 2026</h2>'
  + '<p>Trois approches existent. L\'ordre de sortie convient aux puristes de la saga.</p>'
  + '<p>L\'ordre chronologique séduit les amateurs de lore et de continuité.</p>'
  + '<h2>La série TV Amazon</h2>'
  + '<p>Le tournage reste suspendu, sans remplaçant annoncé à ce jour par le studio.</p>'
  + '<h2>FAQ</h2>'
  + '<p>Quel ordre de sortie choisir pour bien débuter la saga complète ?</p>';

const dom = (html) => { const d = document.createElement('div'); d.innerHTML = html; return d; };
const grasDe = (html) => [...dom(html).querySelectorAll('strong')].map((s) => s.textContent);

describe('découpage soumis au modèle', () => {
  it('une section par H2, chapô exclu', () => {
    const s = splitSectionsForBold(ARTICLE);
    expect(s.map((x) => x.titre)).toEqual(['Quel ordre suivre god of war en 2026', 'La série TV Amazon']);
    expect(s[0].texte).toContain('ordre de sortie');
    expect(s[0].texte).not.toContain('Chapô');
  });

  it('la FAQ et le TL;DR ne sont MÊME PAS soumis', () => {
    // Le modèle ne peut pas proposer ce qu'il n'a pas vu : c'est le garde-fou le
    // plus sûr, plus sûr qu'un filtre en sortie.
    expect(splitSectionsForBold(ARTICLE).some((s) => /FAQ/i.test(s.titre))).toBe(false);
    expect(splitSectionsForBold('<h2>En bref</h2><p>Un résumé assez long pour passer le seuil de quarante caractères.</p>'))
      .toEqual([]);
  });

  it('le texte soumis est NU — aucune balise', () => {
    const s = splitSectionsForBold('<h2>Titre</h2><p>Un <strong>terme</strong> et un <a href="/x">lien</a> dans une phrase assez longue.</p>');
    expect(s[0].texte).not.toMatch(/[<>]/);
  });
});

describe('le prompt porte les règles à fort impact SEO', () => {
  const p = buildBoldPrompt(splitSectionsForBold(ARTICLE), KW, ['saga complète']);

  it('la RÉPONSE À LA REQUÊTE est la priorité 1', () => {
    // C'est le passage repris en position zéro et cité par les IA — le plus
    // rentable, et celui que le modèle n'a jamais posé de lui-même.
    expect(p).toMatch(/1\. LA RÉPONSE À LA REQUÊTE/);
  });

  it('les chiffres sont explicitement les DERNIERS et bornés à la moitié', () => {
    expect(p).toMatch(/6\. LES CHIFFRES/);
    expect(p).toMatch(/MOITIÉ/);
  });

  it('le PLANCHER est posé comme une règle, sans plafond', () => {
    // Le plancher reste structurel : une section H2 sans gras est un fragment muet
    // pour un moteur génératif. Le PLAFOND, lui, a été retiré le 19/08 — le modèle
    // juge le nombre d'après la longueur et la densité de la section.
    expect(p).toMatch(/CHAQUE section H2 doit porter AU MOINS 2/);
    expect(p).toMatch(/fragment sans/);
    expect(p).toMatch(/AUCUN PLAFOND IMPOSÉ/);
    expect(p).not.toMatch(/doit porter 2 à 4/);
  });

  it('interdit le fragment de nom propre — le défaut de R8', () => {
    expect(p).toContain('« God of War » entier, pas « War »');
  });

  it('le mot-clé et les secondaires sont nommés', () => {
    expect(p).toContain(KW);
    expect(p).toContain('saga complète');
  });

  it('sans mot-clé, aucun prompt — on ne paie pas un appel sans critère', () => {
    expect(buildBoldPrompt(splitSectionsForBold(ARTICLE), '')).toBe('');
    expect(buildBoldPrompt([], KW)).toBe('');
  });
});

describe('validation — le code n\'applique QUE ce qu\'il a vérifié', () => {
  const sections = splitSectionsForBold(ARTICLE);

  it('un passage MOT POUR MOT est retenu', () => {
    const { retenus } = normalizeBoldProposals([{ section: 1, passage: 'ordre de sortie' }], sections);
    expect(retenus).toEqual([{ section: 1, passage: 'ordre de sortie' }]);
  });

  it('une PARAPHRASE est écartée — le cas le plus fréquent et le plus dangereux', () => {
    // Appliquer un passage approximatif poserait le gras sur d'autres mots.
    const { retenus, ecartes } = normalizeBoldProposals(
      [{ section: 1, passage: 'l\'ordre de la sortie' }], sections,
    );
    expect(retenus).toEqual([]);
    expect(ecartes[0].motif).toBe('introuvable');
  });

  it('un passage de la MAUVAISE section est écarté', () => {
    const { ecartes } = normalizeBoldProposals([{ section: 2, passage: 'ordre de sortie' }], sections);
    expect(ecartes[0].motif).toBe('introuvable');
  });

  it('du HTML est écarté', () => {
    const { ecartes } = normalizeBoldProposals(
      [{ section: 1, passage: '<strong>ordre de sortie</strong>' }], sections,
    );
    expect(ecartes[0].motif).toBe('balisage');
  });

  it('un passage trop long est écarté', () => {
    const { ecartes } = normalizeBoldProposals(
      [{ section: 1, passage: 'Trois approches existent. L\'ordre de sortie convient aux puristes' }], sections,
    );
    expect(ecartes[0].motif).toBe('trop-long');
  });

  it('un doublon est écarté', () => {
    const { retenus, ecartes } = normalizeBoldProposals([
      { section: 1, passage: 'ordre de sortie' },
      { section: 1, passage: 'ordre de sortie' },
    ], sections);
    expect(retenus).toHaveLength(1);
    expect(ecartes[0].motif).toBe('doublon');
  });

  it('AUCUN PLAFOND par section : le modele juge le nombre', () => {
    // Retire le 19/08/2026 sur objection d Andrianina — « le modele peut juger par
    // lui-meme, il comprend le mot-cle et le contenu de l article ». Les donnees lui
    // donnaient raison : sur la section a 11 passages, le defaut n etait pas le
    // nombre mais la COMPOSITION (6 chiffres sur 11). Un plafond a 4 aurait coupe
    // dans le bon, au hasard de l ordre d arrivee.
    const props = ['ordre de sortie', 'ordre chronologique', 'amateurs de lore', 'Trois approches', 'aux puristes']
      .map((passage) => ({ section: 1, passage }));
    const { retenus, ecartes } = normalizeBoldProposals(props, sections);
    expect(retenus).toHaveLength(5);
    expect(ecartes.some((e) => e.motif === 'plafond')).toBe(false);
  });
});

describe('application dans le DOM', () => {
  const sections = splitSectionsForBold(ARTICLE);

  it('enveloppe le passage, sans toucher au texte', () => {
    const r = applyBoldPassages(ARTICLE, sections, [{ section: 1, passage: 'ordre de sortie' }]);
    expect(grasDe(r.html)).toContain('ordre de sortie');
    // Le texte lisible est identique au caractère près : on ajoute une balise.
    expect(dom(r.html).textContent).toBe(dom(ARTICLE).textContent);
  });

  it('cible la section par son TITRE, pas par l\'index brut', () => {
    // Le modèle rend parfois un numéro décalé ; poser le gras dans la mauvaise
    // section serait invisible à la relecture.
    const r = applyBoldPassages(ARTICLE, sections, [{ section: 1, passage: 'ordre de sortie' }]);
    const h2 = [...dom(r.html).querySelectorAll('h2')];
    const sec1 = h2[0].nextElementSibling;
    expect(sec1.querySelector('strong')).toBeTruthy();
  });

  it('signale les sections ENCORE sans gras après la passe', () => {
    const r = applyBoldPassages(ARTICLE, sections, [{ section: 1, passage: 'ordre de sortie' }]);
    expect(r.sansGras).toContain('La série TV Amazon');
    // La FAQ n'y figure pas : ce n'est pas un manque, elle est hors périmètre.
    expect(r.sansGras.some((t) => /FAQ/i.test(t))).toBe(false);
  });

  it('aucun passage retenu → HTML inchangé, à l\'octet', () => {
    expect(applyBoldPassages(ARTICLE, sections, []).html).toBe(ARTICLE);
  });
});

describe('compte rendu', () => {
  it('dit ce qui est posé, ce qui est écarté et avec quel motif', () => {
    const l = boldPassReportLine({
      retenus: [{ passage: 'x' }],
      ecartes: [{ passage: 'y', motif: 'introuvable' }],
      sansGras: ['La série TV Amazon'],
    });
    expect(l).toContain('1 passage(s) mis en gras');
    expect(l).toContain('introuvable');
    expect(l).toContain('La série TV Amazon');
  });

  it('rien à dire → aucune ligne de bruit', () => {
    expect(boldPassReportLine({})).toBe('');
  });
});

describe('COMPOSITION mesuree — ce qu on surveille depuis qu on ne borne plus', () => {
  // Le plafond par section masquait le vrai defaut : une section a 11 passages
  // dont 6 chiffres n a pas un probleme de nombre. Sur l article God of War,
  // 26 des 42 passages etaient des chiffres.
  it('signale une section ou les CHIFFRES sont majoritaires', () => {
    const html = '<h2>Sons of Sparta</h2><p>Sorti le <strong>12 fevrier 2026</strong>, '
      + 'note <strong>64/100</strong>, a <strong>29,99 EUR</strong>, developpe par '
      + '<strong>Mega Cat Studios</strong>.</p>';
    const c = constatGras(html);
    expect(c.sectionsChiffrees).toEqual(['Sons of Sparta']);
    expect(c.partChiffres).toBe(75);
  });

  it('ne signale RIEN quand la composition est saine', () => {
    const html = '<h2>Section saine</h2><p>Le <strong>systeme de combat</strong> et la '
      + '<strong>camera a l epaule</strong> pour <strong>94/100</strong>.</p>';
    const c = constatGras(html);
    expect(c.sectionsChiffrees).toEqual([]);
    expect(c.partChiffres).toBe(33);
  });

  it('une section a UN SEUL passage n est jamais signalee comme chiffree', () => {
    // Un seul chiffre ne fait pas un desequilibre de composition : c est le
    // PLANCHER qui est en cause, et il est deja signale a part.
    const html = '<h2>Section courte</h2><p>Le score atteint <strong>86/100</strong>.</p>';
    const c = constatGras(html);
    expect(c.sectionsChiffrees).toEqual([]);
    expect(c.sousPlancher).toBe(1);
  });

  it('aucun gras : aucune part, aucune division par zero', () => {
    const c = constatGras('<h2>Vide</h2><p>Un paragraphe sans aucun gras du tout.</p>');
    expect(c.partChiffres).toBe(0);
    expect(c.chiffres).toBe(0);
  });
});

describe('JAMAIS SILENCIEUSE — le no-op de production', () => {
  // Constate le 19/08/2026 : la passe a consomme ~1 156 tokens de sortie, RIEN n a
  // ete pose et RIEN n a ete signale. Cause : la reponse n etait ni un tableau nu
  // ni { passages: [...] }, les deux seules formes acceptees. `items` valait [],
  // donc `retenus` ET `ecartes` etaient vides, donc la ligne de compte rendu etait
  // vide. Un appel paye, aucun effet, aucun message : le pire des trois resultats.
  const sections = splitSectionsForBold(ARTICLE);

  it('accepte un tableau nu', () => {
    const { retenus } = normalizeBoldProposals([{ section: 1, passage: 'ordre de sortie' }], sections);
    expect(retenus).toHaveLength(1);
    expect(formeInattendue([{ section: 1, passage: 'ordre de sortie' }])).toBe(false);
  });

  it('accepte les cles alternatives que le modele emploie', () => {
    ['passages', 'items', 'resultats', 'gras', 'bold', 'data'].forEach((cle) => {
      const brut = { [cle]: [{ section: 1, passage: 'ordre de sortie' }] };
      expect(normalizeBoldProposals(brut, sections).retenus).toHaveLength(1);
      expect(formeInattendue(brut)).toBe(false);
    });
  });

  it('accepte un tableau sous une cle INCONNUE', () => {
    const brut = { mots_en_gras: [{ section: 1, passage: 'ordre de sortie' }] };
    expect(normalizeBoldProposals(brut, sections).retenus).toHaveLength(1);
  });

  it('une forme SANS aucune liste est DETECTEE, pas ignoree', () => {
    // C est le cas exact de production : lisible, mais rien d exploitable.
    expect(formeInattendue({ message: 'Je ne peux pas traiter cet article.' })).toBe(true);
    expect(formeInattendue({ section: 1, passage: 'un objet seul, pas une liste' })).toBe(true);
  });

  it('une reponse ILLISIBLE reste distincte d une forme inattendue', () => {
    // parseJsonLoose rend null : ce n est pas une « forme inattendue », c est un
    // echec de lecture, et les deux ont leur propre message.
    expect(formeInattendue(null)).toBe(false);
    expect(formeInattendue(undefined)).toBe(false);
  });
});

describe('PLAFOND DE MOTS PAR TYPE — 70 rejets sur 89 en production', () => {
  // La priorite 1 est « la reponse a la requete » : un fragment de phrase. Le
  // plafond general de 4 mots la rendait IMPOSSIBLE. Deux consignes qui se
  // contredisent, et l une des deux perdait en silence.
  const sections = splitSectionsForBold(ARTICLE);

  it('une REPONSE de plus de 4 mots est desormais RETENUE', () => {
    // Le passage exact rejete en production, transpose sur notre fixture.
    const { retenus, ecartes } = normalizeBoldProposals(
      [{ section: 1, passage: 'ordre de sortie convient aux puristes', type: 'reponse' }],
      sections,
    );
    expect(ecartes).toEqual([]);
    expect(retenus).toHaveLength(1);
  });

  it('le meme passage SANS le type reste rejete', () => {
    // Le plafond de 4 mots garde tout son sens hors du role de reponse.
    const { ecartes } = normalizeBoldProposals(
      [{ section: 1, passage: 'ordre de sortie convient aux puristes', type: 'entite' }],
      sections,
    );
    expect(ecartes[0].motif).toBe('trop-long');
  });

  it('une reponse au-dela de 12 mots reste rejetee', () => {
    const long = 'Trois approches existent. L ordre de sortie convient aux puristes de la saga';
    const { ecartes } = normalizeBoldProposals(
      [{ section: 1, passage: long, type: 'reponse' }], sections,
    );
    expect(ecartes[0].motif).toBe('trop-long');
  });

  it('UNE SEULE reponse par section : c est un role, pas une quantite', () => {
    const { retenus, ecartes } = normalizeBoldProposals([
      { section: 1, passage: 'ordre de sortie convient aux puristes', type: 'reponse' },
      { section: 1, passage: 'ordre chronologique seduit les amateurs', type: 'reponse' },
    ], sections);
    expect(retenus).toHaveLength(1);
    expect(ecartes[0].motif).toBe('reponse-en-double');
  });

  it('une PHRASE ENTIERE reste refusee, meme typee reponse', () => {
    // Le point final est l indice le plus fiable et ne demande aucun jugement.
    const { ecartes } = normalizeBoldProposals(
      [{ section: 1, passage: 'Trois approches existent.', type: 'reponse' }], sections,
    );
    expect(ecartes[0].motif).toBe('phrase-entiere');
  });

  it('le prompt ANNONCE le type et son plafond', () => {
    const p = buildBoldPrompt(sections, KW);
    expect(p).toContain('"type": "reponse"');
    expect(p).toContain('12 mots');
    expect(p).toMatch(/UNE SEULE par section/);
  });
});
