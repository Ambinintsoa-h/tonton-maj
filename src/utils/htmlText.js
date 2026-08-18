/**
 * htmlText.js — HTML → TEXTE NU. Une seule implémentation, deux défauts réels.
 *
 * Créé le 18 août 2026 après deux symptômes qui n'avaient rien à voir en surface
 * et tout à voir en profondeur : du HTML manipulé comme s'il était du texte.
 *
 * 1. « Suggestion(s) 1, 2 : passage cité mais introuvable dans ce texte. »
 *    L'audit cite ses passages AVEC leur balisage — `<li><strong>Le bilan</strong>
 *    : plusieurs dizaines de millions…`. `markSuggestions` cherche dans des NŒUDS
 *    TEXTE, où les chevrons n'existent pas : l'appariement était impossible, quelle
 *    que soit la finesse de `locatePassage`. Le helper existait (`texteNu`) et il
 *    était même appliqué à `updated` — mais pas à `original`, le seul cité quand la
 *    suggestion n'est pas encore appliquée. Donc TOUTE suggestion citant un bloc
 *    balisé était déclarée introuvable.
 *
 * 2. « God of War : découvrez l&rsquo;ordre de jeu complet »
 *    L'API REST de WordPress rend `title.rendered`, qui porte les ENTITÉS. Poussé
 *    tel quel dans un `<input type="text">`, React l'affiche littéralement — et
 *    c'est cette chaîne-là qui repartait à la publication. Le titre n'était pas
 *    seulement laid à l'écran : il était faux à la source.
 *
 * Le repli sans DOM n'est pas décoratif : les tests Node et le rendu côté serveur
 * passent ici. Rendre la chaîne inchangée en silence aurait fait « marcher » les
 * tests tout en laissant le défaut en production.
 */

/** Les entités nommées que WordPress produit réellement dans un titre. */
const ENTITES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', laquo: '«', raquo: '»',
  hellip: '…', ndash: '–', mdash: '—', eacute: 'é', egrave: 'è', agrave: 'à',
  ccedil: 'ç', ucirc: 'û', ocirc: 'ô', icirc: 'î', ecirc: 'ê', acirc: 'â',
  euro: '€', deg: '°', times: '×', middot: '·', bull: '•',
};

/**
 * UNE SEULE PASSE, délibérément.
 *
 * La version enchaînée (`.replace` numérique, puis `.replace` nommé) RE-DÉCODAIT
 * son propre résultat : `&#38;lt;` donnait `&lt;` à la première passe, que la
 * seconde transformait en `<`. Une entité présente dans les DONNÉES devenait du
 * balisage — exactement ce qu'un échappement sert à empêcher. Attrapé par son test.
 */
const ENTITE_RX = /&(?:#x([0-9a-f]+)|#(\d+)|([a-z]+));/gi;

const decodeSansDom = (s) => s.replace(ENTITE_RX, (m, hex, dec, nom) => {
  try {
    if (hex) return String.fromCodePoint(parseInt(hex, 16));
    if (dec) return String.fromCodePoint(Number(dec));
  } catch { return m; }         // point de code invalide : on laisse tel quel
  const v = ENTITES[String(nom).toLowerCase()];
  return v === undefined ? m : v;
});

/**
 * TEXTE NU d'un fragment HTML : balises retirées, entités décodées.
 *
 * Le passage par `innerHTML` fait les deux d'un coup et suit exactement les règles
 * du navigateur — c'est ce qui compte, puisque c'est lui qui affiche l'article.
 */
export const htmlToText = (frag) => {
  const s = String(frag == null ? '' : frag);
  if (!s) return '';
  if (typeof document === 'undefined') return decodeSansDom(s.replace(/<[^>]*>/g, ''));
  const d = document.createElement('div');
  d.innerHTML = s;
  return d.textContent || '';
};

/**
 * DÉCODE les entités d'un texte censé être nu, sans rien interpréter comme balise.
 *
 * Distinct de `htmlToText`, et la distinction est le cœur du correctif du titre :
 * un titre est du TEXTE. « Comparatif <10 kW » passé par `innerHTML` verrait
 * `<10 kW` avalé comme une balise inconnue et le titre perdrait sa fin, en
 * silence. On ne décode donc que les entités, on ne retire aucune balise.
 */
export const decodeEntities = (s) => decodeSansDom(String(s == null ? '' : s));
