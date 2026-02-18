import { useState, useEffect, useCallback } from 'react';
import {
  useActiveFireAlarmEvent,
  useFireAlarmEvents,
  useFireAlarmZones,
  useAcknowledgeFire,
  useConfirmFire,
  useDismissFire,
  useExtendFireInvestigation,
  useEvacuationRoutes,
} from '../api/fireAlarm';
import { useAlerts } from '../api/alerts';

/**
 * Fire Alarm PAS Protocol Page
 *
 * NFPA 72 Positive Alarm Sequence management during lockdown.
 * Shows:
 * - Active fire alarm with countdown timers (15s ack, 3min investigation)
 * - Device type and suspicion level classification
 * - Decision buttons (Acknowledge, Confirm Fire, Dismiss, Extend)
 * - Fire alarm zone configuration
 * - PAS event history
 * - Evacuation route management
 */

// Suspicion level colors and labels
const SUSPICION_CONFIG: Record<string, { color: string; bg: string; label: string }> = {
  HIGH_SUSPICION: { color: 'text-red-700', bg: 'bg-red-100 border-red-500', label: 'HIGH — Manual pull station (possible ruse)' },
  ELEVATED_SUSPICION: { color: 'text-orange-700', bg: 'bg-orange-100 border-orange-500', label: 'ELEVATED — Heat/waterflow (possible real fire)' },
  MODERATE_SUSPICION: { color: 'text-yellow-700', bg: 'bg-yellow-100 border-yellow-500', label: 'MODERATE — Smoke near threat zone (likely gunfire)' },
  LOW_SUSPICION: { color: 'text-blue-700', bg: 'bg-blue-100 border-blue-500', label: 'LOW — Smoke away from threat (investigate immediately)' },
  UNKNOWN_SUSPICION: { color: 'text-gray-700', bg: 'bg-gray-100 border-gray-500', label: 'UNKNOWN — Assess situation' },
};

const DEVICE_LABELS: Record<string, string> = {
  SMOKE_DETECTOR: 'Smoke Detector',
  HEAT_DETECTOR: 'Heat Detector',
  MANUAL_PULL_STATION: 'Manual Pull Station',
  SPRINKLER_WATERFLOW: 'Sprinkler Waterflow',
  DUCT_DETECTOR: 'Duct Detector',
  UNKNOWN_DEVICE: 'Unknown Device',
};

function CountdownTimer({ deadline, label, onExpired }: { deadline: string; label: string; onExpired?: () => void }) {
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    const update = () => {
      const ms = new Date(deadline).getTime() - Date.now();
      setRemaining(Math.max(0, ms));
      if (ms <= 0 && onExpired) onExpired();
    };
    update();
    const interval = setInterval(update, 100);
    return () => clearInterval(interval);
  }, [deadline, onExpired]);

  const seconds = Math.ceil(remaining / 1000);
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  const isUrgent = remaining < 10000;
  const isExpired = remaining <= 0;

  return (
    <div className={`text-center p-3 rounded-lg border-2 ${
      isExpired ? 'bg-red-200 border-red-600' : isUrgent ? 'bg-red-100 border-red-500 animate-pulse' : 'bg-yellow-50 border-yellow-400'
    }`}>
      <div className="text-xs font-medium text-gray-600 uppercase">{label}</div>
      <div className={`text-3xl font-mono font-bold ${isExpired ? 'text-red-700' : isUrgent ? 'text-red-600' : 'text-yellow-700'}`}>
        {isExpired ? 'EXPIRED' : `${minutes}:${secs.toString().padStart(2, '0')}`}
      </div>
    </div>
  );
}

function ActiveFireAlarmPanel() {
  const { data: alerts } = useAlerts();
  const { data: activeEvent } = useActiveFireAlarmEvent();
  const acknowledgeFire = useAcknowledgeFire();
  const confirmFire = useConfirmFire();
  const dismissFire = useDismissFire();
  const extendInvestigation = useExtendFireInvestigation();
  const [extendReason, setExtendReason] = useState('');
  const [showExtendForm, setShowExtendForm] = useState(false);

  // Find suppressed fire alerts
  const suppressedFireAlerts = (alerts || []).filter(
    (a: any) => a.status === 'SUPPRESSED' && a.level === 'FIRE'
  );

  if (suppressedFireAlerts.length === 0 && !activeEvent) {
    return (
      <div className="bg-green-50 border border-green-200 rounded-lg p-6 text-center">
        <div className="text-green-700 font-semibold text-lg">No Active Fire Alarms</div>
        <p className="text-green-600 text-sm mt-1">PAS protocol is standing by.</p>
      </div>
    );
  }

  const fireAlert = suppressedFireAlerts[0] as any;
  if (!fireAlert) return null;

  const metadata = fireAlert.metadata || {};
  const pas = metadata.pasProtocol || {};
  const suspicion = SUSPICION_CONFIG[pas.suspicionLevel] || SUSPICION_CONFIG.UNKNOWN_SUSPICION;
  const deviceLabel = DEVICE_LABELS[pas.deviceType] || 'Unknown';
  const isAcknowledged = pas.acknowledged === true;
  const isExtended = pas.extended === true;

  const handleAcknowledge = () => {
    if (window.confirm('Acknowledge fire alarm and start 3-minute investigation?')) {
      acknowledgeFire.mutate(fireAlert.id);
    }
  };

  const handleConfirmFire = () => {
    if (window.confirm('CONFIRM REAL FIRE? This will UNLOCK ALL DOORS and initiate evacuation!')) {
      confirmFire.mutate({ alertId: fireAlert.id });
    }
  };

  const handleDismiss = () => {
    if (window.confirm('Dismiss as false alarm? Lockdown will continue.')) {
      dismissFire.mutate(fireAlert.id);
    }
  };

  const handleExtend = () => {
    if (!extendReason.trim()) return;
    extendInvestigation.mutate({ alertId: fireAlert.id, reason: extendReason });
    setShowExtendForm(false);
    setExtendReason('');
  };

  return (
    <div className="bg-red-50 border-2 border-red-500 rounded-lg p-6 animate-pulse shadow-lg shadow-red-200">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xl font-bold text-red-800">FIRE ALARM — PAS ACTIVE</h2>
          <p className="text-red-600 text-sm">{fireAlert.buildingName} {fireAlert.roomName ? `- ${fireAlert.roomName}` : ''}</p>
        </div>
        <div className="text-right">
          <span className={`inline-block px-3 py-1 rounded-full text-xs font-bold border ${suspicion.bg} ${suspicion.color}`}>
            {pas.suspicionLevel?.replace('_', ' ') || 'UNKNOWN'}
          </span>
        </div>
      </div>

      {/* Device Type & Suspicion */}
      <div className={`p-3 rounded border-l-4 mb-4 ${suspicion.bg}`}>
        <div className="flex items-center gap-2">
          <span className="font-semibold">Device:</span>
          <span>{deviceLabel}</span>
        </div>
        <div className={`text-sm mt-1 ${suspicion.color}`}>{suspicion.label}</div>
      </div>

      {/* Countdown Timers */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        {!isAcknowledged && pas.ackDeadline && (
          <CountdownTimer
            deadline={pas.ackDeadline}
            label="Acknowledge In"
          />
        )}
        {isAcknowledged && pas.investigationDeadline && !isExtended && (
          <CountdownTimer
            deadline={pas.investigationDeadline}
            label="Investigation Window"
          />
        )}
        {isExtended && (
          <div className="text-center p-3 rounded-lg border-2 bg-amber-100 border-amber-500">
            <div className="text-xs font-medium text-gray-600 uppercase">Status</div>
            <div className="text-lg font-bold text-amber-700">EXTENDED HOLD</div>
            <div className="text-xs text-amber-600 mt-1">{pas.extensionReason}</div>
          </div>
        )}
        <div className="text-center p-3 rounded-lg border bg-gray-50">
          <div className="text-xs font-medium text-gray-600 uppercase">Triggered</div>
          <div className="text-lg font-mono">{new Date(fireAlert.triggeredAt).toLocaleTimeString()}</div>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex flex-wrap gap-2">
        {!isAcknowledged && (
          <button
            onClick={handleAcknowledge}
            className="flex-1 bg-yellow-500 hover:bg-yellow-600 text-white font-bold py-3 px-4 rounded-lg text-sm transition"
            disabled={acknowledgeFire.isPending}
          >
            ACKNOWLEDGE (Start Investigation)
          </button>
        )}
        <button
          onClick={handleConfirmFire}
          className="flex-1 bg-red-600 hover:bg-red-700 text-white font-bold py-3 px-4 rounded-lg text-sm transition"
          disabled={confirmFire.isPending}
        >
          CONFIRM FIRE (Evacuate)
        </button>
        <button
          onClick={handleDismiss}
          className="flex-1 bg-green-600 hover:bg-green-700 text-white font-bold py-3 px-4 rounded-lg text-sm transition"
          disabled={dismissFire.isPending}
        >
          FALSE ALARM (Maintain Lockdown)
        </button>
        {isAcknowledged && !isExtended && (
          <button
            onClick={() => setShowExtendForm(true)}
            className="flex-1 bg-amber-500 hover:bg-amber-600 text-white font-bold py-3 px-4 rounded-lg text-sm transition"
          >
            EXTEND (Active Threat Verified)
          </button>
        )}
      </div>

      {/* Extend Investigation Form */}
      {showExtendForm && (
        <div className="mt-3 p-3 bg-amber-50 border border-amber-300 rounded-lg">
          <label className="block text-sm font-medium text-amber-800 mb-1">
            Reason for extending investigation (required):
          </label>
          <input
            type="text"
            value={extendReason}
            onChange={(e) => setExtendReason(e.target.value)}
            placeholder="e.g., Active shooter verified on 2nd floor, maintaining lockdown"
            className="w-full border border-amber-300 rounded px-3 py-2 text-sm"
          />
          <div className="flex gap-2 mt-2">
            <button
              onClick={handleExtend}
              disabled={!extendReason.trim()}
              className="bg-amber-600 text-white px-4 py-1 rounded text-sm disabled:opacity-50"
            >
              Confirm Extension
            </button>
            <button
              onClick={() => setShowExtendForm(false)}
              className="bg-gray-300 text-gray-700 px-4 py-1 rounded text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* NFPA Reference */}
      <div className="mt-4 text-xs text-gray-500 border-t pt-2">
        NFPA 72 Positive Alarm Sequence: 15s acknowledgment, 3-minute investigation window.
        Per Indiana/Tennessee law and IAFC guidance, investigation may be extended only when active threat is verified on property.
      </div>
    </div>
  );
}

function FireAlarmZonesList() {
  const { data: zones, isLoading } = useFireAlarmZones();

  if (isLoading) return <div className="text-gray-500">Loading zones...</div>;
  if (!zones?.length) return <div className="text-gray-400 text-sm">No fire alarm zones configured. Add zones to enable PAS zone correlation.</div>;

  return (
    <div className="overflow-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-gray-50 text-left">
            <th className="p-2">Zone #</th>
            <th className="p-2">Name</th>
            <th className="p-2">Floor</th>
            <th className="p-2">Pull Stations</th>
            <th className="p-2">Smoke</th>
            <th className="p-2">Heat</th>
            <th className="p-2">Sprinklers</th>
          </tr>
        </thead>
        <tbody>
          {(zones as any[]).map((z: any) => (
            <tr key={z.id} className="border-t hover:bg-gray-50">
              <td className="p-2 font-mono">{z.zoneNumber}</td>
              <td className="p-2">{z.name}</td>
              <td className="p-2">{z.floor || '-'}</td>
              <td className="p-2">{z.hasPullStations ? 'Yes' : 'No'}</td>
              <td className="p-2">{z.hasSmokeDetectors ? 'Yes' : 'No'}</td>
              <td className="p-2">{z.hasHeatDetectors ? 'Yes' : 'No'}</td>
              <td className="p-2">{z.hasSprinklers ? 'Yes' : 'No'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PASEventHistory() {
  const { data: events, isLoading } = useFireAlarmEvents();

  if (isLoading) return <div className="text-gray-500">Loading history...</div>;
  if (!events?.length) return <div className="text-gray-400 text-sm">No PAS events recorded yet.</div>;

  const STATUS_COLORS: Record<string, string> = {
    ALARM_ACTIVE: 'bg-red-100 text-red-800',
    ACKNOWLEDGED_ALARM: 'bg-yellow-100 text-yellow-800',
    INVESTIGATING: 'bg-blue-100 text-blue-800',
    CONFIRMED_FIRE: 'bg-red-200 text-red-900',
    FALSE_ALARM: 'bg-green-100 text-green-800',
    AUTO_ESCALATED: 'bg-orange-100 text-orange-800',
  };

  return (
    <div className="space-y-2 max-h-96 overflow-y-auto">
      {(events as any[]).map((e: any) => (
        <div key={e.id} className="flex items-center gap-3 p-2 border rounded text-sm">
          <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[e.status] || 'bg-gray-100'}`}>
            {e.status.replace(/_/g, ' ')}
          </span>
          <span className="text-gray-600">{DEVICE_LABELS[e.deviceType] || e.deviceType}</span>
          <span className="text-gray-400">{e.fireAlarmZone?.name || 'Unknown zone'}</span>
          <span className="ml-auto text-gray-400 text-xs">{new Date(e.createdAt).toLocaleString()}</span>
          {e.decision && (
            <span className="px-2 py-0.5 rounded text-xs bg-purple-100 text-purple-800">
              {e.decision.replace(/_/g, ' ')}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

function EvacuationRoutesList() {
  const { data: routes, isLoading } = useEvacuationRoutes();

  if (isLoading) return <div className="text-gray-500">Loading routes...</div>;
  if (!routes?.length) return <div className="text-gray-400 text-sm">No evacuation routes configured. Add routes to enable directed evacuation.</div>;

  return (
    <div className="space-y-2">
      {(routes as any[]).map((r: any) => (
        <div key={r.id} className="p-3 border rounded hover:bg-gray-50">
          <div className="flex items-center justify-between">
            <span className="font-medium">{r.name}</span>
            {r.isDefault && <span className="text-xs bg-blue-100 text-blue-800 px-2 py-0.5 rounded">Default</span>}
          </div>
          {r.description && <p className="text-sm text-gray-500 mt-1">{r.description}</p>}
          <div className="flex gap-4 mt-2 text-xs text-gray-400">
            <span>From: {r.fromZones?.join(', ') || 'all'}</span>
            <span>Exit: {r.toExit || '-'}</span>
            <span>Doors: {r.doorIds?.length || 0}</span>
            {r.avoidZones?.length > 0 && <span className="text-red-400">Avoid: {r.avoidZones.join(', ')}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

export function FireAlarmPASPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Fire Alarm PAS Protocol</h1>
        <p className="text-gray-500 text-sm mt-1">
          NFPA 72 Positive Alarm Sequence — Fire alarm management during lockdown events
        </p>
      </div>

      {/* Active Fire Alarm Panel */}
      <ActiveFireAlarmPanel />

      {/* Grid layout for configuration panels */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Fire Alarm Zones */}
        <div className="bg-white border rounded-lg p-4">
          <h3 className="font-semibold text-gray-800 mb-3">Fire Alarm Zones</h3>
          <FireAlarmZonesList />
        </div>

        {/* Evacuation Routes */}
        <div className="bg-white border rounded-lg p-4">
          <h3 className="font-semibold text-gray-800 mb-3">Evacuation Routes</h3>
          <EvacuationRoutesList />
        </div>
      </div>

      {/* PAS Event History */}
      <div className="bg-white border rounded-lg p-4">
        <h3 className="font-semibold text-gray-800 mb-3">PAS Event History</h3>
        <PASEventHistory />
      </div>

      {/* Protocol Reference */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h3 className="font-semibold text-blue-800 mb-2">PAS Protocol Reference</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm text-blue-700">
          <div>
            <h4 className="font-medium mb-1">Device Suspicion Levels</h4>
            <ul className="space-y-1 text-xs">
              <li><span className="font-medium text-red-600">HIGH:</span> Manual pull station — likely attacker ruse</li>
              <li><span className="font-medium text-orange-600">ELEVATED:</span> Heat detector / waterflow — possible real fire</li>
              <li><span className="font-medium text-yellow-600">MODERATE:</span> Smoke detector near threat — likely gunfire smoke</li>
              <li><span className="font-medium text-blue-600">LOW:</span> Smoke detector away from threat — investigate</li>
            </ul>
          </div>
          <div>
            <h4 className="font-medium mb-1">Timeline (NFPA 72 / Indiana Law)</h4>
            <ul className="space-y-1 text-xs">
              <li>0:00 — Fire alarm triggers, PAS suppression activates</li>
              <li>0:15 — Must acknowledge or alarm auto-escalates</li>
              <li>0:15-3:15 — Investigation window (send staff to verify)</li>
              <li>3:15 — Must decide or alarm auto-escalates</li>
              <li>Exception: May extend if active threat is verified on property</li>
            </ul>
          </div>
        </div>
        <p className="text-xs text-blue-500 mt-3">
          Sources: NFPA 3000, NFPA 72 Ch.23, Indiana DHS, Tennessee SAVE Act, IAFC Position Statement, Colorado DFPC
        </p>
      </div>
    </div>
  );
}
