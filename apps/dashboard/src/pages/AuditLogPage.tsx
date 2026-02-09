import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../hooks/useAuth';
import { exportToCsv, formatDate } from '../utils/export';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

interface AuditEntry {
  id: string;
  action: string;
  entity: string;
  entityId?: string;
  details?: Record<string, any>;
  ipAddress?: string;
  createdAt: string;
  user?: { id: string; name: string; email: string; role: string };
}

const ACTION_COLORS: Record<string, string> = {
  LOCKDOWN: 'text-red-400',
  ALERT: 'text-orange-400',
  DRILL: 'text-blue-400',
  REUNIFICATION: 'text-purple-400',
  LOGIN: 'text-green-400',
};

function getActionColor(action: string): string {
  for (const [key, color] of Object.entries(ACTION_COLORS)) {
    if (action.includes(key)) return color;
  }
  return 'text-gray-300';
}

export function AuditLogPage() {
  const { token } = useAuth();
  const [filterAction, setFilterAction] = useState('');
  const [filterEntity, setFilterEntity] = useState('');
  const [page, setPage] = useState(0);
  const pageSize = 25;

  const { data, isLoading } = useQuery<{ entries: AuditEntry[]; total: number }>({
    queryKey: ['audit-log', filterAction, filterEntity, page],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filterAction) params.set('action', filterAction);
      if (filterEntity) params.set('entity', filterEntity);
      params.set('limit', String(pageSize));
      params.set('offset', String(page * pageSize));
      const res = await fetch(`${API_URL}/api/v1/audit-log?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return res.json();
    },
  });

  const { data: entities = [] } = useQuery<string[]>({
    queryKey: ['audit-log-entities'],
    queryFn: async () => {
      const res = await fetch(`${API_URL}/api/v1/audit-log/entities`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return res.json();
    },
  });

  const { data: actions = [] } = useQuery<string[]>({
    queryKey: ['audit-log-actions'],
    queryFn: async () => {
      const res = await fetch(`${API_URL}/api/v1/audit-log/actions`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return res.json();
    },
  });

  const entries = data?.entries || [];
  const total = data?.total || 0;
  const totalPages = Math.ceil(total / pageSize);

  const handleExportCsv = () => {
    if (entries.length === 0) return;
    const timestamp = new Date().toISOString().slice(0, 10);
    const headers = ['Timestamp', 'Action', 'Entity', 'Entity ID', 'User', 'Role', 'Details'];
    const rows = entries.map((entry) => [
      formatDate(entry.createdAt),
      entry.action,
      entry.entity,
      entry.entityId || '',
      entry.user?.name || 'System',
      entry.user?.role || '',
      entry.details ? JSON.stringify(entry.details) : '',
    ]);
    exportToCsv(`audit_log_${timestamp}`, headers, rows);
  };

  return (
    <div className="p-6">
      {/* Filters */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex gap-2">
          <select
            value={filterEntity}
            onChange={(e) => { setFilterEntity(e.target.value); setPage(0); }}
            className="bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm"
          >
            <option value="">All Entities</option>
            {entities.map((e) => (
              <option key={e} value={e}>{e}</option>
            ))}
          </select>
          <select
            value={filterAction}
            onChange={(e) => { setFilterAction(e.target.value); setPage(0); }}
            className="bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm"
          >
            <option value="">All Actions</option>
            {actions.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleExportCsv}
            disabled={entries.length === 0}
            className="px-4 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-sm font-medium transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Export CSV
          </button>
          <span className="text-sm text-gray-400">{total} entries</span>
        </div>
      </div>

      {/* Loading State */}
      {isLoading && (
        <div className="flex justify-center py-12">
          <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {/* Log Table */}
      {!isLoading && (
        <div className="bg-gray-800 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700 text-gray-400">
                <th className="text-left px-4 py-2">Timestamp</th>
                <th className="text-left px-4 py-2">Action</th>
                <th className="text-left px-4 py-2">Entity</th>
                <th className="text-left px-4 py-2">User</th>
                <th className="text-left px-4 py-2">Details</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id} className="border-b border-gray-700/50 hover:bg-gray-700/30">
                  <td className="px-4 py-2 text-gray-400 whitespace-nowrap">
                    {new Date(entry.createdAt).toLocaleString()}
                  </td>
                  <td className={`px-4 py-2 font-medium ${getActionColor(entry.action)}`}>
                    {entry.action}
                  </td>
                  <td className="px-4 py-2">
                    {entry.entity}
                    {entry.entityId && (
                      <span className="text-gray-500 text-xs ml-1">#{entry.entityId.slice(0, 8)}</span>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    {entry.user ? (
                      <span>{entry.user.name} <span className="text-gray-500 text-xs">({entry.user.role})</span></span>
                    ) : (
                      <span className="text-gray-500">System</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-gray-400 text-xs max-w-xs truncate">
                    {entry.details ? JSON.stringify(entry.details) : '-'}
                  </td>
                </tr>
              ))}
              {entries.length === 0 && (
                <tr>
                  <td colSpan={5} className="text-center text-gray-500 py-8">No audit log entries found.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            className="bg-gray-800 px-3 py-1.5 rounded text-sm disabled:opacity-50"
          >
            Previous
          </button>
          <span className="text-sm text-gray-400">
            Page {page + 1} of {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
            className="bg-gray-800 px-3 py-1.5 rounded text-sm disabled:opacity-50"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
