import { useQuery } from '@tanstack/react-query';
import { Cloud, CloudOff, RefreshCw } from 'lucide-react';
import { adminApi } from '../api/client';
import { StatusCard } from '../components/StatusCard';

export function SyncPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-sync'],
    queryFn: adminApi.getSync,
    refetchInterval: 5000,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-400">Loading sync state...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-900/30 border border-red-500 rounded-lg p-4">
        <p className="text-red-300">Failed to load sync state: {(error as Error).message}</p>
      </div>
    );
  }

  if (!data) return null;

  const lastSync = data.lastSyncAt
    ? new Date(data.lastSyncAt).toLocaleString()
    : 'Never';

  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">Cloud Sync</h2>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatusCard
          title="Connection"
          value={data.connected ? 'Connected' : 'Disconnected'}
          status={data.connected ? 'ok' : 'warning'}
          icon={data.connected
            ? <Cloud size={16} className="text-gray-500" />
            : <CloudOff size={16} className="text-gray-500" />
          }
        />
        <StatusCard
          title="Mode"
          value={data.mode}
          status="info"
          icon={<RefreshCw size={16} className="text-gray-500" />}
        />
        <StatusCard
          title="Pending Changes"
          value={String(data.pendingChanges)}
          status={data.pendingChanges > 100 ? 'warning' : 'ok'}
        />
        <StatusCard
          title="Queue Size"
          value={String(data.queueSize)}
          status={data.queueSize > 500 ? 'error' : data.queueSize > 100 ? 'warning' : 'ok'}
        />
      </div>

      <div className="bg-gray-800 rounded-lg border border-gray-700 p-4 space-y-3">
        <h3 className="text-lg font-semibold">Sync Details</h3>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-gray-400">Cloud URL:</span>
            <span className="ml-2 font-mono text-xs">{data.cloudUrl || 'Not configured'}</span>
          </div>
          <div>
            <span className="text-gray-400">Last Sync:</span>
            <span className="ml-2">{lastSync}</span>
          </div>
        </div>

        {!data.edgeruntimeUrl && (
          <div className="bg-yellow-900/20 border border-yellow-700 rounded-lg p-3 text-sm text-yellow-300">
            EdgeRuntime not connected. This device is running in standalone mode. Ensure the
            edgeruntime service is running to enable sync features.
          </div>
        )}
      </div>
    </div>
  );
}
