/* eslint-env jest */
/**
 * Blocs ajoutés par le thème — incident ludikbazar.com du 13/10/2026.
 *
 * Fixtures reprises de la page réelle (structure GeneratePress/GenerateBlocks,
 * placements « ludik-* », encart « 🔥 Nous recommandons Philibert ») et de son
 * `content.rendered` (API REST), qui ne contient PAS l'encart.
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const { retirerBlocsInjectes, urlsRestWordPress, estPageWordPress } = require('./injectedBlocks');

const ENCART = `<div class="gb-element-ddbbdc52">
<p class="wp-block-paragraph"><strong>🔥 Nous recommandons Philibert</strong></p>
<p class="wp-block-paragraph">Avec plus de 40 000 références,&nbsp;<a href="https://c3po.link/QZgVSzsYAg">Philibert</a>&nbsp;est l’endroit où vous trouverez le jeu de société qui vous convient. Entre amis ou en famille, des centaines d’heures de joie en perspective avec les jeux de chez Philibert.</p>
<a class="gb-text gb-text-4704ba4f" href="https://c3po.link/QZgVSzsYAg">J'en profite</a>
</div>`;

const PLACEMENT = '<div id="ludik-1" class="ludik-avant-le-contenu ludik-entity-placement"><div class="prefG-container">Suivez LUDIKBAZAR.COM <a href="https://profile.google.com/cp/x">Discover</a></div></div>';

const CORPS = [
  '<p><strong><em>Le Puissance 4 ressemble à un jeu d’enfant, mais il cache une arme redoutable : une stratégie mathématiquement prouvée.</em></strong></p>',
  '<p>Deux couleurs, une grille verticale, une mission claire. Il faut aligner quatre jetons avant son adversaire, et la colonne centrale décide souvent de la partie.</p>',
  '<h2>La colonne centrale, clé de la partie</h2>',
  '<p>Le joueur qui débute par la colonne centrale garde l’avantage dans la majorité des configurations étudiées par les mathématiciens qui ont résolu le jeu.</p>',
  '<p>Chaque coup posé au centre multiplie les alignements possibles, alors qu’un coup au bord en ouvre beaucoup moins.</p>',
  // Suite de l'article : un vrai article fait plusieurs milliers de caractères,
  // et le garde-fou des 40 % se mesure sur ce total.
  ...Array.from({ length: 8 }, (_, i) => `<p>Paragraphe ${i + 1} de la suite : le joueur anticipe les menaces adverses, bloque les alignements de trois jetons et prépare une double menace que l’adversaire ne pourra pas parer au tour suivant.</p>`),
].join('\n');

// Copie enregistrée par une MAJ précédente : mêmes textes, en paragraphes ordinaires (avec gras).
const COPIE = [
  '<p><strong>🔥 Nous recommandons Philibert</strong></p>',
  '<p>Avec <strong>plus de 40 000 références</strong>, <a href="https://c3po.link/QZgVSzsYAg">Philibert</a> est l’endroit où vous trouverez le jeu de société qui vous convient. Entre amis ou en famille, des <strong>centaines d’heures</strong> de joie en perspective avec les jeux de chez Philibert.</p>',
  '<p class="lien-connexe"><strong>À lire aussi :</strong> <a href="https://ludikbazar.com/jeux-de-reflexion/">jeux de réflexion</a>.</p>',
  '<p><a href="https://c3po.link/QZgVSzsYAg">J’en profite</a></p>',
].join('\n');

const page = (contenu) => new JSDOM(`<!doctype html><html><head><link rel="stylesheet" href="/wp-content/themes/gp/style.css"></head><body><article><div class="entry-content">${contenu}</div></article></body></html>`).window.document;
const texte = (doc) => doc.querySelector('.entry-content').textContent.replace(/\s+/g, ' ');

describe('retirerBlocsInjectes — encart du thème', () => {
  test('article neuf : l\'encart du thème est retiré, le reste est intact', () => {
    const doc = page(`${PLACEMENT}<p></p>${ENCART}<p></p>${CORPS}`);
    const r = retirerBlocsInjectes(doc, `${PLACEMENT}${CORPS}`);
    expect(r.ignore).toBeNull();
    expect(r.retires).toEqual([expect.objectContaining({ bloc: 'div.gb-element-ddbbdc52', extrait: expect.stringContaining('Nous recommandons Philibert') })]);
    expect(r.copies).toEqual([]);
    expect(texte(doc)).not.toContain('Nous recommandons Philibert');
    expect(texte(doc)).toContain('La colonne centrale, clé de la partie');
    expect(doc.querySelector('.ludik-avant-le-contenu')).not.toBeNull(); // présent dans le contenu WordPress → laissé
  });

  test('article déjà touché : l\'encart ET sa copie enregistrée sont retirés, le « À lire aussi » ajouté entre les deux reste', () => {
    const doc = page(`${PLACEMENT}<p></p>${ENCART}<p></p>${CORPS.split('\n')[0]}\n${COPIE}\n${CORPS.split('\n').slice(1).join('\n')}`);
    const r = retirerBlocsInjectes(doc, `${PLACEMENT}${CORPS.split('\n')[0]}${COPIE}${CORPS}`);
    expect(r.retires).toHaveLength(1);
    expect(r.copies).toEqual([
      '🔥 Nous recommandons Philibert',
      expect.stringMatching(/^Avec plus de 40 000 références, Philibert est l'endroit/),
      "J'en profite",
    ]);
    expect(texte(doc)).not.toMatch(/Nous recommandons Philibert|J.en profite|40 000 références/);
    expect(texte(doc)).toContain('À lire aussi : jeux de réflexion');
    expect(texte(doc)).toContain('Le Puissance 4 ressemble');
  });

  test('sans encart détecté sur la page, aucune « copie » n\'est retirée (le texte est alors de l\'article)', () => {
    const doc = page(`${CORPS}\n${COPIE}`);
    const r = retirerBlocsInjectes(doc, `${CORPS}${COPIE}`);
    expect(r.retires).toEqual([]);
    expect(r.copies).toEqual([]);
    expect(texte(doc)).toContain('Nous recommandons Philibert');
  });
});

describe('retirerBlocsInjectes — garde-fous', () => {
  test('un bloc ENREGISTRÉ dans l\'article (sa classe figure dans le contenu WordPress) est conservé', () => {
    const doc = page(`${ENCART}${CORPS}`);
    const r = retirerBlocsInjectes(doc, `${ENCART}${CORPS}`);
    expect(r.retires).toEqual([]);
    expect(texte(doc)).toContain('Nous recommandons Philibert');
  });

  test('un habillage de vidéo ajouté par un plugin (iframe, pas de texte) n\'est jamais retiré', () => {
    const video = '<div class="rll-youtube-player"><iframe src="https://www.youtube.com/embed/x"></iframe>Lire la vidéo du tutoriel complet</div>';
    const doc = page(`${CORPS}${video}`);
    retirerBlocsInjectes(doc, CORPS);
    expect(doc.querySelector('iframe')).not.toBeNull();
  });

  test('un bloc sans classe ni id, ou sans texte, est laissé', () => {
    const doc = page(`<div>Bloc sans aucune classe mais avec du texte assez long</div><div class="pub-vide"></div>${CORPS}`);
    const r = retirerBlocsInjectes(doc, CORPS);
    expect(r.retires).toEqual([]);
    expect(doc.querySelector('.pub-vide')).not.toBeNull();
  });

  test('contenu WordPress bien plus court que la page (constructeur de page) : on s\'abstient', () => {
    const doc = page(`${ENCART}${CORPS}`);
    const r = retirerBlocsInjectes(doc, '<p>Résumé.</p>');
    expect(r.retires).toEqual([]);
    expect(r.ignore).toMatch(/trop différent/);
    expect(texte(doc)).toContain('Nous recommandons Philibert');
  });

  test('retrait refusé s\'il emportait plus de 40 % du texte', () => {
    const gros = '<div class="theme-injecte">' + 'Texte du thème très long. '.repeat(80) + '</div>';
    const doc = page(`${gros}${CORPS}`);
    const r = retirerBlocsInjectes(doc, CORPS + '<p>' + 'complément '.repeat(200) + '</p>');
    expect(r.retires).toEqual([]);
    expect(r.ignore).toMatch(/retrait refusé/);
  });

  test('pas de contenu WordPress, ou pas de .entry-content : rien ne bouge', () => {
    expect(retirerBlocsInjectes(page(`${ENCART}${CORPS}`), '').ignore).toMatch(/indisponible/);
    const sans = new JSDOM(`<body><main>${ENCART}${CORPS}</main></body>`).window.document;
    expect(retirerBlocsInjectes(sans, CORPS).ignore).toMatch(/entry-content/);
  });
});

describe('urlsRestWordPress / estPageWordPress', () => {
  test('construit les adresses posts puis pages à partir du slug', () => {
    expect(urlsRestWordPress('https://ludikbazar.com/reussite-carte-strategies-et-astuces/?utm_source=x')).toEqual([
      'https://ludikbazar.com/wp-json/wp/v2/posts?slug=reussite-carte-strategies-et-astuces&_fields=id,content',
      'https://ludikbazar.com/wp-json/wp/v2/pages?slug=reussite-carte-strategies-et-astuces&_fields=id,content',
    ]);
    expect(urlsRestWordPress('https://site.fr/')).toEqual([]);
    expect(urlsRestWordPress('pas une url')).toEqual([]);
  });

  test('ne déclenche l\'appel API que sur une page WordPress', () => {
    expect(estPageWordPress('<link href="/wp-content/themes/x.css">')).toBe(true);
    expect(estPageWordPress('<html><body>Site statique</body></html>')).toBe(false);
  });
});

describe('VERROU proxy.js — branchement dans /api/scrape', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'proxy.js'), 'utf8');
  test('le retrait se fait sur le DOM brut, AVANT Readability', () => {
    const route = src.slice(src.indexOf("app.post('/api/scrape'"));
    const iRetrait = route.indexOf('retirerBlocsInjectes(dom.window.document');
    const iReadability = route.indexOf('new Readability(dom.window.document');
    expect(iRetrait).toBeGreaterThan(-1);
    expect(iReadability).toBeGreaterThan(iRetrait);
  });
  test('la réponse du scraping signale ce qui a été retiré', () => {
    expect(src).toMatch(/injected:\s+blocsInjectes,/);
  });
});
