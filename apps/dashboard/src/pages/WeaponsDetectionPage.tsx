import { useWeaponsDetectors, useDetectionEvents, useTestDetection } from '../api/weaponsDetectors';

const THREAT_COLORS: Record<string, string> = {
  FIREARM: 'bg-red-600 text-white',
  MASS_CASUALTY: 'bg-red-700 text-white',
  KNIFE: 'bg-orange-500 text-white',
  ANOMALY: 'bg-yellow-500 text-gray-900',
  CLEAR: 'bg-green-600 text-white',
};

const LEVEL_COLORS: Record<string, string> = {
  ACTIVE_THREAT: 'bg-red-600/20 text-red-400 border border-red-600/30',
  LOCKDOWN: 'bg-orange-600/20 text-orange-400 border border-orange-600/30',
  MEDICAL: 'bg-yellow-600/20 text-yellow-400 border border-yellow-600/30',
};

function formatTime(ts: string): string {
  return new Date(ts).toLocaleString();
}

export function WeaponsDetectionPage() {
  const { data: detectors, isLoading: loadingDetectors } = useWeaponsDetectors();
  const { data: events, isLoading: loadingEvents } = useDetectionEvents();
  const testMutation = useTestDetection();

  const activeDetectorCount = detectors?.length || 0;

  return (
    <div className="p-4 sm:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold dark:text-white text-gray-900">Weapons Detection</h2>
          <p className="text-sm dark:text-gray-400 text-gray-500 mt-1">
            Walk-through weapons detection systems — Evolv, CEIA, Xtract One
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="dark:bg-gray-800 bg-white border dark:border-gray-700 border-gray-200 rounded-lg px-4 py-2">
            <span className="text-2xl font-bold dark:text-white text-gray-900">{activeDetectorCount}</span>
            <span className="text-sm dark:text-gray-400 text-gray-500 ml-2">detectors</span>
          </div>
          <button
            onClick={() => testMutation.mutate()}
            disabled={testMutation.isPending}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
          >
            {testMutation.isPending ? 'Testing...' : 'Test Detection'}
          </button>
        </div>
      </div>

      {testMutation.isSuccess && (
        <div className="dark:bg-green-900/20 bg-green-50 border dark:border-green-700 border-green-200 rounded-lg p-3 text-sm dark:text-green-400 text-green-700">
          Test detection event created successfully (training mode).
        </div>
      )}

      {testMutation.isError && (
        <div className="dark:bg-red-900/20 bg-red-50 border dark:border-red-700 border-red-200 rounded-lg p-3 text-sm dark:text-red-400 text-red-700">
          {(testMutation.error as Error).message}
        </div>
      )}

      {/* Configured Detectors */}
      <div>
        <h3 className="text-sm font-semibold dark:text-gray-300 text-gray-700 mb-3">Configured Detectors</h3>
        {loadingDetectors ? (
          <div className="dark:bg-gray-800 bg-white border dark:border-gray-700 border-gray-200 rounded-lg p-8 text-center dark:text-gray-400 text-gray-500">
            Loading...
          </div>
        ) : !detectors?.length ? (
          <div className="dark:bg-gray-800 bg-white border dark:border-gray-700 border-gray-200 rounded-lg p-8 text-center dark:text-gray-400 text-gray-500">
            No detectors registered yet. Detectors appear here automatically when they send their first webhook event.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {detectors.map((d) => (
              <div
                key={d.detectorId}
                className="dark:bg-gray-800 bg-white border dark:border-gray-700 border-gray-200 rounded-lg p-4"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium dark:text-white text-gray-900 truncate">{d.detectorName}</span>
                  <span className="inline-block w-2 h-2 bg-green-500 rounded-full flex-shrink-0" title="Online" />
                </div>
                <div className="space-y-1 text-sm">
                  <div className="dark:text-gray-400 text-gray-500">
                    Vendor: <span className="dark:text-gray-300 text-gray-700">{d.vendor}</span>
                  </div>
                  {d.entrance && (
                    <div className="dark:text-gray-400 text-gray-500">
                      Location: <span className="dark:text-gray-300 text-gray-700">{d.entrance}</span>
                    </div>
                  )}
                  <div className="dark:text-gray-400 text-gray-500">
                    Events: <span className="dark:text-gray-300 text-gray-700">{d.eventCount}</span>
                  </div>
                  <div className="dark:text-gray-400 text-gray-500">
                    Last seen: <span className="dark:text-gray-300 text-gray-700">{formatTime(d.lastSeen)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Recent Detections */}
      <div>
        <h3 className="text-sm font-semibold dark:text-gray-300 text-gray-700 mb-3">Recent Detections</h3>
        <div className="dark:bg-gray-800 bg-white border dark:border-gray-700 border-gray-200 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="dark:bg-gray-700/50 bg-gray-50 dark:text-gray-300 text-gray-600">
                  <th className="text-left px-4 py-3 font-medium">Time</th>
                  <th className="text-left px-4 py-3 font-medium">Vendor</th>
                  <th className="text-left px-4 py-3 font-medium">Detector</th>
                  <th className="text-left px-4 py-3 font-medium">Threat</th>
                  <th className="text-left px-4 py-3 font-medium">Confidence</th>
                  <th className="text-left px-4 py-3 font-medium">Alert Level</th>
                  <th className="text-left px-4 py-3 font-medium">Action</th>
                  <th className="text-left px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y dark:divide-gray-700 divide-gray-200">
                {loadingEvents ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center dark:text-gray-400 text-gray-500">
                      Loading...
                    </td>
                  </tr>
                ) : !events?.length ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center dark:text-gray-400 text-gray-500">
                      No detection events yet. Events will appear here when weapons detectors send alerts.
                    </td>
                  </tr>
                ) : (
                  events.map((e) => (
                    <tr key={e.alertId} className="dark:hover:bg-gray-700/30 hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 dark:text-gray-300 text-gray-700 whitespace-nowrap">
                        {formatTime(e.timestamp)}
                      </td>
                      <td className="px-4 py-3 dark:text-gray-300 text-gray-700">{e.vendor}</td>
                      <td className="px-4 py-3 dark:text-white text-gray-900">
                        {e.detectorName || '-'}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${THREAT_COLORS[e.threatLevel] || 'bg-gray-600 text-white'}`}>
                          {e.threatLevel}
                        </span>
                      </td>
                      <td className="px-4 py-3 dark:text-gray-300 text-gray-700">
                        {e.confidence != null ? `${Math.round(e.confidence * 100)}%` : '-'}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${LEVEL_COLORS[e.level] || 'dark:bg-gray-700 bg-gray-100 dark:text-gray-300 text-gray-600'}`}>
                          {e.level}
                        </span>
                      </td>
                      <td className="px-4 py-3 dark:text-gray-300 text-gray-700">
                        {e.operatorAction || '-'}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-block w-2 h-2 rounded-full ${
                          e.status === 'TRIGGERED' ? 'bg-red-500' :
                          e.status === 'ACKNOWLEDGED' ? 'bg-yellow-500' :
                          'bg-green-500'
                        }`} />
                        <span className="ml-2 dark:text-gray-300 text-gray-700">{e.status}</span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
