/**
 * Verrou : « Ne jamais mettre des : [à vérifier] etc. » (consigne d'Andrianina).
 *
 * Le défaut était MESURÉ. Sur la génération du 19/08/2026, l'article portait trois
 * `[à vérifier]` — alors que l'audit avait mis en action P1 « Lever les mentions
 * [à vérifier] restées dans le texte publié », et que cette action était COCHÉE.
 * Le modèle a lu la consigne, puis en a écrit trois de plus.
 */
import {
  stripUncertaintyMarkers, hasUncertaintyMarker, uncertaintyReportLine,
} from './uncertaintyMarkers';

describe('les marqueurs de doute sont retirés', () => {
  // La phrase EXACTE relevée en production.
  const REEL = '<p>Faye, connue sous le nom de Laufey la Juste, se réveille dans une contrée '
    + 'mal identifiée après sa mort, un lieu que Sony n\'a pas encore détaillé [à vérifier].</p>';

  it('retire le marqueur sans laisser d\'espace avant le point', () => {
    const r = stripUncertaintyMarkers(REEL);
    expect(r.html).not.toMatch(/\[à vérifier\]/i);
    // Sans le recollage : « détaillé .</p> », visible à l'écran comme en ligne.
    expect(r.html).toContain('n\'a pas encore détaillé.</p>');
    expect(r.html).not.toMatch(/\s\./);
  });

  it('reconnaît les variantes, accent et espaces compris', () => {
    [
      '[à vérifier]', '[a verifier]', '[ à  vérifier ]', '[à confirmer]',
      '[à sourcer]', '[non vérifié]', '[non confirmés]', '[source ?]',
      '[sources à trouver]', '[citation needed]', '[TODO]', '[?]',
    ].forEach((m) => {
      const html = `<p>Une affirmation avancée ici ${m}.</p>`;
      const r = stripUncertaintyMarkers(html);
      expect(r.removed.length).toBeGreaterThanOrEqual(1);
      expect(r.html).toBe('<p>Une affirmation avancée ici.</p>');
    });
  });

  it('un marqueur SEUL entre parenthèses n\'y laisse pas des parenthèses vides', () => {
    const r = stripUncertaintyMarkers('<p>Le score serait de 64/100 ([à vérifier]).</p>');
    expect(r.html).toBe('<p>Le score serait de 64/100.</p>');
  });

  it('un marqueur en MILIEU de phrase ne laisse pas de double espace', () => {
    const r = stripUncertaintyMarkers('<p>Le chiffre [à vérifier] vient de Sony.</p>');
    expect(r.html).toBe('<p>Le chiffre vient de Sony.</p>');
  });
});

describe('ce qu\'on ne touche PAS', () => {
  it('les crochets LÉGITIMES sont conservés', () => {
    // Une liste « tout ce qui est entre crochets » abîmerait le texte pour
    // appliquer une règle de forme.
    [
      '<p>God of War [2018] reste le plus gros succès.</p>',
      '<p>Il écrit « la meilleure épreuve » [sic] dans son test.</p>',
      '<p>Le tableau [voir ci-dessous] résume les trois ordres.</p>',
      '<p>Un tableau JSON : data[0] et data[1].</p>',
    ].forEach((html) => {
      const r = stripUncertaintyMarkers(html);
      expect(r.removed).toEqual([]);
      expect(r.html).toBe(html);
    });
  });

  it('un texte sans marqueur ressort IDENTIQUE, à l\'octet', () => {
    // Aucun recollage d'espaces sur un texte qu'on n'avait pas à modifier.
    const html = '<p>Une phrase  avec   des espaces volontaires .</p>';
    expect(stripUncertaintyMarkers(html).html).toBe(html);
  });

  it('no-op sur le vide', () => {
    expect(stripUncertaintyMarkers('').removed).toEqual([]);
    expect(stripUncertaintyMarkers(null).html).toBe('');
  });
});

describe('le doute est REMONTÉ, jamais masqué', () => {
  it('la phrase concernée est nommée', () => {
    // Retirer la marque en silence rendrait le doute invisible : la phrase
    // resterait, l'avertissement disparaîtrait, et l'article partirait en ligne
    // avec une affirmation que personne n'a vérifiée.
    const r = stripUncertaintyMarkers(
      '<p>Le score atteint 64/100 [à vérifier]. La suite est sourcée.</p>',
    );
    expect(r.removed).toHaveLength(1);
    expect(r.removed[0].marker).toBe('[à vérifier]');
    expect(r.removed[0].sentence).toContain('64/100');
    // La phrase suivante, elle, n'est pas remontée.
    expect(r.removed[0].sentence).not.toContain('La suite est sourcée');
  });

  it('la ligne de compte rendu nomme le marqueur ET la phrase', () => {
    const r = stripUncertaintyMarkers('<p>Le score atteint 64/100 [à vérifier].</p>');
    const ligne = uncertaintyReportLine(r.removed);
    expect(ligne).toContain('[à vérifier]');
    expect(ligne).toContain('64/100');
    expect(ligne).toMatch(/À VÉRIFIER/);
  });

  it('rien retiré → aucune ligne de bruit', () => {
    expect(uncertaintyReportLine([])).toBe('');
    expect(uncertaintyReportLine(null)).toBe('');
  });

  it('hasUncertaintyMarker répond sans rien modifier', () => {
    expect(hasUncertaintyMarker('un texte [à vérifier] ici')).toBe(true);
    expect(hasUncertaintyMarker('God of War [2018]')).toBe(false);
    // Appels répétés : les regex globales ne doivent pas garder leur lastIndex.
    expect(hasUncertaintyMarker('un texte [à vérifier] ici')).toBe(true);
    expect(hasUncertaintyMarker('un texte [à vérifier] ici')).toBe(true);
  });
});

describe('les TROIS marqueurs de la génération réelle partent en un passage', () => {
  it('compte et retire les trois', () => {
    const html = '<p>Un lieu que Sony n\'a pas encore détaillé [à vérifier].</p>'
      + '<p>Le tournage serait suspendu [à vérifier].</p>'
      + '<li>Score de 64/100 [à vérifier]</li>';
    const r = stripUncertaintyMarkers(html);
    expect(r.removed).toHaveLength(3);
    expect(r.html).not.toMatch(/vérifier\]/);
    expect(uncertaintyReportLine(r.removed)).toMatch(/^⚠️ 3 marqueur/);
  });
});
