/**
 * « Passage introuvable — il a déjà été modifié depuis l'analyse. »
 *
 * Signalé par Andrianina en acceptant une correction « Adverbes en -ment ».
 * Ce n'était pas le gras : `texteDe` remplace CHAQUE balise par une espace, donc
 * un titre non ponctué se collait au premier paragraphe de sa section. L'extrait
 * produit — « Isolants Le PUR est réellement efficace. » — n'existait dans AUCUN
 * bloc du document, et `findBlockForPassage` ne pouvait pas le situer.
 *
 * Ce fichier vérifie le CONTRAT qui compte : tout extrait proposé au rédacteur
 * doit être replaçable dans le DOM. Sans lui, la phase 4 propose des corrections
 * qu'elle est incapable d'appliquer.
 */
import { detectStylePatterns } from './stylePatterns';
import { replacePassageInDom } from './locatePassage';

const ARTICLE = ''
  + '<h2>Les isolants minéraux</h2>'
  + '<p>Le polyuréthane projeté est réellement efficace sur les bruits aériens.</p>'
  + '<h2>Ce que ça coûte</h2>'
  + '<p>Le tarif varie fortement selon la surface traitée et la hauteur disponible.</p>';

const replacable = (html, extrait) => {
  const d = document.createElement('div');
  d.innerHTML = html;
  return replacePassageInDom(d, extrait, 'REMPLACÉ').ok;
};

describe('tout extrait proposé est replaçable dans le DOM', () => {
  it('les adverbes en -ment sont détectés, et leur phrase est localisable', () => {
    const r = detectStylePatterns(ARTICLE);
    const adv = r.findings.find((f) => f.id === 'adverbes');
    expect(adv).toBeDefined();
    expect(adv.count).toBeGreaterThan(0);
    adv.exemples.forEach((ex) => {
      expect(replacable(ARTICLE, ex.extrait)).toBe(true);
    });
  });

  it('AUCUN extrait, quelle que soit la règle, ne colle un titre à un paragraphe', () => {
    const r = detectStylePatterns(ARTICLE);
    r.findings.forEach((f) => {
      // La règle des titres cite volontairement le titre : elle est hors sujet ici.
      if (f.id === 'titres') return;
      f.exemples.forEach((ex) => {
        expect(ex.extrait).not.toContain('Les isolants minéraux Le polyuréthane');
        expect(ex.extrait).not.toContain('Ce que ça coûte Le tarif');
      });
    });
  });

  it('tous les extraits de toutes les règles sont replaçables', () => {
    const r = detectStylePatterns(ARTICLE);
    const nonReplacables = [];
    r.findings.forEach((f) => {
      if (f.id === 'titres') return;          // cite un titre, pas un passage de prose
      f.exemples.forEach((ex) => {
        if (!replacable(ARTICLE, ex.extrait)) nonReplacables.push(`${f.id} : ${ex.extrait}`);
      });
    });
    expect(nonReplacables).toEqual([]);
  });

  it('un titre n\'est plus compté comme une phrase analysée', () => {
    // Deux paragraphes, deux phrases. Les deux H2 ne sont pas des phrases : les
    // compter gonflait le total affiché au rédacteur.
    expect(detectStylePatterns(ARTICLE).phrases).toBe(2);
  });

  it('le gras interne ne gêne pas la localisation', () => {
    // Ce que le rédacteur soupçonnait. R5 pose des <strong> dans la prose, et
    // `replacePassageInDom` traverse le balisage : ce n'était pas la cause.
    const avecGras = '<h2>Isolants</h2><p>Le <strong>polyuréthane projeté</strong> est réellement efficace ici.</p>';
    const r = detectStylePatterns(avecGras);
    const adv = r.findings.find((f) => f.id === 'adverbes');
    expect(adv).toBeDefined();
    adv.exemples.forEach((ex) => expect(replacable(avecGras, ex.extrait)).toBe(true));
  });
});
