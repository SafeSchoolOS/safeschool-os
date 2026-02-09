import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../hooks/useAuth';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

interface Drill {
  id: string;
  type: string;
  status: string;
  scheduledAt: string;
  startedAt?: string;
  completedAt?: string;
  evacuationTimeS?: number;
  headCount?: number;
  complianceMet?: boolean;
  notes?: string;
  _count?: { participants: number };
}

interface ComplianceReport {
  year: number;
  totalDrills: number;
  overallCompliant: boolean;
  requirements: {
    type: string;
    label: string;
    required: number;
    completed: number;
    compliant: boolean;
  }[];
}

const TYPE_LABELS: Record<string, string> = {
  LOCKDOWN: 'Lockdown',
  FIRE: 'Fire',
  EVACUATION: 'Evacuation',
  ACTIVE_THREAT: 'Active Threat',
};

const STATUS_COLORS: Record<string, string> = {
  SCHEDULED: 'bg-blue-600',
  IN_PROGRESS: 'bg-yellow-600',
  COMPLETED: 'bg-green-600',
  CANCELLED: 'bg-gray-600',
};

export function DrillsPage() {
  const { token } = useAuth();
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [filterType, setFilterType] = useState('');
  const [newDrill, setNewDrill] = useState({ type: 'LOCKDOWN', scheduledAt: '', notes: '' });

  const { data: drills = [] } = useQuery<Drill[]>({
    queryKey: ['drills', filterType],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filterType) params.set('type', filterType);
      const res = await fetch(`${API_URL}/api/v1/drills?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return res.json();
    },
  });

  const { data: compliance } = useQuery<ComplianceReport>({
    queryKey: ['drill-compliance'],
    queryFn: async () => {
      const res = await fetch(`${API_URL}/api/v1/drills/compliance/report`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async (drill: { type: string; scheduledAt: string; notes?: string }) => {
      const res = await fetch(`${API_URL}/api/v1/drills`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(drill),
      });
      if (!res.ok) throw new Error('Failed to create drill');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['drills'] });
      setShowForm(false);
      setNewDrill({ type: 'LOCKDOWN', scheduledAt: '', notes: '' });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const res = await fetch(`${API_URL}/api/v1/drills/${id}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error('Failed to update drill');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['drills'] });
      queryClient.invalidateQueries({ queryKey: ['drill-compliance'] });
    },
  });

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <header className="bg-gray-800 border-b border-gray-700 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <a href="/" className="text-gray-400 hover:text-white transition-colors">&larr; Command Center</a>
          <h1 className="text-xl font-bold">Drill Compliance</h1>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="bg-blue-600 hover:bg-blue-700 px-4 py-1.5 rounded text-sm font-medium"
        >
          Schedule Drill
        </button>
      </header>

      <div className="p-6">
        {/* Compliance Report */}
        {compliance && (
          <div className="mb-6">
            <div className="flex items-center gap-3 mb-3">
              <h2 className="text-lg font-semibold">{compliance.year} Compliance</h2>
              <span className={`px-2 py-0.5 rounded text-xs font-bold ${compliance.overallCompliant ? 'bg-green-600' : 'bg-red-600'}`}>
                {compliance.overallCompliant ? 'COMPLIANT' : 'NOT COMPLIANT'}
              </span>
            </div>
            <div className="grid grid-cols-4 gap-4">
              {compliance.requirements.map((req) => (
                <div key={req.type} className="bg-gray-800 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium">{req.label}</span>
                    <span className={`w-2 h-2 rounded-full ${req.compliant ? 'bg-green-500' : 'bg-red-500'}`} />
                  </div>
                  <div className="text-2xl font-bold">{req.completed} / {req.required}</div>
                  <div className="text-xs text-gray-400 mt-1">
                    {req.compliant ? 'Requirement met' : `Need ${req.required - req.completed} more`}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Schedule Form */}
        {showForm && (
          <div className="bg-gray-800 rounded-lg p-4 mb-6">
            <h3 className="font-semibold mb-3">Schedule New Drill</h3>
            <div className="grid grid-cols-3 gap-4">
              <select
                value={newDrill.type}
                onChange={(e) => setNewDrill({ ...newDrill, type: e.target.value })}
                className="bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm"
              >
                {Object.entries(TYPE_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
              <input
                type="datetime-local"
                value={newDrill.scheduledAt}
                onChange={(e) => setNewDrill({ ...newDrill, scheduledAt: e.target.value })}
                className="bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm"
              />
              <input
                type="text"
                placeholder="Notes (optional)"
                value={newDrill.notes}
                onChange={(e) => setNewDrill({ ...newDrill, notes: e.target.value })}
                className="bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm"
              />
            </div>
            <div className="flex gap-2 mt-3">
              <button
                onClick={() => createMutation.mutate(newDrill)}
                disabled={!newDrill.scheduledAt}
                className="bg-blue-600 hover:bg-blue-700 px-4 py-1.5 rounded text-sm disabled:opacity-50"
              >
                Schedule
              </button>
              <button
                onClick={() => setShowForm(false)}
                className="bg-gray-600 hover:bg-gray-700 px-4 py-1.5 rounded text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Filter */}
        <div className="mb-4">
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm"
          >
            <option value="">All Types</option>
            {Object.entries(TYPE_LABELS).map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
        </div>

        {/* Drills List */}
        <div className="space-y-3">
          {drills.map((drill) => (
            <div key={drill.id} className="bg-gray-800 rounded-lg p-4 flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className={`${STATUS_COLORS[drill.status]} px-2 py-0.5 rounded text-xs font-bold`}>
                    {drill.status}
                  </span>
                  <span className="font-medium">{TYPE_LABELS[drill.type] || drill.type}</span>
                </div>
                <div className="text-sm text-gray-400">
                  Scheduled: {new Date(drill.scheduledAt).toLocaleString()}
                  {drill.evacuationTimeS && ` | Evac: ${drill.evacuationTimeS}s`}
                  {drill.headCount !== undefined && ` | Head count: ${drill.headCount}`}
                  {drill._count?.participants !== undefined && ` | Participants: ${drill._count.participants}`}
                </div>
                {drill.notes && <div className="text-xs text-gray-500 mt-1">{drill.notes}</div>}
              </div>
              <div className="flex gap-2">
                {drill.status === 'SCHEDULED' && (
                  <button
                    onClick={() => updateMutation.mutate({ id: drill.id, status: 'IN_PROGRESS' })}
                    className="bg-yellow-600 hover:bg-yellow-700 px-3 py-1 rounded text-xs"
                  >
                    Start
                  </button>
                )}
                {drill.status === 'IN_PROGRESS' && (
                  <button
                    onClick={() => updateMutation.mutate({ id: drill.id, status: 'COMPLETED' })}
                    className="bg-green-600 hover:bg-green-700 px-3 py-1 rounded text-xs"
                  >
                    Complete
                  </button>
                )}
                {(drill.status === 'SCHEDULED' || drill.status === 'IN_PROGRESS') && (
                  <button
                    onClick={() => updateMutation.mutate({ id: drill.id, status: 'CANCELLED' })}
                    className="bg-gray-600 hover:bg-gray-700 px-3 py-1 rounded text-xs"
                  >
                    Cancel
                  </button>
                )}
              </div>
            </div>
          ))}
          {drills.length === 0 && (
            <div className="text-center text-gray-500 py-8">No drills found. Schedule one to get started.</div>
          )}
        </div>
      </div>
    </div>
  );
}
