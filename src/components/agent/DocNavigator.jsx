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
  List, ListOrdered, X, ChevronUp, ChevronDown, ChevronRight, Copy, Trash2, GripVertical,
  Heading1, Heading2, Heading3, Heading4, Type, Table2, Image as ImageIcon,
  Film, HelpCircle, Quote, Box, PanelRight, Scissors, ClipboardPaste, CopyPlus,
  FoldVertical, UnfoldVertical, ArrowUp, ArrowDown,
} from 'lucide-react';
import { unwrapDiffWrapper, isDiffWrapper, isDiffDel, isDiffMark } from '../../utils/blocks';

// ── Description d'un bloc top-level ──────────────────────────────────────────
const excerpt = (s, n = 48) => {
  const t = (s || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n) + '…' : t;
};

const describe = (rawEl) => {
  // Voir à travers les marqueurs de diff (<ins>/<mark>) : un bloc AJOUTÉ doit
  // s'afficher avec son vrai type (H2, tableau…), pas comme un « ins » générique.
  const el = unwrapDiffWrapper(rawEl);
  // Section ENTIÈRE ajoutée/réécrite encore EN ATTENTE : wrapper <ins>/<mark>
  // multi-blocs dont le premier élément est un titre → présentée comme un vrai
  // titre de section (et buildGroups ouvre une section dessus, dès le début —
  // avant, ces blocs bleus restaient noyés dans la section précédente).
  if (el === rawEl && isDiffWrapper(rawEl)) {
    const first = rawEl.firstElementChild;
    const hm = first && first.tagName ? first.tagName.match(/^H([1-6])$/) : null;
    if (hm) {
      const lvl = parseInt(hm[1], 10);
      const Icon = [Heading1, Heading2, Heading3, Heading4][Math.min(lvl, 4) - 1];
      return { Icon, kind: `Section H${lvl}`, label: excerpt(first.textContent, 56), strong: lvl <= 2, sectionLevel: lvl };
    }
  }
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
//  onCopySection(els, cut) — copier/couper une section H2 entière (tous ses nœuds)
//  onPasteRelative(el, 'before'|'after') — coller le presse-papiers autour d'un bloc
export default function DocNavigator({ articleEl, onEdited, clipboard = null, onCopyBlock, onCutBlock, onCopySection, onPasteRelative }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);      // [{ el, Icon, kind, label, … }]
  const [dragIdx, setDragIdx] = useState(null);
  const [dropPos, setDropPos] = useState(null); // { idx, after }
  const [ctxMenu, setCtxMenu] = useState(null); // { x, y, idx } — menu contextuel (clic droit)
  // Sections H2 dépliées (clé = titre H2). Vide = tout plié (défaut, idéal pour
  // les longs articles : on voit d'abord la liste des sections).
  const [expanded, setExpanded] = useState(() => new Set());
  const debounceRef = useRef(null);

  // ── Visibilité limitée au bloc « Après — MAJ proposées » ──────────────────
  // Le widget (positionné fixed) n'apparaît que quand le bloc éditeur est
  // réellement À L'ÉCRAN : scrollé sur la Synthèse, le Détail des modifications
  // ou les Sources → il disparaît. (Sur les onglets Audit/Avant, l'éditeur est
  // démonté → articleEl est null → déjà masqué.)
  const [inView, setInView] = useState(false);
  useEffect(() => {
    if (!articleEl) { setInView(false); return; }
    // threshold 0 (toute intersection, même d'un pixel) et NON une fraction de
    // l'élément : l'éditeur d'un long article mesure plusieurs fois la hauteur de
    // la fenêtre, donc la fraction visible est structurellement minuscule. Avec un
    // seuil de 0,05 un article de 13 000 px dans une fenêtre de 700 px plafonnait
    // à 0,052 → le panneau n'apparaissait que dans une bande de défilement
    // étroite, et devenait DÉFINITIVEMENT inatteignable au-delà de 20 × la
    // hauteur de fenêtre. La bonne question est « l'éditeur est-il à l'écran ? »,
    // pas « quelle proportion de l'éditeur est à l'écran ? ».
    const io = new IntersectionObserver(
      ([entry]) => setInView(entry.isIntersecting),
      { threshold: 0 },
    );
    io.observe(articleEl);
    return () => io.disconnect();
  }, [articleEl]);

  // ── Construction de la liste depuis les enfants top-level de l'article ─────
  // Une modification EN ATTENTE (paire adjacente <del>+<mark> insérée par
  // applyDiff) devient UN SEUL item — représenté par le <mark> (nouvelle
  // version) — et TOUTES les actions (déplacer, glisser, dupliquer, supprimer,
  // couper) emportent les deux nœuds via `nodes` : les séparer casserait les
  // boutons Accepter/Rejeter, qui reposent sur leur adjacence.
  const refresh = useCallback(() => {
    if (!articleEl) { setItems([]); return; }
    const kids = Array.from(articleEl.children)
      .filter(el => !['SCRIPT', 'STYLE', 'BR'].includes(el.tagName));
    const list = [];
    for (let i = 0; i < kids.length; i++) {
      const el = kids[i];
      // Même critère d'adjacence DOM que resolveDiffPair (ArticleResult)
      if (isDiffDel(el) && isDiffMark(el.nextElementSibling) && kids[i + 1] === el.nextElementSibling) {
        list.push({ el: kids[i + 1], nodes: [el, kids[i + 1]], pending: true, ...describe(kids[i + 1]) });
        i++;
        continue;
      }
      list.push({ el, nodes: [el], pending: isDiffWrapper(el), ...describe(el) });
    }
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

  // ── Navigation « ancre » (table des matières) : saut DIRECT + flash ─────────
  // Défilement INSTANTANÉ (pas de smooth : deux animations smooth imbriquées —
  // éditeur + page — s'annulent mutuellement dans Chrome, d'où des clics qui ne
  // défilaient pas). Chaque niveau est appliqué puis la position RÉELLE du bloc
  // est relue avant d'ajuster le niveau suivant :
  //   1. scroll interne de l'éditeur (si l'éditeur défile) → bloc au tiers haut ;
  //   2. tous les ancêtres défilants (le <main> du layout), sinon la fenêtre →
  //      le bloc est amené au quart haut du viewport.
  // (Pas de scrollIntoView : bug Chrome sur contentEditable — même technique
  // que jumpToChange.)
  const scrollToEl = useCallback((el) => {
    if (!articleEl || !el) return;
    const viewH = window.innerHeight || document.documentElement.clientHeight;

    // 1. Scroll interne de l'éditeur — instantané (assignation synchrone :
    //    la position du bloc relue ensuite est déjà à jour)
    const innerMax = Math.max(0, articleEl.scrollHeight - articleEl.clientHeight);
    if (innerMax > 0) {
      const relativeTop = el.getBoundingClientRect().top
        - articleEl.getBoundingClientRect().top
        + articleEl.scrollTop;
      articleEl.scrollTop = Math.min(innerMax, Math.max(0, relativeTop - articleEl.clientHeight / 3));
    }

    // 2. Ancêtres défilants (du plus proche au plus lointain) : chacun corrige
    //    le reste de l'écart pour poser le bloc au quart haut de l'écran.
    let adjusted = false;
    let p = articleEl.parentElement;
    while (p) {
      if (p.scrollHeight > p.clientHeight + 1) {
        const s = getComputedStyle(p);
        if (/(auto|scroll)/.test(s.overflowY)) {
          p.scrollTop += el.getBoundingClientRect().top - viewH / 4; // clampé par le DOM
          adjusted = true;
        }
      }
      p = p.parentElement;
    }
    if (!adjusted) {
      window.scrollBy(0, el.getBoundingClientRect().top - viewH / 4);
    }

    el.style.outline = '2px solid #6366f1';
    el.style.outlineOffset = '3px';
    setTimeout(() => { el.style.outline = ''; el.style.outlineOffset = ''; }, 1400);
  }, [articleEl]);

  const commit = useCallback(() => {
    onEdited?.();
    refresh();
  }, [onEdited, refresh]);

  // ── Actions bloc ────────────────────────────────────────────────────────────
  // Toutes opèrent sur `nodes` (paire <del>+<mark> complète pour une
  // modification en attente) — jamais sur un demi-cluster.
  const moveItem = useCallback((idx, dir) => {
    const item = items[idx];
    const target = items[idx + dir];
    if (!item || !target || !item.el.parentNode) return;
    const parent = item.el.parentNode;
    const ref = dir < 0 ? target.nodes[0] : target.nodes[target.nodes.length - 1].nextSibling;
    item.nodes.forEach(n => parent.insertBefore(n, ref));
    commit();
    scrollToEl(item.el);
  }, [items, commit, scrollToEl]);

  const duplicateItem = useCallback((idx) => {
    const item = items[idx];
    if (!item || !item.el.parentNode) return;
    const parent = item.el.parentNode;
    const ref = item.nodes[item.nodes.length - 1].nextSibling;
    let firstClone = null;
    item.nodes.forEach((n) => {
      const clone = n.cloneNode(true);
      if (!firstClone) firstClone = clone;
      parent.insertBefore(clone, ref);
    });
    commit();
    scrollToEl(firstClone);
    toast.success('Bloc dupliqué');
  }, [items, commit, scrollToEl]);

  const deleteItem = useCallback((idx) => {
    const item = items[idx];
    if (!item) return;
    item.nodes.forEach(n => n.remove());
    commit();
    toast('Bloc supprimé — Ctrl+Z pour annuler', { icon: '🗑️' });
  }, [items, commit]);

  // ── Drag & drop (réordonner depuis le panneau) ─────────────────────────────
  const handleDrop = useCallback(() => {
    if (dragIdx == null || !dropPos) { setDragIdx(null); setDropPos(null); return; }
    const item = items[dragIdx];
    const target = items[dropPos.idx];
    setDragIdx(null); setDropPos(null);
    if (!item || !target || item === target || !item.el.parentNode) return;
    const parent = item.el.parentNode;
    const ref = dropPos.after ? target.nodes[target.nodes.length - 1].nextSibling : target.nodes[0];
    item.nodes.forEach(n => parent.insertBefore(n, ref));
    commit();
    scrollToEl(item.el);
  }, [dragIdx, dropPos, items, commit, scrollToEl]);

  // ── Regroupement par section H2 ─────────────────────────────────────────────
  // Un article = préambule (H1 + intro avant le 1er H2) puis une section par H2.
  // Chaque section = le H2 + tous les éléments jusqu'au H2 suivant. Permet de
  // plier/déplier et de DÉPLACER une section entière (le bloc complet).
  const buildGroups = (list) => {
    const groups = [];
    let cur = null;
    list.forEach((it, idx) => {
      // Voir à travers <ins>/<mark> : un H2 AJOUTÉ ouvre bien une nouvelle
      // section — y compris une section ENTIÈRE encore en attente (wrapper
      // multi-blocs commençant par un H2, détectée par describe → sectionLevel).
      if (unwrapDiffWrapper(it.el).tagName === 'H2' || it.sectionLevel === 2) {
        cur = { title: it.label || 'Section', isPreamble: false, members: [] };
        groups.push(cur);
      } else if (!cur) {
        cur = { title: 'Introduction', isPreamble: true, members: [] };
        groups.push(cur);
      }
      cur.members.push({ ...it, idx });
    });
    // clé stable (titre + rang parmi les titres identiques) pour l'état plié/déplié
    const seen = {};
    groups.forEach(g => {
      const n = (seen[g.title] = (seen[g.title] || 0) + 1);
      g.key = `${g.title}#${n}`;
      // Point orange sur l'en-tête : la section contient des modifications en attente
      g.pending = g.members.some(m => m.pending);
    });
    return groups;
  };

  // Déplace une section ENTIÈRE (tous ses éléments) au-dessus/en-dessous de la
  // section voisine → « déplacer le bloc entier ».
  const moveSection = useCallback((groups, gIdx, dir) => {
    const g = groups[gIdx];
    const target = groups[gIdx + dir];
    if (!g || !target || !g.members.length || !target.members.length) return;
    const parent = g.members[0].el.parentNode;
    if (!parent) return;
    if (dir < 0) {
      const ref = target.members[0].nodes[0]; // avant le 1er nœud de la section précédente
      g.members.forEach(m => m.nodes.forEach(n => parent.insertBefore(n, ref)));
    } else {
      const lastM = target.members[target.members.length - 1];
      const ref = lastM.nodes[lastM.nodes.length - 1].nextSibling; // après le dernier de la suivante
      g.members.forEach(m => m.nodes.forEach(n => parent.insertBefore(n, ref)));
    }
    commit();
    scrollToEl(g.members[0].el);
  }, [commit, scrollToEl]);

  const toggleGroup = useCallback((key) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  if (!articleEl || !inView) return null;

  const groups = buildGroups(items);
  const allExpanded = groups.length > 0 && groups.every(g => expanded.has(g.key));

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
            <span className="text-[10px] text-gray-400 font-medium">{groups.length} sect. · {items.length} blocs</span>
            <button
              type="button"
              title={allExpanded ? 'Tout replier' : 'Tout déplier'}
              onClick={() => setExpanded(allExpanded ? new Set() : new Set(groups.map(g => g.key)))}
              className="p-1 rounded-lg hover:bg-black/5 text-gray-400 hover:text-indigo-600 transition-colors"
            >
              {allExpanded ? <FoldVertical size={14} /> : <UnfoldVertical size={14} />}
            </button>
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
            {groups.map((g, gIdx) => {
              const isOpen = expanded.has(g.key);
              return (
                <div key={g.key} className="mb-0.5">
                  {/* ── En-tête de section (H2) — pliable, déplaçable en entier ── */}
                  <div className="group/sec flex items-center gap-1 mx-1.5 px-1 py-1 rounded-lg bg-gray-50 hover:bg-indigo-50/70 transition-colors">
                    <button
                      type="button"
                      onClick={() => toggleGroup(g.key)}
                      className="p-0.5 rounded text-gray-400 hover:text-indigo-700 shrink-0"
                      title={isOpen ? 'Replier la section' : 'Déplier la section'}
                    >
                      {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </button>
                    <button
                      type="button"
                      onClick={() => { scrollToEl(g.members[0].el); }}
                      className="flex-1 min-w-0 flex items-center gap-1.5 text-left"
                      title="Aller à la section"
                    >
                      {g.isPreamble
                        ? <Type size={12} className="text-gray-400 shrink-0" />
                        : <Heading2 size={12} className="text-indigo-600 shrink-0" />}
                      {g.pending && (
                        <span
                          title="Cette section contient des modifications en attente (Accepter/Rejeter dans l'éditeur)"
                          className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0"
                        />
                      )}
                      <span className="flex-1 min-w-0 truncate text-[11.5px] font-semibold text-gray-800">{g.title}</span>
                      <span className="text-[10px] text-gray-400 shrink-0">{g.members.length}</span>
                    </button>
                    {/* Déplacer / copier / couper la SECTION entière */}
                    <span className="hidden group-hover/sec:flex items-center gap-0.5 shrink-0">
                      <button type="button" title="Monter la section entière" disabled={gIdx === 0}
                        onClick={() => moveSection(groups, gIdx, -1)}
                        className="p-0.5 rounded hover:bg-indigo-100 text-gray-400 hover:text-indigo-700 disabled:opacity-20">
                        <ArrowUp size={12} />
                      </button>
                      <button type="button" title="Descendre la section entière" disabled={gIdx === groups.length - 1}
                        onClick={() => moveSection(groups, gIdx, 1)}
                        className="p-0.5 rounded hover:bg-indigo-100 text-gray-400 hover:text-indigo-700 disabled:opacity-20">
                        <ArrowDown size={12} />
                      </button>
                      {onCopySection && (
                        <>
                          <button type="button" title="Copier la section entière (H2 + contenu) — coller ensuite au clic droit"
                            onClick={() => onCopySection(g.members.flatMap(m => m.nodes), false)}
                            className="p-0.5 rounded hover:bg-indigo-100 text-gray-400 hover:text-indigo-700">
                            <Copy size={12} />
                          </button>
                          <button type="button" title="Couper la section entière (H2 + contenu) — coller ensuite au clic droit"
                            onClick={() => onCopySection(g.members.flatMap(m => m.nodes), true)}
                            className="p-0.5 rounded hover:bg-amber-100 text-gray-400 hover:text-amber-600">
                            <Scissors size={12} />
                          </button>
                        </>
                      )}
                    </span>
                  </div>

                  {/* ── Éléments de la section (visibles seulement si dépliée) ── */}
                  {isOpen && g.members.map((it) => {
                    const idx = it.idx;
                    return (
                      <div key={idx} className="relative">
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
                            'group flex items-center gap-1.5 ml-5 mr-1.5 px-1.5 py-[5px] rounded-lg cursor-pointer select-none',
                            'hover:bg-indigo-50/80 transition-colors',
                            dragIdx === idx ? 'opacity-40' : '',
                          ].join(' ')}
                        >
                          <GripVertical size={12} className="text-gray-300 group-hover:text-gray-400 shrink-0 cursor-grab" />
                          <it.Icon size={13} className={`shrink-0 ${it.strong ? 'text-indigo-600' : 'text-gray-400'}`} />
                          {it.pending && (
                            <span
                              title="Modification en attente (Accepter/Rejeter dans l'éditeur) — le bloc reste manipulable : déplacer, dupliquer, couper, supprimer"
                              className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0"
                            />
                          )}
                          <span className={[
                            'flex-1 min-w-0 truncate text-[11.5px] leading-tight',
                            it.strong ? 'font-semibold text-gray-800' : 'text-gray-600',
                            it.dim ? 'italic text-gray-300' : '',
                          ].join(' ')}>
                            {it.label || it.kind}
                          </span>
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
                    );
                  })}
                </div>
              );
            })}
          </div>

          <div className="px-3.5 py-2 border-t border-gray-100 bg-gray-50/60">
            <p className="text-[10px] text-gray-400 leading-snug">
              Sections H2 pliables · <ArrowUp size={9} className="inline -mt-0.5" /><ArrowDown size={9} className="inline -mt-0.5" /> déplace, ⧉/✂ copie ou coupe la section entière · Clic droit sur un bloc : copier/couper/coller avant-après · Point orange = modification en attente (manipulable quand même)
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
