import { useState, useEffect, useRef, useCallback } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { motion, AnimatePresence } from 'framer-motion';
import toast from 'react-hot-toast';
import {
  Bug, Plus, X, Send, Paperclip, AlertCircle, Clock,
  CheckCircle2, RefreshCw, ArrowUpRight, MessageSquare,
  Search, User, Calendar, Link2,
} from 'lucide-react';
import { addTicket, updateTicket, setTickets } from '../store/slices/ticketsSlice';
import {
  getTickets, createTicket, updateTicketDoc, getComments, addComment,
  uploadTicketFile, createNotification,
} from '../services/firebase';
import { AccountAvatar } from '../components/account/MonComptePanel';

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
  open:        { label: 'Ouvert',   color: 'bg-yellow-100 text-yellow-700 border border-yellow-200' },
  in_progress: { label: 'En cours', color: 'bg-blue-100 text-blue-700 border border-blue-200' },
  resolved:    { label: 'Résolu',   color: 'bg-green-100 text-green-700 border border-green-200' },
  closed:      { label: 'Fermé',    color: 'bg-gray-100 text-gray-500 border border-gray-200' },
};

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

function TicketCard({ ticket, selected, onClick }) {
  const prio = PRIORITIES[ticket.priority] || PRIORITIES.normale;
  const status = STATUSES[ticket.status] || STATUSES.open;
  const cat = CATEGORIES[ticket.category] || CATEGORIES.other;
  return (
    <motion.div
      whileHover={{ x: 2 }}
      whileTap={{ scale: 0.99 }}
      onClick={onClick}
      className={`cursor-pointer rounded-xl border-l-4 p-3 mb-2 transition-all ${prio.border} ${
        selected
          ? 'bg-blue-50 shadow-md border-r border-t border-b border-blue-100'
          : 'bg-white shadow-sm border-r border-t border-b border-gray-100 hover:shadow-md'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="font-semibold text-gray-900 text-sm leading-snug line-clamp-2 flex-1">{ticket.title}</p>
        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${status.color}`}>
          {status.label}
        </span>
      </div>
      <div className="flex flex-wrap gap-1 mt-2">
        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${cat.color}`}>{cat.label}</span>
        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${prio.color}`}>{prio.label}</span>
        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-600">
          L{ticket.level || 1}
        </span>
      </div>
      <div className="flex items-center justify-between mt-2">
        <div className="flex items-center gap-1 text-gray-400">
          <User size={11} />
          <span className="text-[11px]">{ticket.creatorUsername || '—'}</span>
          <span className="text-[11px] ml-1">{timeAgo(ticket.createdAt)}</span>
        </div>
        <div className="flex items-center gap-2 text-gray-400">
          {ticket.commentCount > 0 && (
            <span className="flex items-center gap-0.5 text-[11px]">
              <MessageSquare size={11} />{ticket.commentCount}
            </span>
          )}
          {ticket.attachments?.length > 0 && (
            <span className="flex items-center gap-0.5 text-[11px]">
              <Paperclip size={11} />{ticket.attachments.length}
            </span>
          )}
        </div>
      </div>
    </motion.div>
  );
}

// ─── Fil de commentaires ──────────────────────────────────────────────────────

function CommentThread({ ticket, currentUser, onCommentAdded }) {
  const [comments, setComments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [text, setText] = useState('');
  const [files, setFiles] = useState([]);
  const [sending, setSending] = useState(false);
  const fileRef = useRef();
  const users = useSelector(s => s.users.list);

  const loadComments = useCallback(async () => {
    if (!ticket?.id) return;
    setLoading(true);
    try {
      const data = await getComments(ticket.id);
      setComments(data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [ticket?.id]);

  useEffect(() => {
    setComments([]);
    setText('');
    setFiles([]);
    loadComments();
  }, [ticket?.id, loadComments]);

  const getUserInfo = (authorId) => {
    return users.find(u => u.id === authorId || u.uid === authorId) || null;
  };

  const handleSend = async () => {
    if (!text.trim() && files.length === 0) return;
    setSending(true);
    try {
      // Upload fichiers
      let attachments = [];
      for (const f of files) {
        try {
          const att = await uploadTicketFile(ticket.id, f);
          attachments.push(att);
        } catch {
          toast.error(`Erreur upload ${f.name}`);
        }
      }

      const commentData = {
        ticketId: ticket.id,
        authorId: currentUser.uid || currentUser.username,
        authorUsername: currentUser.username,
        authorRole: currentUser.role,
        content: text.trim(),
        attachments,
      };
      await addComment(commentData);

      // Notifier créateur + assignee
      const toNotify = new Set();
      if (ticket.creatorId && ticket.creatorId !== commentData.authorId) toNotify.add(ticket.creatorId);
      if (ticket.assigneeId && ticket.assigneeId !== commentData.authorId) toNotify.add(ticket.assigneeId);
      for (const uid of toNotify) {
        await createNotification({
          toUserId: uid,
          fromUsername: currentUser.username,
          type: 'new_comment',
          ticketId: ticket.id,
          ticketTitle: ticket.title,
          message: `${currentUser.username} a commenté le ticket "${ticket.title}"`,
        });
      }

      setText('');
      setFiles([]);
      await loadComments();
      onCommentAdded && onCommentAdded();
    } catch (e) {
      toast.error('Erreur lors de l\'envoi du commentaire');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="mt-4 border-t border-gray-100 pt-4">
      <h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-1.5">
        <MessageSquare size={14} /> Commentaires ({comments.length})
      </h4>

      {loading && <p className="text-xs text-gray-400">Chargement...</p>}

      <div className="space-y-3 mb-4 max-h-64 overflow-y-auto pr-1">
        {comments.map(c => {
          const u = getUserInfo(c.authorId);
          return (
            <div key={c.id} className="flex gap-2">
              <div className="flex-shrink-0">
                <AccountAvatar
                  avatarUrl={u?.avatarUrl}
                  prenom={u?.prenom}
                  nom={u?.nom}
                  username={c.authorUsername}
                  size={28}
                />
              </div>
              <div className="flex-1 bg-gray-50 rounded-xl px-3 py-2">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-semibold text-gray-800">{c.authorUsername}</span>
                  <span className="text-[10px] bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded-full">{c.authorRole}</span>
                  <span className="text-[10px] text-gray-400 ml-auto">{timeAgo(c.createdAt)}</span>
                </div>
                {c.content && <p className="text-xs text-gray-700 whitespace-pre-wrap">{c.content}</p>}
                {c.attachments?.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {c.attachments.map((a, i) => (
                      <a key={i} href={a.url} target="_blank" rel="noopener noreferrer"
                        className="text-[10px] text-blue-600 hover:underline flex items-center gap-0.5">
                        <Paperclip size={10} />{a.name}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
        {comments.length === 0 && !loading && (
          <p className="text-xs text-gray-400 italic">Aucun commentaire pour l'instant.</p>
        )}
      </div>

      {/* Formulaire */}
      <div className="flex gap-2 items-end">
        <div className="flex-1">
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder="Ajouter un commentaire..."
            rows={2}
            className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-blue-200"
            onKeyDown={e => {
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
          <button
            onClick={() => fileRef.current?.click()}
            className="p-2 text-gray-400 hover:text-blue-500 hover:bg-blue-50 rounded-lg transition-colors"
            title="Joindre des fichiers"
          >
            <Paperclip size={16} />
          </button>
          <button
            onClick={handleSend}
            disabled={sending || (!text.trim() && files.length === 0)}
            className="p-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <Send size={16} />
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          multiple
          accept="image/*,video/*"
          className="hidden"
          onChange={e => setFiles(prev => [...prev, ...Array.from(e.target.files)])}
        />
      </div>
    </div>
  );
}

// ─── Détail d'un ticket ───────────────────────────────────────────────────────

function TicketDetail({ ticket, onClose, onUpdate, currentUser, users, history }) {
  const [actionLoading, setActionLoading] = useState(false);
  const dispatch = useDispatch();

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
    await doAction({ level: 2 }, 'Ticket escaladé au niveau 2', async () => {
      for (const sa of getSuperAdmins()) {
        await createNotification({
          toUserId: sa.id || sa.uid,
          fromUsername: currentUser.username,
          type: 'escalade_l2',
          ticketId: ticket.id,
          ticketTitle: ticket.title,
          message: `Ticket escaladé L2 : "${ticket.title}" par ${currentUser.username}`,
        });
      }
    });
  };

  const handleResolve = async () => {
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
    await doAction({ status: 'closed', closedAt: now }, 'Résolution confirmée, ticket fermé');
  };

  const handleReopen = async () => {
    await doAction({ status: 'open', level: 1, resolvedAt: null, closedAt: null }, 'Ticket rouvert');
  };

  const handleTakeCharge = async () => {
    const updates = {
      status: 'in_progress',
      assigneeId: currentUser.uid || currentUser.username,
      assigneeUsername: currentUser.username,
    };
    await doAction(updates, 'Ticket pris en charge');
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

  const linkedArticle = ticket.linkedArticleId
    ? history.find(a => a.id === ticket.linkedArticleId)
    : null;

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      className="flex flex-col h-full overflow-y-auto"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-4">
        <h2 className="text-lg font-bold text-gray-900 leading-snug flex-1">{ticket.title}</h2>
        <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-700 rounded-lg hover:bg-gray-100 flex-shrink-0">
          <X size={18} />
        </button>
      </div>

      {/* Badges */}
      <div className="flex flex-wrap gap-1.5 mb-4">
        <span className={`text-xs font-medium px-2 py-1 rounded-full ${status.color}`}>{status.label}</span>
        <span className={`text-xs font-medium px-2 py-1 rounded-full ${cat.color}`}>{cat.label}</span>
        <span className={`text-xs font-medium px-2 py-1 rounded-full ${prio.color}`}>{prio.label}</span>
        <span className="text-xs font-medium px-2 py-1 rounded-full bg-gray-100 text-gray-600">
          Niveau {ticket.level || 1}
        </span>
      </div>

      {/* Priorité modifiable */}
      <div className="mb-4">
        <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1">Priorité</label>
        <select
          value={ticket.priority || 'normale'}
          onChange={e => handlePriorityChange(e.target.value)}
          className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-200 bg-white"
        >
          {Object.entries(PRIORITIES).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>
      </div>

      {/* Infos */}
      <div className="grid grid-cols-2 gap-3 mb-4 text-xs text-gray-600">
        <div className="flex items-center gap-1.5">
          <User size={12} className="text-gray-400" />
          <span>Créé par <strong>{ticket.creatorUsername}</strong></span>
        </div>
        {ticket.assigneeUsername && (
          <div className="flex items-center gap-1.5">
            <User size={12} className="text-blue-400" />
            <span>Assigné à <strong>{ticket.assigneeUsername}</strong></span>
          </div>
        )}
        <div className="flex items-center gap-1.5">
          <Calendar size={12} className="text-gray-400" />
          <span>{formatDate(ticket.createdAt)}</span>
        </div>
        {ticket.resolvedAt && (
          <div className="flex items-center gap-1.5">
            <CheckCircle2 size={12} className="text-green-500" />
            <span>Résolu {timeAgo(ticket.resolvedAt)}</span>
          </div>
        )}
      </div>

      {/* Description */}
      {ticket.description && (
        <div className="mb-4">
          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1">Description</label>
          <p className="text-sm text-gray-700 whitespace-pre-wrap bg-gray-50 rounded-xl p-3 leading-relaxed">{ticket.description}</p>
        </div>
      )}

      {/* Article lié */}
      {(ticket.linkedArticleId || linkedArticle) && (
        <div className="mb-4">
          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1">Article lié</label>
          <a
            href={ticket.linkedArticleUrl || '#'}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-sm text-blue-600 hover:underline"
          >
            <Link2 size={13} />
            {ticket.linkedArticleTitle || linkedArticle?.title || ticket.linkedArticleId}
          </a>
        </div>
      )}

      {/* Pièces jointes */}
      {ticket.attachments?.length > 0 && (
        <div className="mb-4">
          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1">
            Pièces jointes ({ticket.attachments.length})
          </label>
          <div className="flex flex-wrap gap-2">
            {ticket.attachments.map((a, i) => (
              <a key={i} href={a.url} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1 text-xs text-blue-600 hover:underline bg-blue-50 px-2 py-1 rounded-lg">
                <Paperclip size={11} />{a.name}
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-wrap gap-2 mb-4">
        {/* Manager / SA : prendre en charge si open non assigné */}
        {(role === 'manager' || role === 'super_admin') && ticket.status === 'open' && !ticket.assigneeId && (
          <button
            onClick={handleTakeCharge}
            disabled={actionLoading}
            className="px-3 py-1.5 text-xs font-semibold bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50"
          >
            Prendre en charge
          </button>
        )}

        {/* Manager : marquer résolu + escalader L2 si in_progress level 1 */}
        {role === 'manager' && ticket.status === 'in_progress' && ticket.level === 1 && (
          <>
            <button
              onClick={handleResolve}
              disabled={actionLoading}
              className="px-3 py-1.5 text-xs font-semibold bg-green-500 text-white rounded-lg hover:bg-green-600 disabled:opacity-50 flex items-center gap-1"
            >
              <CheckCircle2 size={13} /> Marquer résolu
            </button>
            <button
              onClick={handleEscalate}
              disabled={actionLoading}
              className="px-3 py-1.5 text-xs font-semibold bg-orange-500 text-white rounded-lg hover:bg-orange-600 disabled:opacity-50 flex items-center gap-1"
            >
              <ArrowUpRight size={13} /> Escalader L2
            </button>
          </>
        )}

        {/* Super Admin : marquer résolu + fermer */}
        {role === 'super_admin' && (ticket.status === 'open' || ticket.status === 'in_progress') && (
          <>
            <button
              onClick={handleResolve}
              disabled={actionLoading}
              className="px-3 py-1.5 text-xs font-semibold bg-green-500 text-white rounded-lg hover:bg-green-600 disabled:opacity-50 flex items-center gap-1"
            >
              <CheckCircle2 size={13} /> Marquer résolu
            </button>
            <button
              onClick={handleClose}
              disabled={actionLoading}
              className="px-3 py-1.5 text-xs font-semibold bg-gray-500 text-white rounded-lg hover:bg-gray-600 disabled:opacity-50"
            >
              Fermer
            </button>
          </>
        )}

        {/* Créateur : confirmer résolu ou rouvrir si resolved */}
        {isCreator && ticket.status === 'resolved' && (
          <>
            <button
              onClick={handleConfirmResolved}
              disabled={actionLoading}
              className="px-3 py-1.5 text-xs font-semibold bg-green-500 text-white rounded-lg hover:bg-green-600 disabled:opacity-50 flex items-center gap-1"
            >
              <CheckCircle2 size={13} /> Confirmer résolu
            </button>
            <button
              onClick={handleReopen}
              disabled={actionLoading}
              className="px-3 py-1.5 text-xs font-semibold bg-yellow-500 text-white rounded-lg hover:bg-yellow-600 disabled:opacity-50 flex items-center gap-1"
            >
              <RefreshCw size={13} /> Rouvrir
            </button>
          </>
        )}
      </div>

      {/* Commentaires */}
      <CommentThread
        ticket={ticket}
        currentUser={currentUser}
        onCommentAdded={handleCommentAdded}
      />
    </motion.div>
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
      // Chercher un manager pour l'assignation
      const managers = users.filter(u => u.role === 'manager');
      const assignee = managers[0] || null;

      // Upload pièces jointes
      const tmpId = `tmp_${Date.now()}`;
      let attachments = [];
      for (const f of files) {
        try {
          const att = await uploadTicketFile(tmpId, f);
          attachments.push(att);
        } catch { /* ignore */ }
      }

      const linkedArticle = history.find(a => a.id === linkedArticleId);
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
        attachments,
      };

      const id = await createTicket(ticketData);
      const newTicket = { id, ...ticketData, status: 'open', level: 1, commentCount: 0, createdAt: Date.now(), updatedAt: Date.now(), resolvedAt: null, closedAt: null };

      // Notifier managers + super admins
      const toNotify = users.filter(u => u.role === 'manager' || u.role === 'super_admin');
      for (const u of toNotify) {
        await createNotification({
          toUserId: u.id || u.uid,
          fromUsername: currentUser.username,
          type: 'new_ticket',
          ticketId: id,
          ticketTitle: title.trim(),
          message: `Nouveau ticket de ${currentUser.username} : "${title.trim()}"`,
        });
      }

      onCreated(newTicket);
      toast.success('Ticket créé avec succès');
      onClose();
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

// ─── Page principale ──────────────────────────────────────────────────────────

export default function Tickets() {
  const dispatch = useDispatch();
  const auth = useSelector(s => s.auth);
  const users = useSelector(s => s.users.list);
  const history = useSelector(s => s.articles.history);
  const tickets = useSelector(s => s.tickets.list);

  const [loading, setLoading] = useState(false);
  const [selectedTicket, setSelectedTicket] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterCategory, setFilterCategory] = useState('all');
  const [filterPriority, setFilterPriority] = useState('all');

  const currentUser = {
    uid: auth.uid,
    username: auth.username,
    role: auth.role,
  };

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

  // Filtrage
  const filtered = tickets.filter(t => {
    if (filterStatus !== 'all' && t.status !== filterStatus) return false;
    if (filterCategory !== 'all' && t.category !== filterCategory) return false;
    if (filterPriority !== 'all' && t.priority !== filterPriority) return false;
    if (search && !t.title?.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  // Stats
  const stats = {
    open: tickets.filter(t => t.status === 'open').length,
    in_progress: tickets.filter(t => t.status === 'in_progress').length,
    resolved: tickets.filter(t => t.status === 'resolved').length,
    closed: tickets.filter(t => t.status === 'closed').length,
  };

  const handleTicketCreated = (newTicket) => {
    dispatch(addTicket(newTicket));
    setSelectedTicket(newTicket);
  };

  const handleTicketUpdate = (updated) => {
    setSelectedTicket(updated);
  };

  const canCreate = auth.role === 'cq_ia' || auth.role === 'manager' || auth.role === 'super_admin';

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2">
          <Bug size={22} className="text-blue-500" />
          <h1 className="text-2xl font-bold text-gray-900">Tickets</h1>
        </div>
        {canCreate && (
          <button
            onClick={() => setShowModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-xl text-sm font-semibold hover:bg-blue-600 transition-colors shadow-sm"
          >
            <Plus size={16} /> Nouveau ticket
          </button>
        )}
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-4 gap-3 mb-5">
        {[
          { key: 'open', label: 'Ouverts', icon: AlertCircle, color: 'text-yellow-600 bg-yellow-50', count: stats.open },
          { key: 'in_progress', label: 'En cours', icon: Clock, color: 'text-blue-600 bg-blue-50', count: stats.in_progress },
          { key: 'resolved', label: 'Résolus', icon: CheckCircle2, color: 'text-green-600 bg-green-50', count: stats.resolved },
          { key: 'closed', label: 'Fermés', icon: X, color: 'text-gray-500 bg-gray-50', count: stats.closed },
        ].map(({ key, label, icon: Icon, color, count }) => (
          <button
            key={key}
            onClick={() => setFilterStatus(filterStatus === key ? 'all' : key)}
            className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border transition-all ${
              filterStatus === key ? 'border-current shadow-sm' : 'border-transparent'
            } ${color} hover:shadow-sm`}
          >
            <Icon size={16} />
            <div className="text-left">
              <p className="text-lg font-bold leading-none">{count}</p>
              <p className="text-[11px] opacity-75 leading-none mt-0.5">{label}</p>
            </div>
          </button>
        ))}
      </div>

      {/* Filtres */}
      <div className="flex flex-wrap gap-2 mb-4">
        <div className="relative flex-1 min-w-32">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Rechercher..."
            className="w-full text-sm border border-gray-200 rounded-xl pl-8 pr-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-200"
          />
        </div>
        <select
          value={filterCategory}
          onChange={e => setFilterCategory(e.target.value)}
          className="text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-200 bg-white"
        >
          <option value="all">Toutes catégories</option>
          {Object.entries(CATEGORIES).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>
        <select
          value={filterPriority}
          onChange={e => setFilterPriority(e.target.value)}
          className="text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-200 bg-white"
        >
          <option value="all">Toutes priorités</option>
          {Object.entries(PRIORITIES).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>
      </div>

      {/* Layout liste + détail */}
      <div className="flex gap-4 flex-1 min-h-0">
        {/* Liste */}
        <div className={`flex flex-col ${selectedTicket ? 'w-2/5' : 'w-full'} transition-all overflow-y-auto`}>
          {loading && (
            <div className="flex items-center justify-center py-12 text-gray-400">
              <Clock size={20} className="animate-spin mr-2" /> Chargement...
            </div>
          )}
          {!loading && filtered.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-gray-400">
              <Bug size={36} className="mb-3 opacity-30" />
              <p className="text-sm">Aucun ticket trouvé</p>
            </div>
          )}
          {!loading && filtered.map(ticket => (
            <TicketCard
              key={ticket.id}
              ticket={ticket}
              selected={selectedTicket?.id === ticket.id}
              onClick={() => setSelectedTicket(ticket)}
            />
          ))}
        </div>

        {/* Détail */}
        <AnimatePresence>
          {selectedTicket && (
            <motion.div
              key={selectedTicket.id}
              initial={{ opacity: 0, width: 0 }}
              animate={{ opacity: 1, width: '60%' }}
              exit={{ opacity: 0, width: 0 }}
              className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 overflow-y-auto flex-shrink-0"
              style={{ maxHeight: '100%' }}
            >
              <TicketDetail
                ticket={selectedTicket}
                onClose={() => setSelectedTicket(null)}
                onUpdate={handleTicketUpdate}
                currentUser={currentUser}
                users={users}
                history={history}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

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
