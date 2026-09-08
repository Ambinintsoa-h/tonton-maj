/**
 * editorMeta.js — LE BROUILLON D'ÉDITION APPARTIENT À UN ARTICLE.
 *
 * ── LE DÉFAUT CORRIGÉ ────────────────────────────────────────────────────────
 * `agent.editorMeta` porte le titre édité, le Meta Title, la Meta Description, la
 * date de MAJ, l'ALT de l'image à la une et les catégories. C'est un brouillon
 * unique par MEMBRE — pas un par article — et il est lu EN PRIORITÉ sur les métas
 * réellement enregistrées avec l'article (`metaValidee`, ArticleResult).
 *
 * Conséquence, constatée en production le 20 août 2026 : un article de
 * terrassier.net rouvert depuis l'Historique s'affichait avec le titre, le meta
 * title, la meta description et le mot-clé cible d'un article de fosseseptique.fr.
 * Ce n'était pas un défaut d'affichage — ces métas partent dans
 * `postData.seoMeta` à la publication : le meta title d'un autre site était
 * publiable, et l'« Analyse SEO » rendait un rapport exact dans son calcul et
 * faux dans son entrée (« aucune occurrence », « 0/14 sous-titre »).
 *
 * ── POURQUOI UNE FONCTION, ET PAS UN RAPPEL DE PLUS ─────────────────────────
 * SIX champs avaient déjà reçu ce correctif un par un — `wpData`, `auditJson`,
 * `qatArticle`, `targetKeyword`, `briefLinkRows`, `auditSelection` — chacun avec
 * son commentaire « dispatché même à vide, sinon celui de l'article précédent
 * reste ». Le rappel ne tient pas à l'échelle : il suffit d'un septième chemin de
 * réouverture pour rouvrir le trou. On change donc le PORTEUR : le brouillon dit
 * à quel article il appartient, et la relecture refuse celui d'un autre.
 */

/**
 * Rend le brouillon s'il concerne bien l'article ouvert, sinon `null`.
 *
 * Le rejet porte sur le brouillon ENTIER, pas seulement sur ses métas SEO :
 * `editedTitle`, `publishDate`, l'ALT de l'image et les catégories fuyaient par
 * le même trou — et une catégorie erronée change le permalien, donc produit un
 * 404.
 *
 * `articleId` absent = brouillon écrit avant ce correctif, ou article encore
 * jamais enregistré (`currentArticleId` nul jusqu'au premier enregistrement) :
 * ACCEPTÉ, exactement comme avant. La garde ne se déclenche que sur une
 * non-correspondance CONSTATÉE — refuser par défaut ferait perdre des retouches
 * en cours pour un doute, ce qui serait un deuxième défaut.
 */
export const editorMetaForArticle = (editorMeta, currentArticleId) => {
  if (!editorMeta) return null;
  if (editorMeta.articleId && editorMeta.articleId !== currentArticleId) return null;
  return editorMeta;
};

/**
 * Date MAJ par défaut du champ SEO Meta — J-2, décision Andrianina.
 *
 * Pré-remplissage seulement : le champ reste un input `datetime-local` normal,
 * modifiable ou effaçable comme avant. `editorMetaForArticle` ci-dessus prend
 * le dessus dès qu'une date a été enregistrée (ou saisie à la main) pour cet
 * article — cette valeur ne sert que tant que rien n'a encore été décidé.
 *
 * Format natif de l'input : « YYYY-MM-DDTHH:mm », heure LOCALE (celle affichée
 * dans le champ, cohérente avec `new Date(publishDate)` utilisé à la publication).
 * `maintenant` est injectable pour les tests — sinon l'instant réel.
 */
export const defaultPublishDate = (maintenant = new Date()) => {
  const d = new Date(maintenant.getTime());
  d.setDate(d.getDate() - 2);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
