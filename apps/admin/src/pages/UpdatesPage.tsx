import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Download, CheckCircle, AlertTriangle, Package, Clock, Tag, Wifi, WifiOff } from 'lucide-react';
import { adminApi, type Release } from '../api/client';

export function UpdatesPage() {
  const queryClient = useQueryClient();
  const [selectedTag, setSelectedTag] = useState<string>('');
  const [updateResult, setUpdateResult] = useState<string | null>(null);

  const { data: versionData, isLoading: versionLoading } = useQuery({
    queryKey: ['admin', 'version'],
    queryFn: () => adminApi.getVersion(),
  });

  const { data: releasesData, isLoading: releasesLoading, error: releasesError } = useQuery({
    queryKey: ['admin', 'releases'],
    queryFn: () => adminApi.getReleases(),
    staleTime: 60_000, // Cache for 1 minute
  });

  const updateMutation = useMutation({
    mutationFn: (tag?: string) => adminApi.updateToVersion(tag),
    onSuccess: (data) => {
      setUpdateResult(data.message);
      queryClient.invalidateQueries({ queryKey: ['admin', 'version'] });
    },
  });

  const releases = releasesData?.releases || [];
  const currentVersion = versionData?.version || 'unknown';
  const isOnline = releases.length > 0;

  // Auto-select first release that differs from current
  const handleReleaseSelect = (tag: string) => {
    setSelectedTag(tag);
    setUpdateResult(null);
  };

  const handleUpdate = () => {
    setUpdateResult(null);
    updateMutation.mutate(selectedTag || undefined);
  };

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">Software Updates</h2>

      {/* Current Version Card */}
      <div className="bg-gray-800 rounded-lg border border-gray-700 p-6">
        <div className="flex items-start gap-4">
          <Package size={24} className="text-blue-400 mt-0.5" />
          <div className="flex-1">
            <h3 className="text-lg font-semibold mb-3">Current Version</h3>
            {versionLoading ? (
              <div className="text-gray-400 text-sm">Loading version info...</div>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center gap-3">
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600/20 border border-blue-500/30 rounded-full text-blue-300 text-sm font-mono font-semibold">
                    <Tag size={14} />
                    {currentVersion}
                  </span>
                  {versionData?.tag && versionData.tag !== currentVersion && (
                    <span className="text-gray-400 text-sm">({versionData.tag})</span>
                  )}
                </div>

                <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-gray-500">
                  {versionData?.commit && (
                    <span>Commit: <code className="text-gray-400">{versionData.commit}</code></span>
                  )}
                  {versionData?.buildDate && (
                    <span>Built: {new Date(versionData.buildDate).toLocaleDateString()}</span>
                  )}
                  {versionData?.installedAt && (
                    <span>Installed: {new Date(versionData.installedAt).toLocaleDateString()}</span>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Available Releases Card */}
      <div className="bg-gray-800 rounded-lg border border-gray-700 p-6">
        <div className="flex items-start gap-4">
          <Download size={24} className="text-green-400 mt-0.5" />
          <div className="flex-1">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-semibold">Available Updates</h3>
              <span className={`flex items-center gap-1.5 text-xs ${isOnline ? 'text-green-400' : 'text-yellow-400'}`}>
                {isOnline ? <Wifi size={14} /> : <WifiOff size={14} />}
                {isOnline ? 'Connected to GitHub' : 'Offline'}
              </span>
            </div>

            {releasesLoading ? (
              <div className="text-gray-400 text-sm">Checking for updates...</div>
            ) : releasesError ? (
              <div className="text-yellow-400 text-sm">
                Could not check for updates: {(releasesError as Error).message}
              </div>
            ) : releases.length === 0 ? (
              <div className="text-gray-400 text-sm">
                {releasesData?.error
                  ? `Cannot reach GitHub: ${releasesData.error}`
                  : 'No releases available. The device may be offline or the repository is private.'}
              </div>
            ) : (
              <>
                {/* Release Selector */}
                <div className="mb-4">
                  <label htmlFor="release-select" className="block text-sm text-gray-400 mb-2">
                    Select a version to install:
                  </label>
                  <select
                    id="release-select"
                    value={selectedTag}
                    onChange={(e) => handleReleaseSelect(e.target.value)}
                    className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value="">-- Select a release --</option>
                    {releases.map((r: Release) => (
                      <option key={r.tag} value={r.tag}>
                        {r.tag}
                        {r.tag === currentVersion ? ' (current)' : ''}
                        {r.prerelease ? ' [pre-release]' : ''}
                        {' — '}
                        {new Date(r.published).toLocaleDateString()}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Selected Release Details */}
                {selectedTag && (() => {
                  const selected = releases.find((r: Release) => r.tag === selectedTag);
                  if (!selected) return null;
                  const isCurrent = selectedTag === currentVersion;
                  return (
                    <div className={`rounded-lg border p-4 mb-4 ${
                      isCurrent
                        ? 'border-gray-600 bg-gray-900/50'
                        : 'border-blue-600/40 bg-blue-900/20'
                    }`}>
                      <div className="flex items-center gap-2 mb-2">
                        <Tag size={14} className="text-gray-400" />
                        <span className="font-semibold text-sm">{selected.name || selected.tag}</span>
                        {selected.prerelease && (
                          <span className="text-xs px-1.5 py-0.5 bg-yellow-600/30 text-yellow-300 rounded">pre-release</span>
                        )}
                        {isCurrent && (
                          <span className="text-xs px-1.5 py-0.5 bg-green-600/30 text-green-300 rounded">current</span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-2">
                        <Clock size={12} />
                        Published {new Date(selected.published).toLocaleString()}
                        {selected.assets > 0 && <span> &middot; {selected.assets} assets</span>}
                      </div>
                      {selected.body && (
                        <p className="text-xs text-gray-400 whitespace-pre-wrap line-clamp-4">{selected.body}</p>
                      )}
                    </div>
                  );
                })()}

                {/* Update Button */}
                <button
                  onClick={handleUpdate}
                  disabled={updateMutation.isPending || !selectedTag || selectedTag === currentVersion}
                  className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:text-gray-500 disabled:cursor-not-allowed rounded-lg text-sm font-medium transition-colors"
                >
                  <Download size={16} />
                  {updateMutation.isPending
                    ? 'Updating...'
                    : selectedTag === currentVersion
                      ? 'Already on this version'
                      : selectedTag
                        ? `Update to ${selectedTag}`
                        : 'Select a release first'}
                </button>
              </>
            )}
          </div>
        </div>

        {/* Success Message */}
        {updateResult && (
          <div className="mt-4 bg-green-900/20 border border-green-700 rounded-lg p-3 flex items-start gap-2 text-sm text-green-300">
            <CheckCircle size={16} className="mt-0.5 flex-shrink-0" />
            <span>{updateResult}</span>
          </div>
        )}

        {/* Error Message */}
        {updateMutation.isError && (
          <div className="mt-4 bg-red-900/20 border border-red-500 rounded-lg p-3 flex items-start gap-2 text-sm text-red-300">
            <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
            <span>Update failed: {(updateMutation.error as Error).message}</span>
          </div>
        )}
      </div>

      {/* Manual Update Instructions */}
      <div className="bg-gray-800 rounded-lg border border-gray-700 p-6">
        <h3 className="text-lg font-semibold mb-2">Manual Update</h3>
        <p className="text-gray-400 text-sm mb-3">
          To manually update via SSH, run:
        </p>
        <div className="bg-gray-950 rounded-lg p-3 font-mono text-xs text-gray-300 space-y-0.5">
          <div>$ sudo safeschool update</div>
          <div className="text-gray-600"># or manually:</div>
          <div>$ cd /opt/safeschool/deploy/edge</div>
          <div>$ sudo docker compose pull</div>
          <div>$ sudo docker compose up -d</div>
        </div>
      </div>
    </div>
  );
}
