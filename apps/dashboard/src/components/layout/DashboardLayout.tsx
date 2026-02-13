import { useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { useTheme } from '../../hooks/useTheme';
import { useSites } from '../../api/sites';
import { useActiveVisitors } from '../../api/visitors';
import { useBuses } from '../../api/transportation';
import { useWebSocket } from '../../ws/useWebSocket';
import { ConnectionStatus } from './ConnectionStatus';

interface NavItem {
  label: string;
  path: string;
  icon: string;
  minRole?: string;
}

const NAV_SECTIONS: { title: string; items: NavItem[] }[] = [
  {
    title: 'Operations',
    items: [
      { label: 'Command Center', path: '/', icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6' },
      { label: 'Floor Plan', path: '/floor-plan', icon: 'M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7' },
    ],
  },
  {
    title: 'Safety',
    items: [
      { label: 'Drills', path: '/drills', icon: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z' },
      { label: 'Reunification', path: '/reunification', icon: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z' },
      { label: 'Threats', path: '/threat-assessment', icon: 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z' },
      { label: 'Social Media', path: '/social-media', icon: 'M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z' },
    ],
  },
  {
    title: 'Management',
    items: [
      { label: 'Visitors', path: '/visitors', icon: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z' },
      { label: 'Transportation', path: '/transportation', icon: 'M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4' },
      { label: 'Reports', path: '/reports', icon: 'M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z' },
    ],
  },
  {
    title: 'Admin',
    items: [
      { label: 'Audit Log', path: '/audit-log', icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01', minRole: 'OPERATOR' },
      { label: 'Grants', path: '/grants', icon: 'M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z', minRole: 'SITE_ADMIN' },
      { label: 'Compliance', path: '/compliance', icon: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z', minRole: 'SITE_ADMIN' },
      { label: 'Escalation', path: '/escalation', icon: 'M13 10V3L4 14h7v7l9-11h-7z', minRole: 'SITE_ADMIN' },
      { label: 'New Site Setup', path: '/onboarding', icon: 'M12 4.5v15m7.5-7.5h-15', minRole: 'SITE_ADMIN' },
      { label: 'Settings', path: '/settings', icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z' },
    ],
  },
];

const PARENT_NAV_ITEMS: NavItem[] = [
  { label: 'Home', path: '/parent', icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6' },
];

// SVG path data for theme icons
const SunIcon = 'M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z';
const MoonIcon = 'M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z';
const MonitorIcon = 'M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z';

export function DashboardLayout() {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { data: sites } = useSites();
  const { data: activeVisitors } = useActiveVisitors();
  const { data: buses } = useBuses();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const isParent = user?.role === 'PARENT';
  const siteId = user?.siteIds[0];
  const site = sites?.[0];
  const activeBusCount = (buses || []).filter((b: any) => b.isActive).length;

  const { connectionState } = useWebSocket(siteId);

  // Find current page title
  const navItems = isParent ? PARENT_NAV_ITEMS : NAV_SECTIONS.flatMap((s) => s.items);
  const currentItem = navItems.find((i) => i.path === location.pathname);
  const pageTitle = isParent ? (currentItem?.label || 'Parent Portal') : (currentItem?.label || 'SafeSchool OS');

  const themeIcon = theme === 'dark' ? MoonIcon : theme === 'light' ? SunIcon : MonitorIcon;
  const themeLabel = theme === 'dark' ? 'Dark' : theme === 'light' ? 'Light' : 'System';

  return (
    <div className="min-h-screen dark:bg-gray-900 bg-gray-100 dark:text-white text-gray-900 flex">
      {/* Sidebar */}
      <aside
        className={`${sidebarOpen ? 'w-56' : 'w-16'} dark:bg-gray-800 bg-white dark:border-gray-700 border-gray-200 border-r flex flex-col transition-all duration-200 flex-shrink-0`}
      >
        {/* Sidebar Header */}
        <div className="h-14 flex items-center justify-between px-4 dark:border-gray-700 border-gray-200 border-b">
          {sidebarOpen && (
            <Link to={isParent ? '/parent' : '/'} className="text-lg font-bold dark:text-white text-gray-900 truncate">
              SafeSchool
            </Link>
          )}
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="p-1.5 rounded dark:hover:bg-gray-700 hover:bg-gray-200 dark:text-gray-400 text-gray-500 dark:hover:text-white hover:text-gray-900 transition-colors"
            title={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              {sidebarOpen ? (
                <path strokeLinecap="round" strokeLinejoin="round" d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 5l7 7-7 7M5 5l7 7-7 7" />
              )}
            </svg>
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-2">
          {isParent ? (
            <div className="space-y-1">
              {PARENT_NAV_ITEMS.map((item) => {
                const isActive = location.pathname === item.path;
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    className={`flex items-center gap-3 px-4 py-2 mx-2 rounded-lg text-sm transition-colors ${
                      isActive
                        ? 'bg-blue-600/20 text-blue-400'
                        : 'dark:text-gray-400 text-gray-600 dark:hover:text-white hover:text-gray-900 dark:hover:bg-gray-700/50 hover:bg-gray-100'
                    }`}
                    title={!sidebarOpen ? item.label : undefined}
                  >
                    <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d={item.icon} />
                    </svg>
                    {sidebarOpen && <span className="truncate">{item.label}</span>}
                  </Link>
                );
              })}
            </div>
          ) : (
            NAV_SECTIONS.map((section) => (
              <div key={section.title} className="mb-2">
                {sidebarOpen && (
                  <div className="px-4 py-1 text-xs font-semibold dark:text-gray-500 text-gray-400 uppercase tracking-wider">
                    {section.title}
                  </div>
                )}
                {section.items.map((item) => {
                  const isActive = location.pathname === item.path;
                  return (
                    <Link
                      key={item.path}
                      to={item.path}
                      className={`flex items-center gap-3 px-4 py-2 mx-2 rounded-lg text-sm transition-colors ${
                        isActive
                          ? 'bg-blue-600/20 text-blue-400'
                          : 'dark:text-gray-400 text-gray-600 dark:hover:text-white hover:text-gray-900 dark:hover:bg-gray-700/50 hover:bg-gray-100'
                      }`}
                      title={!sidebarOpen ? item.label : undefined}
                    >
                      <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d={item.icon} />
                      </svg>
                      {sidebarOpen && <span className="truncate">{item.label}</span>}
                    </Link>
                  );
                })}
              </div>
            ))
          )}
        </nav>

        {/* Parent: Sign Out in sidebar */}
        {isParent && (
          <div className="dark:border-gray-700 border-gray-200 border-t p-3">
            <button
              onClick={logout}
              className="flex items-center gap-3 px-4 py-2 w-full rounded-lg text-sm dark:text-gray-400 text-gray-600 dark:hover:text-white hover:text-gray-900 dark:hover:bg-gray-700/50 hover:bg-gray-100 transition-colors"
            >
              <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
              </svg>
              {sidebarOpen && <span>Sign Out</span>}
            </button>
          </div>
        )}

        {/* Sidebar Footer */}
        {sidebarOpen && (
          <div className="dark:border-gray-700 border-gray-200 border-t p-4">
            <div className="text-xs dark:text-gray-500 text-gray-400 truncate">{user?.email}</div>
            <div className="text-xs dark:text-gray-600 text-gray-500">{user?.role}</div>
          </div>
        )}
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Bar */}
        <header className="h-14 dark:bg-gray-800 bg-white dark:border-gray-700 border-gray-200 border-b px-6 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-4">
            <h1 className="text-lg font-semibold">{pageTitle}</h1>
            {site && <span className="text-sm dark:text-gray-500 text-gray-400">{site.name}</span>}
          </div>
          <div className="flex items-center gap-5">
            {/* Status Indicators -- hidden for parent users */}
            {!isParent && (
              <>
                <div className="flex items-center gap-2 text-sm">
                  <span className="w-2 h-2 bg-green-500 rounded-full" />
                  <span className="dark:text-gray-400 text-gray-500">Visitors:</span>
                  <span className="font-medium">{activeVisitors?.length || 0}</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <span className="w-2 h-2 bg-yellow-500 rounded-full" />
                  <span className="dark:text-gray-400 text-gray-500">Buses:</span>
                  <span className="font-medium">{activeBusCount}</span>
                </div>
                <div className="h-6 w-px dark:bg-gray-700 bg-gray-200" />
              </>
            )}

            {/* Theme Toggle */}
            <button
              onClick={toggleTheme}
              className="p-1.5 rounded dark:hover:bg-gray-700 hover:bg-gray-200 dark:text-gray-400 text-gray-500 dark:hover:text-white hover:text-gray-900 transition-colors"
              title={`Theme: ${themeLabel} (click to cycle)`}
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d={themeIcon} />
              </svg>
            </button>

            <div className="h-6 w-px dark:bg-gray-700 bg-gray-200" />
            <span className="text-sm dark:text-gray-400 text-gray-500">{user?.name}</span>
            <button
              onClick={logout}
              className="text-sm dark:text-gray-500 text-gray-400 dark:hover:text-white hover:text-gray-900 transition-colors"
            >
              Sign Out
            </button>
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
