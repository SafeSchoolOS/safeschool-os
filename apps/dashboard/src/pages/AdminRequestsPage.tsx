import { useState } from 'react';
import { useDemoRequests, useDemoRequestStats, useReviewDemoRequest } from '../api/admin';

const STATUS_TABS = ['ALL', 'PENDING', 'APPROVED', 'REJECTED'] as const;
const STATUS_COLORS: Record<string, string> = {
  PENDING: 'bg-yellow-600',
  APPROVED: 'bg-green-600',
  REJECTED: 'bg-red-600',
  ARCHIVED: 'bg-gray-600',
};

export function AdminRequestsPage() {
  const [tab, setTab] = useState<string>('PENDING');
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rejectNotes, setRejectNotes] = useState('');

  const { data: stats } = useDemoRequestStats();
  const { data, isLoading } = useDemoRequests(tab === 'ALL' ? undefined : tab);
  const review = useReviewDemoRequest();

  const handleApprove = (id: string) => {
    if (confirm('Approve this school access request?')) {
      review.mutate({ id, status: 'APPROVED' });
    }
  };

  const handleReject = () => {
    if (!rejectId) return;
    review.mutate({ id: rejectId, status: 'REJECTED', notes: rejectNotes });
    setRejectId(null);
    setRejectNotes('');
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">School Access Requests</h1>
        {stats && stats.pending > 0 && (
          <span className="bg-yellow-600 text-white text-sm font-medium px-3 py-1 rounded-full">
            {stats.pending} pending
          </span>
        )}
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-4 gap-4">
          {[
            { label: 'Total', value: stats.total, color: 'bg-gray-700' },
            { label: 'Pending', value: stats.pending, color: 'bg-yellow-900/50' },
            { label: 'Approved', value: stats.approved, color: 'bg-green-900/50' },
            { label: 'Rejected', value: stats.rejected, color: 'bg-red-900/50' },
          ].map((s) => (
            <div key={s.label} className={`${s.color} rounded-lg p-4`}>
              <div className="text-2xl font-bold text-white">{s.value}</div>
              <div className="text-gray-400 text-sm">{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-800 rounded-lg p-1">
        {STATUS_TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              tab === t ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="bg-gray-800 rounded-lg overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-700">
              {['Name', 'School', 'State', 'Email', 'Buildings', 'Status', 'Date', 'Actions'].map((h) => (
                <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-500">Loading...</td></tr>
            ) : !data?.requests.length ? (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-500">No requests found</td></tr>
            ) : data.requests.map((r) => (
              <tr key={r.id} className="border-b border-gray-700/50 hover:bg-gray-700/30">
                <td className="px-4 py-3 text-white">{r.name}</td>
                <td className="px-4 py-3 text-gray-300">{r.school}</td>
                <td className="px-4 py-3 text-gray-300">{r.state || '-'}</td>
                <td className="px-4 py-3 text-gray-300">{r.email}</td>
                <td className="px-4 py-3 text-gray-300">{r.buildings || '-'}</td>
                <td className="px-4 py-3">
                  <span className={`${STATUS_COLORS[r.status] || 'bg-gray-600'} text-white text-xs px-2 py-1 rounded`}>
                    {r.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-gray-400 text-sm">{new Date(r.createdAt).toLocaleDateString()}</td>
                <td className="px-4 py-3">
                  {r.status === 'PENDING' && (
                    <div className="flex gap-2">
                      <button onClick={() => handleApprove(r.id)} className="text-green-400 hover:text-green-300 text-sm font-medium">Approve</button>
                      <button onClick={() => setRejectId(r.id)} className="text-red-400 hover:text-red-300 text-sm font-medium">Reject</button>
                    </div>
                  )}
                  {r.notes && <div className="text-gray-500 text-xs mt-1">{r.notes}</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Reject Modal */}
      {rejectId && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-xl p-6 w-full max-w-md">
            <h2 className="text-lg font-bold text-white mb-4">Reject Request</h2>
            <textarea
              value={rejectNotes}
              onChange={(e) => setRejectNotes(e.target.value)}
              placeholder="Reason for rejection (optional)"
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 mb-4"
              rows={3}
            />
            <div className="flex justify-end gap-3">
              <button onClick={() => { setRejectId(null); setRejectNotes(''); }} className="px-4 py-2 text-gray-400 hover:text-white">Cancel</button>
              <button onClick={handleReject} className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg">Reject</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
