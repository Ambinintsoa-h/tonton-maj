/**
 * R8 — le code pose le gras lié au mot-clé.
 *
 * Les tests partent des CHIFFRES RÉELS mesurés sur l'article God of War du
 * 19/08/2026 : 29 gras dont 19 de purs chiffres, « ordre » 8 fois dans le texte
 * et 2 fois en gras, 5 sections sans aucun gras, 7 avec un seul.
 *
 * L'invariant central n'est pas « du gras est ajouté » mais « le code ne devine
 * jamais » : il pose ce qu'il peut prouver depuis le mot-clé et les mots-clés
 * secondaires, et il DIT ce qu'il n'a pas pu faire.
 */
import { weaveKeywordBold, candidatsGras, motsSignificatifs, boldReportLine } from './keywordBold';
import { constatGras, GRAS_MIN_PAR_H2 } from './boldCarry';

const KW = 'Quel ordre suivre god of war';
const dom = (html) => { const d = document.createElement('div'); d.innerHTML = html; return d; };
const grasDe = (html) => [...dom(html).querySelectorAll('strong')].map((s) => s.textContent);

describe('les candidats sont PROUVABLES, jamais devinés', () => {
  it('ignore les mots vides du mot-clé', () => {
    // « quel » et « of » n'ont aucune valeur sémantique : les garder ferait
    // apparier n'importe quelle phrase.
    expect(motsSignificatifs(KW)).toEqual(['ordre', 'suivre', 'god', 'war']);
  });

  it('trouve le mot-tête AVEC son complément — le gros du gain', () => {
    const t = 'Trois approches : l\'ordre de sortie, l\'ordre chronologique ou le raccourci.';
    const c = candidatsGras(t, KW);
    expect(c).toContain('ordre de sortie');
    expect(c).toContain('ordre chronologique');
  });

  it('LES CHIFFRES PASSENT EN DERNIER — c\'est la pathologie corrigée', () => {
    // 19 des 29 gras étaient des chiffres. Le tri suffit à rééquilibrer, sans
    // aucun jugement sémantique.
    const t = 'Le score atteint 64/100 pour cet ordre chronologique de 25 heures.';
    const c = candidatsGras(t, KW);
    const iTexte = c.findIndex((x) => !/\d/.test(x));
    const iChiffre = c.findIndex((x) => /\d/.test(x));
    expect(iTexte).toBeGreaterThanOrEqual(0);
    expect(iChiffre).toBeGreaterThan(iTexte);
  });

  it('reprend les mots-clés secondaires fournis', () => {
    const c = candidatsGras('Un guide sur le hack and slash moderne.', KW, ['hack and slash']);
    expect(c).toContain('hack and slash');
  });

  it('ne dépasse jamais 4 mots ni ne descend sous 4 caractères', () => {
    candidatsGras('Quel ordre suivre god of war reste la question des joueurs.', KW)
      .forEach((c) => {
        expect(c.split(' ').length).toBeLessThanOrEqual(4);
        expect(c.length).toBeGreaterThanOrEqual(4);
      });
  });

  it('aucun mot-clé ni secondaire : aucun candidat', () => {
    expect(candidatsGras('Un texte quelconque.', '', [])).toEqual([]);
  });
});

describe('la pose remplit les sections SOUS le plancher', () => {
  // La section réelle de l'article : 197 mots, UN seul gras, et c'était une durée.
  const SECTION = '<h2>Quel ordre suivre god of war en 2026 ?</h2>'
    + '<p>Trois approches existent selon le profil du joueur.</p>'
    + '<p>L\'ordre de sortie convient aux puristes. L\'ordre chronologique séduit '
    + 'les amateurs de lore. Le raccourci tient en <strong>60 à 80 heures</strong>.</p>';

  it('amène la section au plancher, et le gras porte le MOT-CLÉ', () => {
    const r = weaveKeywordBold(SECTION, { targetKeyword: KW });
    expect(r.placed.length).toBeGreaterThanOrEqual(1);
    const gras = grasDe(r.html);
    // Le gras existant est conservé…
    expect(gras).toContain('60 à 80 heures');
    // …et le nouveau est lié au mot-clé, pas un chiffre de plus.
    expect(gras.some((g) => /ordre/i.test(g))).toBe(true);
    expect(constatGras(r.html).sections[0].gras).toBeGreaterThanOrEqual(GRAS_MIN_PAR_H2);
  });

  it('une section DÉJÀ conforme n\'est pas touchée', () => {
    const html = '<h2>Section conforme</h2><p>Un <strong>ordre de sortie</strong> et '
      + 'un <strong>ordre chronologique</strong> bien posés.</p>';
    const r = weaveKeywordBold(html, { targetKeyword: KW });
    expect(r.placed).toEqual([]);
    expect(r.html).toBe(html);
  });

  it('une section AU-DESSUS du plafond n\'est pas défaite', () => {
    // Retirer un gras du modèle serait défaire un choix éditorial pour appliquer
    // une borne. `constatGras` le signale déjà, c'est suffisant.
    const html = '<h2>Section chargée</h2><p><strong>64/100</strong>, <strong>29,99 €</strong>, '
      + '<strong>39,99 €</strong>, <strong>2 juin 2026</strong>, <strong>Everywhen</strong> '
      + 'et un ordre chronologique.</p>';
    const r = weaveKeywordBold(html, { targetKeyword: KW });
    expect(r.placed).toEqual([]);
    expect(grasDe(r.html)).toHaveLength(5);
  });

  it('un même terme n\'est mis en gras qu\'UNE fois dans tout l\'article', () => {
    const html = '<h2>Un</h2><p>Voici l\'ordre chronologique du jeu.</p>'
      + '<h2>Deux</h2><p>Encore l\'ordre chronologique, cité une seconde fois.</p>';
    const r = weaveKeywordBold(html, { targetKeyword: KW });
    const occ = grasDe(r.html).filter((g) => g.toLowerCase() === 'ordre chronologique');
    expect(occ).toHaveLength(1);
  });
});

describe('ce que le code REFUSE de faire', () => {
  it('jamais dans un titre ni dans un lien', () => {
    const html = '<h2>Quel ordre suivre god of war</h2>'
      + '<p>Voir <a href="/x">l\'ordre chronologique</a> détaillé ailleurs.</p>';
    const r = weaveKeywordBold(html, { targetKeyword: KW });
    const d = dom(r.html);
    expect(d.querySelectorAll('h2 strong')).toHaveLength(0);
    expect(d.querySelectorAll('a strong')).toHaveLength(0);
  });

  it('AUCUN candidat prouvable → rien n\'est posé, et c\'est DIT', () => {
    // Poser un gras arbitraire pour faire le compte remplacerait un défaut
    // mesurable par un défaut invisible.
    const html = '<h2>La série TV Amazon</h2><p>Le tournage reste suspendu, sans '
      + 'remplaçant annoncé pour le moment.</p>';
    const r = weaveKeywordBold(html, { targetKeyword: KW });
    expect(r.placed).toEqual([]);
    expect(r.sansCandidat).toEqual(['La série TV Amazon']);
    expect(r.html).toBe(html);
    expect(boldReportLine(r)).toMatch(/à la main/);
  });

  it('no-op strict sans mot-clé', () => {
    const html = '<h2>Titre</h2><p>Un texte sans mot-clé cible.</p>';
    expect(weaveKeywordBold(html, {}).html).toBe(html);
    expect(weaveKeywordBold('', { targetKeyword: KW }).placed).toEqual([]);
  });

  it('IDEMPOTENT : repasser sur sa propre sortie ne change rien', () => {
    const html = '<h2>Section</h2><p>L\'ordre de sortie et l\'ordre chronologique.</p>';
    const un = weaveKeywordBold(html, { targetKeyword: KW });
    const deux = weaveKeywordBold(un.html, { targetKeyword: KW });
    expect(deux.placed).toEqual([]);
    expect(deux.html).toBe(un.html);
  });

  it('ne modifie ni le texte ni les liens', () => {
    const html = '<h2>Section</h2><p>Voir l\'ordre de sortie sur '
      + '<a href="https://exemple.fr/x">ce guide</a> complet.</p>';
    const r = weaveKeywordBold(html, { targetKeyword: KW });
    // Le texte lisible est identique au caractère près.
    expect(dom(r.html).textContent).toBe(dom(html).textContent);
    // Le lien est intact (règle 8).
    expect(dom(r.html).querySelector('a').getAttribute('href')).toBe('https://exemple.fr/x');
  });
});

describe('compte rendu', () => {
  it('nomme les termes posés et les sections laissées à la main', () => {
    const ligne = boldReportLine({
      placed: [{ terme: 'ordre de sortie', section: 'A' }],
      sansCandidat: ['La série TV Amazon'],
    });
    expect(ligne).toContain('ordre de sortie');
    expect(ligne).toContain('La série TV Amazon');
  });

  it('rien à dire → chaîne vide, aucune ligne de bruit', () => {
    expect(boldReportLine({})).toBe('');
    expect(boldReportLine({ placed: [], sansCandidat: [] })).toBe('');
  });
});
