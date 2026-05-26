import { useState, useEffect, useRef } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { useLocation } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';
import axios from 'axios';
import { setProfile } from '../../store/slices/authSlice';
import { AccountAvatar } from '../account/MonComptePanel';
import MonComptePanel from '../account/MonComptePanel';

// Titre affiché dans la barre selon la route active
const PAGE_LABELS = {
  '/':               'Faire une MAJ',
  '/maj-en-attente': 'MAJ en attente',
  '/skills':         'Skills IA',
  '/wordpress':      'WordPress',
  '/historique':     'Historique',
  '/equipe':         'Équipe',
  '/parametres':     'Paramètres',
  '/dashboard':      'Dashboard',
};

export default function Header() {
  const dispatch  = useDispatch();
  const auth      = useSelector(s => s.auth);
  const location  = useLocation();
  const [open, setOpen] = useState(false);
  const wrapRef   = useRef(null);

  const pageLabel = PAGE_LABELS[location.pathname] || 'TONTON AI';

  // Charger le profil dès l'authentification
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
    <header style={{
      height: 54,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0 28px',
      // Même glass que la sidebar
      background: 'rgba(255,255,255,0.72)',
      backdropFilter: 'blur(20px)',
      WebkitBackdropFilter: 'blur(20px)',
      boxShadow: '0 1px 0 rgba(0,0,0,0.06)',
      position: 'sticky',
      top: 0,
      zIndex: 100,
      flexShrink: 0,
    }}>

      {/* Titre page */}
      <span style={{ fontSize: 13, fontWeight: 600, color: '#888', letterSpacing: '0.01em' }}>
        {pageLabel}
      </span>

      {/* Bouton Mon Compte — style pill cohérent avec sidebar */}
      <div ref={wrapRef} style={{ position: 'relative' }}>
        <button
          onClick={() => setOpen(v => !v)}
          style={{
            display: 'flex', alignItems: 'center', gap: 9,
            background: open
              ? 'rgba(0,0,0,0.07)'
              : 'rgba(255,255,255,0.85)',
            border: '1px solid rgba(0,0,0,0.09)',
            borderRadius: 999,
            padding: '4px 14px 4px 5px',
            cursor: 'pointer',
            transition: 'background 0.15s, box-shadow 0.15s',
            boxShadow: open
              ? 'none'
              : '0 1px 4px rgba(0,0,0,0.07)',
          }}
          onMouseEnter={e => {
            if (!open) {
              e.currentTarget.style.background = 'rgba(0,0,0,0.05)';
              e.currentTarget.style.boxShadow = 'none';
            }
          }}
          onMouseLeave={e => {
            if (!open) {
              e.currentTarget.style.background = 'rgba(255,255,255,0.85)';
              e.currentTarget.style.boxShadow = '0 1px 4px rgba(0,0,0,0.07)';
            }
          }}
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
          {open && <MonComptePanel onClose={() => setOpen(false)} />}
        </AnimatePresence>
      </div>
    </header>
  );
}
