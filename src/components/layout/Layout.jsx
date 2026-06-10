import { useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import Header from './Header';

// Pattern SVG discret — tuile 40×40, croix légère (style WhatsApp/Notion)
const BG_PATTERN = `url("data:image/svg+xml,%3Csvg width='40' height='40' viewBox='0 0 40 40' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='%23000' fill-opacity='0.045' fill-rule='evenodd'%3E%3Cpath d='M0 20h40M20 0v40' stroke='%23000' stroke-opacity='0.045' stroke-width='0.5'/%3E%3Ccircle cx='20' cy='20' r='1.2'/%3E%3Ccircle cx='0' cy='0' r='1'/%3E%3Ccircle cx='40' cy='0' r='1'/%3E%3Ccircle cx='0' cy='40' r='1'/%3E%3Ccircle cx='40' cy='40' r='1'/%3E%3C/g%3E%3C/svg%3E")`;

export default function Layout({ children }) {
  const { pathname } = useLocation();
  // Pages "outils" en pleine largeur (Kanban tickets, etc.) — pas de max-w-6xl
  const fullWidth = pathname.startsWith('/tickets');

  return (
    <div
      className="flex min-h-screen"
      style={{
        background: `
          ${BG_PATTERN},
          radial-gradient(ellipse at 15% 15%, rgba(210,210,235,0.55) 0%, transparent 55%),
          radial-gradient(ellipse at 85% 85%, rgba(200,215,210,0.45) 0%, transparent 55%),
          #eceef1
        `,
        backgroundSize: '40px 40px, 100% 100%, 100% 100%, 100% 100%',
      }}
    >
      <Sidebar />
      <div className="flex-1 flex flex-col min-h-0">
        <Header />
        <main className="flex-1 overflow-auto min-h-0">
          <div className={fullWidth ? 'p-4 sm:p-6 h-full' : 'p-8 max-w-6xl mx-auto'}>
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
