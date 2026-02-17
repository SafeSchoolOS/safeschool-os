import { useSystemHealth, useActionConfirmations, useHeartbeats } from '../api/systemHealth';
import { useIntegrationHealth } from '../api/integrationHealth';

const STATUS_COLORS: Record<string, string> = {
  healthy: 'bg-green-500',
  degraded: 'bg-yellow-500',
  down: 'bg-red-500',
  unknown: 'bg-gray-500',
};

const INTEGRATION_STATUS_COLORS: Record<string, string> = {
  HEALTHY_INTEGRATION: 'bg-green-500/20 text-green-400 border-green-500/30',
  DEGRADED_INTEGRATION: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  DOWN_INTEGRATION: 'bg-red-500/20 text-red-400 border-red-500/30',
  UNKNOWN_INTEGRATION: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
  DISABLED_INTEGRATION: 'bg-gray-500/10 text-gray-500 border-gray-500/20',
};

const CONFIRMATION_COLORS: Record<string, string> = {
  PENDING_CONFIRMATION: 'bg-blue-500/20 text-blue-400',
  CONFIRMED_ACTION: 'bg-green-500/20 text-green-400',
  PARTIAL_CONFIRMATION: 'bg-yellow-500/20 text-yellow-400',
  FAILED_CONFIRMATION: 'bg-red-500/20 text-red-400',
  TIMED_OUT_CONFIRMATION: 'bg-orange-500/20 text-orange-400',
};

export function SystemHealthPage() {
  const { data: health, isLoading } = useSystemHealth();
  const { data: confirmations } = useActionConfirmations();
  const { data: heartbeats } = useHeartbeats();
  const { data: integrations } = useIntegrationHealth();

  if (isLoading) return <div className="p-6 text-center dark:text-gray-400 text-gray-500">Loading system health...</div>;

  return (
    <div className="p-6 space-y-6">
      <div>
        <h2 className="text-xl font-bold">System Health</h2>
        <p className="text-sm dark:text-gray-400 text-gray-500">Monitor system status, action confirmations, and integration health</p>
      </div>

      {/* Overall Status */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <div className="dark:bg-gray-800 bg-white rounded-lg p-4 border dark:border-gray-700 border-gray-200">
          <div className="flex items-center gap-2">
            <span className={`w-3 h-3 rounded-full ${STATUS_COLORS[health?.status] || STATUS_COLORS.unknown}`} />
            <span className="font-semibold capitalize">{health?.status || 'Unknown'}</span>
          </div>
          <div className="text-xs dark:text-gray-400 text-gray-500 mt-1">System Status</div>
        </div>
        <div className="dark:bg-gray-800 bg-white rounded-lg p-4 border dark:border-gray-700 border-gray-200">
          <div className="text-2xl font-bold">{health?.confirmations?.pending || 0}</div>
          <div className="text-xs dark:text-gray-400 text-gray-500">Pending Confirmations</div>
        </div>
        <div className="dark:bg-gray-800 bg-white rounded-lg p-4 border dark:border-gray-700 border-gray-200">
          <div className="text-2xl font-bold text-red-400">{health?.confirmations?.failed || 0}</div>
          <div className="text-xs dark:text-gray-400 text-gray-500">Failed Confirmations</div>
        </div>
        <div className="dark:bg-gray-800 bg-white rounded-lg p-4 border dark:border-gray-700 border-gray-200">
          <div className="text-2xl font-bold">{health?.queue?.failedJobs || 0}</div>
          <div className="text-xs dark:text-gray-400 text-gray-500">Failed Queue Jobs</div>
        </div>
      </div>

      {/* Integration Health Cards */}
      {integrations && integrations.length > 0 && (
        <div className="dark:bg-gray-800 bg-white rounded-lg border dark:border-gray-700 border-gray-200 p-4">
          <h3 className="font-semibold mb-3">Integration Health</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {integrations.map((int: any) => (
              <div key={int.id} className={`rounded-lg p-3 border text-sm ${INTEGRATION_STATUS_COLORS[int.status] || ''}`}>
                <div className="font-medium">{int.integrationName}</div>
                <div className="text-xs mt-1 opacity-75">{int.integrationType.replace('_INT', '')}</div>
                <div className="text-xs mt-1">
                  {int.lastSuccessAt ? `Last OK: ${new Date(int.lastSuccessAt).toLocaleString()}` : 'Never checked'}
                </div>
                {int.lastError && <div className="text-xs mt-1 truncate" title={int.lastError}>{int.lastError}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Edge & Gateway Status */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {health?.edge && (
          <div className="dark:bg-gray-800 bg-white rounded-lg border dark:border-gray-700 border-gray-200 p-4">
            <h3 className="font-semibold mb-2">Edge Device</h3>
            <div className="space-y-1 text-sm">
              <div className="flex justify-between"><span className="dark:text-gray-400 text-gray-500">Version:</span><span>{health.edge.version || 'N/A'}</span></div>
              <div className="flex justify-between"><span className="dark:text-gray-400 text-gray-500">Mode:</span><span>{health.edge.mode || 'N/A'}</span></div>
              <div className="flex justify-between"><span className="dark:text-gray-400 text-gray-500">Last Heartbeat:</span><span>{new Date(health.edge.lastHeartbeat).toLocaleString()}</span></div>
              <div className="flex justify-between"><span className="dark:text-gray-400 text-gray-500">Status:</span><span className={health.edge.stale ? 'text-red-400' : 'text-green-400'}>{health.edge.stale ? 'STALE' : 'OK'}</span></div>
            </div>
          </div>
        )}
        <div className="dark:bg-gray-800 bg-white rounded-lg border dark:border-gray-700 border-gray-200 p-4">
          <h3 className="font-semibold mb-2">Gateways ({health?.gateways?.length || 0})</h3>
          <div className="space-y-2">
            {(health?.gateways || []).map((gw: any) => (
              <div key={gw.id} className="flex items-center justify-between text-sm">
                <span>{gw.name}</span>
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${gw.stale ? 'bg-red-500' : 'bg-green-500'}`} />
                  <span className="text-xs dark:text-gray-400 text-gray-500">{gw.status}</span>
                </div>
              </div>
            ))}
            {(!health?.gateways || health.gateways.length === 0) && (
              <div className="text-sm dark:text-gray-500 text-gray-400">No gateways configured</div>
            )}
          </div>
        </div>
      </div>

      {/* Action Confirmations Feed */}
      <div className="dark:bg-gray-800 bg-white rounded-lg border dark:border-gray-700 border-gray-200">
        <div className="px-4 py-3 border-b dark:border-gray-700 border-gray-200">
          <h3 className="font-semibold">Action Confirmation Feed</h3>
        </div>
        <div className="divide-y dark:divide-gray-700 divide-gray-200">
          {(confirmations || []).slice(0, 20).map((c: any) => (
            <div key={c.id} className="px-4 py-3 flex items-center justify-between">
              <div>
                <div className="text-sm font-medium">{c.actionType.replace('_ACTION', '').replace('_', ' ')}</div>
                <div className="text-xs dark:text-gray-400 text-gray-500">{new Date(c.initiatedAt).toLocaleString()}</div>
              </div>
              <span className={`px-2 py-0.5 rounded text-xs ${CONFIRMATION_COLORS[c.status] || ''}`}>
                {c.status.replace('_CONFIRMATION', '').replace('_ACTION', '')}
              </span>
            </div>
          ))}
          {(!confirmations || confirmations.length === 0) && (
            <div className="px-4 py-8 text-center dark:text-gray-500 text-gray-400 text-sm">No action confirmations</div>
          )}
        </div>
      </div>
    </div>
  );
}
