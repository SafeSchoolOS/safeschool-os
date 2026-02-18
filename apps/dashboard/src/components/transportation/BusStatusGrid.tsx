import { useBuses } from '../../api/transportation';

export function BusStatusGrid() {
  const { data: buses, isLoading } = useBuses();

  if (isLoading) return <div className="text-gray-400">Loading buses...</div>;

  return (
    <div className="bg-gray-800 rounded-xl p-4">
      <h3 className="text-lg font-semibold mb-4">Bus Fleet Status</h3>

      {(!buses || buses.length === 0) ? (
        <p className="text-gray-500 text-center py-4">No buses configured</p>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {buses.map((bus: any) => (
            <div key={bus.id} className={`rounded-lg p-3 ${bus.isActive ? 'bg-gray-700' : 'bg-gray-700/50'}`}>
              <div className="flex items-center justify-between mb-2">
                <span className="font-bold text-lg">Bus #{bus.busNumber}</span>
                <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                  bus.isActive ? 'bg-green-700 text-green-200' : 'bg-gray-600 text-gray-400'
                }`}>
                  {bus.isActive ? 'Active' : 'Inactive'}
                </span>
              </div>
              <div className="text-sm text-gray-400 space-y-1">
                <div>Students: {bus.currentStudentCount} / {bus.capacity}</div>
                {bus.currentLatitude && (
                  <div>GPS: {bus.currentLatitude.toFixed(4)}, {bus.currentLongitude.toFixed(4)}</div>
                )}
                {bus.lastGpsAt && (
                  <div>Last update: {new Date(bus.lastGpsAt).toLocaleTimeString()}</div>
                )}
                <div className="flex gap-2 mt-1">
                  {bus.hasRfidReader && <span className="text-xs bg-blue-900 text-blue-300 px-1.5 py-0.5 rounded">RFID</span>}
                  {bus.hasPanicButton && <span className="text-xs bg-red-900 text-red-300 px-1.5 py-0.5 rounded">Panic</span>}
                  {bus.hasCameras && <span className="text-xs bg-purple-900 text-purple-300 px-1.5 py-0.5 rounded">Cameras</span>}
                </div>
              </div>
              {bus.routeAssignments?.length > 0 && (
                <div className="mt-2 text-xs text-gray-500">
                  Route: {bus.routeAssignments.map((ra: any) => ra.route?.name || ra.routeId).join(', ')}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
