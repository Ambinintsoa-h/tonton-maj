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
