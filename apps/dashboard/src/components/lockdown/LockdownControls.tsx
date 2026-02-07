import { useActiveLockdowns, useInitiateLockdown, useReleaseLockdown } from '../../api/lockdown';

interface LockdownControlsProps {
  siteId?: string;
  buildings: any[];
}

export function LockdownControls({ siteId, buildings }: LockdownControlsProps) {
  const { data: lockdowns } = useActiveLockdowns();
  const initiate = useInitiateLockdown();
  const release = useReleaseLockdown();

  const activeLockdowns = lockdowns || [];

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

      {/* Active lockdowns */}
      {activeLockdowns.length > 0 && (
        <div className="space-y-2 mb-4">
          {activeLockdowns.map((ld: any) => (
            <div key={ld.id} className="flex items-center justify-between bg-red-900/50 border border-red-600 rounded-lg px-3 py-2">
              <div>
                <span className="text-sm font-medium text-red-200">{ld.scope} lockdown</span>
                <p className="text-xs text-red-400">{ld.doorsLocked} doors locked</p>
              </div>
              <button
                onClick={() => release.mutate(ld.id)}
                disabled={release.isPending}
                className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-sm rounded-lg transition-colors"
              >
                Release
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Lockdown initiation buttons */}
      <div className="space-y-2">
        {siteId && (
          <button
            onClick={() => initiate.mutate({ scope: 'FULL_SITE', targetId: siteId })}
            disabled={initiate.isPending}
            className="w-full py-2 bg-red-700 hover:bg-red-600 text-white font-semibold rounded-lg transition-colors"
          >
            Full Site Lockdown
          </button>
        )}
        {buildings.map((b: any) => (
          <button
            key={b.id}
            onClick={() => initiate.mutate({ scope: 'BUILDING', targetId: b.id })}
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
