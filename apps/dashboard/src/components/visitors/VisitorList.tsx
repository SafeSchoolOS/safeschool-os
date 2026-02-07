import { useActiveVisitors, useCheckOutVisitor } from '../../api/visitors';

export function VisitorList() {
  const { data: visitors, isLoading } = useActiveVisitors();
  const checkOut = useCheckOutVisitor();

  if (isLoading) return <div className="text-gray-400">Loading visitors...</div>;

  return (
    <div className="bg-gray-800 rounded-xl p-4">
      <h3 className="text-lg font-semibold mb-4">Active Visitors ({visitors?.length || 0})</h3>

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
