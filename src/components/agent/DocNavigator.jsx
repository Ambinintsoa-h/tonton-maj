/**
 * DocNavigator — navigateur de structure du document (façon « Vue d'ensemble »
 * de Gutenberg/WordPress) pour la vue diff (contentEditable).
 *
 * Widget flottant : un bouton sur le bord droit ouvre un panneau listant les
 * blocs top-level de l'article (titres, paragraphes, listes, tableaux, images,
 * FAQ…). Pour chaque bloc :
 *   - clic          → scroll doux jusqu'au bloc + flash de repérage
 *   - glisser-déposer (ou ↑/↓) → réordonner
 *   - ⧉             → dupliquer
 *   - 🗑             → supprimer (annulable Ctrl+Z)
 *
 * Chaque mutation passe par onEdited() (lockMedia + contentRef + autosave côté
 * parent) → undo/redo et autosave fonctionnent comme pour le reste de l'éditeur.
 * Rendu via createPortal(document.body) — indépendant des transforms Framer.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import toast from 'react-hot-toast';
import {
  List, ListOrdered, X, ChevronUp, ChevronDown, Copy, Trash2, GripVertical,
  Heading1, Heading2, Heading3, Heading4, Type, Table2, Image as ImageIcon,
  Film, HelpCircle, Quote, Box, PanelRight, Scissors, ClipboardPaste, CopyPlus,
} from 'lucide-react';

// ── Description d'un bloc top-level ──────────────────────────────────────────
const excerpt = (s, n = 48) => {
  const t = (s || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n) + '…' : t;
};

const describe = (el) => {
  const tag = el.tagName;
  const m = tag.match(/^H([1-6])$/);
  if (m) {
    const lvl = parseInt(m[1], 10);
    const Icon = [Heading1, Heading2, Heading3, Heading4][Math.min(lvl, 4) - 1];
    return { Icon, kind: `H${lvl}`, label: excerpt(el.textContent, 56), strong: lvl <= 2, indent: lvl >= 3 };
  }
  switch (tag) {
    case 'P': {
      const t = excerpt(el.textContent);
      return { Icon: Type, kind: 'Paragraphe', label: t || '(vide)', dim: !t, indent: true };
    }
    case 'UL': return { Icon: List,        kind: 'Liste',   label: `${el.children.length} élément${el.children.length > 1 ? 's' : ''} — ${excerpt(el.firstElementChild?.textContent, 30)}`, indent: true };
    case 'OL': return { Icon: ListOrdered, kind: 'Liste num.', label: `${el.children.length} élément${el.children.length > 1 ? 's' : ''}`, indent: true };
    case 'TABLE': {
      const rows = el.querySelectorAll('tr').length;
      return { Icon: Table2, kind: 'Tableau', label: `${rows} ligne${rows > 1 ? 's' : ''}`, indent: true };
    }
    case 'FIGURE':
    case 'IMG':
      return { Icon: ImageIcon, kind: 'Image', label: excerpt(el.querySelector?.('img')?.alt || el.alt || '', 40) || 'Image', indent: true };
    case 'IFRAME':
    case 'VIDEO':
      return { Icon: Film, kind: 'Vidéo', label: 'Vidéo', indent: true };
    case 'DETAILS':
      return { Icon: HelpCircle, kind: 'FAQ', label: excerpt(el.querySelector('summary')?.textContent, 46) || 'Question', indent: true };
    case 'BLOCKQUOTE':
      return { Icon: Quote, kind: 'Citation', label: excerpt(el.textContent, 40), indent: true };
    default: {
      const cls = (typeof el.className === 'string' ? el.className : '').toLowerCase();
      if (cls.includes('faq') || (el.id || '').toLowerCase().includes('faq')) {
        return { Icon: HelpCircle, kind: 'Bloc FAQ', label: excerpt(el.querySelector('h1,h2,h3,h4')?.textContent, 40) || 'FAQ', strong: true };
      }
      // Tableau responsive : <div data-tt-table-wrap><table>…</table></div>
      if (el.querySelector?.('table')) {
        const rows = el.querySelectorAll('tr').length;
        return { Icon: Table2, kind: 'Tableau', label: `${rows} ligne${rows > 1 ? 's' : ''}`, indent: true };
      }
      if (el.querySelector?.('iframe, video')) return { Icon: Film, kind: 'Vidéo', label: 'Vidéo', indent: true };
      return { Icon: Box, kind: tag.toLowerCase(), label: excerpt(el.textContent, 40), indent: true };
    }
  }
};

// Presse-papiers de blocs (ArticleResult) :
//  clipboard ({ name, art } | null) — contenu actuel du presse-papiers interne
//  onCopyBlock(el) / onCutBlock(el) — copier/couper un bloc depuis le panneau
//  onPasteRelative(el, 'before'|'after') — coller le presse-papiers autour d'un bloc
export default function DocNavigator({ articleEl, onEdited, clipboard = null, onCopyBlock, onCutBlock, onPasteRelative }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);      // [{ el, Icon, kind, label, … }]
  const [dragIdx, setDragIdx] = useState(null);
  const [dropPos, setDropPos] = useState(null); // { idx, after }
  const [ctxMenu, setCtxMenu] = useState(null); // { x, y, idx } — menu contextuel (clic droit)
  const debounceRef = useRef(null);

  // ── Visibilité limitée au bloc « Après — MAJ proposées » ──────────────────
  // Le widget (positionné fixed) n'apparaît que quand le bloc éditeur est
  // réellement À L'ÉCRAN : scrollé sur la Synthèse, le Détail des modifications
  // ou les Sources → il disparaît. (Sur les onglets Audit/Avant, l'éditeur est
  // démonté → articleEl est null → déjà masqué.)
  const [inView, setInView] = useState(false);
  useEffect(() => {
    if (!articleEl) { setInView(false); return; }
    const io = new IntersectionObserver(
      ([entry]) => setInView(entry.isIntersecting),
      { threshold: 0.05 },
    );
    io.observe(articleEl);
    return () => io.disconnect();
  }, [articleEl]);

  // ── Construction de la liste depuis les enfants top-level de l'article ─────
  const refresh = useCallback(() => {
    if (!articleEl) { setItems([]); return; }
    const list = Array.from(articleEl.children)
      .filter(el => !['SCRIPT', 'STYLE', 'BR'].includes(el.tagName))
      .map(el => ({ el, ...describe(el) }));
    setItems(list);
    setCtxMenu(null); // les index changent → menu contextuel périmé
  }, [articleEl]);

  useEffect(() => { if (open) refresh(); }, [open, refresh]);

  // Rafraîchissement sur mutation du contenu (frappe, diffs, FAQ, médias…)
  useEffect(() => {
    if (!open || !articleEl) return;
    const mo = new MutationObserver(() => {
      clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(refresh, 500);
    });
    mo.observe(articleEl, { childList: true, subtree: true, characterData: true });
    return () => { mo.disconnect(); clearTimeout(debounceRef.current); };
  }, [open, articleEl, refresh]);

  // ── Scroll doux + flash (même technique que jumpToChange — pas de
  //    scrollIntoView, bug Chrome sur contentEditable) ────────────────────────
  const scrollToEl = useCallback((el) => {
    if (!articleEl || !el) return;
    const relativeTop = el.getBoundingClientRect().top
      - articleEl.getBoundingClientRect().top
      + articleEl.scrollTop;
    articleEl.scrollTo({ top: Math.max(0, relativeTop - articleEl.clientHeight / 3), behavior: 'smooth' });
    el.style.outline = '2px solid #6366f1';
    el.style.outlineOffset = '3px';
    setTimeout(() => { el.style.outline = ''; el.style.outlineOffset = ''; }, 900);
  }, [articleEl]);

  const commit = useCallback(() => {
    onEdited?.();
    refresh();
  }, [onEdited, refresh]);

  // ── Actions bloc ────────────────────────────────────────────────────────────
  const moveItem = useCallback((idx, dir) => {
    const el = items[idx]?.el;
    const target = items[idx + dir]?.el;
    if (!el || !target || !el.parentNode) return;
    if (dir < 0) el.parentNode.insertBefore(el, target);
    else el.parentNode.insertBefore(el, target.nextSibling);
    commit();
    scrollToEl(el);
  }, [items, commit, scrollToEl]);

  const duplicateItem = useCallback((idx) => {
    const el = items[idx]?.el;
    if (!el || !el.parentNode) return;
    const clone = el.cloneNode(true);
    el.parentNode.insertBefore(clone, el.nextSibling);
    commit();
    scrollToEl(clone);
    toast.success('Bloc dupliqué');
  }, [items, commit, scrollToEl]);

  const deleteItem = useCallback((idx) => {
    const el = items[idx]?.el;
    if (!el) return;
    el.remove();
    commit();
    toast('Bloc supprimé — Ctrl+Z pour annuler', { icon: '🗑️' });
  }, [items, commit]);

  // ── Drag & drop (réordonner depuis le panneau) ─────────────────────────────
  const handleDrop = useCallback(() => {
    if (dragIdx == null || !dropPos) { setDragIdx(null); setDropPos(null); return; }
    const el = items[dragIdx]?.el;
    const target = items[dropPos.idx]?.el;
    setDragIdx(null); setDropPos(null);
    if (!el || !target || el === target || !el.parentNode) return;
    el.parentNode.insertBefore(el, dropPos.after ? target.nextSibling : target);
    commit();
    scrollToEl(el);
  }, [dragIdx, dropPos, items, commit, scrollToEl]);

  if (!articleEl || !inView) return null;

  return createPortal(
    <>
      {/* ── Bouton d'ouverture (bord droit) ── */}
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          title="Structure du document — naviguer, déplacer, dupliquer, supprimer les blocs"
          style={{ position: 'fixed', top: '40%', right: 0, zIndex: 240 }}
          className="flex flex-col items-center gap-1.5 bg-gray-900 text-white rounded-l-xl pl-2 pr-1.5 py-3 shadow-[0_6px_24px_rgba(0,0,0,0.35)] hover:bg-gray-800 transition-colors"
        >
          <PanelRight size={15} className="text-indigo-300" />
          <span className="text-[10px] font-semibold tracking-wide" style={{ writingMode: 'vertical-rl' }}>
            Structure
          </span>
        </button>
      )}

      {/* ── Panneau ── */}
      {open && (
        <div
          style={{ position: 'fixed', top: 100, right: 14, width: 300, zIndex: 240, maxHeight: '76vh' }}
          className="flex flex-col bg-white border border-gray-200 rounded-2xl shadow-[0_16px_48px_rgba(0,0,0,0.22)] overflow-hidden"
        >
          <div className="flex items-center gap-2 px-3.5 py-2.5 border-b border-gray-100 bg-gray-50/80">
            <PanelRight size={14} className="text-indigo-500 shrink-0" />
            <span className="text-xs font-semibold text-gray-800 flex-1">Structure du document</span>
            <span className="text-[10px] text-gray-400 font-medium">{items.length} blocs</span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="p-1 rounded-lg hover:bg-black/5 text-gray-400 hover:text-gray-700 transition-colors"
            >
              <X size={14} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto py-1.5">
            {items.length === 0 && (
              <p className="text-xs text-gray-400 text-center py-6">Aucun contenu</p>
            )}
            {items.map((it, idx) => (
              <div key={idx} className="relative">
                {/* Indicateur de dépôt */}
                {dropPos?.idx === idx && !dropPos.after && (
                  <div className="absolute -top-px left-2 right-2 h-0.5 bg-indigo-500 rounded-full z-10" />
                )}
                <div
                  draggable
                  onDragStart={(e) => { setDragIdx(idx); e.dataTransfer.effectAllowed = 'move'; }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    const r = e.currentTarget.getBoundingClientRect();
                    setDropPos({ idx, after: e.clientY > r.top + r.height / 2 });
                  }}
                  onDrop={(e) => { e.preventDefault(); handleDrop(); }}
                  onDragEnd={() => { setDragIdx(null); setDropPos(null); }}
                  onClick={() => scrollToEl(it.el)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setCtxMenu({ x: e.clientX, y: e.clientY, idx });
                  }}
                  className={[
                    'group flex items-center gap-1.5 mx-1.5 px-1.5 py-[5px] rounded-lg cursor-pointer select-none',
                    'hover:bg-indigo-50/80 transition-colors',
                    dragIdx === idx ? 'opacity-40' : '',
                    it.indent ? 'ml-4' : '',
                  ].join(' ')}
                >
                  <GripVertical size={12} className="text-gray-300 group-hover:text-gray-400 shrink-0 cursor-grab" />
                  <it.Icon size={13} className={`shrink-0 ${it.strong ? 'text-indigo-600' : 'text-gray-400'}`} />
                  <span className={[
                    'flex-1 min-w-0 truncate text-[11.5px] leading-tight',
                    it.strong ? 'font-semibold text-gray-800' : 'text-gray-600',
                    it.dim ? 'italic text-gray-300' : '',
                  ].join(' ')}>
                    {it.label || it.kind}
                  </span>
                  {/* Actions au survol */}
                  <span className="hidden group-hover:flex items-center gap-0.5 shrink-0">
                    <button type="button" title="Monter" disabled={idx === 0}
                      onClick={(e) => { e.stopPropagation(); moveItem(idx, -1); }}
                      className="p-0.5 rounded hover:bg-indigo-100 text-gray-400 hover:text-indigo-700 disabled:opacity-25">
                      <ChevronUp size={12} />
                    </button>
                    <button type="button" title="Descendre" disabled={idx === items.length - 1}
                      onClick={(e) => { e.stopPropagation(); moveItem(idx, 1); }}
                      className="p-0.5 rounded hover:bg-indigo-100 text-gray-400 hover:text-indigo-700 disabled:opacity-25">
                      <ChevronDown size={12} />
                    </button>
                    <button type="button" title="Dupliquer"
                      onClick={(e) => { e.stopPropagation(); duplicateItem(idx); }}
                      className="p-0.5 rounded hover:bg-indigo-100 text-gray-400 hover:text-indigo-700">
                      <Copy size={12} />
                    </button>
                    <button type="button" title="Supprimer (Ctrl+Z pour annuler)"
                      onClick={(e) => { e.stopPropagation(); deleteItem(idx); }}
                      className="p-0.5 rounded hover:bg-red-100 text-gray-400 hover:text-red-600">
                      <Trash2 size={12} />
                    </button>
                  </span>
                </div>
                {dropPos?.idx === idx && dropPos.after && (
                  <div className="absolute -bottom-px left-2 right-2 h-0.5 bg-indigo-500 rounded-full z-10" />
                )}
              </div>
            ))}
          </div>

          <div className="px-3.5 py-2 border-t border-gray-100 bg-gray-50/60">
            <p className="text-[10px] text-gray-400 leading-snug">
              Clic : aller au bloc · <span className="font-semibold text-gray-500">Clic droit : copier, couper, coller avant/après</span> · Glisser <GripVertical size={9} className="inline -mt-0.5" /> : réordonner
            </p>
          </div>
        </div>
      )}

      {/* ── Menu contextuel d'un bloc (clic droit sur une ligne du panneau) ── */}
      {open && ctxMenu && (() => {
        const it = items[ctxMenu.idx];
        if (!it) return null;
        const MENU_W = 240;
        const left = Math.max(8, Math.min(ctxMenu.x, window.innerWidth - MENU_W - 8));
        const top  = Math.max(8, Math.min(ctxMenu.y, window.innerHeight - 300));
        const close = () => setCtxMenu(null);
        const MenuItem = ({ Icon, label, danger = false, onClick }) => (
          <button
            type="button"
            onClick={() => { onClick(); close(); }}
            className={`flex items-center gap-2.5 w-full px-3 py-2 text-xs font-medium text-left transition-colors ${
              danger ? 'text-red-600 hover:bg-red-50' : 'text-gray-700 hover:bg-indigo-50'
            }`}
          >
            <Icon size={13} className={danger ? 'text-red-400' : 'text-gray-400'} />
            {label}
          </button>
        );
        return (
          <>
            {/* Fond invisible : ferme le menu au clic ailleurs */}
            <div
              style={{ position: 'fixed', inset: 0, zIndex: 250 }}
              onMouseDown={close}
              onContextMenu={(e) => { e.preventDefault(); close(); }}
            />
            <div
              style={{ position: 'fixed', top, left, width: MENU_W, zIndex: 251 }}
              className="bg-white border border-gray-200 rounded-xl shadow-[0_16px_48px_rgba(0,0,0,0.22)] py-1.5 overflow-hidden"
            >
              <p className="px-3 pt-1 pb-1.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wide truncate border-b border-gray-100">
                {it.kind} — {it.label || '…'}
              </p>
              {onCopyBlock && (
                <MenuItem Icon={Copy} label="Copier le bloc" onClick={() => onCopyBlock(it.el)} />
              )}
              {onCutBlock && (
                <MenuItem Icon={Scissors} label="Couper le bloc" onClick={() => onCutBlock(it.el)} />
              )}
              {clipboard && onPasteRelative && (
                <>
                  <div className="my-1 border-t border-gray-100" />
                  <MenuItem Icon={ClipboardPaste} label={`Coller ${clipboard.art} AVANT ce bloc`} onClick={() => onPasteRelative(it.el, 'before')} />
                  <MenuItem Icon={ClipboardPaste} label={`Coller ${clipboard.art} APRÈS ce bloc`} onClick={() => onPasteRelative(it.el, 'after')} />
                </>
              )}
              <div className="my-1 border-t border-gray-100" />
              <MenuItem Icon={CopyPlus} label="Dupliquer" onClick={() => duplicateItem(ctxMenu.idx)} />
              <MenuItem Icon={Trash2} label="Supprimer (Ctrl+Z pour annuler)" danger onClick={() => deleteItem(ctxMenu.idx)} />
            </div>
          </>
        );
      })()}
    </>,
    document.body,
  );
}
