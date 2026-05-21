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
  Heading2, Heading3, Type,
  List, ListOrdered,
  Palette, Highlighter,
  Link, Unlink2,
  Image, Film, Code2,
  Check, X, Trash2,
} from 'lucide-react';

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
      'flex items-center justify-center w-7 h-7 rounded-lg text-xs font-medium transition-all duration-100',
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
    {color === 'transparent' && <span className="text-white/50 text-[8px]">✕</span>}
  </button>
);

// ── Composant principal ───────────────────────────────────────────────────────

export default function BubbleToolbar({ articleEl, contentRef }) {
  const [visible, setVisible]   = useState(false);
  const [pos, setPos]           = useState({ top: 0, left: 0, below: false });
  const [panel, setPanel]       = useState(null);
  const [inputVal, setInputVal] = useState('');
  // Élément média sélectionné (img, video, wrapper iframe) → affiche bouton supprimer
  const [mediaEl, setMediaEl]   = useState(null);
  // Setter seul exposé : incrémenter force un re-render → mediaRect recalculé après scroll
  const [, setScrollTick]       = useState(0);
  const toolbarRef              = useRef(null);
  const savedRangeRef           = useRef(null);
  // Vrai quand la toolbar a été ouverte par clic droit (pas par sélection).
  // Empêche le handler selectionchange de cacher la toolbar immédiatement.
  const rightClickRef           = useRef(false);

  // ── Positionnement ────────────────────────────────────────────────────────

  const showAtPoint = useCallback((clientX, clientY) => {
    setPos(computeToolbarPos(clientX, clientY));
    setVisible(true);
    setPanel(null);
  }, []);

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
  }, [articleEl, contentRef]);

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
    // data-media-type permet la détection du clic pour le bouton supprimer
    insertAtSaved('insertHTML', `<img src="${inputVal.trim()}" alt="" data-media-type="image" style="max-width:100%;height:auto;display:block;margin:1em auto;" /><br>`);
  }, [inputVal, insertAtSaved]);

  const insertVideo = useCallback(() => {
    if (!inputVal.trim()) { setPanel(null); return; }
    const yt = inputVal.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/);
    const html = yt
      // L'iframe YouTube absorbe tous les événements souris → overlay transparent posé dessus
      // pour que les clics atteignent le document et déclenchent le bouton supprimer.
      ? `<div data-media-type="video" style="position:relative;padding-bottom:56.25%;height:0;overflow:hidden;margin:1em 0;max-width:100%;"><iframe style="position:absolute;top:0;left:0;width:100%;height:100%;" src="https://www.youtube.com/embed/${yt[1]}" frameborder="0" allowfullscreen loading="lazy" title="Vidéo YouTube"></iframe><div data-media-overlay style="position:absolute;inset:0;cursor:pointer;z-index:1;" title="Cliquer pour sélectionner — supprimer via le bouton 🗑"></div></div><br>`
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
  }, [articleEl, computePos]);

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
    // Pour un overlay, remonter au wrapper [data-media-type]
    const toRemove = 'mediaOverlay' in (mediaEl.dataset ?? {})
      ? (mediaEl.closest('[data-media-type]') ?? mediaEl)
      : mediaEl;
    const next = toRemove.nextSibling;
    if (next?.nodeName === 'BR') next.remove();
    toRemove.remove();
    contentRef.current = articleEl.innerHTML;
    setMediaEl(null);
  }, [mediaEl, articleEl, contentRef]);

  useEffect(() => {
    if (!articleEl) return;
    const onArticleClick = (e) => {
      const t = e.target;
      if (t.tagName === 'IMG' || t.tagName === 'VIDEO') { setMediaEl(t); return; }
      if ('mediaOverlay' in (t.dataset ?? {}))           { setMediaEl(t); return; }
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
      <Trash2 size={13} />
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
        <Btn onClick={() => format('bold')}          title="Gras (Ctrl+B)">      <Bold size={13} /></Btn>
        <Btn onClick={() => format('italic')}        title="Italique (Ctrl+I)">  <Italic size={13} /></Btn>
        <Btn onClick={() => format('underline')}     title="Souligné (Ctrl+U)"> <Underline size={13} /></Btn>
        <Btn onClick={() => format('strikeThrough')} title="Barré">             <Strikethrough size={13} /></Btn>

        <Sep />

        {/* Structure */}
        <Btn onClick={() => format('formatBlock', 'h2')} title="Titre H2"><Heading2 size={13} /></Btn>
        <Btn onClick={() => format('formatBlock', 'h3')} title="Titre H3"><Heading3 size={13} /></Btn>
        <Btn onClick={() => format('formatBlock', 'p')}  title="Paragraphe normal"><Type size={13} /></Btn>

        <Sep />

        {/* Listes */}
        <Btn onClick={() => format('insertUnorderedList')} title="Liste à puces">   <List size={13} /></Btn>
        <Btn onClick={() => format('insertOrderedList')}   title="Liste numérotée"> <ListOrdered size={13} /></Btn>

        <Sep />

        {/* Couleurs */}
        <Btn onClick={() => openPanel('color')}     title="Couleur du texte" active={panel === 'color'}>
          <Palette size={13} />
        </Btn>
        <Btn onClick={() => openPanel('highlight')} title="Surligner"        active={panel === 'highlight'}>
          <Highlighter size={13} />
        </Btn>

        <Sep />

        {/* Lien */}
        <Btn onClick={() => openPanel('link')} title="Insérer un lien" active={panel === 'link'}>
          <Link size={13} />
        </Btn>
        <Btn onClick={() => format('unlink')} title="Supprimer le lien">
          <Unlink2 size={13} className="text-red-300" />
        </Btn>

        <Sep />

        {/* Médias */}
        <Btn onClick={() => openPanel('image')} title="Insérer une image (URL)" active={panel === 'image'}>
          <Image size={13} />
        </Btn>
        <Btn onClick={() => openPanel('video')} title="Insérer une vidéo YouTube" active={panel === 'video'}>
          <Film size={13} />
        </Btn>

        <Sep />

        {/* HTML brut */}
        <Btn onClick={() => openPanel('html')} title="Insérer du HTML (tableau, infographie…)" active={panel === 'html'}>
          <Code2 size={13} />
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
        </div>
      )}
      {panel === 'highlight' && (
        <div className="flex items-center gap-1.5 bg-gray-900 border border-gray-700 rounded-xl px-3 py-2 mt-1.5 shadow-2xl">
          {HL_COLORS.map((c) => (
            <Swatch key={c.value} color={c.value} label={c.label}
              onClick={() => {
                popRange();
                if (c.value === 'transparent') format('removeFormat');
                else format('hiliteColor', c.value);
              }}
            />
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
