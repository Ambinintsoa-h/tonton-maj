import { useState, useEffect, useRef } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { useLocation } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';
import axios from 'axios';
import { setProfile } from '../../store/slices/authSlice';
import { AccountAvatar } from '../account/MonComptePanel';
import MonComptePanel from '../account/MonComptePanel';

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
    /* Wrapper sticky transparent — le padding crée l'espace autour de la barre */
    <div style={{
      padding: '12px 16px 0',
      position: 'sticky',
      top: 0,
      zIndex: 100,
      flexShrink: 0,
      pointerEvents: 'none', // laisse passer les clics dans le vide autour
    }}>
      {/* Barre flottante arrondie */}
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
      }}>

        {/* Titre de la page */}
        <span style={{ fontSize: 13, fontWeight: 600, color: '#999', letterSpacing: '0.01em' }}>
          {pageLabel}
        </span>

        {/* Bouton Mon Compte */}
        <div ref={wrapRef} style={{ position: 'relative' }}>
          <button
            onClick={() => setOpen(v => !v)}
            style={{
              display: 'flex', alignItems: 'center', gap: 9,
              background: open ? 'rgba(0,0,0,0.06)' : 'transparent',
              border: 'none',
              borderRadius: 999,
              padding: '4px 10px 4px 4px',
              cursor: 'pointer',
              transition: 'background 0.15s',
            }}
            onMouseEnter={e => { if (!open) e.currentTarget.style.background = 'rgba(0,0,0,0.05)'; }}
            onMouseLeave={e => { if (!open) e.currentTarget.style.background = 'transparent'; }}
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
      </div>
    </div>
  );
}
