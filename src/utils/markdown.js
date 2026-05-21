import { marked } from 'marked';
import DOMPurify from 'dompurify';

// ── Configuration marked ──────────────────────────────────────────────────────
const renderer = new marked.Renderer();

// Liens : toujours target="_blank" + rel="noopener"
renderer.link = ({ href, title, text }) =>
  `<a href="${href}" title="${title || ''}" target="_blank" rel="noopener noreferrer">${text}</a>`;

marked.setOptions({
  renderer,
  breaks: true,   // \n → <br> dans les paragraphes
  gfm: true,      // GitHub Flavored Markdown (tables, strikethrough…)
});

/**
 * Convertit du Markdown (ou du texte brut) en HTML prêt à être injecté
 * via dangerouslySetInnerHTML. Retourne une chaîne HTML.
 *
 * Si le texte ressemble déjà à du HTML (commence par "<"), il est retourné tel quel.
 * Si le texte est vide, retourne "".
 */
export const renderMarkdown = (text = '') => {
  if (!text) return '';
  const trimmed = text.trimStart();
  // Déjà du HTML (TipTap, import HTML…) → sanitize uniquement, pas de conversion Markdown
  if (trimmed.startsWith('<')) return DOMPurify.sanitize(text);
  try {
    return DOMPurify.sanitize(marked.parse(text));
  } catch {
    // Fallback sécurisé : texte brut avec sauts de ligne
    return DOMPurify.sanitize(`<p>${text.replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>')}</p>`);
  }
};

/**
 * Convertit du Markdown en texte brut (pour les previews tronquées).
 */
export const markdownToPlain = (text = '') => {
  if (!text) return '';
  if (text.trimStart().startsWith('<')) {
    // Déjà HTML → strip les balises
    return text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }
  return text
    .replace(/#{1,6}\s+/g, '')         // headers
    .replace(/\*\*([^*]+)\*\*/g, '$1') // bold
    .replace(/\*([^*]+)\*/g, '$1')     // italic
    .replace(/`{3}[\s\S]*?`{3}/g, '')  // fenced code
    .replace(/`([^`]+)`/g, '$1')       // inline code
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // links
    .replace(/^\s*[-*+]\s+/gm, '')     // bullet points
    .replace(/^\s*\d+\.\s+/gm, '')     // ordered lists
    .replace(/\|[^\n]+\|/g, '')        // table rows
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};
