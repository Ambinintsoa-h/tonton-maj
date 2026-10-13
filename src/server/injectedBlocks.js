'use strict';
/**
 * src/server/injectedBlocks.js — blocs AFFICHÉS par le thème mais ABSENTS du
 * contenu WordPress : ils ne font pas partie de l'article et ne passent jamais
 * dans une MAJ.
 *
 * Incident du 13/10/2026 (ludikbazar.com, signalé par Andrianina). L'encart vert
 * « 🔥 Nous recommandons Philibert » (div.gb-element-…, GenerateBlocks) est
 * ajouté par le thème À L'AFFICHAGE, en tête de chaque article : il n'est pas
 * dans le contenu enregistré (l'API REST ne le renvoie pas). Le scraping, lui,
 * lit la page affichée et le capte comme du texte d'article. L'IA le réécrit
 * donc en paragraphes ordinaires (titre, texte, « J'en profite »), la passe de
 * gras y pose du gras, et la publication l'ENREGISTRE dans l'article. Résultat
 * en ligne : l'encart du thème, puis sa copie juste sous le chapô. 12 articles
 * du site la portaient au moment du constat.
 *
 * La règle, générique (aucun site ni aucune classe codés en dur) : on compare la
 * page affichée au contenu que WordPress renvoie par son API REST publique. Un
 * bloc de premier niveau de `.entry-content` dont AUCUNE classe ni id n'existe
 * dans ce contenu a été ajouté à l'affichage → retiré avant toute analyse. Le
 * thème continue de l'afficher avant ET après la MAJ, intact — comme le widget
 * Google « prefG » déjà traité par scrapeClean.js.
 *
 * Et les articles déjà touchés : la copie enregistrée par une MAJ précédente est
 * reconnue (même texte, bloc pour bloc, qu'un bloc injecté de la MÊME page) et
 * retirée elle aussi. La MAJ suivante répare donc l'article.
 *
 * Garde-fous (on ne retire que ce dont on est sûr ; dans le doute, rien) :
 *   • seulement des conteneurs (div, section, aside) qui portent du TEXTE : un
 *     habillage de vidéo ajouté par un plugin de cache (sans texte, avec une
 *     iframe) n'est jamais touché ;
 *   • si le texte renvoyé par l'API est bien plus court que la page (constructeur
 *     de page, contenu protégé…), la comparaison n'a pas de sens : rien n'est
 *     retiré ;
 *   • rien n'est retiré non plus si cela emporterait plus de 40 % du texte.
 */

const CONTENEURS = new Set(['DIV', 'SECTION', 'ASIDE']);
const MEDIAS = 'iframe, video, embed, object';
const TEXTE_MIN_BLOC = 20;        // caractères : un bloc injecté porte du texte
const TEXTE_MIN_COPIE = 8;        // « J'en profite » (12) oui, « OK » non
const RATIO_REST_MIN = 0.6;       // texte API / texte page en dessous duquel on s'abstient
const PART_MAX_RETIREE = 0.4;     // jamais plus de 40 % du texte de la page

const norm = (s) => String(s || '')
  .replace(/[  ]/g, ' ')
  .replace(/[’‘]/g, "'")
  .replace(/\s+/g, ' ')
  .trim();

const texteHtml = (html) => norm(String(html || '').replace(/<[^>]*>/g, ' ')
  .replace(/&nbsp;|&#160;/gi, ' ').replace(/&#8217;|&rsquo;/gi, "'"));

const jetons = (el) => [...(el.classList || [])].concat(el.id ? [el.id] : []).filter(Boolean);

/** `.entry-content` qui porte le plus de texte (un thème peut en avoir plusieurs). */
const conteneurArticle = (doc) => {
  const cands = [...doc.querySelectorAll('.entry-content')];
  if (!cands.length) return null;
  return cands.sort((a, b) => norm(b.textContent).length - norm(a.textContent).length)[0];
};

/**
 * Retire de `doc` (DOM BRUT de la page, avant Readability) les blocs ajoutés à
 * l'affichage et leurs copies déjà enregistrées.
 *
 * @param {Document} doc
 * @param {string} restHtml  `content.rendered` de l'API REST WordPress
 * @returns {{ retires: Array<{bloc:string, extrait:string}>, copies: string[], ignore: string|null }}
 */
const retirerBlocsInjectes = (doc, restHtml) => {
  const vide = (ignore) => ({ retires: [], copies: [], ignore });
  const rest = String(restHtml || '');
  if (!doc || !rest.trim()) return vide('contenu WordPress indisponible');
  const conteneur = conteneurArticle(doc);
  if (!conteneur) return vide('pas de .entry-content');

  const textePage = norm(conteneur.textContent).length;
  if (!textePage) return vide('page sans texte');
  if (texteHtml(rest).length / textePage < RATIO_REST_MIN) {
    return vide('contenu WordPress trop différent de la page (constructeur de page ?)');
  }

  const injectes = [...conteneur.children].filter((el) => {
    if (!CONTENEURS.has(el.tagName)) return false;
    const tk = jetons(el);
    if (!tk.length) return false;
    if (tk.some((t) => rest.includes(t))) return false;      // présent dans le contenu enregistré
    if (el.querySelector(MEDIAS)) return false;               // habillage de média
    return norm(el.textContent).length >= TEXTE_MIN_BLOC;
  });
  if (!injectes.length) return vide(null);

  // Fragments de texte des blocs injectés : chaque paragraphe, titre, puce ou
  // lien isolé. Une copie enregistrée reprend ces fragments un à un.
  const fragments = new Set();
  injectes.forEach((el) => {
    el.querySelectorAll('p, li, h1, h2, h3, h4, h5, h6, a').forEach((n) => {
      const t = norm(n.textContent);
      if (t.length >= TEXTE_MIN_COPIE) fragments.add(t);
    });
  });
  const copies = [...conteneur.children].filter((el) => !injectes.includes(el)
    && /^(P|H[2-6])$/.test(el.tagName)
    && fragments.has(norm(el.textContent)));

  const retireTexte = [...injectes, ...copies].reduce((n, el) => n + norm(el.textContent).length, 0);
  if (retireTexte / textePage > PART_MAX_RETIREE) {
    return vide(`retrait refusé : ${Math.round((retireTexte / textePage) * 100)} % du texte de la page`);
  }

  const rapport = {
    retires: injectes.map((el) => ({ bloc: `${el.tagName.toLowerCase()}.${jetons(el).join('.')}`, extrait: norm(el.textContent).slice(0, 80) })),
    copies: copies.map((el) => norm(el.textContent).slice(0, 80)),
    ignore: null,
  };
  [...injectes, ...copies].forEach((el) => el.remove());
  return rapport;
};

/**
 * Adresses de l'API REST publique à essayer pour une page WordPress : article,
 * puis page, par slug (même méthode que wp_get_post dans proxy.js).
 */
const urlsRestWordPress = (pageUrl) => {
  let u;
  try { u = new URL(pageUrl); } catch { return []; }
  const slug = u.pathname.replace(/\/+$/, '').split('/').filter(Boolean).pop() || '';
  if (!slug) return [];
  const s = encodeURIComponent(decodeURIComponent(slug));
  return ['posts', 'pages'].map((type) => `${u.origin}/wp-json/wp/v2/${type}?slug=${s}&_fields=id,content`);
};

/** Une page servie par WordPress ? (évite une requête inutile ailleurs) */
const estPageWordPress = (html) => /\/wp-content\/|\/wp-includes\/|wp-json/i.test(String(html || '').slice(0, 300000));

module.exports = { retirerBlocsInjectes, urlsRestWordPress, estPageWordPress, norm };
