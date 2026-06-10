import { useState, useEffect, useRef, useCallback } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import toast from 'react-hot-toast';
import {
  Bug, Plus, X, Send, Paperclip,
  CheckCircle2, RefreshCw, ArrowUpRight, MessageSquare,
  Search, User, Calendar, Link2, FileText, Film, FileImage, File,
  ZoomIn, ZoomOut, Download, RotateCcw, ChevronLeft, ChevronRight,
  ChevronDown, AtSign, LayoutList, LayoutGrid, FlaskConical, MoveRight,
  GripVertical, Inbox,
} from 'lucide-react';
import { addTicket, updateTicket, setTickets } from '../store/slices/ticketsSlice';
import {
  getTickets, createTicket, updateTicketDoc, subscribeToComments, addComment,
  uploadTicketFile, updateCommentAttachments, createNotification,
} from '../services/firebase';
import { AccountAvatar } from '../components/account/MonComptePanel';
import tracker from '../services/activityTracker';

// ─── Constantes ───────────────────────────────────────────────────────────────

const CATEGORIES = {
  bug_app:       { label: '🐛 Bug application',      color: 'bg-red-100 text-red-700' },
  article_issue: { label: '📄 Problème article/MAJ', color: 'bg-orange-100 text-orange-700' },
  agent_issue:   { label: '🤖 Problème agent IA',    color: 'bg-purple-100 text-purple-700' },
  improvement:   { label: '💡 Demande amélioration', color: 'bg-blue-100 text-blue-700' },
  other:         { label: '❓ Autre',                color: 'bg-gray-100 text-gray-600' },
};

const PRIORITIES = {
  urgent:  { label: '🔴 Urgent',  color: 'bg-red-100 text-red-700',       border: 'border-l-red-500' },
  haute:   { label: '🟠 Haute',   color: 'bg-orange-100 text-orange-700', border: 'border-l-orange-400' },
  normale: { label: '🟡 Normale', color: 'bg-yellow-100 text-yellow-700', border: 'border-l-yellow-400' },
  basse:   { label: '⚪ Basse',   color: 'bg-gray-100 text-gray-500',     border: 'border-l-gray-300' },
};

const STATUSES = {
  open:        { label: 'Ouvert',    color: 'bg-yellow-100 text-yellow-700 border border-yellow-200', dot: 'bg-yellow-400' },
  in_progress: { label: 'En cours',  color: 'bg-blue-100 text-blue-700 border border-blue-200',       dot: 'bg-blue-500'   },
  testing:     { label: 'À tester',  color: 'bg-purple-100 text-purple-700 border border-purple-200', dot: 'bg-purple-500' },
  resolved:    { label: 'Résolu',    color: 'bg-green-100 text-green-700 border border-green-200',    dot: 'bg-green-500'  },
  closed:      { label: 'Clôturé',   color: 'bg-gray-100 text-gray-500 border border-gray-200',       dot: 'bg-gray-400'   },
};

// Colonnes Kanban : statut → index colonne
const KANBAN_COLS = [
  { key: 'open',        label: 'Ouvert',   color: 'border-yellow-300 bg-yellow-50/60', header: 'bg-yellow-100 text-yellow-800'  },
  { key: 'in_progress', label: 'En cours', color: 'border-blue-300 bg-blue-50/60',     header: 'bg-blue-100 text-blue-800'     },
  { key: 'testing',     label: 'À tester', color: 'border-purple-300 bg-purple-50/60', header: 'bg-purple-100 text-purple-800' },
  { key: 'closed',      label: 'Clôturé',  color: 'border-gray-200 bg-gray-50/40',     header: 'bg-gray-100 text-gray-600'     },
];

// ─── Suivi des commentaires lus (localStorage) ────────────────────────────────
const SEEN_KEY = 'tonton_tickets_seen';
const getSeenCounts = () => { try { return JSON.parse(localStorage.getItem(SEEN_KEY) || '{}'); } catch { return {}; } };
const markTicketSeen = (ticketId, count) => {
  const s = getSeenCounts(); s[ticketId] = count;
  localStorage.setItem(SEEN_KEY, JSON.stringify(s));
};
const ticketHasUnread = (ticket) => (ticket.commentCount || 0) > (getSeenCounts()[ticket.id] || 0);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'à l\'instant';
  if (m < 60) return `il y a ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `il y a ${h}h`;
  const d = Math.floor(h / 24);
  if (d === 1) return 'hier';
  return `il y a ${d}j`;
}

function formatDate(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleDateString('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

// ─── Composant carte ticket ───────────────────────────────────────────────────

function TicketCard({ ticket, selected, onClick, users }) {
  const prio    = PRIORITIES[ticket.priority] || PRIORITIES.normale;
  const status  = STATUSES[ticket.status]     || STATUSES.open;
  const cat     = CATEGORIES[ticket.category] || CATEGORIES.other;
  const unread  = ticketHasUnread(ticket);
  const assignee = users?.find(u => u.id === ticket.assigneeId || u.uid === ticket.assigneeId);

  return (
    <motion.div
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.99 }}
      onClick={onClick}
      className={`cursor-pointer rounded-2xl border-l-[3px] p-3.5 transition-all ${prio.border} ${
        selected
          ? 'bg-blue-50/80 shadow-md ring-1 ring-blue-200'
          : 'bg-white/90 shadow-sm hover:shadow-md border border-gray-100/80 border-l-[3px]'
      }`}
      style={{ backdropFilter: 'blur(8px)' }}
    >
      {/* Ligne 1 : titre + badge non-lu + statut */}
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            {unread && (
              <span className="w-2 h-2 rounded-full bg-blue-500 flex-shrink-0 animate-pulse" title="Nouveau(x) commentaire(s)" />
            )}
            <p className="font-semibold text-gray-900 text-sm leading-snug line-clamp-2">{ticket.title}</p>
          </div>
        </div>
        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap flex-shrink-0 ${status.color}`}>
          {status.label}
        </span>
      </div>

      {/* Ligne 2 : catégorie + priorité + niveau */}
      <div className="flex items-center gap-1 mt-2 flex-wrap">
        <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${cat.color}`}>{cat.label}</span>
        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${prio.color}`}>{prio.label}</span>
        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">L{ticket.level || 1}</span>
      </div>

      {/* Ligne 3 : créateur + date | assigné + compteurs */}
      <div className="flex items-center justify-between mt-2.5">
        <div className="flex items-center gap-1 text-gray-400 min-w-0">
          <User size={10} className="flex-shrink-0" />
          <span className="text-[11px] truncate max-w-[90px]">{ticket.creatorUsername || '—'}</span>
          <span className="text-[10px] text-gray-300">·</span>
          <span className="text-[11px] flex-shrink-0">{timeAgo(ticket.createdAt)}</span>
        </div>

        <div className="flex items-center gap-2">
          {/* Assigné */}
          {ticket.assigneeUsername && (
            <div className="flex items-center gap-1" title={`Assigné : ${ticket.assigneeUsername}`}>
              <AccountAvatar
                avatarUrl={assignee?.avatarUrl} prenom={assignee?.prenom}
                nom={assignee?.nom} username={ticket.assigneeUsername} size={18}
              />
            </div>
          )}
          {/* Compteurs */}
          <div className="flex items-center gap-1.5 text-gray-400">
            {(ticket.commentCount > 0) && (
              <span className={`flex items-center gap-0.5 text-[11px] ${unread ? 'text-blue-500 font-semibold' : ''}`}>
                <MessageSquare size={10} />{ticket.commentCount}
              </span>
            )}
            {(ticket.attachments?.length > 0) && (
              <span className="flex items-center gap-0.5 text-[11px]">
                <Paperclip size={10} />{ticket.attachments.length}
              </span>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

// ─── Composant PJ + Lightbox ─────────────────────────────────────────────────
const fmtSize = (bytes) => {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
};

const isImage = (type) => type?.startsWith('image/');
const isVideo = (type) => type?.startsWith('video/');

// ─── Lecture des PJ avec authentification JWT ─────────────────────────────────
// L'endpoint /api/ticket-attachments requiert un Bearer token → on fetche côté JS
// et on crée un blob URL pour afficher l'image/vidéo sans exposer l'URL directe.

function useAuthBlob(url) {
  const [blobUrl, setBlobUrl] = useState(null);
  useEffect(() => {
    if (!url) return;
    const token = sessionStorage.getItem('tonton_auth_token');
    let objectUrl = null;
    fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then(r => r.ok ? r.blob() : null)
      .then(blob => {
        if (!blob) return;
        objectUrl = URL.createObjectURL(blob);
        setBlobUrl(objectUrl);
      })
      .catch(() => {});
    return () => { if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [url]);
  return blobUrl;
}

function downloadWithAuth(url, filename) {
  const token = sessionStorage.getItem('tonton_auth_token');
  fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
    .then(r => r.ok ? r.blob() : null)
    .then(blob => {
      if (!blob) return;
      const el = document.createElement('a');
      el.href = URL.createObjectURL(blob);
      el.download = filename || 'fichier';
      el.click();
      setTimeout(() => URL.revokeObjectURL(el.href), 5000);
    })
    .catch(() => {});
}

function AuthImage({ src, alt, className, style, onMouseDown, draggable }) {
  const blobUrl = useAuthBlob(src);
  if (!blobUrl) return <div className={className} style={{ ...style, background: '#1f2937' }} />;
  return (
    <img
      src={blobUrl}
      alt={alt}
      className={className}
      style={style}
      onMouseDown={onMouseDown}
      draggable={draggable}
    />
  );
}

function AuthVideo({ src, controls, className }) {
  const blobUrl = useAuthBlob(src);
  if (!blobUrl) return <div className={className} style={{ background: '#1f2937', borderRadius: 12 }} />;
  return <video src={blobUrl} controls={controls} className={className} />;
}

// Modal lightbox avec zoom/dézoom pour images et vidéos
function Lightbox({ attachments, initialIndex, onClose }) {
  const [idx, setIdx]     = useState(initialIndex);
  const [zoom, setZoom]   = useState(1);
  const [pos, setPos]     = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef(null);
  const a = attachments[idx];

  // Fermer avec Escape, naviguer avec flèches
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape')     onClose();
      if (e.key === 'ArrowLeft')  setIdx(i => Math.max(0, i - 1));
      if (e.key === 'ArrowRight') setIdx(i => Math.min(attachments.length - 1, i + 1));
      if (e.key === '+')          setZoom(z => Math.min(4, z + 0.5));
      if (e.key === '-')          setZoom(z => Math.max(0.5, z - 0.5));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, attachments.length]);

  // Reset zoom quand on change d'image
  useEffect(() => { setZoom(1); setPos({ x: 0, y: 0 }); }, [idx]);

  // Zoom molette
  const onWheel = (e) => {
    e.preventDefault();
    setZoom(z => Math.min(4, Math.max(0.5, z - e.deltaY * 0.001)));
  };

  // Drag pour déplacer quand zoomé
  const onMouseDown = (e) => { if (zoom <= 1) return; setDragging(true); dragStart.current = { x: e.clientX - pos.x, y: e.clientY - pos.y }; };
  const onMouseMove = (e) => { if (!dragging || !dragStart.current) return; setPos({ x: e.clientX - dragStart.current.x, y: e.clientY - dragStart.current.y }); };
  const onMouseUp   = () => { setDragging(false); dragStart.current = null; };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 flex flex-col"
      style={{ zIndex: 300, background: 'rgba(0,0,0,0.92)' }}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 flex-shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <p className="text-white font-medium text-sm truncate max-w-xs">{a.name}</p>
          {a.size && <span className="text-gray-400 text-xs flex-shrink-0">{fmtSize(a.size)}</span>}
          {attachments.length > 1 && (
            <span className="text-gray-400 text-xs flex-shrink-0">{idx + 1} / {attachments.length}</span>
          )}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {isImage(a.type) && (
            <>
              <button onClick={() => setZoom(z => Math.max(0.5, z - 0.25))} className="p-2 text-gray-400 hover:text-white hover:bg-white/10 rounded-lg transition" title="Dézoomer (-)">
                <ZoomOut size={16} />
              </button>
              <span className="text-gray-400 text-xs w-12 text-center">{Math.round(zoom * 100)}%</span>
              <button onClick={() => setZoom(z => Math.min(4, z + 0.25))} className="p-2 text-gray-400 hover:text-white hover:bg-white/10 rounded-lg transition" title="Zoomer (+)">
                <ZoomIn size={16} />
              </button>
              <button onClick={() => { setZoom(1); setPos({ x: 0, y: 0 }); }} className="p-2 text-gray-400 hover:text-white hover:bg-white/10 rounded-lg transition" title="Réinitialiser">
                <RotateCcw size={14} />
              </button>
            </>
          )}
          <button onClick={() => downloadWithAuth(a.url, a.name)} className="p-2 text-gray-400 hover:text-white hover:bg-white/10 rounded-lg transition" title="Télécharger">
            <Download size={16} />
          </button>
          <button onClick={onClose} className="p-2 text-gray-400 hover:text-white hover:bg-white/10 rounded-lg transition ml-1">
            <X size={18} />
          </button>
        </div>
      </div>

      {/* Contenu */}
      <div
        className="flex-1 flex items-center justify-center overflow-hidden relative select-none"
        onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        onWheel={onWheel}
        style={{ cursor: zoom > 1 ? (dragging ? 'grabbing' : 'grab') : 'default' }}
      >
        {isImage(a.type) && (
          <AuthImage
            src={a.url}
            alt={a.name}
            onMouseDown={onMouseDown}
            draggable={false}
            style={{
              transform: `scale(${zoom}) translate(${pos.x / zoom}px, ${pos.y / zoom}px)`,
              transition: dragging ? 'none' : 'transform 0.15s ease',
              maxWidth: '90vw',
              maxHeight: '80vh',
              objectFit: 'contain',
              borderRadius: 8,
              userSelect: 'none',
            }}
          />
        )}
        {isVideo(a.type) && (
          <AuthVideo src={a.url} controls className="max-w-[90vw] max-h-[80vh] rounded-xl" />
        )}
        {!isImage(a.type) && !isVideo(a.type) && (
          <div className="text-center space-y-4">
            <File size={64} className="text-gray-500 mx-auto" />
            <p className="text-white font-medium">{a.name}</p>
            {a.size && <p className="text-gray-400 text-sm">{fmtSize(a.size)}</p>}
            <button
              onClick={() => downloadWithAuth(a.url, a.name)}
              className="inline-flex items-center gap-2 bg-white text-gray-900 font-medium px-5 py-2.5 rounded-xl hover:bg-gray-100 transition">
              <Download size={16} /> Télécharger
            </button>
          </div>
        )}
      </div>

      {/* Navigation entre pièces jointes */}
      {attachments.length > 1 && (
        <>
          <button
            onClick={() => setIdx(i => Math.max(0, i - 1))}
            disabled={idx === 0}
            className="absolute left-3 top-1/2 -translate-y-1/2 p-2 bg-white/10 hover:bg-white/20 text-white rounded-full disabled:opacity-20 transition"
          >
            <ChevronLeft size={22} />
          </button>
          <button
            onClick={() => setIdx(i => Math.min(attachments.length - 1, i + 1))}
            disabled={idx === attachments.length - 1}
            className="absolute right-3 top-1/2 -translate-y-1/2 p-2 bg-white/10 hover:bg-white/20 text-white rounded-full disabled:opacity-20 transition"
          >
            <ChevronRight size={22} />
          </button>
        </>
      )}

      {/* Miniatures en bas si plusieurs */}
      {attachments.length > 1 && (
        <div className="flex items-center justify-center gap-2 py-3 flex-shrink-0">
          {attachments.map((att, i) => (
            <button
              key={i}
              onClick={() => setIdx(i)}
              className={`w-12 h-8 rounded-lg overflow-hidden border-2 transition ${i === idx ? 'border-white' : 'border-transparent opacity-50 hover:opacity-80'}`}
            >
              {isImage(att.type)
                ? <AuthImage src={att.url} alt="" className="w-full h-full object-cover" />
                : <div className="w-full h-full bg-white/20 flex items-center justify-center"><File size={12} className="text-white" /></div>
              }
            </button>
          ))}
        </div>
      )}
    </motion.div>
  );
}

function AttachmentItem({ a, onClick }) {
  if (isImage(a.type)) {
    return (
      <button
        onClick={onClick}
        className="group relative block w-32 rounded-xl overflow-hidden border border-gray-100 hover:border-blue-300 transition-colors shadow-sm cursor-zoom-in"
        title={`${a.name} — cliquer pour agrandir`}
      >
        <AuthImage src={a.url} alt={a.name} className="w-32 h-20 object-cover" />
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/15 transition flex items-center justify-center">
          <ZoomIn size={20} className="text-white opacity-0 group-hover:opacity-100 transition drop-shadow" />
        </div>
        <div className="px-2 py-1 bg-white border-t border-gray-100">
          <p className="text-[10px] text-gray-600 truncate font-medium">{a.name}</p>
          {a.size && <p className="text-[9px] text-gray-400">{fmtSize(a.size)}</p>}
        </div>
      </button>
    );
  }

  const Icon = isVideo(a.type) ? Film : a.type?.includes('pdf') ? FileText : a.type?.includes('image') ? FileImage : File;
  const iconColor = isVideo(a.type) ? 'text-purple-500 bg-purple-50' : a.type?.includes('pdf') ? 'text-red-500 bg-red-50' : 'text-blue-500 bg-blue-50';

  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2.5 bg-gray-50 hover:bg-gray-100 border border-gray-100 hover:border-gray-200 rounded-xl px-3 py-2 transition-colors group text-left"
      title={a.name}
    >
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${iconColor}`}>
        <Icon size={15} />
      </div>
      <div className="min-w-0">
        <p className="text-xs font-medium text-gray-700 truncate max-w-[160px] group-hover:text-blue-600 transition-colors">{a.name}</p>
        {a.size && <p className="text-[10px] text-gray-400">{fmtSize(a.size)}</p>}
      </div>
    </button>
  );
}

function AttachmentList({ attachments, className = '' }) {
  const [lightbox, setLightbox] = useState(null); // index de la PJ ouverte
  if (!attachments?.length) return null;
  const images = attachments.filter(a => isImage(a.type));
  const others = attachments.filter(a => !isImage(a.type));
  return (
    <div className={`space-y-2 ${className}`}>
      {images.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {images.map((a, i) => (
            <AttachmentItem key={i} a={a} onClick={() => setLightbox(attachments.indexOf(a))} />
          ))}
        </div>
      )}
      {others.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {others.map((a, i) => (
            <AttachmentItem key={i} a={a} onClick={() => setLightbox(attachments.indexOf(a))} />
          ))}
        </div>
      )}
      <AnimatePresence>
        {lightbox !== null && (
          <Lightbox attachments={attachments} initialIndex={lightbox} onClose={() => setLightbox(null)} />
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Rendu du contenu avec @mentions en surbrillance ─────────────────────────

function renderContent(text) {
  if (!text) return null;
  const parts = text.split(/(@[\w.]+)/g);
  return parts.map((part, i) =>
    /^@[\w.]/.test(part)
      ? <span key={i} className="text-blue-600 font-semibold bg-blue-50 rounded px-0.5">{part}</span>
      : part
  );
}

// ─── Fil de commentaires ──────────────────────────────────────────────────────

function CommentThread({ ticket, currentUser, onCommentAdded }) {
  const [comments, setComments] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [text, setText]         = useState('');
  const [files, setFiles]       = useState([]);
  const [sending, setSending]   = useState(false);
  const [mention, setMention]   = useState(null); // { query } | null
  const fileRef      = useRef();
  const bottomRef    = useRef();
  const textareaRef  = useRef();
  const users = useSelector(s => s.users.list);

  // Utilisateurs filtrés pour l'autocomplétion @mention
  const mentionUsers = mention
    ? users.filter(u => u.username && u.username.toLowerCase().startsWith(mention.query.toLowerCase())).slice(0, 6)
    : [];

  const handleTextChange = (e) => {
    const val = e.target.value;
    setText(val);
    const pos = e.target.selectionStart;
    const beforeCursor = val.slice(0, pos);
    const match = beforeCursor.match(/@([\w.]*)$/);
    setMention(match ? { query: match[1] } : null);
  };

  const insertMention = (username) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const pos = ta.selectionStart;
    const before = text.slice(0, pos);
    const after  = text.slice(pos);
    const atIdx  = before.lastIndexOf('@');
    setText(text.slice(0, atIdx) + '@' + username + ' ' + after);
    setMention(null);
    setTimeout(() => ta.focus(), 0);
  };

  // Abonnement onSnapshot — cache local Firestore = affichage quasi-instantané
  useEffect(() => {
    if (!ticket?.id) return;
    setComments([]);
    setText('');
    setFiles([]);
    setLoading(true);

    const unsubscribe = subscribeToComments(
      ticket.id,
      (data) => { setComments(data); setLoading(false); },
      ()     => setLoading(false),
    );
    return unsubscribe; // nettoyage au unmount / changement de ticket
  }, [ticket?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [comments]);

  const getUserInfo = (authorId) => {
    return users.find(u => u.id === authorId || u.uid === authorId) || null;
  };

  const handleSend = async () => {
    if (!text.trim() && files.length === 0) return;
    setSending(true);
    try {
      // ── Upload PJ (synchrone, timeout 15s pour éviter le blocage infini) ──
      let attachments = [];
      if (files.length > 0) {
        const TIMEOUT_MS = 20000;
        const uploadWithTimeout = (f) => Promise.race([
          uploadTicketFile(ticket.id, f),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`Timeout upload "${f.name}" (>20s)`)), TIMEOUT_MS)
          ),
        ]);
        const results = await Promise.allSettled(files.map(uploadWithTimeout));
        results.forEach((r, i) => {
          if (r.status === 'fulfilled') attachments.push(r.value);
          else toast.error(`PJ "${files[i]?.name}" : ${r.reason?.message || 'échec'}`);
        });
      }

      const commentData = {
        ticketId:       ticket.id,
        authorId:       currentUser.uid || currentUser.username,
        authorUsername: currentUser.username,
        authorRole:     currentUser.role,
        content:        text.trim(),
        attachments,   // PJ déjà uploadées incluses dans le commentaire
      };

      const statusUpdate = ticket.status === 'open' && commentData.authorId !== ticket.creatorId
        ? { status: 'in_progress' } : {};

      await addComment(commentData, statusUpdate);
      tracker.trackAction('ticketsCommented');
      setText('');
      setFiles([]);
      onCommentAdded && onCommentAdded();

      // Notifications en arrière-plan (non bloquant)
      // — créateur + assigné + utilisateurs mentionnés (@username)
      const mentionedUsernames = [...(text.matchAll(/@([\w.]+)/g))].map(m => m[1]);
      const mentionedIds = users
        .filter(u => mentionedUsernames.includes(u.username))
        .map(u => u.id || u.uid)
        .filter(Boolean);
      const toNotify = [...new Set([
        ticket.creatorId  !== commentData.authorId ? ticket.creatorId  : null,
        ticket.assigneeId !== commentData.authorId ? ticket.assigneeId : null,
        ...mentionedIds.filter(id => id !== commentData.authorId),
      ].filter(Boolean))];
      Promise.all(toNotify.map(uid => {
        const isMention = mentionedIds.includes(uid) && uid !== ticket.creatorId && uid !== ticket.assigneeId;
        return createNotification({
          toUserId: uid, fromUsername: currentUser.username,
          type: isMention ? 'mention' : 'new_comment',
          ticketId: ticket.id, ticketTitle: ticket.title,
          message: isMention
            ? `${currentUser.username} vous a mentionné dans le ticket "${ticket.title}"`
            : `${currentUser.username} a commenté le ticket "${ticket.title}"`,
        });
      })).catch(() => {});
    } catch (e) {
      toast.error('Erreur lors de l\'envoi du commentaire');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex flex-col min-h-0 flex-1 border-t border-gray-100">
      {/* Liste scrollable */}
      <div className="flex-1 overflow-y-auto px-5 py-3 space-y-3">
        <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 flex items-center gap-1.5">
          <MessageSquare size={12} /> Commentaires ({comments.length})
        </h4>
        {loading && <p className="text-xs text-gray-400">Chargement...</p>}
        {comments.map(c => {
          const u = getUserInfo(c.authorId);
          return (
            <div key={c.id} className="flex gap-2">
              <div className="flex-shrink-0">
                <AccountAvatar avatarUrl={u?.avatarUrl} prenom={u?.prenom} nom={u?.nom} username={c.authorUsername} size={28} />
              </div>
              <div className="flex-1 bg-gray-50 rounded-xl px-3 py-2">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-semibold text-gray-800">{c.authorUsername}</span>
                  <span className="text-[10px] bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded-full">{c.authorRole}</span>
                  <span className="text-[10px] text-gray-400 ml-auto">{timeAgo(c.createdAt)}</span>
                </div>
                {c.content && <p className="text-xs text-gray-700 whitespace-pre-wrap leading-relaxed">{renderContent(c.content)}</p>}
                <AttachmentList attachments={c.attachments} className="mt-2" />
              </div>
            </div>
          );
        })}
        {comments.length === 0 && !loading && (
          <p className="text-xs text-gray-400 italic">Aucun commentaire pour l'instant.</p>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Formulaire fixe en bas */}
      <div className="flex-shrink-0 border-t border-gray-100 px-5 py-3">
        <div className="flex gap-2 items-end">
          <div className="flex-1 relative">
            {/* Dropdown @mention */}
            {mention && mentionUsers.length > 0 && (
              <div className="absolute bottom-full left-0 mb-1 bg-white border border-gray-200 rounded-xl shadow-lg z-50 overflow-hidden w-52">
                {mentionUsers.map(u => (
                  <button
                    key={u.id || u.uid}
                    onMouseDown={e => { e.preventDefault(); insertMention(u.username); }}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 flex items-center gap-2 transition-colors"
                  >
                    <AccountAvatar avatarUrl={u.avatarUrl} prenom={u.prenom} nom={u.nom} username={u.username} size={22} />
                    <span className="font-medium text-gray-800">{u.username}</span>
                    <span className="text-[10px] text-gray-400 ml-auto">{u.role}</span>
                  </button>
                ))}
              </div>
            )}
            <textarea
              ref={textareaRef}
              value={text}
              onChange={handleTextChange}
              placeholder="Ajouter un commentaire... @ pour mentionner"
              rows={2}
              className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-blue-200"
              onKeyDown={e => {
                if (e.key === 'Escape') { setMention(null); return; }
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleSend();
              }}
            />
            {files.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1">
                {files.map((f, i) => (
                  <span key={i} className="text-[10px] bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full flex items-center gap-1">
                    {f.name}
                    <button onClick={() => setFiles(files.filter((_, j) => j !== i))}><X size={10} /></button>
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="flex flex-col gap-1">
            <button onClick={() => fileRef.current?.click()}
              className="p-2 text-gray-400 hover:text-blue-500 hover:bg-blue-50 rounded-lg transition-colors" title="Joindre des fichiers">
              <Paperclip size={16} />
            </button>
            <button onClick={handleSend} disabled={sending || (!text.trim() && files.length === 0)}
              className="p-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
              {sending ? <RefreshCw size={16} className="animate-spin" /> : <Send size={16} />}
            </button>
          </div>
          <input ref={fileRef} type="file" multiple accept="image/*,video/*" className="hidden"
            onChange={e => setFiles(prev => [...prev, ...Array.from(e.target.files)])} />
        </div>
      </div>
    </div>
  );
}

// ─── Détail d'un ticket ───────────────────────────────────────────────────────

function TicketDetail({ ticket, onClose, onUpdate, currentUser, users, history }) {
  const [actionLoading, setActionLoading] = useState(false);
  const [assignOpen, setAssignOpen]       = useState(false);
  const dispatch = useDispatch();

  // Fermer le dropdown d'assignation au clic extérieur
  useEffect(() => {
    if (!assignOpen) return;
    const close = () => setAssignOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [assignOpen]);

  const isCreator = ticket.creatorId === (currentUser.uid || currentUser.username);
  const role = currentUser.role;

  const doAction = async (updates, successMsg, notifFn) => {
    setActionLoading(true);
    try {
      await updateTicketDoc(ticket.id, updates);
      dispatch(updateTicket({ id: ticket.id, ...updates }));
      onUpdate && onUpdate({ ...ticket, ...updates });
      if (notifFn) await notifFn();
      toast.success(successMsg);
    } catch {
      toast.error('Erreur lors de l\'action');
    } finally {
      setActionLoading(false);
    }
  };

  const getSuperAdmins = () => users.filter(u => u.role === 'super_admin');

  const handleEscalate = async () => {
    await doAction({ level: 2, assigneeId: null, assigneeUsername: null }, 'Ticket escaladé au niveau 2', async () => {
      // Escalade → notifier tous les SA en parallèle (ticket sans assigné fixe)
      await Promise.all(getSuperAdmins().map(sa => createNotification({
        toUserId: sa.id || sa.uid,
        fromUsername: currentUser.username,
        type: 'escalade_l2',
        ticketId: ticket.id,
        ticketTitle: ticket.title,
        message: `Ticket escaladé L2 par ${currentUser.username} : "${ticket.title}"`,
      })));
    });
  };

  const handleResolve = async () => {
    tracker.trackAction('ticketsResolved');
    const now = Date.now();
    await doAction({ status: 'resolved', resolvedAt: now }, 'Ticket marqué comme résolu', async () => {
      if (ticket.creatorId) {
        await createNotification({
          toUserId: ticket.creatorId,
          fromUsername: currentUser.username,
          type: 'status_change',
          ticketId: ticket.id,
          ticketTitle: ticket.title,
          message: `Votre ticket "${ticket.title}" a été résolu`,
        });
      }
    });
  };

  const handleClose = async () => {
    const now = Date.now();
    await doAction({ status: 'closed', closedAt: now }, 'Ticket fermé', async () => {
      if (ticket.assigneeId) {
        await createNotification({
          toUserId: ticket.assigneeId,
          fromUsername: currentUser.username,
          type: 'status_change',
          ticketId: ticket.id,
          ticketTitle: ticket.title,
          message: `Le ticket "${ticket.title}" a été fermé`,
        });
      }
    });
  };

  const handleConfirmResolved = async () => {
    const now = Date.now();
    await doAction({ status: 'closed', closedAt: now }, 'Résolution confirmée, ticket fermé', async () => {
      // Notifier l'assigné que le créateur a confirmé la résolution
      if (ticket.assigneeId) {
        await createNotification({
          toUserId: ticket.assigneeId,
          fromUsername: currentUser.username,
          type: 'status_change',
          ticketId: ticket.id,
          ticketTitle: ticket.title,
          message: `${currentUser.username} a confirmé la résolution de "${ticket.title}"`,
        });
      }
    });
  };

  const handleReopen = async () => {
    await doAction({ status: 'open', level: 1, resolvedAt: null, closedAt: null }, 'Ticket rouvert', async () => {
      // Notifier l'assigné que le ticket a été rouvert
      if (ticket.assigneeId) {
        await createNotification({
          toUserId: ticket.assigneeId,
          fromUsername: currentUser.username,
          type: 'status_change',
          ticketId: ticket.id,
          ticketTitle: ticket.title,
          message: `${currentUser.username} a rouvert le ticket "${ticket.title}"`,
        });
      }
    });
  };

  const handleTakeCharge = async () => {
    const updates = {
      status: 'in_progress',
      assigneeId: currentUser.uid || currentUser.username,
      assigneeUsername: currentUser.username,
    };
    await doAction(updates, 'Ticket pris en charge', async () => {
      // Notifier le créateur que son ticket est pris en charge
      if (ticket.creatorId && ticket.creatorId !== (currentUser.uid || currentUser.username)) {
        await createNotification({
          toUserId: ticket.creatorId,
          fromUsername: currentUser.username,
          type: 'status_change',
          ticketId: ticket.id,
          ticketTitle: ticket.title,
          message: `${currentUser.username} a pris en charge votre ticket "${ticket.title}"`,
        });
      }
    });
  };

  // Marquer le ticket comme lu à l'ouverture
  useEffect(() => {
    if (ticket?.id) markTicketSeen(ticket.id, ticket.commentCount || 0);
  }, [ticket?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleMoveToTesting = async () => {
    await doAction({ status: 'testing' }, 'Ticket passé en phase de test', async () => {
      if (ticket.creatorId) {
        await createNotification({
          toUserId: ticket.creatorId, fromUsername: currentUser.username,
          type: 'status_change', ticketId: ticket.id, ticketTitle: ticket.title,
          message: `Votre ticket "${ticket.title}" est en cours de test`,
        });
      }
    });
  };

  const handleAssign = async (user) => {
    setAssignOpen(false);
    const updates = {
      assigneeId:       user ? (user.id || user.uid || null) : null,
      assigneeUsername: user ? user.username : null,
    };
    await doAction(updates, user ? `Assigné à ${user.username}` : 'Assignation retirée', async () => {
      if (user) {
        await createNotification({
          toUserId: user.id || user.uid,
          fromUsername: currentUser.username,
          type: 'ticket_assigned',
          ticketId: ticket.id,
          ticketTitle: ticket.title,
          message: `${currentUser.username} vous a assigné le ticket "${ticket.title}"`,
        });
      }
    });
  };

  const handlePriorityChange = async (priority) => {
    await doAction({ priority }, `Priorité changée : ${PRIORITIES[priority]?.label}`);
  };

  const handleCommentAdded = async () => {
    // Recharger le ticket pour avoir le bon commentCount
    try {
      const tickets = await getTickets(currentUser.uid || currentUser.username, role);
      dispatch(setTickets(tickets));
    } catch {}
  };

  const prio = PRIORITIES[ticket.priority] || PRIORITIES.normale;
  const status = STATUSES[ticket.status] || STATUSES.open;
  const cat = CATEGORIES[ticket.category] || CATEGORIES.other;
  const linkedArticle = ticket.linkedArticleId ? history.find(a => a.id === ticket.linkedArticleId) : null;

  return (
    <div className="flex flex-col h-full">
      {/* ── HEADER FIXE ─────────────────────────────────────────────────────── */}
      <div className="flex-shrink-0 px-5 pt-4 pb-3 border-b border-gray-100 space-y-2.5">
        {/* Titre + fermer */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${status.dot}`} />
            <h2 className="text-base font-bold text-gray-900 leading-snug">{ticket.title}</h2>
          </div>
          <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-gray-700 rounded-lg hover:bg-gray-100 flex-shrink-0">
            <X size={18} />
          </button>
        </div>

        {/* Badges */}
        <div className="flex flex-wrap gap-1.5">
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${status.color}`}>{status.label}</span>
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${cat.color}`}>{cat.label}</span>
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${prio.color}`}>{prio.label}</span>
          <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">Niveau {ticket.level || 1}</span>
        </div>

        {/* Meta compact : créateur, date, assigné, priorité */}
        <div className="flex items-center gap-4 text-xs text-gray-500 flex-wrap">
          <span className="flex items-center gap-1"><User size={11} /><strong>{ticket.creatorUsername}</strong></span>
          <span className="flex items-center gap-1"><Calendar size={11} />{formatDate(ticket.createdAt)}</span>

          {/* Assignation — interactive pour le staff, lecture seule sinon */}
          {(role === 'manager' || role === 'super_admin' || role === 'support') ? (
            <div className="relative">
              <button
                onClick={() => setAssignOpen(v => !v)}
                className={`flex items-center gap-1 px-2 py-0.5 rounded-lg hover:bg-blue-50 transition-colors ${ticket.assigneeUsername ? 'text-blue-600' : 'text-gray-400'}`}
              >
                <User size={11} />
                {ticket.assigneeUsername || 'Assigner…'}
                <ChevronDown size={10} />
              </button>
              {assignOpen && (
                <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-xl z-50 overflow-hidden w-56" onMouseDown={e => e.stopPropagation()}>
                  <p className="px-3 pt-2 pb-1 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Assigner à</p>
                  <div className="max-h-48 overflow-y-auto">
                    {users
                      .filter(u => u.username && ['super_admin', 'manager', 'support', 'cq_ia'].includes(u.role))
                      .map(u => (
                        <button
                          key={u.id || u.uid}
                          onClick={() => handleAssign(u)}
                          className={`w-full text-left px-3 py-2 hover:bg-blue-50 flex items-center gap-2 transition-colors ${(u.id || u.uid) === ticket.assigneeId ? 'bg-blue-50' : ''}`}
                        >
                          <AccountAvatar avatarUrl={u.avatarUrl} prenom={u.prenom} nom={u.nom} username={u.username} size={22} />
                          <span className="text-sm font-medium text-gray-800 flex-1">{u.username}</span>
                          {(u.id || u.uid) === ticket.assigneeId && <CheckCircle2 size={13} className="text-blue-500 flex-shrink-0" />}
                        </button>
                      ))
                    }
                  </div>
                  {ticket.assigneeId && (
                    <div className="border-t border-gray-100">
                      <button
                        onClick={() => handleAssign(null)}
                        className="w-full text-left px-3 py-2 text-xs text-red-500 hover:bg-red-50 transition-colors"
                      >
                        Retirer l'assignation
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            ticket.assigneeUsername && <span className="flex items-center gap-1 text-blue-600"><User size={11} />{ticket.assigneeUsername}</span>
          )}

          <div className="flex items-center gap-1 ml-auto">
            <span className="text-gray-400">Priorité :</span>
            <select value={ticket.priority || 'normale'} onChange={e => handlePriorityChange(e.target.value)}
              className="text-xs border border-gray-200 rounded-lg px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-blue-200 bg-white">
              {Object.entries(PRIORITIES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>
        </div>

        {/* Boutons d'action */}
        {(() => {
          const buttons = [];
          const isStaff = role === 'manager' || role === 'super_admin' || role === 'support';
          // Prendre en charge
          if (isStaff && ticket.status === 'open' && !ticket.assigneeId) {
            buttons.push(<button key="take" onClick={handleTakeCharge} disabled={actionLoading} className="px-3 py-1 text-xs font-semibold bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 flex items-center gap-1"><MoveRight size={12} />Prendre en charge</button>);
          }
          // En cours → À tester
          if (isStaff && ticket.status === 'in_progress') {
            buttons.push(
              <button key="test" onClick={handleMoveToTesting} disabled={actionLoading} className="px-3 py-1 text-xs font-semibold bg-purple-500 text-white rounded-lg hover:bg-purple-600 disabled:opacity-50 flex items-center gap-1"><FlaskConical size={12} />À tester</button>
            );
          }
          // En cours L1 → Escalader (manager / support)
          if ((role === 'manager' || role === 'support') && ticket.status === 'in_progress' && ticket.level === 1) {
            buttons.push(
              <button key="escalate" onClick={handleEscalate} disabled={actionLoading} className="px-3 py-1 text-xs font-semibold bg-orange-500 text-white rounded-lg hover:bg-orange-600 disabled:opacity-50 flex items-center gap-1"><ArrowUpRight size={12} />Escalader L2</button>
            );
          }
          // À tester ou super_admin → Résolu + Fermer
          if (isStaff && (ticket.status === 'testing' || (role === 'super_admin' && ['open', 'in_progress'].includes(ticket.status)))) {
            buttons.push(
              <button key="resolve" onClick={handleResolve} disabled={actionLoading} className="px-3 py-1 text-xs font-semibold bg-green-500 text-white rounded-lg hover:bg-green-600 disabled:opacity-50 flex items-center gap-1"><CheckCircle2 size={12} />Résolu</button>,
              <button key="close" onClick={handleClose} disabled={actionLoading} className="px-3 py-1 text-xs font-semibold bg-gray-500 text-white rounded-lg hover:bg-gray-600 disabled:opacity-50">Clôturer</button>
            );
          }
          // Créateur → confirmer ou rouvrir
          if (isCreator && ticket.status === 'resolved') {
            buttons.push(
              <button key="confirm" onClick={handleConfirmResolved} disabled={actionLoading} className="px-3 py-1 text-xs font-semibold bg-green-500 text-white rounded-lg hover:bg-green-600 disabled:opacity-50 flex items-center gap-1"><CheckCircle2 size={12} />Confirmer résolu</button>,
              <button key="reopen" onClick={handleReopen} disabled={actionLoading} className="px-3 py-1 text-xs font-semibold bg-yellow-500 text-white rounded-lg hover:bg-yellow-600 disabled:opacity-50 flex items-center gap-1"><RefreshCw size={12} />Rouvrir</button>
            );
          }
          return buttons.length > 0 ? <div className="flex flex-wrap gap-2">{buttons}</div> : null;
        })()}
      </div>

      {/* ── BODY FIXE (description + article + pièces jointes) ─────────────── */}
      {(ticket.description || ticket.linkedArticleId || ticket.attachments?.length > 0) && (
        <div className="flex-shrink-0 px-5 py-3 space-y-3 border-b border-gray-100">
          {ticket.description && (
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Description</p>
              <p className="text-sm text-gray-700 whitespace-pre-wrap bg-gray-50 rounded-xl px-3 py-2 leading-relaxed">{ticket.description}</p>
            </div>
          )}
          {(ticket.linkedArticleId || linkedArticle) && (
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Article lié</p>
              <a href={ticket.linkedArticleUrl || '#'} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-sm text-blue-600 hover:underline">
                <Link2 size={13} />{ticket.linkedArticleTitle || linkedArticle?.title || ticket.linkedArticleId}
              </a>
            </div>
          )}
          {ticket.attachments?.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
                Pièces jointes ({ticket.attachments.length})
              </p>
              <AttachmentList attachments={ticket.attachments} />
            </div>
          )}
        </div>
      )}

      {/* ── COMMENTAIRES (prend le reste de la hauteur) ─────────────────────── */}
      <CommentThread ticket={ticket} currentUser={currentUser} onCommentAdded={handleCommentAdded} />
    </div>
  );
}

// ─── Drawer latéral droit (slider détail) ─────────────────────────────────────

function TicketDrawer({ ticket, onClose, ...rest }) {
  // Échap pour fermer
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <AnimatePresence>
      {ticket && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[2px]"
          />
          {/* Panneau */}
          <motion.div
            initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            className="fixed inset-y-0 right-0 z-50 w-full max-w-[540px] bg-white shadow-2xl flex flex-col overflow-hidden"
          >
            <TicketDetail ticket={ticket} onClose={onClose} {...rest} />
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

// ─── Modal nouveau ticket ─────────────────────────────────────────────────────

function NewTicketModal({ onClose, onCreated, currentUser, users, history }) {
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('bug_app');
  const [priority, setPriority] = useState('normale');
  const [description, setDescription] = useState('');
  const [linkedArticleId, setLinkedArticleId] = useState('');
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const fileRef = useRef();

  const handleSubmit = async () => {
    if (!title.trim()) { toast.error('Le titre est obligatoire'); return; }
    setLoading(true);
    try {
      // CQ IA → assigné au premier manager disponible (niveau 1)
      // Manager → assigné au super_admin directement (niveau 2)
      const isManagerCreating = currentUser.role === 'manager';
      const assigneeCandidates = isManagerCreating
        ? users.filter(u => u.role === 'super_admin')
        : users.filter(u => u.role === 'manager');
      const assignee = assigneeCandidates[0] || null;

      const linkedArticle = history.find(a => a.id === linkedArticleId);
      const ticketLevel = isManagerCreating ? 2 : 1;
      const ticketData = {
        title: title.trim(),
        category,
        priority,
        description: description.trim(),
        creatorId: currentUser.uid || currentUser.username,
        creatorUsername: currentUser.username,
        creatorRole: currentUser.role,
        assigneeId: assignee ? (assignee.id || assignee.uid || null) : null,
        assigneeUsername: assignee ? assignee.username : null,
        linkedArticleId: category === 'article_issue' ? linkedArticleId : null,
        linkedArticleTitle: (category === 'article_issue' && linkedArticle) ? linkedArticle.title : null,
        linkedArticleUrl: (category === 'article_issue' && linkedArticle) ? linkedArticle.url : null,
        attachments: [],
      };

      // 1. Upload PJ synchrone avec timeout (même approche que les commentaires)
      let ticketAttachments = [];
      if (files.length > 0) {
        const TIMEOUT_MS = 20000;
        const tempId = `temp_${Date.now()}`;
        const uploadWithTimeout = (f) => Promise.race([
          uploadTicketFile(tempId, f),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`Timeout upload "${f.name}" (>20s)`)), TIMEOUT_MS)
          ),
        ]);
        const results = await Promise.allSettled(files.map(uploadWithTimeout));
        results.forEach((r, i) => {
          if (r.status === 'fulfilled') ticketAttachments.push(r.value);
          else toast.error(`PJ "${files[i]?.name}" : ${r.reason?.message || 'échec'}`);
        });
      }

      // 2. Créer le ticket avec les PJ déjà uploadées
      const id = await createTicket({ ...ticketData, attachments: ticketAttachments, level: ticketLevel });
      tracker.trackAction('ticketsCreated');

      // 3. newTicket inclut les PJ → Redux + panneau affichent les PJ immédiatement
      const newTicket = {
        id, ...ticketData, attachments: ticketAttachments,
        status: 'open', level: ticketLevel, commentCount: 0,
        createdAt: Date.now(), updatedAt: Date.now(), resolvedAt: null, closedAt: null,
      };

      let notifTargets = [];
      if (isManagerCreating) {
        notifTargets = users.filter(u => u.role === 'super_admin');
      } else if (ticketData.assigneeId) {
        const assigned = users.find(u => (u.id || u.uid) === ticketData.assigneeId);
        if (assigned) notifTargets = [assigned];
      } else {
        notifTargets = users.filter(u => u.role === 'manager');
      }

      onCreated(newTicket);
      toast.success('Ticket créé avec succès');
      onClose();

      // Notifications en arrière-plan
      Promise.all(notifTargets.map(u => createNotification({
        toUserId: u.id || u.uid,
        fromUsername: currentUser.username,
        type: 'new_ticket',
        ticketId: id,
        ticketTitle: title.trim(),
        message: `Nouveau ticket de ${currentUser.username} : "${title.trim()}"`,
      }))).catch(() => {});
    } catch (e) {
      toast.error('Erreur lors de la création du ticket');
    } finally {
      setLoading(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6"
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
            <Bug size={18} className="text-blue-500" /> Nouveau ticket
          </h2>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-700 rounded-lg hover:bg-gray-100">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4">
          {/* Titre */}
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1">Titre *</label>
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Titre du ticket"
              className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-200"
            />
          </div>

          {/* Catégorie */}
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1">Catégorie</label>
            <select
              value={category}
              onChange={e => setCategory(e.target.value)}
              className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-200 bg-white"
            >
              {Object.entries(CATEGORIES).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </select>
          </div>

          {/* Article lié si article_issue */}
          {category === 'article_issue' && (
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1">Article lié</label>
              <select
                value={linkedArticleId}
                onChange={e => setLinkedArticleId(e.target.value)}
                className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-200 bg-white"
              >
                <option value="">— Sélectionner un article —</option>
                {history.map(a => (
                  <option key={a.id} value={a.id}>{a.title || a.id}</option>
                ))}
              </select>
            </div>
          )}

          {/* Priorité */}
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1">Priorité</label>
            <select
              value={priority}
              onChange={e => setPriority(e.target.value)}
              className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-200 bg-white"
            >
              {Object.entries(PRIORITIES).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </select>
          </div>

          {/* Description */}
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1">Description</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Décrivez le problème ou la demande..."
              rows={4}
              className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-blue-200"
            />
          </div>

          {/* Pièces jointes */}
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1">Pièces jointes</label>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="flex items-center gap-2 text-sm text-blue-600 hover:text-blue-700 border border-dashed border-blue-300 rounded-xl px-3 py-2 hover:bg-blue-50 transition-colors w-full justify-center"
            >
              <Paperclip size={14} /> Ajouter des fichiers (photos, vidéos)
            </button>
            <input
              ref={fileRef}
              type="file"
              multiple
              accept="image/*,video/*"
              className="hidden"
              onChange={e => setFiles(prev => [...prev, ...Array.from(e.target.files)])}
            />
            {files.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {files.map((f, i) => (
                  <span key={i} className="text-[11px] bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full flex items-center gap-1">
                    {f.name}
                    <button onClick={() => setFiles(files.filter((_, j) => j !== i))}><X size={10} /></button>
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex gap-3 mt-6">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2.5 text-sm font-semibold border border-gray-200 text-gray-600 rounded-xl hover:bg-gray-50 transition-colors"
          >
            Annuler
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading || !title.trim()}
            className="flex-1 px-4 py-2.5 text-sm font-semibold bg-blue-500 text-white rounded-xl hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
          >
            {loading ? 'Création...' : <><Plus size={15} /> Créer le ticket</>}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ─── Carte Kanban (compacte) ──────────────────────────────────────────────────

function KanbanCard({ ticket, onOpen, users, isStaff, isDragging, onDragStart, onDragEnd, selected }) {
  const prio     = PRIORITIES[ticket.priority] || PRIORITIES.normale;
  const cat      = CATEGORIES[ticket.category] || CATEGORIES.other;
  const unread   = ticketHasUnread(ticket);
  const assignee = users?.find(u => u.id === ticket.assigneeId || u.uid === ticket.assigneeId);

  return (
    <div
      draggable={isStaff}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', ticket.id);
        e.dataTransfer.effectAllowed = 'move';
        onDragStart(ticket);
      }}
      onDragEnd={onDragEnd}
      onClick={() => onOpen(ticket)}
      className={`group relative rounded-xl bg-white border border-gray-100 border-l-[3px] p-3 shadow-sm transition-all ${prio.border} ${
        isDragging ? 'opacity-40 scale-95' : 'hover:shadow-md hover:-translate-y-0.5'
      } ${selected ? 'ring-2 ring-blue-300' : ''} ${isStaff ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'}`}
    >
      {/* Poignée de drag (visible au survol pour le staff) */}
      {isStaff && (
        <div className="absolute right-1.5 top-1.5 opacity-0 group-hover:opacity-40 transition-opacity pointer-events-none">
          <GripVertical size={13} className="text-gray-400" />
        </div>
      )}

      {/* Titre + unread */}
      <div className="flex items-start gap-1.5 mb-2 pr-3">
        {unread && <span className="w-2 h-2 rounded-full bg-blue-500 flex-shrink-0 mt-1 animate-pulse" title="Nouveaux commentaires" />}
        <p className="text-xs font-semibold text-gray-900 leading-snug line-clamp-2 flex-1">{ticket.title}</p>
      </div>

      {/* Badges */}
      <div className="flex flex-wrap gap-1 mb-2.5">
        <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${cat.color}`}>{cat.label}</span>
        <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-semibold ${prio.color}`}>{prio.label}</span>
        {ticket.level > 1 && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">L{ticket.level}</span>}
      </div>

      {/* Footer : créateur + assigné + compteurs */}
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-gray-400">{timeAgo(ticket.createdAt)}</span>
        <div className="flex items-center gap-1.5">
          {(ticket.commentCount > 0) && (
            <span className={`flex items-center gap-0.5 text-[10px] ${unread ? 'text-blue-500 font-bold' : 'text-gray-400'}`}>
              <MessageSquare size={9} />{ticket.commentCount}
            </span>
          )}
          {(ticket.attachments?.length > 0) && (
            <span className="flex items-center gap-0.5 text-[10px] text-gray-400">
              <Paperclip size={9} />{ticket.attachments.length}
            </span>
          )}
          {ticket.assigneeUsername ? (
            <div title={`Assigné : ${ticket.assigneeUsername}`}>
              <AccountAvatar avatarUrl={assignee?.avatarUrl} prenom={assignee?.prenom}
                nom={assignee?.nom} username={ticket.assigneeUsername} size={20} />
            </div>
          ) : (
            <div className="w-5 h-5 rounded-full border border-dashed border-gray-300 flex items-center justify-center" title="Non assigné">
              <User size={10} className="text-gray-300" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Colonne Kanban (zone de drop) ────────────────────────────────────────────

function KanbanColumn({ col, tickets, onOpen, onDropTicket, users, isStaff, draggingId, onDragStart, onDragEnd, selectedId }) {
  const [over, setOver] = useState(false);

  const handleDrop = (e) => {
    e.preventDefault();
    setOver(false);
    const id = e.dataTransfer.getData('text/plain');
    if (id) onDropTicket(id, col.key);
  };

  return (
    <div
      onDragOver={(e) => { if (isStaff) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setOver(true); } }}
      onDragLeave={() => setOver(false)}
      onDrop={handleDrop}
      className={`flex-shrink-0 w-[270px] flex flex-col rounded-2xl border transition-all ${col.color} ${
        over ? 'ring-2 ring-blue-400 ring-offset-1 bg-blue-50/40' : ''
      }`}
    >
      {/* Header colonne */}
      <div className={`flex items-center justify-between px-3 py-2.5 rounded-t-2xl ${col.header}`}>
        <span className="text-xs font-bold flex items-center gap-1.5">
          <span className={`w-2 h-2 rounded-full ${STATUSES[col.key]?.dot || 'bg-gray-400'}`} />
          {col.label}
        </span>
        <span className="text-xs font-bold bg-white/60 px-1.5 py-0.5 rounded-full min-w-[22px] text-center">{tickets.length}</span>
      </div>

      {/* Cartes */}
      <div className="flex-1 overflow-y-auto p-2 space-y-2 min-h-[120px]">
        {tickets.length === 0 && (
          <div className={`flex flex-col items-center justify-center py-10 text-xs transition-colors ${over ? 'text-blue-400' : 'text-gray-300'}`}>
            <Inbox size={22} className="mb-1.5 opacity-50" />
            {over ? 'Déposer ici' : 'Vide'}
          </div>
        )}
        {tickets.map(ticket => (
          <KanbanCard key={ticket.id} ticket={ticket} onOpen={onOpen} users={users} isStaff={isStaff}
            isDragging={draggingId === ticket.id} onDragStart={onDragStart} onDragEnd={onDragEnd}
            selected={selectedId === ticket.id} />
        ))}
      </div>
    </div>
  );
}

// ─── Vue Kanban ───────────────────────────────────────────────────────────────

function KanbanView({ tickets, onOpen, onDropTicket, users, isStaff, search, filterCategory, filterPriority, selectedId }) {
  const [draggingId, setDraggingId] = useState(null);

  const filtered = tickets.filter(t => {
    if (filterCategory !== 'all' && t.category !== filterCategory) return false;
    if (filterPriority  !== 'all' && t.priority  !== filterPriority)  return false;
    if (search && !t.title?.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const po = { urgent: 0, haute: 1, normale: 2, basse: 3 };
  const colTicketsFor = (colKey) => filtered
    .filter(t => colKey === 'closed' ? (t.status === 'closed' || t.status === 'resolved') : t.status === colKey)
    .sort((a, b) => (po[a.priority] ?? 2) - (po[b.priority] ?? 2));

  return (
    <div className="flex gap-3 h-full overflow-x-auto pb-2">
      {KANBAN_COLS.map(col => (
        <KanbanColumn
          key={col.key} col={col} tickets={colTicketsFor(col.key)}
          onOpen={onOpen} onDropTicket={onDropTicket} users={users} isStaff={isStaff}
          draggingId={draggingId} selectedId={selectedId}
          onDragStart={(t) => setDraggingId(t.id)}
          onDragEnd={() => setDraggingId(null)}
        />
      ))}
    </div>
  );
}

// ─── Ordre de priorité pour le tri ───────────────────────────────────────────
const PRIORITY_ORDER = { urgent: 0, haute: 1, normale: 2, basse: 3 };

// ─── Page principale ──────────────────────────────────────────────────────────

export default function Tickets() {
  const dispatch = useDispatch();
  const auth = useSelector(s => s.auth);
  const users = useSelector(s => s.users.list);
  const history = useSelector(s => s.articles.history);
  const tickets = useSelector(s => s.tickets.list);
  const location = useLocation();

  const [loading, setLoading] = useState(false);
  const [selectedTicket, setSelectedTicket] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterCategory, setFilterCategory] = useState('all');
  const [filterPriority, setFilterPriority] = useState('all');
  const [activeTab, setActiveTab] = useState('actifs');
  const [sortBy, setSortBy] = useState('date_desc');
  const [viewMode, setViewMode] = useState('list'); // 'list' | 'kanban'

  const currentUser = { uid: auth.uid, username: auth.username, role: auth.role };

  // Charger les tickets
  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const data = await getTickets(auth.uid || auth.username, auth.role);
        dispatch(setTickets(data));
      } catch {
        toast.error('Erreur chargement des tickets');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [auth.uid, auth.username, auth.role, dispatch]);

  // Sync selectedTicket avec la liste Redux
  useEffect(() => {
    if (selectedTicket) {
      const updated = tickets.find(t => t.id === selectedTicket.id);
      if (updated) setSelectedTicket(updated);
    }
  }, [tickets]); // eslint-disable-line react-hooks/exhaustive-deps

  // Ouvrir automatiquement un ticket depuis une notification
  // Si le ticket est fermé, basculer sur l'onglet Historique
  useEffect(() => {
    const openId = location.state?.openTicketId;
    if (!openId || tickets.length === 0) return;
    const target = tickets.find(t => t.id === openId);
    if (target) {
      if (target.status === 'closed') setActiveTab('historique');
      setSelectedTicket(target);
    }
  }, [location.state, tickets]); // eslint-disable-line react-hooks/exhaustive-deps

  // Réinitialiser filtre statut + sélection quand on change d'onglet
  useEffect(() => {
    setFilterStatus('all');
    setSelectedTicket(null);
  }, [activeTab]);

  // Séparer actifs / historique
  const activeTickets = tickets.filter(t => t.status !== 'closed');
  const closedTickets = tickets.filter(t => t.status === 'closed');
  const tabTickets = activeTab === 'actifs' ? activeTickets : closedTickets;

  // Filtrage
  const filtered = tabTickets.filter(t => {
    if (activeTab === 'actifs' && filterStatus !== 'all' && t.status !== filterStatus) return false;
    if (filterCategory !== 'all' && t.category !== filterCategory) return false;
    if (filterPriority !== 'all' && t.priority !== filterPriority) return false;
    if (search && !t.title?.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  // Tri
  const sorted = [...filtered].sort((a, b) => {
    if (sortBy === 'date_asc') return (a.createdAt || 0) - (b.createdAt || 0);
    if (sortBy === 'priority') return (PRIORITY_ORDER[a.priority] ?? 2) - (PRIORITY_ORDER[b.priority] ?? 2);
    return (b.createdAt || 0) - (a.createdAt || 0); // date_desc par défaut
  });

  // Stats (onglet actifs uniquement)
  const stats = {
    open:        activeTickets.filter(t => t.status === 'open').length,
    in_progress: activeTickets.filter(t => t.status === 'in_progress').length,
    testing:     activeTickets.filter(t => t.status === 'testing').length,
    resolved:    activeTickets.filter(t => t.status === 'resolved').length,
  };

  const handleTicketCreated = (newTicket) => {
    dispatch(addTicket(newTicket));
    setSelectedTicket(newTicket);
  };

  const handleTicketUpdate = (updated) => {
    setSelectedTicket(updated);
  };

  const isStaff = ['super_admin', 'manager', 'support'].includes(auth.role);
  const canCreate = auth.role === 'cq_ia' || auth.role === 'manager' || auth.role === 'support';

  // Déplacement par drag & drop dans le Kanban (id ticket + colonne cible)
  const handleDropTicket = async (ticketId, colKey) => {
    const ticket = tickets.find(t => t.id === ticketId);
    if (!ticket) return;
    // La colonne "Clôturé" → statut closed
    const newStatus = colKey === 'closed' ? 'closed' : colKey;
    if (ticket.status === newStatus) return; // pas de changement

    try {
      const updates = { status: newStatus };
      if (newStatus === 'in_progress' && !ticket.assigneeId) {
        updates.assigneeId = auth.uid || auth.username;
        updates.assigneeUsername = auth.username;
      }
      if (newStatus === 'resolved') updates.resolvedAt = Date.now();
      if (newStatus === 'closed')   updates.closedAt = Date.now();
      if (newStatus === 'open')     { updates.resolvedAt = null; updates.closedAt = null; }

      await updateTicketDoc(ticketId, updates);
      dispatch(updateTicket({ id: ticketId, ...updates }));
      if (newStatus === 'resolved') tracker.trackAction('ticketsResolved');

      // Notification au créateur / assigné selon la transition
      const messages = {
        in_progress: { to: ticket.creatorId, msg: `${auth.username} a pris en charge votre ticket "${ticket.title}"` },
        testing:     { to: ticket.creatorId, msg: `Votre ticket "${ticket.title}" est en cours de test` },
        resolved:    { to: ticket.creatorId, msg: `Votre ticket "${ticket.title}" a été résolu` },
        closed:      { to: ticket.assigneeId, msg: `Le ticket "${ticket.title}" a été clôturé` },
        open:        { to: ticket.assigneeId, msg: `${auth.username} a rouvert le ticket "${ticket.title}"` },
      };
      const notif = messages[newStatus];
      if (notif?.to && notif.to !== (auth.uid || auth.username)) {
        createNotification({
          toUserId: notif.to, fromUsername: auth.username,
          type: 'status_change', ticketId, ticketTitle: ticket.title, message: notif.msg,
        }).catch(() => {});
      }

      toast.success(`Déplacé : ${STATUSES[newStatus]?.label || newStatus}`);
    } catch {
      toast.error('Erreur lors du déplacement');
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden gap-3">

      {/* ── LIGNE 1 : Titre + onglets + toggle vue + bouton ── */}
      <div className="flex-shrink-0 flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-shrink-0">
          <Bug size={20} className="text-blue-500" />
          <h1 className="text-xl font-bold text-gray-900">Tickets</h1>
        </div>

        {/* Onglets Actifs / Historique */}
        <div className="flex items-center gap-1 bg-gray-100 rounded-xl p-1 flex-shrink-0">
          {[
            { key: 'actifs',     label: 'Actifs',     count: activeTickets.length },
            { key: 'historique', label: 'Historique', count: closedTickets.length },
          ].map(tab => (
            <button key={tab.key} onClick={() => { setActiveTab(tab.key); if (tab.key === 'historique') setViewMode('list'); }}
              className={`flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-lg transition-all ${
                activeTab === tab.key ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}>
              {tab.label}
              {tab.count > 0 && (
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none ${
                  activeTab === tab.key ? 'bg-blue-100 text-blue-600' : 'bg-gray-200 text-gray-500'
                }`}>{tab.count}</span>
              )}
            </button>
          ))}
        </div>

        {/* Toggle Liste / Kanban (actifs seulement) */}
        {activeTab === 'actifs' && (
          <div className="flex items-center gap-0.5 bg-gray-100 rounded-xl p-1 flex-shrink-0">
            <button onClick={() => setViewMode('list')}
              className={`p-1.5 rounded-lg transition-all ${viewMode === 'list' ? 'bg-white shadow-sm text-blue-600' : 'text-gray-400 hover:text-gray-600'}`}
              title="Vue liste">
              <LayoutList size={14} />
            </button>
            <button onClick={() => setViewMode('kanban')}
              className={`p-1.5 rounded-lg transition-all ${viewMode === 'kanban' ? 'bg-white shadow-sm text-blue-600' : 'text-gray-400 hover:text-gray-600'}`}
              title="Vue Kanban">
              <LayoutGrid size={14} />
            </button>
          </div>
        )}

        <div className="flex-1" />

        {canCreate && (
          <button onClick={() => setShowModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-xl text-sm font-semibold hover:bg-blue-600 transition-colors shadow-sm flex-shrink-0">
            <Plus size={15} /> Nouveau ticket
          </button>
        )}
      </div>

      {/* ── LIGNE 2 : Stats pills (actifs, liste seulement) + Filtres + Tri ── */}
      <div className="flex-shrink-0 flex items-center gap-2 flex-wrap">
        {/* Stats pills */}
        {activeTab === 'actifs' && viewMode === 'list' && [
          { key: 'open',        label: 'Ouverts',   color: 'bg-yellow-50 text-yellow-700 border-yellow-200',   count: stats.open        },
          { key: 'in_progress', label: 'En cours',  color: 'bg-blue-50 text-blue-700 border-blue-200',         count: stats.in_progress },
          { key: 'testing',     label: 'À tester',  color: 'bg-purple-50 text-purple-700 border-purple-200',   count: stats.testing     },
          { key: 'resolved',    label: 'Résolus',   color: 'bg-green-50 text-green-700 border-green-200',      count: stats.resolved    },
        ].map(({ key, label, color, count }) => (
          <button key={key} onClick={() => setFilterStatus(filterStatus === key ? 'all' : key)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-semibold transition-all ${color} ${filterStatus === key ? 'shadow-sm ring-1 ring-current ring-offset-1' : 'opacity-70 hover:opacity-100'}`}>
            <span className="text-sm font-bold">{count}</span> {label}
          </button>
        ))}

        <div className="flex-1" />

        {/* Recherche */}
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Rechercher..."
            className="text-sm border border-gray-200 rounded-xl pl-7 pr-3 py-1.5 w-44 focus:outline-none focus:ring-2 focus:ring-blue-200" />
        </div>

        {/* Catégorie */}
        <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)}
          className="text-sm border border-gray-200 rounded-xl px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-200 bg-white">
          <option value="all">Toutes catégories</option>
          {Object.entries(CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>

        {/* Priorité */}
        <select value={filterPriority} onChange={e => setFilterPriority(e.target.value)}
          className="text-sm border border-gray-200 rounded-xl px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-200 bg-white">
          <option value="all">Toutes priorités</option>
          {Object.entries(PRIORITIES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>

        {/* Tri */}
        <select value={sortBy} onChange={e => setSortBy(e.target.value)}
          className="text-sm border border-gray-200 rounded-xl px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-200 bg-white">
          <option value="date_desc">Plus récents</option>
          <option value="date_asc">Plus anciens</option>
          <option value="priority">Priorité ↑</option>
        </select>
      </div>

      {/* ── LIGNE 3 : Contenu (prend tout l'espace restant) ── */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {loading && (
          <div className="flex items-center justify-center py-12 text-gray-400 h-full">
            <RefreshCw size={18} className="animate-spin mr-2" /> Chargement...
          </div>
        )}

        {/* ── VUE KANBAN ── */}
        {!loading && viewMode === 'kanban' && activeTab === 'actifs' && (
          <KanbanView
            tickets={activeTickets}
            onOpen={t => setSelectedTicket(t)}
            onDropTicket={handleDropTicket}
            users={users}
            isStaff={isStaff}
            search={search}
            filterCategory={filterCategory}
            filterPriority={filterPriority}
            selectedId={selectedTicket?.id}
          />
        )}

        {/* ── VUE LISTE (grille responsive pleine largeur) ── */}
        {!loading && viewMode === 'list' && (
          <div className="h-full overflow-y-auto pr-1">
            {sorted.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-gray-400">
                <Bug size={36} className="mb-3 opacity-30" />
                <p className="text-sm">{activeTab === 'historique' ? 'Aucun ticket clôturé' : 'Aucun ticket trouvé'}</p>
              </div>
            ) : (
              <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(320px,1fr))] content-start">
                {sorted.map(ticket => (
                  <TicketCard key={ticket.id} ticket={ticket} users={users}
                    selected={selectedTicket?.id === ticket.id}
                    onClick={() => setSelectedTicket(ticket)} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Drawer détail (slider droit) — commun aux deux vues */}
      <TicketDrawer
        ticket={selectedTicket}
        onClose={() => setSelectedTicket(null)}
        onUpdate={handleTicketUpdate}
        currentUser={currentUser}
        users={users}
        history={history}
      />

      {/* Modal nouveau ticket */}
      <AnimatePresence>
        {showModal && (
          <NewTicketModal
            onClose={() => setShowModal(false)}
            onCreated={handleTicketCreated}
            currentUser={currentUser}
            users={users}
            history={history}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
