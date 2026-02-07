import { useAlerts, useUpdateAlertStatus } from '../../api/alerts';
import { AlertCard } from './AlertCard';

interface AlertListProps {
  siteId?: string;
}

export function AlertList({ siteId }: AlertListProps) {
  const { data: alerts, isLoading } = useAlerts(siteId);
  const updateStatus = useUpdateAlertStatus();

  if (isLoading) {
    return <div className="bg-gray-800 rounded-lg p-6 text-gray-400">Loading alerts...</div>;
  }

  const activeAlerts = (alerts || []).filter((a: any) => !['RESOLVED', 'CANCELLED'].includes(a.status));
  const recentResolved = (alerts || []).filter((a: any) => ['RESOLVED', 'CANCELLED'].includes(a.status)).slice(0, 5);

  return (
    <div className="bg-gray-800 rounded-lg p-6">
      <h2 className="text-lg font-semibold mb-4">
        Alerts
        {activeAlerts.length > 0 && (
          <span className="ml-2 px-2 py-0.5 bg-red-600 text-white text-xs rounded-full">{activeAlerts.length} active</span>
        )}
      </h2>

      {activeAlerts.length === 0 && recentResolved.length === 0 && (
        <p className="text-gray-500 text-sm">No alerts. All clear.</p>
      )}

      {activeAlerts.length > 0 && (
        <div className="space-y-3 mb-6">
          {activeAlerts.map((alert: any) => (
            <AlertCard
              key={alert.id}
              alert={alert}
              onAcknowledge={() => updateStatus.mutate({ id: alert.id, status: 'ACKNOWLEDGED' })}
              onResolve={() => updateStatus.mutate({ id: alert.id, status: 'RESOLVED' })}
              onCancel={() => updateStatus.mutate({ id: alert.id, status: 'CANCELLED' })}
            />
          ))}
        </div>
      )}

      {recentResolved.length > 0 && (
        <>
          <h3 className="text-sm font-medium text-gray-500 mb-2">Recent</h3>
          <div className="space-y-2">
            {recentResolved.map((alert: any) => (
              <AlertCard key={alert.id} alert={alert} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
