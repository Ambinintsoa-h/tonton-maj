import { useState, useEffect, useRef } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { useLocation } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';
import { Bell, Check, Loader2, CloudOff } from 'lucide-react';
import axios from 'axios';
import { setProfile } from '../../store/slices/authSlice';
import { AccountAvatar } from '../account/MonComptePanel';
import MonComptePanel from '../account/MonComptePanel';
import NotificationPanel from '../notifications/NotificationPanel';

const PAGE_LABELS = {
  '/':               'Faire une MAJ',
  '/maj-en-attente': 'MAJ en attente',
  '/skills':         'Skills IA',
  '/wordpress':      'WordPress',
  '/historique':     'Historique',
  '/equipe':         'Équipe',
  '/parametres':     'Paramètres',
  '/dashboard':      'Dashboard',
  '/tickets':        'Tickets',
};

// Temps écoulé court et lisible (« il y a 12 s », « il y a 3 min »…)
function timeAgoShort(ts) {
  if (!ts) return '';
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 5)  return "à l'instant";
  if (s < 60) return `il y a ${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `il y a ${m} min`;
  const h = Math.floor(m / 60);
  return `il y a ${h} h`;
}

// Indicateur d'enregistrement façon Google Docs (affiché sur la page « Faire une MAJ »).
function DraftIndicator() {
  const status  = useSelector(s => s.agent?.draftStatus || 'idle');
  const savedAt = useSelector(s => s.agent?.draftSavedAt || null);
  const [, setTick] = useState(0);

  // Rafraîchit le « il y a … » périodiquement tant qu'un brouillon existe.
  useEffect(() => {
    if (status === 'idle') return undefined;
    const id = setInterval(() => setTick(n => n + 1), 15000);
    return () => clearInterval(id);
  }, [status]);

  if (status === 'idle') return null;

  const base = { display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' };

  if (status === 'saving') {
    return (
      <span style={{ ...base, color: '#9ca3af' }} title="Enregistrement du brouillon en cours…">
        <Loader2 size={12} className="animate-spin" /> Enregistrement…
      </span>
    );
  }
  if (status === 'local') {
    return (
      <span style={{ ...base, color: '#d97706' }} title="Réseau indisponible — brouillon enregistré localement (localStorage)">
        <CloudOff size={12} /> Enregistré localement {savedAt ? `· ${timeAgoShort(savedAt)}` : ''}
      </span>
    );
  }
  // 'saved'
  return (
    <span style={{ ...base, color: '#16a34a' }} title="Brouillon enregistré">
      <Check size={12} /> Brouillon enregistré {savedAt ? `· ${timeAgoShort(savedAt)}` : ''}
    </span>
  );
}

export default function Header() {
  const dispatch  = useDispatch();
  const auth      = useSelector(s => s.auth);
  const location  = useLocation();
  const unreadCount = useSelector(s => s.notifications?.unreadCount || 0);

  const [openAccount, setOpenAccount] = useState(false);
  const [openNotifs,  setOpenNotifs]  = useState(false);

  const accountRef = useRef(null);
  const notifRef   = useRef(null);

  const pageLabel = PAGE_LABELS[location.pathname] || 'TONTON AI';

  // Fermer l'autre panneau quand on en ouvre un
  const handleOpenAccount = () => { setOpenNotifs(false); setOpenAccount(v => !v); };
  const handleOpenNotifs  = () => { setOpenAccount(false); setOpenNotifs(v => !v); };

  useEffect(() => {
    if (!auth.isAuthenticated) return;
    axios.get('/api/account')
      .then(({ data }) => dispatch(setProfile(data)))
      .catch(() => {});
  }, [auth.isAuthenticated, dispatch]); // eslint-disable-line react-hooks/exhaustive-deps

  const displayName = (auth.prenom || auth.nom)
    ? `${auth.prenom || ''} ${auth.nom || ''}`.trim()
    : auth.username || '';

  return (
    <div style={{
      padding: '12px 16px 0',
      position: 'sticky',
      top: 0,
      zIndex: 100,
      flexShrink: 0,
      pointerEvents: 'none',
    }}>
      <div style={{
        height: 50,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 16px 0 20px',
        background: 'rgba(255,255,255,0.82)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderRadius: 18,
        border: '1px solid rgba(255,255,255,0.9)',
        boxShadow: '0 2px 12px rgba(0,0,0,0.07), 0 0 0 1px rgba(0,0,0,0.04)',
        pointerEvents: 'auto',
        gap: 8,
      }}>

        {/* Titre de la page + indicateur d'enregistrement (page MAJ) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#999', letterSpacing: '0.01em' }}>
            {pageLabel}
          </span>
          {location.pathname === '/' && <DraftIndicator />}
        </div>

        {/* ── Cloche notifications ── */}
        <div ref={notifRef} style={{ position: 'relative' }}>
          <button
            onClick={handleOpenNotifs}
            style={{
              position: 'relative',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 34, height: 34,
              background: openNotifs ? 'rgba(0,0,0,0.06)' : 'transparent',
              border: 'none', borderRadius: 10,
              cursor: 'pointer',
              transition: 'background 0.15s',
            }}
            onMouseEnter={e => { if (!openNotifs) e.currentTarget.style.background = 'rgba(0,0,0,0.05)'; }}
            onMouseLeave={e => { if (!openNotifs) e.currentTarget.style.background = 'transparent'; }}
          >
            <Bell size={17} style={{ color: '#555' }} />
            {/* Badge */}
            {unreadCount > 0 && (
              <span style={{
                position: 'absolute', top: 3, right: 3,
                minWidth: 16, height: 16,
                background: '#ef4444', color: '#fff',
                borderRadius: 99, fontSize: 9, fontWeight: 800,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                padding: '0 3px',
                lineHeight: 1,
                border: '1.5px solid #fff',
              }}>
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </button>

          <AnimatePresence>
            {openNotifs && <NotificationPanel onClose={() => setOpenNotifs(false)} />}
          </AnimatePresence>
        </div>

        {/* ── Bouton Mon Compte ── */}
        <div ref={accountRef} style={{ position: 'relative' }}>
          <button
            onClick={handleOpenAccount}
            style={{
              display: 'flex', alignItems: 'center', gap: 9,
              background: openAccount ? 'rgba(0,0,0,0.06)' : 'transparent',
              border: 'none',
              borderRadius: 999,
              padding: '4px 10px 4px 4px',
              cursor: 'pointer',
              transition: 'background 0.15s',
            }}
            onMouseEnter={e => { if (!openAccount) e.currentTarget.style.background = 'rgba(0,0,0,0.05)'; }}
            onMouseLeave={e => { if (!openAccount) e.currentTarget.style.background = 'transparent'; }}
          >
            <AccountAvatar
              avatarUrl={auth.avatarUrl}
              prenom={auth.prenom}
              nom={auth.nom}
              username={auth.username}
              size={30}
            />
            <span style={{
              fontSize: 13, fontWeight: 600, color: '#222',
              maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {displayName}
            </span>
          </button>

          <AnimatePresence>
            {openAccount && <MonComptePanel onClose={() => setOpenAccount(false)} />}
          </AnimatePresence>
        </div>

      </div>
    </div>
  );
}
