import { marked } from 'marked';
import { markedHighlight } from 'marked-highlight';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js/lib/core';
import xml from 'highlight.js/lib/languages/xml';
import javascript from 'highlight.js/lib/languages/javascript';
import css from 'highlight.js/lib/languages/css';
import json from 'highlight.js/lib/languages/json';
import 'highlight.js/styles/github-dark.css';

// Langages utiles aux audits (HTML/schema.org, composants JS, CSS inline, JSON-LD)
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('html', xml);
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('js', javascript);
hljs.registerLanguage('jsx', javascript);
hljs.registerLanguage('css', css);
hljs.registerLanguage('json', json);

// ── Configuration marked ──────────────────────────────────────────────────────
const renderer = new marked.Renderer();

// Liens : toujours target="_blank" + rel="noopener"
renderer.link = ({ href, title, text }) =>
  `<a href="${href}" title="${title || ''}" target="_blank" rel="noopener noreferrer">${text}</a>`;

// Coloration syntaxique des blocs de code (rendu type éditeur) via highlight.js.
marked.use(markedHighlight({
  langPrefix: 'hljs language-',
  highlight(code, lang) {
    const language = hljs.getLanguage(lang) ? lang : 'xml'; // défaut : HTML/XML
    try { return hljs.highlight(code, { language }).value; }
    catch { return code; }
  },
}));

marked.setOptions({
  renderer,
  breaks: true,   // \n → <br> dans les paragraphes
  gfm: true,      // GitHub Flavored Markdown (tables, strikethrough…)
});

// ── Déballage des faux blocs de code ──────────────────────────────────────────
// La passe d'audit encadre parfois par erreur du TEXTE (TL;DR, recommandations…)
// dans des ``` ``` → affiché sur fond noir comme du code. On « déballe » ces blocs
// "prose" pour qu'ils s'affichent en markdown normal (gras, listes…), tout en
// gardant les VRAIS blocs de code (HTML/schema.org, JSON-LD) sur fond sombre.
const CODE_LANGS = /^(html|xml|js|javascript|jsx|ts|tsx|css|json|jsonld|bash|sh|php|python|py|sql|yaml|yml)$/i;
const looksLikeCode = (s = '') =>
  /<\/?[a-z!][\s\S]*?>/i.test(s) ||                       // balises HTML / <!--
  /[{};]\s*$/m.test(s) ||                                 // accolade / point-virgule en fin de ligne
  /=>|\bfunction\b|\bconst\b|\bimport\b|@context|schema\.org/.test(s);

export const unwrapProseFences = (md = '') =>
  md.replace(/```([^\n`]*)\r?\n([\s\S]*?)```/g, (full, lang, body) => {
    const l = (lang || '').trim();
    if (CODE_LANGS.test(l)) return full;  // langage de code explicite (```html…) → vrai code, on garde
    if (looksLikeCode(body)) return full; // pas de langage de code mais ça ressemble à du code → on garde
    return body;                          // sinon (prose, ```text, ```markdown…) → on déballe (texte normal)
  });

// ── Aperçu « code | rendu » des blocs HTML ────────────────────────────────────
// Enrobe chaque bloc de code HTML (tableaux, snippets à coller…) d'un sélecteur
// permettant de basculer entre le CODE (coloré) et son RENDU réel. Opère sur la
// sortie de marked (avant sanitize). L'interactivité est branchée côté React par
// délégation de clic (voir ArticleResult). Les blocs sans rendu visible
// (ex. JSON-LD <script>) restent en code seul.
const RENDERABLE = /<(table|div|ul|ol|p|section|article|h[1-6]|figure|img|a|blockquote|span|strong|em)\b/i;
const unescapeHtml = (s = '') => s
  .replace(/<\/?span[^>]*>/g, '')   // retire les <span> de coloration hljs
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&#0?39;/g, "'")
  .replace(/&#x27;/gi, "'")
  .replace(/&amp;/g, '&');          // & en dernier (évite la double-conversion)

export const enhanceCodePreviews = (html = '') =>
  html.replace(
    /<pre><code class="[^"]*\blanguage-(?:html|xml)\b[^"]*">([\s\S]*?)<\/code><\/pre>/g,
    (full, inner) => {
      const rendered = unescapeHtml(inner);
      if (!RENDERABLE.test(rendered)) return full; // pas de rendu visible → code seul
      return (
        '<div class="code-preview" data-cp-block>' +
          '<div class="code-preview-bar">' +
            '<button type="button" data-cp="code" class="cp-active">code</button>' +
            '<button type="button" data-cp="render">rendu</button>' +
          '</div>' +
          '<div class="cp-pane cp-pane-code">' + full + '</div>' +
          '<div class="cp-pane cp-pane-render" hidden>' + rendered + '</div>' +
        '</div>'
      );
    }
  );

/**
 * Convertit du Markdown (ou du texte brut) en HTML prêt à être injecté
 * via dangerouslySetInnerHTML. Retourne une chaîne HTML.
 *
 * @param {string} text   Markdown (ou HTML déjà formé).
 * @param {object} [opts]
 * @param {boolean} [opts.codePreview]  Ajoute le sélecteur « code | rendu » sur les blocs HTML.
 *
 * Si le texte ressemble déjà à du HTML (commence par "<"), il est retourné tel quel.
 * Si le texte est vide, retourne "".
 */
export const renderMarkdown = (text = '', { codePreview = false } = {}) => {
  if (!text) return '';
  const trimmed = text.trimStart();
  // Déjà du HTML (TipTap, import HTML…) → sanitize uniquement, pas de conversion Markdown
  if (trimmed.startsWith('<')) return DOMPurify.sanitize(text);
  try {
    // hljs ajoute des <span class="hljs-…"> → conserver class/span au sanitize
    let html = marked.parse(text);
    if (codePreview) html = enhanceCodePreviews(html);
    return DOMPurify.sanitize(html);
  } catch {
    // Fallback sécurisé : texte brut avec sauts de ligne
    return DOMPurify.sanitize(`<p>${text.replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>')}</p>`);
  }
};

// ── Emojis → icônes SVG (rendu pro, cohérent avec les icônes de l'app) ─────────
const icon = (paths, color) =>
  `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-2px;margin:0 2px;flex-shrink:0">${paths}</svg>`;

const EMOJI_ICONS = {
  '🚨': icon('<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>', '#dc2626'),
  '✅': icon('<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>', '#16a34a'),
  '⚠': icon('<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>', '#d97706'),
  '❌': icon('<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>', '#dc2626'),
  '📰': icon('<path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2"/><path d="M18 14h-8M15 18h-5M10 6h8v4h-8Z"/>', '#2563eb'),
  '🔑': icon('<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6"/><path d="m15.5 7.5 3 3L22 7l-3-3"/>', '#ca8a04'),
  '👁': icon('<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>', '#6b7280'),
  '🎯': icon('<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>', '#dc2626'),
  '➡': icon('<line x1="5" y1="12" x2="19" y2="12"/><path d="m12 5 7 7-7 7"/>', '#6b7280'),
  '📐': icon('<path d="M12 3 3 12l9 9 9-9-9-9Z"/><path d="M8 8 16 16"/>', '#6b7280'),
};

/**
 * Remplace les emojis (🚨, ✅, ⚠️, ❌…) par des icônes SVG inline dans une chaîne
 * HTML déjà rendue. Pour un rendu pro, cohérent avec les icônes de l'app.
 */
export const emojiToIcons = (html = '') => {
  let out = html;
  for (const [emoji, svg] of Object.entries(EMOJI_ICONS)) {
    out = out.split(emoji + '️').join(svg).split(emoji).join(svg);
  }
  return out;
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
