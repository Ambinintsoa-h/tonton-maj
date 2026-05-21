import axios from 'axios';

const PROXY = '/api/wordpress';

/**
 * Requête générique vers l'API REST WordPress via le proxy local.
 * Contourne les blocages CORS du navigateur (Authorization header cross-origin).
 */
const wpRequest = async (site, method, path, body = null) => {
  try {
    const resp = await axios.post(
      PROXY,
      { wpUrl: site.url, username: site.username, password: site.password, method, path, body },
      { timeout: 20000 }
    );
    return { success: true, data: resp.data.data };
  } catch (e) {
    const msg = e.response?.data?.error || e.message;
    return { success: false, error: msg };
  }
};

/** Vérifie que les identifiants permettent de se connecter à WordPress. */
export const testWordPressConnection = async (site) => {
  const result = await wpRequest(site, 'GET', '/wp-json/wp/v2/users/me');
  if (result.success) return { success: true, user: result.data };
  return result;
};

/**
 * Extrait le slug depuis une URL d'article WordPress.
 * Gère les query params et trailing slashes.
 * Ex : https://site.fr/mon-article/?utm=google  →  "mon-article"
 */
const extractSlug = (articleUrl) => {
  try {
    const { pathname } = new URL(articleUrl);
    const parts = pathname.replace(/\/$/, '').split('/').filter(Boolean);
    return parts.pop() || '';
  } catch {
    // Fallback si URL invalide
    const clean = articleUrl.split('?')[0].replace(/\/$/, '');
    return clean.split('/').pop() || '';
  }
};

/**
 * Cherche un post WordPress par son slug, dans les posts ET les pages.
 * Retourne { success, post: { id, title, link, slug, postType } }
 */
export const findPostByUrl = async (site, articleUrl) => {
  try {
    const slug = extractSlug(articleUrl);
    if (!slug) return { success: false, error: "Impossible d'extraire le slug depuis l'URL" };

    // Chercher dans posts puis pages (les types les plus courants)
    for (const type of ['posts', 'pages']) {
      const result = await wpRequest(
        site, 'GET',
        `/wp-json/wp/v2/${type}?slug=${encodeURIComponent(slug)}&_fields=id,link,title,slug,status,type`
      );
      if (result.success && Array.isArray(result.data) && result.data.length > 0) {
        return { success: true, post: { ...result.data[0], postType: type } };
      }
    }

    return { success: false, error: `Aucun article trouvé avec le slug "${slug}"` };
  } catch (e) {
    return { success: false, error: e.message };
  }
};

/**
 * Met à jour un article WordPress existant (post ou page).
 * Retourne { success, postId, link }
 */
export const updatePost = async (site, postId, postData, postType = 'posts') => {
  const type = postType === 'pages' ? 'pages' : 'posts';
  const body = {
    title:   postData.title,
    content: postData.content,
    status:  postData.status || 'draft',
  };
  // Inclure featured_media si fourni (support MCP)
  if (postData.featured_media !== undefined) body.featured_media = postData.featured_media;
  const result = await wpRequest(site, 'POST', `/wp-json/wp/v2/${type}/${postId}`, body);
  if (!result.success) return result;
  return { success: true, postId: result.data.id, link: result.data.link };
};

/**
 * Crée un nouvel article WordPress (brouillon par défaut).
 * Retourne { success, postId, link }
 */
export const publishToWordPress = async (site, postData) => {
  const result = await wpRequest(site, 'POST', '/wp-json/wp/v2/posts', {
    title:   postData.title,
    content: postData.content,
    status:  postData.status || 'draft',
  });
  if (!result.success) return result;
  return { success: true, postId: result.data.id, link: result.data.link };
};
