// Phase 3 : relier visuellement l'article (à gauche) et les suggestions (à droite).
// Sans repère, le rédacteur devait chercher le passage à l'œil dans 2 900 mots.
// Exigence : ce qui n'est pas retrouvé est SIGNALÉ, jamais ignoré en silence.
/* eslint-env jest */
import { markSuggestions, MARK_CLASS, MARK_CLASS_OK } from './markSuggestions';

const ART = '<h2>Prix de la toiture</h2>'
  + '<p>Comptez 60 EUR le mètre carré en 2026.</p>'
  + '<p>La pente minimale est de 5 % selon le DTU.</p>'
  + '<ul><li>Acier laqué</li><li>Zinc</li></ul>';

// ── DEUX suggestions dans LE MÊME paragraphe ──────────────────────────────────
// La limite qui restait après #293 : le repli marquait tout le bloc, donc il
// refusait un bloc portant déjà un repère, et la SECONDE suggestion était
// déclarée « introuvable » alors que son texte était bien là. On marque désormais
// la PORTION EXACTE, même quand elle traverse des balises inline.
describe('deux suggestions dans le même paragraphe', () => {
  const P2 = '<p>Le prix <em>moyen</em> atteint 60 EUR. La pose <strong>complète</strong> dure trois jours.</p>';

  test('les DEUX sont repérées, aucune déclarée introuvable', () => {
    const r = markSuggestions(P2, [
      { original: 'Le prix moyen atteint 60 EUR.' },
      { original: 'La pose complète dure trois jours.' },
    ]);
    expect(r.marked).toEqual([1, 2]);
    expect(r.missed).toEqual([]);
    expect(r.html).toContain('data-sugg="1"');
    expect(r.html).toContain('data-sugg="2"');
  });

  test('chaque repère porte SA portion, pas tout le paragraphe', () => {
    const r = markSuggestions(P2, [
      { original: 'Le prix moyen atteint 60 EUR.' },
      { original: 'La pose complète dure trois jours.' },
    ]);
    const box = document.createElement('div');
    box.innerHTML = r.html;
    const marques = [...box.querySelectorAll(`.${MARK_CLASS}`)];
    expect(marques).toHaveLength(2);
    // Aucune marque ne couvre le paragraphe entier.
    marques.forEach((m) => {
      expect(m.textContent.length).toBeLessThan(box.textContent.length);
    });
    expect(marques[0].textContent).toContain('60 EUR');
    expect(marques[1].textContent).toContain('trois jours');
  });

  test('les repères ne s\'imbriquent pas l\'un dans l\'autre', () => {
    const r = markSuggestions(P2, [
      { original: 'Le prix moyen atteint 60 EUR.' },
      { original: 'La pose complète dure trois jours.' },
    ]);
    const box = document.createElement('div');
    box.innerHTML = r.html;
    box.querySelectorAll(`.${MARK_CLASS}`).forEach((m) => {
      expect(m.querySelector(`.${MARK_CLASS}`)).toBeNull();
    });
  });

  test('un passage coupé par un `<br>` est repéré sur sa portion', () => {
    const r = markSuggestions('<p>Le prix moyen<br>atteint 60 EUR. Autre chose ici.</p>',
      [{ original: 'Le prix moyen atteint 60 EUR.' }]);
    expect(r.marked).toEqual([1]);
    expect(r.missed).toEqual([]);
  });
});

describe('repérage dans un seul nœud texte', () => {
  test('le passage est encadré et porte le numéro de la liste', () => {
    const r = markSuggestions(ART, [{ original: 'Comptez 60 EUR le mètre carré en 2026.' }]);
    expect(r.marked).toEqual([1]);
    expect(r.missed).toEqual([]);
    expect(r.html).toContain(`class="${MARK_CLASS}"`);
    expect(r.html).toContain('data-sugg="1"');
    expect(r.html).toContain('id="sugg-1"');
  });

  test('deux suggestions reçoivent DEUX numéros distincts', () => {
    const r = markSuggestions(ART, [
      { original: 'Comptez 60 EUR le mètre carré en 2026.' },
      { original: 'La pente minimale est de 5 % selon le DTU.' },
    ]);
    expect(r.marked).toEqual([1, 2]);
    expect(r.html).toContain('data-sugg="1"');
    expect(r.html).toContain('data-sugg="2"');
  });

  test('le texte de l\'article est préservé', () => {
    const r = markSuggestions(ART, [{ original: 'Comptez 60 EUR le mètre carré en 2026.' }]);
    const sansBalises = r.html.replace(/<[^>]*>/g, '');
    expect(sansBalises).toContain('Comptez 60 EUR le mètre carré en 2026.');
    expect(sansBalises).toContain('Acier laqué');
  });

  test('les apostrophes typographiques ne font pas échouer la correspondance', () => {
    const html = '<p>L’isolation de la toiture est obligatoire.</p>';
    const r = markSuggestions(html, [{ original: "L'isolation de la toiture est obligatoire." }]);
    expect(r.marked).toEqual([1]);
  });

  test('les espaces multiples sont tolérés', () => {
    const html = '<p>Comptez   60   EUR   le   mètre carré.</p>';
    const r = markSuggestions(html, [{ original: 'Comptez 60 EUR le mètre carré.' }]);
    expect(r.marked).toEqual([1]);
  });
});

describe('repli sur le bloc quand le passage chevauche des balises', () => {
  test('un passage coupé par du gras est repéré sur sa PORTION, pas sur le bloc', () => {
    // Comportement changé : on marquait tout le <p> (classe posée dessus), on
    // encadre maintenant la portion exacte dans un <mark> À L'INTÉRIEUR du <p>.
    // C'est ce qui permet à deux suggestions de cohabiter dans un paragraphe.
    const html = '<p>Le prix atteint <strong>180 EUR</strong> le mètre carré posé.</p>';
    const r = markSuggestions(html, [{ original: 'Le prix atteint 180 EUR le mètre carré posé.' }]);
    expect(r.marked).toEqual([1]);
    expect(r.html).toContain(`<mark class="${MARK_CLASS}"`);
    expect(r.html).toContain('data-sugg="1"');
    expect(r.html).toContain('<strong>180 EUR</strong>'); // le balisage interne survit
    // Le <p> lui-même ne porte plus la classe.
    const box = document.createElement('div');
    box.innerHTML = r.html;
    expect(box.querySelector('p').classList.contains(MARK_CLASS)).toBe(false);
  });

  test('un passage dans une cellule de tableau est repéré', () => {
    const html = '<table><tbody><tr><td>Acier : 60 à 90 EUR</td></tr></tbody></table>';
    const r = markSuggestions(html, [{ original: 'Acier : 60 à 90 EUR' }]);
    expect(r.marked).toEqual([1]);
  });
});

describe('ce qui n\'est pas retrouvé est SIGNALÉ', () => {
  test('un passage absent de l\'article part dans missed', () => {
    const r = markSuggestions(ART, [{ original: 'Ce texte ne figure nulle part dans l\'article.' }]);
    expect(r.marked).toEqual([]);
    expect(r.missed).toEqual([1]);
  });

  // Un ajout pur n'a RIEN à repérer : ce n'est pas un echec, et le confondre
  // avec un passage introuvable faisait lire une anomalie la ou tout va bien.
  test('une suggestion SANS passage d\'origine (un ajout pur) part dans ajouts, pas dans missed', () => {
    const r = markSuggestions(ART, [{ updated: 'Nouveau paragraphe à ajouter.' }]);
    expect(r.ajouts).toEqual([1]);
    expect(r.missed).toEqual([]);
    expect(r.marked).toEqual([]);
  });

  test('les deux causes sont distinguees dans le meme lot', () => {
    const r = markSuggestions(ART, [
      { original: 'La pente minimale est de 5 % selon le DTU.' },  // repere
      { updated: 'Un paragraphe entierement nouveau.' },            // ajout pur
      { original: 'Cette phrase ne figure pas dans l\'article.' },  // introuvable
    ]);
    expect(r.marked).toEqual([1]);
    expect(r.ajouts).toEqual([2]);
    expect(r.missed).toEqual([3]);
  });

  test('numérotation conservée quand certaines échouent — le n°2 reste le n°2', () => {
    const r = markSuggestions(ART, [
      { original: 'Introuvable ici.' },
      { original: 'La pente minimale est de 5 % selon le DTU.' },
      { original: 'Introuvable aussi.' },
    ]);
    expect(r.marked).toEqual([2]);
    expect(r.missed).toEqual([1, 3]);
    expect(r.html).toContain('data-sugg="2"');
  });
});

// Une suggestion acceptée doit se voir A GAUCHE, en vert : sinon le passage
// traité restait surligné en rouge « à remplacer », impossible de distinguer ce
// qui était fait de ce qui restait à arbitrer.
describe('suggestions déjà appliquées (surlignage vert)', () => {
  // Le texte de gauche est mis à jour en même temps (appliquerSuggestionObsolescence) :
  // on cherche donc le NOUVEAU texte, pas l'ancien.
  const APPLIQUE = '<h2>Prix de la toiture</h2>'
    + '<p>Comptez 75 EUR le mètre carré en 2027.</p>'
    + '<p>La pente minimale est de 5 % selon le DTU.</p>';
  const SUGG = {
    original: 'Comptez 60 EUR le mètre carré en 2026.',
    updated: 'Comptez 75 EUR le mètre carré en 2027.',
  };

  test('le passage appliqué est repéré sur son NOUVEAU texte, en vert, même numéro', () => {
    const r = markSuggestions(APPLIQUE, [SUGG], [0]);
    expect(r.marked).toEqual([1]);
    expect(r.missed).toEqual([]);
    expect(r.html).toContain(MARK_CLASS_OK);
    expect(r.html).toContain('data-sugg="1"');
    expect(r.html).toContain('id="sugg-1"');
  });

  test('la classe rouge reste posée : elle porte la pastille et la garde anti-imbrication', () => {
    const r = markSuggestions(APPLIQUE, [SUGG], [0]);
    expect(r.html).toContain(`${MARK_CLASS} ${MARK_CLASS_OK}`);
  });

  // LE piège : sans la liste des appliquées, l'ancien texte est introuvable (il
  // vient d'être remplacé) et l'écran criait « passage introuvable » sur la
  // suggestion qu'on venait justement d'appliquer.
  test('sans la liste des appliquées, la même suggestion partirait à tort dans missed', () => {
    expect(markSuggestions(APPLIQUE, [SUGG]).missed).toEqual([1]);
    expect(markSuggestions(APPLIQUE, [SUGG], [0]).missed).toEqual([]);
  });

  test('une appliquée introuvable des DEUX côtés ne déclenche AUCUNE alerte', () => {
    const r = markSuggestions(ART, [{
      original: 'Ancienne phrase absente de cet article.',
      updated: 'Nouvelle phrase absente elle aussi.',
    }], [0]);
    expect(r.missed).toEqual([]);
    expect(r.marked).toEqual([]);
    expect(r.ajouts).toEqual([]);
  });

  // Le volet de gauche est un instantané figé : il arrive qu'il n'ait pas pu être
  // réécrit (passage retouché à la main entre-temps). Le repère doit quand même
  // passer au vert plutôt que de disparaître — sinon la suggestion traitée perd
  // son numéro et redevient invisible.
  test('repli sur l\'ancien texte quand l\'instantané n\'a pas pu être réécrit', () => {
    const r = markSuggestions(ART, [SUGG], [0]);   // ART porte encore l'ANCIEN texte
    expect(r.marked).toEqual([1]);
    expect(r.missed).toEqual([]);
    expect(r.html).toContain(MARK_CLASS_OK);
    expect(r.html).toContain('data-sugg="1"');
  });

  test('le balisage de la suggestion n\'empêche pas de la retrouver', () => {
    const r = markSuggestions(
      '<p>Comptez 75 EUR le mètre carré en 2027.</p>',
      [{ original: 'peu importe', updated: '<p>Comptez <strong>75 EUR</strong> le mètre carré en 2027.</p>' }],
      [0],
    );
    expect(r.marked).toEqual([1]);
    expect(r.html).toContain(MARK_CLASS_OK);
  });

  // Suppression pure : le passage a été retiré du texte. Il n'y a plus rien à
  // repérer, et surtout rien à SIGNALER — ce n'est ni un ajout ni une anomalie.
  test('appliquée sans texte de remplacement : ni ajout, ni anomalie', () => {
    const r = markSuggestions(
      '<p>La pente minimale est de 5 % selon le DTU.</p>',
      [{ original: 'Comptez 60 EUR le mètre carré en 2026.' }],
      [0],
    );
    expect(r.ajouts).toEqual([]);
    expect(r.missed).toEqual([]);
    expect(r.marked).toEqual([]);
  });

  test('appliquées et restantes cohabitent, chacune sa couleur et son numéro', () => {
    const r = markSuggestions(APPLIQUE, [
      SUGG,                                                        // appliquée → verte
      { original: 'La pente minimale est de 5 % selon le DTU.' },  // à arbitrer → rouge
    ], [0]);
    expect(r.marked).toEqual([1, 2]);
    expect(r.missed).toEqual([]);
    expect((r.html.match(new RegExp(MARK_CLASS_OK, 'g')) || []).length).toBe(1);
    expect(r.html).toContain('data-sugg="2"');
  });

  test('une portion traversant du gras est marquée en vert elle aussi', () => {
    const r = markSuggestions(
      '<p>Le prix atteint <strong>210 EUR</strong> le mètre carré posé.</p>',
      [{ original: 'ancien', updated: 'Le prix atteint 210 EUR le mètre carré posé.' }],
      [0],
    );
    expect(r.marked).toEqual([1]);
    expect(r.html).toContain(MARK_CLASS_OK);
    expect(r.html).toContain('<strong>210 EUR</strong>');   // le balisage interne survit
  });

  test('liste d\'appliquées dégénérée : comportement d\'origine, sans planter', () => {
    const attendu = markSuggestions(ART, [{ original: 'Comptez 60 EUR le mètre carré en 2026.' }]);
    expect(markSuggestions(ART, [{ original: 'Comptez 60 EUR le mètre carré en 2026.' }], null)).toEqual(attendu);
    expect(markSuggestions(ART, [{ original: 'Comptez 60 EUR le mètre carré en 2026.' }], 'pas un tableau')).toEqual(attendu);
  });
});

describe('robustesse', () => {
  test('deux suggestions sur le MÊME passage : la seconde ne se greffe pas dans la première', () => {
    const s = 'Comptez 60 EUR le mètre carré en 2026.';
    const r = markSuggestions(ART, [{ original: s }, { original: s }]);
    expect(r.marked).toEqual([1]);      // la 2e ne retrouve plus d'ancre libre
    expect(r.missed).toEqual([2]);
    expect((r.html.match(/data-sugg=/g) || []).length).toBe(1);
  });

  test('aucune suggestion → HTML rendu à l\'identique', () => {
    expect(markSuggestions(ART, []).html).toBe(ART);
    expect(markSuggestions(ART).html).toBe(ART);
  });

  test('entrées dégénérées', () => {
    expect(markSuggestions('', [{ original: 'x' }])).toEqual({ html: '', marked: [], missed: [], ajouts: [] });
    expect(markSuggestions(null, null).html).toBe('');
    expect(() => markSuggestions(ART, 'pas un tableau')).not.toThrow();
  });
});
