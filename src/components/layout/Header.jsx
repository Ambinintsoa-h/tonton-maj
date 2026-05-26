import { useState, useEffect, useRef } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { AnimatePresence } from 'framer-motion';
import axios from 'axios';
import { setProfile } from '../../store/slices/authSlice';
import { AccountAvatar } from '../account/MonComptePanel';
import MonComptePanel from '../account/MonComptePanel';

export default function Header() {
  const dispatch = useDispatch();
  const auth     = useSelector(s => s.auth);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  // Charger le profil dès l'authentification
  useEffect(() => {
    if (!auth.isAuthenticated) return;
    axios.get('/api/account')
      .then(({ data }) => dispatch(setProfile(data)))
      .catch(() => {});
  }, [auth.isAuthenticated, dispatch]);

  return (
    <header style={{
      height: 56,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'flex-end',
      padding: '0 24px',
      borderBottom: '1px solid rgba(0,0,0,0.05)',
      background: 'rgba(255,255,255,0.6)',
      backdropFilter: 'blur(12px)',
      position: 'sticky',
      top: 0,
      zIndex: 100,
      flexShrink: 0,
    }}>
      {/* Bouton Mon Compte */}
      <div ref={wrapRef} style={{ position: 'relative' }}>
        <button
          onClick={() => setOpen(v => !v)}
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            background: open ? 'rgba(0,0,0,0.06)' : 'rgba(0,0,0,0.03)',
            border: '1px solid rgba(0,0,0,0.08)',
            borderRadius: 999,
            padding: '5px 12px 5px 6px',
            cursor: 'pointer',
            transition: 'background 0.15s',
          }}
          onMouseEnter={e => { if (!open) e.currentTarget.style.background = 'rgba(0,0,0,0.06)'; }}
          onMouseLeave={e => { if (!open) e.currentTarget.style.background = 'rgba(0,0,0,0.03)'; }}
        >
          <AccountAvatar
            avatarUrl={auth.avatarUrl}
            prenom={auth.prenom}
            nom={auth.nom}
            username={auth.username}
            size={28}
          />
          <span style={{ fontSize: 13, fontWeight: 600, color: '#333', maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {auth.prenom || auth.nom ? `${auth.prenom || ''} ${auth.nom || ''}`.trim() : auth.username}
          </span>
        </button>

        <AnimatePresence>
          {open && <MonComptePanel onClose={() => setOpen(false)} />}
        </AnimatePresence>
      </div>
    </header>
  );
}
