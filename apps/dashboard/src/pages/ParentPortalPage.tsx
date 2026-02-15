import { useParentDashboard } from '../api/parent';
import type { ParentChild, ParentBusStatus, ParentNotification } from '../api/parent';

function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDateTime(dateStr: string): string {
  return new Date(dateStr).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

// ---------------------------------------------------------------------------
// School Status Card
// ---------------------------------------------------------------------------
function SchoolStatusCard({ status, alerts }: { status: string; alerts: { level: string; message: string | null; triggeredAt: string }[] }) {
  const config = {
    ALL_CLEAR: {
      bg: 'bg-emerald-900/30',
      border: 'border-emerald-700/50',
      dot: 'bg-emerald-400',
      label: 'All Clear',
      sublabel: 'No active alerts. Your school is operating normally.',
      textColor: 'text-emerald-300',
    },
    LOCKDOWN: {
      bg: 'bg-red-900/40',
      border: 'border-red-600/60',
      dot: 'bg-red-500 animate-pulse',
      label: 'Lockdown Active',
      sublabel: 'The school is currently in lockdown. Follow all instructions from school staff.',
      textColor: 'text-red-300',
    },
    ALERT_ACTIVE: {
      bg: 'bg-amber-900/30',
      border: 'border-amber-600/50',
      dot: 'bg-amber-400 animate-pulse',
      label: 'Alert Active',
      sublabel: 'There is an active situation. Check notifications for updates.',
      textColor: 'text-amber-300',
    },
  }[status] || {
    bg: 'bg-gray-800',
    border: 'border-gray-700',
    dot: 'bg-gray-400',
    label: 'Unknown',
    sublabel: '',
    textColor: 'text-gray-300',
  };

  return (
    <div className={`rounded-xl ${config.bg} border ${config.border} p-6`}>
      <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">School Status</h2>
      <div className="flex items-center gap-3 mb-3">
        <span className={`w-4 h-4 rounded-full ${config.dot} flex-shrink-0`} />
        <span className={`text-2xl font-bold ${config.textColor}`}>{config.label}</span>
      </div>
      <p className="text-sm text-gray-400 leading-relaxed">{config.sublabel}</p>
      {alerts.length > 0 && (
        <div className="mt-4 space-y-2">
          {alerts.map((alert, i) => (
            <div key={i} className="text-sm text-gray-300 bg-black/20 rounded-lg px-3 py-2 flex items-center justify-between">
              <span>{alert.message || alert.level.replace('_', ' ')}</span>
              <span className="text-xs text-gray-500">{timeAgo(alert.triggeredAt)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// My Children Card
// ---------------------------------------------------------------------------
function ChildrenCard({ children }: { children: ParentChild[] }) {
  if (children.length === 0) {
    return (
      <div className="rounded-xl bg-gray-800/60 border border-gray-700 p-6">
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">My Children</h2>
        <p className="text-gray-500 text-sm">No students linked to your account. Contact your school to set up your parent profile.</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl bg-gray-800/60 border border-gray-700 p-6">
      <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">My Children</h2>
      <div className="space-y-3">
        {children.map((child) => (
          <div key={child.id} className="bg-gray-900/50 rounded-lg p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-blue-400 font-bold text-sm">
                {child.studentName.split(' ').map((n) => n[0]).join('').slice(0, 2)}
              </div>
              <div>
                <div className="font-medium text-white">{child.studentName}</div>
                <div className="text-xs text-gray-400 flex items-center gap-2">
                  {child.grade && <span>Grade {child.grade}</span>}
                  {child.busNumber && (
                    <>
                      <span className="text-gray-600">|</span>
                      <span>Bus #{child.busNumber}</span>
                    </>
                  )}
                </div>
              </div>
            </div>
            <div className="text-right">
              {child.status === 'ON_BUS' ? (
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-400 bg-blue-500/10 border border-blue-500/20 rounded-full px-2.5 py-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                  On Bus
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-400 bg-gray-700/50 border border-gray-600/30 rounded-full px-2.5 py-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-gray-500" />
                  At School
                </span>
              )}
              {child.latestScan && (
                <div className="text-xs text-gray-500 mt-1">
                  {child.latestScan.scanType === 'BOARD' ? 'Boarded' : 'Exited'}{' '}
                  {timeAgo(child.latestScan.scannedAt)}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bus Tracker Card
// ---------------------------------------------------------------------------
function BusTrackerCard({ buses, children }: { buses: ParentBusStatus[]; children: ParentChild[] }) {
  if (buses.length === 0) {
    return (
      <div className="rounded-xl bg-gray-800/60 border border-gray-700 p-6">
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Bus Tracker</h2>
        <p className="text-gray-500 text-sm">No active buses assigned to your children.</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl bg-gray-800/60 border border-gray-700 p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Bus Tracker</h2>
        <span className="text-xs text-gray-500">Auto-refreshes every 10s</span>
      </div>
      <div className="space-y-3">
        {buses.map((bus) => {
          const studentsOnBus = children.filter((c) => c.busId === bus.id && c.status === 'ON_BUS');
          return (
            <div key={bus.id} className="bg-gray-900/50 rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <svg className="w-5 h-5 text-yellow-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                  </svg>
                  <span className="font-semibold text-white">Bus #{bus.busNumber}</span>
                </div>
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${bus.isActive ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-gray-700 text-gray-400 border border-gray-600'}`}>
                  {bus.isActive ? 'Active' : 'Inactive'}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="text-gray-500">Speed</span>
                  <div className="text-white font-medium">
                    {bus.currentSpeed != null ? `${Math.round(bus.currentSpeed)} mph` : '--'}
                  </div>
                </div>
                <div>
                  <span className="text-gray-500">Students</span>
                  <div className="text-white font-medium">{bus.currentStudentCount}</div>
                </div>
                <div>
                  <span className="text-gray-500">Last Update</span>
                  <div className="text-white font-medium">
                    {bus.lastGpsAt ? timeAgo(bus.lastGpsAt) : 'No data'}
                  </div>
                </div>
                <div>
                  <span className="text-gray-500">Your Kids</span>
                  <div className="text-white font-medium">
                    {studentsOnBus.length > 0
                      ? studentsOnBus.map((s) => s.studentName.split(' ')[0]).join(', ')
                      : 'None on bus'}
                  </div>
                </div>
              </div>

              {bus.currentLatitude != null && bus.currentLongitude != null && (
                <div className="mt-3 text-xs text-gray-500 flex items-center gap-1">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
                  </svg>
                  <span>
                    {bus.currentLatitude.toFixed(4)}, {bus.currentLongitude.toFixed(4)}
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Recent Notifications Card
// ---------------------------------------------------------------------------
function NotificationsCard({ notifications }: { notifications: ParentNotification[] }) {
  if (notifications.length === 0) {
    return (
      <div className="rounded-xl bg-gray-800/60 border border-gray-700 p-6">
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Recent Notifications</h2>
        <p className="text-gray-500 text-sm">No recent notifications.</p>
      </div>
    );
  }

  const channelIcons: Record<string, string> = {
    SMS: 'M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z',
    EMAIL: 'M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z',
    PUSH: 'M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9',
    PA: 'M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z',
  };

  return (
    <div className="rounded-xl bg-gray-800/60 border border-gray-700 p-6">
      <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Recent Notifications</h2>
      <div className="space-y-2 max-h-80 overflow-y-auto">
        {notifications.map((notif) => (
          <div key={notif.id} className="flex items-start gap-3 bg-gray-900/30 rounded-lg px-3 py-2.5">
            <svg className="w-4 h-4 text-gray-500 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d={channelIcons[notif.channel] || channelIcons.PUSH} />
            </svg>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-gray-300 leading-snug line-clamp-2">{notif.message}</p>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-xs text-gray-500">{formatDateTime(notif.sentAt)}</span>
                <span className="text-xs text-gray-600">via {notif.channel}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Emergency Contacts Card
// ---------------------------------------------------------------------------
function EmergencyContactsCard({ site }: { site: { name: string; address: string; city: string; state: string; zip: string } | null }) {
  return (
    <div className="rounded-xl bg-gray-800/60 border border-gray-700 p-6">
      <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Emergency Contacts</h2>
      {site ? (
        <div className="space-y-4">
          <div>
            <div className="text-sm font-medium text-white mb-1">{site.name}</div>
            <div className="text-sm text-gray-400">
              {site.address}<br />
              {site.city}, {site.state} {site.zip}
            </div>
          </div>
          <div className="border-t border-gray-700 pt-3 space-y-2">
            <div className="flex items-center gap-2 text-sm">
              <svg className="w-4 h-4 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z" />
              </svg>
              <span className="text-gray-300">Emergency: 911</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <svg className="w-4 h-4 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
              </svg>
              <span className="text-gray-300">School Main Office</span>
            </div>
          </div>
        </div>
      ) : (
        <p className="text-gray-500 text-sm">School information unavailable.</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Parent Portal Page
// ---------------------------------------------------------------------------
export function ParentPortalPage() {
  const { data, isLoading, error } = useParentDashboard();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-gray-400 text-sm">Loading your dashboard...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="bg-red-900/20 border border-red-700/50 rounded-xl p-6 max-w-md text-center">
          <svg className="w-10 h-10 text-red-400 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
          <h3 className="text-red-300 font-semibold mb-1">Unable to load dashboard</h3>
          <p className="text-sm text-gray-400">Please try refreshing the page. If the issue persists, contact your school administrator.</p>
        </div>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="p-3 sm:p-6 max-w-5xl mx-auto space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="mb-2">
        <h1 className="text-2xl font-bold text-white">Parent Portal</h1>
        <p className="text-sm text-gray-400 mt-1">Stay informed about your children's safety and transportation.</p>
      </div>

      {/* School Status — always at top */}
      <SchoolStatusCard status={data.schoolStatus} alerts={data.activeAlerts} />

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left Column */}
        <div className="space-y-6">
          <ChildrenCard children={data.children} />
          <BusTrackerCard buses={data.busStatus} children={data.children} />
        </div>

        {/* Right Column */}
        <div className="space-y-6">
          <NotificationsCard notifications={data.recentNotifications} />
          <EmergencyContactsCard site={data.site} />
        </div>
      </div>
    </div>
  );
}
