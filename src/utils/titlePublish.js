/**
 * titlePublish.js — QUAND LE TITRE TAPÉ PAR LE RÉDACTEUR PART SUR WORDPRESS.
 *
 * ── LE DÉFAUT CORRIGÉ ────────────────────────────────────────────────────────
 * Le titre n'est envoyé à WordPress que si `titleDirty` est vrai, c'est-à-dire si
 * un humain l'a saisi (ou validé). Ce drapeau protège un cas réel : un titre
 * « parasite » (première ligne d'un texte collé, titre de widget capté par le
 * scraping) s'AFFICHE dans le champ mais ne doit jamais être publié.
 *
 * Le drapeau était remis à faux par un effet de `ArticleResult` qui surveille
 * `wpTitle`, `agent.originalContent`, `cqItem.title` et `currentArticle.title`.
 * Or `currentArticle.title` change dès que l'article est enregistré avec son
 * titre — et `handleTerminer` l'écrit précisément (`title: editedTitle`). L'effet
 * repartait alors : `setTitleDirty(false)`, et le champ se réécrivait avec le
 * titre enregistré, c'est-à-dire LE MÊME TEXTE. À l'écran rien ne change ; à la
 * publication, `titleDirty && editedTitle` est faux et le titre ne part pas.
 *
 * Constaté en production le 12 novembre 2026, sur l'article du Mont-Dore
 * (tourismefrance.org) : `<title>`, `og:title` et méta-description à jour, le
 * tampon « MAJ par … » daté du jour — donc la publication a bien eu lieu — mais
 * le H1, qui est le titre WordPress, resté l'ancien. Seul le titre manquait, et
 * rien ne le disait : la publication affichait « Article mis à jour ».
 *
 * ── DEUX CORRECTIFS, DEUX RAISONS ────────────────────────────────────────────
 * 1. `mustResetTitle` : on ne réinitialise le titre que si l'ARTICLE a changé, ou
 *    si rien n'a été saisi. Un effet qui réagit à un changement de contenu ne doit
 *    pas effacer l'intention d'un humain.
 * 2. `titleToPublish` : filet à la publication, valable quelle que soit la cause
 *    de la perte du drapeau. `editedTitle` n'est persisté AVEC l'article que
 *    lorsqu'il est dirty (voir `articleMetaRef`, ArticleResult) : un titre enregistré
 *    qui est aussi celui du champ a donc déjà été validé par un humain. Un titre
 *    parasite, lui, n'est jamais persisté comme `editedTitle` — il reste exclu.
 */

/**
 * Faut-il réinitialiser le champ titre et son drapeau ?
 *
 * `previousArticleKey` vaut `undefined` au tout premier passage : jamais égal à
 * une clé d'article, pas même `null`, donc l'initialisation du montage a toujours
 * lieu comme avant.
 */
export const mustResetTitle = ({ previousArticleKey, articleKey, titleDirty }) =>
  previousArticleKey !== articleKey || !titleDirty;

/**
 * Titre à joindre à la mise à jour WordPress, ou `null` pour laisser le titre du
 * site tel quel.
 *
 * - dirty + non vide  → le titre saisi, TEL QUE SAISI (aucune normalisation :
 *   c'était déjà le comportement, on ne change pas ce qui part sur le site) ;
 * - pas dirty, mais le champ reprend exactement le titre déjà validé et enregistré
 *   avec l'article → ce titre, car il est validé ;
 * - sinon `null` : le titre du champ n'est qu'un affichage (titre WP lu, H1 de
 *   l'original, première ligne d'un texte collé).
 */
export const titleToPublish = ({ titleDirty, editedTitle, savedEditedTitle }) => {
  if (!editedTitle) return null;
  if (titleDirty) return editedTitle;
  const valide = String(savedEditedTitle || '').trim();
  if (valide && valide === String(editedTitle).trim()) return editedTitle;
  return null;
};
