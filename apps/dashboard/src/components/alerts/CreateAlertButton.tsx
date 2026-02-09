import { useState } from 'react';
import { useCreateAlert } from '../../api/alerts';

interface CreateAlertButtonProps {
  siteId: string;
  buildings: any[];
  trainingMode?: boolean;
}

export function CreateAlertButton({ siteId, buildings, trainingMode }: CreateAlertButtonProps) {
  const [armed, setArmed] = useState(false);
  const [selectedBuilding, setSelectedBuilding] = useState(buildings[0]?.id || '');
  const createAlert = useCreateAlert();

  const handlePanic = async () => {
    if (!armed) {
      setArmed(true);
      // Auto-disarm after 5 seconds
      setTimeout(() => setArmed(false), 5000);
      return;
    }

    await createAlert.mutateAsync({
      level: 'ACTIVE_THREAT',
      buildingId: selectedBuilding,
      source: 'DASHBOARD',
      trainingMode,
    });
    setArmed(false);
  };

  const handleMedical = async () => {
    await createAlert.mutateAsync({
      level: 'MEDICAL',
      buildingId: selectedBuilding,
      source: 'DASHBOARD',
      trainingMode,
    });
  };

  const handleLockdown = async () => {
    await createAlert.mutateAsync({
      level: 'LOCKDOWN',
      buildingId: selectedBuilding,
      source: 'DASHBOARD',
      trainingMode,
    });
  };

  return (
    <div className="bg-gray-800 rounded-lg p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">Emergency Actions</h2>
        {buildings.length > 1 && (
          <select
            value={selectedBuilding}
            onChange={(e) => setSelectedBuilding(e.target.value)}
            className="bg-gray-700 border border-gray-600 text-white text-sm rounded-lg px-3 py-1.5"
          >
            {buildings.map((b: any) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        )}
      </div>

      <div className="flex gap-4">
        {/* Two-step PANIC button */}
        <button
          onClick={handlePanic}
          disabled={createAlert.isPending}
          className={`flex-1 py-4 rounded-lg font-bold text-xl transition-all ${
            armed
              ? 'bg-red-600 hover:bg-red-700 ring-4 ring-red-400 ring-opacity-50 animate-pulse'
              : 'bg-red-800 hover:bg-red-700'
          } text-white`}
        >
          {armed ? 'CONFIRM PANIC' : 'PANIC'}
        </button>

        <button
          onClick={handleLockdown}
          disabled={createAlert.isPending}
          className="flex-1 py-4 bg-orange-700 hover:bg-orange-600 text-white rounded-lg font-bold text-lg transition-colors"
        >
          LOCKDOWN
        </button>

        <button
          onClick={handleMedical}
          disabled={createAlert.isPending}
          className="flex-1 py-4 bg-yellow-700 hover:bg-yellow-600 text-white rounded-lg font-bold text-lg transition-colors"
        >
          MEDICAL
        </button>
      </div>

      {armed && (
        <p className="text-red-400 text-sm text-center mt-2 animate-pulse">
          Press again to confirm ACTIVE THREAT alert. Auto-cancels in 5s.
        </p>
      )}
    </div>
  );
}
