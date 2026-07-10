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
  Globe, PencilLine, ListChecks, PlayCircle, ShieldCheck, Tag,
  ClipboardList, AlertTriangle, Search, Lightbulb,
} from 'lucide-react';
import {
  addPendingItems, addPendingItem, removePendingItem,
  updatePendingItem, clearDone, clearAll,
} from '../store/slices/pendingSlice';
import {
  resetAgent, setStatus, addStep, setProgress,
  setOriginalContent, setUpdatedContent, setDiff,
  setSources, setAnalysis, setError, setCurrentArticleId, setTokenUsage, setParseFailed,
  setWpData, setAudit,
} from '../store/slices/agentSlice';
import { addArticleStat } from '../store/slices/statsSlice';
import { addToHistory } from '../store/slices/articlesSlice';
import { cacheSiteFonts } from '../store/slices/wordpressSlice';
import axios from 'axios';
import { scrapeUrl } from '../services/scraper';
import { runAgent } from '../services/agent';
import { saveArticle, initArticleSeoTracking, saveSeoSnapshot, saveSiteFonts, createNotification, fetchArticleHtml } from '../services/firebase';
import store from '../store';
import ConfirmDialog from '../components/common/ConfirmDialog';
import Pagination, { pageSlice } from '../components/common/Pagination';
import { applyAllDiffs, moveFaqToEnd } from '../utils/diff';
import { normalizeFaqToAccordion } from '../utils/faq';
import { makeTablesResponsive } from '../utils/blocks';
import { renderMarkdown } from '../utils/markdown';
import { ROLE_COLORS, PRIORITY_META, domainColor } from '../constants/theme';
import { detectAgent } from '../constants/agents';

// ── Helpers ──────────────────────────────────────────────────────────────────

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const STATUS_META = {
  pending:     { label: 'En attente',  color: 'text-amber-600  bg-amber-50  border-amber-200'  },
  in_progress: { label: 'En cours',    color: 'text-blue-600   bg-blue-50   border-blue-200'   },
  a_valider:   { label: 'À valider',   color: 'text-purple-600 bg-purple-50 border-purple-200' },
  error:       { label: 'Erreur',      color: 'text-red-600    bg-red-50    border-red-200'    },
};

const PRIORITY_ORDER = ['haute', 'normale', 'basse'];

const CONCURRENCY = 3;        // Nombre max de MAJ simultanées
const SLOT_STAGGER_MS = 4000; // Décalage entre le démarrage de chaque slot

// ── File d'exécution des analyses (niveau module) ────────────────────────────
// Au-delà de CONCURRENCY analyses actives, les lancements sont mis EN FILE et
// démarrent automatiquement dès qu'un créneau se libère (plus de refus).
// Niveau module : la file et les analyses survivent aux NAVIGATIONS dans
// l'app ; un vrai rechargement (F5) remet tout à zéro — les items concernés
// sont alors réparés au montage (voir « zombies » plus bas).
const liveRuns    = new Set(); // ids des analyses actives dans CET onglet
const launchQueue = [];        // ids en attente d'un créneau (FIFO)
const STALE_RUN_MS = 30 * 60 * 1000; // « En cours » d'un autre poste considéré mort après 30 min sans fin

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
        toast.success(`${items.length} article(s) importé(s)`, { icon: <ClipboardList size={18} /> });
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

// ── Panel slide depuis la droite — Ajouter manuellement ─────────────────────

function AddManualPanel({ open, onAdd, onClose, teamMembers }) {
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [keyword, setKeyword] = useState('');
  const [priority, setPriority] = useState('normale');
  const [notes, setNotes] = useState('');
  const [assigneeId, setAssigneeId] = useState('');

  // Reset on open
  useEffect(() => {
    if (open) { setUrl(''); setTitle(''); setKeyword(''); setPriority('normale'); setNotes(''); setAssigneeId(''); }
  }, [open]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!url.trim() || !url.startsWith('http')) { toast.error('URL invalide'); return; }
    onAdd({
      id: uid(), url: url.trim(), title: title.trim() || url.trim(),
      keyword: keyword.trim(), priority, notes: notes.trim(),
      assigneeId: assigneeId || null, status: 'pending', source: 'manual',
      addedAt: Date.now(), updatedAt: Date.now(),
    });
    toast.success('Article ajouté à la liste');
    onClose();
  };

  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            key="add-backdrop"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/20 backdrop-blur-[2px] z-[200]"
            onClick={onClose}
          />
          {/* Panel */}
          <motion.div
            key="add-panel"
            initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
            transition={{ type: 'spring', stiffness: 340, damping: 34 }}
            className="fixed right-0 top-0 h-full w-full max-w-md bg-white shadow-2xl z-[201] flex flex-col"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl bg-gray-900 flex items-center justify-center">
                  <Plus size={14} className="text-white" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-gray-900">Ajouter un article</h3>
                  <p className="text-[11px] text-gray-400 mt-0.5">Ajout manuel à la file</p>
                </div>
              </div>
              <button onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-gray-100 flex items-center justify-center text-gray-400 hover:text-gray-700 transition-colors">
                <X size={15} />
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
              {/* URL */}
              <div>
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5 block">URL *</label>
                <input
                  type="url" value={url} onChange={e => setUrl(e.target.value)}
                  placeholder="https://monsite.com/article"
                  className="input-field w-full text-sm" required autoFocus
                />
              </div>

              {/* Titre */}
              <div>
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5 block">Titre</label>
                <input
                  type="text" value={title} onChange={e => setTitle(e.target.value)}
                  placeholder="Titre de l'article (facultatif)"
                  className="input-field w-full text-sm"
                />
                <p className="text-[11px] text-gray-400 mt-1">Récupéré automatiquement si vide</p>
              </div>

              {/* Mot-clé */}
              <div>
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5 block">
                  <span className="flex items-center gap-1.5"><Tag size={10} /> Mot-clé cible</span>
                </label>
                <input
                  type="text" value={keyword} onChange={e => setKeyword(e.target.value)}
                  placeholder="ex : référencement naturel"
                  className="input-field w-full text-sm"
                />
              </div>

              {/* Priorité */}
              <div>
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5 block">Priorité</label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { val: 'haute',   label: 'Haute',   dot: 'bg-red-400',    ring: 'ring-red-200',   active: 'bg-red-50 border-red-300 text-red-700' },
                    { val: 'normale', label: 'Normale', dot: 'bg-amber-400',  ring: 'ring-amber-200', active: 'bg-amber-50 border-amber-300 text-amber-700' },
                    { val: 'basse',   label: 'Basse',   dot: 'bg-emerald-400',ring: 'ring-emerald-200',active: 'bg-emerald-50 border-emerald-300 text-emerald-700' },
                  ].map(p => (
                    <button
                      key={p.val} type="button"
                      onClick={() => setPriority(p.val)}
                      className={`flex items-center justify-center gap-2 py-2.5 rounded-xl border text-xs font-semibold transition-all ${
                        priority === p.val ? p.active + ' ring-2 ' + p.ring : 'border-gray-200 text-gray-500 hover:border-gray-300 bg-white'
                      }`}
                    >
                      <span className={`w-2 h-2 rounded-full ${p.dot}`} />
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Assigner à */}
              <div>
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5 block">Assigner à</label>
                <select value={assigneeId} onChange={e => setAssigneeId(e.target.value)} className="input-field w-full text-sm">
                  <option value="">— Non assigné —</option>
                  {teamMembers.map(m => (
                    <option key={m.id} value={m.id}>
                      {m.firstName} {m.lastName} ({m.role === 'cq_ia' ? 'CQ IA' : 'Manager'})
                    </option>
                  ))}
                </select>
              </div>

              {/* Notes */}
              <div>
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5 block">Notes</label>
                <textarea
                  value={notes} onChange={e => setNotes(e.target.value)}
                  placeholder="Remarques, contexte, instructions…"
                  rows={3}
                  className="input-field w-full text-sm resize-none"
                />
              </div>
            </form>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-gray-100 flex gap-3">
              <button type="button" onClick={onClose} className="flex-1 btn-ghost text-sm">
                Annuler
              </button>
              <button
                onClick={handleSubmit}
                className="flex-1 btn-primary text-sm flex items-center justify-center gap-2"
              >
                <Plus size={13} />
                Ajouter
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body
  );
}

// ── Panel slide depuis la droite — Import fichier ─────────────────────────────

function ImportPanel({ open, onClose, onParsed }) {
  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="import-backdrop"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/20 backdrop-blur-[2px] z-[200]"
            onClick={onClose}
          />
          <motion.div
            key="import-panel"
            initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
            transition={{ type: 'spring', stiffness: 340, damping: 34 }}
            className="fixed right-0 top-0 h-full w-full max-w-md bg-white shadow-2xl z-[201] flex flex-col"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl bg-indigo-600 flex items-center justify-center">
                  <Upload size={14} className="text-white" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-gray-900">Importer un fichier</h3>
                  <p className="text-[11px] text-gray-400 mt-0.5">Google Sheets · Excel · CSV</p>
                </div>
              </div>
              <button onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-gray-100 flex items-center justify-center text-gray-400 hover:text-gray-700 transition-colors">
                <X size={15} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
              <UploadZone onParsed={(items) => { onParsed(items); onClose(); }} />

              {/* Infos format */}
              <div className="rounded-2xl bg-gray-50 border border-gray-100 p-4 space-y-3">
                <p className="text-xs font-semibold text-gray-700 flex items-center gap-2">
                  <FileSpreadsheet size={13} className="text-gray-400" />
                  Format attendu
                </p>
                <p className="text-xs text-gray-500">Colonnes reconnues automatiquement (ordre libre) :</p>
                <div className="flex flex-wrap gap-2">
                  {['URL *', 'Titre', 'Mot-clé', 'Priorité', 'Notes'].map(col => (
                    <span key={col} className={`inline-flex items-center px-2.5 py-1 rounded-lg text-[11px] font-medium ${col.includes('*') ? 'bg-indigo-50 text-indigo-600 border border-indigo-100' : 'bg-white text-gray-500 border border-gray-200'}`}>
                      {col}
                    </span>
                  ))}
                </div>
                <p className="text-[11px] text-gray-400">Les doublons d'URL sont ignorés automatiquement.</p>
              </div>

              {/* Liens utiles */}
              <div className="rounded-2xl bg-blue-50 border border-blue-100 p-4">
                <p className="text-xs font-semibold text-blue-700 mb-2"><Lightbulb size={14} className="inline text-blue-600 shrink-0" /> Astuce Google Sheets</p>
                <p className="text-xs text-blue-600">Exportez votre feuille via <strong>Fichier → Télécharger → .xlsx</strong> puis importez-le ici.</p>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body
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
function PendingRow({ item, onDelete, onRunMaj, onAssign, onPriorityChange, onViewDiff, running, queuedPos = null, onDequeue, isMine = false, teamMembers }) {
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

        {/* Status badge (+ « À vous » : à valider assigné à moi) */}
        <div className="flex-shrink-0 flex items-center gap-1.5">
          <StatusBadge status={item.status} />
          {isAValider && isMine && (
            <span className="inline-flex items-center text-[10px] font-bold uppercase tracking-wide bg-indigo-500 text-white rounded-full px-2 py-0.5 leading-none whitespace-nowrap">
              À vous
            </span>
          )}
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

          {/* Bouton MAJ (pending) / Relancer (après une erreur) */}
          {(item.status === 'pending' || item.status === 'error') && !running && !queuedPos && (
            <button
              onClick={() => onRunMaj(item)}
              className={`text-xs px-3 py-1.5 flex items-center gap-1.5 whitespace-nowrap ${item.status === 'error' ? 'btn-secondary !text-red-600 !border-red-200 hover:!bg-red-50' : 'btn-primary'}`}
            >
              {item.status === 'error' ? <RefreshCw size={11} /> : <Sparkles size={11} />}
              {item.status === 'error' ? 'Relancer' : 'MAJ'}
            </button>
          )}

          {/* En file de lancement — démarrera automatiquement dès qu'un créneau se libère */}
          {queuedPos && !running && (
            <div className="flex items-center gap-1 whitespace-nowrap">
              <span
                className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-indigo-600 bg-indigo-50 border border-indigo-200 rounded-full px-2.5 py-1 leading-none"
                title="Démarrera automatiquement dès qu'une analyse en cours se termine"
              >
                <Clock size={9} className="flex-shrink-0" />
                En file — n°{queuedPos}
              </span>
              <button
                onClick={() => onDequeue?.(item.id)}
                className="btn-ghost !p-1 text-gray-300 hover:text-red-500"
                title="Retirer de la file de lancement"
              >
                <X size={12} />
              </button>
            </div>
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
      {running && (() => {
        const agent = detectAgent(running.step);
        return (
          <div className="px-5 py-2 bg-blue-50/40 border-b border-blue-100/50">
            {/* Badge agent */}
            <div className="flex items-center gap-1 mb-1">
              <agent.Icon size={12} className="shrink-0" />
              <span className="text-[10px] font-semibold text-gray-500">{agent.name}</span>
              <span className="text-[10px] text-gray-300">·</span>
              <span className="text-[10px] text-gray-400 italic">{agent.pseudo}</span>
            </div>
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
        );
      })()}

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

              {/* Cause de l'échec (run en erreur) */}
              {item.status === 'error' && item.errorMsg && (
                <div className="flex items-start gap-2 text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                  <AlertCircle size={13} className="flex-shrink-0 mt-0.5" />
                  <span className="break-words"><span className="font-semibold">Échec : </span>{item.errorMsg}</span>
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
  const items        = useSelector(s => s.pending.list);
  const settings     = useSelector(s => s.settings);
  const skills       = useSelector(s => s.skills.list);
  const knowledge    = useSelector(s => s.knowledge.list);
  const wpSites      = useSelector(s => s.wordpress.sites);
  const allUsers     = useSelector(s => s.users.list);
  const firebaseReady = useSelector(s => s.settings.firebaseReady);
  const authRole     = useSelector(s => s.auth.role);
  const authUid      = useSelector(s => s.auth.uid);
  const authUsername = useSelector(s => s.auth.username);

  // Membres assignables : CQ IA + Manager uniquement (pas super_admin, pas agents IA)
  // Membres assignables : rôle cq_ia ou manager, actif ou sans statut (rétrocompatibilité)
  const teamMembers = allUsers.filter(u =>
    ASSIGNABLE_ROLES.includes(u.role) && (u.status === 'active' || !u.status)
  );

  const [showImport,    setShowImport]    = useState(false);
  const [showAddManual, setShowAddManual] = useState(false);
  const [filter,        setFilter]        = useState('Tous');
  const [page,          setPage]          = useState(1);
  useEffect(() => { setPage(1); }, [filter]); // nouveau filtre → retour page 1
  // Enrichissement automatique après import : { total, done, errors }
  const [enriching, setEnriching] = useState(null);
  // Suivi des items en cours : Map<id, { step, progress }>
  const [runStates,   setRunStates]   = useState(new Map());
  // Ref pour accès synchrone à la liste d'items dans les closures async
  const itemsRef = useRef(items);
  useEffect(() => { itemsRef.current = items; }, [items]);

  // Met à jour (ou supprime si null) l'état de progression d'un item
  const updateRunState = useCallback((id, update) => {
    setRunStates(prev => {
      const next = new Map(prev);
      if (update === null) { next.delete(id); }
      else { next.set(id, { ...(prev.get(id) || { step: '', progress: 0 }), ...update }); }
      return next;
    });
  }, []);

  // Miroir React de la file de lancement (module) → affichage des positions
  const [queuedIds, setQueuedIds] = useState([...launchQueue]);
  const syncQueueUi = useCallback(() => setQueuedIds([...launchQueue]), []);
  const dequeueItem = useCallback((id) => {
    const idx = launchQueue.indexOf(id);
    if (idx !== -1) launchQueue.splice(idx, 1);
    syncQueueUi();
  }, [syncQueueUi]);

  // Purge les anciens items "done" au montage (migration : avant, ils restaient dans la liste)
  useEffect(() => { dispatch(clearDone()); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Réparation des « En cours » zombies ─────────────────────────────────────
  // Une analyse tuée (rechargement F5, crash d'onglet) laissait l'item bloqué
  // in_progress sans bouton ni progression → compteur « En cours » faussé.
  // Au montage : tout item in_progress qui ne tourne PAS dans cet onglet et qui
  // a été démarré par MOI (ou qui est trop vieux / sans horodatage) est remis
  // « En attente ». L'analyse VIVANTE d'un collègue (startedBy ≠ moi, récente)
  // n'est jamais touchée.
  useEffect(() => {
    const me = authUid || authUsername || null;
    const zombies = itemsRef.current.filter(i =>
      i.status === 'in_progress'
      && !liveRuns.has(i.id)
      && (i.startedBy === me || !i.startedAt || Date.now() - i.startedAt > STALE_RUN_MS));
    if (!zombies.length) return;
    zombies.forEach(i => dispatch(updatePendingItem({
      id: i.id, status: 'pending', startedBy: null, startedAt: null,
    })));
    toast(
      `${zombies.length} analyse${zombies.length > 1 ? 's' : ''} interrompue${zombies.length > 1 ? 's' : ''} remise${zombies.length > 1 ? 's' : ''} « En attente »`,
      { icon: '🔁' },
    );
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Exclure les items "done" — ils ne doivent plus apparaître ici (ils sont dans l'historique)
  // Visibilité : LISTE BLANCHE — seuls super_admin / manager / support voient
  // toute la file. Tout autre rôle (cq_ia, ou rôle pas encore hydraté au
  // chargement) ne voit QUE ses propres analyses assignées (uid ou username).
  const canSeeAllItems = ['super_admin', 'manager', 'support'].includes(authRole);
  const activeItems = items
    .filter(i => i.status !== 'done')
    .filter(i => canSeeAllItems
      || i.assigneeId === authUid || i.assigneeId === authUsername);

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

  // « À valider » : MES articles d'abord (badge « À vous ») — chacun voit son
  // travail à valider en tête de chaque groupe de priorité
  const isMine = (i) => !!i.assigneeId && (i.assigneeId === authUid || i.assigneeId === authUsername);
  const sorted = [...filtered].sort((a, b) =>
    ((a.status === 'a_valider' && isMine(a)) ? 0 : 1)
    - ((b.status === 'a_valider' && isMine(b)) ? 0 : 1));

  // Pagination (50 max par page) — la page courante est ensuite regroupée par
  // priorité ; retour page 1 à chaque changement de filtre de statut.
  const pageItems = pageSlice(sorted, page);

  // Groupement par priorité (haute → normale → basse)
  const grouped = PRIORITY_ORDER
    .map(p => ({ priority: p, items: pageItems.filter(i => (i.priority || 'normale') === p) }))
    .filter(g => g.items.length > 0);

  // Un cq_ia ne voit que SES articles assignés (filtre activeItems ci-dessus). On
  // auto-assigne donc au créateur ses ajouts/imports laissés « Non assigné », sinon
  // l'item est bien ajouté mais invisible pour lui (bug : toast « ajouté » puis liste vide).
  // Manager / super_admin : inchangé (ils voient tout, l'item reste dans le pool partagé).
  const withSelfAssign = (item) => ({
    ...item,
    assigneeId: item.assigneeId || (authRole === 'cq_ia' ? (authUid || authUsername) : null),
  });

  const handleParsed = async (newItems) => {
    dispatch(addPendingItems(newItems.map(withSelfAssign)));
    setShowImport(false);

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
        toast(`Enrichissement terminé (${errors} URL${errors > 1 ? 's' : ''} inaccessible${errors > 1 ? 's' : ''})`, { icon: <AlertTriangle size={18} className="text-amber-500" /> });
      } else {
        toast.success('Titres récupérés automatiquement !');
      }
      return null;
    });
  };

  // ── Traitement core d'un article (sans navigation, sans reset global) ────────
  const processItem = async (item) => {
    const step     = (s) => updateRunState(item.id, { step: s });
    const progress = (p) => updateRunState(item.id, { progress: p });

    // startedBy/startedAt : signature du lanceur — permet de réparer les
    // « En cours » zombies après un crash sans toucher aux analyses des collègues
    dispatch(updatePendingItem({
      id: item.id, status: 'in_progress',
      startedBy: authUid || authUsername || null, startedAt: Date.now(),
    }));
    updateRunState(item.id, { step: '', progress: 0 });

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
              step(`WordPress MCP OK — article lu directement (ID ${r.post_id})`);
              wpFetched = true;
              // Données WP pour le single-item flow (retournées dans result)
              item._wpData = {
                siteId:          matchingSite.id,
                siteName:        matchingSite.name,
                postId:          r.post_id,
                postType:        r.post_type || 'posts',
                featuredMediaId: r.featured_media_id  || null,
                featuredMediaUrl:r.featured_media_url || null,
                postLink:        r.link || null,
                wpTitle:         r.title || '',
                siteFonts:       r.site_fonts || [],  // polices déclarées sur le site (sélecteur de police)
              };
              // Cache des polices du site → réutilisées à la réouverture depuis l'historique (sans requête)
              const detectedFonts = r.site_fonts || [];
              dispatch(cacheSiteFonts({ siteId: matchingSite.id, fonts: detectedFonts }));
              // Persistance Firestore (survit au vidage du cache) — uniquement si changé
              if (detectedFonts.length && JSON.stringify(detectedFonts) !== JSON.stringify(matchingSite.fonts || [])) {
                saveSiteFonts(matchingSite.id, detectedFonts).catch(() => {});
              }
            }
          }
        } catch { /* non-fatal */ }
      }

      if (!wpFetched) {
        step('Récupération de l\'article…');
        const scrapeResult = await scrapeUrl(item.url);
        if (!scrapeResult.success) {
          throw new Error(scrapeResult.error || 'Impossible de récupérer l\'article');
        }
        articleHtml    = scrapeResult.content;
        articleContent = scrapeResult.textContent || scrapeResult.content;
      }

      // ── Étape 2 : Agent IA ────────────────────────────────────────────────
      const result = await runAgent({
        content:      articleContent,
        contentHtml:  articleHtml,   // HTML (avec liens) pour l'analyse du maillage
        skills,
        knowledge,
        articleUrl:   item.url || '',
        wpSites,
        modelPricing: settings.modelPricing || null,
        onStep:     (s) => { dispatch(addStep(s)); step(s); },
        onProgress: (p) => { dispatch(setProgress(p)); progress(p); },
      });

      // ── Étape 3 : Application des diffs ───────────────────────────────────
      const { html: rawHtml, updates: allUpdatesWithStatus } = applyAllDiffs(articleHtml, result.updates, 1, item.url || '');
      const hasBlockStructure = /<(p|h[1-6]|table|ul|ol)\b[^>]*>/i.test(rawHtml);
      // FAQ : fin d'article + normalisation en accordéon (structure unique pour toutes les FAQ)
      // Tableaux : enveloppés dans un conteneur responsive (défilement horizontal sur mobile)
      const updatedHtml = makeTablesResponsive(normalizeFaqToAccordion(moveFaqToEnd(hasBlockStructure ? rawHtml : rawHtml.replace(/\n/g, '<br>'))));

      // ── Étape 4 : Stats tokens ────────────────────────────────────────────
      const extractH1 = (html) => {
        try {
          const tmp = document.createElement('div');
          tmp.innerHTML = html;
          return tmp.querySelector('h1')?.textContent?.trim() || '';
        } catch { return ''; }
      };
      const articleTitle = extractH1(articleHtml) || (item.title && item.title !== item.url ? item.title : item.url);

      if (result.tokenUsage) {
        dispatch(setTokenUsage(result.tokenUsage));
        dispatch(addArticleStat({
          id:           item.id,
          title:        articleTitle,
          inputTokens:  result.tokenUsage.input,
          outputTokens: result.tokenUsage.output,
          costUsd:      result.tokenUsage.costUsd,
          createdAt:    new Date().toISOString(),
          assigneeId:   item.assigneeId || null,
          pass: 1,
        }));
      }

      // ── Étape 5 : Suivi SEO Haloscan — snapshot J+0 avant publication ────────
      // Utilise item.keyword (mot-clé cible de la file d'attente) pour tracker
      // la position avant/après MAJ comparée à J+7 et J+30.
      let capturedSeoTracking = null;
      if (item.keyword && item.url && firebaseReady && (settings.haloscanConfigured || settings.haloscanKey)) {
        const now    = Date.now();
        const DAY_MS = 86400000;
        // Initialisé avant le try : le badge "En attente J+7" s'affiche même si
        // les appels Firestore/Haloscan échouent silencieusement.
        capturedSeoTracking = {
          enabled:          true,
          keywords:         [item.keyword],
          articleUrl:       item.url,
          snapshots:        [],
          nextSnapshotType: 'after_7d',
          nextSnapshotAt:   now + 7 * DAY_MS,
          completed:        false,
        };
        try {
          await initArticleSeoTracking(item.id, { keywords: [item.keyword], articleUrl: item.url });
          const resp = await axios.post('/api/haloscan/check', { keywords: [item.keyword], articleUrl: item.url });
          if (resp.data?.success) {
            const snap = { type: 'before', capturedAt: now, results: resp.data.results || [] };
            await saveSeoSnapshot(item.id, snap);
            capturedSeoTracking.snapshots = [snap];
          }
        } catch { /* non bloquant */ }
      }

      // ── Étape 6 : Passer en statut "À valider" ────────────────────────────
      dispatch(updatePendingItem({
        id:     item.id,
        status: 'a_valider',
        startedBy: null,
        startedAt: null,
        majResult: {
          articleTitle,
          originalContent: articleHtml,
          updatedContent:  updatedHtml,
          updates:         allUpdatesWithStatus,
          sources:         result.sources || [],
          analysis:        result.analysis || '',
          seoTracking:     capturedSeoTracking,   // transféré vers articleData à la validation
          wpData:          item._wpData || result.wpData || null,  // post cible (postId) — pour rebinder à la réouverture
          audit:           result.audit || '',     // rapport d'audit complet — onglet AUDIT
        },
      }));

      // ── Étape 6bis : Notifier l'assigné (sinon le lanceur) ────────────────
      // Cloche + badge sidebar : « prêt à valider » sans surveiller la page.
      // toUserId doit être un UID (règles Firestore) : on résout l'assigneeId
      // qui peut être un username (auto-assignation cq_ia sans uid).
      try {
        const assignee = teamMembers.find(m => m.id === item.assigneeId || m.username === item.assigneeId);
        const targetUid = assignee?.id || authUid || null;
        if (firebaseReady && targetUid) {
          createNotification({
            toUserId:     targetUid,
            fromUsername: authUsername || '',
            type:         'maj_ready',
            majItemId:    item.id,
            message:      `Analyse terminée : « ${articleTitle} » est prêt à valider`,
          });
        }
      } catch { /* non bloquant */ }

      // ── Étape 7 : Archivage automatique dans l'Historique ────────────────
      // L'analyse est sauvegardée dès qu'elle se termine : plus besoin de la
      // refaire si la session est perdue avant le « Terminer ». Même ID que
      // l'item de la file → « Terminer » mettra à jour la MÊME entrée (pas de
      // doublon, addToHistory est idempotent par id) et l'autosave synchronise
      // ensuite l'entrée en continu. L'item RESTE dans « À valider » — le
      // bouton « Terminer » garde son rôle (validation + retrait de la file).
      // saveArticle = setDoc merge → ne touche pas au seoTracking déjà écrit.
      try {
        const articleData = {
          id:              item.id,
          title:           articleTitle,
          originalContent: articleHtml,
          updatedContent:  updatedHtml,
          updates:         allUpdatesWithStatus,
          sources:         result.sources || [],
          analysis:        result.analysis || '',
          audit:           result.audit || '',
          url:             item.url || '',
          keyword:         item.keyword || '',
          priority:        item.priority || 'normale',
          assigneeId:      item.assigneeId || null,
          createdAt:       new Date().toISOString(),
          tokenUsage:      result.tokenUsage || null,
        };
        if (firebaseReady) {
          try {
            const { id, originalContentUrl, updatedContentUrl } = await saveArticle(articleData);
            const { originalContent, updatedContent, ...meta } = articleData;
            dispatch(addToHistory({
              ...meta,
              id,
              ...(capturedSeoTracking ? { seoTracking: capturedSeoTracking } : {}),   // badge en session (la base est maintenue par le cron)
              ...(originalContentUrl ? { originalContentUrl } : { originalContent }),
              ...(updatedContentUrl  ? { updatedContentUrl  } : { updatedContent  }),
            }));
          } catch (fsErr) {
            // Firestore KO (doc trop lourd, réseau…) → on archive quand même
            // LOCALEMENT (Redux + localStorage) : l'article apparaît dans
            // l'Historique de la session, « Terminer » retentera la base.
            // Même filet que le flux normal (Articles.jsx).
            console.error('[maj] Archivage Firestore échoué — repli local :', fsErr);
            toast(`Analyse archivée localement — synchronisation base impossible (${fsErr?.message || 'erreur inconnue'})`, { icon: '⚠️', duration: 7000 });
            dispatch(addToHistory({
              ...articleData,
              ...(capturedSeoTracking ? { seoTracking: capturedSeoTracking } : {}),
            }));
          }
        } else {
          dispatch(addToHistory({
            ...articleData,
            ...(capturedSeoTracking ? { seoTracking: capturedSeoTracking } : {}),
          }));
        }
      } catch (archiveErr) {
        // Non bloquant : le résultat reste dans l'item « À valider » (majResult)
        // et « Terminer » archivera comme avant.
        console.error('[maj] Archivage automatique échoué :', archiveErr);
      }

      const applied = allUpdatesWithStatus.filter(u => u.applied).length;
      const total   = allUpdatesWithStatus.length;
      toast.success(`MAJ prête — ${applied}/${total} modif. appliquées et archivées dans l'Historique`, { icon: <Search size={18} /> });

      return {
        originalContent: articleHtml,
        updatedContent:  updatedHtml,
        updates:         allUpdatesWithStatus,
        sources:         result.sources || [],
        analysis:        result.analysis || '',
        parseFailed:     result.parseFailed === true,
        wpData:          item._wpData || result.wpData || null,
        audit:           result.audit || '',
      };

    } catch (e) {
      console.error('[maj]', e);
      toast.error('Erreur : ' + e.message);
      dispatch(setError(e.message));
      dispatch(updatePendingItem({ id: item.id, status: 'error', errorMsg: e.message, startedBy: null, startedAt: null }));
      return null;
    } finally {
      updateRunState(item.id, null);
    }
  };

  // ── Démarrage réel d'une analyse (occupe un créneau) ───────────────────────
  // interactive = lancement au clic (comportement historique : navigation vers
  // la review si c'est la SEULE analyse) · false = démarrage automatique depuis
  // la file → jamais de navigation ni d'écriture dans l'état global de l'agent
  // (ne pas arracher l'utilisateur ni écraser une review en cours).
  const startAnalysis = async (item, { interactive = false } = {}) => {
    liveRuns.add(item.id);

    // Feedback visuel immédiat — le bouton MAJ disparaît dès le clic
    const others = liveRuns.size - 1;
    updateRunState(item.id, { step: others > 0 ? 'Démarrage dans quelques secondes…' : '', progress: 0 });

    // Stagger : décaler le démarrage selon le nombre de slots déjà actifs
    // pour éviter un burst simultané sur l'API Anthropic
    if (others > 0) {
      await new Promise(r => setTimeout(r, others * SLOT_STAGGER_MS));
    }

    if (interactive) {
      dispatch(resetAgent());
      dispatch(setStatus('running'));
    }

    let data = null;
    try {
      data = await processItem(item);
    } finally {
      liveRuns.delete(item.id);
      pumpQueue(); // un créneau se libère → démarrer l'analyse suivante en file
    }

    // Navigation vers la review UNIQUEMENT pour un lancement interactif resté
    // seul (pas d'autres analyses actives ni en file) ET si l'utilisateur est
    // toujours sur la page de la file — sinon le résultat attend sagement dans
    // « À valider » (+ notification à l'assigné).
    const canNavigate = interactive
      && data
      && liveRuns.size === 0
      && launchQueue.length === 0
      && window.location.pathname === '/maj-en-attente';

    if (canNavigate) {
      dispatch(setOriginalContent(data.originalContent || ''));
      dispatch(setUpdatedContent(data.updatedContent   || ''));
      dispatch(setDiff(data.updates   || []));
      dispatch(setSources(data.sources || []));
      dispatch(setAnalysis(data.analysis || ''));
      dispatch(setParseFailed(data.parseFailed === true));
      // TOUJOURS rebinder (null si absent) : sinon le wpData de l'article PRÉCÉDENT
      // reste en mémoire → publication proposée sur le mauvais site (confusion de sites).
      dispatch(setWpData(data.wpData || null));
      dispatch(setAudit(data.audit || ''));
      dispatch(setCurrentArticleId(item.id));
      dispatch(setStatus('done'));
      navigate('/');
    } else if (store.getState().agent.status === 'running' && liveRuns.size === 0) {
      // Plus rien ne tourne et personne n'a ouvert de review entre-temps :
      // libérer l'écran « analyse en cours » de la page Faire une MAJ
      dispatch(setStatus('idle'));
    }
  };

  // Démarre les analyses en file tant qu'il reste des créneaux libres.
  // Relit la liste depuis le store (l'item a pu être supprimé/modifié entre-temps).
  const pumpQueue = () => {
    while (liveRuns.size < CONCURRENCY && launchQueue.length > 0) {
      const nextId = launchQueue.shift();
      syncQueueUi();
      const next = store.getState().pending.list.find(i => i.id === nextId);
      if (!next || !['pending', 'error'].includes(next.status)) continue; // retiré/déjà traité
      startAnalysis(next, { interactive: false }); // liveRuns.add est synchrone → le while voit le créneau occupé
    }
  };

  // ── Lancement au clic : créneau libre → démarre · file pleine → mise en file ──
  const handleRunMaj = (item) => {
    if (!settings.aiConfigured && !settings.useLocalProxy && !settings.anthropicKey) {
      toast.error('Clé API Anthropic manquante — vérifiez les Paramètres');
      return;
    }
    if (liveRuns.has(item.id) || launchQueue.includes(item.id)) return; // déjà lancé/en file
    if (liveRuns.size >= CONCURRENCY) {
      launchQueue.push(item.id);
      syncQueueUi();
      toast(
        `${CONCURRENCY} analyses déjà en cours — « ${item.title || item.url} » démarrera automatiquement (n°${launchQueue.length} en file)`,
        { icon: <Clock size={18} className="text-indigo-500" />, duration: 5000 },
      );
      return;
    }
    startAnalysis(item, { interactive: true });
  };


  // ── Suppressions avec garde-fou (ConfirmDialog) ────────────────────────────
  // { type:'item', id, label } → confirmation simple · { type:'all' } → renforcée
  const [confirmState, setConfirmState] = useState(null);
  const handleDelete = (id) => {
    const it = itemsRef.current.find(i => i.id === id);
    setConfirmState({ type: 'item', id, label: it?.title || it?.url || 'cet article' });
  };
  const confirmDeletion = () => {
    if (!confirmState) return;
    if (confirmState.type === 'all') {
      launchQueue.length = 0;
      syncQueueUi();
      dispatch(clearAll());
      toast.success('File vidée');
    } else {
      dequeueItem(confirmState.id); // retiré aussi de la file de lancement le cas échéant
      dispatch(removePendingItem(confirmState.id));
      toast.success('Article retiré de la file');
    }
  };
  const handleAssign         = (id, assigneeId) => dispatch(updatePendingItem({ id, assigneeId }));
  const handlePriorityChange = (id, priority) => dispatch(updatePendingItem({ id, priority }));

  // Rouvrir la page Articles avec le résultat d'un item déjà traité.
  // Les documents pending Firestore sont ALLÉGÉS (les HTML complets dépassent
  // 1 Mo) : après un vidage de cache / sur un autre poste, majResult n'a plus
  // les contenus → on les recharge depuis l'ARCHIVE Historique (même id,
  // créée automatiquement à la fin de l'analyse, HTML dans Storage).
  const handleViewDiff = async (item) => {
    let r = item.majResult || {};
    if (!r.originalContent || !r.updatedContent) {
      const arch = store.getState().articles.history.find(a => a.id === item.id);
      if (arch) {
        const [orig, updated] = await Promise.all([
          arch.originalContent || fetchArticleHtml(arch.originalContentUrl),
          arch.updatedContent  || fetchArticleHtml(arch.updatedContentUrl),
        ]);
        r = {
          articleTitle:    r.articleTitle || arch.title || '',
          originalContent: r.originalContent || orig    || '',
          updatedContent:  r.updatedContent  || updated || '',
          updates:         r.updates  || arch.updates  || [],
          sources:         r.sources  || arch.sources  || [],
          analysis:        r.analysis || arch.analysis || '',
          audit:           r.audit    || arch.audit    || '',
          wpData:          r.wpData   || arch.wpData   || null,
          seoTracking:     r.seoTracking || arch.seoTracking || null,
        };
      }
    }
    if (!r.updatedContent) {
      toast.error('Contenu de l\'analyse introuvable — relancez la MAJ de cet article');
      return;
    }
    dispatch(setOriginalContent(r.originalContent || ''));
    dispatch(setUpdatedContent(r.updatedContent   || ''));
    dispatch(setDiff(r.updates   || []));
    dispatch(setSources(r.sources || []));
    dispatch(setAnalysis(r.analysis || ''));
    // Rebinder la cible WordPress sur CET article (null si non mémorisé) — évite
    // de publier sur le post d'un article ouvert précédemment (mauvaise cible).
    dispatch(setWpData(r.wpData || null));
    dispatch(setAudit(r.audit || ''));
    dispatch(setCurrentArticleId(item.id)); // marque cet item comme "en cours de review"
    dispatch(setStatus('done'));
    navigate('/');
  };


  return (
    <div className="space-y-6 animate-fade-in">

      {/* ── Panels slide ── */}
      <AddManualPanel
        open={showAddManual}
        onAdd={(item) => dispatch(addPendingItem(withSelfAssign(item)))}
        onClose={() => setShowAddManual(false)}
        teamMembers={teamMembers}
      />
      <ImportPanel
        open={showImport}
        onClose={() => setShowImport(false)}
        onParsed={handleParsed}
      />

      {/* ── Header ── */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <ListChecks size={22} className="text-gray-700" />
            MAJ en attente
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            File d'articles à mettre à jour · import Google Sheets / XLSX
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setShowAddManual(true)}
            className="btn-ghost flex items-center gap-2 text-sm"
          >
            <Plus size={14} />
            Ajouter
          </button>
          <button
            onClick={() => setShowImport(true)}
            className="btn-primary flex items-center gap-2 text-sm"
          >
            <Upload size={14} />
            Importer
          </button>
        </div>
      </div>

      {/* ── Compteurs ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          {
            label: 'Total', value: counts.total,
            icon: <ListChecks size={15} className="text-gray-400" />,
            color: 'text-gray-900', sub: 'articles actifs',
            accent: 'border-l-gray-300',
          },
          {
            label: 'En attente', value: counts.pending,
            icon: <Clock size={15} className="text-amber-500" />,
            color: 'text-amber-700', sub: 'à traiter',
            accent: 'border-l-amber-300',
          },
          {
            label: 'En cours', value: counts.in_progress,
            icon: <PlayCircle size={15} className="text-blue-500" />,
            color: 'text-blue-700', sub: 'en traitement',
            accent: 'border-l-blue-300',
          },
          {
            label: 'À valider', value: counts.a_valider,
            icon: <ShieldCheck size={15} className="text-purple-500" />,
            color: 'text-purple-700', sub: 'en review',
            accent: 'border-l-purple-300',
          },
        ].map(c => (
          <div key={c.label} className={`glass-card px-4 py-3.5 border-l-[3px] ${c.accent}`}>
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">{c.label}</p>
              {c.icon}
            </div>
            <p className={`text-2xl font-bold ${c.color} leading-none`}>{c.value}</p>
            <p className="text-[11px] text-gray-400 mt-1">{c.sub}</p>
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
                <p className="text-xs font-medium text-gray-700">Récupération des titres manquants…</p>
                <span className="text-xs text-gray-400 tabular-nums">{enriching.done} / {enriching.total}</span>
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

      {/* ── Filtres + actions bulk ── */}
      {activeItems.length > 0 && (
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-1 bg-gray-100/70 rounded-xl p-1">
            {FILTERS.map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  filter === f
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {f}
                {f !== 'Tous' && (
                  <span className={`ml-1.5 tabular-nums ${filter === f ? 'text-gray-400' : 'text-gray-400'}`}>
                    {f === 'En attente' ? counts.pending : f === 'En cours' ? counts.in_progress : counts.a_valider}
                  </span>
                )}
              </button>
            ))}
          </div>
          <button
            onClick={() => setConfirmState({ type: 'all' })}
            className="btn-ghost text-xs text-red-400 hover:text-red-600 hover:bg-red-50 flex items-center gap-1.5"
          >
            <Trash2 size={12} />
            Tout supprimer
          </button>

          {/* Garde-fou de suppression (item : simple · tout : renforcé) */}
          <ConfirmDialog
            open={!!confirmState}
            onClose={() => setConfirmState(null)}
            onConfirm={confirmDeletion}
            definitive={confirmState?.type === 'all'}
            title={confirmState?.type === 'all' ? 'Vider toute la file ?' : 'Retirer cet article de la file ?'}
            message={confirmState?.type === 'all'
              ? `Les ${activeItems.length} article${activeItems.length > 1 ? 's' : ''} de la file (en attente, en cours et à valider) seront supprimés définitivement. Les articles déjà archivés dans l'Historique ne sont pas touchés.`
              : `« ${confirmState?.label || ''} » sera retiré de la file de MAJ. S'il a déjà été analysé, son archive reste dans l'Historique.`}
            confirmLabel={confirmState?.type === 'all' ? 'SUPPRIMER DÉFINITIVEMENT' : 'Retirer'}
          />
        </div>
      )}

      {/* ── Liste ── */}
      {activeItems.length === 0 ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="glass-card p-14 text-center"
        >
          <div className="w-14 h-14 rounded-2xl bg-gray-50 border border-gray-100 flex items-center justify-center mx-auto mb-4">
            <ListChecks size={24} className="text-gray-300" />
          </div>
          <p className="text-sm font-semibold text-gray-500">File vide</p>
          <p className="text-xs text-gray-400 mt-1.5 max-w-xs mx-auto">
            Importez un fichier Google Sheets / XLSX ou ajoutez des articles manuellement.
          </p>
          <div className="flex justify-center gap-3 mt-6">
            <button onClick={() => setShowAddManual(true)} className="btn-ghost text-sm flex items-center gap-2">
              <Plus size={14} /> Ajouter
            </button>
            <button onClick={() => setShowImport(true)} className="btn-primary text-sm flex items-center gap-2">
              <Upload size={14} /> Importer
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
                    running={runStates.get(item.id) || null}
                    queuedPos={queuedIds.indexOf(item.id) + 1 || null}
                    onDequeue={dequeueItem}
                    isMine={isMine(item)}
                    teamMembers={teamMembers}
                  />
                ))}
              </AnimatePresence>
            </div>
          ))}
          <Pagination total={sorted.length} page={page} onPageChange={setPage} />
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
