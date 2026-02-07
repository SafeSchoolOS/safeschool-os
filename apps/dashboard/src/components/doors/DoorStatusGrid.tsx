import { useDoors, useLockDoor, useUnlockDoor } from '../../api/doors';

interface DoorStatusGridProps {
  siteId?: string;
}

const statusColors: Record<string, string> = {
  LOCKED: 'bg-green-700',
  UNLOCKED: 'bg-yellow-600',
  OPEN: 'bg-blue-600',
  FORCED: 'bg-red-600 animate-pulse',
  HELD: 'bg-orange-600',
  UNKNOWN: 'bg-gray-600',
};

const statusIcons: Record<string, string> = {
  LOCKED: '🔒',
  UNLOCKED: '🔓',
  OPEN: '🚪',
  FORCED: '⚠️',
  HELD: '⏳',
  UNKNOWN: '❓',
};

export function DoorStatusGrid({ siteId }: DoorStatusGridProps) {
  const { data: doors, isLoading } = useDoors(siteId);
  const lockDoor = useLockDoor();
  const unlockDoor = useUnlockDoor();

  if (isLoading) {
    return <div className="bg-gray-800 rounded-lg p-6 text-gray-400">Loading doors...</div>;
  }

  return (
    <div className="bg-gray-800 rounded-lg p-6">
      <h2 className="text-lg font-semibold mb-4">
        Door Status
        <span className="ml-2 text-sm font-normal text-gray-400">({(doors || []).length} doors)</span>
      </h2>

      <div className="space-y-2">
        {(doors || []).map((door: any) => (
          <div key={door.id} className="flex items-center justify-between bg-gray-700 rounded-lg px-3 py-2">
            <div className="flex items-center gap-2">
              <span className={`px-2 py-0.5 text-xs rounded-full text-white ${statusColors[door.status] || 'bg-gray-600'}`}>
                {statusIcons[door.status]} {door.status}
              </span>
              <span className="text-sm text-gray-300">{door.name}</span>
              {door.isExterior && <span className="text-xs text-gray-500">(ext)</span>}
              {door.isEmergencyExit && <span className="text-xs text-red-400">(exit)</span>}
            </div>

            <div className="flex gap-1">
              {door.status !== 'LOCKED' && (
                <button
                  onClick={() => lockDoor.mutate(door.id)}
                  className="px-2 py-1 text-xs bg-green-700 hover:bg-green-600 text-white rounded transition-colors"
                >
                  Lock
                </button>
              )}
              {door.status === 'LOCKED' && (
                <button
                  onClick={() => unlockDoor.mutate(door.id)}
                  className="px-2 py-1 text-xs bg-yellow-700 hover:bg-yellow-600 text-white rounded transition-colors"
                >
                  Unlock
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
