import { useBuses } from '../../api/transportation';

export function BusMap() {
  const { data: buses } = useBuses();

  const activeBuses = (buses || []).filter((b: any) => b.isActive && b.currentLatitude);

  return (
    <div className="bg-gray-800 rounded-xl p-4">
      <h3 className="text-lg font-semibold mb-4">Bus Positions</h3>

      {activeBuses.length === 0 ? (
        <div className="text-gray-500 text-center py-8">
          <p>No active GPS data available</p>
          <p className="text-sm mt-1">Bus positions will appear here when GPS updates are received</p>
        </div>
      ) : (
        <div className="space-y-2">
          {activeBuses.map((bus: any) => (
            <div key={bus.id} className="flex items-center justify-between bg-gray-700 rounded-lg p-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-yellow-700 rounded-lg flex items-center justify-center text-sm font-bold">
                  {bus.busNumber}
                </div>
                <div>
                  <div className="font-medium">Bus #{bus.busNumber}</div>
                  <div className="text-xs text-gray-400">
                    {bus.currentLatitude.toFixed(5)}, {bus.currentLongitude.toFixed(5)}
                    {bus.currentSpeed ? ` | ${Math.round(bus.currentSpeed)} mph` : ''}
                  </div>
                </div>
              </div>
              <div className="text-right text-sm">
                <div className="text-gray-300">{bus.currentStudentCount} students</div>
                <div className="text-xs text-gray-500">
                  {bus.lastGpsAt ? new Date(bus.lastGpsAt).toLocaleTimeString() : 'No update'}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
