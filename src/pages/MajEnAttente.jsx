import { useState, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import toast from 'react-hot-toast';
import * as XLSX from 'xlsx';
import {
  Clock, Upload, Trash2, CheckCircle2, AlertCircle,
  ExternalLink, Plus, X, RefreshCw, ChevronDown, ChevronUp,
  FileSpreadsheet, Link2, Sparkles, Filter, Loader, UserCircle2,
  Globe, PencilLine,
} from 'lucide-react';
import {
  addPendingItems, addPendingItem, removePendingItem,
  updatePendingItem, clearDone, clearAll,
} from '../store/slices/pendingSlice';
import {
  resetAgent, setStatus, addStep, setProgress,
  setOriginalContent, setUpdatedContent, setDiff,
  setSources, setAnalysis, setError, setCurrentArticleId, setTokenUsage, setParseFailed,
  setWpData,
} from '../store/slices/agentSlice';
import { addArticleStat } from '../store/slices/statsSlice';
import axios from 'axios';
import { scrapeUrl } from '../services/scraper';
import { runAgent } from '../services/agent';
import { applyAllDiffs } from '../utils/diff';
import { renderMarkdown } from '../utils/markdown';

// ── Helpers ──────────────────────────────────────────────────────────────────

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const STATUS_META = {
  pending:     { label: 'En attente',  color: 'text-amber-600  bg-amber-50  border-amber-200'  },
  in_progress: { label: 'En cours',    color: 'text-blue-600   bg-blue-50   border-blue-200'   },
  a_valider:   { label: 'À valider',   color: 'text-purple-600 bg-purple-50 border-purple-200' },
  error:       { label: 'Erreur',      color: 'text-red-600    bg-red-50    border-red-200'    },
};

const PRIORITY_META = {
  haute:   {
    label: 'Haute',
    dot:     'bg-red-500',
    border:  'border-l-red-500',
    badge:   'bg-red-100 text-red-700 border-red-300',
    section: 'text-red-600 bg-red-50 border-red-200',
    emoji:   '🔴',
  },
  normale: {
    label: 'Normale',
    dot:     'bg-amber-400',
    border:  'border-l-amber-400',
    badge:   'bg-amber-50 text-amber-700 border-amber-200',
    section: 'text-amber-700 bg-amber-50 border-amber-200',
    emoji:   '🟡',
  },
  basse:   {
    label: 'Basse',
    dot:     'bg-gray-400',
    border:  'border-l-gray-300',
    badge:   'bg-gray-100 text-gray-500 border-gray-200',
    section: 'text-gray-500 bg-gray-50 border-gray-200',
    emoji:   '⚪',
  },
};

const PRIORITY_ORDER = ['haute', 'normale', 'basse'];

// Couleur de l'icône domaine (cohérente par domaine, déterministe)
const DOMAIN_COLORS = [
  'bg-blue-500', 'bg-violet-500', 'bg-emerald-500', 'bg-amber-500',
  'bg-rose-500',  'bg-teal-500',   'bg-indigo-500',  'bg-pink-500',
];
const domainColor = (domain) => {
  let h = 0;
  for (const c of (domain || '')) h = (h * 31 + c.charCodeAt(0)) % DOMAIN_COLORS.length;
  return DOMAIN_COLORS[h];
};

// Détecte automatiquement les colonnes du fichier importé
const detectColumns = (headers) => {
  const h = headers.map(s => (s || '').toString().toLowerCase().trim());
  const find = (...patterns) => {
    const idx = h.findIndex(col => patterns.some(p => col.includes(p)));
    return idx >= 0 ? headers[idx] : null;
  };
  return {
    url:      find('url', 'lien', 'link', 'adresse'),
    title:    find('titre', 'title', 'nom', 'name', 'page'),
    keyword:  find('mot', 'keyword', 'kw', 'requête', 'query', 'cible'),
    priority: find('priorité', 'priority', 'prio', 'urgence'),
    notes:    find('note', 'comment', 'remarque', 'info'),
  };
};

const parsePriority = (val) => {
  const v = (val || '').toString().toLowerCase();
  if (v.includes('haut') || v.includes('high') || v === '1') return 'haute';
  if (v.includes('bas')  || v.includes('low')  || v === '3') return 'basse';
  return 'normale';
};

// ── Helper : extrait le domaine d'une URL ─────────────────────────────────────
const extractDomain = (url) => {
  try { return new URL(url).hostname.replace(/^www\./, ''); }
  catch { return url; }
};

// ── Composants visuels ────────────────────────────────────────────────────────

function StatusBadge({ status }) {
  const m = STATUS_META[status] || STATUS_META.pending;
  return (
    <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold border rounded-full px-2.5 py-1 whitespace-nowrap leading-none ${m.color}`}>
      {status === 'done'        && <CheckCircle2 size={10} />}
      {status === 'in_progress' && <RefreshCw size={10} className="animate-spin" />}
      {status === 'error'       && <AlertCircle size={10} />}
      {status === 'pending'     && <Clock size={10} />}
      {m.label}
    </span>
  );
}

// ── Rôles autorisés pour l'assignation (hors super_admin et agents IA) ────────
const ASSIGNABLE_ROLES = ['cq_ia', 'manager'];

const ROLE_COLORS = {
  cq_ia:   'bg-blue-100 text-blue-700',
  manager: 'bg-purple-100 text-purple-700',
};

// ── Avatar initiales d'un membre assigné ─────────────────────────────────────
function AssigneeAvatar({ member, size = 'sm' }) {
  if (!member) return null;
  const initials = [member.firstName?.[0], member.lastName?.[0]]
    .filter(Boolean).join('').toUpperCase() || '?';
  const cls = ROLE_COLORS[member.role] || 'bg-gray-100 text-gray-600';
  const sz  = size === 'sm' ? 'w-6 h-6 text-[10px]' : 'w-7 h-7 text-xs';
  return (
    <div
      className={`${sz} ${cls} rounded-full flex items-center justify-center font-bold flex-shrink-0`}
      title={`${member.firstName} ${member.lastName}`}
    >
      {initials}
    </div>
  );
}

// ── Upload zone ───────────────────────────────────────────────────────────────

function UploadZone({ onParsed }) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef(null);

  const processFile = useCallback((file) => {
    if (!file) return;
    const ext = file.name.split('.').pop().toLowerCase();
    if (!['xlsx', 'xls', 'csv', 'ods'].includes(ext)) {
      toast.error('Format non supporté — utilisez XLSX, CSV ou ODS');
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'array' });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

        if (rows.length < 2) {
          toast.error('Le fichier est vide ou ne contient qu\'une ligne d\'en-têtes');
          return;
        }

        const headers = rows[0].map(String);
        const cols = detectColumns(headers);

        if (!cols.url) {
          toast.error('Colonne URL introuvable — vérifiez que votre fichier contient une colonne "URL" ou "Lien"');
          return;
        }

        const items = [];
        for (let i = 1; i < rows.length; i++) {
          const row = rows[i];
          const getCol = (colName) => colName ? (row[headers.indexOf(colName)] || '').toString().trim() : '';
          const url = getCol(cols.url);
          if (!url || !url.startsWith('http')) continue;

          items.push({
            id:       uid(),
            url,
            title:    getCol(cols.title)    || url,
            keyword:  getCol(cols.keyword)  || '',
            priority: parsePriority(getCol(cols.priority)),
            notes:    getCol(cols.notes)    || '',
            status:   'pending',
            source:   'import',
            addedAt:  Date.now(),
            updatedAt: Date.now(),
          });
        }

        if (items.length === 0) {
          toast.error('Aucun article valide trouvé (les URLs doivent commencer par http)');
          return;
        }

        onParsed(items);
        toast.success(`${items.length} article(s) importé(s)`, { icon: '📋' });
      } catch (err) {
        toast.error('Erreur de lecture du fichier : ' + err.message);
      }
    };
    reader.readAsArrayBuffer(file);
  }, [onParsed]);

  const onDrop = useCallback((e) => {
    e.preventDefault();
    setDragging(false);
    processFile(e.dataTransfer.files[0]);
  }, [processFile]);

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      onClick={() => inputRef.current?.click()}
      className={`
        border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all duration-200
        ${dragging
          ? 'border-blue-400 bg-blue-50/60 scale-[1.01]'
          : 'border-gray-200 bg-gray-50/60 hover:border-gray-300 hover:bg-gray-100/60'}
      `}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.xls,.csv,.ods"
        className="hidden"
        onChange={(e) => processFile(e.target.files[0])}
      />
      <div className="flex flex-col items-center gap-3">
        <div className="w-12 h-12 rounded-2xl bg-white border border-gray-200 shadow-sm flex items-center justify-center">
          <FileSpreadsheet size={22} className="text-gray-400" />
        </div>
        <div>
          <p className="text-sm font-semibold text-gray-700">
            Glissez votre fichier ici, ou <span className="text-blue-600">parcourez</span>
          </p>
          <p className="text-xs text-gray-400 mt-1">
            Google Sheets (export XLSX / CSV) · Excel · LibreOffice
          </p>
        </div>
        <div className="flex items-center gap-4 text-[11px] text-gray-400 mt-1">
          <span className="flex items-center gap-1"><CheckCircle2 size={11} className="text-green-500" /> Colonne URL obligatoire</span>
          <span className="flex items-center gap-1"><CheckCircle2 size={11} className="text-green-500" /> Titre, Mot-clé, Priorité (optionnels)</span>
        </div>
      </div>
    </div>
  );
}

// ── Formulaire ajout manuel ───────────────────────────────────────────────────

function AddManualForm({ onAdd, onClose, teamMembers }) {
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [keyword, setKeyword] = useState('');
  const [priority, setPriority] = useState('normale');
  const [notes, setNotes] = useState('');
  const [assigneeId, setAssigneeId] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!url.trim() || !url.startsWith('http')) {
      toast.error('URL invalide');
      return;
    }
    onAdd({
      id: uid(),
      url: url.trim(),
      title: title.trim() || url.trim(),
      keyword: keyword.trim(),
      priority,
      notes: notes.trim(),
      assigneeId: assigneeId || null,
      status: 'pending',
      source: 'manual',
      addedAt: Date.now(),
      updatedAt: Date.now(),
    });
    toast.success('Article ajouté à la liste');
    onClose();
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="glass-card p-5 space-y-4"
    >
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
          <Plus size={14} className="text-gray-500" />
          Ajouter manuellement
        </h3>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
          <X size={16} />
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <label className="text-xs font-medium text-gray-500 mb-1 block">URL *</label>
            <input
              type="url"
              value={url}
              onChange={e => setUrl(e.target.value)}
              placeholder="https://monsite.com/article"
              className="input-field w-full text-sm"
              required
            />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">Titre</label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Titre de l'article"
              className="input-field w-full text-sm"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">Mot-clé cible</label>
            <input
              type="text"
              value={keyword}
              onChange={e => setKeyword(e.target.value)}
              placeholder="ex: référencement naturel"
              className="input-field w-full text-sm"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">Priorité</label>
            <select
              value={priority}
              onChange={e => setPriority(e.target.value)}
              className="input-field w-full text-sm"
            >
              <option value="haute">Haute</option>
              <option value="normale">Normale</option>
              <option value="basse">Basse</option>
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">Notes</label>
            <input
              type="text"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Remarques, contexte…"
              className="input-field w-full text-sm"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">Assigner à</label>
            <select
              value={assigneeId}
              onChange={e => setAssigneeId(e.target.value)}
              className="input-field w-full text-sm"
            >
              <option value="">— Non assigné —</option>
              {teamMembers.map(m => (
                <option key={m.id} value={m.id}>
                  {m.firstName} {m.lastName} ({m.role === 'cq_ia' ? 'CQ IA' : 'Manager'})
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="btn-ghost text-sm">
            Annuler
          </button>
          <button type="submit" className="btn-primary text-sm flex items-center gap-2">
            <Plus size={13} />
            Ajouter
          </button>
        </div>
      </form>
    </motion.div>
  );
}

// ── Séparateur de section priorité ───────────────────────────────────────────
function PrioritySectionRow({ priority, count }) {
  const m = PRIORITY_META[priority];
  return (
    <div className={`flex items-center gap-2 px-5 py-2 text-[11px] font-semibold border-b ${m.section}`}>
      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${m.dot}`} />
      <span>Priorité {m.label}</span>
      <span className="ml-auto font-normal opacity-50 text-[10px]">{count} article{count > 1 ? 's' : ''}</span>
    </div>
  );
}

// ── Dropdown portal — rendu dans document.body pour échapper aux transform CSS ─
// (Framer Motion layout/animate applique des transforms sur les ancêtres,
//  ce qui casse position:fixed sans portal)
const DROPDOWN_STYLE = {
  position: 'fixed', zIndex: 9999,
  background: '#fff', borderRadius: 16,
  paddingTop: 6, paddingBottom: 6,
  boxShadow: '0 12px 48px rgba(0,0,0,0.14)',
  border: '1px solid rgba(0,0,0,0.07)',
};

// ── Custom Priority Picker ────────────────────────────────────────────────────
function PriorityPicker({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos]   = useState({ top: 0, left: 0 });
  const btnRef = useRef(null);
  const meta = PRIORITY_META[value] || PRIORITY_META.normale;

  const handleOpen = () => {
    if (btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 6, left: r.left });
    }
    setOpen(x => !x);
  };

  return (
    <div className="inline-block">
      <button
        ref={btnRef}
        onClick={handleOpen}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-semibold leading-none transition-opacity hover:opacity-75 ${meta.badge}`}
      >
        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${meta.dot}`} />
        {meta.label}
        <ChevronDown size={9} className="opacity-50 ml-0.5" />
      </button>

      {createPortal(
        <AnimatePresence>
          {open && (
            <>
              <div style={{ position: 'fixed', inset: 0, zIndex: 9998 }} onClick={() => setOpen(false)} />
              <motion.div
                initial={{ opacity: 0, y: -4, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -4, scale: 0.96 }}
                transition={{ duration: 0.12 }}
                style={{ ...DROPDOWN_STYLE, top: pos.top, left: pos.left, minWidth: 130 }}
              >
                {PRIORITY_ORDER.map(p => {
                  const m = PRIORITY_META[p];
                  const active = p === value;
                  return (
                    <button
                      key={p}
                      onClick={() => { onChange(p); setOpen(false); }}
                      className={`flex items-center gap-2.5 w-full px-3.5 py-2 text-xs font-medium transition-colors hover:bg-gray-50 ${active ? 'text-gray-900' : 'text-gray-500'}`}
                    >
                      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${m.dot}`} />
                      <span>{m.label}</span>
                      {active && <CheckCircle2 size={10} className="ml-auto text-emerald-500" />}
                    </button>
                  );
                })}
              </motion.div>
            </>
          )}
        </AnimatePresence>,
        document.body
      )}
    </div>
  );
}

// ── Custom Assignee Picker ────────────────────────────────────────────────────
function AssigneePicker({ value, onChange, teamMembers }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos]   = useState({ top: 0, left: 0, width: 0 });
  const btnRef = useRef(null);
  const current = teamMembers.find(m => m.id === value) || null;

  const handleOpen = () => {
    if (btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 6, left: r.left, width: Math.max(r.width, 220) });
    }
    setOpen(x => !x);
  };

  return (
    <div className="inline-block">
      <button
        ref={btnRef}
        onClick={handleOpen}
        className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg border border-gray-200 bg-white/80 text-[11px] font-medium text-gray-600 hover:border-gray-300 hover:bg-white transition-colors leading-none"
        style={{ minWidth: 120, maxWidth: 180 }}
      >
        {current ? (
          <>
            <AssigneeAvatar member={current} size="sm" />
            <span className="truncate flex-1 text-left">{current.firstName}</span>
          </>
        ) : (
          <>
            <UserCircle2 size={12} className="text-gray-300 flex-shrink-0" />
            <span className="text-gray-300 flex-1 text-left">—</span>
          </>
        )}
        <ChevronDown size={9} className="opacity-35 flex-shrink-0 ml-auto" />
      </button>

      {createPortal(
        <AnimatePresence>
          {open && (
            <>
              <div style={{ position: 'fixed', inset: 0, zIndex: 9998 }} onClick={() => setOpen(false)} />
              <motion.div
                initial={{ opacity: 0, y: -4, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -4, scale: 0.97 }}
                transition={{ duration: 0.12 }}
                style={{ ...DROPDOWN_STYLE, top: pos.top, left: pos.left, minWidth: pos.width }}
              >
                <button
                  onClick={() => { onChange(null); setOpen(false); }}
                  className={`flex items-center gap-2.5 w-full px-3.5 py-2.5 text-xs font-medium transition-colors hover:bg-gray-50 ${!value ? 'text-gray-900' : 'text-gray-400'}`}
                >
                  <UserCircle2 size={14} className="text-gray-300 flex-shrink-0" />
                  <span className="flex-1 text-left">Non assigné</span>
                  {!value && <CheckCircle2 size={10} className="text-emerald-500" />}
                </button>

                {teamMembers.length > 0 && (
                  <div className="border-t border-gray-50 mt-1 pt-1">
                    {teamMembers.map(m => (
                      <button
                        key={m.id}
                        onClick={() => { onChange(m.id); setOpen(false); }}
                        className={`flex items-center gap-2.5 w-full px-3.5 py-2.5 text-xs font-medium transition-colors hover:bg-gray-50 ${m.id === value ? 'text-gray-900' : 'text-gray-500'}`}
                      >
                        <AssigneeAvatar member={m} size="sm" />
                        <span className="flex-1 text-left">{m.firstName} {m.lastName}</span>
                        <span className="text-[10px] text-gray-300">{m.role === 'cq_ia' ? 'CQ IA' : 'Manager'}</span>
                        {m.id === value && <CheckCircle2 size={10} className="ml-1 text-emerald-500 flex-shrink-0" />}
                      </button>
                    ))}
                  </div>
                )}

                {teamMembers.length === 0 && (
                  <p className="px-3.5 py-2 text-[11px] text-gray-400 italic">
                    Aucun membre disponible — ajoutez-en dans Équipe
                  </p>
                )}
              </motion.div>
            </>
          )}
        </AnimatePresence>,
        document.body
      )}
    </div>
  );
}

// ── Ligne article ─────────────────────────────────────────────────────────────
function PendingRow({ item, onDelete, onRunMaj, onAssign, onPriorityChange, onViewDiff, running, teamMembers }) {
  const [expanded, setExpanded] = useState(false);
  const assignee    = teamMembers.find(m => m.id === item.assigneeId) || null;
  const domain      = extractDomain(item.url);
  const initial     = domain[0]?.toUpperCase() || '?';
  const bgColor     = domainColor(domain);
  const pMeta       = PRIORITY_META[item.priority || 'normale'];
  const isAValider  = item.status === 'a_valider';
  const isEditable  = !isAValider && item.status !== 'in_progress';

  return (
    <>
      <motion.div
        layout
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0, x: -16 }}
        className={`
          flex items-center gap-4 px-5 py-3.5 border-b border-gray-50/80
          hover:bg-gray-50/40 transition-colors border-l-[3px] ${pMeta.border}
          ${running ? 'bg-blue-50/20' : ''}
        `}
      >
        {/* Domain avatar */}
        <div className={`w-9 h-9 rounded-xl ${bgColor} flex items-center justify-center text-white text-sm font-bold flex-shrink-0 shadow-sm`}>
          {initial}
        </div>

        {/* Title + domain + keyword */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900 truncate leading-snug" title={item.title}>
            {item.title || item.url}
          </p>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[11px] text-gray-400 truncate">{domain}</span>
            {item.keyword && (
              <>
                <span className="text-gray-200 select-none">·</span>
                <span className="inline-flex items-center gap-0.5 text-[10px] text-indigo-400 font-medium truncate">
                  <Sparkles size={8} className="flex-shrink-0" />
                  {item.keyword}
                </span>
              </>
            )}
          </div>
        </div>

        {/* Priority — picker si éditable, badge read-only sinon */}
        <div className="flex-shrink-0">
          {isEditable ? (
            <PriorityPicker
              value={item.priority || 'normale'}
              onChange={v => onPriorityChange(item.id, v)}
            />
          ) : (
            <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold border rounded-full px-2.5 py-1 whitespace-nowrap leading-none ${pMeta.badge}`}>
              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${pMeta.dot}`} />
              {pMeta.label}
            </span>
          )}
        </div>

        {/* Status badge */}
        <div className="flex-shrink-0">
          <StatusBadge status={item.status} />
        </div>

        {/* Actions + Assignee */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {/* Assignee picker si éditable, avatar read-only sinon */}
          {isEditable ? (
            <AssigneePicker
              value={item.assigneeId || ''}
              onChange={v => onAssign(item.id, v)}
              teamMembers={teamMembers}
            />
          ) : assignee ? (
            <div className="flex items-center gap-1.5">
              <AssigneeAvatar member={assignee} />
              <span className="text-[11px] text-gray-500 font-medium">{assignee.firstName}</span>
            </div>
          ) : null}

          {/* Bouton MAJ — seulement si pending */}
          {item.status === 'pending' && !running && (
            <button
              onClick={() => onRunMaj(item)}
              className="btn-primary text-xs px-3 py-1.5 flex items-center gap-1.5 whitespace-nowrap"
            >
              <Sparkles size={11} />
              MAJ
            </button>
          )}

          {/* En cours… */}
          {running && (
            <div className="flex items-center gap-1.5 text-xs text-blue-600 font-medium whitespace-nowrap">
              <Loader size={13} className="animate-spin flex-shrink-0" />
              En cours…
            </div>
          )}

          <button
            onClick={() => setExpanded(x => !x)}
            className="btn-ghost !p-1.5 text-gray-300 hover:text-gray-500"
          >
            {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>
          <button
            onClick={() => onDelete(item.id)}
            className="btn-ghost !p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50"
          >
            <Trash2 size={13} />
          </button>
        </div>
      </motion.div>

      {/* Barre de progression */}
      {running && (
        <div className="px-5 py-2 bg-blue-50/40 border-b border-blue-100/50">
          <div className="flex items-center justify-between mb-1">
            <p className="text-[11px] text-blue-600 font-medium truncate">{running.step}</p>
            <span className="text-[11px] text-blue-400 tabular-nums ml-2">{running.progress}%</span>
          </div>
          <div className="h-1 bg-blue-100 rounded-full overflow-hidden">
            <motion.div
              className="h-full rounded-full"
              style={{ background: 'linear-gradient(90deg, #60a5fa, #3b82f6)' }}
              animate={{ width: `${running.progress}%` }}
              transition={{ duration: 0.4 }}
            />
          </div>
        </div>
      )}

      {/* Panneau expand */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="px-5 py-4 bg-gray-50/50 border-b border-gray-100 space-y-4">

              {/* URL */}
              <a
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs text-blue-500 hover:text-blue-600 hover:underline break-all transition-colors"
              >
                <ExternalLink size={11} className="flex-shrink-0" />
                {item.url}
              </a>

              {/* Résultat MAJ — visible uniquement si à valider */}
              {isAValider && item.majResult && (
                <div className="space-y-3">
                  {/* Analyse IA */}
                  {item.majResult.analysis && (
                    <div className="bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-100 rounded-xl px-4 py-3">
                      <p className="text-[10px] font-semibold text-indigo-400 uppercase tracking-wide mb-2">Synthèse TONTON AI</p>
                      <div
                        className="md-content text-indigo-900 text-xs"
                        dangerouslySetInnerHTML={{ __html: renderMarkdown(item.majResult.analysis) }}
                      />
                    </div>
                  )}

                  {/* Résumé des modifications */}
                  {item.majResult.updates?.length > 0 && (
                    <div>
                      <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-2">
                        Modifications ({item.majResult.updates.filter(u => u.applied !== false).length} appliquées
                        {item.majResult.updates.filter(u => u.applied === false).length > 0 &&
                          ` · ${item.majResult.updates.filter(u => u.applied === false).length} non localisées`})
                      </p>
                      <div className="space-y-1.5 max-h-40 overflow-y-auto">
                        {item.majResult.updates.map((u, i) => (
                          <div key={i} className={`flex items-start gap-2 text-xs rounded-lg px-3 py-2 ${
                            u.applied === false
                              ? 'bg-amber-50 text-amber-700'
                              : 'bg-emerald-50 text-emerald-700'
                          }`}>
                            {u.applied === false
                              ? <AlertCircle size={11} className="flex-shrink-0 mt-0.5" />
                              : <CheckCircle2 size={11} className="flex-shrink-0 mt-0.5" />}
                            <span className="truncate">{u.reason || u.original || '—'}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Lien WP si publié */}
                  {item.wpPublished && item.wpLink && (
                    <a
                      href={item.wpLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs text-emerald-600 hover:text-emerald-700 hover:underline font-medium"
                    >
                      <Globe size={11} className="flex-shrink-0" />
                      Voir l'article publié sur WordPress
                    </a>
                  )}

                  {/* Rouvrir la page de review */}
                  <div className="pt-1 border-t border-gray-100">
                    <button
                      onClick={() => onViewDiff(item)}
                      className="text-xs px-4 py-2 flex items-center gap-2 rounded-xl font-medium border border-gray-200 text-gray-600 hover:bg-gray-50 transition-all"
                    >
                      <PencilLine size={13} />
                      Ouvrir la review
                    </button>
                  </div>
                </div>
              )}

              {/* Meta standard — visible si pas à valider */}
              {!isAValider && (
                <div className="flex items-start gap-8">
                  <div>
                    <p className="text-[10px] text-gray-400 uppercase tracking-widest font-semibold mb-1">Source</p>
                    <p className="text-xs text-gray-600">{item.source === 'manual' ? 'Manuel' : item.source === 'requeue' ? 'Remis en attente' : 'Import'}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-gray-400 uppercase tracking-widest font-semibold mb-1">Ajouté le</p>
                    <p className="text-xs text-gray-600">{item.addedAt ? new Date(item.addedAt).toLocaleDateString('fr-FR') : '—'}</p>
                  </div>
                  {item.notes && (
                    <div>
                      <p className="text-[10px] text-gray-400 uppercase tracking-widest font-semibold mb-1">Notes</p>
                      <p className="text-xs text-gray-600">{item.notes}</p>
                    </div>
                  )}
                </div>
              )}

            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

// ── Page principale ───────────────────────────────────────────────────────────

const FILTERS = ['Tous', 'En attente', 'En cours', 'À valider'];

export default function MajEnAttente() {
  const dispatch  = useDispatch();
  const navigate  = useNavigate();
  const items     = useSelector(s => s.pending.list);
  const settings  = useSelector(s => s.settings);
  const skills    = useSelector(s => s.skills.list);
  const knowledge = useSelector(s => s.knowledge.list);
  const wpSites   = useSelector(s => s.wordpress.sites);
  const allUsers = useSelector(s => s.users.list);

  // Membres assignables : CQ IA + Manager uniquement (pas super_admin, pas agents IA)
  // Membres assignables : rôle cq_ia ou manager, actif ou sans statut (rétrocompatibilité)
  const teamMembers = allUsers.filter(u =>
    ASSIGNABLE_ROLES.includes(u.role) && (u.status === 'active' || !u.status)
  );

  const [showUpload,    setShowUpload]    = useState(false);
  const [showAddManual, setShowAddManual] = useState(false);
  const [filter,        setFilter]        = useState('Tous');
  // Enrichissement automatique après import : { total, done, errors }
  const [enriching, setEnriching] = useState(null);
  // Suivi de l'item en cours de traitement : { step, progress } ou null
  const [runningId,  setRunningId]  = useState(null);
  const [runState,   setRunState]   = useState({ step: '', progress: 0 });

  // Purge les anciens items "done" au montage (migration : avant, ils restaient dans la liste)
  useEffect(() => { dispatch(clearDone()); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Exclure les items "done" — ils ne doivent plus apparaître ici (ils sont dans l'historique)
  const activeItems = items.filter(i => i.status !== 'done');

  const counts = {
    total:       activeItems.length,
    pending:     activeItems.filter(i => i.status === 'pending').length,
    in_progress: activeItems.filter(i => i.status === 'in_progress').length,
    a_valider:   activeItems.filter(i => i.status === 'a_valider').length,
  };

  const filtered = activeItems.filter(i => {
    if (filter === 'En attente') return i.status === 'pending';
    if (filter === 'En cours')   return i.status === 'in_progress';
    if (filter === 'À valider')  return i.status === 'a_valider';
    return true;
  });

  // Groupement par priorité (haute → normale → basse)
  const grouped = PRIORITY_ORDER
    .map(p => ({ priority: p, items: filtered.filter(i => (i.priority || 'normale') === p) }))
    .filter(g => g.items.length > 0);

  const handleParsed = async (newItems) => {
    dispatch(addPendingItems(newItems));
    setShowUpload(false);

    // Enrichissement automatique : scraper les URLs dont le titre est absent
    // (titre absent = non fourni dans le fichier → la valeur par défaut est l'URL elle-même)
    const toEnrich = newItems.filter(item => !item.title || item.title === item.url);
    if (toEnrich.length === 0) return;

    setEnriching({ total: toEnrich.length, done: 0, errors: 0 });

    // Traitement par batch de 3 pour ne pas saturer le proxy
    for (let i = 0; i < toEnrich.length; i += 3) {
      const batch = toEnrich.slice(i, i + 3);
      await Promise.all(batch.map(async (item) => {
        try {
          const result = await scrapeUrl(item.url);
          if (result.success && result.title) {
            dispatch(updatePendingItem({ id: item.id, title: result.title }));
          }
        } catch {
          // Échec silencieux — le titre reste l'URL
          setEnriching(prev => prev ? { ...prev, errors: prev.errors + 1 } : null);
        }
        setEnriching(prev => prev ? { ...prev, done: prev.done + 1 } : null);
      }));
    }

    setEnriching(prev => {
      const errors = prev?.errors || 0;
      if (errors > 0) {
        toast(`Enrichissement terminé (${errors} URL${errors > 1 ? 's' : ''} inaccessible${errors > 1 ? 's' : ''})`, { icon: '⚠️' });
      } else {
        toast.success('Titres récupérés automatiquement !');
      }
      return null;
    });
  };

  const handleRunMaj = async (item) => {
    if (!settings.anthropicKey) {
      toast.error('Clé API Anthropic manquante — vérifiez les Paramètres');
      return;
    }
    if (runningId) {
      toast('Une mise à jour est déjà en cours', { icon: 'ℹ️' });
      return;
    }

    setRunningId(item.id);
    const step = (s) => setRunState(prev => ({ ...prev, step: s }));
    const progress = (p) => setRunState(prev => ({ ...prev, progress: p }));

    dispatch(resetAgent());
    dispatch(setStatus('running'));

    try {
      // ── Étape 1 : Récupération article (MCP WP prioritaire, sinon scraping) ─
      progress(5);
      let articleHtml = '', articleContent = '';
      let wpFetched = false;

      if (item.url) {
        try {
          const articleHostname = new URL(item.url).hostname.replace(/^www\./, '');
          const matchingSite = wpSites.find(site => {
            try { return new URL(site.url).hostname.replace(/^www\./, '') === articleHostname; }
            catch { return false; }
          });
          if (matchingSite) {
            step('Connexion WordPress MCP — lecture de l\'article...');
            const resp = await axios.post('/api/wp-tool', {
              toolName: 'wp_get_post',
              toolInput: { site_id: matchingSite.id, post_url: item.url },
              wpSites: [matchingSite],
            }, { timeout: 25000 });
            if (resp.data.success && resp.data.result?.content) {
              const r = resp.data.result;
              articleHtml    = r.content;
              articleContent = r.content;
              // Stocker immédiatement les données WP (image à la une incluse)
              dispatch(setWpData({
                siteId:          matchingSite.id,
                siteName:        matchingSite.name,
                postId:          r.post_id,
                postType:        r.post_type || 'posts',
                featuredMediaId: r.featured_media_id  || null,
                featuredMediaUrl:r.featured_media_url || null,
                postLink:        r.link || null,
              }));
              step(`WordPress MCP ✓ — article lu directement (ID ${r.post_id})`);
              wpFetched = true;
            }
          }
        } catch { /* non-fatal */ }
      }

      if (!wpFetched) {
        step('Récupération de l\'article…');
        const scrapeResult = await scrapeUrl(item.url);
        if (!scrapeResult.success) {
          toast.error(scrapeResult.error || 'Impossible de récupérer l\'article');
          dispatch(setError(scrapeResult.error));
          setRunningId(null);
          return;
        }
        articleHtml    = scrapeResult.content;
        articleContent = scrapeResult.textContent || scrapeResult.content;
      }
      dispatch(setOriginalContent(articleHtml));

      // ── Étape 2 : Agent IA ────────────────────────────────────────────────
      const result = await runAgent({
        content:    articleContent,
        skills,
        knowledge,
        anthropicKey: settings.anthropicKey,
        braveKey:     settings.braveKey,
        tavilyKey:    settings.tavilyKey,
        articleUrl:   item.url || '',
        wpSites,
        onStep:     (s) => { dispatch(addStep(s)); step(s); },
        onProgress: (p) => { dispatch(setProgress(p)); progress(p); },
      });
      if (result.wpData) dispatch(setWpData(result.wpData));

      // ── Étape 3 : Application des diffs ───────────────────────────────────
      const { html: rawHtml, updates: allUpdatesWithStatus } = applyAllDiffs(articleHtml, result.updates, 1);
      const hasBlockStructure = /<(p|h[1-6]|table|ul|ol)\b[^>]*>/i.test(rawHtml);
      const updatedHtml = hasBlockStructure ? rawHtml : rawHtml.replace(/\n/g, '<br>');

      dispatch(setUpdatedContent(updatedHtml));
      dispatch(setDiff(allUpdatesWithStatus));
      dispatch(setSources(result.sources || []));
      dispatch(setAnalysis(result.analysis || ''));
      dispatch(setParseFailed(result.parseFailed === true));
      dispatch(setStatus('done'));

      // ── Étape 4 : Stats tokens ────────────────────────────────────────────
      const articleTitle = item.title && item.title !== item.url ? item.title : item.url;

      if (result.tokenUsage) {
        dispatch(setTokenUsage(result.tokenUsage));
        dispatch(addArticleStat({
          id:           item.id,
          title:        articleTitle,
          inputTokens:  result.tokenUsage.input,
          outputTokens: result.tokenUsage.output,
          costUsd:      result.tokenUsage.costUsd,
          createdAt:    new Date().toISOString(),
          pass: 1,
        }));
      }

      // ── Étape 5 : Passer en statut "À valider" + naviguer vers la page de review ──
      dispatch(updatePendingItem({
        id:     item.id,
        status: 'a_valider',
        majResult: {
          articleTitle,
          originalContent: articleHtml,
          updatedContent:  updatedHtml,
          updates:         allUpdatesWithStatus,
          sources:         result.sources || [],
          analysis:        result.analysis || '',
        },
      }));

      // currentArticleId = item.id → la page Articles sait qu'on est en mode validation CQ
      dispatch(setCurrentArticleId(item.id));

      const applied = allUpdatesWithStatus.filter(u => u.applied).length;
      const total   = allUpdatesWithStatus.length;
      toast.success(`MAJ prête — ${applied}/${total} modif. appliquées`, { icon: '🔍' });

      // Naviguer vers la page Articles pour review + validation
      navigate('/');

    } catch (e) {
      console.error('[maj]', e);
      toast.error('Erreur : ' + e.message);
      dispatch(setError(e.message));
    }

    setRunningId(null);
    setRunState({ step: '', progress: 0 });
  };

  const handleDelete         = (id) => dispatch(removePendingItem(id));
  const handleAssign         = (id, assigneeId) => dispatch(updatePendingItem({ id, assigneeId }));
  const handlePriorityChange = (id, priority) => dispatch(updatePendingItem({ id, priority }));

  // Rouvrir la page Articles avec le résultat d'un item déjà traité
  const handleViewDiff = (item) => {
    const r = item.majResult || {};
    dispatch(setOriginalContent(r.originalContent || ''));
    dispatch(setUpdatedContent(r.updatedContent   || ''));
    dispatch(setDiff(r.updates   || []));
    dispatch(setSources(r.sources || []));
    dispatch(setAnalysis(r.analysis || ''));
    dispatch(setCurrentArticleId(item.id)); // marque cet item comme "en cours de review"
    dispatch(setStatus('done'));
    navigate('/');
  };


  return (
    <div className="space-y-6 animate-fade-in">

      {/* ── Header ── */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Clock size={22} className="text-gray-700" />
            MAJ en attente
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Liste d'articles à mettre à jour · import Google Sheets / XLSX
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => { setShowAddManual(x => !x); setShowUpload(false); }}
            className="btn-ghost flex items-center gap-2 text-sm"
          >
            <Plus size={14} />
            Ajouter
          </button>
          <button
            onClick={() => { setShowUpload(x => !x); setShowAddManual(false); }}
            className="btn-primary flex items-center gap-2 text-sm"
          >
            <Upload size={14} />
            Importer un fichier
          </button>
        </div>
      </div>

      {/* ── Compteurs ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total',      value: counts.total,       color: 'text-gray-700',   bg: 'bg-gray-50'    },
          { label: 'En attente', value: counts.pending,     color: 'text-amber-700',  bg: 'bg-amber-50'   },
          { label: 'En cours',   value: counts.in_progress, color: 'text-blue-700',   bg: 'bg-blue-50'    },
          { label: 'À valider',  value: counts.a_valider,   color: 'text-purple-700', bg: 'bg-purple-50'  },
        ].map(c => (
          <div key={c.label} className={`glass-card px-4 py-3 ${c.bg}`}>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">{c.label}</p>
            <p className={`text-2xl font-bold ${c.color} leading-none mt-1`}>{c.value}</p>
          </div>
        ))}
      </div>

      {/* ── Barre d'enrichissement automatique ── */}
      <AnimatePresence>
        {enriching && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            className="glass-card px-5 py-3 flex items-center gap-4"
          >
            <Loader size={15} className="animate-spin text-blue-500 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-xs font-medium text-gray-700">
                  Récupération des titres manquants…
                </p>
                <span className="text-xs text-gray-400 tabular-nums">
                  {enriching.done} / {enriching.total}
                </span>
              </div>
              <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                <motion.div
                  className="h-full bg-blue-400 rounded-full"
                  animate={{ width: `${Math.round((enriching.done / enriching.total) * 100)}%` }}
                  transition={{ duration: 0.3 }}
                />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Zone upload (toggle) ── */}
      <AnimatePresence>
        {showUpload && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
          >
            <UploadZone onParsed={handleParsed} />

            {/* Template Google Sheets */}
            <div className="mt-3 glass-card p-4 flex items-start gap-3">
              <FileSpreadsheet size={16} className="text-gray-400 mt-0.5 flex-shrink-0" />
              <div className="text-xs text-gray-500">
                <p className="font-medium text-gray-700 mb-1">Format attendu</p>
                <p>Colonnes reconnues automatiquement (ordre libre) :</p>
                <p className="font-mono bg-gray-100 rounded px-2 py-1 mt-1 text-[11px]">
                  URL · Titre · Mot-clé · Priorité (haute/normale/basse) · Notes
                </p>
                <p className="mt-1 text-gray-400">Les doublons d'URL sont ignorés automatiquement.</p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Formulaire ajout manuel (toggle) ── */}
      <AnimatePresence>
        {showAddManual && (
          <AddManualForm
            onAdd={(item) => dispatch(addPendingItem(item))}
            onClose={() => setShowAddManual(false)}
            teamMembers={teamMembers}
          />
        )}
      </AnimatePresence>

      {/* ── Filtres + actions bulk ── */}
      {activeItems.length > 0 && (
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-1">
            <Filter size={13} className="text-gray-400 mr-1" />
            {FILTERS.map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1 rounded-lg text-xs font-medium transition-all ${
                  filter === f
                    ? 'bg-gray-900 text-white'
                    : 'text-gray-500 hover:bg-gray-100'
                }`}
              >
                {f}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            {activeItems.length > 0 && (
              <button
                onClick={() => {
                  if (window.confirm('Vider toute la liste ?')) dispatch(clearAll());
                }}
                className="btn-ghost text-xs text-red-400 hover:text-red-600 hover:bg-red-50 flex items-center gap-1"
              >
                <Trash2 size={12} />
                Tout supprimer
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Liste ── */}
      {activeItems.length === 0 ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="glass-card p-12 text-center"
        >
          <Clock size={36} className="mx-auto mb-4 text-gray-200" />
          <p className="text-sm font-semibold text-gray-400">Aucun article en attente</p>
          <p className="text-xs text-gray-400 mt-1 max-w-sm mx-auto">
            Importez un fichier Google Sheets / XLSX ou ajoutez des articles manuellement.
          </p>
          <div className="flex justify-center gap-3 mt-6">
            <button
              onClick={() => setShowAddManual(true)}
              className="btn-ghost text-sm flex items-center gap-2"
            >
              <Plus size={14} />
              Ajouter manuellement
            </button>
            <button
              onClick={() => setShowUpload(true)}
              className="btn-primary text-sm flex items-center gap-2"
            >
              <Upload size={14} />
              Importer un fichier
            </button>
          </div>
        </motion.div>
      ) : filtered.length === 0 ? (
        <div className="glass-card p-8 text-center text-gray-400 text-sm">
          Aucun article pour ce filtre.
        </div>
      ) : (
        <div className="glass-card overflow-hidden rounded-2xl">
          {grouped.map(group => (
            <div key={group.priority}>
              <PrioritySectionRow priority={group.priority} count={group.items.length} />
              <AnimatePresence mode="popLayout">
                {group.items.map(item => (
                  <PendingRow
                    key={item.id}
                    item={item}
                    onDelete={handleDelete}
                    onRunMaj={handleRunMaj}
                    onAssign={handleAssign}
                    onPriorityChange={handlePriorityChange}
                    onViewDiff={handleViewDiff}
                    running={runningId === item.id ? runState : null}
                    teamMembers={teamMembers}
                  />
                ))}
              </AnimatePresence>
            </div>
          ))}
        </div>
      )}

      {/* ── Note future ── */}
      {activeItems.length > 0 && (
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-[11px] text-gray-400 text-center flex items-center justify-center gap-2"
        >
          <Link2 size={11} />
          Prochainement : synchronisation automatique via SEMrush &amp; Google Search Console
        </motion.p>
      )}
    </div>
  );
}
