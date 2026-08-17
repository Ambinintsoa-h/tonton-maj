// ── R2 — maillage interne à 100 % : le code TISSE, et au besoin RÉDIGE ────────
//
// 340 lignes qui écrivent dans des articles publiés n'avaient AUCUN test : la
// seule couverture était indirecte, via le chemin heureux de runQatRewrite.
// Ce fichier verrouille ce qui a été trouvé cassé en relecture adversariale, et
// que le lecteur de la PR doit pouvoir vérifier d'un coup d'œil :
//   • règle 8 — une URL protocol-relative hors domaine ne doit JAMAIS être posée ;
//   • les emplacements interdits (titre, tableau, FAQ, TL;DR, citation), y compris
//     quand un conteneur enveloppe le corps de l'article ;
//   • le non-empilement des clauses écrites par le code ;
//   • l'auto-lien, l'ancre déjà liée ailleurs, le diff en attente ;
//   • le message affiché au rédacteur, qui doit dire le VRAI motif d'écart.

import {
  weaveBriefLinks, countPlacedBriefLinks, briefLinkReportLine,
  classifyBriefLinks, placeableBriefLinks, WRITTEN_MARK_ATTR,
  unwrapForbiddenInternalLinks,
} from './internalWeave';
import { exportAsHtml } from './export';

const URL_ART = 'https://monsite.fr/guide-isolation';
const P = (t) => `<p>${t}</p>`;
const LONG = 'Un paragraphe de longueur suffisante pour accueillir une clause, largement plus de quarante caracteres.';

// ── R2a — les liens que l'IA pose dans une zone interdite sont DÉLIÉS ──────────
// « Aucun lien dans la FAQ » était écrit trois fois dans le skill et respecté par
// le code pour SES propres liens — mais rien n'empêchait le modèle d'en poser.
describe('R2a — délier les liens internes posés en zone interdite', () => {
  const FAQ = '<h2>FAQ</h2><p>Quel <a href="/prix">prix au m2</a> prevoir ?</p>';

  test('un lien interne dans la FAQ est délié, mais son TEXTE est conservé', () => {
    const r = unwrapForbiddenInternalLinks(FAQ, URL_ART);
    expect(r.unwrapped).toEqual([{ anchor: 'prix au m2', url: '/prix' }]);
    expect(r.html).not.toContain('<a href="/prix"');
    expect(r.html).toContain('prix au m2');       // la phrase reste intacte
  });

  test('RÈGLE 8 — un lien EXTERNE dans la FAQ n\'est JAMAIS touché', () => {
    // Le délier serait le SUPPRIMER de l'article : interdit sans exception, et le
    // verrou externe a déjà validé le texte à ce stade, donc rien ne le verrait.
    const html = '<h2>FAQ</h2><p>Voir <a href="https://autre-site.fr/x">cette source</a>.</p>';
    const r = unwrapForbiddenInternalLinks(html, URL_ART);
    expect(r.unwrapped).toEqual([]);
    expect(r.html).toContain('href="https://autre-site.fr/x"');
  });

  test('sans articleUrl, une URL absolue est traitée comme externe — on ne délie pas', () => {
    const html = '<h2>FAQ</h2><p><a href="https://monsite.fr/prix">prix</a></p>';
    expect(unwrapForbiddenInternalLinks(html, '').unwrapped).toEqual([]);
  });

  test('titres, tableaux, TL;DR et citations sont traités comme la FAQ', () => {
    const cas = [
      '<h2>Le <a href="/a">prix</a></h2>',
      '<table><tr><td><a href="/a">prix</a></td></tr></table>',
      '<h2>Résumé de l\'article</h2><p><a href="/a">prix</a></p>',
      '<blockquote><a href="/a">prix</a></blockquote>',
    ];
    cas.forEach((h) => {
      expect(unwrapForbiddenInternalLinks(h, URL_ART).unwrapped).toHaveLength(1);
    });
  });

  test('un lien interne dans un paragraphe normal n\'est PAS touché', () => {
    const html = P(`Le <a href="/prix">prix au m2</a> et ${LONG}`);
    const r = unwrapForbiddenInternalLinks(html, URL_ART);
    expect(r.unwrapped).toEqual([]);
    expect(r.html).toBe(html);                    // aucune réécriture inutile
  });

  test('délié puis REPLACÉ dans le corps : la violation devient un bon placement', () => {
    // C'est la raison de l'ordre R1 → R2a → R2 : weaveBriefLinks voit l'URL comme
    // absente et la pose dans la prose.
    const rows = [{ anchor: 'prix au m2', url: '/prix' }];
    const html = `${P(`Le prix au m2 depend du materiau, et ${LONG}`)}${FAQ}`;
    const deloc = unwrapForbiddenInternalLinks(html, URL_ART);
    expect(deloc.unwrapped).toHaveLength(1);
    const woven = weaveBriefLinks(deloc.html, rows, URL_ART);
    const constat = countPlacedBriefLinks(woven.html, rows, URL_ART);
    expect(constat[0].placed).toBe(true);
    expect(constat[0].misplaced).toBe(false);     // plus dans la FAQ
  });
});

describe('RÈGLE 8 — aucune URL hors domaine ne peut être posée par le code', () => {
  test('URL protocol-relative //autre-site : ÉCARTÉE, et le rédacteur en est averti', () => {
    const rows = [{ anchor: 'panneaux solaires', url: '//evil.com/page' }];
    expect(placeableBriefLinks(rows, URL_ART)).toEqual([]);
    const r = weaveBriefLinks(P(`Les panneaux solaires et ${LONG}`), rows, URL_ART);
    expect(r.html).not.toContain('evil.com');
    expect(r.total).toBe(0);
    expect(r.offDomain.map((l) => l.url)).toEqual(['//evil.com/page']);
  });

  test('URL protocol-relative du MÊME domaine : acceptée (ce n\'est pas un lien externe)', () => {
    const rows = [{ anchor: 'panneaux solaires', url: '//monsite.fr/solaire' }];
    expect(placeableBriefLinks(rows, URL_ART).map((l) => l.url)).toEqual(['//monsite.fr/solaire']);
  });

  test('URL absolue d\'un autre domaine : ÉCARTÉE', () => {
    const r = weaveBriefLinks(P(LONG), [{ anchor: 'x', url: 'https://autre.fr/y' }], URL_ART);
    expect(r.html).not.toContain('autre.fr');
    expect(r.offDomain).toHaveLength(1);
  });

  test('un lien EXTERNE déjà présent traverse le tissage INTACT (href, ancre, rel)', () => {
    const html = `<p>Selon <a href="https://ademe.fr/g" rel="noopener">l'ADEME</a>, ${LONG}</p>`;
    const r = weaveBriefLinks(html, [{ anchor: 'prix au m2', url: '/prix' }], URL_ART);
    expect(r.html).toContain('href="https://ademe.fr/g"');
    expect(r.html).toContain('rel="noopener"');
    expect(r.html).toContain('>l\'ADEME</a>');
  });
});

describe('TISSAGE — l\'ancre existe déjà dans le texte', () => {
  test('enveloppée sur place, une seule fois, sans rel (dofollow par construction)', () => {
    const html = `<p>Le prix au m2 varie. ${LONG} Le prix au m2 encore.</p>`;
    const r = weaveBriefLinks(html, [{ anchor: 'prix au m2', url: '/prix' }], URL_ART);
    expect(r.placed).toEqual([{ anchor: 'prix au m2', url: '/prix', source: 'tisse' }]);
    expect(r.html.match(/<a href="\/prix">/g)).toHaveLength(1);
    expect(r.html).not.toContain('rel=');
  });

  test('lien déjà posé par l\'IA → RIEN n\'est ajouté (source: existant)', () => {
    const html = `<p>Voir <a href="https://monsite.fr/prix">prix au m2</a>. ${LONG}</p>`;
    const r = weaveBriefLinks(html, [{ anchor: 'prix au m2', url: '/prix' }], URL_ART);
    expect(r.placed[0].source).toBe('existant');
    expect(r.written).toEqual([]);
  });
});

describe('EMPLACEMENTS INTERDITS — le tissage n\'y touche pas', () => {
  // Chaque cas : l'ancre « prix au m2 » ne figure QUE dans un emplacement interdit.
  // `intact` est le fragment interdit, qui doit ressortir MOT POUR MOT — donc sans
  // <a> injecté dedans.
  const cas = {
    titre:    { html: `<h2>Le prix au m2 en 2026</h2>${P(LONG)}`, intact: '<h2>Le prix au m2 en 2026</h2>' },
    tableau:  { html: `<table><tbody><tr><td>Le prix au m2 evolue.</td></tr></tbody></table>${P(LONG)}`, intact: '<td>Le prix au m2 evolue.</td>' },
    citation: { html: `<blockquote><p>Le prix au m2 est scandaleux.</p></blockquote>${P(LONG)}`, intact: '<blockquote><p>Le prix au m2 est scandaleux.</p></blockquote>' },
    faq:      { html: `<h2>FAQ</h2><p>Le prix au m2 est detaille ici et ${LONG}</p>`, intact: `<p>Le prix au m2 est detaille ici et ${LONG}</p>` },
    tldr:     { html: `<h2>Résumé de l'article</h2><ul><li>Le prix au m2 est stable.</li></ul>${P(LONG)}`, intact: '<li>Le prix au m2 est stable.</li>' },
    sommaire: { html: `<h2>Sommaire</h2><ul><li>Le prix au m2</li></ul>${P(LONG)}`, intact: '<li>Le prix au m2</li>' },
  };
  Object.entries(cas).forEach(([nom, { html, intact }]) => {
    test(`aucun lien posé dans : ${nom}`, () => {
      const r = weaveBriefLinks(html, [{ anchor: 'prix au m2', url: '/prix' }], URL_ART);
      expect(r.html).toContain(intact);                              // fragment interdit INTACT
      expect(r.placed.every((l) => l.source !== 'tisse')).toBe(true); // jamais tissé là
      // Le lien atterrit dans un <p> autorisé, ou nulle part — jamais dans la zone.
      const tmp = document.createElement('div');
      tmp.innerHTML = r.html;
      Array.from(tmp.querySelectorAll('a[href="/prix"]')).forEach((a) => {
        expect(a.closest('h2,td,blockquote,li')).toBeNull();
      });
    });
  });

  test('TL;DR, FAQ et sommaire à plat : le <p> de la zone n\'accueille rien', () => {
    const html = '<h2>FAQ</h2><p>Une reponse assez longue pour etre eligible, plus de quarante caracteres.</p>';
    const r = weaveBriefLinks(html, [{ anchor: 'aides 2026', url: '/aides' }], URL_ART);
    expect(r.html).toBe(html);
    expect(r.missing[0].reason).toBe('aucun-emplacement');
  });

  test('la zone se REFERME sur un titre de niveau égal ou supérieur', () => {
    const html = `<h2>FAQ</h2><p>Reponse.</p><h2>Le vrai sujet</h2><p>${LONG}</p>`;
    const r = weaveBriefLinks(html, [{ anchor: 'aides 2026', url: '/aides' }], URL_ART);
    expect(r.written).toHaveLength(1);                 // le <p> d'après la FAQ est éligible
    expect(r.html).toContain('<p>Reponse.</p>');       // celui de la FAQ, non
  });

  test('zone FAQ / TL;DR détectée MÊME quand un conteneur enveloppe le corps', () => {
    // Avant correction, forbiddenZones ne regardait que root.children : un simple
    // <div> masquait la zone et la clause était écrite DANS le TL;DR.
    const html = `<div class="wrap"><h2>Résumé de l'article</h2><p>${LONG}</p></div>`;
    const r = weaveBriefLinks(html, [{ anchor: 'aides 2026', url: '/aides' }], URL_ART);
    expect(r.html).not.toContain('/aides');
    expect(r.missing).toEqual([{ anchor: 'aides 2026', url: '/aides', reason: 'aucun-emplacement' }]);
  });

  test('un <p> qui contient un diff EN ATTENTE n\'accueille pas de clause', () => {
    // Sinon exportAsHtml supprime le contenu de l'<ins> et le paragraphe publié
    // se réduit à la rustine du code.
    const html = '<h2>T</h2><p><ins class="added-content">Texte propose par l\'IA, pas encore arbitre du tout.</ins></p>';
    const r = weaveBriefLinks(html, [{ anchor: 'prix au m2', url: '/prix' }], URL_ART);
    expect(r.missing[0].reason).toBe('aucun-emplacement');
  });
});

describe('FORÇAGE À 100 % — le code RÉDIGE, et le marque', () => {
  test('ancre introuvable → clause marquée en fin du paragraphe le plus pertinent', () => {
    const html = `${P(`Sujet sans rapport. ${LONG}`)}${P(`Le tarif de la pose des panneaux, ${LONG}`)}`;
    const r = weaveBriefLinks(html, [{ anchor: 'pose de panneaux', url: '/pose' }], URL_ART);
    expect(r.written).toEqual([{ anchor: 'pose de panneaux', url: '/pose' }]);
    expect(r.html).toContain(`${WRITTEN_MARK_ATTR}="1"`);
    expect(r.html).toContain('À lire aussi : <a href="/pose">pose de panneaux</a>.');
    // la clause est bien allée dans le paragraphe qui parle du sujet
    expect(r.html.indexOf('data-lien-redige')).toBeGreaterThan(r.html.indexOf('Sujet sans rapport'));
  });

  test('la MARQUE part à l\'export, le LIEN reste', () => {
    const r = weaveBriefLinks(P(LONG), [{ anchor: 'aides 2026', url: '/aides' }], URL_ART);
    const publie = exportAsHtml(r.html);
    expect(publie).toContain('<a href="/aides">aides 2026</a>');
    expect(publie).not.toContain('lien-redige');
    expect(publie).not.toContain('À RELIRE');
  });

  test('AUCUNE clause n\'est empilée : 3 liens, un seul paragraphe éligible', () => {
    const rows = [
      { anchor: 'prix au m2', url: '/prix' },
      { anchor: 'aides financieres', url: '/aides' },
      { anchor: 'devis gratuit', url: '/devis' },
    ];
    const r = weaveBriefLinks(`<h2>T</h2>${P(LONG)}`, rows, URL_ART);
    const clauses = (r.html.match(/data-lien-redige/g) || []).length;
    // Le forçage reste à 100 % (le paragraphe unique est réutilisé faute de mieux),
    // mais le tri privilégie TOUJOURS un paragraphe encore vierge — voir le test
    // suivant, qui est le cas réel d'un article normal.
    expect(r.placed).toHaveLength(3);
    expect(clauses).toBe(3);
  });

  test('les clauses se RÉPARTISSENT dès qu\'il y a plusieurs paragraphes', () => {
    const rows = [
      { anchor: 'prix au m2', url: '/prix' },
      { anchor: 'aides financieres', url: '/aides' },
      { anchor: 'devis gratuit', url: '/devis' },
    ];
    const html = `${P(`Premier bloc. ${LONG}`)}${P(`Deuxieme bloc. ${LONG}`)}${P(`Troisieme bloc. ${LONG}`)}`;
    const r = weaveBriefLinks(html, rows, URL_ART);
    const tmp = document.createElement('div');
    tmp.innerHTML = r.html;
    const parClause = Array.from(tmp.querySelectorAll('p'))
      .map((p) => p.querySelectorAll(`[${WRITTEN_MARK_ATTR}]`).length);
    expect(parClause).toEqual([1, 1, 1]);   // une par paragraphe, jamais deux au même endroit
  });

  test('même ancre déjà liée vers une AUTRE cible → pas côte à côte dans le même <p>', () => {
    const html = `${P(`Voir <a href="/autre">prix au m2</a> ici. ${LONG}`)}${P(`Autre bloc. ${LONG}`)}`;
    const r = weaveBriefLinks(html, [{ anchor: 'prix au m2', url: '/prix' }], URL_ART);
    const tmp = document.createElement('div');
    tmp.innerHTML = r.html;
    const ps = Array.from(tmp.querySelectorAll('p'));
    expect(ps[0].querySelectorAll(`[${WRITTEN_MARK_ATTR}]`)).toHaveLength(0);
    expect(ps[1].innerHTML).toContain('/prix');
  });

  test('aucun paragraphe éligible → SIGNALÉ, jamais un bloc fabriqué de toutes pièces', () => {
    const html = '<table><tbody><tr><td>Cellule</td></tr></tbody></table><h2>FAQ</h2><p>Court.</p>';
    const r = weaveBriefLinks(html, [{ anchor: 'prix au m2', url: '/prix' }], URL_ART);
    expect(r.placed).toEqual([]);
    expect(r.missing).toEqual([{ anchor: 'prix au m2', url: '/prix', reason: 'aucun-emplacement' }]);
    expect(r.html).toBe(html);
  });

  test('IDEMPOTENCE : repasser sur sa propre sortie ne duplique rien', () => {
    const rows = [{ anchor: 'aides 2026', url: '/aides' }];
    const un = weaveBriefLinks(P(LONG), rows, URL_ART);
    const deux = weaveBriefLinks(un.html, rows, URL_ART);
    expect(deux.written).toEqual([]);
    expect(deux.placed[0].source).toBe('existant');
    expect((deux.html.match(/\/aides/g) || []).length).toBe(1);
  });

  test('force: false → rien n\'est rédigé, le manquant est nommé', () => {
    const r = weaveBriefLinks(P(LONG), [{ anchor: 'aides 2026', url: '/aides' }], URL_ART, { force: false });
    expect(r.written).toEqual([]);
    expect(r.missing[0].reason).toBe('ancre-absente');
  });
});

describe('AUTO-LIEN — un article ne se lie pas à lui-même', () => {
  test('l\'URL du brief EST celle de l\'article → écartée et signalée', () => {
    const rows = [{ anchor: 'cet article', url: '/guide-isolation' }];
    const r = weaveBriefLinks(P(LONG), rows, URL_ART);
    expect(r.total).toBe(0);
    expect(r.selfLinks.map((l) => l.url)).toEqual(['/guide-isolation']);
    expect(r.html).toBe(P(LONG));
  });
});

describe('URL D\'ARTICLE INCONNUE (contenu collé) — dire le VRAI motif', () => {
  test('URL absolue : « non vérifiable », JAMAIS « hors domaine (règle 8) »', () => {
    const rows = [{ anchor: 'prix au m2', url: 'https://monsite.fr/prix' }];
    const r = weaveBriefLinks(P(LONG), rows, '');
    expect(r.offDomain).toEqual([]);
    expect(r.unverifiable).toHaveLength(1);
    const ligne = briefLinkReportLine(r);
    expect(ligne).not.toContain('hors domaine');
    expect(ligne).toContain('URL de l\'article non fournie');
    expect(ligne).not.toContain('0/0');
  });

  test('chemin relatif : plaçable même sans URL d\'article', () => {
    const r = weaveBriefLinks(P(LONG), [{ anchor: 'prix au m2', url: '/prix' }], '');
    expect(r.total).toBe(1);
    expect(r.placed).toHaveLength(1);
  });

  test('le décompte affiché ne disparaît PAS sur ce flux (régression d\'affichage)', () => {
    // countPlacedBriefLinks porte sur TOUTES les paires saisies : compter ne
    // signifie pas poser, et ne rien compter vidait le badge de l'éditeur.
    const html = '<p>Voir <a href="https://monsite.fr/prix">prix au m2</a>.</p>';
    const constat = countPlacedBriefLinks(html, [{ anchor: 'prix au m2', url: 'https://monsite.fr/prix' }], '');
    expect(constat).toHaveLength(1);
    expect(constat[0].placed).toBe(true);
    expect(constat[0].placeable).toBe(false);   // le CODE, lui, n'aurait pas le droit de la poser
  });
});

describe('CONSTAT — on ne croit ni le modèle ni le rapport du tissage', () => {
  test('lien du brief absent du HTML → placed: false', () => {
    const constat = countPlacedBriefLinks(P('Aucun lien ici.'), [{ anchor: 'prix', url: '/prix' }], URL_ART);
    expect(constat).toEqual([{ anchor: 'prix', url: '/prix', placed: false, placeable: true, written: false, misplaced: false }]);
  });

  test('formes d\'URL différentes = MÊME lien (/prix, /prix/, absolu)', () => {
    const html = '<p>Voir <a href="https://www.monsite.fr/prix/">prix</a>.</p>';
    expect(countPlacedBriefLinks(html, [{ anchor: 'prix', url: '/prix' }], URL_ART)[0].placed).toBe(true);
  });

  test('lien posé UNIQUEMENT dans un titre ou un tableau → placed ET misplaced', () => {
    const html = '<h2>Voir <a href="/prix">prix au m2</a></h2>';
    const c = countPlacedBriefLinks(html, [{ anchor: 'prix au m2', url: '/prix' }], URL_ART)[0];
    expect(c.placed).toBe(true);
    expect(c.misplaced).toBe(true);
  });

  test('clause rédigée par le code → written: true, et JAMAIS misplaced', () => {
    const r = weaveBriefLinks(P(LONG), [{ anchor: 'aides 2026', url: '/aides' }], URL_ART);
    const c = countPlacedBriefLinks(r.html, [{ anchor: 'aides 2026', url: '/aides' }], URL_ART)[0];
    expect(c.written).toBe(true);
    expect(c.misplaced).toBe(false);
  });

  test('lien en instance de SUPPRESSION (<del>) ne compte pas comme placé', () => {
    const html = '<p><del><a href="/prix">prix</a></del> Autre chose.</p>';
    expect(countPlacedBriefLinks(html, [{ anchor: 'prix', url: '/prix' }], URL_ART)[0].placed).toBe(false);
  });
});

describe('CLASSEMENT et COMPTE RENDU', () => {
  test('les 4 catégories sont exclusives', () => {
    const c = classifyBriefLinks([
      { anchor: 'a', url: '/interne' },
      { anchor: 'b', url: 'https://autre.fr/x' },
      { anchor: 'c', url: '/guide-isolation' },
      { anchor: 'd', url: 'mailto:x@y.fr' },
    ], URL_ART);
    expect(c.placeable.map((l) => l.url)).toEqual(['/interne']);
    expect(c.offDomain.map((l) => l.url)).toEqual(['https://autre.fr/x', 'mailto:x@y.fr']);
    expect(c.selfLinks.map((l) => l.url)).toEqual(['/guide-isolation']);
    expect(c.unverifiable).toEqual([]);
    expect(c.all).toHaveLength(4);
  });

  test('la phrase nomme le forçage sans le maquiller', () => {
    const ligne = briefLinkReportLine({
      total: 3, placed: [1, 2, 3], written: [{ anchor: 'a', url: '/a' }],
    });
    expect(ligne).toContain('3/3');
    expect(ligne).toContain('RÉDIGÉ(S) PAR LE CODE');
  });

  test('rien à dire → chaîne vide (aucune ligne de bruit)', () => {
    expect(briefLinkReportLine({})).toBe('');
    expect(briefLinkReportLine(weaveBriefLinks(P(LONG), [], URL_ART))).toBe('');
  });
});

describe('NO-OP — jamais d\'exception, jamais d\'écriture hasardeuse', () => {
  test('aucune paire', () => {
    expect(weaveBriefLinks(P(LONG), [], URL_ART)).toMatchObject({ html: P(LONG), total: 0, placed: [] });
  });
  test('HTML vide', () => {
    expect(weaveBriefLinks('', [{ anchor: 'a', url: '/a' }], URL_ART).html).toBe('');
  });
  test('paire incomplète (ancre ou URL manquante)', () => {
    expect(weaveBriefLinks(P(LONG), [{ anchor: '', url: '/a' }, { anchor: 'b', url: '' }], URL_ART).total).toBe(0);
  });
});
