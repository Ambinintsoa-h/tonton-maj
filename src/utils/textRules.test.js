// Tests des garde-fous de style déterministes (tirets interdits dans le texte généré)
/* eslint-env jest */
import { stripForbiddenDashes, stripForbiddenDashesText, applyStyleGuards } from './textRules';

describe('stripForbiddenDashesText — texte brut', () => {
  it('remplace un tiret cadratin espacé (incise) par un point-virgule', () => {
    expect(stripForbiddenDashesText('sapin autoclave — essence durable : douglas'))
      .toBe('sapin autoclave ; essence durable : douglas');
  });

  it('préserve une plage numérique en la passant au trait d\'union simple', () => {
    expect(stripForbiddenDashesText('la période 2022–2024 fut stable')).toBe('la période 2022-2024 fut stable');
  });

  it('remplace un tiret collé résiduel par une virgule', () => {
    expect(stripForbiddenDashesText('un choix–clé pour durer')).toBe('un choix, clé pour durer');
  });

  it('texte sans tiret interdit → inchangé (même référence)', () => {
    const s = 'Aucun tiret ici, juste un trait-d\'union.';
    expect(stripForbiddenDashesText(s)).toBe(s);
  });
});

describe('stripForbiddenDashes — HTML (titres exclus)', () => {
  it('nettoie les paragraphes mais laisse les titres intacts (convention « FAQ — »)', () => {
    const html = '<h2>FAQ — Questions fréquentes</h2><p>Le douglas — très durable — coûte plus cher.</p>';
    const out = stripForbiddenDashes(html);
    expect(out).toContain('<h2>FAQ — Questions fréquentes</h2>');
    expect(out).toContain('Le douglas ; très durable ; coûte plus cher.');
  });

  it('HTML sans tiret interdit → chaîne d\'origine inchangée', () => {
    const html = '<p>Un texte <strong>propre</strong>.</p>';
    expect(stripForbiddenDashes(html)).toBe(html);
  });

  it('nettoie aussi le texte dans les cellules de tableau et les listes', () => {
    const html = '<table><tbody><tr><td>40-60 € — à vérifier</td></tr></tbody></table>';
    expect(stripForbiddenDashes(html)).toContain('40-60 € ; à vérifier');
  });
});

describe('applyStyleGuards — modifications de l\'agent', () => {
  it('nettoie updated, ne touche JAMAIS original ni anchor (matching)', () => {
    const updates = [{
      type: 'remplacement',
      original: 'texte source — avec tiret (doit rester identique pour le matching)',
      updated: '<p>nouveau texte — plus clair</p>',
      anchor: 'ancre — exacte',
    }];
    const [u] = applyStyleGuards(updates);
    expect(u.original).toBe(updates[0].original);
    expect(u.anchor).toBe(updates[0].anchor);
    expect(u.updated).toContain('nouveau texte ; plus clair');
  });

  it('liste vide / update sans updated → inchangés', () => {
    expect(applyStyleGuards([])).toEqual([]);
    const supp = [{ type: 'suppression', original: 'x — y' }];
    expect(applyStyleGuards(supp)[0]).toBe(supp[0]);
  });
});
