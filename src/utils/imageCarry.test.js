// Tests de R4 — LES IMAGES DE L'ARTICLE D'ORIGINE NE DISPARAISSENT PLUS.
// Un verrou sans test n'est pas un verrou : chaque garantie annoncée dans
// src/utils/imageCarry.js est exercée ici, y compris les NON-garanties (aucune
// place inventée, aucun rejet, image à la une hors périmètre).
/* eslint-env jest */
import { listArticleImages, carryOverImages, enforceImageCarryOver, imageKey } from './imageCarry';
import { applyAllDiffs } from './diff';

const dom = (html) => {
  const d = document.createElement('div');
  d.innerHTML = html;
  return d;
};
const imgs = (html) => Array.from(dom(html).querySelectorAll('img'));
const srcs = (html) => imgs(html).map((i) => i.getAttribute('src'));

// Deux paragraphes assez longs pour servir d'ancrage (seuil : 40 caractères).
const P1 = "L'isolation phonique d'un plafond se joue d'abord sur la masse des materiaux employes.";
const P2 = "Le prix moyen constate en 2026 tourne autour de cinquante-cinq euros le metre carre.";
const P3 = "La pose par un artisan certifie reste vivement recommandee pour ce type de chantier.";

describe('imageKey — identite d\'une image', () => {
  test('la variante de taille WordPress designe la MEME image (pas de doublon)', () => {
    expect(imageKey('https://site.fr/wp/photo-1024x768.jpg'))
      .toBe(imageKey('https://site.fr/wp/photo.jpg'));
  });

  test('www., query et fragment sont ignores ; deux fichiers distincts restent distincts', () => {
    expect(imageKey('https://www.site.fr/a.jpg?ver=3#x')).toBe(imageKey('https://site.fr/a.jpg'));
    expect(imageKey('https://site.fr/a.jpg')).not.toBe(imageKey('https://site.fr/b.jpg'));
  });
});

describe('listArticleImages — inventaire', () => {
  test('liste les images, avec la balise exacte et le texte qui les precede', () => {
    const list = listArticleImages(`<p>${P1}</p><img src="/a.jpg" alt="Un plafond"><p>${P2}</p>`);
    expect(list).toHaveLength(1);
    expect(list[0].src).toBe('/a.jpg');
    expect(list[0].alt).toBe('Un plafond');
    expect(list[0].html).toContain('src="/a.jpg"');
    expect(list[0].lead).toContain('materiaux employes');
  });

  test('l\'image A LA UNE (data-featured) est HORS PERIMETRE', () => {
    const list = listArticleImages(
      `<figure data-featured="true"><img src="/une.jpg"></figure><p>${P1}</p><img src="/a.jpg">`,
    );
    expect(list.map((i) => i.src)).toEqual(['/a.jpg']);
  });

  test('le decor d\'editeur (data-media-overlay) n\'est pas une image de l\'article', () => {
    const list = listArticleImages(
      `<div data-media-overlay="thumb"><img src="https://img.youtube.com/vi/x/hqdefault.jpg"></div><p>${P1}</p>`,
    );
    expect(list).toHaveLength(0);
  });

  test('article sans image, ou HTML vide → liste vide', () => {
    expect(listArticleImages(`<p>${P1}</p>`)).toEqual([]);
    expect(listArticleImages('')).toEqual([]);
  });
});

describe('carryOverImages — image PRESERVEE : aucune intervention', () => {
  test('image simple encore presente → HTML rendu inchange, rien a signaler', () => {
    const before = `<p>${P1}</p><img src="/a.jpg" alt="x"><p>${P2}</p>`;
    const after = `<p>Texte entierement reecrit.</p><img src="/a.jpg" alt="x">`;
    const r = carryOverImages(before, after);
    expect(r.html).toBe(after);
    expect(r.restored).toEqual([]);
    expect(r.missing).toEqual([]);
  });

  test('l\'IA a recopie la VARIANTE de taille → toujours la meme image, pas de doublon', () => {
    const before = `<p>${P1}</p><img src="https://s.fr/photo.jpg"><p>${P2}</p>`;
    const after = `<p>${P1}</p><img src="https://s.fr/photo-1024x768.jpg"><p>${P2}</p>`;
    const r = carryOverImages(before, after);
    expect(r.restored).toEqual([]);
    expect(srcs(r.html)).toHaveLength(1);
  });
});

describe('carryOverImages — image PERDUE puis REINSEREE au bon endroit', () => {
  test('ancrage par le texte VOISIN : l\'image revient entre les memes deux blocs', () => {
    const before = `<p>${P1}</p><img src="/a.jpg" alt="schema"><p>${P2}</p>`;
    // Le modele a garde les deux paragraphes mais laisse tomber l'image.
    const after = `<p>${P1}</p><p>${P2}</p>`;
    const r = carryOverImages(before, after);

    expect(r.missing).toEqual([]);
    expect(r.restored).toEqual([{ src: '/a.jpg', alt: 'schema', how: 'contexte' }]);
    const kids = Array.from(dom(r.html).children).map((c) => c.tagName);
    expect(kids).toEqual(['P', 'IMG', 'P']);
    expect(dom(r.html).children[1].getAttribute('alt')).toBe('schema');
  });

  test('le bloc PRECEDENT a ete reecrit, le SUIVANT non → ancrage par le suivant', () => {
    const before = `<p>${P1}</p><img src="/a.jpg"><p>${P2}</p>`;
    const after = `<p>Un paragraphe d'introduction totalement different et bien plus long.</p><p>${P2}</p>`;
    const r = carryOverImages(before, after);
    expect(r.restored[0].how).toBe('contexte');
    const kids = Array.from(dom(r.html).children).map((c) => c.tagName);
    expect(kids).toEqual(['P', 'IMG', 'P']);
  });

  test('deux images consecutives gardent leur ORDRE', () => {
    const before = `<p>${P1}</p><img src="/a.jpg"><img src="/b.jpg"><p>${P2}</p>`;
    const after = `<p>${P1}</p><p>${P2}</p>`;
    const r = carryOverImages(before, after);
    expect(srcs(r.html)).toEqual(['/a.jpg', '/b.jpg']);
  });

  test('l\'image sort de la LISTE ou du TABLEAU voisin : posee en frere du bloc entier', () => {
    const before = `<ul><li>${P1}</li></ul><img src="/a.jpg"><p>${P2}</p>`;
    const after = `<ul><li>${P1}</li></ul><p>${P2}</p>`;
    const r = carryOverImages(before, after);
    const d = dom(r.html);
    expect(d.querySelector('ul img')).toBeNull();     // jamais glissee DANS la liste
    expect(Array.from(d.children).map((c) => c.tagName)).toEqual(['UL', 'IMG', 'P']);
  });
});

describe('carryOverImages — <figure> + <figcaption> : jamais separes', () => {
  test('la figure entiere revient, legende comprise', () => {
    const before = `<p>${P1}</p><figure><img src="/a.jpg" alt="coupe"><figcaption>Coupe d'un plafond suspendu.</figcaption></figure><p>${P2}</p>`;
    const after = `<p>${P1}</p><p>${P2}</p>`;
    const r = carryOverImages(before, after);

    expect(r.restored[0].how).toBe('contexte');
    const fig = dom(r.html).querySelector('figure');
    expect(fig).not.toBeNull();
    expect(fig.querySelector('img').getAttribute('src')).toBe('/a.jpg');
    expect(fig.querySelector('figcaption').textContent).toBe("Coupe d'un plafond suspendu.");
    expect(Array.from(dom(r.html).children).map((c) => c.tagName)).toEqual(['P', 'FIGURE', 'P']);
  });

  test('l\'IA a garde l\'image mais PERDU sa figure : pas de doublon (meme image)', () => {
    const before = `<p>${P1}</p><figure><img src="/a.jpg"><figcaption>Legende.</figcaption></figure><p>${P2}</p>`;
    const after = `<p>${P1}</p><img src="/a.jpg"><p>${P2}</p>`;
    const r = carryOverImages(before, after);
    expect(srcs(r.html)).toEqual(['/a.jpg']);
    expect(r.restored).toEqual([]);
  });
});

describe('carryOverImages — attributs reproduits A L\'IDENTIQUE', () => {
  test('srcset, sizes, alt, title, loading, width, height sont conserves', () => {
    const tag = '<img src="/a.jpg" srcset="/a-300x200.jpg 300w, /a-1024x768.jpg 1024w" '
      + 'sizes="(max-width: 600px) 100vw, 600px" alt="Un plafond acoustique" '
      + 'title="Plafond acoustique" loading="lazy" width="1024" height="768">';
    const before = `<p>${P1}</p>${tag}<p>${P2}</p>`;
    const r = carryOverImages(before, `<p>${P1}</p><p>${P2}</p>`);

    const img = dom(r.html).querySelector('img');
    expect(img.getAttribute('src')).toBe('/a.jpg');
    expect(img.getAttribute('srcset')).toBe('/a-300x200.jpg 300w, /a-1024x768.jpg 1024w');
    expect(img.getAttribute('sizes')).toBe('(max-width: 600px) 100vw, 600px');
    expect(img.getAttribute('alt')).toBe('Un plafond acoustique');
    expect(img.getAttribute('title')).toBe('Plafond acoustique');
    expect(img.getAttribute('loading')).toBe('lazy');
    expect(img.getAttribute('width')).toBe('1024');
    expect(img.getAttribute('height')).toBe('768');
    // Aucune marque de travail ne fuit dans le HTML rendu.
    expect(r.html).not.toContain('data-img-carry-tmp');
  });

  test('l\'image CLIQUABLE revient avec son lien (il existait deja dans l\'original)', () => {
    const before = `<p>${P1}</p><a href="/grande-photo"><img src="/a.jpg"></a><p>${P2}</p>`;
    const r = carryOverImages(before, `<p>${P1}</p><p>${P2}</p>`);
    expect(dom(r.html).querySelector('a[href="/grande-photo"] img')).not.toBeNull();
  });
});

describe('carryOverImages — SECOURS par la section, annonce comme approximatif', () => {
  test('les paragraphes ont ete reecrits mais le TITRE subsiste → image dans SA section', () => {
    const before = `<h2>Les tarifs 2026</h2><p>${P1}</p><img src="/a.jpg"><p>${P2}</p><h2>La pose</h2><p>${P3}</p>`;
    const after = `<h2>Les tarifs 2026</h2><p>Tout ce passage a ete integralement reformule par le modele.</p>`
      + `<h2>La pose</h2><p>${P3}</p>`;
    const r = carryOverImages(before, after);

    expect(r.missing).toEqual([]);
    expect(r.restored[0].how).toBe('section');          // APPROXIMATIF, et dit comme tel
    const kids = Array.from(dom(r.html).children).map((c) => c.tagName);
    // L'image reste DANS la section « Les tarifs 2026 », avant le h2 suivant.
    expect(kids.slice(0, 4)).toEqual(['H2', 'P', 'IMG', 'H2']);
  });

  test('image en TETE de section → replacee juste apres son titre', () => {
    const before = `<h2>Les tarifs 2026</h2><img src="/a.jpg"><p>${P1}</p><h2>La pose</h2><p>${P3}</p>`;
    const after = `<h2>Les tarifs 2026</h2><p>Passage reformule de fond en comble par le modele.</p><h2>La pose</h2><p>${P3}</p>`;
    const r = carryOverImages(before, after);
    expect(r.restored[0].how).toBe('section');
    expect(Array.from(dom(r.html).children).map((c) => c.tagName)).toEqual(['H2', 'IMG', 'P', 'H2', 'P']);
  });
});

describe('carryOverImages — AUCUNE place inventee', () => {
  test('contexte ET titre disparus → AVERTISSEMENT non bloquant, image NON placee', () => {
    const before = `<h2>Les tarifs 2026</h2><p>${P1}</p><img src="/a.jpg" alt="schema"><p>${P2}</p>`;
    const after = '<h2>Un plan entierement neuf</h2><p>Plus une seule phrase en commun avec avant.</p>';
    const r = carryOverImages(before, after);

    expect(r.restored).toEqual([]);
    expect(r.missing).toEqual([{ src: '/a.jpg', alt: 'schema', reason: 'aucun-ancrage' }]);
    expect(r.html).toBe(after);                  // le HTML n'est PAS touche
    expect(srcs(r.html)).toEqual([]);            // rien n'a ete pose au hasard
  });

  test('rien n\'est jamais rejete : la fonction rend toujours un HTML exploitable', () => {
    const r = carryOverImages('<p>x</p><img src="/a.jpg">', '<p>y</p>');
    expect(typeof r.html).toBe('string');
    expect(r.html.length).toBeGreaterThan(0);
  });
});

describe('carryOverImages — NO-OP stricts', () => {
  test('article d\'origine SANS image → HTML rendu a l\'identique', () => {
    const after = `<p>${P2}</p>`;
    const r = carryOverImages(`<p>${P1}</p>`, after);
    expect(r.html).toBe(after);
    expect(r.restored).toEqual([]);
    expect(r.missing).toEqual([]);
  });

  test('originalContent VIDE (F5 sur un article offloade) → aucune reinjection', () => {
    const after = `<p>${P2}</p>`;
    const r = carryOverImages('', after);
    expect(r.html).toBe(after);
    expect(r.restored).toEqual([]);
    expect(r.missing).toEqual([]);
  });

  test('l\'image A LA UNE n\'est jamais reinjectee (elle est geree a part)', () => {
    const before = `<figure data-featured="true"><img src="/une.jpg"></figure><p>${P1}</p>`;
    const after = `<p>${P1}</p>`;
    const r = carryOverImages(before, after);
    expect(r.html).toBe(after);
    expect(r.restored).toEqual([]);
    expect(r.missing).toEqual([]);
  });
});

// ── Flux des DIFFS (phases 3 OBSOLESCENCE et 4 RELECTURE) ─────────────────────

describe('enforceImageCarryOver — le flux des updates', () => {
  test('un remplacement qui perd l\'image la remet DANS le fragment (meme region)', () => {
    const { update, missing } = enforceImageCarryOver({
      type: 'replacement',
      original: `<p>${P1}</p><img src="/a.jpg" alt="schema">`,
      updated: `<p>${P2}</p>`,
    });
    expect(missing).toEqual([]);
    expect(update.updated).toContain('src="/a.jpg"');
    expect(update.updated).toContain('alt="schema"');
  });

  test('NO-OP STRICT : une update sans image est rendue a l\'IDENTIQUE (meme objet)', () => {
    const u = { type: 'replacement', original: `<p>${P1}</p>`, updated: `<p>${P2}</p>` };
    const { update, missing } = enforceImageCarryOver(u);
    expect(update).toBe(u);
    expect(missing).toEqual([]);
  });

  test('une addition ne peut rien perdre → aucune intervention', () => {
    const u = { type: 'addition', updated: `<p>${P2}</p>` };
    expect(enforceImageCarryOver(u).update).toBe(u);
  });

  test('suppression pure : l\'image partante est SIGNALEE, l\'update est conservee', () => {
    const u = { type: 'suppression', original: `<p>${P1}</p><img src="/a.jpg">` };
    const { update, missing } = enforceImageCarryOver(u);
    expect(update).toBe(u);                        // jamais bloquee
    expect(missing).toEqual([{ src: '/a.jpg', alt: '', reason: 'supprime' }]);
  });
});

describe('applyAllDiffs — R4 branche, sans toucher au reste', () => {
  test('phase 3/4 : une suggestion qui ecrasait un bloc a image la conserve', () => {
    const html = `<p>${P1}</p><figure><img src="/a.jpg"><figcaption>Une legende.</figcaption></figure><p>${P3}</p>`;
    const { html: out } = applyAllDiffs(html, [{
      type: 'replacement',
      original: `<p>${P1}</p><figure><img src="/a.jpg"><figcaption>Une legende.</figcaption></figure>`,
      updated: '<p>Un paragraphe de remplacement, sans la moindre image dedans.</p>',
      reason: 'obsolescence',
    }], 1, 'https://site.fr/article');

    expect(out).toContain('src="/a.jpg"');
    expect(out).toContain('Une legende.');
  });

  test('une update SANS image traverse applyAllDiffs exactement comme avant', () => {
    const html = `<p>${P1}</p>`;
    const { html: out, updates } = applyAllDiffs(html, [{
      type: 'replacement', original: `<p>${P1}</p>`, updated: `<p>${P2}</p>`, reason: 'maj',
    }], 1, 'https://site.fr/article');
    expect(updates[0].applied).toBe(true);
    expect(updates[0].missingImages).toBeUndefined();
    expect(out).toContain(P2);
  });
});
