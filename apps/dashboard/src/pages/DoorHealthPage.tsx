import { useState } from 'react';
import { useDoorHealthSummary, useWorkOrders, useCreateWorkOrder, useCompleteWorkOrder } from '../api/doorHealth';

const SEVERITY_COLORS: Record<string, string> = {
  HEALTHY: 'bg-green-500/20 text-green-400',
  WARNING: 'bg-yellow-500/20 text-yellow-400',
  CRITICAL: 'bg-red-500/20 text-red-400',
};

const PRIORITY_COLORS: Record<string, string> = {
  LOW_WO: 'bg-gray-500/20 text-gray-400',
  MEDIUM_WO: 'bg-blue-500/20 text-blue-400',
  HIGH_WO: 'bg-orange-500/20 text-orange-400',
  URGENT_WO: 'bg-red-500/20 text-red-400',
};

export function DoorHealthPage() {
  const [showWoForm, setShowWoForm] = useState(false);
  const [woForm, setWoForm] = useState({ title: '', description: '', priority: 'MEDIUM_WO' });
  const { data: summary, isLoading: summaryLoading } = useDoorHealthSummary();
  const { data: workOrders } = useWorkOrders();
  const createWo = useCreateWorkOrder();
  const completeWo = useCompleteWorkOrder();

  const handleCreateWo = async (e: React.FormEvent) => {
    e.preventDefault();
    await createWo.mutateAsync(woForm);
    setWoForm({ title: '', description: '', priority: 'MEDIUM_WO' });
    setShowWoForm(false);
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h2 className="text-xl font-bold">Door Health Analytics</h2>
        <p className="text-sm dark:text-gray-400 text-gray-500">Monitor door status and manage work orders</p>
      </div>

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="dark:bg-gray-800 bg-white rounded-lg p-4 border dark:border-gray-700 border-gray-200">
            <div className="text-2xl font-bold">{summary.totalDoors}</div>
            <div className="text-sm dark:text-gray-400 text-gray-500">Total Doors</div>
          </div>
          <div className="dark:bg-gray-800 bg-white rounded-lg p-4 border dark:border-gray-700 border-gray-200">
            <div className="text-2xl font-bold text-yellow-400">{summary.doorsWithIssues}</div>
            <div className="text-sm dark:text-gray-400 text-gray-500">Doors with Issues</div>
          </div>
          <div className="dark:bg-gray-800 bg-white rounded-lg p-4 border dark:border-gray-700 border-gray-200">
            <div className="text-2xl font-bold text-orange-400">{summary.openWorkOrders}</div>
            <div className="text-sm dark:text-gray-400 text-gray-500">Open Work Orders</div>
          </div>
        </div>
      )}

      {/* Door Status Grid */}
      <div className="dark:bg-gray-800 bg-white rounded-lg border dark:border-gray-700 border-gray-200 p-4">
        <h3 className="font-semibold mb-3">Door Status</h3>
        {summaryLoading ? (
          <div className="text-center py-8 dark:text-gray-400 text-gray-500">Loading...</div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-2">
            {(summary?.doors || []).map((door: any) => (
              <div key={door.id} className={`rounded-lg p-3 text-center text-xs border dark:border-gray-600 border-gray-200 ${SEVERITY_COLORS[door.health] || 'bg-green-500/10'}`}>
                <div className="font-medium truncate">{door.name}</div>
                <div className="mt-1 opacity-75">{door.status}</div>
                {door.activeEvents.length > 0 && (
                  <div className="mt-1 text-[10px]">{door.activeEvents.length} issue(s)</div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Work Orders */}
      <div className="dark:bg-gray-800 bg-white rounded-lg border dark:border-gray-700 border-gray-200">
        <div className="flex items-center justify-between px-4 py-3 border-b dark:border-gray-700 border-gray-200">
          <h3 className="font-semibold">Work Orders</h3>
          <button onClick={() => setShowWoForm(!showWoForm)} className="px-3 py-1.5 bg-blue-600 text-white rounded text-xs hover:bg-blue-700">
            {showWoForm ? 'Cancel' : 'New Work Order'}
          </button>
        </div>

        {showWoForm && (
          <form onSubmit={handleCreateWo} className="p-4 border-b dark:border-gray-700 border-gray-200 space-y-3">
            <input value={woForm.title} onChange={e => setWoForm(f => ({ ...f, title: e.target.value }))} placeholder="Title" required className="w-full px-3 py-2 rounded dark:bg-gray-700 bg-gray-100 border dark:border-gray-600 border-gray-300 text-sm" />
            <textarea value={woForm.description} onChange={e => setWoForm(f => ({ ...f, description: e.target.value }))} placeholder="Description" rows={2} className="w-full px-3 py-2 rounded dark:bg-gray-700 bg-gray-100 border dark:border-gray-600 border-gray-300 text-sm" />
            <div className="flex gap-2">
              <select value={woForm.priority} onChange={e => setWoForm(f => ({ ...f, priority: e.target.value }))} className="px-3 py-2 rounded dark:bg-gray-700 bg-gray-100 border dark:border-gray-600 border-gray-300 text-sm">
                <option value="LOW_WO">Low</option>
                <option value="MEDIUM_WO">Medium</option>
                <option value="HIGH_WO">High</option>
                <option value="URGENT_WO">Urgent</option>
              </select>
              <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded text-sm">Create</button>
            </div>
          </form>
        )}

        <div className="divide-y dark:divide-gray-700 divide-gray-200">
          {(workOrders || []).map((wo: any) => (
            <div key={wo.id} className="px-4 py-3 flex items-center justify-between">
              <div>
                <div className="font-medium text-sm">{wo.title}</div>
                <div className="text-xs dark:text-gray-400 text-gray-500 mt-0.5">
                  {wo.door?.name && `Door: ${wo.door.name} · `}
                  {new Date(wo.createdAt).toLocaleDateString()}
                  {wo.assignedTo && ` · Assigned: ${wo.assignedTo}`}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className={`px-2 py-0.5 rounded text-xs ${PRIORITY_COLORS[wo.priority] || ''}`}>
                  {wo.priority.replace('_WO', '')}
                </span>
                <span className={`px-2 py-0.5 rounded text-xs ${wo.status === 'OPEN' ? 'bg-blue-500/20 text-blue-400' : wo.status === 'COMPLETED_WO' ? 'bg-green-500/20 text-green-400' : 'bg-gray-500/20 text-gray-400'}`}>
                  {wo.status.replace('_WO', '')}
                </span>
                {wo.status === 'OPEN' && (
                  <button onClick={() => completeWo.mutate(wo.id)} className="text-green-400 hover:text-green-300 text-xs ml-2">Complete</button>
                )}
              </div>
            </div>
          ))}
          {(!workOrders || workOrders.length === 0) && (
            <div className="px-4 py-8 text-center dark:text-gray-500 text-gray-400 text-sm">No work orders</div>
          )}
        </div>
      </div>
    </div>
  );
}
