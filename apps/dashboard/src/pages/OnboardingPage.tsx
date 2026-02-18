import { useReducer, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useAuth } from '../hooks/useAuth';
import { apiClient } from '../api/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface OnboardingRoom {
  id: string;
  name: string;
  number: string;
  floor: number;
  type: string;
}

interface OnboardingDoor {
  id: string;
  name: string;
  type: string;
  floor: number;
  isExterior: boolean;
  isEmergencyExit: boolean;
  roomName: string;
}

interface OnboardingBuilding {
  id: string;
  name: string;
  floors: number;
  rooms: OnboardingRoom[];
  doors: OnboardingDoor[];
}

interface OnboardingUser {
  id: string;
  name: string;
  email: string;
  role: string;
}

interface OnboardingState {
  step: number;
  site: {
    name: string;
    address: string;
    city: string;
    state: string;
    zip: string;
    organizationId: string;
    schoolType: string;
  };
  buildings: OnboardingBuilding[];
  users: OnboardingUser[];
  integrations: {
    accessControl: string;
    dispatch: string;
    notification: string;
  };
}

type OnboardingAction =
  | { type: 'SET_STEP'; step: number }
  | { type: 'UPDATE_SITE'; field: string; value: string }
  | { type: 'ADD_BUILDING' }
  | { type: 'UPDATE_BUILDING'; buildingId: string; field: string; value: string | number }
  | { type: 'REMOVE_BUILDING'; buildingId: string }
  | { type: 'ADD_ROOM'; buildingId: string }
  | { type: 'UPDATE_ROOM'; buildingId: string; roomId: string; field: string; value: string | number }
  | { type: 'REMOVE_ROOM'; buildingId: string; roomId: string }
  | { type: 'ADD_DOOR'; buildingId: string }
  | { type: 'UPDATE_DOOR'; buildingId: string; doorId: string; field: string; value: string | number | boolean }
  | { type: 'REMOVE_DOOR'; buildingId: string; doorId: string }
  | { type: 'ADD_USER' }
  | { type: 'UPDATE_USER'; userId: string; field: string; value: string }
  | { type: 'REMOVE_USER'; userId: string }
  | { type: 'UPDATE_INTEGRATION'; field: string; value: string };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STEPS = [
  'School Info',
  'Buildings',
  'Rooms',
  'Doors',
  'Users',
  'Integrations',
  'Review',
];

const SCHOOL_TYPES = ['Elementary', 'Middle', 'High', 'Other'];

const ROOM_TYPES = [
  'CLASSROOM',
  'OFFICE',
  'GYM',
  'CAFETERIA',
  'LIBRARY',
  'HALLWAY',
  'RESTROOM',
  'OTHER',
];

const DOOR_TYPES = [
  'MAIN_ENTRANCE',
  'CLASSROOM',
  'EMERGENCY_EXIT',
  'INTERNAL',
];

const USER_ROLES = [
  'SITE_ADMIN',
  'OPERATOR',
  'TEACHER',
  'FIRST_RESPONDER',
];

const AC_ADAPTERS = ['Mock', 'Sicunet', 'Genetec', 'Brivo', 'Verkada', 'LenelS2', 'Openpath', 'HID Mercury'];
const DISPATCH_ADAPTERS = ['Console', 'RapidSOS', 'Rave'];
const NOTIFICATION_ADAPTERS = ['Console', 'Twilio', 'SendGrid'];

const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
  'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
  'VA','WA','WV','WI','WY','DC',
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let nextId = 1;
function genId(): string {
  return `tmp-${Date.now()}-${nextId++}`;
}

function floorLabel(n: number): string {
  if (n === 1) return '1st Floor';
  if (n === 2) return '2nd Floor';
  if (n === 3) return '3rd Floor';
  return `${n}th Floor`;
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

const initialState: OnboardingState = {
  step: 0,
  site: {
    name: '',
    address: '',
    city: '',
    state: '',
    zip: '',
    organizationId: '',
    schoolType: 'Elementary',
  },
  buildings: [],
  users: [],
  integrations: {
    accessControl: 'Mock',
    dispatch: 'Console',
    notification: 'Console',
  },
};

function reducer(state: OnboardingState, action: OnboardingAction): OnboardingState {
  switch (action.type) {
    case 'SET_STEP':
      return { ...state, step: action.step };

    case 'UPDATE_SITE':
      return { ...state, site: { ...state.site, [action.field]: action.value } };

    case 'ADD_BUILDING':
      return {
        ...state,
        buildings: [
          ...state.buildings,
          { id: genId(), name: '', floors: 1, rooms: [], doors: [] },
        ],
      };

    case 'UPDATE_BUILDING':
      return {
        ...state,
        buildings: state.buildings.map((b) =>
          b.id === action.buildingId ? { ...b, [action.field]: action.value } : b
        ),
      };

    case 'REMOVE_BUILDING':
      return {
        ...state,
        buildings: state.buildings.filter((b) => b.id !== action.buildingId),
      };

    case 'ADD_ROOM': {
      return {
        ...state,
        buildings: state.buildings.map((b) =>
          b.id === action.buildingId
            ? {
                ...b,
                rooms: [
                  ...b.rooms,
                  { id: genId(), name: '', number: '', floor: 1, type: 'CLASSROOM' },
                ],
              }
            : b
        ),
      };
    }

    case 'UPDATE_ROOM':
      return {
        ...state,
        buildings: state.buildings.map((b) =>
          b.id === action.buildingId
            ? {
                ...b,
                rooms: b.rooms.map((r) =>
                  r.id === action.roomId ? { ...r, [action.field]: action.value } : r
                ),
              }
            : b
        ),
      };

    case 'REMOVE_ROOM':
      return {
        ...state,
        buildings: state.buildings.map((b) =>
          b.id === action.buildingId
            ? { ...b, rooms: b.rooms.filter((r) => r.id !== action.roomId) }
            : b
        ),
      };

    case 'ADD_DOOR':
      return {
        ...state,
        buildings: state.buildings.map((b) =>
          b.id === action.buildingId
            ? {
                ...b,
                doors: [
                  ...b.doors,
                  {
                    id: genId(),
                    name: '',
                    type: 'INTERNAL',
                    floor: 1,
                    isExterior: false,
                    isEmergencyExit: false,
                    roomName: '',
                  },
                ],
              }
            : b
        ),
      };

    case 'UPDATE_DOOR':
      return {
        ...state,
        buildings: state.buildings.map((b) =>
          b.id === action.buildingId
            ? {
                ...b,
                doors: b.doors.map((d) =>
                  d.id === action.doorId ? { ...d, [action.field]: action.value } : d
                ),
              }
            : b
        ),
      };

    case 'REMOVE_DOOR':
      return {
        ...state,
        buildings: state.buildings.map((b) =>
          b.id === action.buildingId
            ? { ...b, doors: b.doors.filter((d) => d.id !== action.doorId) }
            : b
        ),
      };

    case 'ADD_USER':
      return {
        ...state,
        users: [
          ...state.users,
          { id: genId(), name: '', email: '', role: 'TEACHER' },
        ],
      };

    case 'UPDATE_USER':
      return {
        ...state,
        users: state.users.map((u) =>
          u.id === action.userId ? { ...u, [action.field]: action.value } : u
        ),
      };

    case 'REMOVE_USER':
      return { ...state, users: state.users.filter((u) => u.id !== action.userId) };

    case 'UPDATE_INTEGRATION':
      return {
        ...state,
        integrations: { ...state.integrations, [action.field]: action.value },
      };

    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validateStep(state: OnboardingState, step: number): string | null {
  switch (step) {
    case 0: {
      const { name, address, city, state: st, zip } = state.site;
      if (!name.trim()) return 'School name is required';
      if (!address.trim()) return 'Address is required';
      if (!city.trim()) return 'City is required';
      if (!st) return 'State is required';
      if (!zip.trim()) return 'ZIP code is required';
      if (!/^\d{5}(-\d{4})?$/.test(zip.trim())) return 'ZIP code must be 5 or 9 digits (e.g. 07090 or 07090-1234)';
      return null;
    }
    case 1: {
      if (state.buildings.length === 0) return 'Add at least one building';
      for (const b of state.buildings) {
        if (!b.name.trim()) return `Building name is required for all buildings`;
        if (b.floors < 1) return `${b.name}: floors must be at least 1`;
      }
      return null;
    }
    case 2: // rooms are optional
      return null;
    case 3: // doors are optional
      return null;
    case 4: {
      for (const u of state.users) {
        if (!u.name.trim()) return 'All users must have a name';
        if (!u.email.trim()) return 'All users must have an email';
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(u.email.trim())) return `Invalid email: ${u.email}`;
      }
      return null;
    }
    case 5: // integrations always have defaults
      return null;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Step Components
// ---------------------------------------------------------------------------

interface StepProps {
  state: OnboardingState;
  dispatch: React.Dispatch<OnboardingAction>;
}

// -- Step 1: School Information -----------------------------------------------

function StepSchoolInfo({ state, dispatch, organizations }: StepProps & { organizations: any[] }) {
  const s = state.site;
  const set = (field: string, value: string) => dispatch({ type: 'UPDATE_SITE', field, value });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold mb-1">School Information</h2>
        <p className="text-sm text-gray-400">Enter the basic details about this school site.</p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <label className="block text-sm font-medium text-gray-300 mb-1">School Name *</label>
          <input
            type="text"
            value={s.name}
            onChange={(e) => set('name', e.target.value)}
            placeholder="e.g. Lincoln Elementary School"
            className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
          />
        </div>

        <div className="col-span-2">
          <label className="block text-sm font-medium text-gray-300 mb-1">Street Address *</label>
          <input
            type="text"
            value={s.address}
            onChange={(e) => set('address', e.target.value)}
            placeholder="123 Main Street"
            className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">City *</label>
          <input
            type="text"
            value={s.city}
            onChange={(e) => set('city', e.target.value)}
            placeholder="Springfield"
            className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">State *</label>
            <select
              value={s.state}
              onChange={(e) => set('state', e.target.value)}
              className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
            >
              <option value="">Select...</option>
              {US_STATES.map((st) => (
                <option key={st} value={st}>{st}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">ZIP Code *</label>
            <input
              type="text"
              value={s.zip}
              onChange={(e) => set('zip', e.target.value)}
              placeholder="07090"
              maxLength={10}
              className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">District / Organization</label>
          <select
            value={s.organizationId}
            onChange={(e) => set('organizationId', e.target.value)}
            className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
          >
            <option value="">None (Independent)</option>
            {(organizations || []).map((org: any) => (
              <option key={org.id} value={org.id}>{org.name}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">School Type</label>
          <select
            value={s.schoolType}
            onChange={(e) => set('schoolType', e.target.value)}
            className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
          >
            {SCHOOL_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}

// -- Step 2: Building Setup ---------------------------------------------------

function StepBuildings({ state, dispatch }: StepProps) {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold mb-1">Building Setup</h2>
          <p className="text-sm text-gray-400">Add the buildings at this school site.</p>
        </div>
        <button
          onClick={() => dispatch({ type: 'ADD_BUILDING' })}
          className="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          + Add Building
        </button>
      </div>

      {state.buildings.length === 0 && (
        <div className="text-center py-12 text-gray-500">
          No buildings added yet. Click "Add Building" to get started.
        </div>
      )}

      <div className="space-y-4">
        {state.buildings.map((bldg) => (
          <div key={bldg.id} className="bg-gray-800/50 border border-gray-700 rounded-lg p-5">
            <div className="flex items-start justify-between mb-4">
              <div className="grid grid-cols-2 gap-4 flex-1 mr-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">Building Name *</label>
                  <input
                    type="text"
                    value={bldg.name}
                    onChange={(e) =>
                      dispatch({ type: 'UPDATE_BUILDING', buildingId: bldg.id, field: 'name', value: e.target.value })
                    }
                    placeholder="e.g. Main Building"
                    className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">Number of Floors</label>
                  <input
                    type="number"
                    min={1}
                    max={20}
                    value={bldg.floors}
                    onChange={(e) =>
                      dispatch({
                        type: 'UPDATE_BUILDING',
                        buildingId: bldg.id,
                        field: 'floors',
                        value: Math.max(1, parseInt(e.target.value) || 1),
                      })
                    }
                    className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                  />
                </div>
              </div>
              <button
                onClick={() => dispatch({ type: 'REMOVE_BUILDING', buildingId: bldg.id })}
                className="text-red-400 hover:text-red-300 p-1 transition-colors"
                title="Remove building"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </div>
            {bldg.floors > 0 && (
              <div className="text-xs text-gray-500">
                Floors: {Array.from({ length: bldg.floors }, (_, i) => floorLabel(i + 1)).join(', ')}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// -- Step 3: Room Configuration -----------------------------------------------

function StepRooms({ state, dispatch }: StepProps) {
  const [expandedBuilding, setExpandedBuilding] = useState<string | null>(
    state.buildings[0]?.id || null
  );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold mb-1">Room Configuration</h2>
        <p className="text-sm text-gray-400">Add rooms for each building and floor. This step is optional but recommended.</p>
      </div>

      {state.buildings.map((bldg) => (
        <div key={bldg.id} className="bg-gray-800/50 border border-gray-700 rounded-lg overflow-hidden">
          <button
            onClick={() => setExpandedBuilding(expandedBuilding === bldg.id ? null : bldg.id)}
            className="w-full flex items-center justify-between p-4 hover:bg-gray-700/30 transition-colors"
          >
            <div className="flex items-center gap-3">
              <svg
                className={`w-4 h-4 transition-transform ${expandedBuilding === bldg.id ? 'rotate-90' : ''}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
              <span className="font-medium">{bldg.name || 'Unnamed Building'}</span>
            </div>
            <span className="text-sm text-gray-400">{bldg.rooms.length} room{bldg.rooms.length !== 1 ? 's' : ''}</span>
          </button>

          {expandedBuilding === bldg.id && (
            <div className="border-t border-gray-700 p-4 space-y-3">
              <button
                onClick={() => dispatch({ type: 'ADD_ROOM', buildingId: bldg.id })}
                className="bg-gray-700 hover:bg-gray-600 px-3 py-1.5 rounded text-sm font-medium transition-colors"
              >
                + Add Room
              </button>

              {bldg.rooms.length === 0 && (
                <div className="text-center py-6 text-gray-500 text-sm">No rooms added for this building.</div>
              )}

              {bldg.rooms.map((room) => (
                <div key={room.id} className="flex items-center gap-3 bg-gray-700/30 rounded-lg p-3">
                  <input
                    type="text"
                    value={room.name}
                    onChange={(e) =>
                      dispatch({ type: 'UPDATE_ROOM', buildingId: bldg.id, roomId: room.id, field: 'name', value: e.target.value })
                    }
                    placeholder="Room name"
                    className="flex-1 bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                  />
                  <input
                    type="text"
                    value={room.number}
                    onChange={(e) =>
                      dispatch({ type: 'UPDATE_ROOM', buildingId: bldg.id, roomId: room.id, field: 'number', value: e.target.value })
                    }
                    placeholder="Room #"
                    className="w-24 bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                  />
                  <select
                    value={room.floor}
                    onChange={(e) =>
                      dispatch({ type: 'UPDATE_ROOM', buildingId: bldg.id, roomId: room.id, field: 'floor', value: parseInt(e.target.value) })
                    }
                    className="w-32 bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                  >
                    {Array.from({ length: bldg.floors }, (_, i) => (
                      <option key={i + 1} value={i + 1}>{floorLabel(i + 1)}</option>
                    ))}
                  </select>
                  <select
                    value={room.type}
                    onChange={(e) =>
                      dispatch({ type: 'UPDATE_ROOM', buildingId: bldg.id, roomId: room.id, field: 'type', value: e.target.value })
                    }
                    className="w-36 bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                  >
                    {ROOM_TYPES.map((t) => (
                      <option key={t} value={t}>{t.charAt(0) + t.slice(1).toLowerCase()}</option>
                    ))}
                  </select>
                  <button
                    onClick={() => dispatch({ type: 'REMOVE_ROOM', buildingId: bldg.id, roomId: room.id })}
                    className="text-red-400 hover:text-red-300 p-1 transition-colors flex-shrink-0"
                    title="Remove room"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// -- Step 4: Door & Access Points ---------------------------------------------

function StepDoors({ state, dispatch }: StepProps) {
  const [expandedBuilding, setExpandedBuilding] = useState<string | null>(
    state.buildings[0]?.id || null
  );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold mb-1">Doors & Access Points</h2>
        <p className="text-sm text-gray-400">Define doors for each building. These will be used for lockdown commands and access control.</p>
      </div>

      {state.buildings.map((bldg) => (
        <div key={bldg.id} className="bg-gray-800/50 border border-gray-700 rounded-lg overflow-hidden">
          <button
            onClick={() => setExpandedBuilding(expandedBuilding === bldg.id ? null : bldg.id)}
            className="w-full flex items-center justify-between p-4 hover:bg-gray-700/30 transition-colors"
          >
            <div className="flex items-center gap-3">
              <svg
                className={`w-4 h-4 transition-transform ${expandedBuilding === bldg.id ? 'rotate-90' : ''}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
              <span className="font-medium">{bldg.name || 'Unnamed Building'}</span>
            </div>
            <span className="text-sm text-gray-400">{bldg.doors.length} door{bldg.doors.length !== 1 ? 's' : ''}</span>
          </button>

          {expandedBuilding === bldg.id && (
            <div className="border-t border-gray-700 p-4 space-y-3">
              <button
                onClick={() => dispatch({ type: 'ADD_DOOR', buildingId: bldg.id })}
                className="bg-gray-700 hover:bg-gray-600 px-3 py-1.5 rounded text-sm font-medium transition-colors"
              >
                + Add Door
              </button>

              {bldg.doors.length === 0 && (
                <div className="text-center py-6 text-gray-500 text-sm">No doors added for this building.</div>
              )}

              {bldg.doors.map((door) => (
                <div key={door.id} className="flex items-center gap-3 bg-gray-700/30 rounded-lg p-3">
                  <input
                    type="text"
                    value={door.name}
                    onChange={(e) =>
                      dispatch({ type: 'UPDATE_DOOR', buildingId: bldg.id, doorId: door.id, field: 'name', value: e.target.value })
                    }
                    placeholder="Door name"
                    className="flex-1 bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                  />
                  <select
                    value={door.type}
                    onChange={(e) =>
                      dispatch({ type: 'UPDATE_DOOR', buildingId: bldg.id, doorId: door.id, field: 'type', value: e.target.value })
                    }
                    className="w-40 bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                  >
                    {DOOR_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t.split('_').map((w) => w.charAt(0) + w.slice(1).toLowerCase()).join(' ')}
                      </option>
                    ))}
                  </select>
                  <select
                    value={door.floor}
                    onChange={(e) =>
                      dispatch({ type: 'UPDATE_DOOR', buildingId: bldg.id, doorId: door.id, field: 'floor', value: parseInt(e.target.value) })
                    }
                    className="w-32 bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                  >
                    {Array.from({ length: bldg.floors }, (_, i) => (
                      <option key={i + 1} value={i + 1}>{floorLabel(i + 1)}</option>
                    ))}
                  </select>
                  <select
                    value={door.roomName}
                    onChange={(e) =>
                      dispatch({ type: 'UPDATE_DOOR', buildingId: bldg.id, doorId: door.id, field: 'roomName', value: e.target.value })
                    }
                    className="w-40 bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                  >
                    <option value="">No room</option>
                    {bldg.rooms
                      .filter((r) => r.floor === door.floor)
                      .map((r) => (
                        <option key={r.id} value={r.name}>{r.name || r.number || 'Unnamed'}</option>
                      ))
                    }
                  </select>
                  <button
                    onClick={() => dispatch({ type: 'REMOVE_DOOR', buildingId: bldg.id, doorId: door.id })}
                    className="text-red-400 hover:text-red-300 p-1 transition-colors flex-shrink-0"
                    title="Remove door"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// -- Step 5: User Accounts ----------------------------------------------------

function StepUsers({ state, dispatch }: StepProps) {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold mb-1">User Accounts</h2>
          <p className="text-sm text-gray-400">Add initial users for this site. You can always add more later.</p>
        </div>
        <button
          onClick={() => dispatch({ type: 'ADD_USER' })}
          className="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          + Add User
        </button>
      </div>

      {state.users.length === 0 && (
        <div className="text-center py-12 text-gray-500">
          No users added yet. You can skip this step and add users later.
        </div>
      )}

      <div className="space-y-3">
        {state.users.map((user) => (
          <div key={user.id} className="flex items-center gap-3 bg-gray-800/50 border border-gray-700 rounded-lg p-4">
            <input
              type="text"
              value={user.name}
              onChange={(e) => dispatch({ type: 'UPDATE_USER', userId: user.id, field: 'name', value: e.target.value })}
              placeholder="Full name"
              className="flex-1 bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
            />
            <input
              type="email"
              value={user.email}
              onChange={(e) => dispatch({ type: 'UPDATE_USER', userId: user.id, field: 'email', value: e.target.value })}
              placeholder="email@school.edu"
              className="flex-1 bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
            />
            <select
              value={user.role}
              onChange={(e) => dispatch({ type: 'UPDATE_USER', userId: user.id, field: 'role', value: e.target.value })}
              className="w-44 bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
            >
              {USER_ROLES.map((r) => (
                <option key={r} value={r}>
                  {r.split('_').map((w) => w.charAt(0) + w.slice(1).toLowerCase()).join(' ')}
                </option>
              ))}
            </select>
            <button
              onClick={() => dispatch({ type: 'REMOVE_USER', userId: user.id })}
              className="text-red-400 hover:text-red-300 p-1 transition-colors flex-shrink-0"
              title="Remove user"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// -- Step 6: Integration Config -----------------------------------------------

function StepIntegrations({ state, dispatch }: StepProps) {
  const intg = state.integrations;
  const set = (field: string, value: string) => dispatch({ type: 'UPDATE_INTEGRATION', field, value });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold mb-1">Integration Configuration</h2>
        <p className="text-sm text-gray-400">
          Select which adapters to use for access control, 911 dispatch, and notifications.
          You can change these later in the site settings.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6">
        {/* Access Control */}
        <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 bg-blue-600/20 rounded-lg flex items-center justify-center">
              <svg className="w-5 h-5 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
              </svg>
            </div>
            <div>
              <h3 className="font-medium">Access Control</h3>
              <p className="text-xs text-gray-400">Controls door locks during lockdowns and daily operations</p>
            </div>
          </div>
          <select
            value={intg.accessControl}
            onChange={(e) => set('accessControl', e.target.value)}
            className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
          >
            {AC_ADAPTERS.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </div>

        {/* 911 Dispatch */}
        <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 bg-red-600/20 rounded-lg flex items-center justify-center">
              <svg className="w-5 h-5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z" />
              </svg>
            </div>
            <div>
              <h3 className="font-medium">911 Dispatch</h3>
              <p className="text-xs text-gray-400">How panic alerts reach first responders and 911 dispatch</p>
            </div>
          </div>
          <select
            value={intg.dispatch}
            onChange={(e) => set('dispatch', e.target.value)}
            className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
          >
            {DISPATCH_ADAPTERS.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </div>

        {/* Notifications */}
        <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 bg-green-600/20 rounded-lg flex items-center justify-center">
              <svg className="w-5 h-5 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
              </svg>
            </div>
            <div>
              <h3 className="font-medium">Notifications</h3>
              <p className="text-xs text-gray-400">Channel for sending alerts to staff, parents, and administrators</p>
            </div>
          </div>
          <select
            value={intg.notification}
            onChange={(e) => set('notification', e.target.value)}
            className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
          >
            {NOTIFICATION_ADAPTERS.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}

// -- Step 7: Review & Submit --------------------------------------------------

function StepReview({ state }: { state: OnboardingState }) {
  const totalRooms = state.buildings.reduce((sum, b) => sum + b.rooms.length, 0);
  const totalDoors = state.buildings.reduce((sum, b) => sum + b.doors.length, 0);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold mb-1">Review & Submit</h2>
        <p className="text-sm text-gray-400">Please review the setup information before creating the site.</p>
      </div>

      {/* Site Summary */}
      <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-5">
        <h3 className="font-medium text-blue-400 mb-3">School Information</h3>
        <div className="grid grid-cols-2 gap-y-2 text-sm">
          <span className="text-gray-400">Name:</span>
          <span>{state.site.name}</span>
          <span className="text-gray-400">Address:</span>
          <span>{state.site.address}, {state.site.city}, {state.site.state} {state.site.zip}</span>
          <span className="text-gray-400">Type:</span>
          <span>{state.site.schoolType}</span>
        </div>
      </div>

      {/* Buildings Summary */}
      <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-5">
        <h3 className="font-medium text-blue-400 mb-3">
          Buildings ({state.buildings.length}) / Rooms ({totalRooms}) / Doors ({totalDoors})
        </h3>
        <div className="space-y-3">
          {state.buildings.map((bldg) => (
            <div key={bldg.id} className="text-sm">
              <div className="font-medium">{bldg.name} ({bldg.floors} floor{bldg.floors !== 1 ? 's' : ''})</div>
              {bldg.rooms.length > 0 && (
                <div className="text-gray-400 ml-4 mt-1">
                  Rooms: {bldg.rooms.map((r) => `${r.name || r.number} (${r.type})`).join(', ')}
                </div>
              )}
              {bldg.doors.length > 0 && (
                <div className="text-gray-400 ml-4 mt-1">
                  Doors: {bldg.doors.map((d) => `${d.name} (${d.type.split('_').join(' ').toLowerCase()})`).join(', ')}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Users Summary */}
      <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-5">
        <h3 className="font-medium text-blue-400 mb-3">Users ({state.users.length})</h3>
        {state.users.length === 0 ? (
          <div className="text-sm text-gray-500">No additional users (you will be added as admin)</div>
        ) : (
          <div className="space-y-1">
            {state.users.map((u) => (
              <div key={u.id} className="text-sm flex items-center gap-3">
                <span>{u.name}</span>
                <span className="text-gray-500">{u.email}</span>
                <span className="bg-gray-700 px-2 py-0.5 rounded text-xs">{u.role}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Integrations Summary */}
      <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-5">
        <h3 className="font-medium text-blue-400 mb-3">Integrations</h3>
        <div className="grid grid-cols-2 gap-y-2 text-sm">
          <span className="text-gray-400">Access Control:</span>
          <span>{state.integrations.accessControl}</span>
          <span className="text-gray-400">911 Dispatch:</span>
          <span>{state.integrations.dispatch}</span>
          <span className="text-gray-400">Notifications:</span>
          <span>{state.integrations.notification}</span>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step Indicator
// ---------------------------------------------------------------------------

function StepIndicator({ currentStep, steps }: { currentStep: number; steps: string[] }) {
  return (
    <div className="flex items-center justify-between mb-8">
      {steps.map((label, i) => {
        const isCompleted = i < currentStep;
        const isCurrent = i === currentStep;

        return (
          <div key={label} className="flex items-center flex-1 last:flex-none">
            <div className="flex flex-col items-center">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-colors ${
                  isCompleted
                    ? 'bg-blue-600 text-white'
                    : isCurrent
                      ? 'bg-blue-600/30 text-blue-400 ring-2 ring-blue-500'
                      : 'bg-gray-700 text-gray-500'
                }`}
              >
                {isCompleted ? (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  i + 1
                )}
              </div>
              <span
                className={`text-xs mt-1.5 whitespace-nowrap ${
                  isCurrent ? 'text-blue-400 font-medium' : isCompleted ? 'text-gray-400' : 'text-gray-600'
                }`}
              >
                {label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div
                className={`flex-1 h-px mx-3 mt-[-1rem] ${
                  isCompleted ? 'bg-blue-600' : 'bg-gray-700'
                }`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function OnboardingPage() {
  const { token, user } = useAuth();
  const navigate = useNavigate();
  const [state, dispatch] = useReducer(reducer, initialState);
  const [error, setError] = useState<string | null>(null);

  // Fetch organizations for the dropdown
  const { data: organizations = [] } = useQuery({
    queryKey: ['organizations'],
    queryFn: () => apiClient.get('/api/v1/organizations'),
  });

  // Submission mutation
  const submitMutation = useMutation({
    mutationFn: async (payload: any) => {
      return apiClient.post('/api/v1/onboarding/setup', payload);
    },
    onSuccess: () => {
      navigate('/');
    },
    onError: (err: Error) => {
      setError(err.message || 'Failed to create site. Please try again.');
    },
  });

  // Guard: only SUPER_ADMIN or SITE_ADMIN should see this
  if (user && user.role !== 'SUPER_ADMIN' && user.role !== 'SITE_ADMIN') {
    return (
      <div className="p-6 flex items-center justify-center min-h-[50vh]">
        <div className="bg-gray-800 rounded-lg p-8 text-center max-w-md">
          <div className="text-red-400 text-lg font-semibold mb-2">Access Denied</div>
          <p className="text-gray-400 text-sm">Only SUPER_ADMIN or SITE_ADMIN users can set up new sites.</p>
        </div>
      </div>
    );
  }

  const currentStep = state.step;

  function goNext() {
    const validationError = validateStep(state, currentStep);
    if (validationError) {
      setError(validationError);
      return;
    }
    setError(null);
    dispatch({ type: 'SET_STEP', step: Math.min(currentStep + 1, STEPS.length - 1) });
  }

  function goPrev() {
    setError(null);
    dispatch({ type: 'SET_STEP', step: Math.max(currentStep - 1, 0) });
  }

  function handleSubmit() {
    setError(null);

    const payload = {
      site: {
        name: state.site.name.trim(),
        address: state.site.address.trim(),
        city: state.site.city.trim(),
        state: state.site.state,
        zip: state.site.zip.trim(),
        organizationId: state.site.organizationId || undefined,
        schoolType: state.site.schoolType,
      },
      buildings: state.buildings.map((b) => ({
        name: b.name.trim(),
        floors: b.floors,
        rooms: b.rooms.map((r) => ({
          name: r.name.trim(),
          number: r.number.trim(),
          floor: r.floor,
          type: r.type,
        })),
        doors: b.doors.map((d) => ({
          name: d.name.trim(),
          type: d.type,
          floor: d.floor,
          isExterior: d.type === 'MAIN_ENTRANCE' || d.type === 'EMERGENCY_EXIT',
          isEmergencyExit: d.type === 'EMERGENCY_EXIT',
          roomName: d.roomName || undefined,
        })),
      })),
      users: state.users.map((u) => ({
        name: u.name.trim(),
        email: u.email.trim().toLowerCase(),
        role: u.role,
      })),
      integrations: state.integrations,
    };

    submitMutation.mutate(payload);
  }

  return (
    <div className="p-3 sm:p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold mb-1">New Site Setup</h1>
        <p className="text-gray-400 text-sm">
          Set up a new school site with buildings, rooms, doors, and users.
        </p>
      </div>

      {/* Step Indicator */}
      <StepIndicator currentStep={currentStep} steps={STEPS} />

      {/* Error Banner */}
      {error && (
        <div className="bg-red-900/40 border border-red-700 text-red-300 rounded-lg px-4 py-3 mb-6 text-sm flex items-center gap-2">
          <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
          </svg>
          {error}
        </div>
      )}

      {/* Success Banner (after submit) */}
      {submitMutation.isSuccess && (
        <div className="bg-green-900/40 border border-green-700 text-green-300 rounded-lg px-4 py-3 mb-6 text-sm">
          Site created successfully! Redirecting to the dashboard...
        </div>
      )}

      {/* Step Content */}
      <div className="min-h-[400px]">
        {currentStep === 0 && <StepSchoolInfo state={state} dispatch={dispatch} organizations={organizations} />}
        {currentStep === 1 && <StepBuildings state={state} dispatch={dispatch} />}
        {currentStep === 2 && <StepRooms state={state} dispatch={dispatch} />}
        {currentStep === 3 && <StepDoors state={state} dispatch={dispatch} />}
        {currentStep === 4 && <StepUsers state={state} dispatch={dispatch} />}
        {currentStep === 5 && <StepIntegrations state={state} dispatch={dispatch} />}
        {currentStep === 6 && <StepReview state={state} />}
      </div>

      {/* Navigation Buttons */}
      <div className="flex items-center justify-between mt-8 pt-6 border-t border-gray-700">
        <button
          onClick={goPrev}
          disabled={currentStep === 0}
          className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-30 disabled:cursor-not-allowed bg-gray-700 hover:bg-gray-600"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Previous
        </button>

        <div className="text-sm text-gray-500">
          Step {currentStep + 1} of {STEPS.length}
        </div>

        {currentStep < STEPS.length - 1 ? (
          <button
            onClick={goNext}
            className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-colors bg-blue-600 hover:bg-blue-700"
          >
            Next
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        ) : (
          <button
            onClick={handleSubmit}
            disabled={submitMutation.isPending}
            className="flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-medium transition-colors bg-green-600 hover:bg-green-700 disabled:opacity-50"
          >
            {submitMutation.isPending ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Creating...
              </>
            ) : (
              <>
                Create Site
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
}
