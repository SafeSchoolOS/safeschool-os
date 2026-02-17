import { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useSites } from '../api/sites';
import { useAlerts, useConfirmFire, useDismissFire } from '../api/alerts';
import { useWeatherAlerts, type WeatherAlert } from '../api/weather';
import { useIntegrationHealth } from '../api/integrationHealth';
import { useActiveRollCall } from '../api/rollCall';
import { useActionConfirmations } from '../api/systemHealth';
import { AlertList } from '../components/alerts/AlertList';
import { CreateAlertButton } from '../components/alerts/CreateAlertButton';
import { DoorStatusGrid } from '../components/doors/DoorStatusGrid';
import { LockdownControls } from '../components/lockdown/LockdownControls';
import { BuildingMap } from '../components/map/BuildingMap';
import { SendNotificationForm } from '../components/notifications/SendNotificationForm';

const TRAINING_MODE_KEY = 'safeschool_training_mode';

export function CommandCenter() {
  const { user } = useAuth();
  const { data: sites } = useSites();
  const siteId = user?.siteIds[0];
  const site = sites?.[0];
  const { data: alerts } = useAlerts(siteId);
  const confirmFire = useConfirmFire();
  const dismissFire = useDismissFire();
  const { data: weatherAlerts, isLoading: weatherLoading } = useWeatherAlerts(siteId);

  // Detect suppressed fire alarms
  const suppressedFireAlerts = (alerts || []).filter((a: any) => a.status === 'SUPPRESSED' && a.level === 'FIRE');
  const { data: integrations } = useIntegrationHealth();
  const { data: activeRollCall } = useActiveRollCall();
  const { data: confirmations } = useActionConfirmations();

  const [trainingMode, setTrainingMode] = useState(() => {
    return sessionStorage.getItem(TRAINING_MODE_KEY) === 'true';
  });

  useEffect(() => {
    if (trainingMode) {
      sessionStorage.setItem(TRAINING_MODE_KEY, 'true');
    } else {
      sessionStorage.removeItem(TRAINING_MODE_KEY);
    }
  }, [trainingMode]);

  return (
    <div className="p-3 sm:p-6 grid grid-cols-12 gap-4 sm:gap-6">
      {/* Training mode toggle */}
      <div className="col-span-12 flex items-center justify-between">
        <label className="flex items-center gap-3 cursor-pointer select-none">
          <span className="text-sm font-medium text-gray-300">Training / Demo Mode</span>
          <button
            type="button"
            role="switch"
            aria-checked={trainingMode}
            onClick={() => setTrainingMode(!trainingMode)}
            className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors ${
              trainingMode ? 'bg-orange-500' : 'bg-gray-600'
            }`}
          >
            <span
              className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transform transition-transform ${
                trainingMode ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </label>
      </div>

      {/* Training mode banner */}
      {trainingMode && (
        <div className="col-span-12 px-4 py-3 bg-orange-600/20 border border-orange-500 rounded-lg">
          <p className="text-sm font-semibold text-orange-300 text-center">
            TRAINING MODE &mdash; 911 dispatch is disabled. All other systems are live.
          </p>
        </div>
      )}

      {/* Fire Alarm Suppression Banner */}
      {suppressedFireAlerts.map((fa: any) => (
        <div key={fa.id} className="col-span-12 px-4 py-4 bg-red-600/20 border-2 border-red-500 rounded-lg animate-pulse">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div>
              <p className="text-base font-bold text-red-300">
                FIRE ALARM SUPPRESSED &mdash; {fa.buildingName}
              </p>
              <p className="text-sm text-red-200 mt-1">
                Fire alarm triggered during active lockdown. Doors remain LOCKED to prevent adversarial evacuation.
                Operator decision required: Is this a real fire or a false alarm?
              </p>
            </div>
            <div className="flex gap-2 flex-shrink-0">
              <button
                onClick={() => {
                  if (window.confirm('CONFIRM REAL FIRE? This will unlock ALL doors and begin evacuation.')) {
                    confirmFire.mutate(fa.id);
                  }
                }}
                disabled={confirmFire.isPending}
                className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-lg text-sm font-bold transition-colors disabled:opacity-50"
              >
                CONFIRM FIRE — Evacuate
              </button>
              <button
                onClick={() => {
                  if (window.confirm('Dismiss fire alarm as false alarm? Lockdown will continue.')) {
                    dismissFire.mutate(fa.id);
                  }
                }}
                disabled={dismissFire.isPending}
                className="px-4 py-2 bg-gray-600 hover:bg-gray-500 text-white rounded-lg text-sm font-bold transition-colors disabled:opacity-50"
              >
                Dismiss — False Alarm
              </button>
            </div>
          </div>
        </div>
      ))}

      {/* Left column: Map + Alert Creation */}
      <div className="col-span-12 lg:col-span-8 space-y-4 sm:space-y-6">
        {/* PANIC Button */}
        {site && <CreateAlertButton siteId={siteId!} buildings={site.buildings || []} trainingMode={trainingMode} />}

        {/* Building Map */}
        {site && <BuildingMap site={site} />}

        {/* Alert List */}
        <AlertList siteId={siteId} />
      </div>

      {/* Right column: Door Status + Lockdown + Notifications */}
      <div className="col-span-12 lg:col-span-4 space-y-4 sm:space-y-6">
        <LockdownControls siteId={siteId} buildings={site?.buildings || []} trainingMode={trainingMode} />
        <DoorStatusGrid siteId={siteId} />
        <WeatherAlertWidget alerts={weatherAlerts} loading={weatherLoading} />

        {/* Integration Status Panel */}
        {integrations && integrations.length > 0 && (
          <div className="rounded-lg border border-gray-700 bg-gray-800 p-4">
            <h3 className="text-sm font-semibold text-gray-300 mb-3">Integration Status</h3>
            <div className="space-y-2">
              {integrations.slice(0, 8).map((int: any) => {
                const color = int.status === 'HEALTHY_INTEGRATION' ? 'bg-green-500'
                  : int.status === 'DEGRADED_INTEGRATION' ? 'bg-yellow-500'
                  : int.status === 'DOWN_INTEGRATION' ? 'bg-red-500' : 'bg-gray-500';
                return (
                  <div key={int.id} className="flex items-center justify-between text-xs">
                    <span className="text-gray-300">{int.integrationName}</span>
                    <span className={`w-2 h-2 rounded-full ${color}`} />
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Accountability Tracker (Active Roll Call) */}
        {activeRollCall && (
          <div className="rounded-lg border border-orange-500/50 bg-orange-900/20 p-4">
            <h3 className="text-sm font-semibold text-orange-300 mb-2">Roll Call Active</h3>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between text-gray-300">
                <span>Classrooms</span>
                <span className="font-mono">{activeRollCall.reportedClassrooms}/{activeRollCall.totalClassrooms}</span>
              </div>
              <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
                <div className="h-full bg-orange-500 rounded-full transition-all" style={{ width: `${Math.round((activeRollCall.reportedClassrooms / Math.max(activeRollCall.totalClassrooms, 1)) * 100)}%` }} />
              </div>
              <div className="flex justify-between text-gray-300">
                <span>Students Accounted</span>
                <span className="font-mono">{activeRollCall.accountedStudents}/{activeRollCall.totalStudents}</span>
              </div>
              {activeRollCall.reports?.some((r: any) => r.studentsMissing?.length > 0) && (
                <div className="text-red-400 font-medium mt-1">
                  Missing: {activeRollCall.reports.flatMap((r: any) => r.studentsMissing || []).join(', ')}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Action Confirmation Feed */}
        {confirmations && confirmations.length > 0 && (
          <div className="rounded-lg border border-gray-700 bg-gray-800 p-4">
            <h3 className="text-sm font-semibold text-gray-300 mb-3">Action Confirmations</h3>
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {confirmations.slice(0, 10).map((c: any) => {
                const statusColor = c.status === 'CONFIRMED_ACTION' ? 'text-green-400'
                  : c.status === 'FAILED_CONFIRMATION' || c.status === 'TIMED_OUT_CONFIRMATION' ? 'text-red-400'
                  : 'text-blue-400';
                return (
                  <div key={c.id} className="flex items-center justify-between text-xs">
                    <span className="text-gray-300">{c.actionType.replace('_ACTION', '').replace('_', ' ')}</span>
                    <span className={statusColor}>{c.status.replace('_CONFIRMATION', '').replace('_ACTION', '')}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <SendNotificationForm />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Weather Alert Widget
// ---------------------------------------------------------------------------

const SEVERITY_STYLES: Record<string, { border: string; bg: string; text: string; dot: string }> = {
  Extreme: { border: 'border-red-500', bg: 'bg-red-900/30', text: 'text-red-300', dot: 'bg-red-500' },
  Severe:  { border: 'border-orange-500', bg: 'bg-orange-900/30', text: 'text-orange-300', dot: 'bg-orange-500' },
  Moderate:{ border: 'border-yellow-500', bg: 'bg-yellow-900/30', text: 'text-yellow-300', dot: 'bg-yellow-500' },
  Minor:   { border: 'border-blue-500', bg: 'bg-blue-900/30', text: 'text-blue-300', dot: 'bg-blue-500' },
  Unknown: { border: 'border-gray-500', bg: 'bg-gray-900/30', text: 'text-gray-300', dot: 'bg-gray-500' },
};

function WeatherAlertWidget({
  alerts,
  loading,
}: {
  alerts: WeatherAlert[] | undefined;
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="rounded-lg border border-gray-700 bg-gray-800 p-4">
        <h3 className="text-sm font-semibold text-gray-300 mb-2">Weather Alerts</h3>
        <p className="text-xs text-gray-500">Loading...</p>
      </div>
    );
  }

  if (!alerts || alerts.length === 0) {
    return (
      <div className="rounded-lg border border-green-700 bg-green-900/20 p-4">
        <h3 className="text-sm font-semibold text-green-400 mb-1">Weather Alerts</h3>
        <p className="text-xs text-green-300">No active weather alerts</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-gray-700 bg-gray-800 p-4">
      <h3 className="text-sm font-semibold text-gray-300 mb-3">
        Weather Alerts ({alerts.length})
      </h3>
      <div className="space-y-2 max-h-64 overflow-y-auto">
        {alerts.map((alert) => {
          const style = SEVERITY_STYLES[alert.severity] ?? SEVERITY_STYLES.Unknown;
          return (
            <div
              key={alert.id}
              className={`rounded border ${style.border} ${style.bg} p-3`}
            >
              <div className="flex items-center gap-2 mb-1">
                <span className={`inline-block h-2 w-2 rounded-full ${style.dot}`} />
                <span className={`text-xs font-bold uppercase ${style.text}`}>
                  {alert.severity}
                </span>
              </div>
              <p className={`text-sm font-medium ${style.text}`}>{alert.headline}</p>
              {alert.expires && (
                <p className="text-xs text-gray-400 mt-1">
                  Expires: {new Date(alert.expires).toLocaleString()}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
