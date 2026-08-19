/**
 * R6 — les renvois écrits PAR LE MODÈLE deviennent des encarts.
 *
 * Pourquoi ce module existe alors que R2 posait déjà ses clauses dans un encart :
 * le renvoi signalé par Andrianina n'était pas une clause du code. Relevé tel quel
 * sur l'article publié, en vérifiant la production au navigateur le 19/08/2026 :
 *
 *   …Le résultat dépasse toutes les prévisions. À lire aussi les
 *   <a href="…">actualités PlayStation 5</a>.</p>
 *
 * « À lire aussi LES », sans deux-points, et aucun `data-lien-redige` dans la
 * page : c'est le MODÈLE qui l'a écrit. Corriger `writeClause` ne pouvait rien y
 * faire — le renvoi restait collé en fin de phrase.
 */
import { promoteInlineRenvois, WRITTEN_BLOCK_CLASS } from './internalWeave';
import { exportAsHtml } from './export';

const URL_ART = 'https://inigeek.fr/quel-ordre-suivre-god-of-war/';
const dom = (html) => { const d = document.createElement('div'); d.innerHTML = html; return d; };

describe('le renvoi collé en fin de phrase devient un bloc', () => {
  // La chaîne EXACTE de production, y compris « les » après l'amorce.
  const REEL = '<p>Le résultat dépasse toutes les prévisions. À lire aussi les '
    + '<a href="https://inigeek.fr/categorie/actualites-playstation/">actualités PlayStation 5</a>.</p>';

  it('extrait la clause et laisse la phrase intacte', () => {
    const r = promoteInlineRenvois(REEL, URL_ART);
    expect(r.promoted).toHaveLength(1);
    const ps = Array.from(dom(r.html).querySelectorAll('p'));
    expect(ps).toHaveLength(2);
    // La phrase du modèle ne perd RIEN, et ne porte plus le renvoi.
    expect(ps[0].textContent).toBe('Le résultat dépasse toutes les prévisions.');
    expect(ps[0].querySelector('a')).toBeNull();
    // L'encart porte le renvoi, avec le libellé en gras.
    expect(ps[1].classList.contains(WRITTEN_BLOCK_CLASS)).toBe(true);
    expect(ps[1].querySelector('strong').textContent).toBe('À lire aussi : ');
    expect(ps[1].querySelector('a').getAttribute('href'))
      .toBe('https://inigeek.fr/categorie/actualites-playstation/');
  });

  it('le TEXTE DE L\'ANCRE est conservé au caractère près', () => {
    // Ce n'est pas une réécriture : aucun mot ajouté, aucun mot retiré.
    const r = promoteInlineRenvois(REEL, URL_ART);
    const a = dom(r.html).querySelector(`.${WRITTEN_BLOCK_CLASS} a`);
    expect(a.textContent).toBe('actualités PlayStation 5');
    // La prose du modèle après l'amorce (« les ») est gardée, pas inventée.
    expect(dom(r.html).querySelector(`.${WRITTEN_BLOCK_CLASS}`).textContent)
      .toBe('À lire aussi : les actualités PlayStation 5.');
  });

  it('reconnaît les variantes réellement employées', () => {
    ['À lire également', 'Lire aussi', 'À découvrir aussi', 'A lire aussi', 'Voir également']
      .forEach((lead) => {
        const html = `<p>Une phrase de longueur normale. ${lead} <a href="/guide">le guide</a>.</p>`;
        expect(promoteInlineRenvois(html, URL_ART).promoted).toHaveLength(1);
      });
  });

  it('IDEMPOTENT : repasser sur sa propre sortie ne change rien', () => {
    const un = promoteInlineRenvois(REEL, URL_ART);
    const deux = promoteInlineRenvois(un.html, URL_ART);
    expect(deux.promoted).toEqual([]);
    expect(deux.html).toBe(un.html);
  });

  it('un renvoi SEUL dans son bloc ne laisse pas de paragraphe vide', () => {
    const html = '<p>À lire aussi <a href="/guide">le guide</a>.</p>';
    const r = promoteInlineRenvois(html, URL_ART);
    const ps = Array.from(dom(r.html).querySelectorAll('p'));
    expect(ps).toHaveLength(1);
    expect(ps[0].classList.contains(WRITTEN_BLOCK_CLASS)).toBe(true);
  });
});

describe('ce que R6 refuse de toucher', () => {
  it('un lien EXTERNE reste où il est (règle 8)', () => {
    // Le déplacer, c'est le sortir de sa phrase — et `enforceExternalLinkPolicy`
    // a déjà validé le texte à ce stade, donc personne ne le verrait.
    const html = '<p>Une phrase de longueur normale. À lire aussi <a href="https://concurrent.fr/x">leur test</a>.</p>';
    const r = promoteInlineRenvois(html, URL_ART);
    expect(r.promoted).toEqual([]);
    expect(r.html).toBe(html);
  });

  it('sans articleUrl, toute URL absolue est traitée comme EXTERNE', () => {
    const html = '<p>Une phrase de longueur normale. À lire aussi <a href="https://inigeek.fr/x">notre test</a>.</p>';
    expect(promoteInlineRenvois(html, '').promoted).toEqual([]);
  });

  it('la FAQ et les tableaux sont écartés', () => {
    const faq = '<h2>FAQ</h2><p>Une question posée ici. À lire aussi <a href="/guide">le guide</a>.</p>';
    expect(promoteInlineRenvois(faq, URL_ART).promoted).toEqual([]);
    const tab = '<table><tbody><tr><td><p>Une cellule assez longue. À lire aussi <a href="/g">le guide</a>.</p></td></tr></tbody></table>';
    expect(promoteInlineRenvois(tab, URL_ART).promoted).toEqual([]);
  });

  it('DEUX liens dans la clause : on s\'abstient plutôt que de deviner', () => {
    // Découper deviendrait un arbitrage sur le sens de la phrase.
    const html = '<p>Une phrase normale. À lire aussi <a href="/a">ceci</a> et <a href="/b">cela</a>.</p>';
    expect(promoteInlineRenvois(html, URL_ART).promoted).toEqual([]);
  });

  it('une prose ordinaire n\'est pas découpée', () => {
    // Une détection large (« voir », « lire ») attraperait des phrases normales.
    const html = '<p>Il faut lire ce livre pour voir la différence, et aussi comparer les prix sur <a href="/prix">notre page</a>.</p>';
    expect(promoteInlineRenvois(html, URL_ART).promoted).toEqual([]);
  });

  it('un lien qui commence AVANT l\'amorce n\'est pas coupé en deux', () => {
    const html = '<p>Voir <a href="/prix">les prix</a> ici. À lire aussi ce dossier.</p>';
    const r = promoteInlineRenvois(html, URL_ART);
    expect(r.promoted).toEqual([]);
    expect(r.html).toBe(html);
  });

  it('aucun lien du tout : rien à promouvoir', () => {
    expect(promoteInlineRenvois('<p>Une phrase. À lire aussi notre dossier.</p>', URL_ART).promoted).toEqual([]);
  });
});

describe('l\'encart survit à la publication', () => {
  it('la classe part sur le site, le lien aussi, la marque jaune non', () => {
    const REEL = '<p>Le résultat dépasse toutes les prévisions. À lire aussi les '
      + '<a href="https://inigeek.fr/categorie/actualites-playstation/">actualités PlayStation 5</a>.</p>';
    const publie = exportAsHtml(promoteInlineRenvois(REEL, URL_ART).html, URL_ART);
    expect(publie).toContain(`class="${WRITTEN_BLOCK_CLASS}"`);
    expect(publie).toContain('<strong>À lire aussi : </strong>');
    expect(publie).toContain('actualités PlayStation 5');
    expect(publie).not.toContain('lien-redige');
  });
});
