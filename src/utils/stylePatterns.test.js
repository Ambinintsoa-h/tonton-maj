// Phase 4 : détection des patterns d'écriture IA, d'après le skill
// « Style d'écriture (équipe) ». Exigence : chaque anomalie remonte avec un
// EXTRAIT du texte réel — le rédacteur juge sur pièce, pas sur un compteur.
/* eslint-env jest */
import { detectStylePatterns, texteDe, phrasesDe } from './stylePatterns';

const par = (t) => `<p>${t}</p>`;
const trouve = (html, id) => detectStylePatterns(html).findings.find(f => f.id === id);

describe('texteDe / phrasesDe', () => {
  test('les balises tombent et les mots ne fusionnent pas', () => {
    expect(texteDe('<h2>Le prix</h2><p>Comptez 60 EUR.</p>')).toBe('Le prix Comptez 60 EUR.');
  });

  test('script et style sont retirés avec leur contenu', () => {
    expect(texteDe('<p>Visible.</p><script>var cache = 1;</script>')).toBe('Visible.');
  });

  test('les phrases de moins de trois mots sont ignorées', () => {
    expect(phrasesDe('Oui. Le prix du bac acier reste stable. Non.')).toEqual(['Le prix du bac acier reste stable.']);
  });
});

describe('verbes interdits', () => {
  test('« offre » est détecté avec son extrait — le cas réel du 10 août', () => {
    const f = trouve(par('Open Spoken AI offre une interface simple pour les créateurs.'), 'verbes');
    expect(f.count).toBe(1);
    expect(f.exemples[0].terme).toBe('offre');
    expect(f.exemples[0].extrait).toMatch(/Open Spoken AI offre/);
  });

  test('plusieurs verbes distincts comptent séparément', () => {
    const f = trouve(par('Le bac acier reste léger. Son atout repose sur le poids. Il devient courant.'), 'verbes');
    expect(f.count).toBe(3);
  });

  test('les formes pronominales à apostrophe typographique sont vues', () => {
    expect(trouve(par('Le zinc s’impose sur les toits parisiens.'), 'verbes').count).toBe(1);
  });

  test('un mot qui CONTIENT un verbe interdit n\'est pas un faux positif', () => {
    // « restent » est interdit, « restaurant » et « restauration » ne le sont pas
    expect(trouve(par('La restauration du restaurant avance bien.'), 'verbes')).toBeUndefined();
  });

  test('texte propre → aucune anomalie de ce type', () => {
    expect(trouve(par('Le couvreur pose les plaques en deux jours.'), 'verbes')).toBeUndefined();
  });
});

describe('participe présent', () => {
  test('détecté et signalé avec la reformulation attendue', () => {
    const f = trouve(par('Un matériau léger, permettant de réduire la charge.'), 'participes');
    expect(f.count).toBe(1);
    expect(f.hint).toMatch(/verbe conjugué/);
  });

  test('« représentant » comme NOM reste détecté — c\'est au rédacteur de trancher', () => {
    // Assumé : la détection est lexicale. Mieux vaut un signalement de trop,
    // relu en deux secondes, qu'un participe présent publié.
    expect(trouve(par('Le représentant du fabricant passe demain.'), 'participes').count).toBe(1);
  });
});

describe('voix passive', () => {
  test('« est indexée par » est détecté — l\'exemple même du skill', () => {
    const f = trouve(par('La page est indexée par Google en quelques heures.'), 'passive');
    expect(f.count).toBe(1);
  });

  test('un simple attribut n\'est PAS une passive', () => {
    // Sans agent introduit par « par », « est élevé » est un attribut : le
    // signaler noierait le rédacteur de faux positifs.
    expect(trouve(par('Le prix est élevé cette année.'), 'passive')).toBeUndefined();
    expect(trouve(par('La toiture est ancienne.'), 'passive')).toBeUndefined();
  });

  test('les temps composés sont couverts', () => {
    expect(trouve(par('Le devis a été validé par le client.'), 'passive').count).toBe(1);
  });
});

describe('adverbes en -ment', () => {
  test('un adverbe est détecté', () => {
    expect(trouve(par('Le prix varie fortement selon la région.'), 'adverbes').count).toBe(1);
  });

  test('les NOMS en -ment ne sont pas comptés comme adverbes', () => {
    const html = par('Le traitement du bâtiment et son isolement relèvent du financement du logement.');
    expect(trouve(html, 'adverbes')).toBeUndefined();
  });
});

describe('phrases trop longues', () => {
  test('au-delà de 20 mots, la phrase est remontée, la plus longue d\'abord', () => {
    const courte = 'Le bac acier dure longtemps.';
    const longue = 'Le bac acier ' + Array(25).fill('mot').join(' ') + ' fin.';
    const tresLongue = 'Le zinc ' + Array(40).fill('mot').join(' ') + ' fin.';
    const f = trouve(par(`${courte} ${longue} ${tresLongue}`), 'phrases');
    expect(f.count).toBe(2);
    expect(f.exemples[0].mots).toBeGreaterThan(f.exemples[1].mots);   // tri décroissant
    expect(f.hint).toMatch(/sur 3 phrases/);
  });

  test('exactement 20 mots passe (borne incluse)', () => {
    expect(trouve(par(Array(20).fill('mot').join(' ') + '.'), 'phrases')).toBeUndefined();
  });
});

describe('tirets, clichés, méta-commentaires', () => {
  test('cadratin et demi-cadratin sont tous deux signalés', () => {
    expect(trouve(par('Le prix — variable — dépend du toit.'), 'cadratins').count).toBe(1);
    expect(trouve(par('Le prix – variable – dépend du toit.'), 'cadratins').count).toBe(1);
  });

  test('un trait d\'union normal n\'est pas un cadratin', () => {
    expect(trouve(par('Le sur-mesure coûte plus cher.'), 'cadratins')).toBeUndefined();
  });

  test('clichés du skill détectés', () => {
    const f = trouve(par("À l'ère du numérique, il est crucial de comparer les devis."), 'cliches');
    expect(f.count).toBe(2);
  });

  test('méta-commentaires détectés', () => {
    expect(trouve(par('Il est important de noter que le DTU impose 1 %.'), 'meta').count).toBe(1);
    expect(trouve(par('Dans cet article, nous allons voir les prix.'), 'meta').count).toBeGreaterThanOrEqual(2);
  });
});

describe('parenthèses et titres', () => {
  test('deux parenthèses dans un paragraphe → signalé', () => {
    expect(trouve(par('Le bac acier (léger) résiste au gel (jusqu\'à -20 °C).'), 'parentheses').count).toBe(1);
  });

  test('une seule parenthèse est autorisée', () => {
    expect(trouve(par('Le bac acier (léger) résiste au gel.'), 'parentheses')).toBeUndefined();
  });

  test('un titre de plus de 10 mots est signalé, avec son niveau', () => {
    const html = '<h2>Comment l’alternative Venice AI 2026 redéfinit-elle le marché face à speak ai ?</h2>';
    const f = trouve(html, 'titres');
    expect(f.count).toBe(1);
    expect(f.exemples[0].extrait).toMatch(/^H2 — /);
  });

  test('un titre court passe', () => {
    expect(trouve('<h2>Prix du bac acier en 2026</h2>', 'titres')).toBeUndefined();
  });
});

describe('bilan global', () => {
  test('un article propre ne remonte rien', () => {
    const propre = '<h2>Prix du bac acier</h2>' + par('Le couvreur pose les plaques en deux jours. Comptez 60 EUR le m².');
    const r = detectStylePatterns(propre);
    expect(r.findings).toHaveLength(0);
    expect(r.total).toBe(0);
    expect(r.phrases).toBe(2);
  });

  test('le total agrège les décomptes de chaque règle', () => {
    const sale = par('Le bac acier offre un atout — permettant de réduire la charge — et il est indexé par Google.');
    const r = detectStylePatterns(sale);
    expect(r.total).toBe(r.findings.reduce((n, f) => n + f.count, 0));
    expect(r.findings.length).toBeGreaterThanOrEqual(3);
  });

  test('entrées dégénérées → aucun crash', () => {
    [undefined, null, '', '   ', '<p></p>', 42, {}].forEach((v) => {
      expect(() => detectStylePatterns(v)).not.toThrow();
    });
    expect(detectStylePatterns('').findings).toHaveLength(0);
  });

  test('chaque anomalie porte un libellé, un conseil et au moins un extrait', () => {
    const r = detectStylePatterns(par('Le bac acier offre un atout, permettant de réduire la charge fortement.'));
    expect(r.findings.length).toBeGreaterThan(0);
    r.findings.forEach((f) => {
      expect(f.label).toBeTruthy();
      expect(f.hint).toBeTruthy();
      expect(f.exemples.length).toBeGreaterThan(0);
      expect(f.exemples[0].extrait).toBeTruthy();
    });
  });
});
