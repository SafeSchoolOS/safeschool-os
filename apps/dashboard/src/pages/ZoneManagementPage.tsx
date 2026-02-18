import { useState } from 'react';
import {
  useZones,
  useCreateZone,
  useUpdateZone,
  useDeleteZone,
  useZoneLockdown,
  type AccessZone,
  type AccessWindow,
} from '../api/zones';

const ZONE_TYPES = [
  { value: 'PUBLIC', label: 'Public', color: 'bg-green-600/20 text-green-400' },
  { value: 'CLASSROOM', label: 'Classroom', color: 'bg-blue-600/20 text-blue-400' },
  { value: 'ADMINISTRATIVE', label: 'Administrative', color: 'bg-indigo-600/20 text-indigo-400' },
  { value: 'SERVICE', label: 'Service', color: 'bg-orange-600/20 text-orange-400', desc: 'Cafeteria, loading dock, kitchen' },
  { value: 'UTILITY', label: 'Utility', color: 'bg-yellow-600/20 text-yellow-400', desc: 'Mechanical, electrical, boiler' },
  { value: 'RESTRICTED', label: 'Restricted', color: 'bg-red-600/20 text-red-400', desc: 'Maintenance, hazmat, storage' },
  { value: 'SECURE', label: 'Secure', color: 'bg-purple-600/20 text-purple-400', desc: 'Admin vault, counselor' },
];

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function getZoneTypeStyle(type: string): string {
  return ZONE_TYPES.find((t) => t.value === type)?.color || 'bg-gray-600/20 text-gray-400';
}

export function ZoneManagementPage() {
  const { data: zones, isLoading } = useZones();
  const createMutation = useCreateZone();
  const updateMutation = useUpdateZone();
  const deleteMutation = useDeleteZone();
  const lockdownMutation = useZoneLockdown();

  const [showCreate, setShowCreate] = useState(false);
  const [editZone, setEditZone] = useState<AccessZone | null>(null);
  const [form, setForm] = useState({
    name: '',
    description: '',
    type: 'PUBLIC',
    isRestrictedArea: false,
    requiresApproval: false,
    accessSchedule: [] as AccessWindow[],
  });

  const resetForm = () => {
    setForm({ name: '', description: '', type: 'PUBLIC', isRestrictedArea: false, requiresApproval: false, accessSchedule: [] });
    setShowCreate(false);
    setEditZone(null);
  };

  const openEdit = (z: AccessZone) => {
    setEditZone(z);
    setForm({
      name: z.name,
      description: z.description || '',
      type: z.type,
      isRestrictedArea: z.isRestrictedArea,
      requiresApproval: z.requiresApproval,
      accessSchedule: z.accessSchedule || [],
    });
    setShowCreate(true);
  };

  const handleSave = () => {
    if (!form.name.trim()) return;
    if (editZone) {
      updateMutation.mutate({ id: editZone.id, ...form }, { onSuccess: resetForm });
    } else {
      createMutation.mutate(form, { onSuccess: resetForm });
    }
  };

  const handleDelete = (z: AccessZone) => {
    if (!confirm(`Delete zone "${z.name}"? This will remove all door assignments.`)) return;
    deleteMutation.mutate(z.id);
  };

  const handleLockdown = (z: AccessZone) => {
    if (!confirm(`Initiate zone lockdown for "${z.name}"? All assigned doors will be locked.`)) return;
    lockdownMutation.mutate({ zoneId: z.id });
  };

  const addScheduleWindow = () => {
    setForm((f) => ({
      ...f,
      accessSchedule: [...f.accessSchedule, { days: [1, 2, 3, 4, 5], startTime: '07:00', endTime: '17:00' }],
    }));
  };

  const removeScheduleWindow = (idx: number) => {
    setForm((f) => ({ ...f, accessSchedule: f.accessSchedule.filter((_, i) => i !== idx) }));
  };

  const updateScheduleWindow = (idx: number, field: string, value: any) => {
    setForm((f) => ({
      ...f,
      accessSchedule: f.accessSchedule.map((w, i) => i === idx ? { ...w, [field]: value } : w),
    }));
  };

  const toggleDay = (idx: number, day: number) => {
    setForm((f) => ({
      ...f,
      accessSchedule: f.accessSchedule.map((w, i) => {
        if (i !== idx) return w;
        return { ...w, days: w.days.includes(day) ? w.days.filter((d) => d !== day) : [...w.days, day].sort() };
      }),
    }));
  };

  // Stats
  const restrictedCount = zones?.filter((z) => z.isRestrictedArea).length || 0;
  const serviceCount = zones?.filter((z) => z.type === 'SERVICE' || z.type === 'UTILITY').length || 0;

  return (
    <div className="p-4 sm:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-bold dark:text-white text-gray-900">Zone Management</h2>
          <p className="text-sm dark:text-gray-400 text-gray-500 mt-1">
            Manage access zones — loading docks, cafeterias, maintenance areas, restricted spaces
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-4 dark:bg-gray-800 bg-white border dark:border-gray-700 border-gray-200 rounded-lg px-4 py-2 text-sm">
            <span><span className="font-bold dark:text-white text-gray-900">{zones?.length || 0}</span> <span className="dark:text-gray-400 text-gray-500">zones</span></span>
            <span><span className="font-bold text-red-400">{restrictedCount}</span> <span className="dark:text-gray-400 text-gray-500">restricted</span></span>
            <span><span className="font-bold text-orange-400">{serviceCount}</span> <span className="dark:text-gray-400 text-gray-500">service</span></span>
          </div>
          <button
            onClick={() => { resetForm(); setShowCreate(true); }}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
          >
            Create Zone
          </button>
        </div>
      </div>

      {lockdownMutation.isSuccess && (
        <div className="dark:bg-red-900/20 bg-red-50 border dark:border-red-700 border-red-200 rounded-lg p-3 text-sm dark:text-red-400 text-red-700">
          Zone lockdown initiated successfully.
        </div>
      )}

      {/* Create/Edit Form */}
      {showCreate && (
        <div className="dark:bg-gray-800 bg-white border dark:border-gray-700 border-gray-200 rounded-lg p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold dark:text-gray-300 text-gray-700">
              {editZone ? `Edit Zone: ${editZone.name}` : 'Create New Zone'}
            </h3>
            <button onClick={resetForm} className="text-sm dark:text-gray-400 text-gray-500 hover:underline">Cancel</button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm dark:text-gray-400 text-gray-500 mb-1">Name</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g., Cafeteria Loading Dock"
                className="w-full px-3 py-2 rounded-lg border dark:border-gray-600 border-gray-300 dark:bg-gray-700 bg-gray-50 dark:text-white text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm dark:text-gray-400 text-gray-500 mb-1">Type</label>
              <select
                value={form.type}
                onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border dark:border-gray-600 border-gray-300 dark:bg-gray-700 bg-gray-50 dark:text-white text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {ZONE_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}{t.desc ? ` — ${t.desc}` : ''}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm dark:text-gray-400 text-gray-500 mb-1">Description</label>
            <input
              type="text"
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="Optional description"
              className="w-full px-3 py-2 rounded-lg border dark:border-gray-600 border-gray-300 dark:bg-gray-700 bg-gray-50 dark:text-white text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="flex items-center gap-6">
            <label className="flex items-center gap-2 text-sm dark:text-gray-300 text-gray-700 cursor-pointer">
              <input
                type="checkbox"
                checked={form.isRestrictedArea}
                onChange={(e) => setForm((f) => ({ ...f, isRestrictedArea: e.target.checked }))}
                className="rounded"
              />
              Restricted Area
            </label>
            <label className="flex items-center gap-2 text-sm dark:text-gray-300 text-gray-700 cursor-pointer">
              <input
                type="checkbox"
                checked={form.requiresApproval}
                onChange={(e) => setForm((f) => ({ ...f, requiresApproval: e.target.checked }))}
                className="rounded"
              />
              Requires Approval for Access
            </label>
          </div>

          {/* Access Schedule */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm dark:text-gray-400 text-gray-500">Access Schedule (leave empty for 24/7)</label>
              <button onClick={addScheduleWindow} className="text-sm text-blue-400 hover:underline">+ Add Window</button>
            </div>
            {form.accessSchedule.map((window, idx) => (
              <div key={idx} className="dark:bg-gray-700/50 bg-gray-50 rounded-lg p-3 mb-2">
                <div className="flex items-center gap-4 mb-2">
                  <div className="flex gap-1">
                    {DAY_NAMES.map((name, dayIdx) => (
                      <button
                        key={dayIdx}
                        onClick={() => toggleDay(idx, dayIdx)}
                        className={`w-8 h-8 rounded text-xs font-medium transition-colors ${
                          window.days.includes(dayIdx)
                            ? 'bg-blue-600 text-white'
                            : 'dark:bg-gray-600 bg-gray-200 dark:text-gray-400 text-gray-500'
                        }`}
                      >
                        {name}
                      </button>
                    ))}
                  </div>
                  <input
                    type="time"
                    value={window.startTime}
                    onChange={(e) => updateScheduleWindow(idx, 'startTime', e.target.value)}
                    className="px-2 py-1 rounded border dark:border-gray-600 border-gray-300 dark:bg-gray-700 bg-white dark:text-white text-gray-900 text-sm"
                  />
                  <span className="dark:text-gray-400 text-gray-500">to</span>
                  <input
                    type="time"
                    value={window.endTime}
                    onChange={(e) => updateScheduleWindow(idx, 'endTime', e.target.value)}
                    className="px-2 py-1 rounded border dark:border-gray-600 border-gray-300 dark:bg-gray-700 bg-white dark:text-white text-gray-900 text-sm"
                  />
                  <button onClick={() => removeScheduleWindow(idx)} className="text-red-400 hover:text-red-300 text-sm">Remove</button>
                </div>
              </div>
            ))}
          </div>

          <div className="flex justify-end gap-3">
            <button onClick={resetForm} className="px-4 py-2 dark:bg-gray-700 bg-gray-100 dark:text-gray-300 text-gray-700 rounded-lg text-sm hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors">
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={!form.name.trim() || createMutation.isPending || updateMutation.isPending}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {(createMutation.isPending || updateMutation.isPending) ? 'Saving...' : editZone ? 'Update Zone' : 'Create Zone'}
            </button>
          </div>
        </div>
      )}

      {/* Zone Cards */}
      {isLoading ? (
        <div className="dark:bg-gray-800 bg-white border dark:border-gray-700 border-gray-200 rounded-lg p-16 text-center dark:text-gray-400 text-gray-500">
          Loading zones...
        </div>
      ) : !zones?.length ? (
        <div className="dark:bg-gray-800 bg-white border dark:border-gray-700 border-gray-200 rounded-lg p-16 text-center dark:text-gray-400 text-gray-500">
          No zones configured yet. Create zones to manage access to loading docks, maintenance areas, and restricted spaces.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {zones.map((z) => (
            <div key={z.id} className="dark:bg-gray-800 bg-white border dark:border-gray-700 border-gray-200 rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2 min-w-0">
                  <h4 className="font-medium dark:text-white text-gray-900 truncate">{z.name}</h4>
                  {z.isRestrictedArea && (
                    <span className="flex-shrink-0 w-2 h-2 bg-red-500 rounded-full" title="Restricted" />
                  )}
                </div>
                <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${getZoneTypeStyle(z.type)}`}>
                  {z.type}
                </span>
              </div>

              {z.description && (
                <p className="text-sm dark:text-gray-400 text-gray-500 mb-3">{z.description}</p>
              )}

              <div className="space-y-1.5 text-sm mb-3">
                <div className="flex justify-between">
                  <span className="dark:text-gray-400 text-gray-500">Doors</span>
                  <span className="dark:text-gray-200 text-gray-800">{z._count.doorAssignments}</span>
                </div>
                <div className="flex justify-between">
                  <span className="dark:text-gray-400 text-gray-500">Credentials</span>
                  <span className="dark:text-gray-200 text-gray-800">{z._count.credentials}</span>
                </div>
                {z.requiresApproval && (
                  <div className="flex items-center gap-1 text-yellow-400 text-xs">
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01" /></svg>
                    Requires approval
                  </div>
                )}
                {z.accessSchedule && (z.accessSchedule as AccessWindow[]).length > 0 && (
                  <div className="text-xs dark:text-gray-500 text-gray-400">
                    Schedule: {(z.accessSchedule as AccessWindow[]).map((w) =>
                      `${w.days.map((d) => DAY_NAMES[d]).join(',')} ${w.startTime}-${w.endTime}`
                    ).join('; ')}
                  </div>
                )}
              </div>

              {/* Door List */}
              {z.doorAssignments.length > 0 && (
                <div className="mb-3">
                  <div className="flex flex-wrap gap-1">
                    {z.doorAssignments.slice(0, 5).map((da) => (
                      <span key={da.door.id} className="inline-block px-2 py-0.5 text-xs rounded dark:bg-gray-700 bg-gray-100 dark:text-gray-300 text-gray-600">
                        {da.door.name}
                      </span>
                    ))}
                    {z.doorAssignments.length > 5 && (
                      <span className="inline-block px-2 py-0.5 text-xs rounded dark:bg-gray-700 bg-gray-100 dark:text-gray-400 text-gray-500">
                        +{z.doorAssignments.length - 5} more
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="flex items-center gap-2 pt-2 border-t dark:border-gray-700 border-gray-200">
                <button
                  onClick={() => openEdit(z)}
                  className="text-sm text-blue-400 hover:text-blue-300 transition-colors"
                >
                  Edit
                </button>
                {z._count.doorAssignments > 0 && (
                  <button
                    onClick={() => handleLockdown(z)}
                    disabled={lockdownMutation.isPending}
                    className="text-sm text-red-400 hover:text-red-300 transition-colors disabled:opacity-50"
                  >
                    Lockdown
                  </button>
                )}
                <button
                  onClick={() => handleDelete(z)}
                  disabled={deleteMutation.isPending}
                  className="text-sm text-gray-400 hover:text-red-400 transition-colors ml-auto disabled:opacity-50"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
