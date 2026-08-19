/**
 * R8 — LE CODE POSE LE GRAS LIÉ AU MOT-CLÉ.
 *
 * Constat d'Andrianina, 19 août 2026 : « les mots importants en lien avec le
 * mot-clé principal en gras ne sont pas encore en évidence. »
 *
 * MESURÉ sur l'article God of War produit ce jour-là, et le chiffre explique tout :
 * 29 passages en gras, dont **19 de purs chiffres** (notes Metacritic, prix,
 * durées). Le mot « ordre » figurait 8 fois dans le texte, 2 fois en gras. Sur
 * 15 sections H2 : 5 sans aucun gras, 7 avec un seul (sous le plancher de 2), une
 * seule conforme, 2 au-dessus du plafond. La section titrée « Quel ordre suivre
 * god of war en 2026 ? » — 197 mots, le cœur du sujet — portait UN gras :
 * « 60 à 80 heures ». Une durée.
 *
 * Le modèle n'a retenu qu'UNE des quatre catégories demandées, la plus mécanique.
 * Quatrième occurrence du même schéma dans la même journée (plafond de 20 mots,
 * `[à vérifier]`, maillage forcé sur zéro paire) : une consigne que rien ne mesure
 * ni ne force n'a aucun effet observable.
 *
 * ── CE QUE LE CODE SAIT, ET CE QU'IL NE DEVINE PAS ──────────────────────────
 * Question posée par Andrianina avant de valider — « est-ce que le code sait quel
 * texte doit l'être ? » Réponse honnête : pour une part bien délimitée, oui, parce
 * que ce sont des DONNÉES FOURNIES et non des inférences :
 *   • le mot-clé cible, chaîne exacte saisie par le rédacteur ;
 *   • ses mots-clés secondaires (renvoyés par la génération, ou saisis) ;
 *   • les termes déjà en gras dans l'article d'origine — choix humain déjà validé,
 *     traité en amont par `carryOverBold` (R5).
 *
 * Ce que le code NE sait PAS, et n'essaie pas : qu'« hack'n'slash » est du
 * vocabulaire technique du sujet. C'est indérivable de « quel ordre suivre god of
 * war ». Cette part reste au prompt (skill « Style d'écriture ») et à la MESURE
 * (`constatGras`) : le rédacteur voit l'écart au lieu de le supposer.
 *
 * D'où la règle qui borne tout ce module : SI UNE SECTION N'OFFRE AUCUN CANDIDAT
 * PROUVABLE, LE CODE NE MET RIEN EN GRAS ET LE SIGNALE. Poser un gras arbitraire
 * pour faire le compte remplacerait un défaut mesurable par un défaut invisible —
 * c'est le même arbitrage que `weaveBriefLinks`, qui refuse de fabriquer une
 * clause quand aucun paragraphe n'est éligible.
 *
 * ── PÉRIMÈTRE VOLONTAIREMENT ÉTROIT ─────────────────────────────────────────
 * Le code ne remplit QUE les sections SOUS le plancher. Il ne retire JAMAIS un
 * gras posé par le modèle, même quand une section dépasse le plafond : ce serait
 * défaire un choix éditorial pour appliquer une borne, et `constatGras` le signale
 * déjà. Sur l'article mesuré, cela couvre 12 sections sur 15 — l'essentiel du gain,
 * sans jamais rien casser.
 *
 * DÉTERMINISTE, aucun appel IA, aucune phrase réécrite : on enveloppe des mots qui
 * sont déjà là, exactement comme le tissage d'une ancre (`weaveBriefLinks`).
 */
import {
  NO_BOLD_SEL, GRAS_MIN_PAR_H2, GRAS_MAX_MOTS, listBoldTerms,
} from './boldCarry';

const norm = (s = '') => String(s).replace(/\s+/g, ' ').trim();

/** Longueur mini d'un passage : « m2 » ou « et » ne portent aucun sens. */
const MIN_CARS = 4;

/** Mots vides : ils ne portent aucun sens et feraient apparier n'importe quoi. */
const MOTS_VIDES = new Set([
  'le', 'la', 'les', 'un', 'une', 'des', 'du', 'de', 'au', 'aux', 'et', 'ou',
  'quel', 'quelle', 'quels', 'quelles', 'que', 'qui', 'quoi', 'dont', 'pour',
  'par', 'sur', 'sous', 'dans', 'avec', 'sans', 'en', 'a', 'à', 'of', 'the',
  'est', 'sont', 'ce', 'cet', 'cette', 'son', 'sa', 'ses', 'plus', 'comment',
]);

/** Mots significatifs d'une expression, accents conservés, en minuscules. */
export const motsSignificatifs = (s = '') => String(s)
  .toLowerCase()
  .split(/[^\p{L}\p{N}'’-]+/u)
  .filter((m) => m.length >= 3 && !MOTS_VIDES.has(m));

/** Échappe une chaîne pour un usage littéral dans une expression régulière. */
const echappe = (s = '') => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Un passage est-il un pur chiffre (note, prix, durée, date) ? */
const estChiffre = (s = '') => /\d/.test(s);

/**
 * CANDIDATS d'un texte, par ordre de priorité DÉCROISSANTE.
 *
 * Les chiffres sont délibérément la DERNIÈRE priorité : c'est la pathologie
 * mesurée (19 sur 29). Les reléguer libère la place pour les catégories qui
 * portent le mot-clé, et ce tri suffit — aucun jugement sémantique n'est requis.
 *
 * @returns {string[]} passages présents TELS QUELS dans `texte`
 */
export const candidatsGras = (texte = '', targetKeyword = '', secondaires = []) => {
  const t = String(texte || '');
  if (!t) return [];
  const out = [];
  const vus = new Set();

  const ajoute = (s) => {
    const v = norm(s);
    if (!v || v.length < MIN_CARS) return;
    if (v.split(' ').length > GRAS_MAX_MOTS) return;
    const cle = v.toLowerCase();
    if (vus.has(cle)) return;
    vus.add(cle);
    out.push(v);
  };
  const trouve = (rx) => {
    let m;
    rx.lastIndex = 0;
    while ((m = rx.exec(t)) !== null) {
      ajoute(m[0]);
      if (m[0] === '') break;                 // garde-fou anti-boucle infinie
    }
  };

  const mots = motsSignificatifs(targetKeyword);

  // 1. Le mot-clé EXACT, tel que saisi par le rédacteur.
  const exact = norm(targetKeyword);
  if (exact) trouve(new RegExp(echappe(exact), 'gi'));

  // 2. Un groupe recoupant DEUX mots significatifs du mot-clé, à courte distance.
  //    Fenêtre volontairement serrée (un mot d'écart au plus) : sans elle on
  //    attraperait deux mots éloignés d'une même phrase, et le gras couvrirait
  //    une ligne entière — ce que la règle 10 interdit explicitement.
  for (let i = 0; i < mots.length; i += 1) {
    for (let j = 0; j < mots.length; j += 1) {
      if (i === j) continue;
      trouve(new RegExp(
        `\\b${echappe(mots[i])}\\p{L}*\\s+(?:\\p{L}+\\s+)?${echappe(mots[j])}\\p{L}*\\b`, 'giu',
      ));
    }
  }

  // 3. Le mot-tête du mot-clé AVEC son complément adjacent : « ordre
  //    chronologique », « ordre de sortie », « ordre idéal ». Priorité validée
  //    explicitement par Andrianina — c'est le gros du gain.
  mots.forEach((m) => {
    trouve(new RegExp(`\\b${echappe(m)}\\p{L}*\\s+(?:de\\s+|du\\s+|des\\s+|d['’])?\\p{L}{3,}\\b`, 'giu'));
    trouve(new RegExp(`\\b\\p{L}{3,}\\s+${echappe(m)}\\p{L}*\\b`, 'giu'));
  });

  // 4. Les mots-clés secondaires — FOURNIS, jamais devinés.
  (Array.isArray(secondaires) ? secondaires : []).forEach((s) => {
    const v = norm(s);
    if (v) trouve(new RegExp(echappe(v), 'gi'));
  });

  // 5. Les chiffres avec unité, EN DERNIER seulement.
  trouve(/\b\d+(?:[.,]\d+)?\s*(?:\/\s*100|%|€|\$|h\b|heures?|mois|ans?|millions?|milliards?)/gi);

  // Le tri final est le correctif : tout ce qui n'est pas un chiffre d'abord.
  return [...out.filter((s) => !estChiffre(s)), ...out.filter(estChiffre)];
};

/**
 * POSE le gras lié au mot-clé dans les sections SOUS le plancher.
 *
 * @param {string} html
 * @param {{targetKeyword?:string, secondaires?:string[]}} opts
 * @returns {{ html:string, placed:Array<{terme:string, section:string}>,
 *             sansCandidat:string[] }}
 *   `sansCandidat` porte les titres des sections où le code n'a RIEN trouvé de
 *   prouvable. C'est l'exception assumée : elle doit être DITE, pas maquillée.
 */
export const weaveKeywordBold = (html = '', { targetKeyword = '', secondaires = [] } = {}) => {
  const aucun = { html, placed: [], sansCandidat: [] };
  if (!html || typeof document === 'undefined') return aucun;
  if (!norm(targetKeyword) && !(Array.isArray(secondaires) ? secondaires : []).length) return aucun;

  const root = document.createElement('div');
  root.innerHTML = html;

  // Un même terme n'est mis en gras QU'UNE FOIS dans tout l'article (règle 10).
  const dejaGras = new Set(listBoldTerms(html).map((t) => t.toLowerCase()));
  const placed = [];
  const sansCandidat = [];

  // Découpage en sections H2 — même logique que `constatGras`, à dessein : les
  // deux doivent compter la même chose, sinon la mesure contredirait la pose.
  const sections = [];
  let courante = null;
  Array.from(root.children).forEach((el) => {
    if (el.tagName === 'H2') {
      courante = { titre: norm(el.textContent), blocs: [] };
      sections.push(courante);
      return;
    }
    if (courante) courante.blocs.push(el);
  });

  const grasDe = (blocs) => blocs.reduce((n, b) => n
    + Array.from(b.querySelectorAll('strong, b'))
      .filter((e) => !e.closest('h1, h2, h3, h4, h5, h6') && !e.closest('a')).length, 0);

  sections.forEach((sec) => {
    let n = grasDe(sec.blocs);
    if (n >= GRAS_MIN_PAR_H2) return;               // conforme : on ne touche à rien

    const texte = sec.blocs.map((b) => b.textContent || '').join(' ');
    const cands = candidatsGras(texte, targetKeyword, secondaires)
      .filter((c) => !dejaGras.has(c.toLowerCase()));
    if (!cands.length) { sansCandidat.push(sec.titre); return; }

    let posesIci = 0;
    for (const terme of cands) {
      if (n >= GRAS_MIN_PAR_H2) break;
      let pose = false;
      for (const bloc of sec.blocs) {
        const walker = document.createTreeWalker(bloc, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) {
          const parent = node.parentElement;
          if (!parent || typeof parent.closest !== 'function') continue;
          if (parent.closest(NO_BOLD_SEL) || parent.closest('strong, b')) continue;
          const idx = (node.textContent || '').indexOf(terme);
          if (idx === -1) continue;
          try {
            const range = document.createRange();
            range.setStart(node, idx);
            range.setEnd(node, idx + terme.length);
            const strong = document.createElement('strong');
            range.surroundContents(strong);
            pose = true;
          } catch { /* plage à cheval sur une balise : on passe au candidat suivant */ }
          break;
        }
        if (pose) break;
      }
      if (pose) {
        placed.push({ terme, section: sec.titre });
        dejaGras.add(terme.toLowerCase());
        n += 1;
        posesIci += 1;
      }
    }
    // Des candidats existaient dans le texte, mais aucun n'a pu être enveloppé
    // (tous à cheval sur des balises, ou déjà en gras ailleurs). C'est un échec,
    // et il se dit.
    if (!posesIci) sansCandidat.push(sec.titre);
  });

  if (!placed.length) return { html, placed, sansCandidat };
  return { html: root.innerHTML, placed, sansCandidat };
};

/** Ligne remontée au rédacteur. Elle DIT aussi ce que le code n'a pas pu faire. */
export const boldReportLine = ({ placed = [], sansCandidat = [] } = {}) => {
  const bouts = [];
  if (placed.length) {
    const apercu = [...new Set(placed.map((p) => p.terme))].slice(0, 4);
    bouts.push(`${placed.length} passage(s) mis en gras d'après le mot-clé (${apercu.join(', ')}${placed.length > apercu.length ? '…' : ''})`);
  }
  if (sansCandidat.length) {
    bouts.push(`${sansCandidat.length} section(s) sans candidat prouvable — à mettre en gras à la main (${sansCandidat.slice(0, 2).join(', ')}${sansCandidat.length > 2 ? '…' : ''})`);
  }
  return bouts.length ? `🅱️ ${bouts.join(' — ')}.` : '';
};
