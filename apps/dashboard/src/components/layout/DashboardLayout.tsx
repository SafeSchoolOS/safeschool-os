import { useState, useEffect, useCallback, useRef } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { useTheme } from '../../hooks/useTheme';
import { useSites, getSiteLogoUrl } from '../../api/sites';
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
      { label: 'Security Monitor', path: '/monitor', icon: 'M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z' },
      { label: 'Fire Alarm PAS', path: '/fire-alarm', icon: 'M17.657 18.657A8 8 0 016.343 7.343S7 9 9 10c0-2 .5-5 2.986-7C14 5 16.09 5.777 17.656 7.343A7.975 7.975 0 0120 13a7.975 7.975 0 01-2.343 5.657z', minRole: 'OPERATOR' },
      { label: 'Floor Plan', path: '/floor-plan', icon: 'M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7' },
      { label: 'Roll Call', path: '/roll-call', icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4' },
      { label: 'System Health', path: '/system-health', icon: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z', minRole: 'OPERATOR' },
    ],
  },
  {
    title: 'Safety',
    items: [
      { label: 'Events', path: '/events', icon: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z', minRole: 'OPERATOR' },
      { label: 'Drills', path: '/drills', icon: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z' },
      { label: 'Reunification', path: '/reunification', icon: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z' },
      { label: 'Threats', path: '/threat-assessment', icon: 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z' },
      { label: 'Social Media', path: '/social-media', icon: 'M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z' },
      { label: 'Panic Devices', path: '/panic-devices', icon: 'M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9', minRole: 'OPERATOR' },
      { label: 'Weapons Detection', path: '/weapons-detection', icon: 'M12 9v3.75m0-10.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.75c0 5.592 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.57-.598-3.75h-.152c-3.196 0-6.1-1.249-8.25-3.286zm0 13.036h.008v.008H12v-.008z', minRole: 'OPERATOR' },
      { label: 'Cameras', path: '/cameras', icon: 'M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z' },
      { label: 'Door Health', path: '/door-health', icon: 'M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z', minRole: 'OPERATOR' },
      { label: 'Zones', path: '/zones', icon: 'M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z', minRole: 'OPERATOR' },
    ],
  },
  {
    title: 'Management',
    items: [
      { label: 'Access Control', path: '/cardholders', icon: 'M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z' },
      { label: 'Visitors', path: '/visitors', icon: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z' },
      { label: 'Visitor Bans', path: '/visitor-bans', icon: 'M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636', minRole: 'OPERATOR' },
      { label: 'Visitor Analytics', path: '/visitor-analytics', icon: 'M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z M20.488 9H15V3.512A9.025 9.025 0 0120.488 9z' },
      { label: 'Access Analytics', path: '/access-analytics', icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z', minRole: 'OPERATOR' },
      { label: 'Transportation', path: '/transportation', icon: 'M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4' },
      { label: 'Students', path: '/students', icon: 'M4.26 10.147a60.438 60.438 0 0 0-.491 6.347A48.62 48.62 0 0 1 12 20.904a48.62 48.62 0 0 1 8.232-4.41 60.46 60.46 0 0 0-.491-6.347m-15.482 0a50.636 50.636 0 0 0-2.658-.813A59.906 59.906 0 0 1 12 3.493a59.903 59.903 0 0 1 10.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.717 50.717 0 0 1 12 13.489a50.702 50.702 0 0 1 7.74-3.342M6.75 15a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm0 0v-3.675A55.378 55.378 0 0 1 12 8.443m-7.007 11.55A5.981 5.981 0 0 0 6.75 15.75v-1.5' },
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
      { label: 'Users', path: '/users', icon: 'M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z', minRole: 'SITE_ADMIN' },
      { label: 'Edge Devices', path: '/fleet', icon: 'M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01', minRole: 'SITE_ADMIN' },
      { label: 'New Site Setup', path: '/onboarding', icon: 'M12 4.5v15m7.5-7.5h-15', minRole: 'SITE_ADMIN' },
      { label: 'Visitor Settings', path: '/visitor-settings', icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z', minRole: 'SITE_ADMIN' },
      { label: 'BadgeKiosk', path: '/badgekiosk-settings', icon: 'M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z', minRole: 'SITE_ADMIN' },
      { label: 'Settings', path: '/settings', icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z' },
    ],
  },
  {
    title: 'Platform Admin',
    items: [
      { label: 'Requests', path: '/admin/requests', icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2', minRole: 'SUPER_ADMIN' },
      { label: 'Organizations', path: '/admin/organizations', icon: 'M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4', minRole: 'SUPER_ADMIN' },
      { label: 'All Sites', path: '/admin/sites', icon: 'M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z M15 11a3 3 0 11-6 0 3 3 0 016 0z', minRole: 'SUPER_ADMIN' },
      { label: 'All Users', path: '/admin/users', icon: 'M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z', minRole: 'SUPER_ADMIN' },
      { label: 'Platform Settings', path: '/admin/settings', icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z', minRole: 'SUPER_ADMIN' },
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

const ROLE_LEVEL: Record<string, number> = {
  PARENT: 0, TEACHER: 1, FIRST_RESPONDER: 2, OPERATOR: 3, SITE_ADMIN: 4, SUPER_ADMIN: 5,
};

export function DashboardLayout() {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { data: sites } = useSites();
  const { data: activeVisitors } = useActiveVisitors();
  const { data: buses } = useBuses();
  const location = useLocation();
  // Desktop: expanded by default. Mobile: closed by default.
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});
  const mainRef = useRef<HTMLElement>(null);

  const isParent = user?.role === 'PARENT';
  const siteId = user?.siteIds[0];
  const site = sites?.[0];
  const activeBusCount = (buses || []).filter((b: any) => b.isActive).length;

  const { connectionState } = useWebSocket(siteId);

  // Track screen size
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const onChange = (e: MediaQueryListEvent | MediaQueryList) => {
      setIsMobile(e.matches);
      if (!e.matches) setSidebarOpen(true); // auto-expand on desktop
    };
    onChange(mq);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // Close mobile sidebar on route change + scroll main content to top
  useEffect(() => {
    if (isMobile) setSidebarOpen(false);
    mainRef.current?.scrollTo(0, 0);
  }, [location.pathname, isMobile]);

  const toggleSidebar = useCallback(() => setSidebarOpen((o) => !o), []);
  const toggleSection = useCallback((title: string) => {
    setCollapsedSections((prev) => ({ ...prev, [title]: !prev[title] }));
  }, []);

  // Find current page title
  const navItems = isParent ? PARENT_NAV_ITEMS : NAV_SECTIONS.flatMap((s) => s.items);
  const currentItem = navItems.find((i) => i.path === location.pathname);
  const pageTitle = isParent ? (currentItem?.label || 'Parent Portal') : (currentItem?.label || 'SafeSchool OS');

  const themeIcon = theme === 'dark' ? MoonIcon : theme === 'light' ? SunIcon : MonitorIcon;
  const themeLabel = theme === 'dark' ? 'Dark' : theme === 'light' ? 'Light' : 'System';

  // Render nav items (shared between mobile overlay and desktop sidebar)
  const renderNav = () => (
    <nav className="flex-1 overflow-y-auto py-2">
      {isParent ? (
        <div className="space-y-1">
          {PARENT_NAV_ITEMS.map((item) => {
            const isActive = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                className={`flex items-center gap-3 px-4 py-2.5 mx-2 rounded-lg text-sm transition-colors ${
                  isActive
                    ? 'bg-blue-600/20 text-blue-400'
                    : 'dark:text-gray-400 text-gray-600 dark:hover:text-white hover:text-gray-900 dark:hover:bg-gray-700/50 hover:bg-gray-100'
                }`}
              >
                <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d={item.icon} />
                </svg>
                {(sidebarOpen || isMobile) && <span className="truncate">{item.label}</span>}
              </Link>
            );
          })}
        </div>
      ) : (
        NAV_SECTIONS.filter((section) => section.items.some((item) => !item.minRole || (ROLE_LEVEL[user?.role || ''] ?? -1) >= (ROLE_LEVEL[item.minRole] ?? 0))).map((section) => {
          const isCollapsed = collapsedSections[section.title];
          const visibleItems = section.items.filter((item) => !item.minRole || (ROLE_LEVEL[user?.role || ''] ?? -1) >= (ROLE_LEVEL[item.minRole] ?? 0));
          const hasActiveItem = visibleItems.some((item) => location.pathname === item.path);
          return (
            <div key={section.title} className="mb-1">
              {(sidebarOpen || isMobile) ? (
                <button
                  onClick={() => toggleSection(section.title)}
                  className="w-full flex items-center justify-between px-4 py-1.5 text-xs font-semibold dark:text-gray-500 text-gray-400 uppercase tracking-wider hover:dark:text-gray-300 hover:text-gray-600 transition-colors"
                >
                  <span>{section.title}</span>
                  <svg
                    className={`w-3.5 h-3.5 transition-transform duration-200 ${isCollapsed ? '-rotate-90' : ''}`}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
              ) : (
                <div className="mx-2 my-1 border-t dark:border-gray-700 border-gray-200" />
              )}
              {(!isCollapsed || hasActiveItem) && visibleItems.map((item) => {
                const isActive = location.pathname === item.path;
                if (isCollapsed && !isActive) return null;
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    className={`flex items-center gap-3 px-4 py-2.5 mx-2 rounded-lg text-sm transition-colors ${
                      isActive
                        ? 'bg-blue-600/20 text-blue-400'
                        : 'dark:text-gray-400 text-gray-600 dark:hover:text-white hover:text-gray-900 dark:hover:bg-gray-700/50 hover:bg-gray-100'
                    }`}
                    title={!sidebarOpen && !isMobile ? item.label : undefined}
                  >
                    <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d={item.icon} />
                    </svg>
                    {(sidebarOpen || isMobile) && <span className="truncate">{item.label}</span>}
                  </Link>
                );
              })}
            </div>
          );
        })
      )}
    </nav>
  );

  return (
    <div className="min-h-screen dark:bg-gray-900 bg-gray-100 dark:text-white text-gray-900 flex">
      {/* Mobile sidebar overlay */}
      {isMobile && sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 transition-opacity"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar — desktop: static, mobile: slide-in overlay */}
      <aside
        className={`
          ${isMobile
            ? `fixed inset-y-0 left-0 z-50 w-64 transform transition-transform duration-200 ease-in-out ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`
            : `${sidebarOpen ? 'w-56' : 'w-16'} transition-all duration-200 flex-shrink-0`
          }
          dark:bg-gray-800 bg-white dark:border-gray-700 border-gray-200 border-r flex flex-col
        `}
      >
        {/* Sidebar Header */}
        <div className="h-14 flex items-center justify-between px-4 dark:border-gray-700 border-gray-200 border-b">
          {(sidebarOpen || isMobile) && (
            <Link to={isParent ? '/parent' : '/'} className="flex items-center gap-2 text-lg font-bold dark:text-white text-gray-900 truncate min-w-0">
              {siteId && site?.logoUrl && (
                <img
                  src={getSiteLogoUrl(siteId)}
                  alt=""
                  className="w-7 h-7 object-contain flex-shrink-0 rounded"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />
              )}
              <span className="truncate">SafeSchool</span>
            </Link>
          )}
          {/* Desktop collapse toggle (hidden on mobile — mobile uses X or backdrop) */}
          {!isMobile && (
            <button
              onClick={toggleSidebar}
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
          )}
          {/* Mobile close button */}
          {isMobile && (
            <button
              onClick={() => setSidebarOpen(false)}
              className="p-1.5 rounded dark:hover:bg-gray-700 hover:bg-gray-200 dark:text-gray-400 text-gray-500 dark:hover:text-white hover:text-gray-900 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        {/* Nav */}
        {renderNav()}

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
              <span>Sign Out</span>
            </button>
          </div>
        )}

        {/* Sidebar Footer */}
        {(sidebarOpen || isMobile) && (
          <div className="dark:border-gray-700 border-gray-200 border-t p-4">
            <div className="text-xs dark:text-gray-500 text-gray-400 truncate">{user?.email}</div>
            <div className="text-xs dark:text-gray-600 text-gray-500">{user?.role}</div>
          </div>
        )}
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Bar */}
        <header className="h-14 dark:bg-gray-800 bg-white dark:border-gray-700 border-gray-200 border-b px-3 sm:px-6 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-2 sm:gap-4 min-w-0">
            {/* Mobile hamburger */}
            {isMobile && (
              <button
                onClick={toggleSidebar}
                className="p-1.5 -ml-1 rounded dark:hover:bg-gray-700 hover:bg-gray-200 dark:text-gray-400 text-gray-500 dark:hover:text-white hover:text-gray-900 transition-colors"
                aria-label="Open menu"
              >
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>
            )}
            <h1 className="text-base sm:text-lg font-semibold truncate">{pageTitle}</h1>
            {site && <span className="text-sm dark:text-gray-500 text-gray-400 hidden sm:inline">{site.name}</span>}
          </div>
          <div className="flex items-center gap-2 sm:gap-5">
            {/* Status Indicators — hidden on mobile and for parent users */}
            {!isParent && (
              <>
                <div className="hidden md:flex items-center gap-2 text-sm">
                  <span className="w-2 h-2 bg-green-500 rounded-full" />
                  <span className="dark:text-gray-400 text-gray-500">Visitors:</span>
                  <span className="font-medium">{activeVisitors?.length || 0}</span>
                </div>
                <div className="hidden md:flex items-center gap-2 text-sm">
                  <span className="w-2 h-2 bg-yellow-500 rounded-full" />
                  <span className="dark:text-gray-400 text-gray-500">Buses:</span>
                  <span className="font-medium">{activeBusCount}</span>
                </div>
                <div className="hidden md:block h-6 w-px dark:bg-gray-700 bg-gray-200" />
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

            <div className="hidden sm:block h-6 w-px dark:bg-gray-700 bg-gray-200" />
            <span className="text-sm dark:text-gray-400 text-gray-500 hidden sm:inline truncate max-w-[120px]">{user?.name}</span>
            <button
              onClick={logout}
              className="text-sm dark:text-gray-500 text-gray-400 dark:hover:text-white hover:text-gray-900 transition-colors whitespace-nowrap"
            >
              Sign Out
            </button>
          </div>
        </header>

        {/* Page Content */}
        <main ref={mainRef} className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
