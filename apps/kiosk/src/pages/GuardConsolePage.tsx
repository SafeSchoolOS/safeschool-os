import { useState, useEffect, useCallback, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { guardApi, GUARD_TOKEN_KEY } from '../api/client';

const SITE_ID = import.meta.env.VITE_SITE_ID || '';
const SITE_NAME = import.meta.env.VITE_SITE_NAME || 'Lincoln Elementary';

type Tab = 'dashboard' | 'visitors' | 'checkin' | 'activity';

interface DashboardData {
  activeVisitors: number;
  todayCheckIns: number;
  todayCheckOuts: number;
  flaggedVisitors: number;
  activeLockdowns: number;
  isLockdown: boolean;
  exteriorDoors: {
    id: string;
    name: string;
    status: string;
    buildingId: string;
  }[];
  timestamp: string;
}

interface VisitorRecord {
  id: string;
  firstName: string;
  lastName: string;
  photo?: string;
  badgeNumber: string;
  purpose: string;
  destination: string;
  host?: string;
  checkedInAt: string;
  status: string;
  screeningStatus: string;
  duration: number | null;
}

interface ActivityLog {
  id: string;
  action: string;
  entityId?: string;
  details?: Record<string, any>;
  user?: { name: string };
  createdAt: string;
}

const PURPOSES = [
  'Parent Visit',
  'Vendor / Contractor',
  'Meeting',
  'Volunteer',
  'Delivery',
  'Emergency Contact',
  'Other',
];

export function GuardConsolePage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('dashboard');
  const [currentTime, setCurrentTime] = useState(new Date());

  // Dashboard state
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [recentCheckins, setRecentCheckins] = useState<VisitorRecord[]>([]);

  // Visitors state
  const [visitors, setVisitors] = useState<VisitorRecord[]>([]);
  const [visitorSearch, setVisitorSearch] = useState('');

  // Activity state
  const [activity, setActivity] = useState<ActivityLog[]>([]);

  // Manual check-in form
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [company, setCompany] = useState('');
  const [purpose, setPurpose] = useState('');
  const [destination, setDestination] = useState('');
  const [hostName, setHostName] = useState('');
  const [idVerified, setIdVerified] = useState(false);
  const [printBadge, setPrintBadge] = useState(true);
  const [notes, setNotes] = useState('');
  const [checkinSuccess, setCheckinSuccess] = useState('');

  // Shared state
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Clock
  useEffect(() => {
    const interval = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  // Data fetching
  const refresh = useCallback(async () => {
    try {
      setLoading(true);

      if (tab === 'dashboard' || !dashboard) {
        const [data, recent] = await Promise.all([
          guardApi.get(`/guard/${SITE_ID}/dashboard`),
          guardApi.get(`/guard/${SITE_ID}/visitors`),
        ]);
        setDashboard(data);
        // Show the 5 most recent check-ins on dashboard
        setRecentCheckins(recent.slice(0, 5));
      }

      if (tab === 'visitors') {
        const data = await guardApi.get(`/guard/${SITE_ID}/visitors`);
        setVisitors(data);
      }

      if (tab === 'activity') {
        const data = await guardApi.get(`/guard/${SITE_ID}/activity`);
        setActivity(data);
      }

      setError('');
    } catch (err: any) {
      if (err.message?.includes('license') || err.message?.includes('403')) {
        navigate('/');
        return;
      }
      setError(err.message || 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, [tab, dashboard, navigate]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 10000);
    return () => clearInterval(interval);
  }, [refresh]);

  // Visitor search filter
  const filteredVisitors = visitorSearch.trim()
    ? visitors.filter(v => {
        const q = visitorSearch.toLowerCase();
        return (
          `${v.firstName} ${v.lastName}`.toLowerCase().includes(q) ||
          v.badgeNumber?.toLowerCase().includes(q) ||
          v.destination?.toLowerCase().includes(q) ||
          v.purpose?.toLowerCase().includes(q) ||
          v.host?.toLowerCase().includes(q)
        );
      })
    : visitors;

  // Actions
  const handleCheckOut = async (visitorId: string) => {
    try {
      await guardApi.post(`/guard/${SITE_ID}/manual-checkout/${visitorId}`);
      // Refresh the current tab data
      if (tab === 'visitors') {
        setVisitors(prev => prev.filter(v => v.id !== visitorId));
      }
      if (dashboard) {
        setDashboard({
          ...dashboard,
          activeVisitors: dashboard.activeVisitors - 1,
          todayCheckOuts: dashboard.todayCheckOuts + 1,
        });
      }
    } catch (err: any) {
      setError(err.message || 'Check-out failed');
    }
  };

  const handleManualCheckIn = async () => {
    if (!firstName.trim() || !lastName.trim() || !purpose || !destination.trim()) return;
    try {
      setLoading(true);
      const visitor = await guardApi.post(`/guard/${SITE_ID}/manual-checkin`, {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        purpose,
        destination: destination.trim(),
        idVerified,
        notes: notes.trim() || undefined,
      });

      // Print badge if requested
      if (printBadge && visitor?.id) {
        try {
          window.print();
        } catch {
          // Badge printing failure is non-critical
        }
      }

      setCheckinSuccess(`${firstName} ${lastName} checked in (Badge: ${visitor.badgeNumber})`);
      // Reset form
      setFirstName('');
      setLastName('');
      setCompany('');
      setPurpose('');
      setDestination('');
      setHostName('');
      setIdVerified(false);
      setNotes('');
      setPrintBadge(true);

      // Clear success message after 5 seconds
      setTimeout(() => setCheckinSuccess(''), 5000);

      // Refresh dashboard counts
      if (dashboard) {
        setDashboard({
          ...dashboard,
          activeVisitors: dashboard.activeVisitors + 1,
          todayCheckIns: dashboard.todayCheckIns + 1,
        });
      }
    } catch (err: any) {
      setError(err.message || 'Check-in failed');
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem(GUARD_TOKEN_KEY);
    navigate('/');
  };

  const timeStr = currentTime.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const tabs: { key: Tab; label: string; icon: ReactNode }[] = [
    {
      key: 'dashboard',
      label: 'Dashboard',
      icon: (
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="7" height="7" />
          <rect x="14" y="3" width="7" height="7" />
          <rect x="14" y="14" width="7" height="7" />
          <rect x="3" y="14" width="7" height="7" />
        </svg>
      ),
    },
    {
      key: 'visitors',
      label: 'Active Visitors',
      icon: (
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      ),
    },
    {
      key: 'checkin',
      label: 'Manual Check-In',
      icon: (
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <line x1="19" y1="8" x2="19" y2="14" />
          <line x1="22" y1="11" x2="16" y2="11" />
        </svg>
      ),
    },
    {
      key: 'activity',
      label: 'Activity Log',
      icon: (
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
        </svg>
      ),
    },
  ];

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col">
      {/* ── Header ── */}
      <header className={`px-6 py-3 flex items-center justify-between border-b ${
        dashboard?.isLockdown
          ? 'bg-red-900 border-red-800'
          : 'bg-gray-900 border-gray-800'
      }`}>
        <div className="flex items-center gap-4">
          {/* Shield icon */}
          <svg className="w-8 h-8 text-blue-500" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2L3 7v5c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-9-5zm-1 15l-4-4 1.41-1.41L11 14.17l5.59-5.59L18 10l-7 7z" />
          </svg>
          <div>
            <h1 className="text-lg font-bold leading-tight">Guard Console</h1>
            <span className="text-xs text-gray-400">{SITE_NAME}</span>
          </div>
          {dashboard?.isLockdown && (
            <span className="bg-red-600 text-white px-3 py-1 rounded-full text-sm font-bold animate-pulse ml-2">
              LOCKDOWN ACTIVE
            </span>
          )}
        </div>
        <div className="flex items-center gap-6">
          {dashboard && (
            <div className="flex items-center gap-2 text-sm">
              <span className={`w-2 h-2 rounded-full ${dashboard.activeVisitors > 0 ? 'bg-green-500' : 'bg-gray-600'}`} />
              <span className="text-gray-400">{dashboard.activeVisitors} visitor{dashboard.activeVisitors !== 1 ? 's' : ''} on-site</span>
            </div>
          )}
          <span className="text-gray-300 text-sm font-mono tabular-nums">{timeStr}</span>
          <button
            onClick={handleLogout}
            className="text-gray-400 hover:text-white text-sm transition-colors flex items-center gap-1"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
            Logout
          </button>
        </div>
      </header>

      {/* ── Tabs ── */}
      <nav className="flex border-b border-gray-800 bg-gray-900/50">
        {tabs.map(({ key, label, icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex items-center gap-2 px-6 py-3 text-sm font-medium transition-all duration-200 border-b-2 ${
              tab === key
                ? 'text-blue-400 border-blue-400 bg-blue-950/20'
                : 'text-gray-400 border-transparent hover:text-white hover:bg-gray-800/30'
            }`}
          >
            {icon}
            {label}
            {key === 'visitors' && visitors.length > 0 && (
              <span className="bg-blue-600 text-white text-xs px-2 py-0.5 rounded-full">
                {visitors.length}
              </span>
            )}
          </button>
        ))}
      </nav>

      {/* ── Error Banner ── */}
      {error && (
        <div className="mx-6 mt-4 bg-red-900/50 text-red-300 px-4 py-3 rounded-lg text-sm border border-red-800 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError('')} className="text-red-400 hover:text-red-300 ml-4 text-lg leading-none">&times;</button>
        </div>
      )}

      {/* ── Tab Content ── */}
      <main className="flex-1 p-6 overflow-y-auto">

        {/* ━━━ Dashboard Tab ━━━ */}
        {tab === 'dashboard' && (
          <div className="space-y-8">
            {/* Stat cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard
                label="Active Visitors"
                value={dashboard?.activeVisitors ?? 0}
                color="blue"
                icon={
                  <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                    <circle cx="9" cy="7" r="4" />
                  </svg>
                }
              />
              <StatCard
                label="Today's Check-Ins"
                value={dashboard?.todayCheckIns ?? 0}
                color="green"
                icon={
                  <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                }
              />
              <StatCard
                label="Today's Check-Outs"
                value={dashboard?.todayCheckOuts ?? 0}
                color="gray"
                icon={
                  <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                    <polyline points="16 17 21 12 16 7" />
                    <line x1="21" y1="12" x2="9" y2="12" />
                  </svg>
                }
              />
              <StatCard
                label="Flagged"
                value={dashboard?.flaggedVisitors ?? 0}
                color={dashboard?.flaggedVisitors ? 'red' : 'gray'}
                icon={
                  <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                    <line x1="12" y1="9" x2="12" y2="13" />
                    <line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                }
              />
            </div>

            {/* Two-column layout: Recent Check-Ins + Door Status */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Recent Check-Ins */}
              <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
                <div className="px-5 py-4 border-b border-gray-800 flex items-center justify-between">
                  <h3 className="font-semibold text-lg">Recent Check-Ins</h3>
                  <button
                    onClick={() => setTab('visitors')}
                    className="text-sm text-blue-400 hover:text-blue-300 transition-colors"
                  >
                    View All
                  </button>
                </div>
                <div className="divide-y divide-gray-800">
                  {recentCheckins.length === 0 ? (
                    <div className="px-5 py-8 text-center text-gray-500">No visitors checked in today</div>
                  ) : (
                    recentCheckins.map(v => (
                      <div key={v.id} className="px-5 py-3 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold ${
                            v.screeningStatus === 'FLAGGED' ? 'bg-red-700' : 'bg-blue-700'
                          }`}>
                            {v.firstName[0]}{v.lastName[0]}
                          </div>
                          <div>
                            <div className="font-medium text-sm">
                              {v.firstName} {v.lastName}
                              {v.screeningStatus === 'FLAGGED' && (
                                <span className="ml-2 text-xs bg-red-900 text-red-300 px-2 py-0.5 rounded-full">FLAGGED</span>
                              )}
                            </div>
                            <div className="text-xs text-gray-500">{v.purpose} | {v.destination}</div>
                          </div>
                        </div>
                        <div className="text-xs text-gray-500">
                          {v.duration != null ? `${v.duration}m ago` : ''}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Exterior Doors */}
              <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
                <div className="px-5 py-4 border-b border-gray-800">
                  <h3 className="font-semibold text-lg">Exterior Door Status</h3>
                </div>
                <div className="p-5">
                  {!dashboard?.exteriorDoors?.length ? (
                    <div className="text-center text-gray-500 py-4">No door data available</div>
                  ) : (
                    <div className="grid grid-cols-2 gap-3">
                      {dashboard.exteriorDoors.map(door => (
                        <div key={door.id} className={`p-3 rounded-lg flex items-center gap-3 ${
                          door.status === 'LOCKED'
                            ? 'bg-green-900/20 border border-green-800/50'
                            : door.status === 'UNLOCKED'
                              ? 'bg-yellow-900/20 border border-yellow-800/50'
                              : 'bg-red-900/20 border border-red-800/50'
                        }`}>
                          <svg className={`w-5 h-5 flex-shrink-0 ${
                            door.status === 'LOCKED' ? 'text-green-500' :
                            door.status === 'UNLOCKED' ? 'text-yellow-500' : 'text-red-500'
                          }`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            {door.status === 'LOCKED' ? (
                              <>
                                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                              </>
                            ) : (
                              <>
                                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                                <path d="M7 11V7a5 5 0 0 1 9.9-1" />
                              </>
                            )}
                          </svg>
                          <div>
                            <div className="text-sm font-medium">{door.name}</div>
                            <div className={`text-xs ${
                              door.status === 'LOCKED' ? 'text-green-400' :
                              door.status === 'UNLOCKED' ? 'text-yellow-400' : 'text-red-400'
                            }`}>{door.status}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Alerts section */}
            {dashboard?.isLockdown && (
              <div className="bg-red-900/30 border border-red-800 rounded-xl p-6">
                <div className="flex items-center gap-3 mb-3">
                  <svg className="w-8 h-8 text-red-400 animate-pulse" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                    <line x1="12" y1="9" x2="12" y2="13" />
                    <line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                  <div>
                    <h3 className="text-xl font-bold text-red-300">Active Lockdown</h3>
                    <p className="text-sm text-red-400">
                      {dashboard.activeLockdowns} active lockdown{dashboard.activeLockdowns !== 1 ? 's' : ''}. All exterior doors should be secured.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {(dashboard?.flaggedVisitors ?? 0) > 0 && dashboard && (
              <div className="bg-yellow-900/20 border border-yellow-800/50 rounded-xl p-5">
                <div className="flex items-center gap-3">
                  <svg className="w-6 h-6 text-yellow-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                    <line x1="12" y1="9" x2="12" y2="13" />
                    <line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                  <div>
                    <h3 className="font-semibold text-yellow-300">
                      {dashboard.flaggedVisitors} flagged visitor{dashboard.flaggedVisitors !== 1 ? 's' : ''} on-site
                    </h3>
                    <p className="text-sm text-yellow-500">
                      Review flagged visitors in the Active Visitors tab.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ━━━ Active Visitors Tab ━━━ */}
        {tab === 'visitors' && (
          <div className="space-y-4">
            {/* Search + header */}
            <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
              <h3 className="text-xl font-semibold">
                Active Visitors
                <span className="text-gray-500 text-base font-normal ml-2">({filteredVisitors.length})</span>
              </h3>
              <div className="flex items-center gap-3 w-full sm:w-auto">
                <div className="relative flex-1 sm:w-72">
                  <svg className="w-5 h-5 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="11" cy="11" r="8" />
                    <line x1="21" y1="21" x2="16.65" y2="16.65" />
                  </svg>
                  <input
                    value={visitorSearch}
                    onChange={e => setVisitorSearch(e.target.value)}
                    placeholder="Search visitors..."
                    className="w-full pl-10 pr-4 py-2.5 bg-gray-800 rounded-lg border border-gray-700 text-white text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 outline-none transition-all"
                  />
                </div>
                <button
                  onClick={refresh}
                  className="p-2.5 bg-gray-800 hover:bg-gray-700 rounded-lg border border-gray-700 transition-colors"
                  title="Refresh"
                >
                  <svg className={`w-4 h-4 text-gray-400 ${loading ? 'animate-spin' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="23 4 23 10 17 10" />
                    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Visitor list */}
            <div className="space-y-2">
              {filteredVisitors.length === 0 ? (
                <div className="text-center text-gray-500 py-16 text-lg">
                  {visitorSearch ? 'No visitors match your search' : 'No active visitors'}
                </div>
              ) : (
                filteredVisitors.map(v => (
                  <div
                    key={v.id}
                    className={`flex items-center justify-between p-4 rounded-xl transition-colors ${
                      v.screeningStatus === 'FLAGGED'
                        ? 'bg-red-900/20 border border-red-800/50 hover:bg-red-900/30'
                        : 'bg-gray-900 border border-gray-800 hover:bg-gray-800/70'
                    }`}
                  >
                    <div className="flex items-center gap-4">
                      <div className={`w-11 h-11 rounded-full flex items-center justify-center text-lg font-bold flex-shrink-0 ${
                        v.screeningStatus === 'FLAGGED' ? 'bg-red-700' : 'bg-blue-700'
                      }`}>
                        {v.firstName[0]}{v.lastName[0]}
                      </div>
                      <div>
                        <div className="font-semibold flex items-center gap-2">
                          {v.firstName} {v.lastName}
                          {v.screeningStatus === 'FLAGGED' && (
                            <span className="text-xs bg-red-900 text-red-300 px-2 py-0.5 rounded-full font-medium">FLAGGED</span>
                          )}
                        </div>
                        <div className="text-sm text-gray-400 mt-0.5">
                          Badge: <span className="font-mono text-gray-300">{v.badgeNumber}</span>
                          <span className="mx-2 text-gray-600">|</span>
                          {v.destination}
                          <span className="mx-2 text-gray-600">|</span>
                          {v.purpose}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-4 flex-shrink-0">
                      <div className="text-right text-sm">
                        {v.host && <div className="text-gray-400">Host: {v.host}</div>}
                        <div className="text-gray-500">
                          {v.duration != null ? (
                            v.duration < 60
                              ? `${v.duration}m on-site`
                              : `${Math.floor(v.duration / 60)}h ${v.duration % 60}m on-site`
                          ) : (
                            'Just arrived'
                          )}
                        </div>
                      </div>
                      <button
                        onClick={() => handleCheckOut(v.id)}
                        className="px-4 py-2.5 bg-red-700 hover:bg-red-600 active:bg-red-800 rounded-lg text-sm font-medium transition-all duration-150 active:scale-95"
                      >
                        Check Out
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* ━━━ Manual Check-In Tab ━━━ */}
        {tab === 'checkin' && (
          <div className="max-w-2xl">
            <h3 className="text-xl font-semibold mb-6">Manual Visitor Check-In</h3>

            {checkinSuccess && (
              <div className="bg-green-900/40 text-green-300 p-4 rounded-xl mb-6 border border-green-800/50 flex items-center gap-3">
                <svg className="w-6 h-6 text-green-400 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                  <polyline points="22 4 12 14.01 9 11.01" />
                </svg>
                {checkinSuccess}
              </div>
            )}

            <div className="space-y-5 bg-gray-900 rounded-xl border border-gray-800 p-6">
              {/* Name row */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-gray-400 mb-1.5 font-medium">First Name *</label>
                  <input
                    value={firstName}
                    onChange={e => setFirstName(e.target.value)}
                    className="w-full p-3 bg-gray-800 rounded-lg border border-gray-700 text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 outline-none transition-all"
                    placeholder="John"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1.5 font-medium">Last Name *</label>
                  <input
                    value={lastName}
                    onChange={e => setLastName(e.target.value)}
                    className="w-full p-3 bg-gray-800 rounded-lg border border-gray-700 text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 outline-none transition-all"
                    placeholder="Doe"
                  />
                </div>
              </div>

              {/* Company */}
              <div>
                <label className="block text-sm text-gray-400 mb-1.5 font-medium">Company / Organization</label>
                <input
                  value={company}
                  onChange={e => setCompany(e.target.value)}
                  className="w-full p-3 bg-gray-800 rounded-lg border border-gray-700 text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 outline-none transition-all"
                  placeholder="Optional"
                />
              </div>

              {/* Purpose */}
              <div>
                <label className="block text-sm text-gray-400 mb-1.5 font-medium">Purpose of Visit *</label>
                <select
                  value={purpose}
                  onChange={e => setPurpose(e.target.value)}
                  className="w-full p-3 bg-gray-800 rounded-lg border border-gray-700 text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 outline-none transition-all appearance-none"
                >
                  <option value="">Select purpose...</option>
                  {PURPOSES.map(p => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </div>

              {/* Destination + Host row */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-gray-400 mb-1.5 font-medium">Destination *</label>
                  <input
                    value={destination}
                    onChange={e => setDestination(e.target.value)}
                    placeholder="Room, office, or area"
                    className="w-full p-3 bg-gray-800 rounded-lg border border-gray-700 text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 outline-none transition-all"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1.5 font-medium">Host (staff member)</label>
                  <input
                    value={hostName}
                    onChange={e => setHostName(e.target.value)}
                    placeholder="Optional"
                    className="w-full p-3 bg-gray-800 rounded-lg border border-gray-700 text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 outline-none transition-all"
                  />
                </div>
              </div>

              {/* Notes */}
              <div>
                <label className="block text-sm text-gray-400 mb-1.5 font-medium">Notes</label>
                <textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  rows={2}
                  placeholder="Any additional notes..."
                  className="w-full p-3 bg-gray-800 rounded-lg border border-gray-700 text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 outline-none transition-all resize-none"
                />
              </div>

              {/* Checkboxes */}
              <div className="flex flex-wrap gap-6">
                <label className="flex items-center gap-3 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={idVerified}
                    onChange={e => setIdVerified(e.target.checked)}
                    className="w-5 h-5 rounded border-gray-600 bg-gray-800 text-blue-600 focus:ring-blue-500/30"
                  />
                  <div>
                    <span className="text-sm font-medium">Photo ID Verified</span>
                    <p className="text-xs text-gray-500">Government-issued photo ID checked</p>
                  </div>
                </label>
                <label className="flex items-center gap-3 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={printBadge}
                    onChange={e => setPrintBadge(e.target.checked)}
                    className="w-5 h-5 rounded border-gray-600 bg-gray-800 text-blue-600 focus:ring-blue-500/30"
                  />
                  <div>
                    <span className="text-sm font-medium">Print Badge</span>
                    <p className="text-xs text-gray-500">Print visitor badge after check-in</p>
                  </div>
                </label>
              </div>

              {/* Submit */}
              <button
                onClick={handleManualCheckIn}
                disabled={!firstName.trim() || !lastName.trim() || !purpose || !destination.trim() || loading}
                className="w-full p-4 bg-green-700 hover:bg-green-600 active:bg-green-800 disabled:bg-gray-700 disabled:text-gray-500 rounded-xl font-semibold text-lg transition-all duration-200 active:scale-[0.99]"
              >
                {loading ? 'Processing...' : 'Check In Visitor'}
              </button>
            </div>
          </div>
        )}

        {/* ━━━ Activity Log Tab ━━━ */}
        {tab === 'activity' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xl font-semibold">Today's Activity</h3>
              <button
                onClick={refresh}
                className="text-sm text-blue-400 hover:text-blue-300 transition-colors flex items-center gap-1"
              >
                <svg className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="23 4 23 10 17 10" />
                  <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                </svg>
                Refresh
              </button>
            </div>

            <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
              {activity.length === 0 ? (
                <div className="text-center text-gray-500 py-16 text-lg">No activity today</div>
              ) : (
                <div className="divide-y divide-gray-800">
                  {activity.map((log) => (
                    <div key={log.id} className="flex items-center justify-between p-4 hover:bg-gray-800/30 transition-colors">
                      <div className="flex items-center gap-3">
                        <ActivityBadge action={log.action} />
                        <div>
                          <span className="text-sm font-medium text-gray-200">
                            {formatAction(log.action)}
                          </span>
                          {log.details?.badgeNumber && (
                            <span className="text-sm text-gray-500 ml-2">
                              Badge: <span className="font-mono">{log.details.badgeNumber}</span>
                            </span>
                          )}
                          {!log.details?.badgeNumber && log.entityId && (
                            <span className="text-sm text-gray-600 ml-2">{log.entityId.slice(0, 8)}</span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-4 text-sm text-gray-400 flex-shrink-0">
                        <span>{log.user?.name || 'System'}</span>
                        <span className="text-gray-500 font-mono tabular-nums">
                          {new Date(log.createdAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

/* ── Subcomponents ── */

function StatCard({
  label,
  value,
  color,
  icon,
}: {
  label: string;
  value: number;
  color: string;
  icon: ReactNode;
}) {
  const colorMap: Record<string, { card: string; text: string; icon: string }> = {
    blue: {
      card: 'bg-blue-900/20 border-blue-800/50',
      text: 'text-blue-400',
      icon: 'text-blue-500',
    },
    green: {
      card: 'bg-green-900/20 border-green-800/50',
      text: 'text-green-400',
      icon: 'text-green-500',
    },
    red: {
      card: 'bg-red-900/20 border-red-800/50',
      text: 'text-red-400',
      icon: 'text-red-500',
    },
    gray: {
      card: 'bg-gray-800/50 border-gray-700/50',
      text: 'text-gray-400',
      icon: 'text-gray-500',
    },
  };

  const c = colorMap[color] || colorMap.gray;

  return (
    <div className={`p-5 rounded-xl border ${c.card}`}>
      <div className="flex items-center justify-between mb-3">
        <div className={c.icon}>{icon}</div>
      </div>
      <div className={`text-4xl font-bold ${c.text}`}>{value}</div>
      <div className="text-sm text-gray-400 mt-1">{label}</div>
    </div>
  );
}

function ActivityBadge({ action }: { action: string }) {
  let bgClass = 'bg-gray-700 text-gray-300';
  let icon = (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
    </svg>
  );

  if (action.includes('DENIED')) {
    bgClass = 'bg-red-900/60 text-red-300';
    icon = (
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
      </svg>
    );
  } else if (action.includes('CHECKIN') || action.includes('CHECKED_IN')) {
    bgClass = 'bg-green-900/60 text-green-300';
    icon = (
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="20 6 9 17 4 12" />
      </svg>
    );
  } else if (action.includes('CHECKOUT') || action.includes('CHECKED_OUT')) {
    bgClass = 'bg-blue-900/60 text-blue-300';
    icon = (
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" />
      </svg>
    );
  } else if (action.includes('LOCKDOWN')) {
    bgClass = 'bg-red-900/60 text-red-300';
    icon = (
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
      </svg>
    );
  } else if (action.includes('BADGE')) {
    bgClass = 'bg-purple-900/60 text-purple-300';
    icon = (
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="3" width="20" height="14" rx="2" ry="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" />
      </svg>
    );
  } else if (action.includes('ALERT')) {
    bgClass = 'bg-yellow-900/60 text-yellow-300';
    icon = (
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
    );
  }

  return (
    <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${bgClass}`}>
      {icon}
    </div>
  );
}

function formatAction(action: string): string {
  const map: Record<string, string> = {
    'VISITOR_CHECKED_IN': 'Visitor Checked In',
    'VISITOR_CHECKED_OUT': 'Visitor Checked Out',
    'VISITOR_DENIED': 'Visitor Denied',
    'GUARD_MANUAL_CHECKIN': 'Guard Manual Check-In',
    'GUARD_MANUAL_CHECKOUT': 'Guard Manual Check-Out',
    'BADGE_PRINTED': 'Badge Printed',
    'LOCKDOWN_INITIATED': 'Lockdown Initiated',
    'LOCKDOWN_RELEASED': 'Lockdown Released',
    'GUARD_ALERT_TRIGGERED': 'Guard Alert Triggered',
  };
  return map[action] || action.replace(/_/g, ' ');
}
