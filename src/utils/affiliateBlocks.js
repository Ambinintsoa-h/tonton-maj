/**
 * affiliateBlocks.js — MODE AFFILIATION : L'IA N'ÉMET PLUS UNE SEULE BALISE.
 *
 * Décision Andrianina, 16 septembre 2026, après l'échec de génération sur
 * `cyber-securite.fr/meilleur-antivirus/` : 1 714 mots de texte pour
 * 113 898 caractères de HTML, 32 liens externes tous en affiliation, deux
 * encarts comparatifs de 14 Ko, six boutons « VOIR + » vers six URL
 * différentes, et deux boutons du widget Google Discover dont l'ancre est une
 * IMAGE.
 *
 * ── POURQUOI LA REFONTE NORMALE NE PEUT PAS MARCHER ICI ─────────────────────
 * Elle demande au modèle de RENVOYER L'ARTICLE ENTIER en HTML. Sur ce type
 * d'article, ça revient à lui demander de recopier 113 Ko d'encarts sans en
 * altérer un seul caractère — et le verrou liens externes (règle 8) rejette
 * la génération dès qu'un href manque. Pire : un lien dont l'ancre est une
 * image ne peut même pas être réparé, parce que la réparation réenveloppe le
 * TEXTE de l'ancre et qu'il n'y en a pas (`externalLinksOf`, diff.js).
 * Trois essais, trois rejets, et la génération tombe.
 *
 * ── CE QUE FAIT CE MODULE ───────────────────────────────────────────────────
 * Il inverse le partage des rôles, exactement comme la passe de gras (règle 10,
 * « l'IA nomme, le code applique ») :
 *
 *   1. le code EXTRAIT les blocs de prose, et eux seuls ;
 *   2. dans chaque bloc, il MASQUE les balises inline en gardant leur texte
 *      lisible — `⟦1⟧Bitdefender⟦/1⟧` — pour que le modèle comprenne la phrase
 *      sans jamais voir un href ;
 *   3. le modèle renvoie du TEXTE, jamais du HTML ;
 *   4. le code RECOLLE les balises d'origine, attributs compris.
 *
 * Le `href` ne peut structurellement pas changer : il ne sort jamais du code.
 * Les encarts, boutons, images et tableaux ne sont même pas soumis — on ne peut
 * pas abîmer ce qu'on n'a pas envoyé (même garde-fou que la FAQ dans la passe
 * de gras).
 *
 * ── CE QUI EST REFUSÉ, ET DIT ───────────────────────────────────────────────
 * Un marqueur manquant au retour → le bloc n'est PAS appliqué, il reste tel
 * quel, et c'est compté. Une réécriture vide ou hors de proportion → pareil.
 * Un texte d'ancre modifié → appliqué (le lien reste bon) mais SIGNALÉ : le mot
 * a changé, le rédacteur doit le savoir avant de publier.
 */

/** Balises de bloc dont la prose est réécrite. Jamais une div, jamais un td. */
const BLOCS_PROSE = ['P', 'H2', 'H3', 'H4'];

/** Balises inline masquées puis recollées. `A` est la raison d'être du module. */
const INLINE_PROTEGEES = ['A', 'STRONG', 'B', 'EM', 'I', 'SPAN'];

/**
 * En dessous, ce n'est pas de la prose : un libellé de bouton (« VOIR + »,
 * « Visiter le site »), une mention légale, un intitulé de carte. Les envoyer
 * ferait réécrire l'interface du comparatif.
 */
export const MOTS_MIN_BLOC = 8;

/**
 * Classes et identifiants qui signalent un ENCART, pas du texte d'article.
 * Volontairement large côté vocabulaire (affil, sponsor, cta, card, widget…) et
 * complétée par ce qu'on a réellement relevé en production : `mg-anti_*` (les
 * comparatifs antivirus), `prefG-*` (le widget Google Discover, déjà connu pour
 * être capté à tort par le scraping).
 */
const ENCART_RX = /affil|sponsor|partenaire|\bcta\b|bouton|btn|button|card|carte|widget|encart|offre|promo|coupon|comparatif|top3|mg-anti|prefG|entity-placement|source-prefere/i;

/** Marqueurs : des caractères qu'aucun texte d'article ne contient. */
const OUVRANT = (n) => `⟦${n}⟧`;
const FERMANT = (n) => `⟦/${n}⟧`;
/** Tolère les espaces que le modèle ajoute parfois autour du numéro. */
const marqueurRx = (n) => new RegExp(`\\u27E6\\s*${n}\\s*\\u27E7([\\s\\S]*?)\\u27E6\\s*/\\s*${n}\\s*\\u27E7`);

const motsDe = (s) => String(s || '').trim().split(/\s+/).filter(Boolean).length;

const echappe = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** L'élément, ou un de ses ancêtres, porte-t-il la marque d'un encart ? */
const dansUnEncart = (el, racine) => {
  let n = el;
  while (n && n !== racine) {
    const cls = typeof n.className === 'string' ? n.className : '';
    if (ENCART_RX.test(`${cls} ${n.id || ''}`)) return true;
    if (n.tagName === 'TABLE' || n.tagName === 'FIGURE' || n.tagName === 'BUTTON') return true;
    n = n.parentElement;
  }
  return false;
};

/**
 * Les blocs de prose d'un article, prêts à partir au modèle.
 *
 * @returns {{blocs: Array<{id:number, tag:string, texte:string, liens:number}>,
 *            ecartes: {encart:number, court:number, media:number},
 *            total:number}}
 *   `texte` porte les marqueurs ; il ne contient JAMAIS de balise.
 */
export const extraireBlocsProse = (html = '') => {
  const vide = { blocs: [], ecartes: { encart: 0, court: 0, media: 0 }, total: 0, _index: null };
  if (!html || typeof document === 'undefined') return vide;
  const racine = document.createElement('div');
  racine.innerHTML = html;

  const ecartes = { encart: 0, court: 0, media: 0 };
  const blocs = [];
  const index = new Map();          // id → { el, protegees: Map<n, {tag, attrs}> }
  let id = 0;

  for (const el of Array.from(racine.querySelectorAll(BLOCS_PROSE.join(',')))) {
    // Un média DANS le bloc : on n'y touche pas. Le remplacer par du texte
    // ferait disparaître l'image — R4 la remettrait à une place approximative,
    // et c'est exactement ce qu'on veut éviter sur un comparatif.
    if (el.querySelector('img, iframe, video, table, button')) { ecartes.media += 1; continue; }
    if (dansUnEncart(el.parentElement, racine)) { ecartes.encart += 1; continue; }
    if (motsDe(el.textContent) < MOTS_MIN_BLOC) { ecartes.court += 1; continue; }

    // Masquage des balises inline : le TEXTE reste lisible, la balise disparaît.
    // C'est le point qui fait que le modèle comprend encore la phrase — masquer
    // le lien en entier (« [[LIEN1]] ») lui retirerait le nom du produit.
    const protegees = new Map();
    let n = 0;
    let texte = '';
    const parcourir = (node) => {
      for (const enfant of Array.from(node.childNodes)) {
        if (enfant.nodeType === 3) { texte += enfant.nodeValue; continue; }
        if (enfant.nodeType !== 1) continue;
        if (INLINE_PROTEGEES.includes(enfant.tagName)) {
          n += 1;
          protegees.set(n, {
            tag: enfant.tagName.toLowerCase(),
            attrs: Array.from(enfant.attributes).map(({ name, value }) => [name, value]),
            texteOrigine: (enfant.textContent || '').trim(),
          });
          texte += OUVRANT(n) + (enfant.textContent || '') + FERMANT(n);
          continue;
        }
        parcourir(enfant);   // <br>, <sup>… : on garde le texte, on perd la balise
      }
    };
    parcourir(el);

    id += 1;
    index.set(id, { el, protegees });
    blocs.push({ id, tag: el.tagName.toLowerCase(), texte: texte.replace(/\s+/g, ' ').trim(), liens: protegees.size });
  }

  return { blocs, ecartes, total: blocs.length, _index: { racine, index } };
};

/**
 * Recolle les réécritures dans le HTML d'origine.
 *
 * @param {string} html
 * @param {Array<{id:number, texte:string}>} reecritures
 * @returns {{html:string, appliques:number, rejetes:Array<{id:number, motif:string}>,
 *            ancresModifiees:Array<{avant:string, apres:string}>}}
 */
export const appliquerReecritures = (html = '', reecritures = []) => {
  const extrait = extraireBlocsProse(html);
  const rien = { html, appliques: 0, rejetes: [], ancresModifiees: [] };
  if (!extrait._index || !reecritures.length) return rien;

  const { racine, index } = extrait._index;
  const rejetes = [];
  const ancresModifiees = [];
  let appliques = 0;

  for (const r of reecritures) {
    const cible = index.get(Number(r?.id));
    if (!cible) { rejetes.push({ id: r?.id, motif: 'bloc inconnu' }); continue; }
    const brut = String(r?.texte || '').trim();
    if (!brut) { rejetes.push({ id: r.id, motif: 'réécriture vide' }); continue; }

    // Garde-fou de proportion : une réécriture qui fond de moitié ou triple n'est
    // pas une mise à jour du texte, c'est autre chose. On ne l'applique pas.
    const avant = motsDe(cible.el.textContent);
    const apres = motsDe(brut.replace(/⟦[^⟧]*⟧/g, ''));
    if (avant >= MOTS_MIN_BLOC && (apres < avant * 0.4 || apres > avant * 2.5)) {
      rejetes.push({ id: r.id, motif: `longueur hors bornes (${avant} mots → ${apres})` });
      continue;
    }

    // TOUS les marqueurs doivent être là. Un seul manquant et le lien serait
    // perdu : on préfère un paragraphe périmé à un lien d'affiliation disparu.
    let manquant = null;
    for (const n of cible.protegees.keys()) {
      if (!marqueurRx(n).test(brut)) { manquant = n; break; }
    }
    if (manquant) { rejetes.push({ id: r.id, motif: `marqueur ${manquant} absent de la réponse` }); continue; }

    // Reconstruction : le texte est ÉCHAPPÉ (il vient du modèle, il ne doit pas
    // pouvoir introduire de balise), puis les marqueurs redeviennent les balises
    // d'ORIGINE — attributs compris, href en tête.
    let out = echappe(brut);
    for (const [n, info] of cible.protegees) {
      // MÊME motif que le contrôle de présence ci-dessus (`marqueurRx`) : les
      // marqueurs traversent `echappe` intacts, ils ne portent ni `<` ni `&`.
      out = out.replace(marqueurRx(n), (_m, dedans) => {
        const texteAncre = String(dedans).trim();
        if (info.texteOrigine && texteAncre && texteAncre !== info.texteOrigine) {
          ancresModifiees.push({ avant: info.texteOrigine, apres: texteAncre });
        }
        const attrs = info.attrs.map(([k, v]) => ` ${k}="${String(v).replace(/"/g, '&quot;')}"`).join('');
        return `<${info.tag}${attrs}>${texteAncre}</${info.tag}>`;
      });
    }
    cible.el.innerHTML = out;
    appliques += 1;
  }

  return { html: racine.innerHTML, appliques, rejetes, ancresModifiees };
};
