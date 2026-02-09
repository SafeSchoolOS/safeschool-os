import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../hooks/useAuth';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

interface SocialMediaAlert {
  id: string;
  source: string;
  platform: string;
  contentType: string;
  flaggedContent?: string;
  category: string;
  severity: string;
  status: string;
  studentName?: string;
  studentGrade?: string;
  reviewedAt?: string;
  actionTaken?: string;
  createdAt: string;
}

const SEVERITY_COLORS: Record<string, string> = {
  LOW: 'bg-blue-600',
  MEDIUM: 'bg-yellow-600',
  HIGH: 'bg-orange-600',
  CRITICAL: 'bg-red-600',
};

const STATUS_LABELS: Record<string, string> = {
  NEW: 'New',
  REVIEWING: 'Reviewing',
  CONFIRMED: 'Confirmed',
  FALSE_POSITIVE: 'False Positive',
  ESCALATED: 'Escalated',
  RESOLVED: 'Resolved',
};

export function SocialMediaPage() {
  const { token } = useAuth();
  const queryClient = useQueryClient();
  const [filterStatus, setFilterStatus] = useState('');
  const [filterSeverity, setFilterSeverity] = useState('');

  const { data: alerts = [] } = useQuery<SocialMediaAlert[]>({
    queryKey: ['social-media-alerts', filterStatus, filterSeverity],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filterStatus) params.set('status', filterStatus);
      if (filterSeverity) params.set('severity', filterSeverity);
      const res = await fetch(`${API_URL}/api/v1/social-media/alerts?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return res.json();
    },
  });

  const { data: dashboard } = useQuery({
    queryKey: ['social-media-dashboard'],
    queryFn: async () => {
      const res = await fetch(`${API_URL}/api/v1/social-media/dashboard`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return res.json();
    },
  });

  const reviewMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const res = await fetch(`${API_URL}/api/v1/social-media/alerts/${id}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error('Failed to update');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['social-media-alerts'] });
      queryClient.invalidateQueries({ queryKey: ['social-media-dashboard'] });
    },
  });

  return (
    <div className="p-6">
        {/* Dashboard Stats */}
        {dashboard && (
          <div className="grid grid-cols-4 gap-4 mb-6">
            <div className="bg-gray-800 rounded-lg p-4">
              <div className="text-2xl font-bold">{dashboard.total}</div>
              <div className="text-gray-400 text-sm">Total Alerts</div>
            </div>
            <div className="bg-gray-800 rounded-lg p-4">
              <div className="text-2xl font-bold text-yellow-400">{dashboard.unreviewed}</div>
              <div className="text-gray-400 text-sm">Unreviewed</div>
            </div>
            <div className="bg-gray-800 rounded-lg p-4">
              <div className="text-2xl font-bold text-orange-400">{dashboard.bySeverity?.HIGH || 0}</div>
              <div className="text-gray-400 text-sm">High Severity</div>
            </div>
            <div className="bg-gray-800 rounded-lg p-4">
              <div className="text-2xl font-bold text-red-400">{dashboard.bySeverity?.CRITICAL || 0}</div>
              <div className="text-gray-400 text-sm">Critical</div>
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="mb-4 flex gap-2">
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm"
          >
            <option value="">All Statuses</option>
            {Object.entries(STATUS_LABELS).map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
          <select
            value={filterSeverity}
            onChange={(e) => setFilterSeverity(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm"
          >
            <option value="">All Severities</option>
            <option value="CRITICAL">Critical</option>
            <option value="HIGH">High</option>
            <option value="MEDIUM">Medium</option>
            <option value="LOW">Low</option>
          </select>
        </div>

        {/* Alerts List */}
        <div className="space-y-3">
          {alerts.map((alert) => (
            <div key={alert.id} className="bg-gray-800 rounded-lg p-4">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`${SEVERITY_COLORS[alert.severity]} px-2 py-0.5 rounded text-xs font-bold`}>
                      {alert.severity}
                    </span>
                    <span className="text-gray-400 text-sm">{alert.source} / {alert.platform}</span>
                    {alert.studentName && <span className="font-medium">{alert.studentName}</span>}
                    {alert.studentGrade && <span className="text-gray-400 text-sm">Grade {alert.studentGrade}</span>}
                  </div>
                  <div className="text-sm text-gray-300">
                    {alert.category.replace(/_/g, ' ')}
                    {alert.flaggedContent && ` - "${alert.flaggedContent.slice(0, 100)}${alert.flaggedContent.length > 100 ? '...' : ''}"`}
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    {STATUS_LABELS[alert.status] || alert.status} | {new Date(alert.createdAt).toLocaleString()}
                  </div>
                </div>
                {alert.status === 'NEW' && (
                  <div className="flex gap-2">
                    <button
                      onClick={() => reviewMutation.mutate({ id: alert.id, status: 'CONFIRMED' })}
                      className="bg-orange-600 hover:bg-orange-700 px-3 py-1 rounded text-xs"
                    >
                      Confirm
                    </button>
                    <button
                      onClick={() => reviewMutation.mutate({ id: alert.id, status: 'FALSE_POSITIVE' })}
                      className="bg-gray-600 hover:bg-gray-700 px-3 py-1 rounded text-xs"
                    >
                      Dismiss
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
          {alerts.length === 0 && (
            <div className="text-center text-gray-500 py-8">No social media alerts found.</div>
          )}
        </div>
    </div>
  );
}
