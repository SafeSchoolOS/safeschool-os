import { useAlerts } from '../../api/alerts';
import { useDoors } from '../../api/doors';

interface BuildingMapProps {
  site: any;
}

const roomLayout: Record<string, { x: number; y: number; w: number; h: number }> = {
  'Main Office': { x: 20, y: 20, w: 120, h: 60 },
  'Room 101': { x: 160, y: 20, w: 100, h: 60 },
  'Room 102': { x: 280, y: 20, w: 100, h: 60 },
  'Room 103': { x: 160, y: 100, w: 100, h: 60 },
  'Room 104': { x: 280, y: 100, w: 100, h: 60 },
  'Cafeteria': { x: 400, y: 20, w: 140, h: 60 },
  'Gymnasium': { x: 400, y: 100, w: 140, h: 60 },
  'Main Hallway': { x: 20, y: 90, w: 120, h: 20 },
  'Main Entrance': { x: 20, y: 120, w: 120, h: 40 },
  // Annex
  'Room 201': { x: 600, y: 20, w: 100, h: 60 },
  'Room 202': { x: 600, y: 100, w: 100, h: 60 },
  'Annex Entrance': { x: 720, y: 20, w: 80, h: 60 },
};

const statusFill: Record<string, string> = {
  LOCKED: '#166534',
  UNLOCKED: '#854d0e',
  OPEN: '#1e40af',
  FORCED: '#991b1b',
  HELD: '#9a3412',
  UNKNOWN: '#374151',
};

export function BuildingMap({ site }: BuildingMapProps) {
  const { data: alerts } = useAlerts(site.id);
  const { data: doors } = useDoors(site.id);

  const activeAlerts = (alerts || []).filter((a: any) => !['RESOLVED', 'CANCELLED'].includes(a.status));
  const alertRoomIds = new Set(activeAlerts.map((a: any) => a.roomId).filter(Boolean));
  const alertBuildingIds = new Set(activeAlerts.map((a: any) => a.buildingId));

  return (
    <div className="bg-gray-800 rounded-lg p-6">
      <h2 className="text-lg font-semibold mb-4">Building Map</h2>
      <svg viewBox="0 0 820 180" className="w-full h-auto bg-gray-900 rounded-lg">
        {/* Building labels */}
        <text x="200" y="175" fill="#9ca3af" fontSize="10" textAnchor="middle">Main Building</text>
        <text x="660" y="175" fill="#9ca3af" fontSize="10" textAnchor="middle">Annex</text>

        {/* Separator */}
        <line x1="565" y1="10" x2="565" y2="170" stroke="#4b5563" strokeWidth="1" strokeDasharray="4" />

        {/* Rooms */}
        {site.buildings?.flatMap((b: any) =>
          (b.rooms || []).map((room: any) => {
            const layout = roomLayout[room.name];
            if (!layout) return null;

            const hasAlert = alertRoomIds.has(room.id) || (!room.id && alertBuildingIds.has(b.id));
            const fillColor = hasAlert ? '#991b1b' : '#1f2937';
            const strokeColor = hasAlert ? '#ef4444' : '#4b5563';

            return (
              <g key={room.id}>
                <rect
                  x={layout.x}
                  y={layout.y}
                  width={layout.w}
                  height={layout.h}
                  fill={fillColor}
                  stroke={strokeColor}
                  strokeWidth={hasAlert ? 2 : 1}
                  rx={4}
                  className={hasAlert ? 'animate-pulse' : ''}
                />
                <text
                  x={layout.x + layout.w / 2}
                  y={layout.y + layout.h / 2}
                  fill={hasAlert ? '#fca5a5' : '#d1d5db'}
                  fontSize="9"
                  textAnchor="middle"
                  dominantBaseline="middle"
                >
                  {room.name}
                </text>
              </g>
            );
          })
        )}

        {/* Door indicators */}
        {(doors || []).map((door: any, i: number) => {
          const x = 10;
          const y = 10 + i * 4;
          return (
            <rect
              key={door.id}
              x={x}
              y={y}
              width={6}
              height={3}
              fill={statusFill[door.status] || '#374151'}
              rx={1}
            />
          );
        })}
      </svg>
    </div>
  );
}
