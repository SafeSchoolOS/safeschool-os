import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useAlerts, useConfirmFire, useDismissFire } from '../api/alerts';
import { useDoors } from '../api/doors';
import { useActiveVisitors } from '../api/visitors';
import { useCameras, useCameraHealth, getSnapshotUrl } from '../api/cameras';
import { useEvents } from '../api/events';
import { useIntegrationHealth } from '../api/integrationHealth';
import { useActiveRollCall } from '../api/rollCall';
import { useSystemHealth } from '../api/systemHealth';
import { useWebSocket } from '../ws/useWebSocket';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type WidgetType =
  | 'clock'
  | 'calendar'
  | 'alerts'
  | 'cameras'
  | 'doors'
  | 'visitors'
  | 'integrations'
  | 'rollcall'
  | 'system'
  | 'events';

interface WidgetConfig {
  id: string;
  type: WidgetType;
  title: string;
  colSpan: number; // 1-4 columns in the grid
  rowSpan: number; // 1-3 rows
  visible: boolean;
}

const STORAGE_KEY = 'safeschool_widget_layout';

const DEFAULT_WIDGETS: WidgetConfig[] = [
  { id: 'clock', type: 'clock', title: 'Clock', colSpan: 1, rowSpan: 1, visible: true },
  { id: 'calendar', type: 'calendar', title: 'Calendar', colSpan: 1, rowSpan: 2, visible: true },
  { id: 'alerts', type: 'alerts', title: 'Alert Log', colSpan: 2, rowSpan: 2, visible: true },
  { id: 'cameras', type: 'cameras', title: 'Camera Feeds', colSpan: 2, rowSpan: 2, visible: true },
  { id: 'doors', type: 'doors', title: 'Access Control', colSpan: 1, rowSpan: 2, visible: true },
  { id: 'visitors', type: 'visitors', title: 'Visitor Count', colSpan: 1, rowSpan: 1, visible: true },
  { id: 'integrations', type: 'integrations', title: 'Integrations', colSpan: 1, rowSpan: 1, visible: true },
  { id: 'rollcall', type: 'rollcall', title: 'Roll Call', colSpan: 1, rowSpan: 1, visible: false },
  { id: 'system', type: 'system', title: 'System Health', colSpan: 1, rowSpan: 1, visible: true },
  { id: 'events', type: 'events', title: 'Upcoming Events', colSpan: 1, rowSpan: 1, visible: true },
];

// Sound notification helper
function playAlertSound(type: 'critical' | 'warning' | 'info') {
  try {
    const ctx = new AudioContext();
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.connect(gain);
    gain.connect(ctx.destination);

    if (type === 'critical') {
      oscillator.frequency.value = 880;
      gain.gain.value = 0.3;
      oscillator.start();
      oscillator.stop(ctx.currentTime + 0.15);
      setTimeout(() => {
        const o2 = ctx.createOscillator();
        const g2 = ctx.createGain();
        o2.connect(g2);
        g2.connect(ctx.destination);
        o2.frequency.value = 880;
        g2.gain.value = 0.3;
        o2.start();
        o2.stop(ctx.currentTime + 0.15);
      }, 200);
    } else if (type === 'warning') {
      oscillator.frequency.value = 660;
      gain.gain.value = 0.2;
      oscillator.start();
      oscillator.stop(ctx.currentTime + 0.2);
    } else {
      oscillator.frequency.value = 440;
      gain.gain.value = 0.1;
      oscillator.start();
      oscillator.stop(ctx.currentTime + 0.1);
    }
  } catch {
    // AudioContext not available
  }
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function WidgetDesktopPage() {
  const { user } = useAuth();
  const siteId = user?.siteIds[0];

  const [widgets, setWidgets] = useState<WidgetConfig[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) return JSON.parse(saved);
    } catch { /* ignore */ }
    return DEFAULT_WIDGETS;
  });

  const [configOpen, setConfigOpen] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [flashingWidgets, setFlashingWidgets] = useState<Set<string>>(new Set());
  const containerRef = useRef<HTMLDivElement>(null);
  const prevAlertCount = useRef<number | null>(null);

  const confirmFire = useConfirmFire();
  const dismissFire = useDismissFire();

  // Data hooks
  const { data: alerts } = useAlerts(siteId);
  const { data: doors } = useDoors(siteId);
  const { data: cameras } = useCameras();
  const { data: cameraHealth } = useCameraHealth();
  const { data: activeVisitors } = useActiveVisitors();
  const { data: events } = useEvents();
  const { data: integrations } = useIntegrationHealth();
  const { data: rollCall } = useActiveRollCall();
  const { data: systemHealth } = useSystemHealth();
  const { lastEvent } = useWebSocket(siteId);

  // Save layout
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(widgets));
  }, [widgets]);

  // Flash + sound on new alerts
  useEffect(() => {
    if (!alerts) return;
    const currentCount = alerts.length;
    if (prevAlertCount.current !== null && currentCount > prevAlertCount.current) {
      const newest = alerts[0];
      const level = newest?.level || '';
      const isCritical = level === 'ACTIVE_THREAT' || level === 'LOCKDOWN';

      if (soundEnabled) {
        playAlertSound(isCritical ? 'critical' : 'warning');
      }

      setFlashingWidgets(prev => new Set(prev).add('alerts'));
      setTimeout(() => setFlashingWidgets(prev => {
        const next = new Set(prev);
        next.delete('alerts');
        return next;
      }), 5000);
    }
    prevAlertCount.current = currentCount;
  }, [alerts, soundEnabled]);

  // Flash on WS events
  useEffect(() => {
    if (!lastEvent) return;
    const evt = lastEvent.event;
    let widgetId: string | null = null;
    let sound: 'critical' | 'warning' | 'info' = 'info';

    if (evt === 'alert:created') { widgetId = 'alerts'; sound = 'critical'; }
    else if (evt === 'fire-alarm:suppressed') { widgetId = 'alerts'; sound = 'critical'; }
    else if (evt === 'fire-alarm:confirmed') { widgetId = 'alerts'; sound = 'critical'; }
    else if (evt.startsWith('door:')) { widgetId = 'doors'; sound = 'warning'; }
    else if (evt.startsWith('visitor:')) { widgetId = 'visitors'; sound = 'info'; }
    else if (evt.startsWith('rollcall:')) { widgetId = 'rollcall'; sound = 'warning'; }

    if (widgetId) {
      if (soundEnabled) playAlertSound(sound);
      setFlashingWidgets(prev => new Set(prev).add(widgetId!));
      setTimeout(() => setFlashingWidgets(prev => {
        const next = new Set(prev);
        next.delete(widgetId!);
        return next;
      }), 3000);
    }
  }, [lastEvent, soundEnabled]);

  const toggleWidget = useCallback((id: string) => {
    setWidgets(prev => prev.map(w => w.id === id ? { ...w, visible: !w.visible } : w));
  }, []);

  const resetLayout = useCallback(() => {
    setWidgets(DEFAULT_WIDGETS);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement && containerRef.current) {
      containerRef.current.requestFullscreen().then(() => setFullscreen(true)).catch(() => {});
    } else if (document.fullscreenElement) {
      document.exitFullscreen().then(() => setFullscreen(false)).catch(() => {});
    }
  }, []);

  useEffect(() => {
    const onFsChange = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  const moveWidget = useCallback((id: string, dir: 'up' | 'down') => {
    setWidgets(prev => {
      const idx = prev.findIndex(w => w.id === id);
      if (idx < 0) return prev;
      const swapIdx = dir === 'up' ? idx - 1 : idx + 1;
      if (swapIdx < 0 || swapIdx >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[swapIdx]] = [next[swapIdx], next[idx]];
      return next;
    });
  }, []);

  const resizeWidget = useCallback((id: string, col: number, row: number) => {
    setWidgets(prev => prev.map(w => w.id === id ? { ...w, colSpan: col, rowSpan: row } : w));
  }, []);

  const visibleWidgets = widgets.filter(w => w.visible);

  return (
    <div ref={containerRef} className="min-h-screen dark:bg-gray-950 bg-gray-100 p-2 sm:p-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h1 className="text-lg font-bold dark:text-white text-gray-900">Security Monitor</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setSoundEnabled(!soundEnabled)}
            className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
              soundEnabled
                ? 'bg-green-600/20 text-green-400 border border-green-600'
                : 'bg-gray-700/50 text-gray-400 border border-gray-600'
            }`}
          >
            {soundEnabled ? 'Sound ON' : 'Sound OFF'}
          </button>
          <button
            onClick={toggleFullscreen}
            className="px-3 py-1.5 rounded text-xs font-medium dark:bg-gray-700/50 bg-gray-200 dark:text-gray-300 text-gray-700 border dark:border-gray-600 border-gray-300"
          >
            {fullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
          </button>
          <button
            onClick={() => setConfigOpen(!configOpen)}
            className="px-3 py-1.5 rounded text-xs font-medium dark:bg-blue-600/20 bg-blue-100 text-blue-400 border border-blue-600"
          >
            Configure
          </button>
        </div>
      </div>

      {/* Configuration Panel */}
      {configOpen && (
        <div className="mb-4 p-4 rounded-lg dark:bg-gray-800 bg-white border dark:border-gray-700 border-gray-200">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold dark:text-gray-200 text-gray-800">Widget Configuration</h2>
            <button onClick={resetLayout} className="text-xs text-red-400 hover:text-red-300">Reset to Default</button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
            {widgets.map((w) => (
              <div key={w.id} className="flex items-center gap-2">
                <label className="flex items-center gap-2 cursor-pointer text-xs dark:text-gray-300 text-gray-700">
                  <input type="checkbox" checked={w.visible} onChange={() => toggleWidget(w.id)} className="rounded" />
                  {w.title}
                </label>
                {w.visible && (
                  <div className="flex gap-0.5 ml-auto">
                    <button onClick={() => moveWidget(w.id, 'up')} className="text-[10px] dark:text-gray-500 text-gray-400 hover:text-blue-400" title="Move up">^</button>
                    <button onClick={() => moveWidget(w.id, 'down')} className="text-[10px] dark:text-gray-500 text-gray-400 hover:text-blue-400" title="Move down">v</button>
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="mt-3 border-t dark:border-gray-700 border-gray-200 pt-3">
            <p className="text-xs dark:text-gray-500 text-gray-400 mb-2">Resize widgets (columns x rows):</p>
            <div className="flex flex-wrap gap-2">
              {visibleWidgets.map(w => (
                <div key={w.id} className="flex items-center gap-1 text-xs dark:text-gray-300 text-gray-700">
                  <span className="min-w-[80px]">{w.title}:</span>
                  <select
                    value={`${w.colSpan}x${w.rowSpan}`}
                    onChange={(e) => {
                      const [c, r] = e.target.value.split('x').map(Number);
                      resizeWidget(w.id, c, r);
                    }}
                    className="dark:bg-gray-700 bg-gray-100 text-xs rounded px-1 py-0.5 dark:border-gray-600 border-gray-300 border"
                  >
                    <option value="1x1">1x1</option>
                    <option value="1x2">1x2</option>
                    <option value="2x1">2x1</option>
                    <option value="2x2">2x2</option>
                    <option value="3x1">3x1</option>
                    <option value="3x2">3x2</option>
                    <option value="4x1">4x1 (full)</option>
                    <option value="4x2">4x2 (full)</option>
                  </select>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Fire Alarm Suppression Banner */}
      {(alerts || []).filter((a: any) => a.status === 'SUPPRESSED' && a.level === 'FIRE').map((fa: any) => (
        <div key={fa.id} className="mb-3 px-4 py-4 bg-red-600/20 border-2 border-red-500 rounded-lg animate-pulse">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div>
              <p className="text-base font-bold text-red-300">
                FIRE ALARM SUPPRESSED &mdash; {fa.buildingName}
              </p>
              <p className="text-sm text-red-200 mt-1">
                Fire alarm during active lockdown. Doors remain LOCKED. Confirm real fire or dismiss.
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
                CONFIRM FIRE
              </button>
              <button
                onClick={() => {
                  if (window.confirm('Dismiss fire alarm as false alarm?')) {
                    dismissFire.mutate(fa.id);
                  }
                }}
                disabled={dismissFire.isPending}
                className="px-4 py-2 bg-gray-600 hover:bg-gray-500 text-white rounded-lg text-sm font-bold transition-colors disabled:opacity-50"
              >
                False Alarm
              </button>
            </div>
          </div>
        </div>
      ))}

      {/* Widget Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3 auto-rows-[minmax(180px,auto)]">
        {visibleWidgets.map((w) => (
          <WidgetFrame
            key={w.id}
            config={w}
            flashing={flashingWidgets.has(w.id)}
          >
            <WidgetContent
              type={w.type}
              alerts={alerts}
              doors={doors}
              cameras={cameras}
              cameraHealth={cameraHealth}
              activeVisitors={activeVisitors}
              events={events}
              integrations={integrations}
              rollCall={rollCall}
              systemHealth={systemHealth}
            />
          </WidgetFrame>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Widget Frame (handles flashing border, col/row span)
// ---------------------------------------------------------------------------

function WidgetFrame({
  config,
  flashing,
  children,
}: {
  config: WidgetConfig;
  flashing: boolean;
  children: React.ReactNode;
}) {
  const colClass = config.colSpan === 1 ? 'sm:col-span-1' : config.colSpan === 2 ? 'sm:col-span-2' : config.colSpan === 3 ? 'lg:col-span-3' : 'lg:col-span-4';
  const rowClass = config.rowSpan === 1 ? 'row-span-1' : config.rowSpan === 2 ? 'row-span-2' : 'row-span-3';

  return (
    <div
      className={`rounded-lg overflow-hidden flex flex-col ${colClass} ${rowClass} transition-all duration-300 ${
        flashing
          ? 'border-2 border-red-500 animate-pulse shadow-lg shadow-red-500/30'
          : 'border dark:border-gray-700 border-gray-200'
      } dark:bg-gray-800/90 bg-white`}
    >
      <div className={`px-3 py-2 flex items-center justify-between flex-shrink-0 ${
        flashing ? 'dark:bg-red-900/40 bg-red-50' : 'dark:bg-gray-800 bg-gray-50'
      } border-b dark:border-gray-700 border-gray-200`}>
        <h3 className={`text-xs font-semibold uppercase tracking-wide ${
          flashing ? 'text-red-400' : 'dark:text-gray-400 text-gray-500'
        }`}>
          {config.title}
        </h3>
        {flashing && (
          <span className="w-2 h-2 rounded-full bg-red-500 animate-ping" />
        )}
      </div>
      <div className="flex-1 overflow-auto p-3">
        {children}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Widget Content Router
// ---------------------------------------------------------------------------

function WidgetContent({
  type,
  alerts,
  doors,
  cameras,
  cameraHealth,
  activeVisitors,
  events,
  integrations,
  rollCall,
  systemHealth,
}: {
  type: WidgetType;
  alerts: any;
  doors: any;
  cameras: any;
  cameraHealth: any;
  activeVisitors: any;
  events: any;
  integrations: any;
  rollCall: any;
  systemHealth: any;
}) {
  switch (type) {
    case 'clock': return <ClockWidget />;
    case 'calendar': return <CalendarWidget events={events} />;
    case 'alerts': return <AlertLogWidget alerts={alerts} />;
    case 'cameras': return <CameraWidget cameras={cameras} health={cameraHealth} />;
    case 'doors': return <DoorWidget doors={doors} />;
    case 'visitors': return <VisitorWidget visitors={activeVisitors} />;
    case 'integrations': return <IntegrationWidget integrations={integrations} />;
    case 'rollcall': return <RollCallWidget rollCall={rollCall} />;
    case 'system': return <SystemWidget health={systemHealth} />;
    case 'events': return <EventListWidget events={events} />;
    default: return <div className="text-xs dark:text-gray-500 text-gray-400">Unknown widget</div>;
  }
}

// ---------------------------------------------------------------------------
// Clock Widget
// ---------------------------------------------------------------------------

function ClockWidget() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="flex flex-col items-center justify-center h-full">
      <div className="text-4xl sm:text-5xl font-mono font-bold dark:text-white text-gray-900 tabular-nums">
        {now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
      </div>
      <div className="text-sm dark:text-gray-400 text-gray-500 mt-2">
        {now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Calendar Widget
// ---------------------------------------------------------------------------

function CalendarWidget({ events }: { events: any[] | undefined }) {
  const [currentDate] = useState(new Date());
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = currentDate.getDate();

  const eventDays = new Set<number>();
  if (events) {
    for (const ev of events) {
      const d = new Date(ev.startTime);
      if (d.getMonth() === month && d.getFullYear() === year) {
        eventDays.add(d.getDate());
      }
    }
  }

  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  return (
    <div className="h-full flex flex-col">
      <div className="text-center text-sm font-semibold dark:text-gray-300 text-gray-700 mb-2">
        {currentDate.toLocaleDateString([], { month: 'long', year: 'numeric' })}
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center text-[10px] dark:text-gray-500 text-gray-400 mb-1">
        {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(d => <div key={d}>{d}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-0.5 flex-1">
        {cells.map((day, i) => (
          <div key={i} className={`flex items-center justify-center text-xs rounded relative ${
            day === today
              ? 'bg-blue-600 text-white font-bold'
              : day
                ? 'dark:text-gray-300 text-gray-700'
                : ''
          }`}>
            {day || ''}
            {day && eventDays.has(day) && (
              <span className="absolute bottom-0 w-1 h-1 rounded-full bg-orange-400" />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Alert Log Widget
// ---------------------------------------------------------------------------

function AlertLogWidget({ alerts }: { alerts: any[] | undefined }) {
  if (!alerts || alerts.length === 0) {
    return <div className="text-xs dark:text-gray-500 text-gray-400 text-center py-4">No recent alerts</div>;
  }

  const levelColor: Record<string, string> = {
    ACTIVE_THREAT: 'text-red-400 bg-red-500/10',
    LOCKDOWN: 'text-orange-400 bg-orange-500/10',
    FIRE: 'text-yellow-400 bg-yellow-500/10',
    MEDICAL: 'text-blue-400 bg-blue-500/10',
    WEATHER: 'text-purple-400 bg-purple-500/10',
    ALL_CLEAR: 'text-green-400 bg-green-500/10',
  };

  const statusDot: Record<string, string> = {
    TRIGGERED: 'bg-red-500 animate-pulse',
    ACKNOWLEDGED: 'bg-yellow-500',
    DISPATCHED: 'bg-blue-500',
    RESOLVED: 'bg-green-500',
    CANCELLED: 'bg-gray-500',
  };

  return (
    <div className="space-y-1.5">
      {alerts.slice(0, 20).map((alert: any) => (
        <div key={alert.id} className="flex items-start gap-2 text-xs">
          <span className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${statusDot[alert.status] || 'bg-gray-500'}`} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${levelColor[alert.level] || 'text-gray-400 bg-gray-500/10'}`}>
                {alert.level}
              </span>
              <span className="dark:text-gray-400 text-gray-500 truncate">{alert.buildingName}</span>
            </div>
            {alert.message && <p className="dark:text-gray-500 text-gray-400 truncate mt-0.5">{alert.message}</p>}
            <span className="dark:text-gray-600 text-gray-400 text-[10px]">
              {new Date(alert.triggeredAt).toLocaleTimeString()}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Camera Widget
// ---------------------------------------------------------------------------

function CameraWidget({ cameras, health }: { cameras: any[] | undefined; health: any }) {
  const [selectedCamera, setSelectedCamera] = useState<string | null>(null);

  const onlineCams = (cameras || []).filter((c: any) => c.status === 'ONLINE');
  const displayCams = onlineCams.slice(0, 4);

  return (
    <div className="h-full flex flex-col">
      {health && (
        <div className="flex gap-3 mb-2 text-[10px]">
          <span className="text-green-400">{health.online} online</span>
          <span className="text-red-400">{health.offline} offline</span>
          <span className="dark:text-gray-500 text-gray-400">{health.total} total</span>
        </div>
      )}
      <div className="grid grid-cols-2 gap-1 flex-1">
        {displayCams.length === 0 ? (
          <div className="col-span-2 flex items-center justify-center dark:text-gray-500 text-gray-400 text-xs">No cameras online</div>
        ) : (
          displayCams.map((cam: any) => (
            <div
              key={cam.id}
              className={`relative rounded overflow-hidden dark:bg-gray-900 bg-gray-200 cursor-pointer border ${
                selectedCamera === cam.id ? 'border-blue-500' : 'dark:border-gray-700 border-gray-300'
              }`}
              onClick={() => setSelectedCamera(selectedCamera === cam.id ? null : cam.id)}
            >
              <img
                src={getSnapshotUrl(cam.id)}
                alt={cam.name}
                className="w-full h-full object-cover"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
              <div className="absolute bottom-0 left-0 right-0 px-1.5 py-0.5 bg-black/60 text-[10px] text-white truncate">
                {cam.name}
              </div>
              <div className={`absolute top-1 right-1 w-2 h-2 rounded-full ${
                cam.status === 'ONLINE' ? 'bg-green-500' : 'bg-red-500'
              }`} />
            </div>
          ))
        )}
      </div>
      {cameras && cameras.length > 4 && (
        <div className="text-[10px] dark:text-gray-500 text-gray-400 mt-1 text-center">
          +{cameras.length - 4} more cameras
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Door / Access Widget
// ---------------------------------------------------------------------------

function DoorWidget({ doors }: { doors: any[] | undefined }) {
  if (!doors || doors.length === 0) {
    return <div className="text-xs dark:text-gray-500 text-gray-400 text-center">No doors configured</div>;
  }

  const statusCounts = { LOCKED: 0, UNLOCKED: 0, OPEN: 0, FORCED: 0, HELD: 0, UNKNOWN: 0 };
  for (const d of doors) {
    const s = d.status as keyof typeof statusCounts;
    if (s in statusCounts) statusCounts[s]++;
  }

  const statusColor: Record<string, string> = {
    LOCKED: 'text-green-400',
    UNLOCKED: 'text-yellow-400',
    OPEN: 'text-blue-400',
    FORCED: 'text-red-400',
    HELD: 'text-orange-400',
    UNKNOWN: 'text-gray-500',
  };

  return (
    <div className="h-full flex flex-col">
      <div className="text-2xl font-bold dark:text-white text-gray-900 mb-2">{doors.length} Doors</div>
      <div className="grid grid-cols-3 gap-1 mb-3">
        {Object.entries(statusCounts).filter(([, v]) => v > 0).map(([status, count]) => (
          <div key={status} className="text-center">
            <div className={`text-lg font-bold ${statusColor[status]}`}>{count}</div>
            <div className="text-[10px] dark:text-gray-500 text-gray-400">{status}</div>
          </div>
        ))}
      </div>
      <div className="flex-1 overflow-auto space-y-0.5">
        {doors.slice(0, 15).map((door: any) => {
          const dotColor = door.status === 'LOCKED' ? 'bg-green-500'
            : door.status === 'FORCED' ? 'bg-red-500 animate-pulse'
            : door.status === 'HELD' ? 'bg-orange-500 animate-pulse'
            : door.status === 'UNLOCKED' ? 'bg-yellow-500'
            : 'bg-gray-500';
          return (
            <div key={door.id} className="flex items-center gap-2 text-xs">
              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dotColor}`} />
              <span className="dark:text-gray-300 text-gray-700 truncate flex-1">{door.name}</span>
              <span className="dark:text-gray-500 text-gray-400 text-[10px]">{door.status}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Visitor Count Widget
// ---------------------------------------------------------------------------

function VisitorWidget({ visitors }: { visitors: any[] | undefined }) {
  const count = visitors?.length || 0;

  return (
    <div className="h-full flex flex-col items-center justify-center">
      <div className="text-5xl font-bold dark:text-white text-gray-900">{count}</div>
      <div className="text-sm dark:text-gray-400 text-gray-500 mt-1">Active Visitors</div>
      {visitors && visitors.length > 0 && (
        <div className="mt-3 w-full space-y-0.5 max-h-24 overflow-auto">
          {visitors.slice(0, 5).map((v: any) => (
            <div key={v.id} className="text-xs dark:text-gray-400 text-gray-500 truncate text-center">
              {v.firstName} {v.lastName}
            </div>
          ))}
          {visitors.length > 5 && (
            <div className="text-[10px] dark:text-gray-600 text-gray-400 text-center">+{visitors.length - 5} more</div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Integration Health Widget
// ---------------------------------------------------------------------------

function IntegrationWidget({ integrations }: { integrations: any[] | undefined }) {
  if (!integrations || integrations.length === 0) {
    return <div className="text-xs dark:text-gray-500 text-gray-400 text-center">No integrations configured</div>;
  }

  return (
    <div className="space-y-1.5">
      {integrations.map((int: any) => {
        const color = int.status?.includes('HEALTHY') ? 'bg-green-500'
          : int.status?.includes('DEGRADED') ? 'bg-yellow-500'
          : int.status?.includes('DOWN') ? 'bg-red-500 animate-pulse'
          : 'bg-gray-500';
        return (
          <div key={int.id} className="flex items-center justify-between text-xs">
            <span className="dark:text-gray-300 text-gray-700 truncate">{int.integrationName}</span>
            <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${color}`} />
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Roll Call Widget
// ---------------------------------------------------------------------------

function RollCallWidget({ rollCall }: { rollCall: any }) {
  if (!rollCall) {
    return (
      <div className="h-full flex items-center justify-center">
        <span className="text-xs dark:text-gray-500 text-gray-400">No active roll call</span>
      </div>
    );
  }

  const classroomPct = Math.round((rollCall.reportedClassrooms / Math.max(rollCall.totalClassrooms, 1)) * 100);
  const studentPct = Math.round((rollCall.accountedStudents / Math.max(rollCall.totalStudents, 1)) * 100);

  return (
    <div className="space-y-3">
      <div>
        <div className="flex justify-between text-xs dark:text-gray-300 text-gray-700 mb-1">
          <span>Classrooms</span>
          <span className="font-mono">{rollCall.reportedClassrooms}/{rollCall.totalClassrooms}</span>
        </div>
        <div className="h-2 dark:bg-gray-700 bg-gray-200 rounded-full overflow-hidden">
          <div className="h-full bg-orange-500 rounded-full transition-all" style={{ width: `${classroomPct}%` }} />
        </div>
      </div>
      <div>
        <div className="flex justify-between text-xs dark:text-gray-300 text-gray-700 mb-1">
          <span>Students</span>
          <span className="font-mono">{rollCall.accountedStudents}/{rollCall.totalStudents}</span>
        </div>
        <div className="h-2 dark:bg-gray-700 bg-gray-200 rounded-full overflow-hidden">
          <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${studentPct}%` }} />
        </div>
      </div>
      {rollCall.reports?.some((r: any) => r.studentsMissing?.length > 0) && (
        <div className="text-xs text-red-400 font-medium">
          Missing: {rollCall.reports.flatMap((r: any) => r.studentsMissing || []).join(', ')}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// System Health Widget
// ---------------------------------------------------------------------------

function SystemWidget({ health }: { health: any }) {
  if (!health) {
    return <div className="text-xs dark:text-gray-500 text-gray-400 text-center">Loading...</div>;
  }

  const items = [
    { label: 'API', status: 'ok' },
    { label: 'Database', status: health.database || 'ok' },
    { label: 'Redis', status: health.redis || 'ok' },
    { label: 'Workers', status: health.workers || 'ok' },
  ];

  return (
    <div className="space-y-2">
      {items.map(item => (
        <div key={item.label} className="flex items-center justify-between text-xs">
          <span className="dark:text-gray-300 text-gray-700">{item.label}</span>
          <span className={`w-2.5 h-2.5 rounded-full ${
            item.status === 'ok' || item.status === 'healthy' ? 'bg-green-500' : 'bg-red-500 animate-pulse'
          }`} />
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Events List Widget
// ---------------------------------------------------------------------------

function EventListWidget({ events }: { events: any[] | undefined }) {
  if (!events || events.length === 0) {
    return <div className="text-xs dark:text-gray-500 text-gray-400 text-center">No upcoming events</div>;
  }

  const upcoming = events
    .filter((e: any) => new Date(e.startTime) > new Date() || e.status === 'ACTIVE_EVENT')
    .slice(0, 8);

  if (upcoming.length === 0) {
    return <div className="text-xs dark:text-gray-500 text-gray-400 text-center">No upcoming events</div>;
  }

  return (
    <div className="space-y-1.5">
      {upcoming.map((ev: any) => (
        <div key={ev.id} className="text-xs">
          <div className="flex items-center gap-1.5">
            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
              ev.status === 'ACTIVE_EVENT' ? 'bg-green-500 animate-pulse' : 'bg-blue-500'
            }`} />
            <span className="dark:text-gray-300 text-gray-700 truncate font-medium">{ev.name}</span>
          </div>
          <div className="dark:text-gray-500 text-gray-400 text-[10px] ml-3">
            {new Date(ev.startTime).toLocaleDateString([], { month: 'short', day: 'numeric' })}{' '}
            {new Date(ev.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </div>
        </div>
      ))}
    </div>
  );
}
