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

describe('exportAsHtml — les diffs EN ATTENTE ne sont jamais publiés', () => {
  it("supprime un bloc AJOUTÉ non accepté (<ins class=\"added-content\">)", () => {
    const src = '<p>Avant.</p><ins class="added-content"><p>Résumé de l\'article ajouté par IA.</p></ins><p>Après.</p>';
    const out = exportAsHtml(src);
    expect(out).not.toContain('Résumé de l\'article');
    expect(out).toContain('<p>Avant.</p>');
    expect(out).toContain('<p>Après.</p>');
  });

  it('restaure le texte ORIGINAL pour un remplacement en attente (paire del+mark)', () => {
    const src = '<p>Prix : <del class="deleted-content">100 EUR</del><mark class="updated-content">150 EUR</mark> posé.</p>';
    const out = exportAsHtml(src);
    expect(out).toContain('100 EUR');       // l'original est conservé
    expect(out).not.toContain('150 EUR');   // le nouveau texte non accepté ne sort pas
  });

  it('conserve le texte d\'une suppression en attente (del seul)', () => {
    const src = '<p>Texte <del class="deleted-content">encore visible</del> fin.</p>';
    const out = exportAsHtml(src);
    expect(out).toContain('encore visible');
    expect(out).not.toContain('<del');
  });

  it('débalise un <mark> de diff orphelin sans perdre son texte', () => {
    const src = '<p>Un <mark class="updated-content">texte orphelin</mark> ici.</p>';
    const out = exportAsHtml(src);
    expect(out).toContain('texte orphelin');
    expect(out).not.toContain('updated-content');
  });

  it('préserve les surlignages manuels (mark.manual-highlight)', () => {
    const src = '<p><mark class="manual-highlight" style="background-color:#fef08a">important</mark></p>';
    const out = exportAsHtml(src);
    expect(out).toMatch(/<mark[^>]*>important<\/mark>/);
  });

  it('supprime les résidus barrés dégénérés (span.deleted-content)', () => {
    const src = '<p>Ok <span class="deleted-content">barré résiduel</span> fin.</p>';
    const out = exportAsHtml(src);
    expect(out).not.toContain('barré résiduel');
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
