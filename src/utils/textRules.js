// ─────────────────────────────────────────────────────────────────────────────
// Garde-fous de style DÉTERMINISTES sur le texte GÉNÉRÉ par l'IA.
// Règle d'équipe absolue (skill « Style d'écriture », règle 4) : jamais de
// tiret cadratin (—) ni demi-cadratin (–) dans le texte courant. Le modèle en
// laisse parfois passer malgré la consigne → nettoyage mécanique à la source,
// appliqué UNIQUEMENT aux fragments générés (updated des modifications,
// réécritures), jamais au texte original de l'article.
// ─────────────────────────────────────────────────────────────────────────────

const DASH_RX = /[—–]/;

/**
 * Variante TEXTE BRUT (réécriture d'un passage sélectionné).
 *   - plage numérique « 2022–2024 » → trait d'union simple « 2022-2024 »
 *   - « a — b » (tiret espacé = incise) → « a ; b »
 *   - tiret collé résiduel « a—b » → « a, b »
 */
export const stripForbiddenDashesText = (text) => {
  if (!text || !DASH_RX.test(text)) return text;
  return text
    .replace(/(\d)\s*[—–]\s*(\d)/g, '$1-$2')
    .replace(/\s+[—–]\s+/g, ' ; ')
    .replace(/\s*[—–]\s*/g, ', ');
};

/**
 * Variante HTML (fragments de modifications, sections réécrites).
 * Ne touche PAS aux titres h1-h6 : les conventions de titre du site
 * (« FAQ — Questions fréquentes ») restent intactes. Retourne le HTML
 * d'origine inchangé si aucun tiret interdit n'est présent.
 */
export const stripForbiddenDashes = (html) => {
  if (!html || !DASH_RX.test(html) || typeof document === 'undefined') return html;
  const root = document.createElement('div');
  root.innerHTML = html;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let changed = false;
  const texts = [];
  while (walker.nextNode()) texts.push(walker.currentNode);
  for (const t of texts) {
    if (!DASH_RX.test(t.nodeValue)) continue;
    if (t.parentElement && t.parentElement.closest('h1, h2, h3, h4, h5, h6')) continue;
    const nv = stripForbiddenDashesText(t.nodeValue);
    if (nv !== t.nodeValue) { t.nodeValue = nv; changed = true; }
  }
  return changed ? root.innerHTML : html;
};

/**
 * Applique le garde-fou aux modifications générées par l'agent : seul le champ
 * `updated` (contenu qui ENTRE dans l'article) est nettoyé — `original` et
 * `anchor` servent au matching contre l'article et ne doivent jamais changer.
 */
export const applyStyleGuards = (updates) => {
  if (!Array.isArray(updates)) return updates;
  return updates.map(u => (
    u && typeof u.updated === 'string' && u.updated && DASH_RX.test(u.updated)
      ? { ...u, updated: stripForbiddenDashes(u.updated) }
      : u
  ));
};
