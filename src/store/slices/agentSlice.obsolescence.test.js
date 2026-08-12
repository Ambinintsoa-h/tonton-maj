// Phase 3 — chaîne COMPLÈTE « accepter une suggestion » : reducer → repérage.
// Les tests de markSuggestions partent d'un HTML écrit à la main ; ils ne
// prouvent pas que le texte RÉELLEMENT produit par le reducer se repère encore.
// C'est pourtant là que se joue la fausse alerte « passage cité mais
// INTROUVABLE » : le reducer réécrit `texteVerifie`, donc l'`original` cité par
// l'agent n'y est plus. Sans la liste des appliquées, la suggestion qu'on vient
// d'accepter serait annoncée en anomalie — exactement à l'envers de la réalité.
/* eslint-env jest */
import reducer, { setObsolescenceReport, appliquerSuggestionObsolescence } from './agentSlice';
import { markSuggestions, MARK_CLASS_OK } from '../../utils/markSuggestions';

const SUGGS = [
  { original: 'Comptez 60 EUR le mètre carré en 2026.', updated: '<p>Comptez 75 EUR le mètre carré en 2027.</p>' },
  { original: 'La pente minimale est de 5 % selon le DTU.', updated: 'La pente minimale est de 8 % selon le DTU 40.' },
];
const TEXTE = '<h2>Prix</h2>'
  + '<p>Comptez 60 EUR le mètre carré en 2026.</p>'
  + '<p>La pente minimale est de 5 % selon le DTU.</p>';

/** Rejoue le parcours réel : rapport posé, puis N acceptations. */
const apresAcceptations = (indices) => {
  let etat = reducer(undefined, setObsolescenceReport({ suggestions: SUGGS, texteVerifie: TEXTE, at: 1 }));
  indices.forEach((i) => {
    etat = reducer(etat, appliquerSuggestionObsolescence({
      index: i, avant: SUGGS[i].original, apres: SUGGS[i].updated,
    }));
  });
  return etat.obsolescenceReport;
};

describe('phase 3 — accepter une suggestion, du reducer au repérage', () => {
  test('la suggestion acceptée passe au VERT et ne part JAMAIS en anomalie', () => {
    const r = apresAcceptations([0]);
    const vue = markSuggestions(r.texteVerifie, SUGGS, r.appliquees);
    expect(vue.missed).toEqual([]);          // la fausse alerte, précisément
    expect(vue.marked).toEqual([1, 2]);
    const doc = document.createElement('div');
    doc.innerHTML = vue.html;
    expect(doc.querySelector('#sugg-1').classList.contains(MARK_CLASS_OK)).toBe(true);
    expect(doc.querySelector('#sugg-1').textContent).toContain('75 EUR');
    // Celle qui reste garde son numéro ET sa couleur d'origine.
    expect(doc.querySelector('#sugg-2').classList.contains(MARK_CLASS_OK)).toBe(false);
  });

  test('sans la liste des appliquées, ce même texte déclencherait l\'alerte', () => {
    const r = apresAcceptations([0]);
    expect(markSuggestions(r.texteVerifie, SUGGS).missed).toEqual([1]);
  });

  test('accepter dans le DÉSORDRE ne décale pas les numéros', () => {
    const r = apresAcceptations([1, 0]);
    expect(r.appliquees).toEqual([1, 0]);
    const vue = markSuggestions(r.texteVerifie, SUGGS, r.appliquees);
    expect(vue.missed).toEqual([]);
    expect(vue.marked).toEqual([1, 2]);
  });

  test('un même index accepté deux fois n\'est compté qu\'une fois', () => {
    const r = apresAcceptations([0, 0]);
    expect(r.appliquees).toEqual([0]);
    // Le second passage ne doit pas non plus réécrire le texte une seconde fois.
    expect(r.texteVerifie.match(/75 EUR/g)).toHaveLength(1);
    expect(r.texteVerifie).not.toContain('60 EUR');
  });

  test('relancer la vérification REMET le compteur à zéro', () => {
    let etat = reducer(undefined, setObsolescenceReport({ suggestions: SUGGS, texteVerifie: TEXTE }));
    etat = reducer(etat, appliquerSuggestionObsolescence({ index: 0, avant: SUGGS[0].original, apres: SUGGS[0].updated }));
    expect(etat.obsolescenceReport.appliquees).toEqual([0]);
    etat = reducer(etat, setObsolescenceReport({ suggestions: SUGGS, texteVerifie: TEXTE, at: 2 }));
    expect(etat.obsolescenceReport.appliquees).toBeUndefined();
    // Et le repérage repart bien en rouge sur les deux.
    const vue = markSuggestions(etat.obsolescenceReport.texteVerifie, SUGGS, etat.obsolescenceReport.appliquees);
    expect(vue.html).not.toContain(MARK_CLASS_OK);
  });

  test('rapport absent : accepter ne fait rien et ne jette pas', () => {
    const etat = reducer(undefined, setObsolescenceReport(null));
    expect(() => reducer(etat, appliquerSuggestionObsolescence({ index: 0, avant: 'x', apres: 'y' }))).not.toThrow();
    expect(reducer(etat, appliquerSuggestionObsolescence({ index: 0, avant: 'x', apres: 'y' })).obsolescenceReport).toBeNull();
  });

  test('passage absent de l\'instantané : l\'index est retenu, le texte intact', () => {
    // L'éditeur et l'instantané peuvent diverger. L'index doit quand même être
    // retenu — c'est l'ÉDITEUR qui a été modifié, et la ligne de droite ne doit
    // pas revenir proposer un « Accepter » qui ne pourrait que rééchouer.
    let etat = reducer(undefined, setObsolescenceReport({ suggestions: SUGGS, texteVerifie: '<p>Rien de commun.</p>' }));
    etat = reducer(etat, appliquerSuggestionObsolescence({ index: 0, avant: SUGGS[0].original, apres: SUGGS[0].updated }));
    expect(etat.obsolescenceReport.texteVerifie).toBe('<p>Rien de commun.</p>');
    expect(etat.obsolescenceReport.appliquees).toEqual([0]);
  });

  test('le texte de remplacement n\'est pas interprété comme motif ($&, $\')', () => {
    const T = '<p>Le tarif ABC est fixé.</p>';
    let etat = reducer(undefined, setObsolescenceReport({ suggestions: [], texteVerifie: T }));
    etat = reducer(etat, appliquerSuggestionObsolescence({ index: 0, avant: 'ABC', apres: "$& $' $$" }));
    expect(etat.obsolescenceReport.texteVerifie).toBe("<p>Le tarif $& $' $$ est fixé.</p>");
  });
});
