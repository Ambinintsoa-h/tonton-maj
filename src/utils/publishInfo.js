/**
 * publishInfo.js — « CET ARTICLE A DÉJÀ ÉTÉ PUBLIÉ », dit AVANT de republier.
 *
 * Demande Andrianina, 16 septembre 2026. Le menu « Publier » propose deux
 * actions irréversibles — mettre l'article en ligne, ou le repasser en brouillon
 * (ce qui le RETIRE du site public) — sans jamais dire si quelqu'un l'a déjà
 * publié, quand, ni qui. Sur une file partagée où plusieurs rédacteurs se
 * relaient, c'est l'information qui manque au moment exact où elle compte.
 *
 * ── D'OÙ VIENT L'AUTEUR, ET POURQUOI IL PEUT MANQUER ────────────────────────
 * `publishedAt` est enregistré depuis toujours ; `publishedBy` ne l'est que
 * depuis ce correctif. Les articles publiés avant ne le portent donc pas — et
 * on ne le fabrique pas : `lastModifiedBy` dit qui a ÉDITÉ en dernier, pas qui
 * a publié, et les confondre afficherait un nom faux avec l'aplomb d'un nom
 * vrai.
 *
 * Un repli existe néanmoins, et il est fidèle : la publication injecte dans le
 * HTML envoyé à WordPress un commentaire `<!-- MAJ par X le AAAA-MM-JJ -->`.
 * Quand l'article est re-scrapé pour une nouvelle mise à jour, ce commentaire
 * revient dans le contenu d'origine. On le lit plutôt que de deviner.
 *
 * Faute des deux, on affiche la DATE SEULE. Une date sans nom reste une
 * information ; un nom inventé est une désinformation.
 */

/** `<!-- MAJ par Sahara RAZAFINDRAKOTO le 2026-09-15 -->` — tampon posé à la publication. */
const STAMP_RX = /<!--\s*MAJ par\s+([^]*?)\s+le\s+(\d{4}-\d{2}-\d{2})\s*-->/gi;

/**
 * Dernier tampon de publication trouvé dans un HTML (le plus récent par date).
 * Plusieurs mises à jour successives en laissent plusieurs.
 * @returns {{auteur:string, jour:string}|null}
 */
export const lastPublishStamp = (html = '') => {
  if (!html) return null;
  const found = [];
  STAMP_RX.lastIndex = 0;
  let m = STAMP_RX.exec(html);
  while (m) {
    const auteur = String(m[1] || '').replace(/\s+/g, ' ').trim();
    if (auteur) found.push({ auteur, jour: m[2] });
    m = STAMP_RX.exec(html);
  }
  if (!found.length) return null;
  return found.sort((a, b) => (a.jour < b.jour ? 1 : -1))[0];
};

/**
 * Ce qu'on sait de la dernière publication de l'article.
 *
 * @param {object} args
 * @param {string} [args.publishedAt]  horodatage ISO enregistré à la publication
 * @param {string} [args.publishedBy]  auteur enregistré (depuis le 16/09/2026)
 * @param {string} [args.publishedUrl] URL renvoyée par WordPress
 * @param {string} [args.originalHtml] contenu d'origine — porte le tampon quand
 *   l'article a été re-scrapé après une publication
 * @returns {{publie:boolean, quand:string, qui:string, url:string, approximatif:boolean}}
 *   `publie:false` quand rien n'atteste d'une publication.
 *   `approximatif` : la date vient du tampon (jour seul, sans heure).
 */
export const publicationPrecedente = ({
  publishedAt = '', publishedBy = '', publishedUrl = '', originalHtml = '',
} = {}) => {
  const rien = { publie: false, quand: '', qui: '', url: '', approximatif: false };
  const tampon = lastPublishStamp(originalHtml);

  // L'enregistrement fait foi : c'est NOTRE trace, posée au succès de l'appel
  // WordPress. Le tampon ne sert qu'à nommer l'auteur quand il manque.
  if (publishedAt) {
    return {
      publie: true,
      quand: publishedAt,
      qui: publishedBy || tampon?.auteur || '',
      url: publishedUrl || '',
      approximatif: false,
    };
  }
  // Pas de trace côté base, mais l'article en ligne porte le tampon : il a bien
  // été publié par TONTON, depuis une session dont l'enregistrement s'est perdu
  // (article ré-analysé, brouillon purgé). Le dire vaut mieux que le taire.
  if (tampon) {
    return { publie: true, quand: tampon.jour, qui: tampon.auteur, url: '', approximatif: true };
  }
  return rien;
};
