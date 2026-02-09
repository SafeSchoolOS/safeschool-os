import { useAuth } from '../hooks/useAuth';
import { useSites } from '../api/sites';
import { AlertList } from '../components/alerts/AlertList';
import { CreateAlertButton } from '../components/alerts/CreateAlertButton';
import { DoorStatusGrid } from '../components/doors/DoorStatusGrid';
import { LockdownControls } from '../components/lockdown/LockdownControls';
import { BuildingMap } from '../components/map/BuildingMap';
import { SendNotificationForm } from '../components/notifications/SendNotificationForm';

export function CommandCenter() {
  const { user } = useAuth();
  const { data: sites } = useSites();
  const siteId = user?.siteIds[0];
  const site = sites?.[0];

  return (
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
  );
}
