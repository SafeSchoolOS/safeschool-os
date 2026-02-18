import { RotateCw } from 'lucide-react';

interface ServiceRowProps {
  name: string;
  status: string;
  uptime: string;
  ports: string;
  onRestart: () => void;
  restarting?: boolean;
}

const statusColors: Record<string, string> = {
  running: 'bg-green-500',
  healthy: 'bg-green-500',
  starting: 'bg-yellow-500',
  unhealthy: 'bg-red-500',
  stopped: 'bg-gray-500',
  exited: 'bg-gray-500',
};

export function ServiceRow({ name, status, uptime, ports, onRestart, restarting }: ServiceRowProps) {
  const dotColor = statusColors[status.toLowerCase()] || 'bg-gray-500';

  return (
    <div className="flex items-center justify-between bg-gray-800 rounded-lg border border-gray-700 px-4 py-3">
      <div className="flex items-center gap-3">
        <span className={`w-2.5 h-2.5 rounded-full ${dotColor}`} />
        <div>
          <div className="font-medium">{name}</div>
          <div className="text-xs text-gray-500">{ports}</div>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <div className="text-right">
          <div className="text-sm capitalize">{status}</div>
          <div className="text-xs text-gray-500">{uptime}</div>
        </div>
        <button
          onClick={onRestart}
          disabled={restarting}
          className="p-2 rounded-lg bg-gray-700 hover:bg-gray-600 disabled:opacity-50 transition-colors"
          title={`Restart ${name}`}
        >
          <RotateCw size={16} className={restarting ? 'animate-spin' : ''} />
        </button>
      </div>
    </div>
  );
}
