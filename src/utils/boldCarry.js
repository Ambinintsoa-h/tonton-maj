/**
 * R5 — LE GRAS DE L'ARTICLE D'ORIGINE NE DISPARAÎT PAS.
 *
 * Même principe que la reprise des liens internes (`carryOverInternalLinks`) et
 * celle des images (`carryOverImages`) : la consigne est donnée au modèle, ET un
 * contrôle déterministe la vérifie ensuite. Un balisage `<strong>` est un choix
 * éditorial déjà validé — le perdre à la réécriture est une régression que
 * personne ne voit passer.
 *
 * DÉTERMINISTE, sans appel IA, NON BLOQUANT. On ne réécrit aucune phrase : on
 * remet une balise autour de mots qui sont déjà là, à l'identique.
 *
 * Ce module est AUTONOME (aucun import) : comme `linkZones` et `imageCarry`,
 * aucun cycle d'import n'est possible.
 */

/**
 * BORNES DE DENSITÉ, reprises du prompt (`redactionConstraintsBlock`, agentQat.js).
 * Exportées pour que la CONSIGNE et la MESURE portent les mêmes nombres : deux
 * littéraux séparés auraient fini par diverger, et on aurait signalé au rédacteur
 * une densité qu'on n'avait jamais demandée. Même raison que `MOTS_MAX_PHRASE`.
 */
export const GRAS_MIN_PAR_H2 = 2;
export const GRAS_MAX_PAR_H2 = 4;
/** Un passage en gras ne dépasse pas 4 mots : au-delà, ce n'est plus une mise en avant. */
export const GRAS_MAX_MOTS = 4;

/** Longueur mini d'un terme repris : « m2 » ou « et » ne portent aucun sens. */
const MIN_CARS = 4;
/** Au-delà, ce n'est plus un terme mis en avant mais une phrase entière. */
const MAX_MOTS = 6;
/**
 * Plafond de remises en gras. Un article d'origine sur-balisé (30 termes) ne doit
 * pas produire un article réécrit tout en gras : au-delà, le gras ne met plus
 * rien en avant, et c'est précisément la borne que le prompt impose au modèle.
 */
const MAX_REMIS = 20;

const norm = (s = '') => String(s).replace(/\s+/g, ' ').trim();

/**
 * Emplacements où un gras posé par du code n'a rien à faire.
 *
 * EXPORTÉ pour `boldApply.js` (la passe de gras dédiée) : deux mécanismes qui
 * posent du gras ne peuvent pas se donner chacun leur liste d'interdits — c'est
 * exactement l'erreur que R1 et R2 avaient commise avec les zones de liens avant
 * que `linkZones.js` ne devienne leur source unique.
 */
export const NO_BOLD_SEL = 'h1, h2, h3, h4, h5, h6, a, summary, figcaption, del, ins, mark, code, pre';
const INTERDIT = NO_BOLD_SEL;

/**
 * Les termes mis en gras dans un HTML, dans l'ordre du document et dédoublonnés.
 * @returns {Array<string>}
 */
export const listBoldTerms = (html = '') => {
  if (!html || typeof document === 'undefined') return [];
  const d = document.createElement('div');
  d.innerHTML = html;
  const vus = new Set();
  const termes = [];
  d.querySelectorAll('strong, b').forEach((el) => {
    // Un gras qui vivait dans un titre ou un lien n'est PAS repris : le prompt
    // l'y interdit, et le reposer irait contre la règle qu'on fait respecter.
    if (el.parentElement && typeof el.parentElement.closest === 'function'
        && el.parentElement.closest('h1, h2, h3, h4, h5, h6, a')) return;
    const t = norm(el.textContent);
    if (t.length < MIN_CARS) return;
    if (t.split(' ').length > MAX_MOTS) return;
    const cle = t.toLowerCase();
    if (vus.has(cle)) return;
    vus.add(cle);
    termes.push(t);
  });
  return termes;
};

/**
 * Remet en gras, dans `newHtml`, les termes qui l'étaient dans `originalHtml`.
 *
 * NO-OP STRICT si l'original ne contient aucun gras — l'écrasante majorité des
 * cas reste donc rigoureusement inchangée.
 *
 * @returns {{ html:string, restored:string[], missing:string[] }}
 */
export const carryOverBold = (originalHtml = '', newHtml = '') => {
  const aucun = { html: newHtml, restored: [], missing: [] };
  if (!originalHtml || !newHtml || typeof document === 'undefined') return aucun;
  if (!/<(?:strong|b)\b/i.test(originalHtml)) return aucun;

  const termes = listBoldTerms(originalHtml);
  if (!termes.length) return aucun;

  const root = document.createElement('div');
  root.innerHTML = newHtml;

  // Déjà en gras dans le texte réécrit : le modèle a fait le travail, on n'y
  // touche pas (et on ne compte pas ce terme comme perdu).
  const dejaGras = new Set(listBoldTerms(newHtml).map((t) => t.toLowerCase()));

  const restored = [];
  const missing = [];

  termes.forEach((terme) => {
    if (restored.length >= MAX_REMIS) { missing.push(terme); return; }
    if (dejaGras.has(terme.toLowerCase())) return;

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    let pose = false;
    while ((node = walker.nextNode())) {
      const parent = node.parentElement;
      if (!parent) continue;
      // Jamais dans un titre, un lien, une balise de diff, un tableau de code…
      if (typeof parent.closest === 'function' && parent.closest(INTERDIT)) continue;
      if (typeof parent.closest === 'function' && parent.closest('strong, b')) continue;
      const idx = node.textContent.indexOf(terme);
      if (idx === -1) continue;
      try {
        const range = document.createRange();
        range.setStart(node, idx);
        range.setEnd(node, idx + terme.length);
        const strong = document.createElement('strong');
        range.surroundContents(strong);
        pose = true;
      } catch {
        // Sélection à cheval sur des balises : on n'insiste pas, on signale.
      }
      break;
    }
    if (pose) { restored.push(terme); dejaGras.add(terme.toLowerCase()); }
    else missing.push(terme);
  });

  if (!restored.length) {
    if (missing.length) {
      console.warn(`[R5 gras] ${missing.length} terme(s) en gras de l'article d'origine absent(s) du texte réécrit — AVERTISSEMENT non bloquant :`, missing);
    }
    return { html: newHtml, restored, missing };
  }
  console.warn(`[R5 gras] ${restored.length} terme(s) remis en gras d'après l'article d'origine :`, restored);
  if (missing.length) {
    console.warn(`[R5 gras] ${missing.length} terme(s) en gras non replacé(s) (les mots ne figurent plus dans le texte) :`, missing);
  }
  return { html: root.innerHTML, restored, missing };
};

/**
 * CONSTAT DE GRAS PAR SECTION H2 — la moitié qui manquait.
 *
 * Ajouté le 18 août 2026, à la demande d'Andrianina (« d'autres mots importants
 * doivent être aussi mis en gras, c'est très important »). Le gras était déjà
 * demandé au modèle (règle 10, `redactionConstraintsBlock`) et déjà REPRIS de
 * l'article d'origine (`carryOverBold`, ci-dessus) — mais jamais MESURÉ. Personne
 * ne savait donc si les 2 à 4 passages par H2 étaient réellement produits : la
 * situation exacte que la règle des 20 mots a connue avant d'être comptée.
 *
 * Le constat porte sur les DEUX sens de l'écart, et c'est délibéré :
 *   • une section SOUS le plancher n'est pas optimisée pour le mot-clé ;
 *   • une section AU-DESSUS du plafond ne met plus rien en avant — un texte tout
 *     en gras est aussi plat qu'un texte sans gras.
 * N'afficher que le manque aurait laissé passer la sur-mise-en-gras, qui est le
 * défaut le plus visible à la lecture.
 *
 * Les violations d'emplacement (gras dans un titre, gras dans le texte d'un lien)
 * sont comptées à part : le prompt les interdit explicitement, et ce ne sont pas
 * des questions de densité mais des fautes franches.
 *
 * NON BLOQUANT, comme toutes les mesures de ce fichier : c'est un chiffre montré
 * au rédacteur, jamais un motif de rejet — un 4e motif écraserait `currentUser` et
 * ferait perdre la consigne de reprise du verrou externe (règle 8).
 *
 * @returns {{sections: Array<{titre:string, gras:number, ecart:'sous'|'sur'|null}>,
 *            sousPlancher:number, surPlafond:number,
 *            dansTitre:number, dansLien:number, tropLongs:number, total:number}}
 */
export const constatGras = (html = '') => {
  const vide = {
    sections: [], sousPlancher: 0, surPlafond: 0,
    dansTitre: 0, dansLien: 0, tropLongs: 0, total: 0,
  };
  if (!html || typeof document === 'undefined') return vide;
  const d = document.createElement('div');
  d.innerHTML = html;

  const tous = Array.from(d.querySelectorAll('strong, b'));
  const dansTitre = tous.filter((e) => e.closest('h1, h2, h3, h4, h5, h6')).length;
  const dansLien  = tous.filter((e) => e.closest('a')).length;
  const tropLongs = tous.filter((e) => norm(e.textContent).split(' ').length > GRAS_MAX_MOTS).length;

  // Découpage en sections H2 : on parcourt les blocs de premier niveau, un H2
  // ouvrant une nouvelle section. Les gras situés AVANT le premier H2 (chapô,
  // TL;DR) ne sont rattachés à aucune section — ils ne relèvent pas de la règle,
  // qui parle de densité « par section H2 ».
  const sections = [];
  let courante = null;
  Array.from(d.children).forEach((el) => {
    if (el.tagName === 'H2') {
      courante = { titre: norm(el.textContent), gras: 0, ecart: null };
      sections.push(courante);
      return;
    }
    if (!courante) return;
    // Un gras de titre ou de lien ne COMPTE PAS dans la densité : il est déjà
    // signalé comme faute d'emplacement, l'ajouter au décompte le ferait passer
    // pour une mise en avant valable.
    courante.gras += Array.from(el.querySelectorAll('strong, b'))
      .filter((e) => !e.closest('h1, h2, h3, h4, h5, h6') && !e.closest('a')).length;
  });

  sections.forEach((s) => {
    if (s.gras < GRAS_MIN_PAR_H2) s.ecart = 'sous';
    else if (s.gras > GRAS_MAX_PAR_H2) s.ecart = 'sur';
  });

  return {
    sections,
    sousPlancher: sections.filter((s) => s.ecart === 'sous').length,
    surPlafond:   sections.filter((s) => s.ecart === 'sur').length,
    dansTitre, dansLien, tropLongs,
    total: tous.length,
  };
};
