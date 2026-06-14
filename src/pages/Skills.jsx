import { useState, useCallback, useEffect, useRef } from 'react';
import { STORAGE_KEYS } from '../constants/storage';
import axios from 'axios';
import { useDispatch, useSelector } from 'react-redux';
import { motion, AnimatePresence } from 'framer-motion';
import { useDropzone } from 'react-dropzone';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import toast from 'react-hot-toast';
import * as XLSX from 'xlsx';
import {
  Upload, Zap, Trash2, Edit3, Save, X, Plus, FileText, Eye, PenLine,
  BookOpen, FileSpreadsheet, File, ChevronDown, ChevronUp, Database,
  Globe, Code, FileCode, FileWarning, Loader2, Mic, MonitorPlay,
  CheckCircle2, AlertTriangle, Power, Download, FileJson, Gauge,
  AlertCircle, ShieldCheck, Lock,
} from 'lucide-react';
import { addSkill, updateSkill, removeSkill, setSkills } from '../store/slices/skillsSlice';
import { addKnowledge, updateKnowledge, removeKnowledge, setKnowledge } from '../store/slices/knowledgeSlice';
import { saveSkill, deleteSkill, saveKnowledge, deleteKnowledge } from '../services/firebase';
import { renderMarkdown, markdownToPlain } from '../utils/markdown';
import { lintEntry, isActive, contextBudget, budgetLevel, BUDGET } from '../utils/skillsLint';

/* ─── Persistence localStorage ───────────────────────────────────────────────── */
const persist = (key, value) => {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
};

/* ─── Template d'un nouveau skill (cf. standard §3) ──────────────────────────── */
const SKILL_TEMPLATE = `## [Nom court]

**Objectif** — en une phrase, le résultat visé.

**Règle** — quoi faire concrètement (impératif, points courts).

**Pourquoi** — la raison (un modèle qui comprend le but généralise mieux).

**Exemple** — un avant / après court si utile.`;

/* ─── Badge de lint (anti-patterns du standard) ──────────────────────────────── */
function LintBadge({ entry, kind }) {
  const issues = lintEntry(entry, kind);
  if (!issues.length) return null;
  const hasError = issues.some(i => i.level === 'error');
  const Icon = hasError ? AlertCircle : AlertTriangle;
  const cls = hasError
    ? 'bg-red-50 text-red-600 border-red-200'
    : 'bg-amber-50 text-amber-700 border-amber-200';
  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-md border ${cls}`}
      title={issues.map(i => `• ${i.message}`).join('\n')}
    >
      <Icon size={10} /> {issues.length} {hasError ? 'à corriger' : (issues.length > 1 ? 'alertes' : 'alerte')}
    </span>
  );
}

/* ─── Métadonnées des types de fichiers ──────────────────────────────────────── */
const FILE_TYPES = {
  txt:  { label: 'Texte',    icon: FileText,       color: 'bg-gray-100   text-gray-600',    extractable: true  },
  md:   { label: 'Markdown', icon: FileText,       color: 'bg-purple-50  text-purple-600',  extractable: true  },
  html: { label: 'HTML',     icon: Globe,          color: 'bg-orange-50  text-orange-600',  extractable: true  },
  htm:  { label: 'HTML',     icon: Globe,          color: 'bg-orange-50  text-orange-600',  extractable: true  },
  csv:  { label: 'CSV',      icon: FileSpreadsheet,color: 'bg-green-50   text-green-600',   extractable: true  },
  xlsx: { label: 'Excel',    icon: FileSpreadsheet,color: 'bg-emerald-50 text-emerald-600', extractable: true  },
  xls:  { label: 'Excel',    icon: FileSpreadsheet,color: 'bg-emerald-50 text-emerald-600', extractable: true  },
  ods:  { label: 'Tableur',  icon: FileSpreadsheet,color: 'bg-emerald-50 text-emerald-600', extractable: true  },
  docx: { label: 'Word',     icon: File,           color: 'bg-blue-50    text-blue-600',    extractable: true  },
  pdf:  { label: 'PDF',      icon: File,           color: 'bg-red-50     text-red-500',     extractable: true  },
  json: { label: 'JSON',     icon: FileCode,       color: 'bg-yellow-50  text-yellow-600',  extractable: true  },
  xml:  { label: 'XML',      icon: Code,           color: 'bg-yellow-50  text-yellow-700',  extractable: true  },
  rtf:  { label: 'RTF',      icon: FileText,       color: 'bg-gray-100   text-gray-600',    extractable: true  },
  yaml: { label: 'YAML',     icon: FileCode,       color: 'bg-indigo-50  text-indigo-600',  extractable: true  },
  yml:  { label: 'YAML',     icon: FileCode,       color: 'bg-indigo-50  text-indigo-600',  extractable: true  },
  manual:     { label: 'Manuel',       icon: PenLine,  color: 'bg-gray-100   text-gray-700',    extractable: true  },
  transcript: { label: 'Transcription',icon: Mic,      color: 'bg-red-50     text-red-500',      extractable: true  },
};
const getFileMeta = (nameOrExt) => {
  const ext = (nameOrExt || '').split('.').pop().toLowerCase();
  return FILE_TYPES[ext] || { label: ext.toUpperCase(), icon: File, color: 'bg-gray-100 text-gray-500', extractable: false };
};

/* ─── CSV → tableau Markdown ─────────────────────────────────────────────────── */
const formatCsvAsMarkdown = (csv) => {
  try {
    const lines = csv.trim().split('\n').filter(Boolean);
    if (lines.length === 0) return csv;
    const rows = lines.map(line =>
      line.split(',').map(c => c.trim().replace(/^"|"$/g, ''))
    );
    const header = rows[0];
    const body   = rows.slice(1);
    return [
      '| ' + header.join(' | ') + ' |',
      '| ' + header.map(() => '---').join(' | ') + ' |',
      ...body.map(r => '| ' + r.join(' | ') + ' |'),
    ].join('\n');
  } catch { return csv; }
};

/* ─── Strip RTF basique ──────────────────────────────────────────────────────── */
const stripRtf = (rtf) => {
  try {
    return rtf
      .replace(/\{\\[^{}]+\}/g, '')      // groupes de contrôle
      .replace(/\\[a-zA-Z]+\d*[ ]?/g, '') // mots de contrôle
      .replace(/[\\{}]/g, '')             // accolades et backslashes restants
      .replace(/\r\n|\r/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  } catch { return rtf; }
};

/* ─── Extraction de contenu — tous formats ───────────────────────────────────── */
// Retourne { content: string|null, warning: string|null, isHtml: boolean }
const extractFileContent = async (file) => {
  const ext = file.name.split('.').pop().toLowerCase();

  // ── Formats texte natifs ────────────────────────────────────────────────────
  if (['txt', 'md', 'xml', 'yaml', 'yml', 'log'].includes(ext)) {
    try {
      const content = await file.text();
      return { content: content.trim(), warning: null, isHtml: false };
    } catch (e) {
      return { content: null, warning: 'Lecture impossible : ' + e.message, isHtml: false };
    }
  }

  // ── RTF ─────────────────────────────────────────────────────────────────────
  if (ext === 'rtf') {
    try {
      const raw = await file.text();
      return { content: stripRtf(raw), warning: null, isHtml: false };
    } catch (e) {
      return { content: null, warning: 'RTF : ' + e.message, isHtml: false };
    }
  }

  // ── JSON ─────────────────────────────────────────────────────────────────────
  if (ext === 'json') {
    try {
      const raw = await file.text();
      try {
        const parsed = JSON.parse(raw);
        return { content: JSON.stringify(parsed, null, 2), warning: null, isHtml: false };
      } catch {
        return { content: raw.trim(), warning: null, isHtml: false };
      }
    } catch (e) {
      return { content: null, warning: 'JSON : ' + e.message, isHtml: false };
    }
  }

  // ── CSV ──────────────────────────────────────────────────────────────────────
  if (ext === 'csv') {
    try {
      const raw = await file.text();
      return { content: formatCsvAsMarkdown(raw), warning: null, isHtml: false };
    } catch (e) {
      return { content: null, warning: 'CSV : ' + e.message, isHtml: false };
    }
  }

  // ── HTML / HTM ───────────────────────────────────────────────────────────────
  if (['html', 'htm'].includes(ext)) {
    try {
      const raw = await file.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(raw, 'text/html');
      // Supprimer les éléments non-contenu
      doc.querySelectorAll('script, style, noscript, nav, header, footer, aside').forEach(el => el.remove());
      const text = (doc.body?.innerText || doc.body?.textContent || '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
      return { content: text, warning: null, isHtml: false };
    } catch (e) {
      return { content: null, warning: 'HTML : ' + e.message, isHtml: false };
    }
  }

  // ── XLSX / XLS / ODS ─────────────────────────────────────────────────────────
  if (['xlsx', 'xls', 'ods'].includes(ext)) {
    try {
      const arrayBuffer = await file.arrayBuffer();
      const wb = XLSX.read(arrayBuffer, { type: 'array' });
      const parts = [];
      for (const sheetName of wb.SheetNames) {
        const sheet = wb.Sheets[sheetName];
        const csv   = XLSX.utils.sheet_to_csv(sheet);
        if (csv.trim()) {
          const table = formatCsvAsMarkdown(csv);
          parts.push(wb.SheetNames.length > 1 ? `### Feuille : ${sheetName}\n\n${table}` : table);
        }
      }
      if (parts.length === 0) return { content: null, warning: 'Fichier tableur vide.', isHtml: false };
      return { content: parts.join('\n\n---\n\n'), warning: null, isHtml: false };
    } catch (e) {
      return { content: null, warning: 'Tableur : ' + e.message, isHtml: false };
    }
  }

  // ── DOCX ─────────────────────────────────────────────────────────────────────
  if (ext === 'docx') {
    try {
      const arrayBuffer = await file.arrayBuffer();
      const mammoth = await import('mammoth');
      const { value, messages } = await mammoth.extractRawText({ arrayBuffer });
      const warn = messages?.find(m => m.type === 'warning')?.message || null;
      if (!value?.trim()) return { content: null, warning: 'DOCX vide ou non lisible.', isHtml: false };
      return { content: value.trim(), warning: warn, isHtml: false };
    } catch (e) {
      return { content: null, warning: 'DOCX : ' + e.message, isHtml: false };
    }
  }

  // ── PDF ───────────────────────────────────────────────────────────────────────
  if (ext === 'pdf') {
    try {
      const arrayBuffer = await file.arrayBuffer();
      const pdfjs = await import('pdfjs-dist');
      // Worker via CDN pour éviter la config webpack complexe
      if (!pdfjs.GlobalWorkerOptions.workerSrc) {
        pdfjs.GlobalWorkerOptions.workerSrc =
          `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.js`;
      }
      const pdf  = await pdfjs.getDocument({ data: arrayBuffer }).promise;
      const pages = [];
      for (let i = 1; i <= pdf.numPages; i++) {
        const page    = await pdf.getPage(i);
        const content = await page.getTextContent();
        const text    = content.items.map(item => item.str || '').join(' ').trim();
        if (text) pages.push(text);
      }
      const full = pages.join('\n\n');
      if (!full.trim()) return { content: null, warning: 'PDF scanné ou protégé — aucun texte extractible. Exportez en .docx.', isHtml: false };
      return { content: full, warning: null, isHtml: false };
    } catch (e) {
      return {
        content: null,
        warning: `PDF : extraction échouée (${e.message}). Exportez en .docx ou copiez-collez le contenu.`,
        isHtml: false,
      };
    }
  }

  // ── DOC (ancien format Word) ──────────────────────────────────────────────────
  if (ext === 'doc') {
    return {
      content: null,
      warning: 'Format .doc (Word 97-2003) non supporté — convertissez en .docx (Enregistrer sous → .docx) ou exportez en .txt.',
      isHtml: false,
    };
  }

  // ── Format inconnu ────────────────────────────────────────────────────────────
  return {
    content: null,
    warning: `Format .${ext} non reconnu — formats supportés : .txt .md .html .docx .xlsx .csv .json .pdf .rtf .xml .yaml`,
    isHtml: false,
  };
};

/* ─── Barre d'outils TipTap ─────────────────────────────────────────────────── */
function Toolbar({ editor }) {
  if (!editor) return null;
  const Btn = ({ active, onClick, label }) => (
    <button
      type="button"
      onClick={onClick}
      className={`px-2.5 py-1 text-xs rounded-lg font-medium transition-all duration-150 ${
        active ? 'bg-black text-white shadow-sm' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-800'
      }`}
    >
      {label}
    </button>
  );
  return (
    <div className="flex items-center gap-1 flex-wrap">
      <Btn active={editor.isActive('bold')}      onClick={() => editor.chain().focus().toggleBold().run()}          label="G" />
      <Btn active={editor.isActive('italic')}    onClick={() => editor.chain().focus().toggleItalic().run()}        label="I" />
      <div className="w-px h-4 bg-gray-200 mx-0.5" />
      <Btn active={editor.isActive('heading', { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} label="H2" />
      <Btn active={editor.isActive('heading', { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} label="H3" />
      <div className="w-px h-4 bg-gray-200 mx-0.5" />
      <Btn active={editor.isActive('bulletList')}   onClick={() => editor.chain().focus().toggleBulletList().run()}   label="• Liste" />
      <Btn active={editor.isActive('orderedList')}  onClick={() => editor.chain().focus().toggleOrderedList().run()}  label="1. Liste" />
      <div className="w-px h-4 bg-gray-200 mx-0.5" />
      <Btn active={editor.isActive('codeBlock')}    onClick={() => editor.chain().focus().toggleCodeBlock().run()}    label="</> Code" />
      <Btn active={editor.isActive('blockquote')}   onClick={() => editor.chain().focus().toggleBlockquote().run()}   label='" Citation' />
    </div>
  );
}

/* ─── Éditeur de skill ───────────────────────────────────────────────────────── */
function SkillEditor({ skill, onSave, onCancel }) {
  const [name, setName]             = useState(skill.name || '');
  const [viewMode, setViewMode]     = useState('edit');

  // Convertit le markdown en HTML si besoin (skills importés depuis .md)
  // Nouveau skill (sans contenu) → on pré-remplit avec le template du standard.
  const initialHtml = renderMarkdown(skill.content || SKILL_TEMPLATE);
  const [htmlContent, setHtmlContent] = useState(initialHtml);

  const editor = useEditor({
    extensions: [StarterKit],
    content: initialHtml,
    onUpdate: ({ editor }) => setHtmlContent(editor.getHTML()),
  });

  const charCount = editor?.getText()?.length || 0;
  const issues = lintEntry({ name, content: htmlContent }, 'skill');

  const handleSave = () => {
    if (!name.trim())      { toast.error('Nom du skill requis'); return; }
    if (!htmlContent.trim() || htmlContent === '<p></p>') { toast.error('Contenu requis'); return; }
    onSave({ ...skill, name: name.trim(), content: htmlContent });
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -12 }}
      className="glass-card overflow-hidden"
    >
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 bg-black rounded-lg flex items-center justify-center">
            <Zap size={13} className="text-white" />
          </div>
          <h3 className="font-semibold text-gray-900 text-sm">
            {skill.id ? 'Modifier le skill' : 'Nouveau skill'}
          </h3>
        </div>
        <button onClick={onCancel} className="btn-ghost !px-1.5 !py-1.5"><X size={16} /></button>
      </div>

      <div className="p-6 space-y-5">
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Nom du skill</label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="ex: SEO immobilier, Ton formel, Éviter les anglicismes…"
            className="input-glass"
            autoFocus
          />
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
              Instructions pour l'agent IA
            </label>
            <div className="flex items-center gap-0.5 bg-gray-100 rounded-lg p-0.5">
              <button type="button" onClick={() => setViewMode('edit')}
                className={`flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md transition-all duration-150 ${viewMode === 'edit' ? 'bg-white shadow-sm text-gray-800 font-medium' : 'text-gray-500 hover:text-gray-700'}`}>
                <PenLine size={11} /> Écrire
              </button>
              <button type="button" onClick={() => setViewMode('preview')}
                className={`flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md transition-all duration-150 ${viewMode === 'preview' ? 'bg-white shadow-sm text-gray-800 font-medium' : 'text-gray-500 hover:text-gray-700'}`}>
                <Eye size={11} /> Aperçu
              </button>
            </div>
          </div>

          <div className="border border-gray-200 rounded-xl overflow-hidden shadow-sm bg-white/80">
            {viewMode === 'edit' ? (
              <>
                <div className="flex items-center gap-0 px-4 py-2.5 border-b border-gray-100 bg-gray-50/80">
                  <Toolbar editor={editor} />
                </div>
                <div className="p-4" style={{ minHeight: '260px' }}>
                  <EditorContent editor={editor} className="tiptap text-sm text-gray-800" />
                </div>
              </>
            ) : (
              <div
                className="skill-editor-preview p-5 text-sm text-gray-700"
                style={{ minHeight: '260px' }}
                dangerouslySetInnerHTML={{ __html: htmlContent || '<p style="color:#9ca3af">Aucun contenu</p>' }}
              />
            )}
          </div>

          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-400">Injecté dans le prompt système de l'agent à chaque analyse.</p>
            <span className={`text-xs tabular-nums ${charCount > BUDGET.skill ? 'text-amber-500 font-medium' : 'text-gray-400'}`}>
              {charCount.toLocaleString()} / {BUDGET.skill.toLocaleString()} car.
            </span>
          </div>

          {/* Lint en direct — anti-patterns du standard */}
          {issues.length > 0 && (
            <div className="space-y-1.5 rounded-xl border border-amber-100 bg-amber-50/60 p-3">
              {issues.map((i, idx) => (
                <div key={idx} className="flex items-start gap-2 text-[11px] leading-relaxed">
                  {i.level === 'error'
                    ? <AlertCircle size={12} className="text-red-500 shrink-0 mt-0.5" />
                    : <AlertTriangle size={12} className="text-amber-500 shrink-0 mt-0.5" />}
                  <span className={i.level === 'error' ? 'text-red-600' : 'text-amber-700'}>{i.message}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between pt-1 border-t border-gray-100">
          <button onClick={onCancel} className="btn-ghost">Annuler</button>
          <button onClick={handleSave} className="btn-primary">
            <Save size={14} /> Enregistrer le skill
          </button>
        </div>
      </div>
    </motion.div>
  );
}

/* ─── Éditeur de document de connaissance (saisie manuelle) ─────────────────── */
function KnowledgeEditor({ item, onSave, onCancel }) {
  const [name, setName]               = useState(item?.name || '');
  const [viewMode, setViewMode]       = useState('edit');

  // Convertit le markdown en HTML si besoin (documents importés depuis fichiers)
  const initialHtml = renderMarkdown(item?.content || '');
  const [htmlContent, setHtmlContent] = useState(initialHtml);

  const editor = useEditor({
    extensions: [StarterKit],
    content: initialHtml,
    onUpdate: ({ editor }) => setHtmlContent(editor.getHTML()),
  });

  const charCount = editor?.getText()?.length || 0;

  const handleSave = () => {
    if (!name.trim()) { toast.error('Nom du document requis'); return; }
    if (!htmlContent.trim() || htmlContent === '<p></p>') { toast.error('Contenu requis'); return; }
    onSave({
      ...(item || {}),
      name: name.trim(),
      content: htmlContent,
      source: 'manual',
      isHtml: true,
      size: htmlContent.length,
      type: 'text/html',
      createdAt: item?.createdAt || Date.now(),
    });
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -12 }}
      className="glass-card overflow-hidden"
    >
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 bg-gray-900 rounded-lg flex items-center justify-center">
            <Database size={13} className="text-white" />
          </div>
          <h3 className="font-semibold text-gray-900 text-sm">
            {item?.id ? 'Modifier le document' : 'Nouveau document de référence'}
          </h3>
        </div>
        <button onClick={onCancel} className="btn-ghost !px-1.5 !py-1.5"><X size={16} /></button>
      </div>

      <div className="p-6 space-y-5">
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Nom du document</label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="ex: Tarifs 2025, Processus éditorial, Charte SEO…"
            className="input-glass"
            autoFocus
          />
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Contenu de référence</label>
            <div className="flex items-center gap-0.5 bg-gray-100 rounded-lg p-0.5">
              <button type="button" onClick={() => setViewMode('edit')}
                className={`flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md transition-all ${viewMode === 'edit' ? 'bg-white shadow-sm text-gray-800 font-medium' : 'text-gray-500 hover:text-gray-700'}`}>
                <PenLine size={11} /> Écrire
              </button>
              <button type="button" onClick={() => setViewMode('preview')}
                className={`flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md transition-all ${viewMode === 'preview' ? 'bg-white shadow-sm text-gray-800 font-medium' : 'text-gray-500 hover:text-gray-700'}`}>
                <Eye size={11} /> Aperçu
              </button>
            </div>
          </div>

          <div className="border border-gray-200 rounded-xl overflow-hidden shadow-sm bg-white/80">
            {viewMode === 'edit' ? (
              <>
                <div className="px-4 py-2.5 border-b border-gray-100 bg-gray-50/80">
                  <Toolbar editor={editor} />
                </div>
                <div className="p-4" style={{ minHeight: '220px' }}>
                  <EditorContent editor={editor} className="tiptap text-sm text-gray-800" />
                </div>
              </>
            ) : (
              <div
                className="skill-editor-preview p-5 text-sm text-gray-700"
                style={{ minHeight: '220px' }}
                dangerouslySetInnerHTML={{ __html: htmlContent || '<p style="color:#9ca3af">Aucun contenu</p>' }}
              />
            )}
          </div>

          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-400">Injecté comme données de référence dans chaque analyse.</p>
            <span className={`text-xs tabular-nums ${charCount > 8000 ? 'text-amber-500 font-medium' : 'text-gray-400'}`}>
              {charCount.toLocaleString()} car.
            </span>
          </div>
        </div>

        <div className="flex items-center justify-between pt-1 border-t border-gray-100">
          <button onClick={onCancel} className="btn-ghost">Annuler</button>
          <button onClick={handleSave} className="btn-primary">
            <Save size={14} /> Enregistrer
          </button>
        </div>
      </div>
    </motion.div>
  );
}

/* ─── Carte d'un skill ───────────────────────────────────────────────────────── */
function SkillCard({ skill, onEdit, onDelete, onToggleActive }) {
  const [expanded, setExpanded] = useState(false);

  const html      = renderMarkdown(skill.content || '');
  const plainText = markdownToPlain(skill.content || '');
  const isLong    = plainText.length > 350;
  const active    = isActive(skill);
  const isDefault = !!skill.isDefault;
  const over      = plainText.length > BUDGET.skill;

  return (
    <motion.div layout
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.97 }}
      className={`glass-card overflow-hidden group transition-opacity ${active ? '' : 'opacity-55'}`}
    >
      <div className="flex items-start justify-between px-5 pt-5 pb-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${active ? 'bg-black' : 'bg-gray-300'}`}>
            <Zap size={15} className="text-white" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <h3 className="font-semibold text-gray-900 text-sm truncate">{skill.name}</h3>
              {isDefault && (
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-indigo-50 text-indigo-600 border border-indigo-100">
                  <Lock size={9} /> Socle
                </span>
              )}
              {!active && (
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-gray-100 text-gray-500 border border-gray-200">Inactif</span>
              )}
              <LintBadge entry={skill} kind="skill" />
            </div>
            <p className="text-[11px] text-gray-400 mt-0.5">
              {new Date(skill.createdAt || Date.now()).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}
              {' · '}<span className={over ? 'text-amber-500 font-medium' : ''}>{plainText.length.toLocaleString()} / {BUDGET.skill.toLocaleString()} car.</span>
            </p>
          </div>
        </div>
        {isDefault ? (
          <span className="text-[10px] text-gray-400 flex items-center gap-1 flex-shrink-0" title="Géré par le code (defaultSkills.js)">
            <ShieldCheck size={12} /> géré par le code
          </span>
        ) : (
          <div className="flex gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
            <button onClick={() => onToggleActive(skill)} className="btn-ghost !px-1.5 !py-1.5" title={active ? 'Désactiver (ne plus injecter)' : 'Activer'}>
              <Power size={14} className={active ? 'text-emerald-500' : 'text-gray-400'} />
            </button>
            <button onClick={() => onEdit(skill)} className="btn-ghost !px-1.5 !py-1.5" title="Modifier">
              <Edit3 size={14} />
            </button>
            <button onClick={() => onDelete(skill.id)} className="btn-ghost !px-1.5 !py-1.5 hover:!text-red-500">
              <Trash2 size={14} />
            </button>
          </div>
        )}
      </div>

      <div className={`px-5 pb-4 relative ${!expanded && isLong ? 'md-content-fade' : ''}`}>
        <div className="md-content" dangerouslySetInnerHTML={{ __html: html }} />
      </div>

      {isLong && (
        <button onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center justify-center gap-1 py-2.5 text-[11px] text-gray-400 hover:text-gray-700 hover:bg-gray-50 transition-colors border-t border-gray-100">
          {expanded ? <><ChevronUp size={12} /> Réduire</> : <><ChevronDown size={12} /> Voir tout</>}
        </button>
      )}
    </motion.div>
  );
}

/* ─── Carte d'un document de connaissance ────────────────────────────────────── */
function KnowledgeCard({ item, onEdit, onDelete, onToggleActive }) {
  const [expanded, setExpanded] = useState(false);

  const ext  = item.source === 'transcript' ? 'transcript'
    : item.source === 'manual' ? 'manual'
    : (item.name?.split('.').pop().toLowerCase() || 'txt');
  const meta = FILE_TYPES[ext] || getFileMeta(item.name);
  const Icon = meta.icon;

  const html       = renderMarkdown(item.content || '');
  const plainText  = markdownToPlain(item.content || '');
  const charCount  = plainText.length;
  const hasContent = !!item.content;
  const isLong     = charCount > 400;
  const active     = isActive(item);

  return (
    <motion.div layout
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.97 }}
      className={`glass-card overflow-hidden group transition-opacity ${active ? '' : 'opacity-55'}`}
    >
      {/* En-tête */}
      <div className="flex items-start justify-between px-5 pt-5 pb-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${meta.color}`}>
            <Icon size={15} />
          </div>
          <div className="min-w-0">
            <h3 className="font-semibold text-gray-900 text-sm truncate">{item.name}</h3>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-md uppercase tracking-wide ${meta.color}`}>
                {meta.label}
              </span>
              {hasContent && (
                <span className={`text-[11px] tabular-nums ${charCount > BUDGET.bdc ? 'text-amber-500 font-medium' : 'text-gray-400'}`}>
                  {charCount.toLocaleString()} car.
                </span>
              )}
              {item.size && !hasContent && (
                <span className="text-[11px] text-gray-400">
                  {(item.size / 1024).toFixed(1)} Ko
                </span>
              )}
              {!active && (
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-gray-100 text-gray-500 border border-gray-200">Inactif</span>
              )}
              <LintBadge entry={item} kind="bdc" />
            </div>
          </div>
        </div>
        <div className="flex gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          <button onClick={() => onToggleActive(item)} className="btn-ghost !px-1.5 !py-1.5" title={active ? 'Désactiver (ne plus injecter)' : 'Activer'}>
            <Power size={14} className={active ? 'text-emerald-500' : 'text-gray-400'} />
          </button>
          {item.source === 'manual' && (
            <button onClick={() => onEdit(item)} className="btn-ghost !px-1.5 !py-1.5" title="Modifier">
              <Edit3 size={14} />
            </button>
          )}
          <button onClick={() => onDelete(item.id)} className="btn-ghost !px-1.5 !py-1.5 hover:!text-red-500">
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {/* Contenu / warning */}
      {hasContent ? (
        <div className={`px-5 pb-4 relative ${!expanded && isLong ? 'md-content-fade' : ''}`}>
          <div className="md-content" dangerouslySetInnerHTML={{ __html: html }} />
        </div>
      ) : (
        <div className="px-5 pb-4">
          <div className="bg-amber-50 border border-amber-100 rounded-xl px-4 py-3 flex items-start gap-2">
            <FileWarning size={14} className="text-amber-500 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-amber-700 leading-relaxed">
              {item.warning || 'Contenu non extrait — fichier référencé mais non lisible par l\'agent.'}
            </p>
          </div>
        </div>
      )}

      {hasContent && isLong && (
        <button onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center justify-center gap-1 py-2.5 text-[11px] text-gray-400 hover:text-gray-700 hover:bg-gray-50 transition-colors border-t border-gray-100">
          {expanded ? <><ChevronUp size={12} /> Réduire</> : <><ChevronDown size={12} /> Voir tout</>}
        </button>
      )}
    </motion.div>
  );
}

/* ─── Transcripteur vidéo (Google Drive ou fichier local) ────────────────────── */
// Utilise le proxy local → Groq Whisper (gratuit, 2h/jour, français natif)
// Limite Groq : 25 Mo par fichier audio/vidéo
const GDRIVE_VIDEOS = [
  { label: 'video n°1 — Présentation MAJ', filename: 'video n°1 présentation MAJ.webm', url: null },
  { label: 'video n°2 — Comment faire une MAJ média', filename: 'video n°2 Mise à jour d\'un article média.webm', url: null },
  { label: 'video n°3 — Mettre le texte à J-2', filename: 'video n°3 mettre à J-2.webm', url: 'https://drive.google.com/file/d/1TXd3Z609YPX0JUaNkc4Q_XOwUmwORVxK/view?usp=sharing' },
  { label: 'video n°4 — Vérifier la catégorie', filename: 'video n°4 cocher la bonne catégorie.webm', url: 'https://drive.google.com/file/d/1dBSUPpuBCByq9tgAj91YbLrkiL0bDVAT/view?usp=sharing' },
  { label: 'video n°5 — MAJ du TAG "MAJ par ..."', filename: 'video n°5 TAG MAJ.webm', url: 'https://drive.google.com/file/d/1ZbrX8FA65uaSSwP_mDSzAW5tNCJm2_JE/view?usp=sharing' },
  { label: 'video n°6 — Choix et insertion nouveau paragraphe', filename: 'video n°6 Choix et insertion nouveau paragraphe.webm', url: null },
  { label: 'video n°7 — Lecture et correction patterns IA', filename: 'video n°7 lecture et correction patterns.webm', url: null },
  { label: 'video n°8 — Générer une image Midjourney', filename: 'video n°8 comment générer une image via Midjourney.webm', url: null },
  { label: 'video n°9 — Rechercher les bonnes vidéos', filename: 'video n°9 Rechercher les bonnes vidéos.webm', url: null },
  { label: 'video n°10 — Insérer des tarifs en HTML sur WP', filename: 'video n°10 Insérer des tarifs en html sur Wp.webm', url: null },
  { label: 'video n°11 — Modifier l\'auteur (admin)', filename: 'video n°11 Modifier l\'auteur (admin).webm', url: null },
  { label: 'video n°12 — Modifier l\'image à la une', filename: 'video n°12 modifier l\'image à la une suivant le contenu.webm', url: null },
  { label: 'video n°13 — URL/titre déphasés → demander manager', filename: 'video n°13 demander au manager pour modifier slug ou pas.webm', url: null },
  { label: 'video n°14 — Corriger un lien hypertexte', filename: 'video n°14 mettre le bon lien.webm', url: null },
  { label: 'video n°15 — Vidéo YouTube récente', filename: 'video n°15 Good video youtube.webm', url: null },
  { label: 'video n°16 — Intégrer une vidéo en anglais', filename: 'video n°16 intégration et introduction d\'une vidéo en anglais.webm', url: null },
  { label: 'Tuto — Correction image Gemini', filename: 'Tuto correction image générée sur Gemini.webm', url: null },
  { label: 'video n°19 - présentation MAJ down&stream', filename: 'video n°19 présentation MAJ down&stream.webm', url: null },
  { label: 'video n°20 - format titre', filename: 'video n°20 format titre.webm', url: null },
  { label: 'video n°21 - url du site', filename: 'video n°21 url du site.webm', url: null },
  { label: 'video n°22 - image à la une', filename: 'video n°22 image à la une.webm', url: null },
  { label: 'video n°23 - changement de titre', filename: 'video n°23 changement de titre.webm', url: null },
  { label: 'video n°24 - liens internes des sites du même type', filename: 'video n°24 liens internes des sites du même type.webm', url: null },
  { label: 'video n°25 - captures', filename: 'video n°25 captures.webm', url: null },
  { label: 'video n°26 - F.A.R', filename: 'video n°26 F.A.R.webm', url: null },
];

function VideoTranscriber({ groqKey, onSaveTranscript, knowledge = [] }) {
  const [mode, setMode]             = useState('list');  // 'list' | 'file'
  const [customName, setCustomName] = useState('');
  const [localFile, setLocalFile]   = useState(null);
  const [transcribing, setTranscribing] = useState(false);
  const [progress, setProgress]     = useState('');
  const [result, setResult]         = useState(null);
  const [error, setError]           = useState('');
  const [language, setLanguage]     = useState('fr');
  const [selectedVideo, setSelectedVideo] = useState(null);

  // Noms des vidéos déjà transcrites en base de connaissances
  const transcribedLabels = new Set(
    knowledge.filter(k => k.source === 'transcript').map(k => k.name)
  );

  const transcribeFile = async () => {
    if (!localFile) return;
    setTranscribing(true); setError(''); setResult(null);
    setProgress('Envoi du fichier au proxy...');
    try {
      const formData = new FormData();
      formData.append('audio', localFile);
      formData.append('groqKey', groqKey);
      formData.append('language', language);
      const resp = await axios.post('/api/transcribe/file', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 180000,
        onUploadProgress: (e) => {
          if (e.total) setProgress(`Upload ${Math.round(e.loaded / e.total * 100)}%...`);
        },
      });
      const name = customName || localFile.name.replace(/\.[^.]+$/, '');
      setResult({ transcript: resp.data.transcript, chars: resp.data.chars, mb: resp.data.mb, name });
      setProgress('');
    } catch (e) {
      setError(e.response?.data?.error || e.message);
      setProgress('');
    }
    setTranscribing(false);
  };

  const handleSave = () => {
    if (!result) return;
    onSaveTranscript({
      name: result.name || 'Transcription vidéo',
      content: `## Transcription : ${result.name || 'Vidéo'}\n\n${result.transcript}`,
    });
    setResult(null);
    setLocalFile(null);
    setSelectedVideo(null);
    setCustomName('');
  };

  if (!groqKey) {
    return (
      <div className="glass-card p-5 border-2 border-dashed border-amber-200 bg-amber-50/30">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 bg-amber-100 rounded-xl flex items-center justify-center flex-shrink-0">
            <Mic size={15} className="text-amber-600" />
          </div>
          <div>
            <p className="text-sm font-semibold text-amber-800">Transcription vidéo — Clé Groq requise</p>
            <p className="text-xs text-amber-700 mt-1 leading-relaxed">
              Créez un compte gratuit sur{' '}
              <a href="https://console.groq.com" target="_blank" rel="noopener noreferrer" className="underline font-medium">console.groq.com</a>
              , générez une clé API (gratuit, 2h de transcription/jour),
              puis renseignez-la dans <strong>Paramètres → Groq Whisper</strong>.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass-card overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: '#f55036' }}>
            <Mic size={13} className="text-white" />
          </div>
          <div>
            <h3 className="font-semibold text-gray-900 text-sm">Transcrire une vidéo → Base de connaissances</h3>
            <p className="text-[11px] text-gray-400">Groq Whisper · gratuit · français · 25 Mo max</p>
          </div>
        </div>
        {/* Onglets */}
        <div className="flex items-center gap-0.5 bg-gray-100 rounded-lg p-0.5">
          {[
            { id: 'list', label: 'Mes vidéos', icon: MonitorPlay },
            { id: 'file', label: 'Uploader',   icon: Upload },
          ].map(({ id, label, icon: Icon }) => (
            <button key={id} type="button" onClick={() => { setMode(id); setResult(null); setError(''); }}
              className={`flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md transition-all ${
                mode === id ? 'bg-white shadow-sm text-gray-800 font-medium' : 'text-gray-500 hover:text-gray-700'
              }`}>
              <Icon size={11} /> {label}
            </button>
          ))}
        </div>
      </div>

      <div className="p-6 space-y-4">

        {/* ── Onglet : liste des vidéos ── */}
        {mode === 'list' && (
          <div className="space-y-2">
            <p className="text-xs text-gray-500 mb-3">
              Téléchargez la vidéo depuis votre Drive, puis utilisez l'onglet <strong>Uploader</strong> pour la transcrire.
            </p>
            <div className="max-h-64 overflow-y-auto space-y-1 pr-1">
              {GDRIVE_VIDEOS.map((v, i) => {
                const isDone = transcribedLabels.has(v.label);
                return (
                  <button key={i} type="button"
                    onClick={() => {
                      if (isDone) return;
                      setSelectedVideo(v);
                      setCustomName(v.label);
                      setMode('file');
                    }}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-left text-xs transition-all border ${
                      isDone
                        ? 'border-green-200 bg-green-50/60 cursor-default'
                        : selectedVideo?.filename === v.filename
                          ? 'border-blue-200 bg-blue-50'
                          : 'border-transparent hover:bg-gray-50'
                    }`}>
                    <div className={`w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0 text-[10px] font-bold ${
                      isDone ? 'bg-green-100 text-green-600' : 'bg-gray-200 text-gray-500'
                    }`}>
                      {isDone ? <CheckCircle2 size={14} className="shrink-0" /> : i + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`font-medium truncate ${isDone ? 'text-green-700' : 'text-gray-800'}`}>{v.label}</p>
                      <p className="text-[10px] text-gray-400">{v.filename}</p>
                    </div>
                    {isDone ? (
                      <CheckCircle2 size={14} className="text-green-500 flex-shrink-0" />
                    ) : (
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500 flex-shrink-0">
                        Upload
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Onglet : upload fichier local ── */}
        {mode === 'file' && (
          <div className="space-y-3">
            <div
              className={`border-2 border-dashed rounded-xl px-6 py-7 text-center cursor-pointer transition-all ${
                localFile ? 'border-green-300 bg-green-50/30' : 'border-gray-200 hover:border-gray-400'
              }`}
              onClick={() => document.getElementById('video-file-input').click()}
            >
              <input
                id="video-file-input"
                type="file"
                className="hidden"
                accept=".webm,.mp4,.mp3,.wav,.ogg,.m4a,.flac"
                onChange={e => { if (e.target.files[0]) setLocalFile(e.target.files[0]); }}
              />
              {localFile ? (
                <div className="space-y-1">
                  <CheckCircle2 size={24} className="mx-auto text-green-500" />
                  <p className="text-sm font-medium text-gray-800">{localFile.name}</p>
                  <p className="text-xs text-gray-400">{(localFile.size / 1024 / 1024).toFixed(1)} Mo</p>
                  {localFile.size > 25 * 1024 * 1024 && (
                    <p className="text-xs text-red-500 font-medium"><AlertTriangle size={12} className="inline text-red-500 shrink-0" /> Fichier trop grand — 25 Mo max pour Groq</p>
                  )}
                </div>
              ) : (
                <>
                  <Upload size={20} className="mx-auto text-gray-400 mb-2" />
                  <p className="text-sm text-gray-600">Cliquez pour sélectionner le fichier vidéo</p>
                  <p className="text-xs text-gray-400 mt-1">.webm · .mp4 · .mp3 · .wav · .ogg · .m4a · .flac — 25 Mo max</p>
                </>
              )}
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Nom dans la base de connaissances</label>
              <input
                type="text"
                value={customName}
                onChange={e => setCustomName(e.target.value)}
                placeholder="ex: video n°3 — Mettre le texte à J-2"
                className="input-glass"
              />
            </div>
          </div>
        )}

        {/* Langue */}
        <div className="flex items-center gap-3">
          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">Langue</label>
          <select value={language} onChange={e => setLanguage(e.target.value)}
            className="input-glass !py-1.5 text-xs w-auto">
            <option value="fr">Français</option>
            <option value="en">Anglais</option>
            <option value="auto">Détection auto</option>
          </select>
        </div>

        {/* Erreur */}
        {error && (
          <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3 flex items-start gap-2">
            <AlertTriangle size={14} className="text-red-500 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-red-700">{error}</p>
          </div>
        )}

        {/* Progression */}
        {transcribing && (
          <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 flex items-center gap-3">
            <Loader2 size={15} className="animate-spin text-blue-500 flex-shrink-0" />
            <p className="text-xs text-blue-700">{progress || 'Transcription en cours...'}</p>
          </div>
        )}

        {/* Résultat */}
        {result && !transcribing && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
            className="bg-green-50 border border-green-100 rounded-xl overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-2.5 bg-green-100/60 border-b border-green-100">
              <CheckCircle2 size={14} className="text-green-600" />
              <p className="text-xs font-semibold text-green-800 flex-1">
                Transcription réussie — {result.chars?.toLocaleString()} car. ({result.mb} Mo)
              </p>
              <button onClick={() => setResult(null)} className="text-green-400 hover:text-green-700">
                <X size={14} />
              </button>
            </div>
            <div className="px-4 py-3 max-h-40 overflow-y-auto">
              <p className="text-xs text-gray-700 leading-relaxed whitespace-pre-wrap">{result.transcript}</p>
            </div>
          </motion.div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-3 pt-1">
          {!result ? (
            <button
              onClick={transcribeFile}
              disabled={transcribing || mode !== 'file' || !localFile}
              className="btn-primary disabled:opacity-50"
            >
              {transcribing
                ? <><Loader2 size={14} className="animate-spin" /> Transcription...</>
                : <><Mic size={14} /> Transcrire</>
              }
            </button>
          ) : (
            <button onClick={handleSave} className="btn-primary">
              <Database size={14} /> Ajouter à la base de connaissances
            </button>
          )}
          <p className="text-[11px] text-gray-400">
            Transcription locale via Groq · aucune vidéo stockée
          </p>
        </div>
      </div>
    </motion.div>
  );
}

/* ─── Page Skills ────────────────────────────────────────────────────────────── */
export default function Skills() {
  const dispatch      = useDispatch();
  const skills        = useSelector(s => s.skills.list);
  const knowledge     = useSelector(s => s.knowledge.list);
  const firebaseReady = useSelector(s => s.settings.firebaseReady);
  const groqKey = useSelector(s => s.settings.groqKey);

  const [editingSkill,     setEditingSkill]     = useState(null);
  const [showNewSkill,     setShowNewSkill]      = useState(false);
  const [editingKnowledge, setEditingKnowledge]  = useState(null);
  const [showNewKnowledge, setShowNewKnowledge]  = useState(false);
  const [importing,        setImporting]         = useState(false); // état de chargement import
  const [showPreview,      setShowPreview]       = useState(false); // modale aperçu du prompt injecté
  const jsonInputRef = useRef(null);                                // input caché import JSON

  useEffect(() => { persist(STORAGE_KEYS.knowledge, knowledge); }, [knowledge]);
  useEffect(() => { persist(STORAGE_KEYS.skills,    skills);    }, [skills]);

  /* ── Firebase helpers ── */
  const fbSaveKnowledge = async (item, dispatchFn) => {
    if (firebaseReady) {
      try {
        const id = await saveKnowledge(item);
        dispatch(dispatchFn({ ...item, id }));
      } catch {
        dispatch(dispatchFn({ ...item, id: Date.now().toString() }));
      }
    } else {
      dispatch(dispatchFn({ ...item, id: item.id || Date.now().toString() }));
    }
  };

  /* ── Import .md → skill ── */
  const onDropSkill = useCallback(async (files) => {
    for (const file of files) {
      if (!file.name.endsWith('.md')) { toast.error(`${file.name} — fichier .md requis`); continue; }
      const content = await file.text();
      const skill   = { name: file.name.replace('.md', ''), content, createdAt: Date.now() };
      if (firebaseReady) {
        try { const id = await saveSkill(skill); dispatch(addSkill({ ...skill, id })); }
        catch { dispatch(addSkill({ ...skill, id: Date.now().toString() })); }
      } else {
        dispatch(addSkill({ ...skill, id: Date.now().toString() }));
      }
      toast.success(`Skill "${skill.name}" importé !`);
    }
  }, [dispatch, firebaseReady]);

  /* ── Import fichiers → knowledge base ── */
  const onDropKnowledge = useCallback(async (acceptedFiles) => {
    if (acceptedFiles.length === 0) return;
    setImporting(true);

    for (const file of acceptedFiles) {
      const loadingToast = toast.loading(`Extraction de "${file.name}"…`);
      try {
        const { content, warning } = await extractFileContent(file);

        const item = {
          name:      file.name,
          size:      file.size,
          type:      file.type,
          source:    'file',
          isHtml:    false,
          content:   content || null,
          warning:   warning || null,
          createdAt: Date.now(),
        };

        await fbSaveKnowledge(item, addKnowledge);
        toast.dismiss(loadingToast);

        if (content) {
          toast.success(`"${file.name}" ajouté — ${content.length.toLocaleString()} car.`);
        } else if (warning) {
          toast(warning, { icon: <AlertTriangle size={18} className="text-amber-500" />, duration: 8000 });
        }
      } catch (e) {
        toast.dismiss(loadingToast);
        toast.error(`Erreur "${file.name}" : ${e.message}`);
      }
    }
    setImporting(false);
  }, [dispatch, firebaseReady]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Dropzones ── */
  const { getRootProps: getSkillProps, getInputProps: getSkillInputProps, isDragActive: isSkillDrag } = useDropzone({
    onDrop: onDropSkill,
    accept: { 'text/markdown': ['.md'], 'text/plain': ['.md'] },
    multiple: true,
  });

  const { getRootProps: getKnowProps, getInputProps: getKnowInputProps, isDragActive: isKnowDrag } = useDropzone({
    onDrop: onDropKnowledge,
    accept: {
      'text/plain':       ['.txt', '.log', '.yaml', '.yml'],
      'text/markdown':    ['.md'],
      'text/html':        ['.html', '.htm'],
      'text/csv':         ['.csv'],
      'text/xml':         ['.xml'],
      'application/json': ['.json'],
      'application/rtf':  ['.rtf'],
      'application/pdf':  ['.pdf'],
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':       ['.xlsx'],
      'application/vnd.ms-excel':                                                 ['.xls'],
      'application/vnd.oasis.opendocument.spreadsheet':                           ['.ods'],
    },
    multiple: true,
  });

  /* ── Handlers Skills ── */
  const handleSaveSkill = async (skill) => {
    if (firebaseReady) {
      try {
        const id = await saveSkill(skill);
        if (skill.id) dispatch(updateSkill({ ...skill, id }));
        else          dispatch(addSkill({ ...skill, id }));
      } catch {
        if (skill.id) dispatch(updateSkill(skill));
        else          dispatch(addSkill({ ...skill, id: Date.now().toString() }));
      }
    } else {
      if (skill.id) dispatch(updateSkill(skill));
      else          dispatch(addSkill({ ...skill, id: Date.now().toString() }));
    }
    toast.success('Skill enregistré !');
    setEditingSkill(null);
    setShowNewSkill(false);
  };

  const handleDeleteSkill = async (id) => {
    if (firebaseReady) { try { await deleteSkill(id); } catch {} }
    dispatch(removeSkill(id));
    toast.success('Skill supprimé');
  };

  /* ── Handlers Knowledge ── */
  const handleSaveKnowledge = async (item) => {
    if (item.id) {
      // Mise à jour
      if (firebaseReady) { try { await saveKnowledge(item); } catch {} }
      dispatch(updateKnowledge(item));
      toast.success('Document mis à jour !');
    } else {
      // Création
      await fbSaveKnowledge(item, addKnowledge);
      toast.success('Document ajouté !');
    }
    setEditingKnowledge(null);
    setShowNewKnowledge(false);
  };

  const handleDeleteKnowledge = async (id) => {
    if (firebaseReady) { try { await deleteKnowledge(id); } catch {} }
    dispatch(removeKnowledge(id));
    toast.success('Document supprimé');
  };

  /* ── Sauvegarde d'une transcription vidéo → knowledge base ── */
  const handleSaveTranscript = async ({ name, content }) => {
    const item = {
      name:      name,
      size:      content.length,
      type:      'text/plain',
      source:    'transcript',
      isHtml:    false,
      content,
      warning:   null,
      createdAt: Date.now(),
    };
    await fbSaveKnowledge(item, addKnowledge);
    toast.success(`Transcription "${name}" ajoutée !`);
  };

  /* ── Activer / désactiver une entrée (contrôle ce qui est injecté) ── */
  const handleToggleSkill = async (skill) => {
    const next = { ...skill, active: skill.active === false };
    if (firebaseReady) { try { await saveSkill(next); } catch {} }
    dispatch(updateSkill(next));
  };
  const handleToggleKnowledge = async (item) => {
    const next = { ...item, active: item.active === false };
    if (firebaseReady) { try { await saveKnowledge(next); } catch {} }
    dispatch(updateKnowledge(next));
  };

  /* ── Export JSON (sauvegarde / transfert) ── */
  const handleExport = () => {
    const data = {
      version: 1,
      exportedAt: new Date().toISOString(),
      skills: skills.filter(s => !s.isDefault),
      knowledge,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tonton-skills-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Export téléchargé');
  };

  /* ── Import JSON (remplace tout, socle conservé, sauvegarde auto avant) ── */
  const applyImport = async (data) => {
    setImporting(true);
    try {
      handleExport(); // sauvegarde de secours de l'état actuel
      if (firebaseReady) {
        for (const s of skills) { if (!s.isDefault) { try { await deleteSkill(s.id); } catch {} } }
        for (const k of knowledge) { try { await deleteKnowledge(k.id); } catch {} }
      }
      const savedSkills = [];
      for (const s of (data.skills || [])) {
        const entry = { name: s.name || 'Sans nom', content: s.content || '', active: s.active !== false, createdAt: s.createdAt || Date.now() };
        let id = s.id;
        if (firebaseReady) { try { id = await saveSkill(entry); } catch { id = id || Date.now().toString(); } }
        else id = id || Date.now().toString();
        savedSkills.push({ ...entry, id });
      }
      const savedKnowledge = [];
      for (const k of (data.knowledge || [])) {
        const entry = { name: k.name || 'Sans nom', content: k.content || '', source: k.source || 'manual', isHtml: !!k.isHtml, active: k.active !== false, size: (k.content || '').length, createdAt: k.createdAt || Date.now() };
        let id = k.id;
        if (firebaseReady) { try { id = await saveKnowledge(entry); } catch { id = id || Date.now().toString(); } }
        else id = id || Date.now().toString();
        savedKnowledge.push({ ...entry, id });
      }
      dispatch(setSkills(savedSkills));       // le slice re-fusionne le socle
      dispatch(setKnowledge(savedKnowledge));
      toast.success(`Import terminé — ${savedSkills.length} skills, ${savedKnowledge.length} BDC`);
    } catch (e) {
      toast.error('Import échoué : ' + e.message);
    } finally {
      setImporting(false);
    }
  };

  const handleImportFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    let data;
    try { data = JSON.parse(await file.text()); }
    catch { toast.error('Fichier JSON invalide'); return; }
    if (!data || (!Array.isArray(data.skills) && !Array.isArray(data.knowledge))) {
      toast.error('Format attendu : { "skills": [], "knowledge": [] }'); return;
    }
    const nS = (data.skills || []).length, nK = (data.knowledge || []).length;
    if (!window.confirm(`Importer ${nS} skill(s) et ${nK} document(s) ?\n\nCela REMPLACE tout le contenu actuel (le socle « Skills par Tonton AI » est conservé). Une sauvegarde JSON de l'existant sera téléchargée d'abord.`)) return;
    await applyImport(data);
  };

  /* ── Budget de contexte + aperçu du prompt injecté ── */
  const skillBudget = contextBudget(skills, 'skill');
  const bdcBudget   = contextBudget(knowledge, 'bdc');
  const totalInjected = skillBudget.total + bdcBudget.total;
  const skillState  = budgetLevel(skillBudget.total);
  const buildPreview = () => {
    const aSkills = skills.filter(isActive).filter(s => markdownToPlain(s.content).trim());
    const aBdc    = knowledge.filter(isActive).filter(k => markdownToPlain(k.content).trim());
    let out = '';
    if (aSkills.length) {
      out += `## SKILLS ACTIFS — RÈGLES D'ÉCRITURE OBLIGATOIRES\n\n`;
      aSkills.forEach((s, i) => { out += `### SKILL ${i + 1} — ${s.name}\n${markdownToPlain(s.content)}\n\n`; });
    }
    if (aBdc.length) {
      out += `## BASE DE CONNAISSANCES — ${aBdc.length} document(s)\n\n`;
      aBdc.forEach((k, i) => { out += `### DOCUMENT ${i + 1} — ${k.name}\n${markdownToPlain(k.content)}\n\n`; });
    }
    return out.trim() || 'Aucune entrée active — rien ne sera injecté dans le prompt.';
  };

  /* ── Formats supportés pour l'affichage ── */
  const SUPPORTED_EXTS = [
    { ext: 'txt',  label: '.txt',  color: 'bg-gray-100 text-gray-600'    },
    { ext: 'md',   label: '.md',   color: 'bg-purple-50 text-purple-600' },
    { ext: 'html', label: '.html', color: 'bg-orange-50 text-orange-600' },
    { ext: 'docx', label: '.docx', color: 'bg-blue-50 text-blue-600'     },
    { ext: 'xlsx', label: '.xlsx', color: 'bg-emerald-50 text-emerald-600'},
    { ext: 'pdf',  label: '.pdf',  color: 'bg-red-50 text-red-500'       },
    { ext: 'csv',  label: '.csv',  color: 'bg-green-50 text-green-600'   },
    { ext: 'json', label: '.json', color: 'bg-yellow-50 text-yellow-600' },
    { ext: 'rtf',  label: '.rtf',  color: 'bg-gray-100 text-gray-600'    },
    { ext: 'xml',  label: '.xml',  color: 'bg-yellow-50 text-yellow-700' },
  ];

  /* ── Rendu ── */
  return (
    <div className="space-y-10 animate-fade-in">

      <input ref={jsonInputRef} type="file" accept="application/json,.json" className="hidden" onChange={handleImportFile} />

      {/* ══════════════════ BARRE BUDGET + OUTILS ══════════════════ */}
      <div className="glass-card px-5 py-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${skillState === 'ok' ? 'bg-emerald-500' : skillState === 'warn' ? 'bg-amber-500' : 'bg-red-500'}`}>
            <Gauge size={16} className="text-white" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-900">Contexte injecté à chaque MAJ</p>
            <p className="text-[11px] text-gray-400">
              {skillBudget.activeCount} skill(s) actif(s) · {bdcBudget.activeCount} BDC active(s)
              {skillBudget.perEntryOver > 0 && ` · ${skillBudget.perEntryOver} skill(s) hors budget`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="hidden sm:block w-40">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] text-gray-400">Skills</span>
              <span className={`text-[10px] font-semibold tabular-nums ${skillState === 'ok' ? 'text-emerald-600' : skillState === 'warn' ? 'text-amber-500' : 'text-red-500'}`}>
                {skillBudget.total.toLocaleString()} / {BUDGET.skillsTotal.toLocaleString()}
              </span>
            </div>
            <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${skillState === 'ok' ? 'bg-emerald-500' : skillState === 'warn' ? 'bg-amber-500' : 'bg-red-500'}`}
                style={{ width: `${Math.min(100, (skillBudget.total / BUDGET.skillsTotal) * 100)}%` }}
              />
            </div>
            <p className="text-[10px] text-gray-400 mt-1 tabular-nums">Total injecté : {totalInjected.toLocaleString()} car.</p>
          </div>
          <div className="flex items-center gap-1.5">
            <button onClick={() => setShowPreview(true)} className="btn-ghost text-sm flex items-center gap-1.5" title="Voir ce que TONTON reçoit réellement">
              <Eye size={14} /> <span className="hidden md:inline">Aperçu prompt</span>
            </button>
            <button onClick={handleExport} className="btn-ghost text-sm flex items-center gap-1.5" title="Télécharger un JSON de sauvegarde">
              <Download size={14} /> <span className="hidden md:inline">Export</span>
            </button>
            <button onClick={() => jsonInputRef.current?.click()} disabled={importing} className="btn-ghost text-sm flex items-center gap-1.5 disabled:opacity-50" title="Importer un JSON (remplace tout, socle conservé)">
              <FileJson size={14} /> <span className="hidden md:inline">Import</span>
            </button>
          </div>
        </div>
      </div>

      {/* ══════════════════ SECTION SKILLS ══════════════════ */}
      <section className="space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Skills IA</h1>
            <p className="text-sm text-gray-500 mt-1">
              Instructions injectées dans le prompt système de l'agent à chaque analyse
            </p>
          </div>
          <button onClick={() => { setShowNewSkill(true); setEditingSkill(null); }} className="btn-primary">
            <Plus size={15} /> Nouveau skill
          </button>
        </div>

        {/* Dropzone .md */}
        <motion.div
          {...getSkillProps()}
          whileHover={{ scale: 1.003 }}
          className={`glass-card px-6 py-7 border-2 border-dashed cursor-pointer transition-all duration-200 text-center ${
            isSkillDrag ? 'border-black bg-black/5' : 'border-gray-200 hover:border-gray-400'
          }`}
        >
          <input {...getSkillInputProps()} />
          <motion.div animate={isSkillDrag ? { scale: 1.08 } : { scale: 1 }} className="flex flex-col items-center gap-3">
            <div className={`w-11 h-11 rounded-2xl flex items-center justify-center transition-colors ${isSkillDrag ? 'bg-black' : 'bg-gray-100'}`}>
              <Upload size={18} className={isSkillDrag ? 'text-white' : 'text-gray-400'} />
            </div>
            <div>
              <p className="text-sm font-medium text-gray-700">
                {isSkillDrag ? 'Déposez ici' : 'Importez un skill depuis un fichier .md'}
              </p>
              <p className="text-xs text-gray-400 mt-1">ou cliquez pour sélectionner un fichier Markdown</p>
            </div>
          </motion.div>
        </motion.div>

        <AnimatePresence>
          {(showNewSkill || editingSkill) && (
            <SkillEditor
              key={editingSkill?.id || 'new'}
              skill={editingSkill || { name: '', content: '' }}
              onSave={handleSaveSkill}
              onCancel={() => { setEditingSkill(null); setShowNewSkill(false); }}
            />
          )}
        </AnimatePresence>

        {skills.length > 0 ? (
          <motion.div layout className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <AnimatePresence>
              {skills.map(skill => (
                <SkillCard
                  key={skill.id}
                  skill={skill}
                  onEdit={(s) => { setEditingSkill(s); setShowNewSkill(false); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                  onDelete={handleDeleteSkill}
                  onToggleActive={handleToggleSkill}
                />
              ))}
            </AnimatePresence>
          </motion.div>
        ) : !showNewSkill && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center py-12 text-gray-400">
            <Zap size={36} className="mx-auto mb-3 opacity-20" />
            <p className="text-sm font-medium">Aucun skill chargé</p>
            <p className="text-xs mt-1">Importez un fichier .md ou créez un skill manuellement</p>
          </motion.div>
        )}
      </section>

      {/* ══════════════════ SECTION BASE DE CONNAISSANCES ══════════════════ */}
      <section className="space-y-5">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 bg-gray-900 rounded-xl flex items-center justify-center">
                <Database size={14} className="text-white" />
              </div>
              <h2 className="text-xl font-bold text-gray-900">Base de connaissances</h2>
            </div>
            <p className="text-sm text-gray-500 mt-1 ml-[42px]">
              Documents injectés comme contexte de référence dans chaque analyse
            </p>
          </div>
          <div className="flex items-center gap-2">
            {knowledge.length > 0 && (
              <span className="text-xs font-medium text-gray-500 bg-gray-100 rounded-full px-3 py-1">
                {knowledge.filter(k => k.content).length}/{knowledge.length} lisibles
              </span>
            )}
            <button
              onClick={() => { setShowNewKnowledge(true); setEditingKnowledge(null); }}
              className="btn-ghost flex items-center gap-2 text-sm"
            >
              <PenLine size={14} /> Saisie manuelle
            </button>
          </div>
        </div>

        {/* Éditeur manuel */}
        <AnimatePresence>
          {(showNewKnowledge || editingKnowledge) && (
            <KnowledgeEditor
              key={editingKnowledge?.id || 'new-knowledge'}
              item={editingKnowledge || null}
              onSave={handleSaveKnowledge}
              onCancel={() => { setEditingKnowledge(null); setShowNewKnowledge(false); }}
            />
          )}
        </AnimatePresence>

        {/* Transcripteur vidéo */}
        <VideoTranscriber
          groqKey={groqKey}
          onSaveTranscript={handleSaveTranscript}
          knowledge={knowledge}
        />

        {/* Dropzone import */}
        <motion.div
          {...getKnowProps()}
          whileHover={{ scale: 1.003 }}
          className={`glass-card px-6 py-7 border-2 border-dashed cursor-pointer transition-all duration-200 text-center ${
            isKnowDrag ? 'border-black bg-black/5' : importing ? 'border-blue-300 bg-blue-50/30' : 'border-gray-200 hover:border-gray-400'
          }`}
        >
          <input {...getKnowInputProps()} />
          <motion.div animate={isKnowDrag ? { scale: 1.08 } : { scale: 1 }} className="flex flex-col items-center gap-3">
            <div className={`w-11 h-11 rounded-2xl flex items-center justify-center transition-colors ${isKnowDrag ? 'bg-black' : importing ? 'bg-blue-100' : 'bg-gray-100'}`}>
              {importing
                ? <Loader2 size={18} className="text-blue-500 animate-spin" />
                : <BookOpen size={18} className={isKnowDrag ? 'text-white' : 'text-gray-400'} />
              }
            </div>
            <div>
              <p className="text-sm font-medium text-gray-700">
                {importing ? 'Extraction en cours…'
                  : isKnowDrag ? 'Déposez les fichiers ici'
                  : 'Ajoutez des documents de référence'}
              </p>
              <p className="text-xs text-gray-400 mt-1">
                Glissez-déposez ou cliquez — extraction automatique du texte
              </p>
            </div>
            {/* Badges formats */}
            <div className="flex items-center gap-1.5 flex-wrap justify-center mt-1">
              {SUPPORTED_EXTS.map(f => (
                <span key={f.ext} className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${f.color}`}>
                  {f.label}
                </span>
              ))}
            </div>
          </motion.div>
        </motion.div>

        {/* Grille knowledge */}
        {knowledge.length > 0 ? (
          <motion.div layout className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <AnimatePresence>
              {knowledge.map(item => (
                <KnowledgeCard
                  key={item.id}
                  item={item}
                  onEdit={(k) => { setEditingKnowledge(k); setShowNewKnowledge(false); }}
                  onDelete={handleDeleteKnowledge}
                  onToggleActive={handleToggleKnowledge}
                />
              ))}
            </AnimatePresence>
          </motion.div>
        ) : !showNewKnowledge && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center py-12 text-gray-400">
            <Database size={36} className="mx-auto mb-3 opacity-20" />
            <p className="text-sm font-medium">Aucun document de référence</p>
            <p className="text-xs mt-1 max-w-sm mx-auto">
              Importez vos process, checklists, tarifs ou toute base de données —<br />
              ou saisissez directement avec l'éditeur formaté
            </p>
          </motion.div>
        )}
      </section>

      {/* ══════════════════ MODALE — APERÇU DU PROMPT INJECTÉ ══════════════════ */}
      <AnimatePresence>
        {showPreview && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => setShowPreview(false)}
          >
            <motion.div
              initial={{ scale: 0.97, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.97, opacity: 0 }}
              className="glass-card max-w-3xl w-full max-h-[85vh] flex flex-col overflow-hidden"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
                <div className="flex items-center gap-2.5">
                  <div className="w-7 h-7 bg-black rounded-lg flex items-center justify-center">
                    <Eye size={13} className="text-white" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900 text-sm">Aperçu du prompt injecté</h3>
                    <p className="text-[11px] text-gray-400">
                      Ce que TONTON reçoit réellement · {totalInjected.toLocaleString()} caractères
                    </p>
                  </div>
                </div>
                <button onClick={() => setShowPreview(false)} className="btn-ghost !px-1.5 !py-1.5"><X size={16} /></button>
              </div>
              <pre className="p-5 text-[11px] leading-relaxed text-gray-700 whitespace-pre-wrap overflow-y-auto font-mono">
                {buildPreview()}
              </pre>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
