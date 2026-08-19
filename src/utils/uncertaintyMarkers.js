/**
 * uncertaintyMarkers.js — LES MARQUEURS DE DOUTE NE PARTENT JAMAIS EN LIGNE.
 *
 * Consigne d'Andrianina, août 2026 : « Ne jamais mettre des : [à vérifier] etc. »
 *
 * Le défaut était mesuré, pas supposé. Sur la génération du 19/08, l'article
 * produit portait **trois** `[à vérifier]` — alors que l'audit avait mis en action
 * **P1** « Lever les mentions [à vérifier] restées dans le texte publié », et que
 * cette action était **cochée**. Le modèle a donc lu la consigne, puis en a écrit
 * trois de plus. Même leçon que le gras et le plafond de 20 mots : une consigne de
 * prompt qu'on ne mesure jamais est une consigne dont on ne sait rien.
 *
 * ── CE QU'ON RETIRE, ET CE QU'ON NE TOUCHE PAS ───────────────────────────────
 * Une liste EXPLICITE de marqueurs, jamais « tout ce qui est entre crochets ». Un
 * article légitime en contient : « God of War [2018] », « [sic] », une précision
 * entre crochets dans une citation. Les effacer serait abîmer le texte pour
 * appliquer une règle de forme.
 *
 * ── POURQUOI ON LE DIT AU RÉDACTEUR ──────────────────────────────────────────
 * Un `[à vérifier]` signale une affirmation NON SOURCÉE. Le retirer en silence
 * rendrait le doute invisible : la phrase resterait, l'avertissement disparaîtrait,
 * et l'article partirait en ligne avec une affirmation que personne n'a vérifiée —
 * exactement l'inverse du but. On retire la MARQUE et on remonte la PHRASE, pour
 * que le rédacteur décide : sourcer, nuancer, ou couper.
 *
 * Même principe que partout dans ce projet : on MONTRE, on ne masque pas.
 */

/**
 * Marqueurs retirés. Chaque motif décrit un crochet ENTIER, avec son contenu :
 * on ne retire jamais un crochet dont le contenu n'a pas été reconnu.
 * L'accent est optionnel (le modèle écrit parfois « a verifier »), et l'espace
 * intérieur est toléré.
 */
const MARQUEURS = [
  /\[\s*(?:à|a)\s+v[eé]rifier\s*\]/gi,
  /\[\s*(?:à|a)\s+confirmer\s*\]/gi,
  /\[\s*(?:à|a)\s+sourcer\s*\]/gi,
  /\[\s*(?:à|a)\s+compl[eé]ter\s*\]/gi,
  /\[\s*non\s+v[eé]rifi[eé]e?s?\s*\]/gi,
  /\[\s*non\s+confirm[eé]e?s?\s*\]/gi,
  /\[\s*source\s*\?*\s*\]/gi,
  /\[\s*sources?\s+(?:à|a)\s+(?:v[eé]rifier|trouver|ajouter)\s*\]/gi,
  /\[\s*citation\s+needed\s*\]/gi,
  /\[\s*todo\s*\]/gi,
  /\[\s*\?+\s*\]/g,
];

/** Le texte contient-il au moins un marqueur ? */
export const hasUncertaintyMarker = (s = '') =>
  MARQUEURS.some((rx) => { rx.lastIndex = 0; return rx.test(String(s)); });

/**
 * Nettoie les espaces laissés par le retrait d'un marqueur.
 *
 * « mal identifiée [à vérifier]. » deviendrait « mal identifiée . » sans ça : une
 * espace avant le point, visible à l'écran comme en ligne. Et un marqueur en
 * milieu de phrase laisse une double espace.
 */
const recolle = (s) => String(s)
  // ORDRE IMPORTANT. Les parenthèses devenues vides partent EN PREMIER : les
  // supprimer plus tard créerait une espace avant le point (« 64/100 . ») que les
  // règles d'espacement, déjà passées, ne rattraperaient plus.
  .replace(/\(\s*\)/g, '')          // un marqueur seul entre parenthèses
  .replace(/\[\s*\]/g, '')          // idem entre crochets imbriqués
  .replace(/\(\s+/g, '(')
  .replace(/[ \t]{2,}/g, ' ')
  .replace(/[ \t]+([,.;:!?…)\]])/g, '$1')
  .replace(/[ \t]+$/gm, '');

/** Phrase portant l'offset donné, pour la remonter au rédacteur. */
const phraseAutour = (texte, at) => {
  const debut = Math.max(0, texte.lastIndexOf('.', at - 1) + 1);
  let fin = texte.indexOf('.', at);
  if (fin === -1) fin = texte.length;
  return texte.slice(debut, fin + 1).replace(/\s+/g, ' ').trim();
};

/**
 * RETIRE les marqueurs de doute du HTML, et REMONTE les phrases concernées.
 *
 * Opère sur la chaîne et non sur le DOM : un marqueur est du texte, jamais du
 * balisage, et passer par `innerHTML` ferait courir le risque de réécrire du HTML
 * qu'on n'a aucune raison de toucher.
 *
 * @param {string} html
 * @returns {{ html: string, removed: Array<{marker:string, sentence:string}> }}
 */
export const stripUncertaintyMarkers = (html = '') => {
  const src = String(html || '');
  if (!src) return { html: src, removed: [] };

  // Les phrases sont relevées sur le TEXTE, pas sur le HTML : remonter
  // « identifiée [à vérifier].</p><p>Suivant » au rédacteur n'aurait aucun sens.
  const removed = [];
  let texte = src;
  if (typeof document !== 'undefined') {
    const d = document.createElement('div');
    d.innerHTML = src;
    texte = d.textContent || '';
  }
  MARQUEURS.forEach((rx) => {
    rx.lastIndex = 0;
    let m;
    while ((m = rx.exec(texte)) !== null) {
      removed.push({ marker: m[0].trim(), sentence: phraseAutour(texte, m.index) });
      if (m[0] === '') break;              // garde-fou : jamais de boucle infinie
    }
  });
  if (!removed.length) return { html: src, removed: [] };

  let out = src;
  MARQUEURS.forEach((rx) => { rx.lastIndex = 0; out = out.replace(rx, ''); });
  return { html: recolle(out), removed };
};

/**
 * Ligne remontée au rédacteur. Elle NOMME les phrases : c'est tout l'intérêt du
 * dispositif — le marqueur part, le doute reste connu.
 */
export const uncertaintyReportLine = (removed = []) => {
  if (!removed || !removed.length) return '';
  const n = removed.length;
  const phrases = [...new Set(removed.map((r) => r.sentence))].slice(0, 3);
  return `⚠️ ${n} marqueur(s) de doute retiré(s) du texte (${[...new Set(removed.map((r) => r.marker))].join(', ')}) `
    + '— ils ne doivent JAMAIS partir en ligne. Les affirmations concernées restent À VÉRIFIER : '
    + phrases.map((p) => `« ${p} »`).join(' ')
    + (n > phrases.length ? ` (+ ${n - phrases.length} autre(s))` : '');
};
