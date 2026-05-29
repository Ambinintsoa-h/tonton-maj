import { useState, useEffect, useRef } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { useLocation } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';
import { Bell } from 'lucide-react';
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

        {/* Titre de la page */}
        <span style={{ fontSize: 13, fontWeight: 600, color: '#999', letterSpacing: '0.01em', flex: 1 }}>
          {pageLabel}
        </span>

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
