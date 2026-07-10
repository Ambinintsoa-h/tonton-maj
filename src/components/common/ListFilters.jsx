import { UserCircle2, X } from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// ListFilters — barre de filtres commune aux listes d'articles :
// Historique, Archives, MAJ en attente (et Temps équipe pour membre/période).
//   • « Par moi »  : chip rapide — mes MAJ (assigné ou dernier modificateur)
//   • Membre       : liste déroulante de l'équipe
//   • Période      : du… au… + raccourcis Aujourd'hui / 7 jours / 30 jours
// value = { member: '' | '__me__' | <userId>, from: 'YYYY-MM-DD', to: 'YYYY-MM-DD' }
// ─────────────────────────────────────────────────────────────────────────────

export const ME = '__me__';

/** Identifiants possibles d'un membre (doc Firestore, uid Firebase, username). */
export const memberIds = (u) => [u?.id, u?.uid, u?.username].filter(Boolean);

/** Nom affiché d'un membre — même logique que l'éditeur (prénom nom, sinon username). */
export const memberDisplayName = (u) =>
  [u?.firstName, u?.lastName].filter(Boolean).join(' ') || u?.username || '';

/**
 * Prédicat « appartient au membre filtré » : vrai si le membre est l'ASSIGNÉ
 * (assigneeId) OU le DERNIER MODIFICATEUR (lastModifiedBy — nom d'affichage).
 * Retourne null si aucun filtre membre actif.
 * me = { uid, username, name } (utilisateur connecté, pour « Par moi »).
 */
export const buildMemberMatcher = (filters, users, me) => {
  if (!filters.member) return null;
  let ids, names;
  if (filters.member === ME) {
    // L'assignation peut porter l'id du doc utilisateur (≠ uid) → on résout
    // aussi le doc de l'utilisateur connecté pour couvrir ses 3 identifiants.
    const self = users.find(x => memberIds(x).some(id => id === me?.uid || id === me?.username));
    ids   = [...new Set([me?.uid, me?.username, ...(self ? memberIds(self) : [])])].filter(Boolean);
    names = [me?.name, me?.username, self ? memberDisplayName(self) : ''].filter(Boolean);
  } else {
    const u = users.find(x => x.id === filters.member);
    if (!u) return null;
    ids   = memberIds(u);
    names = [memberDisplayName(u), u.username].filter(Boolean);
  }
  const lowerNames = names.map(n => String(n).trim().toLowerCase()).filter(Boolean);
  return (item) =>
    (!!item.assigneeId && ids.includes(item.assigneeId)) ||
    (!!item.lastModifiedBy && lowerNames.includes(String(item.lastModifiedBy).trim().toLowerCase()));
};

/**
 * Prédicat « dans la période du…au… » sur le timestamp retourné par getTs(item)
 * (bornes incluses, jours entiers). Retourne null si aucune date filtrée.
 */
export const buildDateMatcher = (filters, getTs) => {
  if (!filters.from && !filters.to) return null;
  const fromTs = filters.from ? new Date(`${filters.from}T00:00:00`).getTime()     : null;
  const toTs   = filters.to   ? new Date(`${filters.to}T23:59:59.999`).getTime()   : null;
  return (item) => {
    const ts = getTs(item);
    if (!ts) return false;
    if (fromTs && ts < fromTs) return false;
    if (toTs   && ts > toTs)   return false;
    return true;
  };
};

export const EMPTY_FILTERS = { member: '', from: '', to: '' };

export const hasActiveFilters = (f) => !!(f.member || f.from || f.to);

// Date locale YYYY-MM-DD (PAS toISOString : décalage UTC près de minuit)
const localIso = (d) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

const PRESETS = [
  { label: "Aujourd'hui", days: 0 },
  { label: '7 jours',     days: 6 },
  { label: '30 jours',    days: 29 },
];

const chipCls = (active) =>
  `px-2.5 py-1.5 rounded-full text-[12px] font-medium border transition-colors whitespace-nowrap ${
    active
      ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
      : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'
  }`;

export default function ListFilters({ users = [], value, onChange, showMine = true, mineLabel = 'Par moi' }) {
  const f = { ...EMPTY_FILTERS, ...value };

  const setMember = (member) => onChange({ ...f, member });
  const setRange  = (from, to) => onChange({ ...f, from, to });

  const presetActive = (days) => {
    const today = localIso(new Date());
    const start = localIso(new Date(Date.now() - days * 86400000));
    return f.from === start && f.to === today;
  };

  const applyPreset = (days) => {
    if (presetActive(days)) { setRange('', ''); return; } // re-clic → désactive
    const today = localIso(new Date());
    setRange(localIso(new Date(Date.now() - days * 86400000)), today);
  };

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* Par moi */}
      {showMine && (
        <button
          type="button"
          onClick={() => setMember(f.member === ME ? '' : ME)}
          className={chipCls(f.member === ME)}
          title="Uniquement les articles dont je suis l'assigné ou le dernier modificateur"
        >
          <UserCircle2 size={12} className="inline -mt-0.5 mr-1" />
          {mineLabel}
        </button>
      )}

      {/* Membre */}
      <select
        value={f.member === ME ? '' : f.member}
        onChange={e => setMember(e.target.value)}
        className="px-2.5 py-1.5 text-[12px] font-medium bg-white border border-gray-200 rounded-lg text-gray-600 focus:outline-none focus:ring-2 focus:ring-black/10 max-w-[180px]"
        title="Filtrer par membre (assigné ou dernier modificateur)"
      >
        <option value="">Tous les membres</option>
        {users.map(u => (
          <option key={u.id} value={u.id}>{memberDisplayName(u)}</option>
        ))}
      </select>

      {/* Période du… au… */}
      <div className="flex items-center gap-1.5">
        <input
          type="date"
          value={f.from}
          max={f.to || undefined}
          onChange={e => setRange(e.target.value, f.to)}
          className="px-2 py-1.5 text-[12px] bg-white border border-gray-200 rounded-lg text-gray-600 focus:outline-none focus:ring-2 focus:ring-black/10"
          title="Du (inclus)"
        />
        <span className="text-gray-300 text-[11px] select-none">→</span>
        <input
          type="date"
          value={f.to}
          min={f.from || undefined}
          onChange={e => setRange(f.from, e.target.value)}
          className="px-2 py-1.5 text-[12px] bg-white border border-gray-200 rounded-lg text-gray-600 focus:outline-none focus:ring-2 focus:ring-black/10"
          title="Au (inclus)"
        />
      </div>

      {/* Raccourcis */}
      {PRESETS.map(p => (
        <button key={p.label} type="button" onClick={() => applyPreset(p.days)} className={chipCls(presetActive(p.days))}>
          {p.label}
        </button>
      ))}

      {/* Réinitialiser */}
      {hasActiveFilters(f) && (
        <button
          type="button"
          onClick={() => onChange({ ...EMPTY_FILTERS })}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-full text-[12px] font-medium text-gray-400 hover:text-gray-600 hover:bg-gray-50 transition-colors"
        >
          <X size={12} /> Réinitialiser
        </button>
      )}
    </div>
  );
}
