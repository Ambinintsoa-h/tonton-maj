// ── Les trois constats posés après génération, calibrés sur du RÉEL ────────────
//
// Chaque seuil et chaque cas de ce fichier vient d'une mesure faite le 2026-08-17
// sur un article réellement généré en production (« Toiture en bac acier »,
// 1 636 mots, 9 H2). Pas de cas d'école : les chiffres sont ceux constatés.
/* eslint-env jest */
import {
  phrasesTropLongues, MOTS_MAX_PHRASE, retireHorsProse, phrasesDeProse,
  suroptimisationMotCle, MAX_H2_AVEC_MOT_CLE, elisionsOrphelines,
  detectStylePatterns,
} from './stylePatterns';

const LONGUE_31 = 'Le bac acier reste competitif face a la tuile beton, autour de soixante a cent euros le metre carre, et il tient aussi devant l ardoise naturelle bien plus couteuse.';
const COURTE = 'Le prix reste contenu.';

describe('compteur de phrases longues — un tableau n\'est PAS une phrase', () => {
  // Le compteur annonçait 9 phrases trop longues sur cet article, dont « une de
  // 96 mots » qui était le TABLEAU comparatif aplati par texteDe. Le vrai
  // chiffre était 5. Le rédacteur cherchait des phrases inexistantes.
  const TABLEAU = '<table><tr><th>Type</th><th>Prix pose EUR m2</th><th>Duree de vie</th></tr>'
    + '<tr><td>Acier galvanise</td><td>quarante a soixante</td><td>trente a cinquante ans</td></tr>'
    + '<tr><td>Acier laque</td><td>cinquante a quatre-vingts</td><td>quarante a soixante ans</td></tr></table>';

  test('un tableau ne produit aucune phrase trop longue', () => {
    expect(phrasesTropLongues(TABLEAU)).toEqual([]);
  });

  test('une liste à puces non plus', () => {
    const liste = '<ul><li>acier galvanise quarante euros</li><li>acier laque cinquante euros</li>'
      + '<li>panneau sandwich quatre-vingts euros</li><li>joint debout cent euros</li></ul>';
    expect(phrasesTropLongues(liste)).toEqual([]);
  });

  test('une FAQ en <details> non plus', () => {
    const faq = `<details><summary>Quel prix ?</summary><p>${LONGUE_31}</p></details>`;
    expect(phrasesTropLongues(faq)).toEqual([]);
  });

  test('mais une VRAIE phrase longue dans la prose est bien comptée', () => {
    const r = phrasesTropLongues(`<p>${LONGUE_31}</p>`);
    expect(r).toHaveLength(1);
    expect(r[0].mots).toBeGreaterThan(MOTS_MAX_PHRASE);
  });

  test('prose + tableau : SEULE la prose compte', () => {
    const r = phrasesTropLongues(`<p>${LONGUE_31}</p>${TABLEAU}<p>${COURTE}</p>`);
    expect(r).toHaveLength(1);
  });

  test('le JSON-LD de la FAQ ne compte pas', () => {
    // Sinon il produit une « phrase » de 167 mots — mesuré.
    const ld = '<script type="application/ld+json">{"@context":"https://schema.org","@type":"FAQPage","mainEntity":[{"@type":"Question","name":"Quel prix pour une toiture en bac acier en 2026 dans le nord de la France"}]}</script>';
    expect(phrasesTropLongues(ld)).toEqual([]);
  });

  test('le panneau de relecture annonce le décompte SUR LA PROSE', () => {
    const rapport = detectStylePatterns(`<p>${LONGUE_31}</p>${TABLEAU}`);
    const regle = rapport.findings.find((f) => f.id === 'phrases');
    expect(regle.count).toBe(1);
    expect(regle.hint).toMatch(/tableaux, listes et FAQ exclus/);
  });

  test('retireHorsProse conserve la prose et retire le reste', () => {
    const h = `<p>Gardé.</p>${TABLEAU}<ul><li>Retiré</li></ul>`;
    expect(retireHorsProse(h)).toContain('Gardé');
    expect(retireHorsProse(h)).not.toContain('Acier galvanise');
    expect(phrasesDeProse('<p>Une phrase de test bien formée.</p>')).toHaveLength(1);
  });
});

describe('suroptimisation du mot-clé', () => {
  const MC = 'toiture en bac acier';
  const h2 = (t) => `<h2>${t}</h2><p>Du texte de section.</p>`;

  test('8 H2 sur 9 portant la forme exacte : excès signalé', () => {
    // Le cas réel, en réduit. C'est ce chiffre qui trahit, pas la densité.
    const html = [
      h2('Prix d\'une toiture en bac acier'),
      h2('Pose d\'une toiture en bac acier'),
      h2('Entretien d\'une toiture en bac acier'),
      h2('Isolation'),
    ].join('');
    const r = suroptimisationMotCle(html, MC);
    expect(r.h2Total).toBe(4);
    expect(r.h2AvecMotCle).toBe(3);
    expect(r.excesH2).toBe(3 - MAX_H2_AVEC_MOT_CLE);
  });

  test('dans la borne : aucun excès', () => {
    const html = h2(`Prix d'une ${MC}`) + h2('Pose et fixation') + h2('Entretien du toit');
    expect(suroptimisationMotCle(html, MC).excesH2).toBe(0);
  });

  test('la densité est calculée sur le texte, pas sur le HTML', () => {
    const r = suroptimisationMotCle(`<p>Une ${MC} coute cher.</p>`, MC);
    expect(r.exact).toBe(1);
    expect(r.densite).toBeGreaterThan(0);
    expect(r.densite).toBeLessThanOrEqual(100);
  });

  test('le mot-clé coupé par une balise est tout de même compté', () => {
    // « toiture en <strong>bac acier</strong> » : texteDe insère une espace, le
    // motif à espaces souples l'absorbe.
    expect(suroptimisationMotCle('<p>une toiture en <strong>bac acier</strong> neuve</p>', MC).exact).toBe(1);
  });

  test('PIÈGE DU REGEX GLOBAL — chaque H2 est testé, pas un sur deux', () => {
    // Un regex avec `g` réutilisé avec .test() garde son lastIndex : il aurait
    // compté 2 H2 au lieu de 4 ici.
    const html = [h2(`A ${MC}`), h2(`B ${MC}`), h2(`C ${MC}`), h2(`D ${MC}`)].join('');
    expect(suroptimisationMotCle(html, MC).h2AvecMotCle).toBe(4);
  });

  test('sans mot-clé, aucun constat plutôt qu\'une division par zéro', () => {
    expect(suroptimisationMotCle('<p>x</p>', '')).toEqual(
      { exact: 0, densite: 0, h2Total: 0, h2AvecMotCle: 0, excesH2: 0 },
    );
  });
});

describe('élisions orphelines', () => {
  test('les deux cas RÉELS sont détectés', () => {
    const html = '<p>et face à l\' toiture en ardoise, entre deux prix.</p><p>L\' Isolation indispensable.</p>';
    const r = elisionsOrphelines(html);
    expect(r).toHaveLength(2);
    expect(r.join(' ')).toMatch(/l'\s+toiture/i);
  });

  test('une élision NORMALE n\'est pas signalée', () => {
    expect(elisionsOrphelines("<p>l'ardoise et l'acier de l'année.</p>")).toEqual([]);
  });

  test('l\'apostrophe typographique est traitée comme la droite', () => {
    expect(elisionsOrphelines('<p>face à l’ toiture</p>')).toHaveLength(1);
  });

  test('un tableau n\'est pas inspecté — pas de faux positif sur une cellule', () => {
    expect(elisionsOrphelines('<table><tr><td>l\' acier</td></tr></table>')).toEqual([]);
  });
});
