import toast from 'react-hot-toast';

// ── Limite de taille des IMAGES uploadées ─────────────────────────────────────
// S'applique à TOUS les uploads d'images de l'app : insertion dans l'article
// (BubbleToolbar), image à la une (ArticleResult), photo de profil (MonCompte),
// pièces jointes tickets (fichiers + captures collées). Les vidéos et autres
// types de fichiers ne sont PAS concernés.
export const MAX_IMAGE_BYTES = 1024 * 1024; // 1 Mo

const fmtMo = (bytes) => `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;

// true si le fichier est une image qui dépasse la limite (les non-images passent).
export const isImageTooLarge = (file) =>
  !!file && (file.type || '').startsWith('image/') && file.size > MAX_IMAGE_BYTES;

// Upload mono-fichier : true si le fichier est accepté, sinon toast + false.
export function validateImageFile(file) {
  if (isImageTooLarge(file)) {
    toast.error(`Image trop lourde (${fmtMo(file.size)}) — maximum 1 Mo`);
    return false;
  }
  return true;
}

// Upload multi-fichiers : retourne les fichiers acceptés, un toast par image refusée.
export function filterValidImageFiles(files) {
  const list = Array.from(files || []);
  const rejected = list.filter(isImageTooLarge);
  for (const f of rejected) {
    toast.error(`Image trop lourde (${fmtMo(f.size)}) — maximum 1 Mo${f.name ? ` : ${f.name}` : ''}`);
  }
  return list.filter((f) => !isImageTooLarge(f));
}
