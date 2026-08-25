import axios from 'axios';
import { selectModel } from './agent';

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
 * Rédige un BROUILLON de réponse de marque — toujours relu/édité par un
 * humain avant publication. Modèle piloté par le registre des passes
 * (`commentaire_reponse`, agent.js). Retourne le texte brut (chaîne vide si échec).
 */
export const generateReply = async ({ comment, siteName = '', modelSelections = null }) => {
  try {
    const { data } = await axios.post(CLAUDE_PROXY, {
      model: selectModel('commentaire_reponse', modelSelections),
      max_tokens: 500,
      system: `Tu écris la réponse de la marque/du site${siteName ? ` « ${siteName} »` : ''} à un commentaire de lecteur. Elle est publiée sous le compte officiel et relue par un humain avant publication.

OBJECTIF : que ça sonne comme un vrai échange entre deux personnes, pas comme un message automatique.

STYLE
- Naturel, vivant, humain : parle comme une vraie personne de l'équipe, jamais comme un service client robotisé.
- Réponds DANS LA LANGUE du commentaire.
- Adapte ton registre à celui du lecteur : s'il te tutoie, tutoie-le ; s'il vouvoie, vouvoie-le ; s'il est direct, sois direct ; s'il est formel, reste poli.
- Court : 2 à 3 lignes maximum.
- Relance la discussion quand c'est pertinent : termine par une petite question ou une confirmation, comme dans une vraie conversation.

À ÉVITER (ça sonne faux)
- Les formules toutes faites : « N'hésitez pas à… », « Nous vous remercions de votre commentaire », « Nous restons à votre disposition », « Cordialement ».
- Le jargon corporate et les phrases passe-partout : varie les tournures.
- Pas de signature, pas de markdown : uniquement le texte de la réponse.

GARDE-FOUS
- Réponds vraiment au fond (réponds à la question si tu peux), reste factuel.
- N'invente AUCUN prix, promesse commerciale, délai ni information non vérifiable.
- Si le commentaire est agressif/toxique : réponse brève, calme, non conflictuelle.`,
      messages: [{ role: 'user', content: `Commentaire de ${comment.author} :\n"${comment.content}"\n\nÉcris la réponse de la marque, dans la langue du commentaire et en miroir de son registre.` }],
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
const CLASSIFY_SYSTEM = `Tu classes des commentaires de blog pour aider un modérateur. Pour CHAQUE commentaire, donne :
- "category" : un seul de ${JSON.stringify(COMMENT_CATEGORIES)}
- "sentiment" : "positif" | "neutre" | "négatif"
- "priority" : "haute" (toxique, critique à traiter vite, question importante) | "moyenne" | "basse"
- "confidence" : "haute" | "moyenne" | "basse" — ta certitude sur la catégorie. Mets "haute" UNIQUEMENT si c'est flagrant (ex. spam évident : liens promotionnels, charabia, contenu commercial hors-sujet). Au moindre doute → "moyenne" ou "basse".
- "lang" : code langue ISO 639-1 en minuscules du commentaire (ex. "fr", "en", "es", "de", "it", "pt", "ar"…)
- "summary" : résumé en 8 mots maximum, en français
Réponds UNIQUEMENT avec un JSON valide, sans texte autour :
{"results":[{"i":<id>,"category":"...","sentiment":"...","priority":"...","confidence":"...","lang":"...","summary":"..."}]}`;

const classifyChunk = async (batch, modelSelections) => {
  try {
    const { data } = await axios.post(CLAUDE_PROXY, {
      model: selectModel('commentaire_tri', modelSelections),
      max_tokens: 4000,
      system: CLASSIFY_SYSTEM,
      messages: [{ role: 'user', content: `Commentaires à classer :\n${JSON.stringify(batch)}` }],
    });
    const text = data?.content?.[0]?.text || '';
    const slice = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
    const parsed = JSON.parse(slice);
    const map = {};
    for (const r of parsed.results || []) {
      if (r && r.i != null) {
        map[r.i] = {
          category:   r.category   || 'hors-sujet',
          sentiment:  r.sentiment  || 'neutre',
          priority:   r.priority   || 'basse',
          confidence: r.confidence || 'basse',   // défaut prudent : sans certitude, jamais de spam auto
          lang:       (r.lang || 'fr').toLowerCase(),   // défaut 'fr' → pas de drapeau de traduction
          summary:    r.summary    || '',
        };
      }
    }
    return map;
  } catch {
    return {};   // un lot en échec ne fait pas tomber les autres
  }
};

export const classifyComments = async (comments, modelSelections = null) => {
  const all = (comments || [])
    .map(c => ({ i: c.id, t: (c.content || '').substring(0, 400) }))
    .filter(c => c.t);
  if (!all.length) return {};

  // Petits lots : évite une sortie JSON tronquée par max_tokens (cause d'échec
  // d'analyse sur de gros volumes) et classe TOUS les commentaires, pas que 40.
  const CHUNK = 15;
  const chunks = [];
  for (let i = 0; i < all.length; i += CHUNK) chunks.push(all.slice(i, i + CHUNK));

  const maps = await Promise.all(chunks.map(chunk => classifyChunk(chunk, modelSelections)));
  return Object.assign({}, ...maps);
};

/**
 * Traduit un commentaire en français (Haiku, rapide/éco). Renvoie la traduction
 * brute, ou '' en cas d'échec. Utilisé pour lire les commentaires d'autres langues.
 */
export const translateComment = async ({ text, modelSelections = null }) => {
  const src = (text || '').trim();
  if (!src) return '';
  try {
    const { data } = await axios.post(CLAUDE_PROXY, {
      model: selectModel('commentaire_traduction', modelSelections),
      max_tokens: 1000,
      system: `Tu es un traducteur. Traduis le texte de l'utilisateur en français naturel et fidèle. Réponds UNIQUEMENT par la traduction, sans guillemets, sans préambule ni commentaire. Si le texte est déjà en français, renvoie-le tel quel.`,
      messages: [{ role: 'user', content: src }],
    });
    return (data?.content?.[0]?.text || '').trim();
  } catch {
    return '';
  }
};
