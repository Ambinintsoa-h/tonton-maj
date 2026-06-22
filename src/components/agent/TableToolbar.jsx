/**
 * TableToolbar — barre contextuelle d'édition de tableaux pour la vue diff.
 *
 * Apparaît au-dessus du tableau quand le curseur est dans une cellule (td/th)
 * de l'éditeur contentEditable. Opère directement sur le DOM puis resynchronise
 * contentRef. Composant isolé (n'altère pas la BubbleToolbar de texte).
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowUpToLine, ArrowDownToLine, ArrowLeftToLine, ArrowRightToLine,
  Trash2, AlignLeft, AlignCenter, AlignRight, Heading, Table2, X,
  ChevronsRight, ChevronsDown, Scissors,
} from 'lucide-react';

const Btn = ({ onClick, title, danger = false, children }) => (
  <button
    type="button"
    title={title}
    onMouseDown={(e) => { e.preventDefault(); onClick(); }}
    className={[
      'flex items-center justify-center w-7 h-7 rounded-md text-xs transition-colors',
      danger ? 'text-red-300 hover:bg-red-500/20 hover:text-red-200'
             : 'text-gray-200 hover:bg-white/15 hover:text-white',
    ].join(' ')}
  >
    {children}
  </button>
);
const Sep = () => <div className="w-px h-4 bg-white/15 mx-0.5 flex-shrink-0" />;

export default function TableToolbar({ articleEl, contentRef }) {
  const [cell, setCell] = useState(null);     // td/th courant
  const [pos, setPos]   = useState({ top: 0, left: 0 });
  const barRef  = useRef(null);
  const hideRef = useRef(null);

  const sync = useCallback(() => {
    if (contentRef && articleEl) contentRef.current = articleEl.innerHTML;
  }, [articleEl, contentRef]);

  // Auto-masquage : la barre ne reste que tant qu'on interagit avec le tableau
  // (curseur/clic/clavier, souris sur une cellule) ou qu'on survole la barre. Sans
  // interaction, elle disparaît au bout de ~4 s — corrige l'effet « barre qui reste ».
  const armHide = useCallback(() => {
    clearTimeout(hideRef.current);
    hideRef.current = setTimeout(() => setCell(null), 4000);
  }, []);

  // Détection de la cellule sous le curseur
  useEffect(() => {
    if (!articleEl) return undefined;
    let raf = null;
    const detect = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        // Ne pas masquer si on interagit avec la barre elle-même
        if (barRef.current && barRef.current.contains(document.activeElement)) return;
        const sel = window.getSelection();
        const node = sel && sel.rangeCount ? sel.anchorNode : null;
        const el = node ? (node.nodeType === 1 ? node : node.parentElement) : null;
        const td = el && articleEl.contains(el) ? el.closest('td, th') : null;
        if (td && articleEl.contains(td)) {
          const table = td.closest('table');
          const rect = (table || td).getBoundingClientRect();
          setCell(td);
          setPos({ top: Math.max(8, rect.top - 42), left: rect.left });
          armHide();
        } else {
          setCell(null);
        }
      });
    };
    // Souris sur une cellule → réarme le minuteur (la barre reste tant que la souris
    // est sur le tableau).
    const onMove = (e) => { if (e.target.closest?.('td, th')) armHide(); };
    document.addEventListener('selectionchange', detect);
    articleEl.addEventListener('click', detect);
    articleEl.addEventListener('keyup', detect);
    articleEl.addEventListener('mousemove', onMove);
    return () => {
      document.removeEventListener('selectionchange', detect);
      articleEl.removeEventListener('click', detect);
      articleEl.removeEventListener('keyup', detect);
      articleEl.removeEventListener('mousemove', onMove);
      clearTimeout(hideRef.current);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [articleEl, armHide]);

  // ── Helpers DOM ─────────────────────────────────────────────────────────────
  const ctx = useCallback(() => {
    if (!cell) return null;
    const tr = cell.closest('tr');
    const table = cell.closest('table');
    if (!tr || !table) return null;
    const idx = Array.from(tr.children).indexOf(cell);
    const rows = Array.from(table.querySelectorAll('tr'));
    return { tr, table, idx, rows };
  }, [cell]);

  const blankCellLike = (ref) => {
    const tag = ref && ref.tagName === 'TH' ? 'th' : 'td';
    const c = document.createElement(tag);
    if (ref?.getAttribute('style')) c.setAttribute('style', ref.getAttribute('style'));
    c.innerHTML = '<br>';
    return c;
  };

  const insertRow = (below) => {
    const c = ctx(); if (!c) return;
    const newRow = c.tr.cloneNode(true);
    Array.from(newRow.children).forEach((cc) => { cc.innerHTML = '<br>'; });
    c.tr.parentNode.insertBefore(newRow, below ? c.tr.nextSibling : c.tr);
    sync();
  };
  const deleteRow = () => {
    const c = ctx(); if (!c) return;
    c.tr.remove();
    if (!c.table.querySelector('tr')) c.table.remove();
    setCell(null); sync();
  };
  const insertCol = (right) => {
    const c = ctx(); if (!c) return;
    c.rows.forEach((r) => {
      const ref = r.children[c.idx];
      const nc = blankCellLike(ref || r.children[r.children.length - 1]);
      if (ref) r.insertBefore(nc, right ? ref.nextSibling : ref);
      else r.appendChild(nc);
    });
    sync();
  };
  const deleteCol = () => {
    const c = ctx(); if (!c) return;
    c.rows.forEach((r) => { if (r.children[c.idx]) r.children[c.idx].remove(); });
    if (!c.table.querySelector('td, th')) c.table.remove();
    setCell(null); sync();
  };
  const alignCol = (align) => {
    const c = ctx(); if (!c) return;
    c.rows.forEach((r) => { const cc = r.children[c.idx]; if (cc) cc.style.textAlign = align; });
    sync();
  };
  const toggleHeader = () => {
    const c = ctx(); if (!c) return;
    const firstRow = c.table.querySelector('tr');
    if (!firstRow) return;
    const toTh = firstRow.children[0]?.tagName !== 'TH';
    Array.from(firstRow.children).forEach((cc) => {
      const nw = document.createElement(toTh ? 'th' : 'td');
      if (cc.getAttribute('style')) nw.setAttribute('style', cc.getAttribute('style'));
      nw.innerHTML = cc.innerHTML;
      cc.replaceWith(nw);
    });
    setCell(null); sync();
  };
  const deleteTable = () => {
    const c = ctx(); if (!c) return;
    c.table.remove();
    setCell(null); sync();
  };

  // ── Fusion / scission (tables simples : sans grille colspan/rowspan complexe) ──
  const mergeContent = (target, donor) => {
    const d = (donor.innerHTML || '').trim();
    if (d && d !== '<br>') {
      const t = (target.innerHTML || '').replace(/<br>\s*$/i, '').trim();
      target.innerHTML = t ? `${t} ${d}` : d;
    }
  };
  const mergeRight = () => {
    const c = ctx(); if (!c) return;
    const cells = Array.from(c.tr.children);
    const next = cells[cells.indexOf(cell) + 1];
    if (!next) return;
    const span = (parseInt(cell.getAttribute('colspan') || '1', 10)) + (parseInt(next.getAttribute('colspan') || '1', 10));
    cell.setAttribute('colspan', String(span));
    mergeContent(cell, next);
    next.remove(); sync();
  };
  const mergeDown = () => {
    const c = ctx(); if (!c) return;
    const nextRow = c.tr.nextElementSibling;
    const below = nextRow && nextRow.children[c.idx];
    if (!below) return;
    const span = (parseInt(cell.getAttribute('rowspan') || '1', 10)) + (parseInt(below.getAttribute('rowspan') || '1', 10));
    cell.setAttribute('rowspan', String(span));
    mergeContent(cell, below);
    below.remove(); sync();
  };
  const splitCell = () => {
    if (!cell) return;
    cell.removeAttribute('colspan');
    cell.removeAttribute('rowspan');
    sync();
  };

  if (!cell) return null;

  return createPortal(
    <div
      ref={barRef}
      style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 9998 }}
      onMouseDown={(e) => e.preventDefault()}
      onMouseEnter={() => clearTimeout(hideRef.current)}
      onMouseLeave={armHide}
      className="flex items-center gap-0.5 bg-gray-900 border border-gray-700 rounded-xl px-2 py-1.5 shadow-[0_8px_32px_rgba(0,0,0,0.5)] whitespace-nowrap"
    >
      <span className="flex items-center gap-1 text-[10px] font-semibold text-white/40 pr-1">
        <Table2 size={12} /> Tableau
      </span>
      <Sep />
      {/* Lignes */}
      <Btn onClick={() => insertRow(false)} title="Ligne au-dessus"><ArrowUpToLine size={14} /></Btn>
      <Btn onClick={() => insertRow(true)}  title="Ligne en dessous"><ArrowDownToLine size={14} /></Btn>
      <Btn onClick={deleteRow} title="Supprimer la ligne" danger><Trash2 size={13} /></Btn>
      <Sep />
      {/* Colonnes */}
      <Btn onClick={() => insertCol(false)} title="Colonne à gauche"><ArrowLeftToLine size={14} /></Btn>
      <Btn onClick={() => insertCol(true)}  title="Colonne à droite"><ArrowRightToLine size={14} /></Btn>
      <Btn onClick={deleteCol} title="Supprimer la colonne" danger><Trash2 size={13} className="rotate-90" /></Btn>
      <Sep />
      {/* Alignement (colonne) */}
      <Btn onClick={() => alignCol('left')}   title="Aligner à gauche"><AlignLeft size={14} /></Btn>
      <Btn onClick={() => alignCol('center')} title="Centrer"><AlignCenter size={14} /></Btn>
      <Btn onClick={() => alignCol('right')}  title="Aligner à droite"><AlignRight size={14} /></Btn>
      <Sep />
      {/* Fusion / scission */}
      <Btn onClick={mergeRight} title="Fusionner avec la cellule de droite"><ChevronsRight size={14} /></Btn>
      <Btn onClick={mergeDown}  title="Fusionner avec la cellule du dessous"><ChevronsDown size={14} /></Btn>
      <Btn onClick={splitCell}  title="Scinder (annuler la fusion)"><Scissors size={13} /></Btn>
      <Sep />
      {/* En-tête + suppression tableau */}
      <Btn onClick={toggleHeader} title="Basculer ligne d'en-tête"><Heading size={14} /></Btn>
      <Btn onClick={deleteTable} title="Supprimer le tableau" danger><X size={14} /></Btn>
    </div>,
    document.body,
  );
}
