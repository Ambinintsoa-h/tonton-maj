import { useRef, useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Bug, MessageSquare, ArrowUpRight, CheckCircle2,
  Bell, Check, CheckCheck, X, Sparkles,
} from 'lucide-react';
import { markRead, markAllRead } from '../../store/slices/notificationsSlice';
import { markNotificationRead, markAllNotificationsRead } from '../../services/firebase';

// ─── Icône selon le type de notification ─────────────────────────────────────
function NotifIcon({ type }) {
  const map = {
    new_ticket:    { icon: Bug,            bg: 'bg-blue-100',   color: 'text-blue-500'   },
    new_comment:   { icon: MessageSquare,  bg: 'bg-purple-100', color: 'text-purple-500' },
    escalade_l2:   { icon: ArrowUpRight,   bg: 'bg-orange-100', color: 'text-orange-500' },
    status_change: { icon: CheckCircle2,   bg: 'bg-green-100',  color: 'text-green-500'  },
    maj_ready:     { icon: Sparkles,       bg: 'bg-indigo-100', color: 'text-indigo-500' },
  };
  const { icon: Icon, bg, color } = map[type] || { icon: Bell, bg: 'bg-gray-100', color: 'text-gray-500' };
  return (
    <div className={`w-8 h-8 rounded-full ${bg} flex items-center justify-center flex-shrink-0`}>
      <Icon size={14} className={color} />
    </div>
  );
}

// ─── Date relative ────────────────────────────────────────────────────────────
function timeAgo(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1)  return 'à l\'instant';
  if (m < 60) return `il y a ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `il y a ${h}h`;
  return `il y a ${Math.floor(h / 24)}j`;
}

// ─── Panneau de notifications ─────────────────────────────────────────────────
export default function NotificationPanel({ onClose }) {
  const dispatch    = useDispatch();
  const navigate    = useNavigate();
  const panelRef    = useRef(null);
  const auth        = useSelector(s => s.auth);
  const { list, unreadCount } = useSelector(s => s.notifications);

  // Fermer sur clic extérieur
  useEffect(() => {
    const handler = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  const handleMarkRead = async (notif) => {
    if (notif.read) return;
    dispatch(markRead(notif.id));
    await markNotificationRead(notif.id).catch(() => {});
  };

  const handleMarkAllRead = async () => {
    dispatch(markAllRead());
    const userId = auth.uid || auth.username;
    await markAllNotificationsRead(userId).catch(() => {});
  };

  const handleClick = async (notif) => {
    await handleMarkRead(notif);
    if (notif.ticketId) {
      navigate('/tickets', { state: { openTicketId: notif.ticketId } });
    } else if (notif.type === 'maj_ready') {
      // Analyse prête à valider → file des MAJ (onglet À valider)
      navigate('/maj-en-attente');
    }
    onClose();
  };

  return (
    <motion.div
      ref={panelRef}
      initial={{ opacity: 0, scale: 0.95, y: -8 }}
      animate={{ opacity: 1, scale: 1,    y: 0  }}
      exit={   { opacity: 0, scale: 0.95, y: -8 }}
      transition={{ duration: 0.15, ease: 'easeOut' }}
      style={{
        position: 'absolute', top: 'calc(100% + 8px)', right: 0,
        width: 340,
        background: 'rgba(255,255,255,0.97)',
        backdropFilter: 'blur(20px)',
        border: '1px solid rgba(0,0,0,0.08)',
        borderRadius: 20,
        boxShadow: '0 8px 40px rgba(0,0,0,0.12)',
        zIndex: 9999,
        overflow: 'hidden',
      }}
    >
      {/* ── En-tête ── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '14px 16px 10px',
        borderBottom: '1px solid rgba(0,0,0,0.06)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <Bell size={15} style={{ color: '#555' }} />
          <span style={{ fontWeight: 700, fontSize: 14, color: '#111' }}>Notifications</span>
          {unreadCount > 0 && (
            <span style={{
              fontSize: 11, fontWeight: 700, background: '#ef4444', color: '#fff',
              borderRadius: 99, padding: '1px 6px', lineHeight: '18px',
            }}>
              {unreadCount}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {unreadCount > 0 && (
            <button
              onClick={handleMarkAllRead}
              title="Tout marquer comme lu"
              style={{
                display: 'flex', alignItems: 'center', gap: 4,
                fontSize: 11, color: '#666', background: 'none', border: 'none',
                cursor: 'pointer', padding: '3px 8px', borderRadius: 8,
                fontFamily: 'inherit',
              }}
              onMouseEnter={e => e.currentTarget.style.background = '#f3f4f6'}
              onMouseLeave={e => e.currentTarget.style.background = 'none'}
            >
              <CheckCheck size={13} /> Tout lire
            </button>
          )}
          <button
            onClick={onClose}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: '#bbb', padding: '3px', display: 'flex',
            }}
          >
            <X size={15} />
          </button>
        </div>
      </div>

      {/* ── Liste ── */}
      <div style={{ maxHeight: 360, overflowY: 'auto' }}>
        {list.length === 0 ? (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', padding: '32px 16px', gap: 8, color: '#ccc',
          }}>
            <Bell size={28} />
            <p style={{ fontSize: 13, margin: 0 }}>Aucune notification</p>
          </div>
        ) : (
          list.map(notif => (
            <div
              key={notif.id}
              onClick={() => handleClick(notif)}
              style={{
                display: 'flex', alignItems: 'flex-start', gap: 10,
                padding: '10px 14px',
                background: notif.read ? 'transparent' : 'rgba(59,130,246,0.05)',
                borderBottom: '1px solid rgba(0,0,0,0.04)',
                cursor: 'pointer',
                transition: 'background 0.12s',
                position: 'relative',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = notif.read ? '#f9fafb' : 'rgba(59,130,246,0.08)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = notif.read ? 'transparent' : 'rgba(59,130,246,0.05)'; }}
            >
              {/* Point non-lu */}
              {!notif.read && (
                <div style={{
                  position: 'absolute', top: 14, left: 4,
                  width: 6, height: 6, borderRadius: '50%', background: '#3b82f6',
                }} />
              )}

              <NotifIcon type={notif.type} />

              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{
                  margin: '0 0 2px', fontSize: 12.5, color: '#222',
                  lineHeight: 1.4,
                  fontWeight: notif.read ? 400 : 600,
                  overflow: 'hidden', textOverflow: 'ellipsis',
                  display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                }}>
                  {notif.message}
                </p>
                <span style={{ fontSize: 11, color: '#aaa' }}>{timeAgo(notif.createdAt)}</span>
              </div>

              {/* Bouton marquer comme lu */}
              {!notif.read && (
                <button
                  onClick={e => { e.stopPropagation(); handleMarkRead(notif); }}
                  title="Marquer comme lu"
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: '#bbb', padding: '2px', display: 'flex', flexShrink: 0,
                    borderRadius: 6,
                  }}
                  onMouseEnter={e => { e.currentTarget.style.color = '#3b82f6'; e.currentTarget.style.background = '#eff6ff'; }}
                  onMouseLeave={e => { e.currentTarget.style.color = '#bbb'; e.currentTarget.style.background = 'none'; }}
                >
                  <Check size={14} />
                </button>
              )}
            </div>
          ))
        )}
      </div>
    </motion.div>
  );
}
