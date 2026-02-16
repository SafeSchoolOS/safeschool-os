import { useState, useCallback, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAlerts } from '../api/alerts';
import { useDoors, useLockDoor, useUnlockDoor, useCreateDoor, useUpdateDoor, useDeleteDoor } from '../api/doors';
import { useCreateRoom, useUpdateRoom, useDeleteRoom } from '../api/rooms';
import { useSites } from '../api/sites';
import { useAuth } from '../hooks/useAuth';

type UploadStatus = 'idle' | 'uploading' | 'success' | 'error';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

const CANVAS_W = 2000;
const CANVAS_H = 1500;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;
const MIN_ROOM_W = 60;
const MIN_ROOM_H = 40;

const ROOM_TYPES = ['CLASSROOM', 'OFFICE', 'GYM', 'CAFETERIA', 'HALLWAY', 'ENTRANCE', 'OTHER'] as const;

const statusColors: Record<string, { fill: string; label: string }> = {
  LOCKED:   { fill: '#166534', label: 'Locked' },
  UNLOCKED: { fill: '#854d0e', label: 'Unlocked' },
  OPEN:     { fill: '#1e40af', label: 'Open' },
  FORCED:   { fill: '#991b1b', label: 'Forced!' },
  HELD:     { fill: '#9a3412', label: 'Held' },
  UNKNOWN:  { fill: '#374151', label: '?' },
};

function autoLayoutRooms(rooms: any[]) {
  const cols = Math.ceil(Math.sqrt(rooms.length));
  return rooms.map((room, i) => ({
    ...room,
    mapX: room.mapX ?? 100 + (i % cols) * 200,
    mapY: room.mapY ?? 100 + Math.floor(i / cols) * 120,
    mapW: room.mapW ?? 150,
    mapH: room.mapH ?? 80,
  }));
}

function autoLayoutDoors(doors: any[], index: number) {
  return {
    mapX: doors[index]?.mapX ?? 100 + index * 90,
    mapY: doors[index]?.mapY ?? 400,
  };
}

// ---------------------------------------------------------------------------
// Context Menu
// ---------------------------------------------------------------------------
type ContextMenuState = {
  x: number; y: number;
  svgX: number; svgY: number;
  target: { type: 'room' | 'door'; data: any } | null;
} | null;

function ContextMenu({ state, onClose, onAction }: {
  state: ContextMenuState;
  onClose: () => void;
  onAction: (action: string, target?: any) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  if (!state) return null;

  const items: { label: string; action: string; danger?: boolean }[] = [];
  if (state.target?.type === 'room') {
    items.push({ label: 'Edit Room', action: 'edit-room' });
    items.push({ label: 'Delete Room', action: 'delete-room', danger: true });
  } else if (state.target?.type === 'door') {
    items.push({ label: 'Edit Door', action: 'edit-door' });
    items.push({ label: 'Delete Door', action: 'delete-door', danger: true });
  } else {
    items.push({ label: 'Add Room Here', action: 'add-room-here' });
    items.push({ label: 'Add Door Here', action: 'add-door-here' });
  }

  return (
    <div ref={ref}
      className="fixed bg-gray-800 border border-gray-600 rounded-lg shadow-xl py-1 z-50 min-w-[160px]"
      style={{ left: state.x, top: state.y }}>
      {items.map(item => (
        <button key={item.action}
          onClick={() => { onAction(item.action, state.target?.data); onClose(); }}
          className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-700 ${item.danger ? 'text-red-400' : 'text-gray-200'}`}>
          {item.label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add Room Form
// ---------------------------------------------------------------------------
function AddRoomForm({ onSubmit, onCancel, defaultPos }: {
  onSubmit: (data: any) => void;
  onCancel: () => void;
  defaultPos?: { x?: number; y?: number };
}) {
  const [name, setName] = useState('');
  const [number, setNumber] = useState('');
  const [type, setType] = useState<string>('CLASSROOM');
  const [floor, setFloor] = useState(1);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onCancel}>
      <div className="bg-gray-800 rounded-xl p-6 w-96 shadow-2xl" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-bold mb-4">Add Room</h3>
        <div className="space-y-3">
          <div>
            <label className="block text-sm text-gray-400 mb-1">Name</label>
            <input value={name} onChange={e => setName(e.target.value)}
              className="w-full bg-gray-700 rounded-lg px-3 py-2 text-sm" placeholder="Room 101" autoFocus />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Number</label>
            <input value={number} onChange={e => setNumber(e.target.value)}
              className="w-full bg-gray-700 rounded-lg px-3 py-2 text-sm" placeholder="101" />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Type</label>
            <select value={type} onChange={e => setType(e.target.value)}
              className="w-full bg-gray-700 rounded-lg px-3 py-2 text-sm">
              {ROOM_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Floor</label>
            <input type="number" value={floor} onChange={e => setFloor(Number(e.target.value))} min={1}
              className="w-full bg-gray-700 rounded-lg px-3 py-2 text-sm" />
          </div>
        </div>
        <div className="flex gap-2 mt-5">
          <button onClick={onCancel}
            className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm font-medium">Cancel</button>
          <button onClick={() => {
            if (!name.trim() || !number.trim()) return;
            onSubmit({ name: name.trim(), number: number.trim(), type, floor, mapX: defaultPos?.x, mapY: defaultPos?.y, mapW: 150, mapH: 80 });
          }}
            disabled={!name.trim() || !number.trim()}
            className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 rounded-lg text-sm font-medium">Create</button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add Door Form
// ---------------------------------------------------------------------------
function AddDoorForm({ onSubmit, onCancel, defaultPos }: {
  onSubmit: (data: any) => void;
  onCancel: () => void;
  defaultPos?: { x?: number; y?: number };
}) {
  const [name, setName] = useState('');
  const [floor, setFloor] = useState(1);
  const [isExterior, setIsExterior] = useState(false);
  const [isEmergencyExit, setIsEmergencyExit] = useState(false);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onCancel}>
      <div className="bg-gray-800 rounded-xl p-6 w-96 shadow-2xl" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-bold mb-4">Add Door</h3>
        <div className="space-y-3">
          <div>
            <label className="block text-sm text-gray-400 mb-1">Name</label>
            <input value={name} onChange={e => setName(e.target.value)}
              className="w-full bg-gray-700 rounded-lg px-3 py-2 text-sm" placeholder="Main Entrance" autoFocus />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Floor</label>
            <input type="number" value={floor} onChange={e => setFloor(Number(e.target.value))} min={1}
              className="w-full bg-gray-700 rounded-lg px-3 py-2 text-sm" />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={isExterior} onChange={e => setIsExterior(e.target.checked)}
              className="rounded" />
            Exterior door
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={isEmergencyExit} onChange={e => setIsEmergencyExit(e.target.checked)}
              className="rounded" />
            Emergency exit
          </label>
        </div>
        <div className="flex gap-2 mt-5">
          <button onClick={onCancel}
            className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm font-medium">Cancel</button>
          <button onClick={() => {
            if (!name.trim()) return;
            onSubmit({ name: name.trim(), floor, isExterior, isEmergencyExit, mapX: defaultPos?.x, mapY: defaultPos?.y });
          }}
            disabled={!name.trim()}
            className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 rounded-lg text-sm font-medium">Create</button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Edit Room Form
// ---------------------------------------------------------------------------
function EditRoomForm({ room, onSubmit, onCancel }: {
  room: any;
  onSubmit: (data: any) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(room.name);
  const [number, setNumber] = useState(room.number);
  const [type, setType] = useState(room.type || 'CLASSROOM');

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onCancel}>
      <div className="bg-gray-800 rounded-xl p-6 w-96 shadow-2xl" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-bold mb-4">Edit Room</h3>
        <div className="space-y-3">
          <div>
            <label className="block text-sm text-gray-400 mb-1">Name</label>
            <input value={name} onChange={e => setName(e.target.value)}
              className="w-full bg-gray-700 rounded-lg px-3 py-2 text-sm" autoFocus />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Number</label>
            <input value={number} onChange={e => setNumber(e.target.value)}
              className="w-full bg-gray-700 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Type</label>
            <select value={type} onChange={e => setType(e.target.value)}
              className="w-full bg-gray-700 rounded-lg px-3 py-2 text-sm">
              {ROOM_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        </div>
        <div className="flex gap-2 mt-5">
          <button onClick={onCancel}
            className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm font-medium">Cancel</button>
          <button onClick={() => onSubmit({ name, number, type })}
            className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-medium">Save</button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Edit Door Form
// ---------------------------------------------------------------------------
function EditDoorForm({ door, onSubmit, onCancel }: {
  door: any;
  onSubmit: (data: any) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(door.name);
  const [isExterior, setIsExterior] = useState(door.isExterior ?? false);
  const [isEmergencyExit, setIsEmergencyExit] = useState(door.isEmergencyExit ?? false);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onCancel}>
      <div className="bg-gray-800 rounded-xl p-6 w-96 shadow-2xl" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-bold mb-4">Edit Door</h3>
        <div className="space-y-3">
          <div>
            <label className="block text-sm text-gray-400 mb-1">Name</label>
            <input value={name} onChange={e => setName(e.target.value)}
              className="w-full bg-gray-700 rounded-lg px-3 py-2 text-sm" autoFocus />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={isExterior} onChange={e => setIsExterior(e.target.checked)} className="rounded" />
            Exterior door
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={isEmergencyExit} onChange={e => setIsEmergencyExit(e.target.checked)} className="rounded" />
            Emergency exit
          </label>
        </div>
        <div className="flex gap-2 mt-5">
          <button onClick={onCancel}
            className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm font-medium">Cancel</button>
          <button onClick={() => onSubmit({ name, isExterior, isEmergencyExit })}
            className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-medium">Save</button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Minimap
// ---------------------------------------------------------------------------
function Minimap({ viewBox, canvasW, canvasH }: {
  viewBox: { x: number; y: number; w: number; h: number };
  canvasW: number; canvasH: number;
}) {
  const mw = 160;
  const mh = (canvasH / canvasW) * mw;
  const rx = (viewBox.x / canvasW) * mw;
  const ry = (viewBox.y / canvasH) * mh;
  const rw = (viewBox.w / canvasW) * mw;
  const rh = (viewBox.h / canvasH) * mh;

  return (
    <div className="absolute bottom-3 right-3 bg-gray-900/90 border border-gray-600 rounded-lg p-1">
      <svg width={mw} height={mh} viewBox={`0 0 ${mw} ${mh}`}>
        <rect width={mw} height={mh} fill="#111827" rx={2} />
        <rect x={Math.max(0, rx)} y={Math.max(0, ry)}
          width={Math.min(rw, mw)} height={Math.min(rh, mh)}
          fill="rgba(59,130,246,0.25)" stroke="#3b82f6" strokeWidth={1} rx={1} />
      </svg>
    </div>
  );
}

// ===========================================================================
// Main FloorPlanPage
// ===========================================================================
export function FloorPlanPage() {
  const { user, token } = useAuth();
  const queryClient = useQueryClient();
  const { data: sites } = useSites();
  const siteId = user?.siteIds[0];
  const { data: alerts } = useAlerts(siteId);
  const { data: doors } = useDoors(siteId);
  const lockDoor = useLockDoor();
  const unlockDoor = useUnlockDoor();
  const createRoom = useCreateRoom();
  const updateRoom = useUpdateRoom();
  const deleteRoom = useDeleteRoom();
  const createDoor = useCreateDoor();
  const updateDoorMut = useUpdateDoor();
  const deleteDoor = useDeleteDoor();

  const [selectedBuilding, setSelectedBuilding] = useState<string>('');
  const [selectedFloor, setSelectedFloor] = useState(1);
  const [selectedElement, setSelectedElement] = useState<{ type: 'room' | 'door'; data: any } | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [dragging, setDragging] = useState<{ type: 'room' | 'door'; id: string; offsetX: number; offsetY: number } | null>(null);
  const [resizing, setResizing] = useState<{ roomId: string; corner: string; startX: number; startY: number; origX: number; origY: number; origW: number; origH: number } | null>(null);
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>('idle');
  const [imageLoadError, setImageLoadError] = useState(false);

  // Zoom/pan state
  const [viewBox, setViewBox] = useState({ x: 0, y: 0, w: CANVAS_W, h: CANVAS_H });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0, vbX: 0, vbY: 0 });
  const [spaceHeld, setSpaceHeld] = useState(false);

  // Modals
  const [showAddRoom, setShowAddRoom] = useState<{ x?: number; y?: number } | null>(null);
  const [showAddDoor, setShowAddDoor] = useState<{ x?: number; y?: number } | null>(null);
  const [editingRoom, setEditingRoom] = useState<any>(null);
  const [editingDoor, setEditingDoor] = useState<any>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ type: 'room' | 'door'; data: any } | null>(null);

  // Local position overrides during drag/resize (not committed to DB yet)
  const [localPositions, setLocalPositions] = useState<Record<string, { mapX?: number; mapY?: number; mapW?: number; mapH?: number }>>({});

  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fetch full site data with rooms
  const { data: siteData } = useQuery({
    queryKey: ['site-detail', siteId],
    enabled: !!siteId,
    queryFn: async () => {
      const res = await fetch(`${API_URL}/api/v1/sites/${siteId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`Failed to load site data (${res.status})`);
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
      setLocalPositions({});
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
        { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: formData }
      );
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Upload failed');
      }
      setUploadStatus('success');
      queryClient.invalidateQueries({ queryKey: ['site-detail', siteId] });
      setTimeout(() => setUploadStatus('idle'), 2000);
    } catch {
      setUploadStatus('error');
      setTimeout(() => setUploadStatus('idle'), 3000);
    }
  }, [siteId, selectedBuilding, token, queryClient]);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleUploadBackground(file);
    e.target.value = '';
  }, [handleUploadBackground]);

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
  const visibleRooms = allRooms.filter((r: any) => r.floor === selectedFloor).map((r: any) => ({
    ...r,
    ...(localPositions[r.id] || {}),
  }));

  const buildingDoors = (doors || []).filter((d: any) => d.buildingId === selectedBuilding);
  const visibleDoors = buildingDoors.filter((d: any) => d.floor === selectedFloor).map((d: any, i: number) => {
    const auto = autoLayoutDoors(buildingDoors, i);
    return {
      ...d,
      mapX: d.mapX ?? auto.mapX,
      mapY: d.mapY ?? auto.mapY,
      ...(localPositions[d.id] || {}),
    };
  });

  const maxFloors = currentBuilding?.floors || 1;

  // SVG coordinate conversion
  const getSvgPoint = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const svgP = pt.matrixTransform(svg.getScreenCTM()?.inverse());
    return { x: Math.round(svgP.x), y: Math.round(svgP.y) };
  }, []);

  // ---------- Keyboard: space to pan ----------
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement)) {
        e.preventDefault();
        setSpaceHeld(true);
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') setSpaceHeld(false);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, []);

  // ---------- Zoom with wheel ----------
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const { x: svgX, y: svgY } = getSvgPoint(e.clientX, e.clientY);
    const zoomFactor = e.deltaY < 0 ? 0.9 : 1.1;

    setViewBox(prev => {
      const newW = Math.max(CANVAS_W * MIN_ZOOM, Math.min(CANVAS_W / MIN_ZOOM, prev.w * zoomFactor));
      const newH = Math.max(CANVAS_H * MIN_ZOOM, Math.min(CANVAS_H / MIN_ZOOM, prev.h * zoomFactor));
      // Zoom around cursor point
      const newX = svgX - (svgX - prev.x) * (newW / prev.w);
      const newY = svgY - (svgY - prev.y) * (newH / prev.h);
      return { x: newX, y: newY, w: newW, h: newH };
    });
  }, [getSvgPoint]);

  // ---------- Pan ----------
  const handlePanStart = useCallback((clientX: number, clientY: number) => {
    setIsPanning(true);
    setPanStart({ x: clientX, y: clientY, vbX: viewBox.x, vbY: viewBox.y });
  }, [viewBox]);

  const handlePanMove = useCallback((clientX: number, clientY: number) => {
    if (!isPanning) return;
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const scaleX = viewBox.w / rect.width;
    const scaleY = viewBox.h / rect.height;
    const dx = (clientX - panStart.x) * scaleX;
    const dy = (clientY - panStart.y) * scaleY;
    setViewBox(prev => ({ ...prev, x: panStart.vbX - dx, y: panStart.vbY - dy }));
  }, [isPanning, panStart, viewBox.w, viewBox.h]);

  const handlePanEnd = useCallback(() => {
    setIsPanning(false);
  }, []);

  // ---------- Drag elements ----------
  const handleMouseDown = (e: React.MouseEvent, type: 'room' | 'door', id: string) => {
    if (!editMode) return;
    if (spaceHeld) return; // let pan take over
    e.stopPropagation();
    const { x: svgX, y: svgY } = getSvgPoint(e.clientX, e.clientY);
    const elem = type === 'room' ? visibleRooms.find((r: any) => r.id === id) : visibleDoors.find((d: any) => d.id === id);
    if (!elem) return;
    const offsetX = svgX - (elem.mapX ?? 0);
    const offsetY = svgY - (elem.mapY ?? 0);
    setDragging({ type, id, offsetX, offsetY });
    setSelectedElement({ type, data: elem });
  };

  // ---------- Resize handles ----------
  const handleResizeStart = (e: React.MouseEvent, roomId: string, corner: string) => {
    e.stopPropagation();
    const room = visibleRooms.find((r: any) => r.id === roomId);
    if (!room) return;
    const { x: svgX, y: svgY } = getSvgPoint(e.clientX, e.clientY);
    setResizing({
      roomId, corner, startX: svgX, startY: svgY,
      origX: room.mapX, origY: room.mapY, origW: room.mapW, origH: room.mapH,
    });
  };

  // ---------- Combined mouse move ----------
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    // Pan
    if (isPanning) {
      handlePanMove(e.clientX, e.clientY);
      return;
    }

    // Resize
    if (resizing) {
      const { x: svgX, y: svgY } = getSvgPoint(e.clientX, e.clientY);
      const dx = svgX - resizing.startX;
      const dy = svgY - resizing.startY;
      let { origX: newX, origY: newY, origW: newW, origH: newH } = resizing;

      if (resizing.corner.includes('e')) newW = Math.max(MIN_ROOM_W, resizing.origW + dx);
      if (resizing.corner.includes('s')) newH = Math.max(MIN_ROOM_H, resizing.origH + dy);
      if (resizing.corner.includes('w')) {
        const maxDx = resizing.origW - MIN_ROOM_W;
        const clampedDx = Math.min(dx, maxDx);
        newX = resizing.origX + clampedDx;
        newW = resizing.origW - clampedDx;
      }
      if (resizing.corner.includes('n')) {
        const maxDy = resizing.origH - MIN_ROOM_H;
        const clampedDy = Math.min(dy, maxDy);
        newY = resizing.origY + clampedDy;
        newH = resizing.origH - clampedDy;
      }

      setLocalPositions(prev => ({
        ...prev,
        [resizing.roomId]: { mapX: Math.round(newX), mapY: Math.round(newY), mapW: Math.round(newW), mapH: Math.round(newH) },
      }));
      return;
    }

    // Drag
    if (dragging && editMode) {
      const { x, y } = getSvgPoint(e.clientX, e.clientY);
      if (dragging.type === 'room') {
        const room = visibleRooms.find((r: any) => r.id === dragging.id);
        if (!room) return;
        setLocalPositions(prev => ({
          ...prev,
          [dragging.id]: {
            ...(prev[dragging.id] || {}),
            mapX: Math.round(x - dragging.offsetX),
            mapY: Math.round(y - dragging.offsetY),
          },
        }));
      } else {
        setLocalPositions(prev => ({
          ...prev,
          [dragging.id]: {
            mapX: Math.round(x - dragging.offsetX),
            mapY: Math.round(y - dragging.offsetY),
          },
        }));
      }
    }
  }, [isPanning, handlePanMove, resizing, dragging, editMode, visibleRooms, getSvgPoint]);

  const handleMouseUp = useCallback(() => {
    setDragging(null);
    setResizing(null);
    handlePanEnd();
  }, [handlePanEnd]);

  // ---------- SVG mouse down (pan or deselect) ----------
  const handleSvgMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 1 || spaceHeld) {
      e.preventDefault();
      handlePanStart(e.clientX, e.clientY);
    } else if (e.button === 0 && !dragging) {
      setSelectedElement(null);
    }
  }, [spaceHeld, handlePanStart, dragging]);

  // ---------- Context menu ----------
  const handleContextMenu = useCallback((e: React.MouseEvent, target?: { type: 'room' | 'door'; data: any }) => {
    if (!editMode) return;
    e.preventDefault();
    e.stopPropagation();
    const { x: svgX, y: svgY } = getSvgPoint(e.clientX, e.clientY);
    setContextMenu({ x: e.clientX, y: e.clientY, svgX, svgY, target: target || null });
  }, [editMode, getSvgPoint]);

  const handleContextAction = useCallback((action: string, target?: any) => {
    if (!siteId || !selectedBuilding) return;
    switch (action) {
      case 'add-room-here':
        setShowAddRoom({ x: contextMenu?.svgX, y: contextMenu?.svgY });
        break;
      case 'add-door-here':
        setShowAddDoor({ x: contextMenu?.svgX, y: contextMenu?.svgY });
        break;
      case 'edit-room':
        setEditingRoom(target);
        break;
      case 'edit-door':
        setEditingDoor(target);
        break;
      case 'delete-room':
        setDeleteConfirm({ type: 'room', data: target });
        break;
      case 'delete-door':
        setDeleteConfirm({ type: 'door', data: target });
        break;
    }
  }, [siteId, selectedBuilding, contextMenu]);

  // ---------- CRUD handlers ----------
  const handleCreateRoom = useCallback((data: any) => {
    if (!siteId || !selectedBuilding) return;
    createRoom.mutate({ siteId, data: { ...data, buildingId: selectedBuilding } });
    setShowAddRoom(null);
  }, [siteId, selectedBuilding, createRoom]);

  const handleCreateDoor = useCallback((data: any) => {
    if (!siteId || !selectedBuilding) return;
    createDoor.mutate({ siteId, data: { ...data, buildingId: selectedBuilding } });
    setShowAddDoor(null);
  }, [siteId, selectedBuilding, createDoor]);

  const handleEditRoom = useCallback((data: any) => {
    if (!siteId || !editingRoom) return;
    updateRoom.mutate({ siteId, roomId: editingRoom.id, data });
    setEditingRoom(null);
  }, [siteId, editingRoom, updateRoom]);

  const handleEditDoor = useCallback((data: any) => {
    if (!siteId || !editingDoor) return;
    updateDoorMut.mutate({ siteId, doorId: editingDoor.id, data });
    setEditingDoor(null);
  }, [siteId, editingDoor, updateDoorMut]);

  const handleDelete = useCallback(() => {
    if (!siteId || !deleteConfirm) return;
    if (deleteConfirm.type === 'room') {
      deleteRoom.mutate({ siteId, roomId: deleteConfirm.data.id });
    } else {
      deleteDoor.mutate({ siteId, doorId: deleteConfirm.data.id });
    }
    if (selectedElement?.data?.id === deleteConfirm.data.id) setSelectedElement(null);
    setDeleteConfirm(null);
  }, [siteId, deleteConfirm, deleteRoom, deleteDoor, selectedElement]);

  // ---------- Save layout ----------
  const handleSaveLayout = () => {
    const roomUpdates = visibleRooms.map((r: any) => ({
      id: r.id, mapX: r.mapX, mapY: r.mapY, mapW: r.mapW, mapH: r.mapH,
    }));
    // Include non-visible floor rooms too
    const otherRooms = allRooms.filter((r: any) => r.floor !== selectedFloor).map((r: any) => ({
      id: r.id, mapX: r.mapX, mapY: r.mapY, mapW: r.mapW, mapH: r.mapH,
    }));
    const doorUpdates = visibleDoors.map((d: any) => ({
      id: d.id, mapX: d.mapX, mapY: d.mapY,
    }));
    saveMutation.mutate({ rooms: [...roomUpdates, ...otherRooms], doors: doorUpdates });
    setEditMode(false);
  };

  // ---------- Door click & action ----------
  const handleDoorClick = (e: React.MouseEvent, door: any) => {
    e.stopPropagation();
    if (editMode) {
      setSelectedElement({ type: 'door', data: door });
      return;
    }
    setSelectedElement(prev => prev?.data?.id === door.id ? null : { type: 'door', data: door });
  };

  const handleRoomClick = (e: React.MouseEvent, room: any) => {
    e.stopPropagation();
    setSelectedElement({ type: 'room', data: room });
  };

  const handleDoorAction = (door: any, action: 'lock' | 'unlock') => {
    if (action === 'lock') lockDoor.mutate(door.id);
    else unlockDoor.mutate(door.id);
    setSelectedElement(null);
  };

  // ---------- Zoom controls ----------
  const zoomIn = () => setViewBox(prev => {
    const f = 0.8;
    const newW = prev.w * f;
    const newH = prev.h * f;
    return { x: prev.x + (prev.w - newW) / 2, y: prev.y + (prev.h - newH) / 2, w: newW, h: newH };
  });
  const zoomOut = () => setViewBox(prev => {
    const f = 1.25;
    const newW = Math.min(CANVAS_W / MIN_ZOOM, prev.w * f);
    const newH = Math.min(CANVAS_H / MIN_ZOOM, prev.h * f);
    return { x: prev.x - (newW - prev.w) / 2, y: prev.y - (newH - prev.h) / 2, w: newW, h: newH };
  });
  const fitToContent = () => setViewBox({ x: 0, y: 0, w: CANVAS_W, h: CANVAS_H });

  const isAdmin = user?.role === 'SITE_ADMIN' || user?.role === 'SUPER_ADMIN';
  const zoomLevel = Math.round((CANVAS_W / viewBox.w) * 100);

  return (
    <div className="flex flex-col" style={{ height: 'calc(100vh - 64px)' }}>
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-700 flex-shrink-0">
        <div className="flex items-center gap-4">
          <div className="flex gap-2">
            {buildings.map((b: any) => (
              <button key={b.id} onClick={() => { setSelectedBuilding(b.id); setSelectedFloor(1); setImageLoadError(false); }}
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

          {/* Zoom controls */}
          <div className="flex items-center gap-1 ml-4">
            <button onClick={zoomOut} className="p-1.5 bg-gray-700 hover:bg-gray-600 rounded text-sm" title="Zoom out">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" /></svg>
            </button>
            <span className="text-xs text-gray-400 w-10 text-center">{zoomLevel}%</span>
            <button onClick={zoomIn} className="p-1.5 bg-gray-700 hover:bg-gray-600 rounded text-sm" title="Zoom in">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
            </button>
            <button onClick={fitToContent} className="p-1.5 bg-gray-700 hover:bg-gray-600 rounded text-xs ml-1" title="Fit to content">
              Fit
            </button>
          </div>
        </div>

        {isAdmin && (
          <div className="flex gap-2">
            {editMode ? (
              <>
                <button onClick={() => { const cx = viewBox.x + viewBox.w / 2; const cy = viewBox.y + viewBox.h / 2; setShowAddRoom({ x: cx - 75, y: cy - 40 }); }}
                  className="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 rounded-lg text-sm font-medium transition-colors">
                  + Room
                </button>
                <button onClick={() => { const cx = viewBox.x + viewBox.w / 2; const cy = viewBox.y + viewBox.h / 2; setShowAddDoor({ x: cx, y: cy }); }}
                  className="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 rounded-lg text-sm font-medium transition-colors">
                  + Door
                </button>
                {selectedElement && (
                  <button onClick={() => setDeleteConfirm(selectedElement)}
                    className="px-3 py-1.5 bg-red-700 hover:bg-red-600 rounded-lg text-sm font-medium transition-colors">
                    Delete
                  </button>
                )}
                <button onClick={() => fileInputRef.current?.click()}
                  disabled={uploadStatus === 'uploading'}
                  className="px-3 py-1.5 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 rounded-lg text-sm font-medium transition-colors">
                  {uploadStatus === 'uploading' ? 'Uploading...' :
                   uploadStatus === 'success' ? 'Uploaded!' :
                   uploadStatus === 'error' ? 'Failed' : 'Background'}
                </button>
                <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/svg+xml"
                  className="hidden" onChange={handleFileChange} />
                <button onClick={handleSaveLayout}
                  className="px-4 py-1.5 bg-green-600 hover:bg-green-500 rounded-lg text-sm font-medium transition-colors">
                  {saveMutation.isPending ? 'Saving...' : 'Save Layout'}
                </button>
                <button onClick={() => { setEditMode(false); setLocalPositions({}); setSelectedElement(null); }}
                  className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm font-medium transition-colors">
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
        <div className="bg-blue-900/30 border-b border-blue-700 px-4 py-2 text-sm text-blue-300 flex-shrink-0">
          Drag rooms and doors to reposition. Right-click for options. Resize rooms with corner handles. Scroll to zoom, Space+drag to pan.
        </div>
      )}

      <div className="flex-1 flex min-h-0">
        {/* Floor Plan SVG */}
        <div className="flex-1 relative" ref={containerRef}>
          <svg ref={svgRef}
            viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`}
            className="w-full h-full bg-gray-900"
            style={{ cursor: spaceHeld || isPanning ? 'grabbing' : editMode ? 'crosshair' : 'default' }}
            onWheel={handleWheel}
            onMouseDown={handleSvgMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onContextMenu={e => handleContextMenu(e)}>
            <defs>
              <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#1f2937" strokeWidth="0.5"/>
              </pattern>
            </defs>
            <rect x={0} y={0} width={CANVAS_W} height={CANVAS_H} fill="#111827" />
            <rect x={0} y={0} width={CANVAS_W} height={CANVAS_H} fill="url(#grid)" />

            {/* Floor plan background image */}
            {floorPlanImageUrl && !imageLoadError && (
              <image
                href={`${floorPlanImageUrl}?t=${currentBuilding?.updatedAt || ''}`}
                x="20" y="20" width={CANVAS_W - 40} height={CANVAS_H - 40}
                preserveAspectRatio="xMidYMid meet"
                opacity="0.85"
                style={{ pointerEvents: 'none' }}
                onError={() => setImageLoadError(true)}
                onLoad={() => setImageLoadError(false)}
              />
            )}
            {floorPlanImageUrl && imageLoadError && (
              <text x={CANVAS_W / 2} y={CANVAS_H / 2} fill="#ef4444" fontSize="18" textAnchor="middle">
                Floor plan image failed to load
              </text>
            )}

            {/* Building outline */}
            <rect x="20" y="20" width={CANVAS_W - 40} height={CANVAS_H - 40}
              fill="none" stroke="#374151" strokeWidth="2" rx="4" strokeDasharray="8 4"/>

            {/* Rooms */}
            {visibleRooms.map((room: any) => {
              const hasAlert = alertRoomNames.has(room.name);
              const isSelected = selectedElement?.type === 'room' && selectedElement.data.id === room.id;
              const isDraggingThis = dragging?.type === 'room' && dragging.id === room.id;
              return (
                <g key={room.id}
                  onMouseDown={e => { if (e.button === 0) handleMouseDown(e, 'room', room.id); }}
                  onClick={e => handleRoomClick(e, room)}
                  onContextMenu={e => handleContextMenu(e, { type: 'room', data: room })}
                  style={{ cursor: editMode ? (spaceHeld ? 'grabbing' : 'move') : 'default' }}>
                  <rect x={room.mapX} y={room.mapY} width={room.mapW} height={room.mapH}
                    fill={hasAlert ? '#7f1d1d' : '#1e293b'}
                    stroke={isSelected ? '#3b82f6' : isDraggingThis ? '#60a5fa' : hasAlert ? '#ef4444' : '#334155'}
                    strokeWidth={isSelected || isDraggingThis ? 2.5 : hasAlert ? 2 : 1}
                    rx={6}
                    className={hasAlert ? 'animate-pulse' : ''}
                  />
                  <text x={room.mapX + room.mapW / 2} y={room.mapY + room.mapH / 2 - 6}
                    fill={hasAlert ? '#fca5a5' : '#94a3b8'}
                    fontSize="12" textAnchor="middle" fontWeight="600" pointerEvents="none">
                    {room.name}
                  </text>
                  <text x={room.mapX + room.mapW / 2} y={room.mapY + room.mapH / 2 + 10}
                    fill={hasAlert ? '#f87171' : '#475569'}
                    fontSize="10" textAnchor="middle" pointerEvents="none">
                    {hasAlert ? 'ALERT ACTIVE' : room.type !== 'HALLWAY' ? room.type?.toLowerCase() : ''}
                  </text>

                  {/* Resize handles (edit mode, selected) */}
                  {editMode && isSelected && (
                    <>
                      {['nw', 'ne', 'se', 'sw'].map(corner => {
                        const cx = corner.includes('w') ? room.mapX : room.mapX + room.mapW;
                        const cy = corner.includes('n') ? room.mapY : room.mapY + room.mapH;
                        const cursorMap: Record<string, string> = { nw: 'nw-resize', ne: 'ne-resize', se: 'se-resize', sw: 'sw-resize' };
                        return (
                          <rect key={corner}
                            x={cx - 5} y={cy - 5} width={10} height={10}
                            fill="#3b82f6" stroke="#1e3a8a" strokeWidth={1} rx={2}
                            style={{ cursor: cursorMap[corner] }}
                            onMouseDown={e => { e.stopPropagation(); handleResizeStart(e, room.id, corner); }}
                          />
                        );
                      })}
                    </>
                  )}
                </g>
              );
            })}

            {/* Doors */}
            {visibleDoors.map((door: any) => {
              const colors = statusColors[door.status] || statusColors.UNKNOWN;
              const isSelected = selectedElement?.type === 'door' && selectedElement.data.id === door.id;
              const isDraggingThis = dragging?.type === 'door' && dragging.id === door.id;

              return (
                <g key={door.id}
                  onClick={e => handleDoorClick(e, door)}
                  onMouseDown={e => { if (e.button === 0) handleMouseDown(e, 'door', door.id); }}
                  onContextMenu={e => handleContextMenu(e, { type: 'door', data: door })}
                  style={{ cursor: editMode ? (spaceHeld ? 'grabbing' : 'move') : 'pointer' }}>
                  <rect x={door.mapX - 14} y={door.mapY - 10} width={28} height={20}
                    fill={colors.fill}
                    stroke={isSelected ? '#3b82f6' : isDraggingThis ? '#60a5fa' : '#000'}
                    strokeWidth={isSelected || isDraggingThis ? 2.5 : 1} rx={3}
                  />
                  <circle cx={door.mapX + 16} cy={door.mapY - 8} r={5}
                    fill={door.status === 'LOCKED' ? '#22c55e' :
                          door.status === 'FORCED' ? '#ef4444' :
                          door.status === 'HELD' ? '#f97316' : '#eab308'}
                  />
                  <text x={door.mapX} y={door.mapY + 26} fill="#9ca3af" fontSize="10" textAnchor="middle" pointerEvents="none">
                    {door.name}
                  </text>
                </g>
              );
            })}

            {/* Legend */}
            <g transform={`translate(30, ${CANVAS_H - 30})`}>
              {Object.entries(statusColors).map(([status, colors], i) => (
                <g key={status} transform={`translate(${i * 130}, 0)`}>
                  <rect x={0} y={-6} width={12} height={12} fill={colors.fill} rx={2}/>
                  <text x={16} y={5} fill="#9ca3af" fontSize="11">{colors.label}</text>
                </g>
              ))}
            </g>
          </svg>

          {/* Minimap */}
          <Minimap viewBox={viewBox} canvasW={CANVAS_W} canvasH={CANVAS_H} />
        </div>

        {/* Side Panel */}
        <div className="w-72 border-l border-gray-700 overflow-y-auto flex-shrink-0 p-4 space-y-4">
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

          {/* Selected element panel */}
          {selectedElement?.type === 'door' && !editMode ? (
            <div className="bg-gray-800 rounded-xl p-4">
              <h3 className="font-bold mb-3">{selectedElement.data.name}</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-400">Status</span>
                  <span className={`font-semibold ${
                    selectedElement.data.status === 'LOCKED' ? 'text-green-400' :
                    selectedElement.data.status === 'FORCED' ? 'text-red-400' : 'text-yellow-400'
                  }`}>{selectedElement.data.status}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Type</span>
                  <span>{selectedElement.data.isExterior ? 'Exterior' : 'Interior'}</span>
                </div>
                {selectedElement.data.isEmergencyExit && (
                  <div className="text-orange-400 text-xs">Emergency Exit</div>
                )}
              </div>
              <div className="flex gap-2 mt-4">
                <button onClick={() => handleDoorAction(selectedElement.data, 'lock')}
                  className="flex-1 px-3 py-2 bg-green-700 hover:bg-green-600 rounded-lg text-sm font-medium transition-colors">
                  Lock
                </button>
                <button onClick={() => handleDoorAction(selectedElement.data, 'unlock')}
                  className="flex-1 px-3 py-2 bg-yellow-700 hover:bg-yellow-600 rounded-lg text-sm font-medium transition-colors">
                  Unlock
                </button>
              </div>
            </div>
          ) : selectedElement?.type === 'room' ? (
            <div className="bg-gray-800 rounded-xl p-4">
              <h3 className="font-bold mb-3">{selectedElement.data.name}</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-400">Number</span>
                  <span>{selectedElement.data.number}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Type</span>
                  <span className="capitalize">{selectedElement.data.type?.toLowerCase()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Floor</span>
                  <span>{selectedElement.data.floor}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Size</span>
                  <span>{selectedElement.data.mapW} x {selectedElement.data.mapH}</span>
                </div>
              </div>
              {editMode && (
                <div className="flex gap-2 mt-4">
                  <button onClick={() => setEditingRoom(selectedElement.data)}
                    className="flex-1 px-3 py-2 bg-blue-700 hover:bg-blue-600 rounded-lg text-sm font-medium transition-colors">
                    Edit
                  </button>
                  <button onClick={() => setDeleteConfirm(selectedElement)}
                    className="flex-1 px-3 py-2 bg-red-700 hover:bg-red-600 rounded-lg text-sm font-medium transition-colors">
                    Delete
                  </button>
                </div>
              )}
            </div>
          ) : selectedElement?.type === 'door' && editMode ? (
            <div className="bg-gray-800 rounded-xl p-4">
              <h3 className="font-bold mb-3">{selectedElement.data.name}</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-400">Status</span>
                  <span>{selectedElement.data.status}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Exterior</span>
                  <span>{selectedElement.data.isExterior ? 'Yes' : 'No'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Emergency</span>
                  <span>{selectedElement.data.isEmergencyExit ? 'Yes' : 'No'}</span>
                </div>
              </div>
              <div className="flex gap-2 mt-4">
                <button onClick={() => setEditingDoor(selectedElement.data)}
                  className="flex-1 px-3 py-2 bg-blue-700 hover:bg-blue-600 rounded-lg text-sm font-medium transition-colors">
                  Edit
                </button>
                <button onClick={() => setDeleteConfirm(selectedElement)}
                  className="flex-1 px-3 py-2 bg-red-700 hover:bg-red-600 rounded-lg text-sm font-medium transition-colors">
                  Delete
                </button>
              </div>
            </div>
          ) : (
            <div className="bg-gray-800 rounded-xl p-4 text-center text-gray-500 text-sm">
              {editMode ? 'Click a room or door to select it' : 'Click a door on the map to view details and controls'}
            </div>
          )}

          <div className="bg-gray-800 rounded-xl p-4">
            <h3 className="font-bold mb-3">All Doors</h3>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {(doors || []).map((door: any) => (
                <button key={door.id}
                  onClick={() => setSelectedElement({ type: 'door', data: door })}
                  className={`w-full flex items-center justify-between p-2 rounded-lg text-sm transition-colors ${
                    selectedElement?.data?.id === door.id ? 'bg-blue-900/30 border border-blue-700' : 'hover:bg-gray-700'
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

      {/* Context Menu */}
      <ContextMenu state={contextMenu} onClose={() => setContextMenu(null)} onAction={handleContextAction} />

      {/* Modals */}
      {showAddRoom && (
        <AddRoomForm onSubmit={handleCreateRoom} onCancel={() => setShowAddRoom(null)} defaultPos={showAddRoom} />
      )}
      {showAddDoor && (
        <AddDoorForm onSubmit={handleCreateDoor} onCancel={() => setShowAddDoor(null)} defaultPos={showAddDoor} />
      )}
      {editingRoom && (
        <EditRoomForm room={editingRoom} onSubmit={handleEditRoom} onCancel={() => setEditingRoom(null)} />
      )}
      {editingDoor && (
        <EditDoorForm door={editingDoor} onSubmit={handleEditDoor} onCancel={() => setEditingDoor(null)} />
      )}

      {/* Delete confirmation */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setDeleteConfirm(null)}>
          <div className="bg-gray-800 rounded-xl p-6 w-96 shadow-2xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-2">Delete {deleteConfirm.type === 'room' ? 'Room' : 'Door'}</h3>
            <p className="text-gray-400 text-sm mb-4">
              Are you sure you want to delete <strong className="text-white">{deleteConfirm.data.name}</strong>? This cannot be undone.
            </p>
            <div className="flex gap-2">
              <button onClick={() => setDeleteConfirm(null)}
                className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm font-medium">Cancel</button>
              <button onClick={handleDelete}
                className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-500 rounded-lg text-sm font-medium">Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
