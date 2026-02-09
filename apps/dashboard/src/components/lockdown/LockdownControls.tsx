import { useActiveLockdowns, useInitiateLockdown, useReleaseLockdown } from '../../api/lockdown';

interface LockdownControlsProps {
  siteId?: string;
  buildings: any[];
  trainingMode?: boolean;
}

export function LockdownControls({ siteId, buildings, trainingMode }: LockdownControlsProps) {
  const { data } = useActiveLockdowns();
  const initiate = useInitiateLockdown();
  const release = useReleaseLockdown();

  const activeLockdowns = data?.lockdowns || [];
  const operatingMode = data?.operatingMode || 'cloud';
  const isEdge = operatingMode === 'edge';

  return (
    <div className="bg-gray-800 rounded-lg p-6">
      <h2 className="text-lg font-semibold mb-4">
        Lockdown Controls
        {activeLockdowns.length > 0 && (
          <span className="ml-2 px-2 py-0.5 bg-red-600 text-white text-xs rounded-full animate-pulse">
            {activeLockdowns.length} ACTIVE
          </span>
        )}
      </h2>

      {/* Cloud mode info banner */}
      {!isEdge && activeLockdowns.length > 0 && (
        <div className="mb-4 px-3 py-2 bg-yellow-900/50 border border-yellow-600 rounded-lg">
          <p className="text-sm text-yellow-200">
            Lockdown release requires physical presence at the on-site edge device.
          </p>
        </div>
      )}

      {/* Active lockdowns */}
      {activeLockdowns.length > 0 && (
        <div className="space-y-2 mb-4">
          {activeLockdowns.map((ld: any) => (
            <div key={ld.id} className="flex items-center justify-between bg-red-900/50 border border-red-600 rounded-lg px-3 py-2">
              <div>
                <span className="text-sm font-medium text-red-200">{ld.scope} lockdown</span>
                <p className="text-xs text-red-400">{ld.doorsLocked} doors locked</p>
              </div>
              {isEdge ? (
                <button
                  onClick={() => release.mutate(ld.id)}
                  disabled={release.isPending}
                  className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-sm rounded-lg transition-colors"
                >
                  Release
                </button>
              ) : (
                <span className="px-3 py-1.5 bg-red-800 text-red-200 text-xs font-medium rounded-lg">
                  LOCKED — Release from on-site device only
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Lockdown initiation buttons */}
      <div className="space-y-2">
        {siteId && (
          <button
            onClick={() => initiate.mutate({ scope: 'FULL_SITE', targetId: siteId, trainingMode })}
            disabled={initiate.isPending}
            className="w-full py-2 bg-red-700 hover:bg-red-600 text-white font-semibold rounded-lg transition-colors"
          >
            Full Site Lockdown
          </button>
        )}
        {buildings.map((b: any) => (
          <button
            key={b.id}
            onClick={() => initiate.mutate({ scope: 'BUILDING', targetId: b.id, trainingMode })}
            disabled={initiate.isPending}
            className="w-full py-2 bg-orange-700 hover:bg-orange-600 text-white text-sm rounded-lg transition-colors"
          >
            Lock {b.name}
          </button>
        ))}
      </div>
    </div>
  );
}
