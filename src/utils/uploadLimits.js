import toast from 'react-hot-toast';

// ── Limite de taille des IMAGES uploadées ─────────────────────────────────────
// S'applique à TOUS les uploads d'images de l'app : insertion dans l'article
// (BubbleToolbar), image à la une (ArticleResult), photo de profil (MonCompte),
// pièces jointes tickets (fichiers + captures collées). Les vidéos et autres
// types de fichiers ne sont PAS concernés.
// Relevé de 1 à 5 Mo le 7 septembre 2026 (demande Andrianina) : une photo
// "normale" aujourd'hui (smartphone, stock photo, export WordPress) dépasse
// très souvent 1 Mo -- le plafond rejetait silencieusement (un toast facile à
// manquer) la plupart des images qu'un rédacteur essayait de téléverser,
// perçu comme "le téléversement ne marche plus".
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 Mo

const fmtMo = (bytes) => `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
// Le message doit toujours refléter la VRAIE limite : un texte figé ("maximum
// 1 Mo") avait déjà divergé une fois de MAX_IMAGE_BYTES avant ce correctif.
const LIMITE_AFFICHEE = fmtMo(MAX_IMAGE_BYTES);

// true si le fichier est une image qui dépasse la limite (les non-images passent).
export const isImageTooLarge = (file) =>
  !!file && (file.type || '').startsWith('image/') && file.size > MAX_IMAGE_BYTES;

// Upload mono-fichier : true si le fichier est accepté, sinon toast + false.
export function validateImageFile(file) {
  if (isImageTooLarge(file)) {
    toast.error(`Image trop lourde (${fmtMo(file.size)}) — maximum ${LIMITE_AFFICHEE}`);
    return false;
  }
  return true;
}

// Upload multi-fichiers : retourne les fichiers acceptés, un toast par image refusée.
export function filterValidImageFiles(files) {
  const list = Array.from(files || []);
  const rejected = list.filter(isImageTooLarge);
  for (const f of rejected) {
    toast.error(`Image trop lourde (${fmtMo(f.size)}) — maximum ${LIMITE_AFFICHEE}${f.name ? ` : ${f.name}` : ''}`);
  }
  return list.filter((f) => !isImageTooLarge(f));
}
