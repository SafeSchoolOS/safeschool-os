import { NavLink } from 'react-router-dom';
import { Activity, RefreshCw, Settings, Server, Download } from 'lucide-react';

const navItems = [
  { to: '/', icon: Activity, label: 'Status' },
  { to: '/sync', icon: RefreshCw, label: 'Sync' },
  { to: '/config', icon: Settings, label: 'Config' },
  { to: '/services', icon: Server, label: 'Services' },
  { to: '/updates', icon: Download, label: 'Updates' },
];

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-900 text-white flex">
      {/* Sidebar */}
      <aside className="w-56 bg-gray-800 border-r border-gray-700 flex flex-col">
        <div className="px-4 py-5 border-b border-gray-700">
          <h1 className="text-lg font-bold">SafeSchool OS</h1>
          <p className="text-xs text-gray-400 mt-1">Edge Admin Panel</p>
        </div>

        <nav className="flex-1 py-4">
          {navItems.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
                  isActive
                    ? 'bg-blue-600/20 text-blue-400 border-r-2 border-blue-400'
                    : 'text-gray-400 hover:text-white hover:bg-gray-700/50'
                }`
              }
            >
              <Icon size={18} />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="px-4 py-3 border-t border-gray-700 text-xs text-gray-500">
          SafeSchool OS v0.3.0
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto">
        <div className="p-6">{children}</div>
      </main>
    </div>
  );
}
