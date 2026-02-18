import { useQuery } from '@tanstack/react-query';
import { Activity, HardDrive, MemoryStick, Clock } from 'lucide-react';
import { adminApi } from '../api/client';
import { StatusCard } from '../components/StatusCard';

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / (1024 ** 2)).toFixed(1)} MB`;
  return `${(bytes / (1024 ** 3)).toFixed(1)} GB`;
}

export function StatusPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-status'],
    queryFn: adminApi.getStatus,
    refetchInterval: 10000,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-400">Loading system status...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-900/30 border border-red-500 rounded-lg p-4">
        <p className="text-red-300">Failed to load system status: {(error as Error).message}</p>
        <p className="text-sm text-gray-400 mt-1">
          Make sure the API is running and OPERATING_MODE=edge is set.
        </p>
      </div>
    );
  }

  if (!data) return null;

  const memPercent = data.memory.total > 0
    ? Math.round((data.memory.used / data.memory.total) * 100)
    : 0;
  const diskPercent = data.disk.total > 0
    ? Math.round((data.disk.used / data.disk.total) * 100)
    : 0;

  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">System Status</h2>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatusCard
          title="Uptime"
          value={formatUptime(data.uptime)}
          status="ok"
          icon={<Clock size={16} className="text-gray-500" />}
        />
        <StatusCard
          title="Operating Mode"
          value={data.operatingMode}
          status="info"
          icon={<Activity size={16} className="text-gray-500" />}
        />
        <StatusCard
          title="Memory"
          value={`${memPercent}%`}
          subtitle={`${formatBytes(data.memory.used)} / ${formatBytes(data.memory.total)}`}
          status={memPercent > 90 ? 'error' : memPercent > 70 ? 'warning' : 'ok'}
          icon={<MemoryStick size={16} className="text-gray-500" />}
        />
        <StatusCard
          title="Disk"
          value={`${diskPercent}%`}
          subtitle={`${formatBytes(data.disk.used)} / ${formatBytes(data.disk.total)}`}
          status={diskPercent > 90 ? 'error' : diskPercent > 70 ? 'warning' : 'ok'}
          icon={<HardDrive size={16} className="text-gray-500" />}
        />
      </div>

      <h3 className="text-lg font-semibold mb-3">Services</h3>
      <div className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-700 text-gray-400">
              <th className="text-left px-4 py-2">Service</th>
              <th className="text-left px-4 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {data.services.map((svc) => (
              <tr key={svc.name} className="border-b border-gray-700/50">
                <td className="px-4 py-2 font-medium">{svc.name}</td>
                <td className="px-4 py-2">
                  <span className="flex items-center gap-2">
                    <span
                      className={`w-2 h-2 rounded-full ${
                        svc.status === 'running' || svc.status === 'healthy'
                          ? 'bg-green-500'
                          : svc.status === 'starting'
                            ? 'bg-yellow-500'
                            : 'bg-red-500'
                      }`}
                    />
                    {svc.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 text-xs text-gray-500">
        Node {data.nodeVersion} | Auto-refreshes every 10s
      </div>
    </div>
  );
}
