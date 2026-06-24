import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useSelector, useDispatch } from 'react-redux';
import { motion } from 'framer-motion';
import {
  Zap, Globe, Settings, Clock, ChevronRight, BarChart3, ListTodo, Users, LogOut, Bug, MessageSquare,
} from 'lucide-react';
import { logout } from '../../store/slices/authSlice';

// Icône TONTON — petite version ronde du personnage pour la nav
const TontonIcon = ({ size = 16 }) => (
  <img
    src="/tonton.jpg"
    alt="TONTON"
    style={{ width: size, height: size, objectPosition: '50% 18%' }}
    className="rounded-full object-cover flex-shrink-0"
  />
);

// Le lien dashboard varie selon le rôle
const NAV_TOP_BY_ROLE = {
  support: { to: '/support-dashboard', label: 'Tableau de bord', icon: BarChart3 },
  default:  { to: '/dashboard',         label: 'Dashboard',       icon: BarChart3 },
};

const NAV_ALL = [
  { to: '/',               label: 'Faire une MAJ',  icon: TontonIcon },
  { to: '/maj-en-attente', label: 'MAJ en attente',  icon: ListTodo, badge: true },
  { to: '/skills',         label: 'Skills IA',       icon: Zap,      roles: ['super_admin', 'manager'] },
  { to: '/wordpress',      label: 'WordPress',        icon: Globe,    roles: ['super_admin', 'manager', 'support'] },
  { to: '/commentaires',   label: 'Commentaires',     icon: MessageSquare, roles: ['super_admin', 'manager', 'support'], beta: true },
  { to: '/historique',     label: 'Historique',       icon: Clock },
  { to: '/equipe',         label: 'Équipe',            icon: Users,   roles: ['super_admin', 'manager'] },
  { to: '/tickets',        label: 'Tickets',           icon: Bug,      badge: true },
];

function NavItem({ to, label, icon: Icon, badge, beta }) {
  const location = useLocation();
  const active = to === '/' ? location.pathname === '/' : location.pathname.startsWith(to);
  return (
    <NavLink to={to}>
      <motion.div
        whileHover={{ x: 2 }}
        whileTap={{ scale: 0.98 }}
        className={active ? 'sidebar-item-active' : 'sidebar-item'}
      >
        <Icon size={16} />
        <span className="flex-1">{label}</span>
        {beta && (
          <span className="text-[9px] font-bold uppercase tracking-wide bg-violet-500 text-white rounded-full px-1.5 py-0.5 leading-none">
            bêta
          </span>
        )}
        {!beta && badge > 0 && (
          <span className="text-[10px] font-bold bg-amber-400 text-white rounded-full px-1.5 py-0.5 leading-none min-w-[18px] text-center">
            {badge > 99 ? '99+' : badge}
          </span>
        )}
        {active && !badge && !beta && <ChevronRight size={14} className="opacity-50" />}
      </motion.div>
    </NavLink>
  );
}

export default function Sidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const pendingCount = useSelector(s =>
    s.pending.list.filter(i => i.status === 'pending').length
  );
  const ticketCount = useSelector(s => s.notifications?.unreadCount || 0);
  const role = useSelector(s => s.auth.role) || 'cq_ia';
  const navItems = NAV_ALL.filter(item => !item.roles || item.roles.includes(role));

  const handleLogout = () => {
    dispatch(logout());
    navigate('/login');
  };

  return (
    <motion.aside
      initial={{ x: -20, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
      className="w-60 h-screen flex flex-col glass-card rounded-none rounded-r-3xl border-l-0 border-t-0 border-b-0 sticky top-0"
      style={{ background: 'rgba(255,255,255,0.75)', backdropFilter: 'blur(20px)' }}
    >
      {/* Logo */}
      <div className="p-6 pb-4">
        <div className="flex items-center gap-3">
          <img
            src="/tonton.jpg"
            alt="TONTON AI"
            className="w-11 h-11 rounded-xl object-cover flex-shrink-0 shadow-sm"
            style={{ objectPosition: '50% 18%' }}
          />
          <div>
            <span className="font-bold text-gray-900 text-base tracking-tight">TONTON AI</span>
            <p className="text-[10px] text-gray-400 leading-none mt-0.5">MAJ d'articles par IA</p>
          </div>
        </div>
      </div>

      {/* Dashboard — premier, isolé (lien adapté au rôle) */}
      <div className="px-3 mb-1">
        <NavItem {...(NAV_TOP_BY_ROLE[role] || NAV_TOP_BY_ROLE.default)} />
      </div>

      <div className="px-3 mb-2">
        <div className="border-t border-gray-100 pt-3">
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest px-3 mb-1">Workflow</p>
        </div>
      </div>

      {/* Nav principale */}
      <nav className="flex-1 px-3 space-y-0.5">
        {navItems.map(item => (
          <NavItem
            key={item.to}
            {...item}
            badge={item.to === '/tickets' ? ticketCount : item.to === '/maj-en-attente' ? pendingCount : 0}
          />
        ))}
      </nav>

      {/* Settings + Déconnexion */}
      <div className="px-3 pb-6">
        <div className="border-t border-gray-100 pt-3 space-y-0.5">
          {role === 'super_admin' && (
            <NavLink to="/parametres">
              <motion.div
                whileHover={{ x: 2 }}
                whileTap={{ scale: 0.98 }}
                className={location.pathname === '/parametres' ? 'sidebar-item-active' : 'sidebar-item'}
              >
                <Settings size={16} />
                <span className="flex-1">Paramètres</span>
              </motion.div>
            </NavLink>
          )}
          <motion.button
            onClick={handleLogout}
            whileHover={{ x: 2 }}
            whileTap={{ scale: 0.98 }}
            className="sidebar-item w-full text-left text-red-500 hover:text-red-600 hover:bg-red-50"
          >
            <LogOut size={16} />
            <span className="flex-1">Déconnexion</span>
          </motion.button>
        </div>
      </div>
    </motion.aside>
  );
}
