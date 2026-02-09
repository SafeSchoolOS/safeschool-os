import { useAuth } from '../hooks/useAuth';
import { useSites } from '../api/sites';
import { useWebSocket } from '../ws/useWebSocket';
import { useActiveVisitors } from '../api/visitors';
import { useBuses } from '../api/transportation';
import { AlertList } from '../components/alerts/AlertList';
import { CreateAlertButton } from '../components/alerts/CreateAlertButton';
import { DoorStatusGrid } from '../components/doors/DoorStatusGrid';
import { LockdownControls } from '../components/lockdown/LockdownControls';
import { BuildingMap } from '../components/map/BuildingMap';
import { SendNotificationForm } from '../components/notifications/SendNotificationForm';

export function CommandCenter() {
  const { user, logout } = useAuth();
  const { data: sites } = useSites();
  const siteId = user?.siteIds[0];
  const { data: activeVisitors } = useActiveVisitors();
  const { data: buses } = useBuses();

  useWebSocket(siteId);

  const site = sites?.[0];
  const activeBusCount = (buses || []).filter((b: any) => b.isActive).length;

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {/* Header */}
      <header className="bg-gray-800 border-b border-gray-700 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-bold">SafeSchool OS</h1>
          {site && <span className="text-gray-400 text-sm">{site.name}</span>}
        </div>
        <div className="flex items-center gap-4">
          <a href="/visitors" className="text-sm text-blue-400 hover:text-blue-300 transition-colors">Visitors</a>
          <a href="/transportation" className="text-sm text-blue-400 hover:text-blue-300 transition-colors">Transportation</a>
          <a href="/threat-assessment" className="text-sm text-blue-400 hover:text-blue-300 transition-colors">Threats</a>
          <a href="/social-media" className="text-sm text-blue-400 hover:text-blue-300 transition-colors">Social Media</a>
          <a href="/drills" className="text-sm text-blue-400 hover:text-blue-300 transition-colors">Drills</a>
          <a href="/reunification" className="text-sm text-blue-400 hover:text-blue-300 transition-colors">Reunification</a>
          <a href="/grants" className="text-sm text-blue-400 hover:text-blue-300 transition-colors">Grants</a>
          <a href="/audit-log" className="text-sm text-blue-400 hover:text-blue-300 transition-colors">Audit Log</a>
          <a href="/badgekiosk" className="text-sm text-green-400 hover:text-green-300 transition-colors">BadgeKiosk</a>
          <span className="text-sm text-gray-400">{user?.name} ({user?.role})</span>
          <button onClick={logout} className="text-sm text-gray-400 hover:text-white transition-colors">
            Sign Out
          </button>
        </div>
      </header>

      {/* Status bar with Phase 2 widgets */}
      <div className="bg-gray-800/50 border-b border-gray-700 px-6 py-2 flex items-center gap-6">
        <div className="flex items-center gap-2 text-sm">
          <span className="w-2 h-2 bg-green-500 rounded-full"></span>
          <span className="text-gray-400">Visitors:</span>
          <span className="font-medium">{activeVisitors?.length || 0} active</span>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="w-2 h-2 bg-yellow-500 rounded-full"></span>
          <span className="text-gray-400">Buses:</span>
          <span className="font-medium">{activeBusCount} active</span>
        </div>
      </div>

      {/* Main Content */}
      <div className="p-6 grid grid-cols-12 gap-6">
        {/* Left column: Map + Alert Creation */}
        <div className="col-span-8 space-y-6">
          {/* PANIC Button */}
          {site && <CreateAlertButton siteId={siteId!} buildings={site.buildings || []} />}

          {/* Building Map */}
          {site && <BuildingMap site={site} />}

          {/* Alert List */}
          <AlertList siteId={siteId} />
        </div>

        {/* Right column: Door Status + Lockdown + Notifications */}
        <div className="col-span-4 space-y-6">
          <LockdownControls siteId={siteId} buildings={site?.buildings || []} />
          <DoorStatusGrid siteId={siteId} />
          <SendNotificationForm />
        </div>
      </div>
    </div>
  );
}
