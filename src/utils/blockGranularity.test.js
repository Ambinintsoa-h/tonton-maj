// Garde-fou de GRANULARITÉ des remplacements.
// Symptôme d'origine (mode Refonte, production) : l'article publié devenait un
// mur de paragraphes, sans titre, sans liste, sans tableau. Cause : des `original`
// couvrant plusieurs blocs, remplacés par un seul paragraphe.
/* eslint-env jest */
import { guardBlockGranularity, applyAllDiffs } from './diff';

describe('guardBlockGranularity — ce qui est REFUSÉ', () => {
  test('un titre présent dans original et absent d\'updated → refus', () => {
    const r = guardBlockGranularity({
      original: '<h2>Quel est le coût ?</h2><p>Comptez 60 EUR/m².</p>',
      updated:  '<p>Comptez 60 à 180 EUR/m² installé en 2026.</p>',
    });
    expect(r).toEqual({ ok: false, reason: 'titre-perdu' });
  });

  test('plusieurs blocs fusionnés en un seul paragraphe → refus', () => {
    const r = guardBlockGranularity({
      original: '<p>Premier paragraphe.</p><p>Deuxième paragraphe.</p><p>Troisième.</p>',
      updated:  '<p>Un seul paragraphe qui résume les trois.</p>',
    });
    expect(r).toEqual({ ok: false, reason: 'blocs-fusionnes' });
  });

  test('une liste remplacée par du texte courant → refus', () => {
    const r = guardBlockGranularity({
      original: '<ul><li>Durabilité</li><li>Légèreté</li><li>Prix</li></ul>',
      updated:  '<p>Le bac acier est durable, léger et abordable.</p>',
    });
    expect(r.ok).toBe(false);
  });
});

describe('guardBlockGranularity — ce qui reste AUTORISÉ', () => {
  test('texte brut dans un bloc unique (le cas le plus courant)', () => {
    expect(guardBlockGranularity({
      original: 'elle est très facile à poser et sa légèreté limite la charge ;',
      updated:  'elle se pose facilement et son poids réduit soulage la charpente ;',
    })).toEqual({ ok: true });
  });

  test('un tableau entier réécrit en tableau → légitime, ne pas bloquer', () => {
    const table = (devise) => `<table><thead><tr><th>Matériau</th><th>Prix ${devise}</th></tr></thead>`
      + `<tbody><tr><td>Acier</td><td>55-90</td></tr></tbody></table>`;
    expect(guardBlockGranularity({ original: table('USD'), updated: table('EUR') })).toEqual({ ok: true });
  });

  test('un paragraphe enrichi en titre + paragraphe → autorisé (on ajoute de la structure)', () => {
    expect(guardBlockGranularity({
      original: '<p>Les aides 2026 financent l\'isolation.</p>',
      updated:  '<h2>Aides financières 2026</h2><p>Trois aides financent l\'isolation.</p>',
    })).toEqual({ ok: true });
  });

  test('additions et suppressions ne sont pas concernées', () => {
    expect(guardBlockGranularity({ type: 'addition', updated: '<h2>T</h2><p>x</p>' })).toEqual({ ok: true });
    expect(guardBlockGranularity({ type: 'suppression', original: '<h2>T</h2><p>x</p>' })).toEqual({ ok: true });
  });
});

describe('applyAllDiffs — la structure de l\'article survit', () => {
  const ARTICLE = '<h2>Quel est le coût ?</h2><p>Comptez 60 EUR/m².</p><ul><li>Acier</li><li>Zinc</li></ul>';

  test('le remplacement destructeur est refusé et le titre reste en place', () => {
    const { html, updates } = applyAllDiffs(ARTICLE, [{
      original: '<h2>Quel est le coût ?</h2><p>Comptez 60 EUR/m².</p>',
      updated:  '<p>Comptez 60 à 180 EUR/m² en 2026.</p>',
      reason:   'Actualisation des prix',
    }], 1, 'https://guidedesprix.net/a');

    expect(html).toContain('<h2>Quel est le coût ?</h2>');
    expect(html).toContain('<ul>');
    expect(updates[0].applied).toBe(false);
    expect(updates[0].blockedReason).toBe('titre-perdu');
  });

  test('une correction de texte dans un bloc s\'applique normalement', () => {
    const { html, updates } = applyAllDiffs(ARTICLE, [{
      original: 'Comptez 60 EUR/m².',
      updated:  'Comptez 60 à 180 EUR/m² en 2026.',
      reason:   'Actualisation des prix',
    }], 1, 'https://guidedesprix.net/a');

    expect(updates[0].applied).toBe(true);
    expect(html).toContain('<h2>Quel est le coût ?</h2>');   // titre intact
    expect(html).toContain('180');
  });
});
