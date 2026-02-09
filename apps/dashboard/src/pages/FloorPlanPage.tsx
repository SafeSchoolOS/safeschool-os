import { useState, useCallback, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAlerts } from '../api/alerts';
import { useDoors, useLockDoor, useUnlockDoor } from '../api/doors';
import { useSites } from '../api/sites';
import { useAuth } from '../hooks/useAuth';

type UploadStatus = 'idle' | 'uploading' | 'success' | 'error';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

const statusColors: Record<string, { fill: string; label: string }> = {
  LOCKED:   { fill: '#166534', label: 'Locked' },
  UNLOCKED: { fill: '#854d0e', label: 'Unlocked' },
  OPEN:     { fill: '#1e40af', label: 'Open' },
  FORCED:   { fill: '#991b1b', label: 'Forced!' },
  HELD:     { fill: '#9a3412', label: 'Held' },
  UNKNOWN:  { fill: '#374151', label: '?' },
};

// Default positions for rooms without map data (auto-layout)
function autoLayoutRooms(rooms: any[]) {
  const cols = Math.ceil(Math.sqrt(rooms.length));
  return rooms.map((room, i) => ({
    ...room,
    mapX: room.mapX ?? 40 + (i % cols) * 170,
    mapY: room.mapY ?? 40 + Math.floor(i / cols) * 100,
    mapW: room.mapW ?? 150,
    mapH: room.mapH ?? 80,
  }));
}

function autoLayoutDoors(doors: any[], index: number) {
  return {
    mapX: doors[index]?.mapX ?? 40 + index * 90,
    mapY: doors[index]?.mapY ?? 250,
  };
}

export function FloorPlanPage() {
  const { user, token } = useAuth();
  const queryClient = useQueryClient();
  const { data: sites } = useSites();
  const siteId = user?.siteIds[0];
  const { data: alerts } = useAlerts(siteId);
  const { data: doors } = useDoors(siteId);
  const lockDoor = useLockDoor();
  const unlockDoor = useUnlockDoor();

  const [selectedBuilding, setSelectedBuilding] = useState<string>('');
  const [selectedFloor, setSelectedFloor] = useState(1);
  const [selectedDoor, setSelectedDoor] = useState<any>(null);
  const [editMode, setEditMode] = useState(false);
  const [dragging, setDragging] = useState<{ type: 'room' | 'door'; id: string } | null>(null);
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>('idle');
  const svgRef = useRef<SVGSVGElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fetch full site data with rooms
  const { data: siteData } = useQuery({
    queryKey: ['site-detail', siteId],
    enabled: !!siteId,
    queryFn: async () => {
      const res = await fetch(`${API_URL}/api/v1/sites/${siteId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return res.json();
    },
  });

  // Save floor plan positions
  const saveMutation = useMutation({
    mutationFn: async (data: { rooms: any[]; doors: any[] }) => {
      const res = await fetch(`${API_URL}/api/v1/sites/${siteId}/floor-plan`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['site-detail', siteId] });
    },
  });

  // Upload floor plan background image
  const handleUploadBackground = useCallback(async (file: File) => {
    if (!siteId || !selectedBuilding) return;
    setUploadStatus('uploading');
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch(
        `${API_URL}/api/v1/sites/${siteId}/buildings/${selectedBuilding}/floor-plan-image`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: formData,
        }
      );
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Upload failed');
      }
      setUploadStatus('success');
      queryClient.invalidateQueries({ queryKey: ['site-detail', siteId] });
      // Reset status after a short delay
      setTimeout(() => setUploadStatus('idle'), 2000);
    } catch {
      setUploadStatus('error');
      setTimeout(() => setUploadStatus('idle'), 3000);
    }
  }, [siteId, selectedBuilding, token, queryClient]);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleUploadBackground(file);
    }
    // Reset input so the same file can be re-selected
    e.target.value = '';
  }, [handleUploadBackground]);

  const site = sites?.[0];
  const buildings = siteData?.buildings || [];
  const activeAlerts = (alerts || []).filter((a: any) => !['RESOLVED', 'CANCELLED'].includes(a.status));
  const alertRoomNames = new Set(activeAlerts.map((a: any) => a.roomName).filter(Boolean));

  // Auto-select first building
  if (!selectedBuilding && buildings.length > 0) {
    setSelectedBuilding(buildings[0].id);
  }

  const currentBuilding = buildings.find((b: any) => b.id === selectedBuilding);
  const floorPlanImageUrl = currentBuilding?.floorPlanUrl
    ? `${API_URL}/api/v1/sites/${siteId}/buildings/${currentBuilding.id}/floor-plan-image`
    : null;
  const allRooms = autoLayoutRooms(currentBuilding?.rooms || []);
  const visibleRooms = allRooms.filter((r: any) => r.floor === selectedFloor);

  const buildingDoors = (doors || []).filter((d: any) => d.buildingId === selectedBuilding);
  const visibleDoors = buildingDoors.filter((d: any) => d.floor === selectedFloor).map((d: any, i: number) => ({
    ...d,
    ...autoLayoutDoors(buildingDoors, i),
    ...(d.mapX != null ? { mapX: d.mapX, mapY: d.mapY } : {}),
  }));

  const maxFloors = currentBuilding?.floors || 1;

  // SVG coordinate conversion for drag
  const getSvgPoint = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const svgP = pt.matrixTransform(svg.getScreenCTM()?.inverse());
    return { x: Math.round(svgP.x), y: Math.round(svgP.y) };
  }, []);

  const handleMouseDown = (type: 'room' | 'door', id: string) => {
    if (!editMode) return;
    setDragging({ type, id });
  };

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragging || !editMode) return;
    const { x, y } = getSvgPoint(e.clientX, e.clientY);

    if (dragging.type === 'room') {
      const room = visibleRooms.find((r: any) => r.id === dragging.id);
      if (room) {
        room.mapX = x - (room.mapW || 150) / 2;
        room.mapY = y - (room.mapH || 80) / 2;
      }
    } else {
      const door = visibleDoors.find((d: any) => d.id === dragging.id);
      if (door) {
        door.mapX = x;
        door.mapY = y;
      }
    }
    // Force re-render
    setDragging({ ...dragging });
  }, [dragging, editMode, visibleRooms, visibleDoors, getSvgPoint]);

  const handleMouseUp = () => {
    setDragging(null);
  };

  const handleSaveLayout = () => {
    const roomUpdates = allRooms.map((r: any) => ({
      id: r.id, mapX: r.mapX, mapY: r.mapY, mapW: r.mapW, mapH: r.mapH,
    }));
    const doorUpdates = visibleDoors.map((d: any) => ({
      id: d.id, mapX: d.mapX, mapY: d.mapY,
    }));
    saveMutation.mutate({ rooms: roomUpdates, doors: doorUpdates });
    setEditMode(false);
  };

  const handleDoorClick = (door: any) => {
    if (editMode) return;
    setSelectedDoor(door === selectedDoor ? null : door);
  };

  const handleDoorAction = (door: any, action: 'lock' | 'unlock') => {
    if (action === 'lock') lockDoor.mutate(door.id);
    else unlockDoor.mutate(door.id);
    setSelectedDoor(null);
  };

  const isAdmin = user?.role === 'SITE_ADMIN' || user?.role === 'SUPER_ADMIN';

  return (
    <div className="p-6">
      {/* Building/Floor selectors */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-4">
          <div className="flex gap-2">
            {buildings.map((b: any) => (
              <button key={b.id} onClick={() => { setSelectedBuilding(b.id); setSelectedFloor(1); }}
                className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  selectedBuilding === b.id ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                }`}>
                {b.name}
              </button>
            ))}
          </div>
          {maxFloors > 1 && (
            <div className="flex gap-2">
              {Array.from({ length: maxFloors }, (_, i) => i + 1).map(f => (
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
        {isAdmin && (
          <div className="flex gap-2">
            {editMode ? (
              <>
                <button onClick={() => fileInputRef.current?.click()}
                  disabled={uploadStatus === 'uploading'}
                  className="px-4 py-1.5 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 rounded-lg text-sm font-medium transition-colors flex items-center gap-2">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  {uploadStatus === 'uploading' ? 'Uploading...' :
                   uploadStatus === 'success' ? 'Uploaded!' :
                   uploadStatus === 'error' ? 'Upload Failed' : 'Upload Background'}
                </button>
                <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/svg+xml"
                  className="hidden" onChange={handleFileChange} />
                <button onClick={handleSaveLayout}
                  className="px-4 py-1.5 bg-green-600 hover:bg-green-500 rounded-lg text-sm font-medium transition-colors">
                  {saveMutation.isPending ? 'Saving...' : 'Save Layout'}
                </button>
                <button onClick={() => setEditMode(false)}
                  className="px-4 py-1.5 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm font-medium transition-colors">
                  Cancel
                </button>
              </>
            ) : (
              <button onClick={() => setEditMode(true)}
                className="px-4 py-1.5 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm font-medium transition-colors flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
                Edit Layout
              </button>
            )}
          </div>
        )}
      </div>

      {editMode && (
        <div className="bg-blue-900/30 border border-blue-700 rounded-lg p-3 mb-4 text-sm text-blue-300">
          Drag rooms and doors to reposition them. Click Save Layout when done.
        </div>
      )}

      <div className="grid grid-cols-12 gap-6">
        {/* Floor Plan SVG */}
        <div className="col-span-9">
          <div className="bg-gray-800 rounded-xl p-4">
            <svg ref={svgRef} viewBox="0 0 820 280" className="w-full h-auto"
              onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp}>
              <defs>
                <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
                  <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#1f2937" strokeWidth="0.5"/>
                </pattern>
              </defs>
              <rect width="820" height="280" fill="#111827" rx="8"/>
              <rect width="820" height="280" fill="url(#grid)" rx="8"/>

              {/* Floor plan background image */}
              {floorPlanImageUrl && (
                <image
                  href={`${floorPlanImageUrl}?t=${currentBuilding?.updatedAt || ''}`}
                  x="20" y="20" width="780" height="240"
                  preserveAspectRatio="xMidYMid meet"
                  opacity="0.6"
                  style={{ pointerEvents: 'none' }}
                />
              )}

              {/* Building outline */}
              <rect x="20" y="20" width="780" height="240"
                fill="none" stroke="#374151" strokeWidth="2" rx="4" strokeDasharray="8 4"/>

              {/* Rooms */}
              {visibleRooms.map((room: any) => {
                const hasAlert = alertRoomNames.has(room.name);
                const isDraggingThis = dragging?.type === 'room' && dragging.id === room.id;
                return (
                  <g key={room.id}
                    onMouseDown={() => handleMouseDown('room', room.id)}
                    style={{ cursor: editMode ? 'move' : 'default' }}>
                    <rect x={room.mapX} y={room.mapY} width={room.mapW} height={room.mapH}
                      fill={hasAlert ? '#7f1d1d' : '#1e293b'}
                      stroke={isDraggingThis ? '#3b82f6' : hasAlert ? '#ef4444' : '#334155'}
                      strokeWidth={isDraggingThis ? 2 : hasAlert ? 2 : 1}
                      rx={6}
                      className={hasAlert ? 'animate-pulse' : ''}
                    />
                    <text x={room.mapX + room.mapW / 2} y={room.mapY + room.mapH / 2 - 6}
                      fill={hasAlert ? '#fca5a5' : '#94a3b8'}
                      fontSize="11" textAnchor="middle" fontWeight="600" pointerEvents="none">
                      {room.name}
                    </text>
                    <text x={room.mapX + room.mapW / 2} y={room.mapY + room.mapH / 2 + 10}
                      fill={hasAlert ? '#f87171' : '#475569'}
                      fontSize="9" textAnchor="middle" pointerEvents="none">
                      {hasAlert ? 'ALERT ACTIVE' : room.type !== 'HALLWAY' ? room.type?.toLowerCase() : ''}
                    </text>
                  </g>
                );
              })}

              {/* Doors */}
              {visibleDoors.map((door: any) => {
                const colors = statusColors[door.status] || statusColors.UNKNOWN;
                const isSelected = selectedDoor?.id === door.id;
                const isDraggingThis = dragging?.type === 'door' && dragging.id === door.id;

                return (
                  <g key={door.id}
                    onClick={() => handleDoorClick(door)}
                    onMouseDown={() => handleMouseDown('door', door.id)}
                    style={{ cursor: editMode ? 'move' : 'pointer' }}>
                    <rect x={door.mapX - 12} y={door.mapY - 8} width={24} height={16}
                      fill={colors.fill}
                      stroke={isDraggingThis ? '#3b82f6' : isSelected ? '#fff' : '#000'}
                      strokeWidth={isDraggingThis || isSelected ? 2 : 1} rx={3}
                    />
                    <circle cx={door.mapX + 14} cy={door.mapY - 6} r={4}
                      fill={door.status === 'LOCKED' ? '#22c55e' :
                            door.status === 'FORCED' ? '#ef4444' :
                            door.status === 'HELD' ? '#f97316' : '#eab308'}
                    />
                    <text x={door.mapX} y={door.mapY + 22} fill="#9ca3af" fontSize="8" textAnchor="middle" pointerEvents="none">
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

          {selectedDoor && !editMode ? (
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
          ) : !editMode && (
            <div className="bg-gray-800 rounded-xl p-4 text-center text-gray-500 text-sm">
              Click a door on the map to view details and controls
            </div>
          )}

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
  );
}
