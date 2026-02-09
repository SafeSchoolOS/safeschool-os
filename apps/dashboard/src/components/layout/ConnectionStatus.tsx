import type { ConnectionState } from '../../ws/useWebSocket';

interface ConnectionStatusProps {
  state: ConnectionState;
}

const STATUS_CONFIG: Record<ConnectionState, { color: string; label: string }> = {
  connected: { color: 'bg-green-500', label: 'Live' },
  disconnected: { color: 'bg-red-500', label: 'Disconnected' },
  reconnecting: { color: 'bg-yellow-500', label: 'Reconnecting...' },
};

export function ConnectionStatus({ state }: ConnectionStatusProps) {
  const { color, label } = STATUS_CONFIG[state];

  return (
    <div className="flex items-center gap-1.5 text-sm" title={`WebSocket: ${label}`}>
      <span
        className={`w-2 h-2 rounded-full ${color} ${
          state === 'reconnecting' ? 'animate-pulse' : ''
        }`}
      />
      <span
        className={
          state === 'connected'
            ? 'text-green-400'
            : state === 'reconnecting'
              ? 'text-yellow-400'
              : 'text-red-400'
        }
      >
        {label}
      </span>
    </div>
  );
}
