// Tests de l'export HTML de publication — anti-<br> parasites (wpautop)
/* eslint-env jest */
import { exportAsHtml } from './export';

describe('exportAsHtml — retours à la ligne inter-blocs (anti wpautop)', () => {
  it('supprime les \\n entre blocs (plus de <br> parasites au rendu WordPress)', () => {
    const src = '<p>Un</p>\n<p>Deux</p>\n\n<h2>Titre</h2>\n<ul>\n<li>A</li>\n<li>B</li>\n</ul>';
    const out = exportAsHtml(src);
    expect(out).not.toMatch(/\n/);           // plus aucun saut de ligne inter-balises
    expect(out).toContain('</p><p>');
    expect(out).toContain('</h2><ul>');
    expect(out).toContain('</li><li>');
  });

  it('retire les \\n entre le conteneur responsive et le tableau', () => {
    const src = '<div data-tt-table-wrap="1" style="overflow-x:auto">\n\n\n<table><tbody><tr><td>x</td></tr></tbody></table></div>';
    const out = exportAsHtml(src);
    expect(out).toContain('><table>'); // le \n entre le wrap et la table est retiré
    expect(out).not.toMatch(/\n/);
  });

  it('préserve les espaces entre éléments INLINE (mots non collés)', () => {
    const src = '<p><strong>gras</strong> <em>italique</em> fin</p>';
    const out = exportAsHtml(src);
    expect(out).toContain('</strong> <em>'); // l'espace inline reste
  });
});

describe('exportAsHtml — thème inline des accordéons FAQ', () => {
  it('enveloppe la question du <summary> dans un <h3> inline stylé', () => {
    const src = '<h2>FAQ</h2><details><summary>Quelle durée de vie ?</summary><p>Environ 30 ans.</p></details>';
    const out = exportAsHtml(src);
    expect(out).toMatch(/<summary[^>]*><h3[^>]*>Quelle durée de vie \?<\/h3><\/summary>/);
    expect(out).toMatch(/<h3[^>]*style="[^"]*display:\s*inline/);
  });

  it('conserve le heading existant du <summary> (pas de double enveloppe)', () => {
    const src = '<details><summary><h3>Déjà un h3 ?</h3></summary><p>Oui.</p></details>';
    const out = exportAsHtml(src);
    expect(out.match(/<h3/g)).toHaveLength(1);
    expect(out).toMatch(/<h3[^>]*>Déjà un h3 \?<\/h3>/);
  });

  it('applique le thème carte au <details> et au <summary> (styles inline)', () => {
    const src = '<details><summary>Q ?</summary><p>R.</p></details>';
    const out = exportAsHtml(src);
    expect(out).toMatch(/<details[^>]*style="[^"]*border:\s*1px solid/);
    expect(out).toMatch(/<details[^>]*style="[^"]*border-radius/);
    expect(out).toMatch(/<summary[^>]*style="[^"]*cursor:\s*pointer/);
  });

  it('remplace les styles/classes parasites des details par le thème', () => {
    const src = '<details class="wp-block" style="background:red"><summary style="color:lime">Q ?</summary><p>R.</p></details>';
    const out = exportAsHtml(src);
    expect(out).not.toContain('red');
    expect(out).not.toContain('lime');
    expect(out).not.toContain('wp-block');
  });

  it('englobe les réponses texte/inline orphelines dans un <p>', () => {
    const src = '<details><summary>Q ?</summary>Réponse nue avec du <b>gras</b>.</details>';
    const out = exportAsHtml(src);
    expect(out).toMatch(/<\/summary><p[^>]*>Réponse nue avec du <b>gras<\/b>\.<\/p>/);
  });

  it('laisse intacts les blocs de réponse existants (p, ul) en les stylant', () => {
    const src = '<details><summary>Q ?</summary><p>Un.</p><ul><li>A</li></ul></details>';
    const out = exportAsHtml(src);
    expect(out).toMatch(/<p[^>]*style="[^"]*padding:\s*0\.2em 1em/);
    expect(out).toMatch(/<ul[^>]*style="[^"]*padding:\s*0\.2em 1em 0\.8em/); // dernier bloc
  });
});
