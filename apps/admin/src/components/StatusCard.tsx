interface StatusCardProps {
  title: string;
  value: string;
  subtitle?: string;
  status?: 'ok' | 'warning' | 'error' | 'info';
  icon?: React.ReactNode;
}

const statusColors = {
  ok: 'bg-green-500',
  warning: 'bg-yellow-500',
  error: 'bg-red-500',
  info: 'bg-blue-500',
};

export function StatusCard({ title, value, subtitle, status = 'info', icon }: StatusCardProps) {
  return (
    <div className="bg-gray-800 rounded-lg border border-gray-700 p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm text-gray-400">{title}</span>
        <div className="flex items-center gap-2">
          {status && <span className={`w-2 h-2 rounded-full ${statusColors[status]}`} />}
          {icon}
        </div>
      </div>
      <div className="text-xl font-bold">{value}</div>
      {subtitle && <div className="text-xs text-gray-500 mt-1">{subtitle}</div>}
    </div>
  );
}
