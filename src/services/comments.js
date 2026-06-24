import axios from 'axios';

// ── Service Commentaires ───────────────────────────────────────────────────────
// Lecture/modération via le proxy (qui parle à l'API REST WordPress avec les
// Application Passwords) + tri IA via /api/claude. Le token d'auth est ajouté
// automatiquement par l'intercepteur axios (App.js).

const CLAUDE_PROXY = '/api/claude';

// Catégories de tri proposées à l'IA (modération éditoriale).
export const COMMENT_CATEGORIES = ['question', 'éloge', 'critique', 'spam', 'toxique', 'hors-sujet'];

/** Liste les commentaires d'un site pour les statuts demandés. */
export const fetchComments = async ({ site, statuses = ['hold'], page = 1, perPage = 20 }) => {
  const { data } = await axios.post('/api/wp-comments', {
    siteId: site.id, wpSites: [site], statuses, page, perPage,
  });
  return data.comments || [];
};

/** Change le statut d'un commentaire : 'approve' | 'hold' | 'spam' | 'trash'. */
export const moderateComment = async ({ site, commentId, action }) => {
  const { data } = await axios.post('/api/wp-comments/moderate', {
    siteId: site.id, wpSites: [site], commentId, action,
  });
  return data;
};

/**
 * Rédige un BROUILLON de réponse de marque (Sonnet) — toujours relu/édité par un
 * humain avant publication. Retourne le texte brut (chaîne vide si échec).
 */
export const generateReply = async ({ comment, siteName = '' }) => {
  try {
    const { data } = await axios.post(CLAUDE_PROXY, {
      model: 'claude-sonnet-4-5',
      max_tokens: 500,
      system: `Tu rédiges la réponse OFFICIELLE de la marque/du site${siteName ? ` « ${siteName} »` : ''} à un commentaire de lecteur, en français.
- Ton : professionnel, chaleureux, serviable, concis (2 à 4 phrases).
- Prends en compte le commentaire et réponds à la question si possible ; reste factuel.
- N'invente AUCUNE promesse commerciale, prix ni information non vérifiable.
- Si le commentaire est toxique/insultant : réponse courte, calme, non conflictuelle.
- Pas de signature, pas de « Cordialement », pas de markdown : uniquement le texte de la réponse.`,
      messages: [{ role: 'user', content: `Commentaire de ${comment.author} :\n"${comment.content}"\n\nRédige la réponse de la marque.` }],
    });
    return (data?.content?.[0]?.text || '').trim();
  } catch {
    return '';
  }
};

/** Publie une réponse (sous l'utilisateur WP du site), en réponse à un commentaire. */
export const publishReply = async ({ site, comment, content, status = 'approve' }) => {
  const { data } = await axios.post('/api/wp-comments/reply', {
    siteId: site.id, wpSites: [site], postId: comment.postId, parentId: comment.id, content, status,
  });
  return data;
};

/**
 * Classe un lot de commentaires via Haiku (rapide/éco).
 * Retourne une map { [commentId]: { category, sentiment, priority, summary } }.
 * Silencieux en cas d'erreur (renvoie {}) — le tri IA ne doit jamais bloquer l'écran.
 */
export const classifyComments = async (comments) => {
  const batch = (comments || []).slice(0, 40)
    .map(c => ({ i: c.id, t: (c.content || '').substring(0, 400) }))
    .filter(c => c.t);
  if (!batch.length) return {};

  try {
    const { data } = await axios.post(CLAUDE_PROXY, {
      model: 'claude-haiku-4-5',
      max_tokens: 1800,
      system: `Tu classes des commentaires de blog pour aider un modérateur. Pour CHAQUE commentaire, donne :
- "category" : un seul de ${JSON.stringify(COMMENT_CATEGORIES)}
- "sentiment" : "positif" | "neutre" | "négatif"
- "priority" : "haute" (toxique, critique à traiter vite, question importante) | "moyenne" | "basse"
- "summary" : résumé en 8 mots maximum, en français
Réponds UNIQUEMENT avec un JSON valide, sans texte autour :
{"results":[{"i":<id>,"category":"...","sentiment":"...","priority":"...","summary":"..."}]}`,
      messages: [{ role: 'user', content: `Commentaires à classer :\n${JSON.stringify(batch)}` }],
    });

    const text = data?.content?.[0]?.text || '';
    const slice = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
    const parsed = JSON.parse(slice);
    const map = {};
    for (const r of parsed.results || []) {
      if (r && r.i != null) {
        map[r.i] = {
          category:  r.category  || 'hors-sujet',
          sentiment: r.sentiment || 'neutre',
          priority:  r.priority  || 'basse',
          summary:   r.summary   || '',
        };
      }
    }
    return map;
  } catch {
    return {};
  }
};
