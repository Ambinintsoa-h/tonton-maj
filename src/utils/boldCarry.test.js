/**
 * R5 — le gras de l'article d'origine ne disparaît pas à la réécriture.
 * Même famille que la reprise des liens (R1) et des images (R4) : consigne au
 * modèle, PLUS un contrôle déterministe et non bloquant.
 */
import { carryOverBold, listBoldTerms, constatGras } from './boldCarry';

const gras = (html) => (html.match(/<strong>/g) || []).length;

describe('listBoldTerms — ce qui est repris, et ce qui ne l\'est pas', () => {
  it('relève les termes en <strong> et en <b>', () => {
    expect(listBoldTerms('<p>Le <strong>polyuréthane projeté</strong> et la <b>laine de roche</b>.</p>'))
      .toEqual(['polyuréthane projeté', 'laine de roche']);
  });

  it('ignore un gras placé dans un TITRE ou un LIEN', () => {
    // Le prompt interdit ces deux emplacements : les reprendre irait contre la
    // règle qu'on fait respecter.
    expect(listBoldTerms('<h2><strong>Le prix au m2</strong></h2>')).toEqual([]);
    expect(listBoldTerms('<p><a href="/x"><strong>voir le guide</strong></a></p>')).toEqual([]);
  });

  it('ignore un terme trop court ou trop long', () => {
    expect(listBoldTerms('<p><strong>m2</strong></p>')).toEqual([]);
    expect(listBoldTerms('<p><strong>une phrase entière mise en gras sur plus de six mots ici</strong></p>')).toEqual([]);
  });

  it('dédoublonne, casse comprise', () => {
    expect(listBoldTerms('<p><strong>laine de roche</strong> puis <strong>Laine De Roche</strong></p>'))
      .toEqual(['laine de roche']);
  });
});

describe('carryOverBold', () => {
  const AVANT = '<h2>Isolants</h2><p>Le <strong>polyuréthane projeté</strong> tient bien, la <strong>laine de roche</strong> mieux sur les basses fréquences.</p>';

  it('remet en gras un terme que la réécriture a débalisé', () => {
    const apres = '<h2>Isolants</h2><p>Le polyuréthane projeté tient bien. La laine de roche fait mieux sur les basses fréquences.</p>';
    const r = carryOverBold(AVANT, apres);
    expect(r.restored).toEqual(['polyuréthane projeté', 'laine de roche']);
    expect(gras(r.html)).toBe(2);
    expect(r.missing).toEqual([]);
  });

  it('ne double PAS un gras que le modèle a déjà posé', () => {
    const r = carryOverBold(AVANT, AVANT);
    expect(r.restored).toEqual([]);
    expect(r.html).toBe(AVANT);
  });

  it('SIGNALE sans bloquer quand les mots ne figurent plus dans le texte', () => {
    const apres = '<h2>Isolants</h2><p>Le sujet a été entièrement réécrit avec un autre vocabulaire.</p>';
    const r = carryOverBold(AVANT, apres);
    expect(r.restored).toEqual([]);
    expect(r.missing).toHaveLength(2);
    expect(r.html).toBe(apres);          // le texte n'est jamais modifié pour rien
  });

  it('ne pose JAMAIS de gras dans un titre ni dans un lien', () => {
    const avant = '<p>Le <strong>bac acier</strong> est courant.</p>';
    const apres = '<h2>Le bac acier en toiture</h2><p>Voir <a href="/guide">le bac acier</a> pour comparer.</p>';
    const r = carryOverBold(avant, apres);
    const d = document.createElement('div'); d.innerHTML = r.html;
    expect(d.querySelector('h2 strong')).toBeNull();
    expect(d.querySelector('a strong')).toBeNull();
  });

  it('NO-OP STRICT si l\'article d\'origine ne contient aucun gras', () => {
    const apres = '<p>Un texte quelconque.</p>';
    const r = carryOverBold('<p>Rien en gras ici.</p>', apres);
    expect(r).toEqual({ html: apres, restored: [], missing: [] });
  });

  it('plafonne les remises en gras — un article tout en gras ne met rien en avant', () => {
    const termes = Array.from({ length: 30 }, (_, i) => `terme numéro ${i}`);
    const avant = `<p>${termes.map((t) => `<strong>${t}</strong>`).join(' et ')}.</p>`;
    const apres = `<p>${termes.join(' et ')}.</p>`;
    const r = carryOverBold(avant, apres);
    expect(r.restored.length).toBe(20);
    expect(r.missing.length).toBe(10);
  });

  it('une seule occurrence est balisée, pas toutes', () => {
    const avant = '<p>Le <strong>bac acier</strong> partout.</p>';
    const apres = '<p>Le bac acier ici, le bac acier là, et encore le bac acier.</p>';
    const r = carryOverBold(avant, apres);
    expect(gras(r.html)).toBe(1);
  });
});

describe('constatGras — la consigne de gras est enfin MESURÉE', () => {
  const S = (titre, gras) =>
    `<h2>${titre}</h2><p>${Array.from({ length: gras }, (_, i) => `<strong>terme ${i}</strong>`).join(' et ')} du texte autour.</p>`;

  it('compte le gras par section H2 et nomme les DEUX sens de l\'écart', () => {
    // Sous le plancher : section non optimisée. Au-dessus du plafond : le gras ne
    // met plus rien en avant. N'afficher que le manque laisserait passer le second,
    // qui est le plus visible à la lecture.
    const r = constatGras(`${S('Trop peu', 1)}${S('Juste', 3)}${S('Trop', 6)}`);
    expect(r.sections.map((s) => s.gras)).toEqual([1, 3, 6]);
    expect(r.sections.map((s) => s.ecart)).toEqual(['sous', null, 'sur']);
    expect(r.sousPlancher).toBe(1);
    expect(r.surPlafond).toBe(1);
  });

  it('un gras de titre ou de lien ne COMPTE PAS dans la densité', () => {
    // Sinon une faute d'emplacement passerait pour une mise en avant valable, et la
    // section paraîtrait conforme alors qu'elle ne l'est pas.
    const html = '<h2>Le <strong>prix</strong> au m2</h2>'
      + '<p>Voir <a href="/x"><strong>ce guide</strong></a> pour le detail complet.</p>';
    const r = constatGras(html);
    expect(r.sections[0].gras).toBe(0);
    expect(r.sections[0].ecart).toBe('sous');
    expect(r.dansTitre).toBe(1);
    expect(r.dansLien).toBe(1);
  });

  it('signale un gras trop long — ce n\'est plus une mise en avant', () => {
    const html = '<h2>T</h2><p><strong>une phrase entiere mise en gras ne sert a rien</strong> ici.</p>';
    expect(constatGras(html).tropLongs).toBe(1);
  });

  it('le gras AVANT le premier H2 n\'est rattaché à aucune section', () => {
    // Chapô et TL;DR ne relèvent pas d'une règle qui parle de densité « par H2 ».
    const r = constatGras(`<p>Chapo avec <strong>un terme</strong>.</p>${S('Section', 3)}`);
    expect(r.sections).toHaveLength(1);
    expect(r.sections[0].gras).toBe(3);
    expect(r.total).toBe(4);            // le chapô est compté dans le TOTAL, pas dans la section
  });

  it('no-op sur un HTML vide — aucun chiffre inventé', () => {
    expect(constatGras('')).toEqual({
      sections: [], sousPlancher: 0, surPlafond: 0,
      dansTitre: 0, dansLien: 0, tropLongs: 0, total: 0,
    });
  });
});
