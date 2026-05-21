import Sidebar from './Sidebar';

export default function Layout({ children }) {
  return (
    <div
      className="flex min-h-screen"
      style={{
        background: 'radial-gradient(ellipse at 20% 20%, rgba(220,220,220,0.6) 0%, transparent 60%), radial-gradient(ellipse at 80% 80%, rgba(200,200,200,0.4) 0%, transparent 60%), #f0f0f0',
      }}
    >
      <Sidebar />
      <main className="flex-1 overflow-auto">
        <div className="p-8 max-w-6xl mx-auto">
          {children}
        </div>
      </main>
    </div>
  );
}
