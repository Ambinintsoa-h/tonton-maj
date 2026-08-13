/**
 * R3 — TOUS LES LIENS EN DOFOLLOW
 *
 * Deux verrous, une seule politique :
 *   1. ingestion WordPress  — proxy.js / processWpHtml (bloc inline entre les
 *      marqueurs R3-DOFOLLOW-WP). C'est la seule porte d'entrée d'un nofollow
 *      dans l'outil (le chemin scraping supprime déjà tout rel via KEEP_ATTRS).
 *   2. avant publication    — src/utils/export.js / stripFollowBlockers, appelé
 *      par exportAsHtml, point de passage OBLIGATOIRE de tout ce qui sort.
 *
 * Politique : on retire "nofollow", "ugc" ET "sponsored" — décision explicite
 * d'Andrianina (« tous, internes et externes »). Les liens externes de ces
 * articles SONT les articles sponsorisés, payants : conserver un rel="sponsored"
 * posé par WordPress retirerait au client ce qu'il a acheté. On CONSERVE
 * "noopener"/"noreferrer" (sécurité navigateur, pas des directives de suivi) et
 * tout jeton inconnu. rel supprimé s'il ne reste rien ; rel NON réécrit si rien
 * n'est à retirer.
 *
 * proxy.js ne peut pas être require() ici (il démarre le serveur), et le code
 * doit rester inline dans proxy.js (aucun nouveau module racine : la liste SCP
 * du déploiement est explicite). On extrait donc le bloc de proxy.js entre ses
 * marqueurs et on le rejoue — le test porte sur le TEXTE RÉELLEMENT DÉPLOYÉ.
 */
import fs from 'fs';
import path from 'path';
import { stripFollowBlockers, exportAsHtml, exportAsMarkdown } from './export';

// ── Récupération du verrou d'ingestion réellement présent dans proxy.js ───────
const PROXY_PATH = path.join(__dirname, '..', '..', 'proxy.js');
const proxySrc = fs.readFileSync(PROXY_PATH, 'utf8');

const extractWpLock = () => {
  const m = proxySrc.match(
    /\/\* R3-DOFOLLOW-WP:START \*\/([\s\S]*?)\/\* R3-DOFOLLOW-WP:END \*\//
  );
  if (!m) {
    throw new Error(
      'Verrou R3 absent de proxy.js : les marqueurs R3-DOFOLLOW-WP:START/END ' +
      'sont introuvables. Le nofollow de WordPress rentrerait à nouveau intact.'
    );
  }
  // eslint-disable-next-line no-new-func
  return new Function(`${m[1]}\nreturn normalizeRelDofollowWp;`)();
};

const wpNormalize = extractWpLock();

// Applique un normaliseur à un fragment et rend le HTML sérialisé.
const run = (fn, html) => {
  const div = document.createElement('div');
  div.innerHTML = html;
  fn(div);
  return div.innerHTML;
};

// ── Table de cas PARTAGÉE par les deux implémentations ───────────────────────
// [ intitulé, entrée, sortie attendue ]
const CASES = [
  [
    'nofollow est retiré',
    '<p><a href="/guide">a</a><a href="/b" rel="nofollow">b</a></p>',
    '<p><a href="/guide">a</a><a href="/b">b</a></p>',
  ],
  [
    'ugc est retiré',
    '<p><a href="/b" rel="ugc">b</a></p>',
    '<p><a href="/b">b</a></p>',
  ],
  [
    'sponsored est RETIRÉ (les liens externes sont les articles PAYANTS : le client a acheté du dofollow)',
    '<p><a href="/b" rel="sponsored">b</a></p>',
    '<p><a href="/b">b</a></p>',
  ],
  [
    'nofollow ET sponsored tombent ensemble → attribut supprimé',
    '<p><a href="/b" rel="nofollow sponsored">b</a></p>',
    '<p><a href="/b">b</a></p>',
  ],
  [
    'noopener et noreferrer sont conservés',
    '<p><a href="https://ext.fr/x" rel="noopener noreferrer">x</a></p>',
    '<p><a href="https://ext.fr/x" rel="noopener noreferrer">x</a></p>',
  ],
  [
    'rel="nofollow" seul → attribut rel SUPPRIMÉ',
    '<p><a href="/b" rel="nofollow">b</a></p>',
    '<p><a href="/b">b</a></p>',
  ],
  [
    'rel="nofollow noopener" → rel="noopener"',
    '<p><a href="/b" rel="nofollow noopener">b</a></p>',
    '<p><a href="/b" rel="noopener">b</a></p>',
  ],
  [
    'casse et espaces multiples : REL="NoFollow   UGC" → attribut supprimé',
    '<p><a href="/b" REL="NoFollow   UGC">b</a></p>',
    '<p><a href="/b">b</a></p>',
  ],
  [
    'casse mixte : "Sponsored" est retiré comme "sponsored" (comparaison insensible à la casse)',
    '<p><a href="/b" rel="Sponsored   NOFOLLOW">b</a></p>',
    '<p><a href="/b">b</a></p>',
  ],
  [
    'casse mixte : la casse des jetons CONSERVÉS n\'est pas modifiée',
    '<p><a href="/b" rel="NoOpener   NOFOLLOW">b</a></p>',
    '<p><a href="/b" rel="NoOpener">b</a></p>',
  ],
  [
    'lien sans rel : intact',
    '<p><a href="/b" target="_blank">b</a></p>',
    '<p><a href="/b" target="_blank">b</a></p>',
  ],
  [
    'rien à retirer → attribut NON réécrit (espacement d\'origine préservé)',
    '<p><a href="/b" rel="  noopener   noreferrer  ">b</a></p>',
    '<p><a href="/b" rel="  noopener   noreferrer  ">b</a></p>',
  ],
  [
    'jeton inconnu conservé, nofollow retiré',
    '<p><a href="/b" rel="nofollow me tag">b</a></p>',
    '<p><a href="/b" rel="me tag">b</a></p>',
  ],
  [
    'lien EXTERNE : href et ancre inchangés, seul nofollow tombe',
    '<p>Voir <a href="https://ademe.fr/guide?a=1&amp;b=2" rel="nofollow noopener">le guide ADEME</a>.</p>',
    '<p>Voir <a href="https://ademe.fr/guide?a=1&amp;b=2" rel="noopener">le guide ADEME</a>.</p>',
  ],
  [
    'plusieurs liens, traitement indépendant',
    '<p><a href="/a" rel="nofollow">a</a> <a href="/b" rel="sponsored">b</a> <a href="/c">c</a></p>',
    '<p><a href="/a">a</a> <a href="/b">b</a> <a href="/c">c</a></p>',
  ],
  [
    'le rel d\'un non-<a> n\'est jamais touché (structurant)',
    '<div><link rel="nofollow stylesheet" href="/x.css"></div>',
    '<div><link rel="nofollow stylesheet" href="/x.css"></div>',
  ],
  [
    'fragment sans aucun lien : inchangé',
    '<p>Texte simple.</p>',
    '<p>Texte simple.</p>',
  ],
];

describe('R3 — export.js / stripFollowBlockers (filet avant publication)', () => {
  CASES.forEach(([label, input, expected]) => {
    it(label, () => {
      expect(run(stripFollowBlockers, input)).toBe(expected);
    });
  });

  it('ne plante pas sur null / undefined / objet sans querySelectorAll', () => {
    expect(() => stripFollowBlockers(null)).not.toThrow();
    expect(() => stripFollowBlockers(undefined)).not.toThrow();
    expect(() => stripFollowBlockers({})).not.toThrow();
  });
});

describe('R3 — proxy.js / verrou d\'ingestion WordPress (bloc inline extrait)', () => {
  it('le bloc est bien présent dans proxy.js', () => {
    expect(typeof wpNormalize).toBe('function');
  });

  it('le bloc est bien APPELÉ dans processWpHtml (câblage)', () => {
    expect(proxySrc).toMatch(/normalizeRelDofollowWp\(doc\);/);
  });

  it('aucun nouveau module racine n\'est require par le verrou', () => {
    const block = proxySrc.match(
      /\/\* R3-DOFOLLOW-WP:START \*\/([\s\S]*?)\/\* R3-DOFOLLOW-WP:END \*\//
    )[1];
    expect(block).not.toMatch(/require\s*\(/);
  });

  CASES.forEach(([label, input, expected]) => {
    it(label, () => {
      expect(run(wpNormalize, input)).toBe(expected);
    });
  });

  it('ne plante pas sur null / undefined / objet sans querySelectorAll', () => {
    expect(() => wpNormalize(null)).not.toThrow();
    expect(() => wpNormalize(undefined)).not.toThrow();
    expect(() => wpNormalize({})).not.toThrow();
  });
});

describe('R3 — parité stricte entre le verrou d\'ingestion et celui de publication', () => {
  CASES.forEach(([label, input]) => {
    it(`même résultat des deux côtés : ${label}`, () => {
      expect(run(wpNormalize, input)).toBe(run(stripFollowBlockers, input));
    });
  });
});

describe('R3 — exportAsHtml : tout ce qui est publié est dofollow', () => {
  it('retire nofollow d\'un lien interne posé à la main', () => {
    const html = exportAsHtml('<p>Voir <a href="/tarifs" rel="nofollow">nos tarifs</a>.</p>');
    expect(html).not.toMatch(/nofollow/i);
    expect(html).toContain('href="/tarifs"');
    expect(html).toContain('nos tarifs');
  });

  it('retire ugc ET sponsored, conserve noopener, sur un lien externe payant', () => {
    // Cas RÉEL du modèle d'Andrianina : ce lien externe EST un article sponsorisé
    // payant. Le client a acheté un dofollow — le rel="sponsored" que WordPress
    // pose dessus le lui retire, donc il tombe.
    const html = exportAsHtml(
      '<p>Via <a href="https://partenaire.fr/offre" rel="ugc sponsored noopener">cette offre</a>.</p>'
    );
    expect(html).not.toMatch(/\bugc\b/i);
    expect(html).not.toMatch(/\bsponsored\b/i);
    expect(html).toContain('rel="noopener"');
    expect(html).toContain('href="https://partenaire.fr/offre"');
    expect(html).toContain('cette offre');
  });

  it('un lien déjà dofollow traverse la publication sans modification', () => {
    const html = exportAsHtml('<p><a href="https://ademe.fr/guide" rel="noopener">le guide ADEME</a></p>');
    expect(html).toContain('<a href="https://ademe.fr/guide" rel="noopener">le guide ADEME</a>');
  });

  it('contenu vide ou null : aucun plantage', () => {
    expect(() => exportAsHtml('')).not.toThrow();
    expect(() => exportAsHtml(null)).not.toThrow();
    expect(() => exportAsHtml(undefined)).not.toThrow();
  });
});

describe('R3 — exportAsMarkdown : impact nul (le rel n\'existe pas en markdown)', () => {
  it('rend [ancre](url), avec ou sans nofollow en entrée', () => {
    const avec = exportAsMarkdown('<p><a href="/tarifs" rel="nofollow">nos tarifs</a></p>');
    const sans = exportAsMarkdown('<p><a href="/tarifs">nos tarifs</a></p>');
    expect(avec).toContain('[nos tarifs](/tarifs)');
    expect(avec).toBe(sans);
  });
});
