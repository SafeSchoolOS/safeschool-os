const levelColors: Record<string, string> = {
  ACTIVE_THREAT: 'bg-red-900 border-red-500',
  LOCKDOWN: 'bg-orange-900 border-orange-500',
  FIRE: 'bg-orange-900 border-orange-500',
  MEDICAL: 'bg-yellow-900 border-yellow-500',
  WEATHER: 'bg-blue-900 border-blue-500',
  ALL_CLEAR: 'bg-green-900 border-green-500',
  CUSTOM: 'bg-gray-700 border-gray-500',
};

const statusBadge: Record<string, string> = {
  TRIGGERED: 'bg-red-600',
  ACKNOWLEDGED: 'bg-yellow-600',
  DISPATCHED: 'bg-blue-600',
  RESPONDING: 'bg-purple-600',
  RESOLVED: 'bg-green-700',
  CANCELLED: 'bg-gray-600',
};

interface AlertCardProps {
  alert: any;
  onAcknowledge?: () => void;
  onResolve?: () => void;
  onCancel?: () => void;
}

export function AlertCard({ alert, onAcknowledge, onResolve, onCancel }: AlertCardProps) {
  const isActive = !['RESOLVED', 'CANCELLED'].includes(alert.status);
  const colorClass = levelColors[alert.level] || levelColors.CUSTOM;
  const elapsed = getElapsed(alert.triggeredAt);

  return (
    <div className={`rounded-lg border p-4 ${colorClass} ${isActive && alert.level === 'ACTIVE_THREAT' ? 'animate-pulse' : ''}`}>
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-bold text-lg">{alert.level.replace('_', ' ')}</span>
            <span className={`px-2 py-0.5 text-xs rounded-full text-white ${statusBadge[alert.status] || 'bg-gray-600'}`}>
              {alert.status}
            </span>
          </div>
          <p className="text-sm text-gray-300 mt-1">
            {alert.buildingName}{alert.roomName ? ` / ${alert.roomName}` : ''}
            {alert.floor ? ` (Floor ${alert.floor})` : ''}
          </p>
          {alert.message && <p className="text-sm text-gray-400 mt-1">{alert.message}</p>}
          <p className="text-xs text-gray-500 mt-2">{elapsed} ago &middot; {alert.source}</p>
        </div>

        {isActive && (
          <div className="flex gap-2 ml-4 shrink-0">
            {alert.status === 'TRIGGERED' && onAcknowledge && (
              <button onClick={onAcknowledge} className="px-3 py-1.5 bg-yellow-600 hover:bg-yellow-700 text-white text-sm rounded-lg transition-colors">
                ACK
              </button>
            )}
            {onResolve && (
              <button onClick={onResolve} className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-sm rounded-lg transition-colors">
                Resolve
              </button>
            )}
            {onCancel && (
              <button onClick={onCancel} className="px-3 py-1.5 bg-gray-600 hover:bg-gray-700 text-white text-sm rounded-lg transition-colors">
                Cancel
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function getElapsed(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h`;
}
