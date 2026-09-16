/**
 * mediaUrl.js — UNE URL DE MÉDIA QUI SORT DE L'OUTIL EST ENCODÉE.
 *
 * Corrigé le 15 septembre 2026, après « erreur lorsqu'on modifie/ajoute une
 * image » signalé sur circuits-culture.com. Diagnostic relevé EN PRODUCTION, en
 * interceptant l'appel réel :
 *
 *   requête : "source":{"type":"url","url":"…/uploads/2026/09/Heliosol®-2-scaled.jpg"}
 *   réponse : {"status":"error","httpStatus":500,
 *              "error":"… Unable to download the file. Please verify the URL and try again."}
 *
 * Le `®` partait BRUT dans l'URL transmise à l'API Anthropic, qui ne peut pas
 * télécharger le fichier. « Suggestion IA » laissait alors les champs ALT et
 * Légende vides, et l'ALT automatique d'après téléversement ne se posait jamais.
 * Le navigateur, lui, encode à la volée pour l'affichage : l'image s'affichait
 * parfaitement dans l'éditeur, ce qui rendait la panne incompréhensible.
 *
 * Ça ne concerne pas qu'un caractère exotique : TOUTE image dont le nom de
 * fichier WordPress porte un accent, une apostrophe typographique, un ® ou un ©
 * est touchée — c'est-à-dire une bonne partie des médias téléversés par une
 * équipe francophone.
 *
 * POURQUOI `new URL` ET SURTOUT PAS `encodeURI` : `encodeURI` ré-encode le
 * caractère `%`, donc DOUBLE-ENCODE une URL déjà correcte
 * (`a%C2%AEb.jpg` → `a%25C2%25AEb.jpg`), et casse ce qui marchait. Le
 * constructeur `URL` applique l'encodage de chemin WHATWG : il encode le `®`,
 * et laisse `%C2%AE` intact. Vérifié sur les deux formes avant d'être écrit ici.
 */

/**
 * Rend une URL de média transmissible à un service tiers (API Vision, requête
 * serveur) : les caractères non-ASCII du chemin sont percent-encodés, ceux qui
 * le sont déjà ne le sont pas deux fois.
 *
 * NO-OP sur une URL relative, vide ou non analysable : on la renvoie telle
 * quelle plutôt que de la mutiler. L'appelant n'a jamais à se demander si la
 * valeur qu'il tient est absolue.
 *
 * @param {string} raw
 * @returns {string}
 */
export const encodeMediaUrl = (raw = '') => {
  const url = String(raw || '').trim();
  if (!url) return '';
  try {
    return new URL(url).toString();
  } catch {
    // Chemin relatif, data: tronquée, chaîne qui n'est pas une URL — inchangée.
    return url;
  }
};
