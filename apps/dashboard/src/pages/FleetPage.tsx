import { useState } from 'react';
import { useFleetDevices, useFleetSummary, useUpgradeDevice, useUpgradeAll, type EdgeDevice } from '../api/fleet';

function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function isStale(dateStr: string): boolean {
  return Date.now() - new Date(dateStr).getTime() > 5 * 60 * 1000;
}

const STATUS_COLORS: Record<string, string> = {
  IDLE: 'bg-gray-500/20 text-gray-400',
  PENDING: 'bg-blue-500/20 text-blue-400',
  IN_PROGRESS: 'bg-yellow-500/20 text-yellow-400',
  SUCCESS: 'bg-green-500/20 text-green-400',
  FAILED: 'bg-red-500/20 text-red-400',
};

export function FleetPage() {
  const { data: devices, isLoading } = useFleetDevices();
  const { data: summary } = useFleetSummary();
  const upgradeDevice = useUpgradeDevice();
  const upgradeAll = useUpgradeAll();
  const [targetVersion, setTargetVersion] = useState('');

  const handleUpgrade = (device: EdgeDevice) => {
    const version = targetVersion || prompt('Enter target version (git short SHA):');
    if (!version) return;
    upgradeDevice.mutate({ id: device.id, targetVersion: version });
  };

  const handleUpgradeAll = () => {
    const version = targetVersion || prompt('Enter target version (git short SHA) for all devices:');
    if (!version) return;
    if (!confirm(`Push version ${version} to all idle edge devices?`)) return;
    upgradeAll.mutate(version);
  };

  return (
    <div className="p-3 sm:p-6 space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold dark:text-white text-gray-900">Fleet Management</h2>
          <p className="text-sm dark:text-gray-400 text-gray-500 mt-1">
            Monitor and upgrade edge devices across all sites
          </p>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="text"
            placeholder="Target version..."
            value={targetVersion}
            onChange={(e) => setTargetVersion(e.target.value)}
            className="px-3 py-2 text-sm rounded-lg dark:bg-gray-700 bg-gray-200 dark:text-white text-gray-900 dark:border-gray-600 border-gray-300 border focus:outline-none focus:ring-2 focus:ring-blue-500 w-44"
          />
          <button
            onClick={handleUpgradeAll}
            disabled={upgradeAll.isPending}
            className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {upgradeAll.isPending ? 'Pushing...' : 'Upgrade All'}
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-4 gap-4">
          <div className="dark:bg-gray-800 bg-white rounded-xl p-4 dark:border-gray-700 border-gray-200 border">
            <div className="text-sm dark:text-gray-400 text-gray-500">Total Devices</div>
            <div className="text-2xl font-bold mt-1">{summary.total}</div>
          </div>
          <div className="dark:bg-gray-800 bg-white rounded-xl p-4 dark:border-gray-700 border-gray-200 border">
            <div className="text-sm dark:text-gray-400 text-gray-500">Online</div>
            <div className="text-2xl font-bold text-green-400 mt-1">{summary.online}</div>
          </div>
          <div className="dark:bg-gray-800 bg-white rounded-xl p-4 dark:border-gray-700 border-gray-200 border">
            <div className="text-sm dark:text-gray-400 text-gray-500">Stale (&gt; 5m)</div>
            <div className="text-2xl font-bold text-red-400 mt-1">{summary.stale}</div>
          </div>
          <div className="dark:bg-gray-800 bg-white rounded-xl p-4 dark:border-gray-700 border-gray-200 border">
            <div className="text-sm dark:text-gray-400 text-gray-500">Versions</div>
            <div className="mt-1 space-y-1">
              {Object.entries(summary.versionCounts).map(([ver, count]) => (
                <div key={ver} className="flex items-center justify-between text-sm">
                  <code className="dark:text-gray-300 text-gray-700">{ver}</code>
                  <span className="font-medium">{count}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Device Table */}
      <div className="dark:bg-gray-800 bg-white rounded-xl dark:border-gray-700 border-gray-200 border overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="dark:bg-gray-700/50 bg-gray-50 text-left text-sm dark:text-gray-400 text-gray-500">
              <th className="px-4 py-3 font-medium">Site</th>
              <th className="px-4 py-3 font-medium">Hostname</th>
              <th className="px-4 py-3 font-medium">Version</th>
              <th className="px-4 py-3 font-medium">Mode</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Last Heartbeat</th>
              <th className="px-4 py-3 font-medium">System</th>
              <th className="px-4 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y dark:divide-gray-700 divide-gray-200">
            {isLoading && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center dark:text-gray-400 text-gray-500">
                  Loading devices...
                </td>
              </tr>
            )}
            {devices && devices.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center dark:text-gray-400 text-gray-500">
                  No edge devices have connected yet. Devices appear here after their first heartbeat.
                </td>
              </tr>
            )}
            {devices?.map((device) => {
              const stale = isStale(device.lastHeartbeatAt);
              const hasTarget = device.targetVersion && device.currentVersion !== device.targetVersion;
              const canUpgrade = device.upgradeStatus === 'IDLE' || device.upgradeStatus === 'FAILED';
              return (
                <tr key={device.id} className="dark:hover:bg-gray-700/30 hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="font-medium dark:text-white text-gray-900">{device.site.name}</div>
                    <div className="text-xs dark:text-gray-500 text-gray-400">{device.site.district}</div>
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <code className="dark:text-gray-300 text-gray-700">{device.hostname || '-'}</code>
                    {device.ipAddress && (
                      <div className="text-xs dark:text-gray-500 text-gray-400">{device.ipAddress}</div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <code className={`text-sm ${hasTarget ? 'text-yellow-400' : 'text-green-400'}`}>
                      {device.currentVersion || '-'}
                    </code>
                    {hasTarget && (
                      <div className="text-xs text-yellow-500 mt-0.5">
                        target: {device.targetVersion}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm dark:text-gray-300 text-gray-700">
                    {device.operatingMode || '-'}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[device.upgradeStatus] || STATUS_COLORS.IDLE}`}>
                      {device.upgradeStatus}
                    </span>
                    {device.upgradeError && (
                      <div className="text-xs text-red-400 mt-1 max-w-48 truncate" title={device.upgradeError}>
                        {device.upgradeError}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-sm ${stale ? 'text-red-400' : 'dark:text-gray-300 text-gray-700'}`}>
                      {timeAgo(device.lastHeartbeatAt)}
                    </span>
                    {stale && (
                      <div className="text-xs text-red-500">offline?</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs dark:text-gray-400 text-gray-500">
                    {device.nodeVersion && <div>Node {device.nodeVersion}</div>}
                    {device.memoryUsageMb != null && <div>{device.memoryUsageMb} MB RAM</div>}
                    {device.diskUsagePercent != null && <div>{device.diskUsagePercent.toFixed(1)}% disk</div>}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => handleUpgrade(device)}
                      disabled={!canUpgrade || upgradeDevice.isPending}
                      className="px-3 py-1.5 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      Upgrade
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Auto-refresh indicator */}
      <div className="text-xs dark:text-gray-500 text-gray-400 text-center">
        Auto-refreshes every 30 seconds
      </div>
    </div>
  );
}
