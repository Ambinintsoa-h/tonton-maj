/**
 * BubbleToolbar — barre flottante de mise en forme pour la vue diff (contentEditable).
 *
 * Deux déclencheurs :
 *   1. Sélection de texte → apparaît au-dessus/dessous du texte sélectionné
 *   2. Clic droit dans l'article → apparaît au curseur, sans sélection requise
 *      (permet d'insérer tableaux, blocs HTML, médias au point de clic)
 *
 * Rendu via createPortal(document.body) pour s'affranchir des transforms Framer Motion.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  Bold, Italic, Underline, Strikethrough,
  Heading1, Heading2, Heading3, Heading4, Type,
  List, ListOrdered,
  Palette, Highlighter,
  Link, Unlink2,
  Image, Film, Code2,
  Check, X, Trash2,
  CaseSensitive, Weight, ALargeSmall,
} from 'lucide-react';

// Polices web-safe de repli si le site n'expose aucune police détectable
const FALLBACK_FONTS = ['Arial', 'Helvetica', 'Georgia', 'Times New Roman', 'Verdana', 'Courier New'];

// Tailles proposées (px) — du réglage fin du corps de texte (15/16/17) aux titres.
// La taille réelle du texte sélectionné est détectée et mise en évidence.
const FONT_SIZES = [13, 14, 15, 16, 17, 18, 20, 24, 28, 32];

// Graisses de police proposées (font-weight)
const FONT_WEIGHTS = [
  { label: 'Léger',       value: '300' },
  { label: 'Normal',      value: '400' },
  { label: 'Moyen',       value: '500' },
  { label: 'Semi-gras',   value: '600' },
  { label: 'Gras',        value: '700' },
  { label: 'Extra-gras',  value: '800' },
];

// ── Palettes couleurs ─────────────────────────────────────────────────────────
const TEXT_COLORS = [
  { label: 'Noir',   value: '#111827' },
  { label: 'Gris',   value: '#6b7280' },
  { label: 'Blanc',  value: '#ffffff' },
  { label: 'Rouge',  value: '#dc2626' },
  { label: 'Orange', value: '#ea580c' },
  { label: 'Jaune',  value: '#ca8a04' },
  { label: 'Vert',   value: '#16a34a' },
  { label: 'Bleu',   value: '#2563eb' },
  { label: 'Violet', value: '#7c3aed' },
  { label: 'Rose',   value: '#db2777' },
];

const HL_COLORS = [
  { label: 'Aucun',  value: 'transparent' },
  { label: 'Jaune',  value: '#fef08a' },
  { label: 'Vert',   value: '#bbf7d0' },
  { label: 'Bleu',   value: '#bfdbfe' },
  { label: 'Rose',   value: '#fbcfe8' },
  { label: 'Orange', value: '#fed7aa' },
  { label: 'Violet', value: '#ddd6fe' },
  { label: 'Rouge',  value: '#fecaca' },
];

// Placeholder par type de panel URL
const PANEL_PLACEHOLDERS = {
  link:  'https://exemple.com',
  image: "URL de l'image (https://...)",
  video: 'URL YouTube ou vidéo directe...',
};

// Hauteur approximative de la barre principale en px
const TOOLBAR_H = 44;
// Marge entre la sélection/curseur et la barre
const GAP = 8;
// Demi-largeur max pour ne pas sortir du viewport
const HALF_W = 260;

/**
 * Calcule top/left/below pour positionner la toolbar.
 * anchorTop  = bord haut du point d'ancrage (rect.top ou clientY)
 * anchorBottom = bord bas (rect.bottom ou clientY pour un point simple)
 */
const computeToolbarPos = (x, anchorTop, anchorBottom = anchorTop) => {
  const left  = Math.max(HALF_W, Math.min(window.innerWidth - HALF_W, x));
  const below = anchorTop < TOOLBAR_H + GAP + 16;
  const top   = below ? anchorBottom + GAP : anchorTop - TOOLBAR_H - GAP;
  return { left, top, below };
};

// ── Sous-composants ───────────────────────────────────────────────────────────

const Btn = ({ onClick, title, active = false, children }) => (
  <button
    type="button"
    title={title}
    onMouseDown={(e) => { e.preventDefault(); onClick(); }}
    className={[
      'flex items-center justify-center w-9 h-9 rounded-lg text-sm font-medium transition-all duration-100',
      active
        ? 'bg-white text-gray-900 shadow-sm'
        : 'text-gray-200 hover:bg-white/15 hover:text-white',
    ].join(' ')}
  >
    {children}
  </button>
);

const Sep = () => <div className="w-px h-4 bg-white/15 mx-0.5 flex-shrink-0" />;

const InputPanel = ({ placeholder, value, onChange, onConfirm, onClose }) => (
  <div className="flex items-center gap-1.5 bg-gray-900 border border-white/10 rounded-xl px-3 py-1.5 shadow-2xl">
    <input
      autoFocus
      type="url"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); onConfirm(); }
        if (e.key === 'Escape') onClose();
      }}
      placeholder={placeholder}
      className="flex-1 bg-transparent text-white text-xs outline-none placeholder-white/30 w-56"
    />
    <button
      type="button"
      onMouseDown={(e) => { e.preventDefault(); onConfirm(); }}
      className="flex items-center gap-1 text-[11px] font-medium text-emerald-400 hover:text-emerald-300 flex-shrink-0 px-1"
    >
      <Check size={12} /> OK
    </button>
    <button
      type="button"
      onMouseDown={(e) => { e.preventDefault(); onClose(); }}
      className="text-white/30 hover:text-white/60"
    >
      <X size={11} />
    </button>
  </div>
);

/**
 * Panel textarea pour insertion de HTML brut (tableau, infographie, bloc custom…).
 * Utilise une police monospace + hauteur fixe pour faciliter la saisie/coller de code.
 */
const HtmlPanel = ({ value, onChange, onConfirm, onClose }) => (
  <div
    className="flex flex-col gap-2 bg-gray-900 border border-white/10 rounded-xl px-3 py-2.5 shadow-2xl"
    style={{ width: 380 }}
  >
    <div className="flex items-center justify-between text-[10px] text-white/40 font-medium tracking-wide">
      <span>CODE HTML — tableau, infographie, bloc custom…</span>
      <button
        type="button"
        onMouseDown={(e) => { e.preventDefault(); onClose(); }}
        className="text-white/30 hover:text-white/60"
      >
        <X size={11} />
      </button>
    </div>
    <textarea
      autoFocus
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); onConfirm(); }
      }}
      placeholder={'<table>\n  <tr><th>Col A</th><th>Col B</th></tr>\n  <tr><td>…</td><td>…</td></tr>\n</table>'}
      rows={7}
      className="bg-white/5 border border-white/10 rounded-lg text-white text-[11px] font-mono leading-relaxed p-2 outline-none placeholder-white/20 resize-y"
    />
    <div className="flex items-center justify-between">
      <span className="text-[10px] text-white/25">Ctrl+Entrée pour insérer</span>
      <button
        type="button"
        onMouseDown={(e) => { e.preventDefault(); onConfirm(); }}
        className="flex items-center gap-1.5 text-[11px] font-medium bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg px-3 py-1 transition-colors"
      >
        <Check size={12} /> Insérer le code
      </button>
    </div>
  </div>
);

const Swatch = ({ color, label, onClick }) => (
  <button
    type="button"
    title={label}
    onMouseDown={(e) => { e.preventDefault(); onClick(); }}
    className="w-5 h-5 rounded-full border-2 border-transparent hover:border-white/60 transition-all flex-shrink-0 flex items-center justify-center"
    style={{
      backgroundColor: color === 'transparent' ? '#374151' : color,
      outline: color === 'transparent' ? '1px dashed rgba(255,255,255,0.4)' : 'none',
    }}
  >
    {color === 'transparent' && <X size={8} className="text-white/50" />}
  </button>
);

// ── Composant principal ───────────────────────────────────────────────────────

export default function BubbleToolbar({ articleEl, contentRef, onImageInserted, siteFonts = [] }) {
  // Polices proposées : celles détectées sur le site, sinon repli web-safe
  const fontList = (Array.isArray(siteFonts) && siteFonts.length > 0) ? siteFonts : FALLBACK_FONTS;
  const [visible, setVisible]   = useState(false);
  const [pos, setPos]           = useState({ top: 0, left: 0, below: false });
  const [panel, setPanel]       = useState(null);
  const [inputVal, setInputVal] = useState('');
  // Élément média sélectionné (img, video, wrapper iframe) → affiche bouton supprimer
  const [mediaEl, setMediaEl]   = useState(null);
  // Setter seul exposé : incrémenter force un re-render → mediaRect recalculé après scroll
  const [, setScrollTick]       = useState(0);
  // Styles actifs de la sélection → surbrillance des boutons (gras, italique, titre…)
  const [active, setActive]     = useState({});
  const toolbarRef              = useRef(null);
  const savedRangeRef           = useRef(null);
  // Vrai quand la toolbar a été ouverte par clic droit (pas par sélection).
  // Empêche le handler selectionchange de cacher la toolbar immédiatement.
  const rightClickRef           = useRef(false);

  // ── État actif de la sélection (surbrillance des boutons) ───────────────────
  // Détection native fiable : queryCommandState (gras/italique/…) + formatBlock (titre).
  const computeActive = useCallback(() => {
    try {
      const block = (document.queryCommandValue('formatBlock') || '').toLowerCase();

      // Style calculé du texte sélectionné (police + couleurs) — via l'élément
      // au point d'ancrage de la sélection, s'il appartient bien à l'article.
      let fontFamily = '', fontSize = 0, color = '', bg = '';
      const sel = window.getSelection();
      const node = sel?.anchorNode;
      const el = node ? (node.nodeType === 1 ? node : node.parentElement) : null;
      if (el && articleEl && articleEl.contains(el)) {
        const cs = window.getComputedStyle(el);
        fontFamily = (cs.fontFamily || '').split(',')[0].replace(/["']/g, '').trim();
        fontSize = Math.round(parseFloat(cs.fontSize) || 0);
        color = cs.color || '';
        const b = cs.backgroundColor || '';
        bg = (b && b !== 'rgba(0, 0, 0, 0)' && b !== 'transparent') ? b : '';
      }

      setActive({
        bold:      document.queryCommandState('bold'),
        italic:    document.queryCommandState('italic'),
        underline: document.queryCommandState('underline'),
        strike:    document.queryCommandState('strikeThrough'),
        ul:        document.queryCommandState('insertUnorderedList'),
        ol:        document.queryCommandState('insertOrderedList'),
        block,  // 'h1'..'h6', 'p', 'blockquote', 'div', ''
        fontFamily, fontSize, color, bg,
      });
    } catch { setActive({}); }
  }, [articleEl]);

  // ── Positionnement ────────────────────────────────────────────────────────

  const showAtPoint = useCallback((clientX, clientY) => {
    setPos(computeToolbarPos(clientX, clientY));
    setVisible(true);
    setPanel(null);
    computeActive();
  }, [computeActive]);

  const computePos = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return false;
    const range = sel.getRangeAt(0);
    if (!articleEl || !articleEl.contains(range.commonAncestorContainer)) return false;
    const rect = range.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return false;
    setPos(computeToolbarPos(rect.left + rect.width / 2, rect.top, rect.bottom));
    return true;
  }, [articleEl]);

  // ── Helpers sélection ─────────────────────────────────────────────────────

  const saveRange = useCallback(() => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      savedRangeRef.current = sel.getRangeAt(0).cloneRange();
    }
  }, []);

  /**
   * Restaure la sélection sauvegardée ET vide immédiatement le ref.
   * Critique : évite que les boutons directs suivants (Gras, H2…) réutilisent
   * un range périmé laissé par une insertion image/vidéo/HTML précédente.
   */
  const popRange = useCallback(() => {
    const range = savedRangeRef.current;
    savedRangeRef.current = null;
    if (!range || !articleEl) return;
    // { preventScroll: true } : empêche Chrome de réinitialiser le scrollTop à 0 au focus.
    const scrollTop = articleEl.scrollTop;
    articleEl.focus({ preventScroll: true });
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    articleEl.scrollTop = scrollTop;
  }, [articleEl]);

  // ── Deux chemins d'exécution distincts ────────────────────────────────────

  /**
   * Boutons directs (Gras, Italique, H2…).
   * La sélection reste active grâce à onMouseDown+preventDefault — pas de restore.
   */
  const format = useCallback((cmd, value = null) => {
    // Sauvegarder/restaurer le scroll : formatBlock et les commandes de liste
    // réinitialisent le scrollTop du contentEditable à 0 dans Chrome.
    const scrollTop = articleEl?.scrollTop ?? 0;
    document.execCommand(cmd, false, value);
    if (contentRef) contentRef.current = articleEl?.innerHTML || '';
    if (articleEl) articleEl.scrollTop = scrollTop;
    computeActive(); // rafraîchir la surbrillance après un toggle
  }, [articleEl, contentRef, computeActive]);

  /**
   * Insertions après un sous-panel (image, vidéo, HTML, couleur).
   * Restaure + vide le range sauvegardé, puis insère.
   */
  const insertAtSaved = useCallback((cmd, value) => {
    popRange();
    document.execCommand(cmd, false, value);
    if (contentRef) contentRef.current = articleEl?.innerHTML || '';
    setPanel(null);
    setInputVal('');
  }, [popRange, articleEl, contentRef]);

  /**
   * Retire le background-color (surlignage) de la sélection — y compris quand il
   * provient d'un style inline d'un élément scrapé (ex: <strong style="background-color:…">),
   * cas que execCommand('removeFormat') ne traite pas de façon fiable.
   *
   * Stratégie DOM : parcourt tous les éléments qui intersectent la sélection et
   * supprime UNIQUEMENT les propriétés background/background-color de leur style inline.
   * Ne touche pas aux marques de diff (mark.updated-content), dont le fond vient
   * d'une classe CSS et non d'un style inline.
   */
  const clearBackground = useCallback(() => {
    popRange();
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || !articleEl) return;
    const range = sel.getRangeAt(0);

    const root  = range.commonAncestorContainer;
    const scope = root.nodeType === 1 ? root : root.parentElement;
    if (!scope) return;

    const candidates = [scope, ...scope.querySelectorAll('*')];
    candidates.forEach((el) => {
      if (!el.style) return;
      try { if (!range.intersectsNode(el)) return; } catch { return; }
      if (el.style.backgroundColor || el.style.background) {
        el.style.removeProperty('background-color');
        el.style.removeProperty('background');
        // Nettoyer l'attribut style s'il devient vide
        if (!el.getAttribute('style')?.trim()) el.removeAttribute('style');
      }
    });

    // Débaliser les <mark class="manual-highlight"> dont le fond vient d'être retiré
    scope.querySelectorAll('mark.manual-highlight').forEach((el) => {
      try { if (!range.intersectsNode(el)) return; } catch { return; }
      const frag = document.createDocumentFragment();
      while (el.firstChild) frag.appendChild(el.firstChild);
      el.parentNode?.replaceChild(frag, el);
    });

    // Filet : retire aussi un éventuel surlignage posé par execCommand (span hiliteColor)
    document.execCommand('hiliteColor', false, 'transparent');

    if (contentRef) contentRef.current = articleEl.innerHTML;
    setPanel(null);
  }, [popRange, articleEl, contentRef]);

  /**
   * Applique un surlignage manuel à la sélection en insérant un
   * <mark class="manual-highlight" style="background-color: COLOR;">.
   * Distinct des <mark class="updated-content"> du diff (jamais publiés).
   * Le <mark> natif est le format de surlignage de Gutenberg → WordPress le préserve.
   */
  const applyHighlight = useCallback((color) => {
    popRange();
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || !articleEl) return;
    const range = sel.getRangeAt(0);
    if (range.collapsed) return;

    const mark = document.createElement('mark');
    mark.className = 'manual-highlight';
    mark.style.backgroundColor = color;

    try {
      range.surroundContents(mark);
    } catch {
      // La sélection traverse des limites d'éléments : extraire + envelopper
      const frag = range.extractContents();
      mark.appendChild(frag);
      range.insertNode(mark);
    }

    sel.removeAllRanges();
    if (contentRef) contentRef.current = articleEl.innerHTML || '';
    setPanel(null);
  }, [popRange, articleEl, contentRef]);

  /**
   * Applique une police à la sélection. styleWithCSS=true force execCommand à
   * produire <span style="font-family:…"> (propre + compatible WordPress) plutôt
   * que la balise dépréciée <font face="…"> (strippée par wp_kses).
   */
  const applyFont = useCallback((font) => {
    popRange();
    const scrollTop = articleEl?.scrollTop ?? 0;
    try { document.execCommand('styleWithCSS', false, true); } catch {}
    document.execCommand('fontName', false, font);
    try { document.execCommand('styleWithCSS', false, false); } catch {}
    if (articleEl) articleEl.scrollTop = scrollTop;
    if (contentRef) contentRef.current = articleEl?.innerHTML || '';
    setPanel(null);
  }, [popRange, articleEl, contentRef]);

  /**
   * Retire la police (revient à la police par défaut) : supprime la propriété
   * font-family des styles inline des éléments intersectant la sélection.
   */
  const clearFont = useCallback(() => {
    popRange();
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || !articleEl) return;
    const range = sel.getRangeAt(0);
    const root  = range.commonAncestorContainer;
    const scope = root.nodeType === 1 ? root : root.parentElement;
    if (!scope) return;
    [scope, ...scope.querySelectorAll('*')].forEach((el) => {
      if (!el.style) return;
      try { if (!range.intersectsNode(el)) return; } catch { return; }
      if (el.style.fontFamily) {
        el.style.removeProperty('font-family');
        if (!el.getAttribute('style')?.trim()) el.removeAttribute('style');
      }
    });
    if (contentRef) contentRef.current = articleEl.innerHTML;
    setPanel(null);
  }, [popRange, articleEl, contentRef]);

  // Applique une graisse (font-weight) à la sélection en l'enveloppant dans un
  // <span style="font-weight:…"> (aucune commande execCommand pour la graisse arbitraire).
  const applyFontWeight = useCallback((weight) => {
    popRange();
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || sel.isCollapsed || !articleEl) { setPanel(null); return; }
    const range = sel.getRangeAt(0);
    if (!articleEl.contains(range.commonAncestorContainer)) { setPanel(null); return; }
    const span = document.createElement('span');
    span.style.fontWeight = weight;
    try {
      span.appendChild(range.extractContents());
      range.insertNode(span);
      // Re-sélectionner le contenu stylé
      sel.removeAllRanges();
      const r = document.createRange();
      r.selectNodeContents(span);
      sel.addRange(r);
    } catch { /* sélection multi-blocs non enveloppable — ignorée */ }
    if (contentRef) contentRef.current = articleEl.innerHTML;
    setPanel(null);
  }, [popRange, articleEl, contentRef]);

  // Applique une taille (font-size) à la sélection en l'enveloppant dans un
  // <span style="font-size:…px"> — aucune commande execCommand ne pose une taille en px.
  const applyFontSize = useCallback((px) => {
    popRange();
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || sel.isCollapsed || !articleEl) { setPanel(null); return; }
    const range = sel.getRangeAt(0);
    if (!articleEl.contains(range.commonAncestorContainer)) { setPanel(null); return; }
    const span = document.createElement('span');
    span.style.fontSize = `${px}px`;
    try {
      span.appendChild(range.extractContents());
      range.insertNode(span);
      // Re-sélectionner le contenu redimensionné
      sel.removeAllRanges();
      const r = document.createRange();
      r.selectNodeContents(span);
      sel.addRange(r);
    } catch { /* sélection multi-blocs non enveloppable — ignorée */ }
    if (contentRef) contentRef.current = articleEl.innerHTML;
    setPanel(null);
  }, [popRange, articleEl, contentRef]);

  /**
   * Retire la taille (revient à la taille par défaut) : supprime la propriété
   * font-size des styles inline des éléments intersectant la sélection.
   */
  const clearFontSize = useCallback(() => {
    popRange();
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || !articleEl) return;
    const range = sel.getRangeAt(0);
    const root  = range.commonAncestorContainer;
    const scope = root.nodeType === 1 ? root : root.parentElement;
    if (!scope) return;
    [scope, ...scope.querySelectorAll('*')].forEach((el) => {
      if (!el.style) return;
      try { if (!range.intersectsNode(el)) return; } catch { return; }
      if (el.style.fontSize) {
        el.style.removeProperty('font-size');
        if (!el.getAttribute('style')?.trim()) el.removeAttribute('style');
      }
    });
    if (contentRef) contentRef.current = articleEl.innerHTML;
    setPanel(null);
  }, [popRange, articleEl, contentRef]);

  const closePanel = useCallback(() => { setPanel(null); setInputVal(''); }, []);

  const openPanel = useCallback((name) => {
    saveRange();
    setPanel((p) => (p === name ? null : name));
    setInputVal('');
  }, [saveRange]);

  // ── Insertions ────────────────────────────────────────────────────────────

  const insertLink = useCallback(() => {
    if (!inputVal.trim()) { setPanel(null); return; }
    const url = /^https?:\/\//i.test(inputVal) ? inputVal.trim() : 'https://' + inputVal.trim();
    // createLink est synchrone : l'ancre est dans le DOM immédiatement après execCommand.
    // On patche target/_blank sans setTimeout en lisant la sélection tout de suite.
    popRange();
    document.execCommand('createLink', false, url);
    const sel = window.getSelection();
    const node = sel?.anchorNode?.parentElement;
    const a = node?.closest?.('a') ?? (node?.tagName === 'A' ? node : null);
    if (a) {
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener noreferrer');
    }
    if (contentRef) contentRef.current = articleEl?.innerHTML || '';
    setPanel(null);
    setInputVal('');
  }, [inputVal, popRange, articleEl, contentRef]);

  const insertImage = useCallback(() => {
    if (!inputVal.trim()) { setPanel(null); return; }
    const url = inputVal.trim();
    // data-media-type permet la détection du clic pour le bouton supprimer
    insertAtSaved('insertHTML', `<img src="${url}" alt="" data-media-type="image" style="max-width:100%;height:auto;display:block;margin:1em auto;" /><br>`);
    // Notifier ArticleResult pour la génération automatique du texte ALT
    onImageInserted?.(url);
  }, [inputVal, insertAtSaved, onImageInserted]);

  const insertVideo = useCallback(() => {
    if (!inputVal.trim()) { setPanel(null); return; }
    const yt = inputVal.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/);
    const html = yt
      // L'iframe YouTube absorbe tous les événements souris → overlay transparent posé dessus
      // pour que les clics atteignent le document et déclenchent le bouton supprimer.
      ? `<div data-media-type="video" style="position:relative;padding-bottom:56.25%;height:0;overflow:hidden;margin:1em 0;max-width:100%;"><iframe style="position:absolute;top:0;left:0;width:100%;height:100%;" src="https://www.youtube.com/embed/${yt[1]}" frameborder="0" allowfullscreen loading="lazy" title="Vidéo YouTube"></iframe><div data-media-overlay style="position:absolute;inset:0;cursor:pointer;z-index:1;" title="Cliquer pour sélectionner — supprimer via le bouton corbeille"></div></div><br>`
      : `<video src="${inputVal.trim()}" controls data-media-type="video" style="max-width:100%;display:block;margin:1em auto;"></video><br>`;
    insertAtSaved('insertHTML', html);
  }, [inputVal, insertAtSaved]);

  const insertHtml = useCallback(() => {
    if (!inputVal.trim()) { setPanel(null); return; }
    insertAtSaved('insertHTML', inputVal.trim());
  }, [inputVal, insertAtSaved]);

  // ── Événements ────────────────────────────────────────────────────────────

  // selectionchange : affiche la toolbar quand du texte est sélectionné dans l'article
  useEffect(() => {
    if (!articleEl) return;
    let rafId = null;
    const onSelectionChange = () => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        // En mode clic-droit, ignorer le selectionchange déclenché par le repositionnement
        // du curseur — le flag sera réinitialisé par le prochain clic dans l'article.
        if (rightClickRef.current) return;
        const ok = computePos();
        if (ok) {
          setVisible(true);
          setPanel(null);
          computeActive();
        } else {
          // Garder visible si un sous-panel est ouvert (l'input a le focus → sélection perdue)
          setPanel((p) => { if (!p) setVisible(false); return p; });
        }
      });
    };
    document.addEventListener('selectionchange', onSelectionChange);
    return () => {
      document.removeEventListener('selectionchange', onSelectionChange);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [articleEl, computePos, computeActive]);

  // contextmenu : affiche la toolbar au point de clic droit (sans sélection requise)
  useEffect(() => {
    if (!articleEl) return;
    const onContextMenu = (e) => {
      e.preventDefault();
      saveRange();
      rightClickRef.current = true;
      showAtPoint(e.clientX, e.clientY);
    };
    articleEl.addEventListener('contextmenu', onContextMenu);
    return () => articleEl.removeEventListener('contextmenu', onContextMenu);
  }, [articleEl, saveRange, showAtPoint]);

  // ── Détection et suppression de médias ───────────────────────────────────

  const deleteMedia = useCallback(() => {
    if (!mediaEl || !articleEl) return;
    // Pour un overlay, remonter au conteneur média : vidéo insérée ([data-media-type])
    // OU iframe scrapée de l'article ([data-media="iframe-wrapper"]).
    const toRemove = 'mediaOverlay' in (mediaEl.dataset ?? {})
      ? (mediaEl.closest('[data-media-type], [data-media="iframe-wrapper"]') ?? mediaEl)
      : mediaEl;
    const next = toRemove.nextSibling;

    // Suppression via une sélection + execCommand('delete') plutôt que .remove() :
    // l'opération entre dans la pile d'annulation native → Ctrl+Z restaure le média
    // (Ctrl+Y le re-supprime). On englobe le <br> de fin pour tout annuler d'un coup.
    try {
      const sel = window.getSelection();
      const range = document.createRange();
      range.setStartBefore(toRemove);
      if (next?.nodeName === 'BR') range.setEndAfter(next);
      else range.setEndAfter(toRemove);
      const scrollTop = articleEl.scrollTop;
      articleEl.focus({ preventScroll: true });
      sel.removeAllRanges();
      sel.addRange(range);
      document.execCommand('delete');
      articleEl.scrollTop = scrollTop;
    } catch { /* repli ci-dessous */ }

    // Repli : si le média est toujours là (navigateur récalcitrant), retrait DOM direct
    if (articleEl.contains(toRemove)) {
      if (next?.nodeName === 'BR') next.remove();
      toRemove.remove();
    }

    contentRef.current = articleEl.innerHTML;
    setMediaEl(null);
  }, [mediaEl, articleEl, contentRef]);

  useEffect(() => {
    if (!articleEl) return;
    const onArticleClick = (e) => {
      const t = e.target;
      if (t.tagName === 'IMG' || t.tagName === 'VIDEO') { setMediaEl(t); return; }
      if ('mediaOverlay' in (t.dataset ?? {}))           { setMediaEl(t); return; }
      // Clic sur une iframe scrapée (ou son wrapper) → sélectionner le wrapper
      const wrap = t.closest?.('[data-media="iframe-wrapper"]');
      if (wrap) { setMediaEl(wrap); return; }
      setMediaEl(null);
    };
    articleEl.addEventListener('click', onArticleClick);
    return () => articleEl.removeEventListener('click', onArticleClick);
  }, [articleEl]);

  // Scroll de l'article → recalcul de la position du bouton supprimer
  // Listener permanent sur articleEl (pas sur mediaEl) pour éviter re-registration
  // à chaque changement de média sélectionné.
  useEffect(() => {
    if (!articleEl) return;
    const onScroll = () => setScrollTick((n) => n + 1);
    articleEl.addEventListener('scroll', onScroll);
    return () => articleEl.removeEventListener('scroll', onScroll);
  }, [articleEl]);

  // Masquer quand on clique hors toolbar + article
  useEffect(() => {
    const onDocMouseDown = (e) => {
      if (toolbarRef.current?.contains(e.target)) return;
      if (articleEl?.contains(e.target)) {
        rightClickRef.current = false;
        return;
      }
      rightClickRef.current = false;
      setVisible(false);
      setPanel(null);
      setMediaEl(null);
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [articleEl]);

  // ── Rendu ─────────────────────────────────────────────────────────────────

  // Bouton supprimer calculé AVANT le early-return : doit s'afficher même quand
  // aucun texte n'est sélectionné (toolbar de format cachée).
  // getBoundingClientRect() est recalculé à chaque render (scrollTick le force).
  const mediaRect = mediaEl ? mediaEl.getBoundingClientRect() : null;
  const deleteBtn = mediaEl && mediaRect ? createPortal(
    <button
      type="button"
      title="Supprimer ce média"
      onMouseDown={(e) => { e.preventDefault(); deleteMedia(); }}
      style={{
        position:       'fixed',
        top:            mediaRect.top  + 8,
        left:           mediaRect.right - 8,
        transform:      'translate(-100%, 0)',
        zIndex:         10000,
        background:     'rgba(220,38,38,0.92)',
        backdropFilter: 'blur(4px)',
        color:          'white',
        border:         'none',
        borderRadius:   '50%',
        width:          30,
        height:         30,
        cursor:         'pointer',
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'center',
        boxShadow:      '0 2px 8px rgba(0,0,0,0.4)',
      }}
    >
      <Trash2 size={16} />
    </button>,
    document.body,
  ) : null;

  if (!visible) return deleteBtn;

  // Flèche CSS pointant vers la sélection / le point de clic
  const arrowStyle = pos.below
    ? {
        position: 'absolute', top: -6, left: '50%', transform: 'translateX(-50%)',
        width: 0, height: 0,
        borderLeft: '6px solid transparent', borderRight: '6px solid transparent',
        borderBottom: '7px solid #111827',
      }
    : {
        position: 'absolute', bottom: -6, left: '50%', transform: 'translateX(-50%)',
        width: 0, height: 0,
        borderLeft: '6px solid transparent', borderRight: '6px solid transparent',
        borderTop: '7px solid #111827',
      };

  // Map confirm handlers pour les panels URL (link/image/video)
  const panelConfirm = { link: insertLink, image: insertImage, video: insertVideo };

  const toolbar = (
    <div
      ref={toolbarRef}
      style={{
        position: 'fixed',
        top:      pos.top,
        left:     pos.left,
        transform: 'translateX(-50%)',
        zIndex:   9999,
        pointerEvents: 'auto',
      }}
      onMouseDown={(e) => e.preventDefault()}
    >
      {/* ── Barre principale ── */}
      <div className="relative flex items-center gap-0.5 bg-gray-900 border border-gray-700 rounded-xl px-2 py-1.5 shadow-[0_8px_32px_rgba(0,0,0,0.55)] whitespace-nowrap">
        <div style={arrowStyle} />

        {/* Style texte */}
        <Btn onClick={() => format('bold')}          title="Gras (Ctrl+B)"      active={active.bold}>      <Bold size={16} /></Btn>
        <Btn onClick={() => format('italic')}        title="Italique (Ctrl+I)"  active={active.italic}>  <Italic size={16} /></Btn>
        <Btn onClick={() => format('underline')}     title="Souligné (Ctrl+U)" active={active.underline}> <Underline size={16} /></Btn>
        <Btn onClick={() => format('strikeThrough')} title="Barré"             active={active.strike}>             <Strikethrough size={16} /></Btn>

        <Sep />

        {/* Structure */}
        <Btn onClick={() => format('formatBlock', 'h1')} title="Titre H1" active={active.block === 'h1'}><Heading1 size={16} /></Btn>
        <Btn onClick={() => format('formatBlock', 'h2')} title="Titre H2" active={active.block === 'h2'}><Heading2 size={16} /></Btn>
        <Btn onClick={() => format('formatBlock', 'h3')} title="Titre H3" active={active.block === 'h3'}><Heading3 size={16} /></Btn>
        <Btn onClick={() => format('formatBlock', 'h4')} title="Titre H4" active={active.block === 'h4'}><Heading4 size={16} /></Btn>
        <Btn onClick={() => format('formatBlock', 'p')}  title="Paragraphe normal" active={active.block === 'p' || active.block === 'div'}><Type size={16} /></Btn>

        <Sep />

        {/* Listes */}
        <Btn onClick={() => format('insertUnorderedList')} title="Liste à puces"   active={active.ul}>   <List size={16} /></Btn>
        <Btn onClick={() => format('insertOrderedList')}   title="Liste numérotée" active={active.ol}> <ListOrdered size={16} /></Btn>

        <Sep />

        {/* Couleurs */}
        <Btn onClick={() => openPanel('color')}     title="Couleur du texte" active={panel === 'color'}>
          <span className="relative flex items-center justify-center">
            <Palette size={16} />
            {active.color && (
              <span className="absolute -bottom-1.5 left-0 right-0 h-1 rounded-full" style={{ background: active.color }} />
            )}
          </span>
        </Btn>
        <Btn onClick={() => openPanel('highlight')} title="Surligner"        active={panel === 'highlight'}>
          <span className="relative flex items-center justify-center">
            <Highlighter size={16} />
            {active.bg && (
              <span className="absolute -bottom-1.5 left-0 right-0 h-1 rounded-full" style={{ background: active.bg }} />
            )}
          </span>
        </Btn>
        {/* Police — affiche le nom de la police active à côté de l'icône Aa */}
        <button
          type="button"
          title="Police du texte"
          onMouseDown={(e) => { e.preventDefault(); openPanel('font'); }}
          className={[
            'flex items-center gap-1 h-9 px-2 rounded-lg text-sm font-medium transition-all duration-100 max-w-[130px]',
            panel === 'font' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-200 hover:bg-white/15 hover:text-white',
          ].join(' ')}
        >
          <CaseSensitive size={16} className="flex-shrink-0" />
          <span className="truncate text-[12px]">{active.fontFamily || 'Police'}</span>
        </button>
        <Btn onClick={() => openPanel('weight')} title="Graisse du texte" active={panel === 'weight'}>
          <Weight size={16} />
        </Btn>
        {/* Taille — affiche la taille courante (px) à côté de l'icône A/a */}
        <button
          type="button"
          title="Taille du texte"
          onMouseDown={(e) => { e.preventDefault(); openPanel('size'); }}
          className={[
            'flex items-center gap-1 h-9 px-2 rounded-lg text-sm font-medium transition-all duration-100',
            panel === 'size' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-200 hover:bg-white/15 hover:text-white',
          ].join(' ')}
        >
          <ALargeSmall size={16} className="flex-shrink-0" />
          {active.fontSize ? <span className="text-[12px] tabular-nums">{active.fontSize}</span> : null}
        </button>

        <Sep />

        {/* Lien */}
        <Btn onClick={() => openPanel('link')} title="Insérer un lien" active={panel === 'link'}>
          <Link size={16} />
        </Btn>
        <Btn onClick={() => format('unlink')} title="Supprimer le lien">
          <Unlink2 size={16} className="text-red-300" />
        </Btn>

        <Sep />

        {/* Médias */}
        <Btn onClick={() => openPanel('image')} title="Insérer une image (URL)" active={panel === 'image'}>
          <Image size={16} />
        </Btn>
        <Btn onClick={() => openPanel('video')} title="Insérer une vidéo YouTube" active={panel === 'video'}>
          <Film size={16} />
        </Btn>

        <Sep />

        {/* HTML brut */}
        <Btn onClick={() => openPanel('html')} title="Insérer du HTML (tableau, infographie…)" active={panel === 'html'}>
          <Code2 size={16} />
        </Btn>
      </div>

      {/* ── Sous-panels URL (link / image / video) ── */}
      {panel && panel in panelConfirm && (
        <div className="mt-1.5">
          <InputPanel
            placeholder={PANEL_PLACEHOLDERS[panel]}
            value={inputVal}
            onChange={setInputVal}
            onConfirm={panelConfirm[panel]}
            onClose={closePanel}
          />
        </div>
      )}

      {/* ── Panel HTML brut ── */}
      {panel === 'html' && (
        <div className="mt-1.5">
          <HtmlPanel
            value={inputVal}
            onChange={setInputVal}
            onConfirm={insertHtml}
            onClose={closePanel}
          />
        </div>
      )}

      {/* ── Palettes couleur ── */}
      {panel === 'color' && (
        <div className="flex items-center gap-1.5 bg-gray-900 border border-gray-700 rounded-xl px-3 py-2 mt-1.5 shadow-2xl">
          {TEXT_COLORS.map((c) => (
            <Swatch key={c.value} color={c.value} label={c.label}
              onClick={() => { popRange(); format('foreColor', c.value); }}
            />
          ))}
          {/* Sélecteur de couleur libre (roue) */}
          <label
            title="Couleur personnalisée"
            className="relative w-5 h-5 rounded-full overflow-hidden cursor-pointer flex-shrink-0 border-2 border-transparent hover:border-white/60 transition-all"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <span
              className="absolute inset-0 rounded-full"
              style={{ background: 'conic-gradient(red, orange, yellow, lime, cyan, blue, magenta, red)' }}
            />
            <input
              type="color"
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              onInput={(e) => { popRange(); format('foreColor', e.target.value); }}
            />
          </label>
        </div>
      )}
      {panel === 'highlight' && (
        <div className="flex items-center gap-1.5 bg-gray-900 border border-gray-700 rounded-xl px-3 py-2 mt-1.5 shadow-2xl">
          {HL_COLORS.map((c) => (
            <Swatch key={c.value} color={c.value} label={c.label}
              onClick={() => {
                if (c.value === 'transparent') { clearBackground(); return; }
                applyHighlight(c.value);
              }}
            />
          ))}
        </div>
      )}
      {panel === 'font' && (
        <div className="flex flex-col bg-gray-900 border border-gray-700 rounded-xl py-1.5 mt-1.5 shadow-2xl max-h-64 overflow-y-auto min-w-[180px]">
          <div className="px-3 py-1 text-[10px] text-white/40 font-medium tracking-wide uppercase">
            {siteFonts.length > 0 ? 'Polices du site' : 'Polices standard'}
          </div>
          <button
            type="button"
            onMouseDown={(e) => { e.preventDefault(); clearFont(); }}
            className="text-left px-3 py-1.5 text-xs text-white/70 hover:bg-white/10 transition-colors"
          >
            Police par défaut
          </button>
          {fontList.map((f) => {
            const isActive = active.fontFamily && f.toLowerCase() === active.fontFamily.toLowerCase();
            return (
              <button
                key={f}
                type="button"
                onMouseDown={(e) => { e.preventDefault(); applyFont(f); }}
                className={[
                  'flex items-center justify-between gap-2 px-3 py-1.5 text-sm transition-colors',
                  isActive ? 'bg-white/15 text-white' : 'text-gray-100 hover:bg-white/10',
                ].join(' ')}
                style={{ fontFamily: f }}
                title={f}
              >
                <span className="truncate">{f}</span>
                {isActive && <Check size={13} className="flex-shrink-0 text-emerald-400" />}
              </button>
            );
          })}
        </div>
      )}
      {panel === 'size' && (
        <div className="flex flex-col bg-gray-900 border border-gray-700 rounded-xl py-1.5 mt-1.5 shadow-2xl max-h-64 overflow-y-auto min-w-[160px]">
          <div className="px-3 py-1 text-[10px] text-white/40 font-medium tracking-wide uppercase">
            Taille du texte{active.fontSize ? ` — actuelle ${active.fontSize} px` : ''}
          </div>
          <button
            type="button"
            onMouseDown={(e) => { e.preventDefault(); clearFontSize(); }}
            className="text-left px-3 py-1.5 text-xs text-white/70 hover:bg-white/10 transition-colors"
          >
            Taille par défaut
          </button>
          {FONT_SIZES.map((s) => {
            const isActive = active.fontSize === s;
            return (
              <button
                key={s}
                type="button"
                onMouseDown={(e) => { e.preventDefault(); applyFontSize(s); }}
                className={[
                  'flex items-center gap-2 px-3 py-1.5 transition-colors',
                  isActive ? 'bg-white/15 text-white' : 'text-gray-100 hover:bg-white/10',
                ].join(' ')}
                title={`${s} px`}
              >
                <span className="w-6 text-center leading-none" style={{ fontSize: Math.min(s, 20) }}>A</span>
                <span className="flex-1 text-left text-[12px] tabular-nums">{s} px</span>
                {isActive && <Check size={13} className="flex-shrink-0 text-emerald-400" />}
              </button>
            );
          })}
        </div>
      )}
      {panel === 'weight' && (
        <div className="flex flex-col bg-gray-900 border border-gray-700 rounded-xl py-1.5 mt-1.5 shadow-2xl min-w-[160px]">
          <div className="px-3 py-1 text-[10px] text-white/40 font-medium tracking-wide uppercase">
            Graisse du texte
          </div>
          {FONT_WEIGHTS.map((w) => (
            <button
              key={w.value}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); applyFontWeight(w.value); }}
              className="flex items-center justify-between px-3 py-1.5 text-sm text-gray-100 hover:bg-white/10 transition-colors"
              style={{ fontWeight: w.value }}
              title={`${w.label} (${w.value})`}
            >
              <span>{w.label}</span>
              <span className="text-[10px] text-white/40">{w.value}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <>
      {createPortal(toolbar, document.body)}
      {deleteBtn}
    </>
  );
}
