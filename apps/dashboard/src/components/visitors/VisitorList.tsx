import { useActiveVisitors, useCheckOutVisitor } from '../../api/visitors';
import { exportToCsv, formatDate } from '../../utils/export';

export function VisitorList() {
  const { data: visitors, isLoading } = useActiveVisitors();
  const checkOut = useCheckOutVisitor();

  const handleExportCsv = () => {
    if (!visitors || visitors.length === 0) return;
    const timestamp = new Date().toISOString().slice(0, 10);
    const headers = ['First Name', 'Last Name', 'Badge Number', 'Destination', 'Host', 'Purpose', 'Checked In At', 'Status'];
    const rows = visitors.map((v: any) => [
      v.firstName || '',
      v.lastName || '',
      v.badgeNumber || '',
      v.destination || '',
      v.host?.name || 'N/A',
      v.purpose || '',
      formatDate(v.checkedInAt),
      v.checkOutTime ? 'Checked Out' : 'On Site',
    ]);
    exportToCsv(`visitors_${timestamp}`, headers, rows);
  };

  if (isLoading) return <div className="text-gray-400">Loading visitors...</div>;

  return (
    <div className="bg-gray-800 rounded-xl p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold">Active Visitors ({visitors?.length || 0})</h3>
        <button
          onClick={handleExportCsv}
          disabled={!visitors || visitors.length === 0}
          className="px-4 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-sm font-medium transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          Export CSV
        </button>
      </div>

      {(!visitors || visitors.length === 0) ? (
        <p className="text-gray-500 text-center py-4">No visitors currently checked in</p>
      ) : (
        <div className="space-y-2">
          {visitors.map((v: any) => (
            <div key={v.id} className="flex items-center justify-between bg-gray-700 rounded-lg p-3">
              <div>
                <div className="font-medium">{v.firstName} {v.lastName}</div>
                <div className="text-sm text-gray-400">
                  Badge: {v.badgeNumber} | {v.destination} | Host: {v.host?.name || 'N/A'}
                </div>
                <div className="text-xs text-gray-500">
                  Checked in: {new Date(v.checkedInAt).toLocaleTimeString()}
                </div>
              </div>
              <button
                onClick={() => checkOut.mutate(v.id)}
                disabled={checkOut.isPending}
                className="px-3 py-1 bg-red-700 hover:bg-red-600 rounded text-sm transition-colors"
              >
                Check Out
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
