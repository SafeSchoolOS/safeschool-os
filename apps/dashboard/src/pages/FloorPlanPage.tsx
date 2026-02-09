import { useState } from 'react';
import { useAlerts } from '../api/alerts';
import { useDoors, useLockDoor, useUnlockDoor } from '../api/doors';
import { useSites } from '../api/sites';
import { useAuth } from '../hooks/useAuth';

const roomLayout: Record<string, { x: number; y: number; w: number; h: number; floor: number; building: string }> = {
  'Main Office':     { x: 40,  y: 40,  w: 180, h: 90,  floor: 1, building: 'main' },
  'Room 101':        { x: 240, y: 40,  w: 150, h: 90,  floor: 1, building: 'main' },
  'Room 102':        { x: 410, y: 40,  w: 150, h: 90,  floor: 1, building: 'main' },
  'Cafeteria':       { x: 580, y: 40,  w: 200, h: 90,  floor: 1, building: 'main' },
  'Main Hallway':    { x: 40,  y: 140, w: 740, h: 30,  floor: 1, building: 'main' },
  'Main Entrance':   { x: 40,  y: 180, w: 180, h: 60,  floor: 1, building: 'main' },
  'Gymnasium':       { x: 580, y: 180, w: 200, h: 60,  floor: 1, building: 'main' },
  'Room 103':        { x: 240, y: 40,  w: 150, h: 90,  floor: 2, building: 'main' },
  'Room 104':        { x: 410, y: 40,  w: 150, h: 90,  floor: 2, building: 'main' },
  'Room 201':        { x: 40,  y: 40,  w: 150, h: 90,  floor: 1, building: 'annex' },
  'Room 202':        { x: 210, y: 40,  w: 150, h: 90,  floor: 1, building: 'annex' },
  'Annex Entrance':  { x: 380, y: 40,  w: 120, h: 90,  floor: 1, building: 'annex' },
};

const doorPositions: Record<string, { x: number; y: number; floor: number; building: string }> = {
  'Main Entrance':       { x: 130, y: 210, floor: 1, building: 'main' },
  'Main Emergency Exit': { x: 400, y: 240, floor: 1, building: 'main' },
  'Office Door':         { x: 130, y: 130, floor: 1, building: 'main' },
  'Cafeteria Door':      { x: 580, y: 130, floor: 1, building: 'main' },
  'Gym External Door':   { x: 680, y: 240, floor: 1, building: 'main' },
  'Hallway Fire Door':   { x: 300, y: 155, floor: 1, building: 'main' },
  'Annex Entrance':      { x: 440, y: 130, floor: 1, building: 'annex' },
  'Annex Emergency Exit':{ x: 210, y: 130, floor: 1, building: 'annex' },
};

const statusColors: Record<string, { fill: string; label: string }> = {
  LOCKED:   { fill: '#166534', label: 'Locked' },
  UNLOCKED: { fill: '#854d0e', label: 'Unlocked' },
  OPEN:     { fill: '#1e40af', label: 'Open' },
  FORCED:   { fill: '#991b1b', label: 'Forced!' },
  HELD:     { fill: '#9a3412', label: 'Held' },
  UNKNOWN:  { fill: '#374151', label: '?' },
};

export function FloorPlanPage() {
  const { user, token } = useAuth();
  const { data: sites } = useSites();
  const siteId = user?.siteIds[0];
  const { data: alerts } = useAlerts(siteId);
  const { data: doors } = useDoors(siteId);
  const lockDoor = useLockDoor();
  const unlockDoor = useUnlockDoor();

  const [selectedBuilding, setSelectedBuilding] = useState('main');
  const [selectedFloor, setSelectedFloor] = useState(1);
  const [selectedDoor, setSelectedDoor] = useState<any>(null);

  const site = sites?.[0];
  const activeAlerts = (alerts || []).filter((a: any) => !['RESOLVED', 'CANCELLED'].includes(a.status));
  const alertRoomNames = new Set(activeAlerts.map((a: any) => a.roomName).filter(Boolean));

  // Filter rooms and doors for current view
  const visibleRooms = Object.entries(roomLayout).filter(
    ([_, layout]) => layout.building === selectedBuilding && layout.floor === selectedFloor
  );
  const visibleDoors = (doors || []).filter((d: any) => {
    const pos = doorPositions[d.name];
    return pos && pos.building === selectedBuilding && pos.floor === selectedFloor;
  });

  const handleDoorClick = (door: any) => {
    setSelectedDoor(door === selectedDoor ? null : door);
  };

  const handleDoorAction = (door: any, action: 'lock' | 'unlock') => {
    if (action === 'lock') lockDoor.mutate(door.id);
    else unlockDoor.mutate(door.id);
    setSelectedDoor(null);
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <header className="bg-gray-800 border-b border-gray-700 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <a href="/" className="text-blue-400 hover:text-blue-300">&larr; Dashboard</a>
          <h1 className="text-xl font-bold">Floor Plan</h1>
          {site && <span className="text-gray-400 text-sm">{site.name}</span>}
        </div>
        <div className="flex items-center gap-4">
          {/* Building selector */}
          <div className="flex gap-2">
            {['main', 'annex'].map(b => (
              <button key={b} onClick={() => setSelectedBuilding(b)}
                className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  selectedBuilding === b ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                }`}>
                {b === 'main' ? 'Main Building' : 'Annex'}
              </button>
            ))}
          </div>
          {/* Floor selector */}
          {selectedBuilding === 'main' && (
            <div className="flex gap-2">
              {[1, 2].map(f => (
                <button key={f} onClick={() => setSelectedFloor(f)}
                  className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    selectedFloor === f ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                  }`}>
                  Floor {f}
                </button>
              ))}
            </div>
          )}
        </div>
      </header>

      <div className="p-6">
        <div className="grid grid-cols-12 gap-6">
          {/* Floor Plan SVG */}
          <div className="col-span-9">
            <div className="bg-gray-800 rounded-xl p-4">
              <svg viewBox="0 0 820 280" className="w-full h-auto">
                {/* Grid background */}
                <defs>
                  <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
                    <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#1f2937" strokeWidth="0.5"/>
                  </pattern>
                </defs>
                <rect width="820" height="280" fill="#111827" rx="8"/>
                <rect width="820" height="280" fill="url(#grid)" rx="8"/>

                {/* Building outline */}
                <rect x="20" y="20" width={selectedBuilding === 'main' ? 780 : 500} height="240"
                  fill="none" stroke="#374151" strokeWidth="2" rx="4" strokeDasharray="8 4"/>

                {/* Rooms */}
                {visibleRooms.map(([name, layout]) => {
                  const hasAlert = alertRoomNames.has(name);
                  return (
                    <g key={name}>
                      <rect x={layout.x} y={layout.y} width={layout.w} height={layout.h}
                        fill={hasAlert ? '#7f1d1d' : '#1e293b'}
                        stroke={hasAlert ? '#ef4444' : '#334155'}
                        strokeWidth={hasAlert ? 2 : 1}
                        rx={6}
                        className={hasAlert ? 'animate-pulse' : ''}
                      />
                      <text x={layout.x + layout.w / 2} y={layout.y + layout.h / 2 - 6}
                        fill={hasAlert ? '#fca5a5' : '#94a3b8'}
                        fontSize="11" textAnchor="middle" fontWeight="600">
                        {name}
                      </text>
                      <text x={layout.x + layout.w / 2} y={layout.y + layout.h / 2 + 10}
                        fill={hasAlert ? '#f87171' : '#475569'}
                        fontSize="9" textAnchor="middle">
                        {hasAlert ? 'ALERT ACTIVE' : name.includes('Room') ? 'Classroom' : ''}
                      </text>
                    </g>
                  );
                })}

                {/* Doors */}
                {visibleDoors.map((door: any) => {
                  const pos = doorPositions[door.name];
                  if (!pos) return null;
                  const colors = statusColors[door.status] || statusColors.UNKNOWN;
                  const isSelected = selectedDoor?.id === door.id;

                  return (
                    <g key={door.id} onClick={() => handleDoorClick(door)} style={{ cursor: 'pointer' }}>
                      {/* Door icon */}
                      <rect x={pos.x - 12} y={pos.y - 8} width={24} height={16}
                        fill={colors.fill} stroke={isSelected ? '#fff' : '#000'} strokeWidth={isSelected ? 2 : 1} rx={3}
                      />
                      {/* Status indicator */}
                      <circle cx={pos.x + 14} cy={pos.y - 6} r={4}
                        fill={door.status === 'LOCKED' ? '#22c55e' :
                              door.status === 'FORCED' ? '#ef4444' :
                              door.status === 'HELD' ? '#f97316' : '#eab308'}
                      />
                      {/* Label */}
                      <text x={pos.x} y={pos.y + 22} fill="#9ca3af" fontSize="8" textAnchor="middle">
                        {door.name}
                      </text>
                    </g>
                  );
                })}

                {/* Legend */}
                <g transform="translate(20, 260)">
                  {Object.entries(statusColors).map(([status, colors], i) => (
                    <g key={status} transform={`translate(${i * 110}, 0)`}>
                      <rect x={0} y={-5} width={10} height={10} fill={colors.fill} rx={2}/>
                      <text x={14} y={4} fill="#9ca3af" fontSize="9">{colors.label}</text>
                    </g>
                  ))}
                </g>
              </svg>
            </div>
          </div>

          {/* Side Panel */}
          <div className="col-span-3 space-y-4">
            {/* Alert summary */}
            {activeAlerts.length > 0 && (
              <div className="bg-red-900/30 border border-red-800 rounded-xl p-4">
                <h3 className="text-red-400 font-bold mb-2">Active Alerts</h3>
                {activeAlerts.slice(0, 3).map((a: any) => (
                  <div key={a.id} className="text-sm text-red-300 mb-1">
                    {a.level} - {a.buildingName} {a.roomName ? `/ ${a.roomName}` : ''}
                  </div>
                ))}
              </div>
            )}

            {/* Selected Door Panel */}
            {selectedDoor ? (
              <div className="bg-gray-800 rounded-xl p-4">
                <h3 className="font-bold mb-3">{selectedDoor.name}</h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-400">Status</span>
                    <span className={`font-semibold ${
                      selectedDoor.status === 'LOCKED' ? 'text-green-400' :
                      selectedDoor.status === 'FORCED' ? 'text-red-400' : 'text-yellow-400'
                    }`}>{selectedDoor.status}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Type</span>
                    <span>{selectedDoor.isExterior ? 'Exterior' : 'Interior'}</span>
                  </div>
                  {selectedDoor.isEmergencyExit && (
                    <div className="text-orange-400 text-xs">Emergency Exit</div>
                  )}
                </div>
                <div className="flex gap-2 mt-4">
                  <button onClick={() => handleDoorAction(selectedDoor, 'lock')}
                    className="flex-1 px-3 py-2 bg-green-700 hover:bg-green-600 rounded-lg text-sm font-medium transition-colors">
                    Lock
                  </button>
                  <button onClick={() => handleDoorAction(selectedDoor, 'unlock')}
                    className="flex-1 px-3 py-2 bg-yellow-700 hover:bg-yellow-600 rounded-lg text-sm font-medium transition-colors">
                    Unlock
                  </button>
                </div>
              </div>
            ) : (
              <div className="bg-gray-800 rounded-xl p-4 text-center text-gray-500 text-sm">
                Click a door on the map to view details and controls
              </div>
            )}

            {/* Door Status List */}
            <div className="bg-gray-800 rounded-xl p-4">
              <h3 className="font-bold mb-3">All Doors</h3>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {(doors || []).map((door: any) => (
                  <button key={door.id}
                    onClick={() => handleDoorClick(door)}
                    className={`w-full flex items-center justify-between p-2 rounded-lg text-sm transition-colors ${
                      selectedDoor?.id === door.id ? 'bg-blue-900/30 border border-blue-700' : 'hover:bg-gray-700'
                    }`}>
                    <div className="flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full ${
                        door.status === 'LOCKED' ? 'bg-green-500' :
                        door.status === 'FORCED' ? 'bg-red-500' : 'bg-yellow-500'
                      }`}/>
                      <span className="text-gray-300">{door.name}</span>
                    </div>
                    <span className="text-gray-500 text-xs">{door.status}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
