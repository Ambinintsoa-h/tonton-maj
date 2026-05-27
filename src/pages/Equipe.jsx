import { useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { motion, AnimatePresence } from 'framer-motion';
import toast from 'react-hot-toast';
import axios from 'axios';
import {
  Users, Plus, Trash2, Edit3, Save, X,
  Mail, Phone, StickyNote, UserCheck, UserX, Search,
  Bot, UserPlus, KeyRound, Eye, EyeOff,
} from 'lucide-react';
import { addUser, updateUser, removeUser, setUsers } from '../store/slices/usersSlice';
import { saveUser, deleteUser, getUsers } from '../services/firebase';
import { IA_AGENTS } from '../constants/agents';

// ─── Rôles ───────────────────────────────────────────────────────────────────
const ROLES = {
  cq_ia: {
    label:      'CQ IA',
    description:'Contrôle qualité IA',
    badgeClass: 'bg-blue-50 text-blue-700 border border-blue-200',
    avatarClass:'bg-blue-100 text-blue-700',
    dotClass:   'bg-blue-500',
  },
  manager: {
    label:      'Manager',
    description:'Manager',
    badgeClass: 'bg-purple-50 text-purple-700 border border-purple-200',
    avatarClass:'bg-purple-100 text-purple-700',
    dotClass:   'bg-purple-500',
  },
  super_admin: {
    label:      'Super Admin',
    description:'Super Admin',
    badgeClass: 'bg-gray-900 text-white border border-gray-900',
    avatarClass:'bg-gray-900 text-white',
    dotClass:   'bg-gray-900',
  },
};

const STATUSES = {
  active:   { label: 'Actif',   cls: 'bg-emerald-50 text-emerald-700 border border-emerald-200' },
  inactive: { label: 'Inactif', cls: 'bg-gray-100 text-gray-500 border border-gray-200' },
};

const EMPTY_USER = {
  firstName: '',
  lastName:  '',
  email:     '',
  role:      'cq_ia',
  status:    'active',
  note:      '',
  password:  '',
};

// ─── Avatar initiales ─────────────────────────────────────────────────────────
function Avatar({ user, size = 'md' }) {
  const initials = [user.firstName?.[0], user.lastName?.[0]]
    .filter(Boolean).join('').toUpperCase() || '?';
  const role = ROLES[user.role] || ROLES.cq_ia;
  const sizeMap = { sm: 'w-8 h-8 text-xs', md: 'w-10 h-10 text-sm', lg: 'w-12 h-12 text-base' };
  return (
    <div className={`${sizeMap[size]} ${role.avatarClass} rounded-xl flex items-center justify-center font-bold flex-shrink-0`}>
      {initials}
    </div>
  );
}

// ─── Badges ───────────────────────────────────────────────────────────────────
function RoleBadge({ role }) {
  const cfg = ROLES[role] || ROLES.cq_ia;
  return (
    <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-0.5 rounded-full ${cfg.badgeClass}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dotClass}`} />
      {cfg.label}
    </span>
  );
}

function StatusBadge({ status }) {
  const cfg = STATUSES[status] || STATUSES.active;
  return (
    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${cfg.cls}`}>
      {cfg.label}
    </span>
  );
}

// ─── Formulaire ajout / édition ───────────────────────────────────────────────
function UserForm({ user, onSave, onCancel }) {
  const [form, setForm] = useState({ ...EMPTY_USER, ...user });
  const [saving, setSaving] = useState(false);
  const [showPass, setShowPass] = useState(false);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSave = async () => {
    if (!form.firstName.trim()) { toast.error('Prénom requis'); return; }
    if (!form.lastName.trim())  { toast.error('Nom requis');    return; }
    if (!form.email.trim())     { toast.error('Email requis');  return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      toast.error('Format email invalide');
      return;
    }
    if (!user.id && !form.password.trim()) { toast.error('Mot de passe requis'); return; }
    if (form.password && form.password.length < 6) { toast.error('Mot de passe trop court (6 caractères min)'); return; }
    setSaving(true);
    try {
      await onSave({ ...form, email: form.email.trim().toLowerCase() });
    } finally {
      setSaving(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="glass-card p-6 space-y-5"
    >
      {/* En-tête */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 bg-black rounded-lg flex items-center justify-center">
            <Users size={13} className="text-white" />
          </div>
          <h3 className="font-semibold text-gray-900 text-sm">
            {user.id ? 'Modifier le membre' : 'Nouveau membre'}
          </h3>
        </div>
        <button onClick={onCancel} className="btn-ghost !px-1.5 !py-1.5">
          <X size={16} />
        </button>
      </div>

      {/* Champs */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Prénom *</label>
          <input
            value={form.firstName}
            onChange={e => set('firstName', e.target.value)}
            placeholder="Marie"
            className="input-glass"
            autoFocus
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Nom *</label>
          <input
            value={form.lastName}
            onChange={e => set('lastName', e.target.value)}
            placeholder="Dupont"
            className="input-glass"
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
            Email professionnel *
            {!!user.id && form.role === 'cq_ia' && (
              <span className="ml-1.5 text-[10px] font-medium text-amber-500 normal-case tracking-normal">— non modifiable (CQ IA)</span>
            )}
          </label>
          <input
            type="email"
            value={form.email}
            onChange={e => set('email', e.target.value)}
            placeholder="marie.dupont@entreprise.fr"
            className="input-glass"
            disabled={!!user.id && form.role === 'cq_ia'}
            style={!!user.id && form.role === 'cq_ia' ? { opacity: 0.55, cursor: 'not-allowed' } : {}}
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1.5">
            <KeyRound size={11} />
            {user.id ? 'Nouveau mot de passe' : 'Mot de passe *'}
          </label>
          <div className="relative">
            <input
              type={showPass ? 'text' : 'password'}
              value={form.password}
              onChange={e => set('password', e.target.value)}
              placeholder={user.id ? 'Laisser vide pour ne pas changer' : 'Min. 6 caractères'}
              className="input-glass pr-10"
            />
            <button
              type="button"
              onClick={() => setShowPass(v => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              {showPass ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Rôle *</label>
          <select
            value={form.role}
            onChange={e => set('role', e.target.value)}
            className="input-glass"
          >
            {Object.entries(ROLES).map(([val, cfg]) => (
              <option key={val} value={val}>{cfg.description}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Statut</label>
          <select
            value={form.status}
            onChange={e => set('status', e.target.value)}
            className="input-glass"
          >
            <option value="active">Actif</option>
            <option value="inactive">Inactif</option>
          </select>
        </div>
      </div>

      {/* Note pleine largeur */}
      <div className="space-y-1.5">
        <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Note interne</label>
        <textarea
          value={form.note}
          onChange={e => set('note', e.target.value)}
          placeholder="Spécialité, disponibilité, remarques…"
          rows={3}
          className="input-glass resize-none"
        />
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between pt-1 border-t border-gray-100">
        <button onClick={onCancel} className="btn-ghost">Annuler</button>
        <button onClick={handleSave} disabled={saving} className="btn-primary disabled:opacity-50">
          <Save size={14} />
          {saving ? 'Enregistrement…' : 'Enregistrer'}
        </button>
      </div>
    </motion.div>
  );
}

// ─── Carte membre ─────────────────────────────────────────────────────────────
function UserCard({ user, onEdit, onDelete, isSuperAdmin }) {
  const [showPass, setShowPass] = useState(false);
  const createdDate = user.createdAt
    ? new Date(user.createdAt).toLocaleDateString('fr-FR', {
        day: 'numeric', month: 'short', year: 'numeric',
      })
    : null;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="glass-card p-5 flex items-start gap-4 group"
    >
      <Avatar user={user} size="lg" />

      <div className="flex-1 min-w-0">
        {/* Nom + badges */}
        <div className="flex items-center gap-2 flex-wrap">
          <p className="font-semibold text-gray-900 text-sm">
            {user.firstName} {user.lastName}
          </p>
          <RoleBadge role={user.role} />
          <StatusBadge status={user.status} />
        </div>

        {/* Email */}
        <div className="flex items-center gap-1.5 mt-1.5">
          <Mail size={12} className="text-gray-400 flex-shrink-0" />
          <a
            href={`mailto:${user.email}`}
            className="text-xs text-gray-500 hover:text-gray-900 transition-colors truncate"
          >
            {user.email}
          </a>
        </div>

        {/* Mot de passe — visible super_admin uniquement */}
        {isSuperAdmin && user.password && (
          <div className="flex items-center gap-1.5 mt-1">
            <KeyRound size={12} className="text-gray-400 flex-shrink-0" />
            <span className="text-xs font-mono text-gray-500 tracking-wide">
              {showPass ? user.password : '••••••••'}
            </span>
            <button
              onClick={() => setShowPass(v => !v)}
              className="text-gray-400 hover:text-gray-700 transition-colors"
            >
              {showPass ? <EyeOff size={11} /> : <Eye size={11} />}
            </button>
          </div>
        )}

        {/* Téléphone */}
        {user.phone && (
          <div className="flex items-center gap-1.5 mt-1">
            <Phone size={12} className="text-gray-400 flex-shrink-0" />
            <span className="text-xs text-gray-500">{user.phone}</span>
          </div>
        )}

        {/* Note */}
        {user.note && (
          <div className="flex items-start gap-1.5 mt-1.5">
            <StickyNote size={12} className="text-gray-400 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-gray-400 leading-relaxed line-clamp-2">{user.note}</p>
          </div>
        )}

        {/* Date ajout */}
        {createdDate && (
          <p className="text-[11px] text-gray-300 mt-2">Ajouté le {createdDate}</p>
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={() => onEdit(user)}
          className="btn-ghost !px-1.5 !py-1.5"
          title="Modifier"
        >
          <Edit3 size={14} />
        </button>
        <button
          onClick={() => onDelete(user.id)}
          className="btn-ghost !px-1.5 !py-1.5 hover:!text-red-500"
          title="Supprimer"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </motion.div>
  );
}

// ─── Stats équipe ─────────────────────────────────────────────────────────────
function TeamStats({ users }) {
  const active  = users.filter(u => u.status === 'active').length;
  const cqCount = users.filter(u => u.role === 'cq_ia').length;
  const mgCount = users.filter(u => u.role === 'manager' || u.role === 'super_admin').length;

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {[
        { label: 'Total membres', value: users.length,  color: 'text-gray-900'    },
        { label: 'Actifs',        value: active,         color: 'text-emerald-600' },
        { label: 'CQ IA',         value: cqCount,        color: 'text-blue-600'    },
        { label: 'Managers',      value: mgCount,        color: 'text-purple-600'  },
      ].map(s => (
        <div key={s.label} className="glass-card px-4 py-3 text-center">
          <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
          <p className="text-[11px] text-gray-400 mt-0.5">{s.label}</p>
        </div>
      ))}
    </div>
  );
}

// ─── Agents IA — données centralisées dans src/constants/agents.js ───────────

function AgentCard({ agent }) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-card p-5 flex items-start gap-4"
    >
      {/* Avatar emoji */}
      <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 text-2xl ${agent.avatarCls}`}>
        {agent.emoji}
      </div>

      <div className="flex-1 min-w-0">
        {/* Nom · pseudo + badges */}
        <div className="flex items-center gap-2 flex-wrap">
          <p className="font-bold text-gray-900 text-sm">
            {agent.name}
            <span className="font-normal text-gray-400 ml-1">· {agent.pseudo}</span>
          </p>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap mt-1">
          <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${agent.badgeCls}`}>
            {agent.roleLabel}
          </span>
          <span className="flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            En service
          </span>
        </div>

        {/* Description */}
        <p className="text-xs text-gray-600 mt-1.5 leading-relaxed">{agent.desc}</p>

        {/* Compétences */}
        <div className="flex flex-wrap gap-1.5 mt-2">
          {agent.skills.map(s => (
            <span key={s} className="text-[10px] font-medium bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">
              {s}
            </span>
          ))}
        </div>
      </div>

      {/* Badge IA */}
      <div className="flex items-center gap-1 text-[10px] font-semibold text-indigo-500 bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded-full flex-shrink-0 whitespace-nowrap">
        <Bot size={10} />
        Agent IA
      </div>
    </motion.div>
  );
}

// ─── Modal invitation Firebase ────────────────────────────────────────────────
const EMPTY_INVITE = {
  firstName: '',
  lastName:  '',
  email:     '',
  username:  '',
  role:      'cq_ia',
  password:  '',
};

function InviteModal({ onClose, onCreated, authRole }) {
  const [form, setForm]       = useState({ ...EMPTY_INVITE });
  const [saving, setSaving]   = useState(false);

  const set = (k, v) => setForm(f => {
    const updated = { ...f, [k]: v };
    // Auto-calcul username = prénom.nom
    if (k === 'firstName' || k === 'lastName') {
      const first = (k === 'firstName' ? v : f.firstName).toLowerCase().trim().replace(/\s+/g, '');
      const last  = (k === 'lastName'  ? v : f.lastName ).toLowerCase().trim().replace(/\s+/g, '');
      updated.username = first && last ? `${first}.${last}` : first || last;
    }
    return updated;
  });

  const handleCreate = async () => {
    if (!form.firstName.trim()) { toast.error('Prénom requis'); return; }
    if (!form.lastName.trim())  { toast.error('Nom requis');    return; }
    if (!form.email.trim())     { toast.error('Email requis');  return; }
    if (!form.password.trim())  { toast.error('Mot de passe temporaire requis'); return; }
    if (form.password.length < 6) { toast.error('Mot de passe trop court (6 caractères min)'); return; }
    setSaving(true);
    try {
      await axios.post('/api/users/create', {
        firstName: form.firstName.trim(),
        lastName:  form.lastName.trim(),
        email:     form.email.trim().toLowerCase(),
        username:  form.username.trim().toLowerCase(),
        role:      form.role,
        password:  form.password,
      });
      toast.success(`Compte créé pour ${form.firstName} ${form.lastName}`);
      onCreated();
      onClose();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Erreur création compte');
    } finally {
      setSaving(false);
    }
  };

  // Manager ne peut créer que des cq_ia
  const availableRoles = authRole === 'manager'
    ? { cq_ia: ROLES.cq_ia }
    : { cq_ia: ROLES.cq_ia, manager: ROLES.manager };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.35)', backdropFilter: 'blur(4px)' }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96 }}
        className="glass-card p-6 w-full max-w-lg space-y-5"
      >
        {/* En-tête */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 bg-black rounded-lg flex items-center justify-center">
              <UserPlus size={13} className="text-white" />
            </div>
            <h3 className="font-semibold text-gray-900 text-sm">Inviter un membre</h3>
          </div>
          <button onClick={onClose} className="btn-ghost !px-1.5 !py-1.5"><X size={16} /></button>
        </div>

        {/* Champs */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Prénom *</label>
            <input value={form.firstName} onChange={e => set('firstName', e.target.value)} placeholder="Marie" className="input-glass" autoFocus />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Nom *</label>
            <input value={form.lastName} onChange={e => set('lastName', e.target.value)} placeholder="Dupont" className="input-glass" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Email *</label>
            <input type="email" value={form.email} onChange={e => set('email', e.target.value)} placeholder="marie.dupont@publithings.com" className="input-glass" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Identifiant (username)</label>
            <input value={form.username} onChange={e => set('username', e.target.value)} placeholder="marie.dupont" className="input-glass" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Rôle *</label>
            <select value={form.role} onChange={e => set('role', e.target.value)} className="input-glass">
              {Object.entries(availableRoles).map(([val, cfg]) => (
                <option key={val} value={val}>{cfg.description}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1.5">
              <KeyRound size={11} />
              Mot de passe temporaire *
            </label>
            <input type="password" value={form.password} onChange={e => set('password', e.target.value)} placeholder="Min. 6 caractères" className="input-glass" />
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between pt-1 border-t border-gray-100">
          <button onClick={onClose} className="btn-ghost">Annuler</button>
          <button onClick={handleCreate} disabled={saving} className="btn-primary disabled:opacity-50">
            <UserPlus size={14} />
            {saving ? 'Création…' : 'Créer le compte'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ─── Page principale ──────────────────────────────────────────────────────────
const FILTER_TABS = [
  { key: 'all',         label: 'Tous'         },
  { key: 'active',      label: 'Actifs'       },
  { key: 'inactive',    label: 'Inactifs'     },
  { key: 'cq_ia',       label: 'CQ IA'        },
  { key: 'manager',     label: 'Managers'     },
  { key: 'super_admin', label: 'Super Admins' },
];

export default function Equipe() {
  const dispatch      = useDispatch();
  const users         = useSelector(s => s.users.list);
  const firebaseReady = useSelector(s => s.settings.firebaseReady);
  const authRole      = useSelector(s => s.auth.role);

  const [editing,     setEditing]     = useState(null);
  const [showNew,     setShowNew]     = useState(false);
  const [showInvite,  setShowInvite]  = useState(false);
  const [filter,      setFilter]      = useState('all');
  const [search,      setSearch]      = useState('');

  // ── Sauvegarde ──
  const handleSave = async (user) => {
    if (firebaseReady) {
      try {
        const id = await saveUser(user);
        if (user.id) dispatch(updateUser({ ...user, id }));
        else         dispatch(addUser({ ...user, id }));
      } catch {
        if (user.id) dispatch(updateUser(user));
        else         dispatch(addUser({ ...user, id: Date.now().toString() }));
      }
    } else {
      if (user.id) dispatch(updateUser(user));
      else         dispatch(addUser({ ...user, id: Date.now().toString() }));
    }
    toast.success(user.id ? 'Membre mis à jour !' : 'Membre ajouté !');
    setEditing(null);
    setShowNew(false);
  };

  // ── Suppression ──
  const handleDelete = async (id) => {
    if (firebaseReady) { try { await deleteUser(id); } catch {} }
    dispatch(removeUser(id));
    toast.success('Membre supprimé');
  };

  // ── Rechargement des membres depuis Firestore après création Firebase ──
  const handleInviteCreated = async () => {
    if (firebaseReady) {
      try {
        const freshUsers = await getUsers();
        dispatch(setUsers(freshUsers));
      } catch {}
    }
  };

  // ── Filtrage + recherche ──
  const displayed = users.filter(u => {
    const matchFilter =
      filter === 'all'      ? true :
      filter === 'active'   ? u.status === 'active' :
      filter === 'inactive' ? u.status === 'inactive' :
      u.role === filter;

    const q = search.trim().toLowerCase();
    const matchSearch = !q || [u.firstName, u.lastName, u.email, u.phone, u.note]
      .some(f => (f || '').toLowerCase().includes(q));

    return matchFilter && matchSearch;
  });

  return (
    <div className="space-y-6 animate-fade-in">

      {/* En-tête */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Équipe</h1>
          <p className="text-sm text-gray-500 mt-1">
            Gérez les membres de votre équipe et leurs rôles
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowInvite(true)}
            className="btn-primary"
          >
            <UserPlus size={15} />
            Inviter un membre
          </button>
          <button
            onClick={() => { setShowNew(true); setEditing(null); }}
            className="btn-ghost"
          >
            <Plus size={15} />
            Fiche locale
          </button>
        </div>
      </div>

      {/* Modal invitation Firebase */}
      <AnimatePresence>
        {showInvite && (
          <InviteModal
            key="invite-modal"
            onClose={() => setShowInvite(false)}
            onCreated={handleInviteCreated}
            authRole={authRole}
          />
        )}
      </AnimatePresence>

      {/* Stats */}
      {users.length > 0 && <TeamStats users={users} />}

      {/* Formulaire */}
      <AnimatePresence>
        {(showNew || editing) && (
          <UserForm
            key={editing?.id || 'new'}
            user={editing || EMPTY_USER}
            onSave={handleSave}
            onCancel={() => { setEditing(null); setShowNew(false); }}
          />
        )}
      </AnimatePresence>

      {/* Barre recherche + filtres */}
      {users.length > 0 && (
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Rechercher un membre…"
              className="input-glass pl-10"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700"
              >
                <X size={14} />
              </button>
            )}
          </div>
          <div className="flex items-center gap-0.5 bg-gray-100 rounded-xl p-0.5 flex-shrink-0 flex-wrap">
            {FILTER_TABS.map(f => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={`px-3 py-1.5 text-xs rounded-lg font-medium transition-all ${
                  filter === f.key
                    ? 'bg-white shadow-sm text-gray-900'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Liste membres */}
      {displayed.length > 0 ? (
        <motion.div layout className="grid gap-3">
          <AnimatePresence>
            {displayed.map(user => (
              <UserCard
                key={user.id}
                user={user}
                isSuperAdmin={authRole === 'super_admin'}
                onEdit={(u) => {
                  setEditing(u);
                  setShowNew(false);
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
                onDelete={handleDelete}
              />
            ))}
          </AnimatePresence>
        </motion.div>
      ) : !showNew && filter === 'all' && !search && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-center py-10 text-gray-400"
        >
          <UserCheck size={40} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm font-medium">Aucun membre dans l'équipe</p>
          <p className="text-xs mt-1">Cliquez sur « Ajouter un membre » pour démarrer</p>
        </motion.div>
      )}

      {/* Message aucun résultat (filtres) */}
      {displayed.length === 0 && (search || filter !== 'all') && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-center py-10 text-gray-400"
        >
          <UserX size={40} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm font-medium">Aucun résultat</p>
          <p className="text-xs mt-1">Essayez un autre filtre ou terme de recherche</p>
        </motion.div>
      )}

      {/* ══ Section Agents IA ══ */}
      <section className="space-y-4 pt-4">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl flex items-center justify-center">
            <Bot size={15} className="text-white" />
          </div>
          <div>
            <h2 className="text-base font-bold text-gray-900">Agents IA</h2>
            <p className="text-xs text-gray-400">Composants automatisés intégrés au SaaS</p>
          </div>
        </div>

        <div className="grid gap-3">
          {IA_AGENTS.map(agent => (
            <AgentCard key={agent.id} agent={agent} />
          ))}
        </div>
      </section>

    </div>
  );
}
