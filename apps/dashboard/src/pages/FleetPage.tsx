import { useState } from 'react';
import {
  useFleetDevices,
  useFleetSummary,
  useFleetReleases,
  useUpgradeDevice,
  useUpgradeSelected,
  type EdgeDevice,
  type FleetRelease,
} from '../api/fleet';

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
  const { data: releasesData, isLoading: releasesLoading } = useFleetReleases();
  const upgradeDevice = useUpgradeDevice();
  const upgradeSelected = useUpgradeSelected();
  const [selectedTag, setSelectedTag] = useState('');
  const [selectedDeviceIds, setSelectedDeviceIds] = useState<Set<string>>(new Set());
  const [upgradeResult, setUpgradeResult] = useState<string | null>(null);

  const releases = releasesData?.releases || [];
  const allDeviceIds = devices?.map((d) => d.id) || [];
  const allSelected = allDeviceIds.length > 0 && allDeviceIds.every((id) => selectedDeviceIds.has(id));
  const someSelected = selectedDeviceIds.size > 0;

  const toggleDevice = (id: string) => {
    setSelectedDeviceIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (allSelected) {
      setSelectedDeviceIds(new Set());
    } else {
      setSelectedDeviceIds(new Set(allDeviceIds));
    }
  };

  const handleUpgradeSelected = () => {
    if (!selectedTag) return;
    const ids = Array.from(selectedDeviceIds);
    if (ids.length === 0) return;
    setUpgradeResult(null);
    upgradeSelected.mutate(
      { deviceIds: ids, targetVersion: selectedTag },
      {
        onSuccess: (data: any) => {
          setUpgradeResult(`Upgrade queued for ${data.updated} device(s) → ${selectedTag}`);
          setSelectedDeviceIds(new Set());
        },
      }
    );
  };

  const handleUpgradeSingle = (device: EdgeDevice) => {
    if (!selectedTag) return;
    upgradeDevice.mutate({ id: device.id, targetVersion: selectedTag });
  };

  // Find selected release details
  const selectedRelease = releases.find((r: FleetRelease) => r.tag === selectedTag);

  return (
    <div className="p-3 sm:p-6 space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold dark:text-white text-gray-900">Fleet Management</h2>
          <p className="text-sm dark:text-gray-400 text-gray-500 mt-1">
            Monitor and upgrade edge devices across all sites
          </p>
        </div>
      </div>

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
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

      {/* Upgrade Controls */}
      <div className="dark:bg-gray-800 bg-white rounded-xl dark:border-gray-700 border-gray-200 border p-4">
        <div className="flex flex-col sm:flex-row sm:items-end gap-3">
          {/* Release Dropdown */}
          <div className="flex-1">
            <label htmlFor="release-select" className="block text-sm font-medium dark:text-gray-300 text-gray-700 mb-1">
              Target Version
            </label>
            <select
              id="release-select"
              value={selectedTag}
              onChange={(e) => { setSelectedTag(e.target.value); setUpgradeResult(null); }}
              className="w-full px-3 py-2.5 text-sm rounded-lg dark:bg-gray-700 bg-gray-100 dark:text-white text-gray-900 dark:border-gray-600 border-gray-300 border focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">
                {releasesLoading ? 'Loading releases...' : '-- Select a release --'}
              </option>
              {releases.map((r: FleetRelease) => (
                <option key={r.tag} value={r.tag}>
                  {r.tag}
                  {r.prerelease ? ' [pre-release]' : ''}
                  {' — '}
                  {new Date(r.published).toLocaleDateString()}
                </option>
              ))}
            </select>
            {releasesData?.error && (
              <p className="text-xs text-yellow-500 mt-1">{releasesData.error}</p>
            )}
          </div>

          {/* Upgrade Button */}
          <button
            onClick={handleUpgradeSelected}
            disabled={!selectedTag || !someSelected || upgradeSelected.isPending}
            className="px-5 py-2.5 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
          >
            {upgradeSelected.isPending
              ? 'Upgrading...'
              : someSelected
                ? `Upgrade ${selectedDeviceIds.size} Device${selectedDeviceIds.size > 1 ? 's' : ''}`
                : 'Select devices to upgrade'}
          </button>
        </div>

        {/* Selected Release Details */}
        {selectedRelease && (
          <div className="mt-3 rounded-lg dark:bg-gray-700/50 bg-gray-100 p-3 text-sm">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-semibold dark:text-white text-gray-900">{selectedRelease.name}</span>
              {selectedRelease.prerelease && (
                <span className="text-xs px-1.5 py-0.5 bg-yellow-600/30 text-yellow-300 rounded">pre-release</span>
              )}
            </div>
            <div className="text-xs dark:text-gray-400 text-gray-500">
              Published {new Date(selectedRelease.published).toLocaleString()}
              {selectedRelease.assets > 0 && <span> &middot; {selectedRelease.assets} assets</span>}
            </div>
            {selectedRelease.body && (
              <p className="text-xs dark:text-gray-400 text-gray-500 mt-1 line-clamp-2">{selectedRelease.body}</p>
            )}
          </div>
        )}

        {/* Result Messages */}
        {upgradeResult && (
          <div className="mt-3 rounded-lg bg-green-900/20 border border-green-700 p-3 text-sm text-green-300">
            {upgradeResult}
          </div>
        )}
        {upgradeSelected.isError && (
          <div className="mt-3 rounded-lg bg-red-900/20 border border-red-500 p-3 text-sm text-red-300">
            Upgrade failed: {(upgradeSelected.error as Error).message}
          </div>
        )}
      </div>

      {/* Device Table */}
      <div className="dark:bg-gray-800 bg-white rounded-xl dark:border-gray-700 border-gray-200 border overflow-x-auto">
        <table className="w-full min-w-[700px]">
          <thead>
            <tr className="dark:bg-gray-700/50 bg-gray-50 text-left text-sm dark:text-gray-400 text-gray-500">
              <th className="px-4 py-3 font-medium w-10">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  className="w-4 h-4 rounded border-gray-500 text-blue-600 focus:ring-blue-500 focus:ring-offset-0 cursor-pointer"
                />
              </th>
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
                <td colSpan={9} className="px-4 py-8 text-center dark:text-gray-400 text-gray-500">
                  Loading devices...
                </td>
              </tr>
            )}
            {devices && devices.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center dark:text-gray-400 text-gray-500">
                  No edge devices have connected yet. Devices appear here after their first heartbeat.
                </td>
              </tr>
            )}
            {devices?.map((device) => {
              const stale = isStale(device.lastHeartbeatAt);
              const hasTarget = device.targetVersion && device.currentVersion !== device.targetVersion;
              const canUpgrade = device.upgradeStatus === 'IDLE' || device.upgradeStatus === 'FAILED';
              const checked = selectedDeviceIds.has(device.id);
              return (
                <tr
                  key={device.id}
                  className={`dark:hover:bg-gray-700/30 hover:bg-gray-50 transition-colors ${
                    checked ? 'dark:bg-blue-900/10 bg-blue-50' : ''
                  }`}
                >
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleDevice(device.id)}
                      className="w-4 h-4 rounded border-gray-500 text-blue-600 focus:ring-blue-500 focus:ring-offset-0 cursor-pointer"
                    />
                  </td>
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
                      onClick={() => handleUpgradeSingle(device)}
                      disabled={!canUpgrade || !selectedTag || upgradeDevice.isPending}
                      title={!selectedTag ? 'Select a release first' : ''}
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
