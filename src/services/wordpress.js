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
    content: postData.content,
    status:  postData.status || 'draft',
  };
  // Titre : uniquement si explicitement fourni (modifié par l'utilisateur)
  // Ne pas envoyer de titre = WordPress conserve le titre existant
  if (postData.title !== undefined) body.title = postData.title;
  // Image à la une MCP
  if (postData.featured_media !== undefined) body.featured_media = postData.featured_media;
  // Catégories
  if (postData.categories?.length) body.categories = postData.categories;
  // Date de publication (optionnelle) : ISO 8601. WP attend l'heure locale du
  // site dans `date` (et `date_gmt` en UTC). On envoie `date` ; WP recalcule le GMT.
  if (postData.date) body.date = postData.date;
  // SEO Meta (Yoast SEO + SEOPress) — WP ignore silencieusement les champs du plugin absent
  if (postData.seoMeta?.seoTitle || postData.seoMeta?.seoDescription) {
    body.meta = {
      // Yoast SEO
      _yoast_wpseo_title:    postData.seoMeta.seoTitle       || '',
      _yoast_wpseo_metadesc: postData.seoMeta.seoDescription || '',
      // SEOPress
      _seopress_titles_title: postData.seoMeta.seoTitle       || '',
      _seopress_titles_desc:  postData.seoMeta.seoDescription || '',
    };
  }
  // Sécurité : jamais d'auteur dans une mise à jour
  delete body.author;

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
    ...(postData.date ? { date: postData.date } : {}),
  });
  if (!result.success) return result;
  return { success: true, postId: result.data.id, link: result.data.link };
};
