import { useState } from 'react';
import { usePanicDevices, useUnassignedStaff, useAssignDevice, useUnassignDevice } from '../api/panicDevices';

function detectVendor(badgeId: string): string {
  if (badgeId.toUpperCase().startsWith('CX-')) return 'Centegix';
  if (badgeId.toUpperCase().startsWith('RV-')) return 'Rave';
  return 'Unknown';
}

export function PanicDevicesPage() {
  const { data: devices, isLoading } = usePanicDevices();
  const { data: unassignedStaff } = useUnassignedStaff();
  const assignMutation = useAssignDevice();
  const unassignMutation = useUnassignDevice();

  const [newBadgeId, setNewBadgeId] = useState('');
  const [selectedUserId, setSelectedUserId] = useState('');

  const handleAssign = () => {
    if (!newBadgeId.trim() || !selectedUserId) return;
    assignMutation.mutate(
      { badgeId: newBadgeId.trim(), userId: selectedUserId },
      {
        onSuccess: () => {
          setNewBadgeId('');
          setSelectedUserId('');
        },
      },
    );
  };

  const handleUnassign = (badgeId: string) => {
    if (!confirm(`Unassign badge ${badgeId}?`)) return;
    unassignMutation.mutate(badgeId);
  };

  return (
    <div className="p-4 sm:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold dark:text-white text-gray-900">Panic Devices</h2>
          <p className="text-sm dark:text-gray-400 text-gray-500 mt-1">
            Manage wearable panic button assignments for staff
          </p>
        </div>
        <div className="dark:bg-gray-800 bg-white border dark:border-gray-700 border-gray-200 rounded-lg px-4 py-2">
          <span className="text-2xl font-bold dark:text-white text-gray-900">{devices?.length || 0}</span>
          <span className="text-sm dark:text-gray-400 text-gray-500 ml-2">assigned</span>
        </div>
      </div>

      {/* Assign New Device */}
      <div className="dark:bg-gray-800 bg-white border dark:border-gray-700 border-gray-200 rounded-lg p-4">
        <h3 className="text-sm font-semibold dark:text-gray-300 text-gray-700 mb-3">Assign New Device</h3>
        <div className="flex flex-col sm:flex-row gap-3">
          <input
            type="text"
            placeholder="Badge ID (e.g., CX-BADGE-001)"
            value={newBadgeId}
            onChange={(e) => setNewBadgeId(e.target.value)}
            className="flex-1 px-3 py-2 rounded-lg border dark:border-gray-600 border-gray-300 dark:bg-gray-700 bg-gray-50 dark:text-white text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <select
            value={selectedUserId}
            onChange={(e) => setSelectedUserId(e.target.value)}
            className="flex-1 px-3 py-2 rounded-lg border dark:border-gray-600 border-gray-300 dark:bg-gray-700 bg-gray-50 dark:text-white text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">Select staff member...</option>
            {unassignedStaff?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.role})
              </option>
            ))}
          </select>
          <button
            onClick={handleAssign}
            disabled={!newBadgeId.trim() || !selectedUserId || assignMutation.isPending}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
          >
            {assignMutation.isPending ? 'Assigning...' : 'Assign'}
          </button>
        </div>
        {assignMutation.isError && (
          <p className="text-red-400 text-sm mt-2">{(assignMutation.error as Error).message}</p>
        )}
      </div>

      {/* Assigned Devices Table */}
      <div className="dark:bg-gray-800 bg-white border dark:border-gray-700 border-gray-200 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="dark:bg-gray-700/50 bg-gray-50 dark:text-gray-300 text-gray-600">
                <th className="text-left px-4 py-3 font-medium">Badge ID</th>
                <th className="text-left px-4 py-3 font-medium">Vendor</th>
                <th className="text-left px-4 py-3 font-medium">User</th>
                <th className="text-left px-4 py-3 font-medium">Role</th>
                <th className="text-left px-4 py-3 font-medium">Site</th>
                <th className="text-right px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y dark:divide-gray-700 divide-gray-200">
              {isLoading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center dark:text-gray-400 text-gray-500">
                    Loading...
                  </td>
                </tr>
              ) : !devices?.length ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center dark:text-gray-400 text-gray-500">
                    No panic devices assigned yet. Use the form above to assign badges to staff.
                  </td>
                </tr>
              ) : (
                devices.map((d) => (
                  <tr key={d.id} className="dark:hover:bg-gray-700/30 hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="inline-block w-2 h-2 bg-green-500 rounded-full" />
                        <span className="font-mono dark:text-white text-gray-900">{d.wearableDeviceId}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 dark:text-gray-300 text-gray-700">
                      {detectVendor(d.wearableDeviceId)}
                    </td>
                    <td className="px-4 py-3 dark:text-white text-gray-900">{d.name}</td>
                    <td className="px-4 py-3">
                      <span className="inline-block px-2 py-0.5 rounded text-xs font-medium dark:bg-gray-700 bg-gray-100 dark:text-gray-300 text-gray-600">
                        {d.role}
                      </span>
                    </td>
                    <td className="px-4 py-3 dark:text-gray-300 text-gray-700">
                      {d.sites.map((s) => s.name).join(', ') || '-'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => handleUnassign(d.wearableDeviceId)}
                        disabled={unassignMutation.isPending}
                        className="text-red-400 hover:text-red-300 text-sm transition-colors disabled:opacity-50"
                      >
                        Unassign
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
