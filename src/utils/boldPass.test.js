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
import { buildBoldPrompt, normalizeBoldProposals, boldPassReportLine } from './boldPrompt';
import { splitSectionsForBold, applyBoldPassages } from './boldApply';
import { GRAS_MAX_PAR_H2 } from './boldCarry';

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

  it('la répartition par section est posée comme une règle', () => {
    expect(p).toMatch(/CHAQUE section H2 doit porter 2 à 4/);
    expect(p).toMatch(/fragment sans/);
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

  it(`le PLAFOND de ${GRAS_MAX_PAR_H2} par section est tenu par le code`, () => {
    const props = ['ordre de sortie', 'ordre chronologique', 'amateurs de lore', 'Trois approches', 'aux puristes']
      .map((passage) => ({ section: 1, passage }));
    const { retenus, ecartes } = normalizeBoldProposals(props, sections);
    expect(retenus).toHaveLength(GRAS_MAX_PAR_H2);
    expect(ecartes.some((e) => e.motif === 'plafond')).toBe(true);
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
