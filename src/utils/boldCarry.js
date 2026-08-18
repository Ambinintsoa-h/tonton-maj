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

/** Emplacements où un gras posé par du code n'a rien à faire. */
const INTERDIT = 'h1, h2, h3, h4, h5, h6, a, summary, figcaption, del, ins, mark, code, pre';

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
