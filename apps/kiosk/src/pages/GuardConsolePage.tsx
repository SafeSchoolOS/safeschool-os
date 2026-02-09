import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

const API_BASE = '/api/v1';
const SITE_ID = import.meta.env.VITE_SITE_ID || '';

function guardApi(path: string, options?: RequestInit) {
  const token = localStorage.getItem('safeschool_guard_token') || '';
  return fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      ...options?.headers,
    },
  }).then(async res => {
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
    return res.json();
  });
}

type Tab = 'dashboard' | 'visitors' | 'checkin' | 'activity';

export function GuardConsolePage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('dashboard');
  const [dashboard, setDashboard] = useState<any>(null);
  const [visitors, setVisitors] = useState<any[]>([]);
  const [activity, setActivity] = useState<any[]>([]);
  const [error, setError] = useState('');

  // Manual check-in form
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [purpose, setPurpose] = useState('');
  const [destination, setDestination] = useState('');
  const [idVerified, setIdVerified] = useState(false);

  const refresh = useCallback(async () => {
    try {
      if (tab === 'dashboard' || !dashboard) {
        const data = await guardApi(`/guard/${SITE_ID}/dashboard`);
        setDashboard(data);
      }
      if (tab === 'visitors') {
        const data = await guardApi(`/guard/${SITE_ID}/visitors`);
        setVisitors(data);
      }
      if (tab === 'activity') {
        const data = await guardApi(`/guard/${SITE_ID}/activity`);
        setActivity(data);
      }
    } catch (err: any) {
      if (err.message?.includes('license') || err.message?.includes('403')) {
        navigate('/');
        return;
      }
      setError(err.message);
    }
  }, [tab, dashboard, navigate]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 10000); // Refresh every 10s
    return () => clearInterval(interval);
  }, [refresh]);

  const handleCheckOut = async (visitorId: string) => {
    try {
      await guardApi(`/guard/${SITE_ID}/manual-checkout/${visitorId}`, { method: 'POST' });
      refresh();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleManualCheckIn = async () => {
    if (!firstName || !lastName || !purpose || !destination) return;
    try {
      await guardApi(`/guard/${SITE_ID}/manual-checkin`, {
        method: 'POST',
        body: JSON.stringify({ firstName, lastName, purpose, destination, idVerified }),
      });
      setFirstName(''); setLastName(''); setPurpose(''); setDestination(''); setIdVerified(false);
      setTab('visitors');
      refresh();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('safeschool_guard_token');
    navigate('/');
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Header */}
      <div className={`px-6 py-3 flex items-center justify-between ${dashboard?.isLockdown ? 'bg-red-900' : 'bg-gray-900'}`}>
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-bold">BadgeKiosk Guard Console</h1>
          {dashboard?.isLockdown && (
            <span className="bg-red-600 text-white px-3 py-1 rounded-full text-sm font-bold animate-pulse">
              LOCKDOWN ACTIVE
            </span>
          )}
        </div>
        <div className="flex items-center gap-4">
          <span className="text-gray-400 text-sm">{new Date().toLocaleString()}</span>
          <button onClick={handleLogout} className="text-gray-400 hover:text-white text-sm">Logout</button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-800">
        {([
          ['dashboard', 'Dashboard'],
          ['visitors', 'Active Visitors'],
          ['checkin', 'Manual Check-In'],
          ['activity', 'Activity Log'],
        ] as [Tab, string][]).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-6 py-3 text-sm font-medium transition-colors ${
              tab === key ? 'text-blue-400 border-b-2 border-blue-400' : 'text-gray-400 hover:text-white'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {error && (
        <div className="mx-6 mt-4 bg-red-900/50 text-red-300 px-4 py-2 rounded-lg text-sm">
          {error}
          <button onClick={() => setError('')} className="ml-4 text-red-400">&times;</button>
        </div>
      )}

      <div className="p-6">
        {/* Dashboard Tab */}
        {tab === 'dashboard' && dashboard && (
          <div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
              <StatCard label="Active Visitors" value={dashboard.activeVisitors} color="blue" />
              <StatCard label="Today Check-Ins" value={dashboard.todayCheckIns} color="green" />
              <StatCard label="Today Check-Outs" value={dashboard.todayCheckOuts} color="gray" />
              <StatCard label="Flagged" value={dashboard.flaggedVisitors} color={dashboard.flaggedVisitors > 0 ? 'red' : 'gray'} />
            </div>

            <h3 className="text-lg font-semibold mb-3">Exterior Doors</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {dashboard.exteriorDoors?.map((door: any) => (
                <div key={door.id} className={`p-3 rounded-lg ${
                  door.status === 'LOCKED' ? 'bg-green-900/30 border border-green-800' :
                  door.status === 'UNLOCKED' ? 'bg-yellow-900/30 border border-yellow-800' :
                  'bg-red-900/30 border border-red-800'
                }`}>
                  <div className="text-sm font-medium">{door.name}</div>
                  <div className={`text-xs ${
                    door.status === 'LOCKED' ? 'text-green-400' :
                    door.status === 'UNLOCKED' ? 'text-yellow-400' : 'text-red-400'
                  }`}>{door.status}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Active Visitors Tab */}
        {tab === 'visitors' && (
          <div>
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold">Active Visitors ({visitors.length})</h3>
              <button onClick={refresh} className="text-sm text-blue-400 hover:text-blue-300">Refresh</button>
            </div>
            <div className="space-y-2">
              {visitors.map(v => (
                <div key={v.id} className={`flex items-center justify-between p-4 rounded-lg ${
                  v.screeningStatus === 'FLAGGED' ? 'bg-red-900/30 border border-red-800' : 'bg-gray-800'
                }`}>
                  <div className="flex items-center gap-4">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center text-lg font-bold ${
                      v.screeningStatus === 'FLAGGED' ? 'bg-red-700' : 'bg-blue-700'
                    }`}>
                      {v.firstName[0]}{v.lastName[0]}
                    </div>
                    <div>
                      <div className="font-semibold">{v.firstName} {v.lastName}</div>
                      <div className="text-sm text-gray-400">
                        Badge: {v.badgeNumber} | {v.destination} | {v.purpose}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right text-sm">
                      {v.host && <div className="text-gray-400">Host: {v.host}</div>}
                      <div className="text-gray-500">{v.duration}m ago</div>
                    </div>
                    <button
                      onClick={() => handleCheckOut(v.id)}
                      className="px-4 py-2 bg-red-700 hover:bg-red-600 rounded-lg text-sm transition-colors"
                    >
                      Check Out
                    </button>
                  </div>
                </div>
              ))}
              {visitors.length === 0 && (
                <div className="text-center text-gray-500 py-8">No active visitors</div>
              )}
            </div>
          </div>
        )}

        {/* Manual Check-In Tab */}
        {tab === 'checkin' && (
          <div className="max-w-lg">
            <h3 className="text-lg font-semibold mb-4">Manual Visitor Check-In</h3>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-gray-400 mb-1">First Name</label>
                  <input value={firstName} onChange={e => setFirstName(e.target.value)}
                    className="w-full p-3 bg-gray-800 rounded-lg border border-gray-700 text-white" />
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Last Name</label>
                  <input value={lastName} onChange={e => setLastName(e.target.value)}
                    className="w-full p-3 bg-gray-800 rounded-lg border border-gray-700 text-white" />
                </div>
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Purpose of Visit</label>
                <select value={purpose} onChange={e => setPurpose(e.target.value)}
                  className="w-full p-3 bg-gray-800 rounded-lg border border-gray-700 text-white">
                  <option value="">Select purpose...</option>
                  <option>Parent Visit</option>
                  <option>Vendor/Contractor</option>
                  <option>Meeting</option>
                  <option>Volunteer</option>
                  <option>Delivery</option>
                  <option>Emergency Contact</option>
                  <option>Other</option>
                </select>
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Destination</label>
                <input value={destination} onChange={e => setDestination(e.target.value)}
                  placeholder="Room, office, or area"
                  className="w-full p-3 bg-gray-800 rounded-lg border border-gray-700 text-white" />
              </div>
              <label className="flex items-center gap-3 cursor-pointer">
                <input type="checkbox" checked={idVerified} onChange={e => setIdVerified(e.target.checked)}
                  className="w-5 h-5 rounded" />
                <span className="text-sm">Photo ID verified</span>
              </label>
              <button
                onClick={handleManualCheckIn}
                disabled={!firstName || !lastName || !purpose || !destination}
                className="w-full p-3 bg-green-700 hover:bg-green-600 disabled:bg-gray-700 rounded-lg font-semibold transition-colors"
              >
                Check In Visitor
              </button>
            </div>
          </div>
        )}

        {/* Activity Log Tab */}
        {tab === 'activity' && (
          <div>
            <h3 className="text-lg font-semibold mb-4">Today's Activity</h3>
            <div className="space-y-2">
              {activity.map((log: any) => (
                <div key={log.id} className="flex items-center justify-between p-3 bg-gray-800 rounded-lg text-sm">
                  <div className="flex items-center gap-3">
                    <span className={`px-2 py-1 rounded text-xs font-medium ${
                      log.action.includes('DENIED') ? 'bg-red-900 text-red-300' :
                      log.action.includes('CHECKIN') || log.action.includes('CHECKED_IN') ? 'bg-green-900 text-green-300' :
                      log.action.includes('CHECKOUT') || log.action.includes('CHECKED_OUT') ? 'bg-blue-900 text-blue-300' :
                      log.action.includes('LOCKDOWN') ? 'bg-red-900 text-red-300' :
                      log.action.includes('BADGE') ? 'bg-purple-900 text-purple-300' :
                      'bg-gray-700 text-gray-300'
                    }`}>
                      {log.action.replace(/_/g, ' ')}
                    </span>
                    <span className="text-gray-300">{log.details?.badgeNumber || log.entityId?.slice(0, 8)}</span>
                  </div>
                  <div className="flex items-center gap-4 text-gray-400">
                    <span>{log.user?.name || 'System'}</span>
                    <span>{new Date(log.createdAt).toLocaleTimeString()}</span>
                  </div>
                </div>
              ))}
              {activity.length === 0 && (
                <div className="text-center text-gray-500 py-8">No activity today</div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  const colorMap: Record<string, string> = {
    blue: 'bg-blue-900/30 border-blue-800 text-blue-400',
    green: 'bg-green-900/30 border-green-800 text-green-400',
    red: 'bg-red-900/30 border-red-800 text-red-400',
    gray: 'bg-gray-800 border-gray-700 text-gray-400',
  };

  return (
    <div className={`p-4 rounded-xl border ${colorMap[color] || colorMap.gray}`}>
      <div className="text-3xl font-bold">{value}</div>
      <div className="text-sm mt-1">{label}</div>
    </div>
  );
}
