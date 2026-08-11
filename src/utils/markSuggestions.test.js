// Phase 3 : relier visuellement l'article (à gauche) et les suggestions (à droite).
// Sans repère, le rédacteur devait chercher le passage à l'œil dans 2 900 mots.
// Exigence : ce qui n'est pas retrouvé est SIGNALÉ, jamais ignoré en silence.
/* eslint-env jest */
import { markSuggestions, MARK_CLASS } from './markSuggestions';

const ART = '<h2>Prix de la toiture</h2>'
  + '<p>Comptez 60 EUR le mètre carré en 2026.</p>'
  + '<p>La pente minimale est de 5 % selon le DTU.</p>'
  + '<ul><li>Acier laqué</li><li>Zinc</li></ul>';

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
  test('un passage coupé par du gras est repéré au niveau du bloc', () => {
    const html = '<p>Le prix atteint <strong>180 EUR</strong> le mètre carré posé.</p>';
    const r = markSuggestions(html, [{ original: 'Le prix atteint 180 EUR le mètre carré posé.' }]);
    expect(r.marked).toEqual([1]);
    expect(r.html).toContain(`class="${MARK_CLASS}"`);   // classe posée sur le <p>
    expect(r.html).toContain('data-sugg="1"');
    expect(r.html).toContain('<strong>180 EUR</strong>'); // le balisage interne survit
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
