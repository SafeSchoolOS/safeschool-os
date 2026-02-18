import { useState } from 'react';
import {
  useCameras,
  useCameraHealth,
  useCameraStream,
  useCameraRecordings,
  usePtzControl,
  useDiscoverCameras,
  getSnapshotUrl,
  type Camera,
} from '../api/cameras';
import { useAuth } from '../hooks/useAuth';

const STATUS_COLORS: Record<string, string> = {
  ONLINE: 'bg-green-500',
  OFFLINE: 'bg-red-500',
  ERROR: 'bg-yellow-500',
  UNKNOWN: 'bg-gray-500',
};

export function CameraPage() {
  const { user } = useAuth();
  const { data: cameras, isLoading } = useCameras();
  const { data: health } = useCameraHealth();
  const discoverMutation = useDiscoverCameras();
  const ptzMutation = usePtzControl();

  const [selectedCamera, setSelectedCamera] = useState<Camera | null>(null);
  const [viewMode, setViewMode] = useState<'grid' | 'single'>('grid');
  const [showDiscovery, setShowDiscovery] = useState(false);
  const [showRecordings, setShowRecordings] = useState(false);

  const { data: streamInfo } = useCameraStream(selectedCamera?.id || null);
  const { data: recordingResult } = useCameraRecordings(showRecordings && selectedCamera ? selectedCamera.id : null);

  const isAdmin = user?.role === 'SITE_ADMIN' || user?.role === 'SUPER_ADMIN';

  const handlePtz = (direction: string) => {
    if (!selectedCamera) return;
    const commands: Record<string, { pan?: number; tilt?: number; zoom?: number }> = {
      left: { pan: -0.5 },
      right: { pan: 0.5 },
      up: { tilt: 0.5 },
      down: { tilt: -0.5 },
      zoomIn: { zoom: 0.5 },
      zoomOut: { zoom: -0.5 },
    };
    ptzMutation.mutate({ cameraId: selectedCamera.id, ...commands[direction] });
  };

  return (
    <div className="p-4 sm:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-bold dark:text-white text-gray-900">Cameras & NVR</h2>
          <p className="text-sm dark:text-gray-400 text-gray-500 mt-1">
            Live camera feeds, PTZ control, and recording access
          </p>
        </div>
        <div className="flex items-center gap-3">
          {health && (
            <div className="flex items-center gap-4 dark:bg-gray-800 bg-white border dark:border-gray-700 border-gray-200 rounded-lg px-4 py-2 text-sm">
              <span><span className="font-bold dark:text-white text-gray-900">{health.total}</span> <span className="dark:text-gray-400 text-gray-500">total</span></span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 bg-green-500 rounded-full" />{health.online}</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 bg-red-500 rounded-full" />{health.offline}</span>
              {health.error > 0 && <span className="flex items-center gap-1"><span className="w-2 h-2 bg-yellow-500 rounded-full" />{health.error}</span>}
            </div>
          )}
          <div className="flex items-center dark:bg-gray-800 bg-white border dark:border-gray-700 border-gray-200 rounded-lg overflow-hidden">
            <button
              onClick={() => setViewMode('grid')}
              className={`px-3 py-2 text-sm ${viewMode === 'grid' ? 'bg-blue-600 text-white' : 'dark:text-gray-400 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700'}`}
            >
              Grid
            </button>
            <button
              onClick={() => setViewMode('single')}
              className={`px-3 py-2 text-sm ${viewMode === 'single' ? 'bg-blue-600 text-white' : 'dark:text-gray-400 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700'}`}
            >
              Single
            </button>
          </div>
          {isAdmin && (
            <button
              onClick={() => { setShowDiscovery(true); discoverMutation.mutate(5000); }}
              disabled={discoverMutation.isPending}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {discoverMutation.isPending ? 'Discovering...' : 'Discover Cameras'}
            </button>
          )}
        </div>
      </div>

      {/* Discovery Results */}
      {showDiscovery && discoverMutation.data && (
        <div className="dark:bg-gray-800 bg-white border dark:border-gray-700 border-gray-200 rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold dark:text-gray-300 text-gray-700">
              ONVIF Discovery — {discoverMutation.data.count} device(s) found
            </h3>
            <button onClick={() => setShowDiscovery(false)} className="text-sm dark:text-gray-400 text-gray-500 hover:underline">Dismiss</button>
          </div>
          {discoverMutation.data.devices.length === 0 ? (
            <p className="text-sm dark:text-gray-400 text-gray-500">No ONVIF cameras found on the local network.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {discoverMutation.data.devices.map((d, i) => (
                <div key={i} className="dark:bg-gray-700/50 bg-gray-50 rounded-lg p-3 text-sm">
                  <div className="font-mono dark:text-white text-gray-900">{d.ipAddress}</div>
                  <div className="dark:text-gray-400 text-gray-500 truncate text-xs mt-1">{d.serviceUrl}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Camera Grid / Single View */}
      {isLoading ? (
        <div className="dark:bg-gray-800 bg-white border dark:border-gray-700 border-gray-200 rounded-lg p-16 text-center dark:text-gray-400 text-gray-500">
          Loading cameras...
        </div>
      ) : !cameras?.length ? (
        <div className="dark:bg-gray-800 bg-white border dark:border-gray-700 border-gray-200 rounded-lg p-16 text-center">
          <p className="dark:text-gray-400 text-gray-500">No cameras configured. Set <code className="dark:bg-gray-700 bg-gray-100 px-1 rounded">CAMERA_ADAPTER</code> to onvif, genetec, milestone, or avigilon.</p>
        </div>
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {cameras.map((cam) => (
            <div
              key={cam.id}
              onClick={() => { setSelectedCamera(cam); setViewMode('single'); }}
              className="dark:bg-gray-800 bg-white border dark:border-gray-700 border-gray-200 rounded-lg overflow-hidden cursor-pointer hover:ring-2 hover:ring-blue-500 transition-all"
            >
              <div className="aspect-video bg-gray-900 flex items-center justify-center relative">
                <img
                  src={getSnapshotUrl(cam.id)}
                  alt={cam.name}
                  className="w-full h-full object-cover"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />
                <div className="absolute top-2 right-2 flex items-center gap-1.5">
                  <span className={`w-2 h-2 rounded-full ${STATUS_COLORS[cam.status]}`} />
                  <span className="text-xs text-white bg-black/50 px-1.5 py-0.5 rounded">{cam.status}</span>
                </div>
                {cam.capabilities.ptz && (
                  <span className="absolute bottom-2 right-2 text-xs text-white bg-blue-600/80 px-1.5 py-0.5 rounded">PTZ</span>
                )}
              </div>
              <div className="p-3">
                <div className="font-medium dark:text-white text-gray-900 text-sm truncate">{cam.name}</div>
                <div className="text-xs dark:text-gray-400 text-gray-500 mt-0.5">
                  {cam.manufacturer} {cam.model}
                </div>
                {cam.location.description && (
                  <div className="text-xs dark:text-gray-500 text-gray-400 mt-0.5 truncate">{cam.location.description}</div>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : selectedCamera ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main View */}
          <div className="lg:col-span-2 space-y-4">
            <div className="dark:bg-gray-800 bg-white border dark:border-gray-700 border-gray-200 rounded-lg overflow-hidden">
              <div className="aspect-video bg-gray-900 flex items-center justify-center relative">
                <img
                  src={getSnapshotUrl(selectedCamera.id)}
                  alt={selectedCamera.name}
                  className="w-full h-full object-cover"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />
                <div className="absolute top-3 left-3 text-white bg-black/50 px-2 py-1 rounded text-sm">
                  {selectedCamera.name}
                </div>
                <div className="absolute top-3 right-3 flex items-center gap-1.5">
                  <span className={`w-2 h-2 rounded-full ${STATUS_COLORS[selectedCamera.status]}`} />
                  <span className="text-xs text-white bg-black/50 px-1.5 py-0.5 rounded">{selectedCamera.status}</span>
                </div>
              </div>
              <div className="p-3 flex items-center justify-between">
                <div className="text-sm dark:text-gray-400 text-gray-500">
                  {selectedCamera.manufacturer} {selectedCamera.model}
                  {streamInfo && <span className="ml-2 dark:text-gray-500 text-gray-400">({streamInfo.protocol.toUpperCase()})</span>}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setShowRecordings(!showRecordings)}
                    className="px-3 py-1.5 text-sm dark:bg-gray-700 bg-gray-100 dark:text-gray-300 text-gray-700 rounded hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                  >
                    Recordings
                  </button>
                  <button
                    onClick={() => { setSelectedCamera(null); setViewMode('grid'); }}
                    className="px-3 py-1.5 text-sm dark:bg-gray-700 bg-gray-100 dark:text-gray-300 text-gray-700 rounded hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                  >
                    Back to Grid
                  </button>
                </div>
              </div>
            </div>

            {/* Recordings Panel */}
            {showRecordings && (
              <div className="dark:bg-gray-800 bg-white border dark:border-gray-700 border-gray-200 rounded-lg p-4">
                <h3 className="text-sm font-semibold dark:text-gray-300 text-gray-700 mb-3">Recordings (Last 24h)</h3>
                {recordingResult?.recordings?.length ? (
                  <div className="space-y-2">
                    {recordingResult.recordings.map((r: any, i: number) => (
                      <div key={i} className="flex items-center justify-between dark:bg-gray-700/50 bg-gray-50 rounded p-2 text-sm">
                        <span className="dark:text-gray-300 text-gray-700">{new Date(r.startTime).toLocaleString()}</span>
                        <span className="dark:text-gray-400 text-gray-500">{r.duration}s</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-sm dark:text-gray-400 text-gray-500">
                    {recordingResult?.message || 'No recordings found. Access your NVR/VMS directly for clip export.'}
                    {recordingResult?.nvrAccess && (
                      <div className="mt-2 space-y-1">
                        {Object.entries(recordingResult.nvrAccess).filter(([k]) => k !== 'note').map(([vendor, path]) => (
                          <div key={vendor} className="dark:text-gray-500 text-gray-400">
                            <span className="font-medium capitalize">{vendor}:</span> {path as string}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Side Panel */}
          <div className="space-y-4">
            {/* PTZ Controls */}
            {selectedCamera.capabilities.ptz && (
              <div className="dark:bg-gray-800 bg-white border dark:border-gray-700 border-gray-200 rounded-lg p-4">
                <h3 className="text-sm font-semibold dark:text-gray-300 text-gray-700 mb-3">PTZ Control</h3>
                <div className="grid grid-cols-3 gap-2 max-w-[180px] mx-auto">
                  <div />
                  <button onClick={() => handlePtz('up')} className="p-2 dark:bg-gray-700 bg-gray-100 rounded hover:bg-blue-600 hover:text-white transition-colors">
                    <svg className="w-5 h-5 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" /></svg>
                  </button>
                  <div />
                  <button onClick={() => handlePtz('left')} className="p-2 dark:bg-gray-700 bg-gray-100 rounded hover:bg-blue-600 hover:text-white transition-colors">
                    <svg className="w-5 h-5 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
                  </button>
                  <div className="p-2 dark:bg-gray-700/50 bg-gray-50 rounded flex items-center justify-center">
                    <span className="w-2 h-2 bg-blue-500 rounded-full" />
                  </div>
                  <button onClick={() => handlePtz('right')} className="p-2 dark:bg-gray-700 bg-gray-100 rounded hover:bg-blue-600 hover:text-white transition-colors">
                    <svg className="w-5 h-5 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
                  </button>
                  <div />
                  <button onClick={() => handlePtz('down')} className="p-2 dark:bg-gray-700 bg-gray-100 rounded hover:bg-blue-600 hover:text-white transition-colors">
                    <svg className="w-5 h-5 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
                  </button>
                  <div />
                </div>
                <div className="flex gap-2 mt-3 justify-center">
                  <button onClick={() => handlePtz('zoomIn')} className="px-3 py-1.5 text-sm dark:bg-gray-700 bg-gray-100 rounded hover:bg-blue-600 hover:text-white transition-colors">Zoom +</button>
                  <button onClick={() => handlePtz('zoomOut')} className="px-3 py-1.5 text-sm dark:bg-gray-700 bg-gray-100 rounded hover:bg-blue-600 hover:text-white transition-colors">Zoom -</button>
                </div>
              </div>
            )}

            {/* Camera Info */}
            <div className="dark:bg-gray-800 bg-white border dark:border-gray-700 border-gray-200 rounded-lg p-4">
              <h3 className="text-sm font-semibold dark:text-gray-300 text-gray-700 mb-3">Camera Details</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="dark:text-gray-400 text-gray-500">Manufacturer</span>
                  <span className="dark:text-gray-200 text-gray-800">{selectedCamera.manufacturer}</span>
                </div>
                <div className="flex justify-between">
                  <span className="dark:text-gray-400 text-gray-500">Model</span>
                  <span className="dark:text-gray-200 text-gray-800">{selectedCamera.model}</span>
                </div>
                <div className="flex justify-between">
                  <span className="dark:text-gray-400 text-gray-500">Status</span>
                  <span className="flex items-center gap-1.5">
                    <span className={`w-2 h-2 rounded-full ${STATUS_COLORS[selectedCamera.status]}`} />
                    {selectedCamera.status}
                  </span>
                </div>
                {selectedCamera.location.zone && (
                  <div className="flex justify-between">
                    <span className="dark:text-gray-400 text-gray-500">Zone</span>
                    <span className="dark:text-gray-200 text-gray-800">{selectedCamera.location.zone}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="dark:text-gray-400 text-gray-500">Capabilities</span>
                  <div className="flex gap-1">
                    {selectedCamera.capabilities.ptz && <span className="px-1.5 py-0.5 text-xs bg-blue-600/20 text-blue-400 rounded">PTZ</span>}
                    {selectedCamera.capabilities.audio && <span className="px-1.5 py-0.5 text-xs bg-green-600/20 text-green-400 rounded">Audio</span>}
                    {selectedCamera.capabilities.analytics && <span className="px-1.5 py-0.5 text-xs bg-purple-600/20 text-purple-400 rounded">AI</span>}
                    {selectedCamera.capabilities.ir && <span className="px-1.5 py-0.5 text-xs bg-red-600/20 text-red-400 rounded">IR</span>}
                  </div>
                </div>
              </div>
            </div>

            {/* Camera List */}
            <div className="dark:bg-gray-800 bg-white border dark:border-gray-700 border-gray-200 rounded-lg p-4">
              <h3 className="text-sm font-semibold dark:text-gray-300 text-gray-700 mb-3">All Cameras</h3>
              <div className="space-y-1 max-h-64 overflow-y-auto">
                {cameras?.map((cam) => (
                  <button
                    key={cam.id}
                    onClick={() => setSelectedCamera(cam)}
                    className={`w-full flex items-center gap-2 px-3 py-2 rounded text-sm text-left transition-colors ${
                      selectedCamera?.id === cam.id
                        ? 'bg-blue-600/20 text-blue-400'
                        : 'dark:text-gray-300 text-gray-700 dark:hover:bg-gray-700/50 hover:bg-gray-50'
                    }`}
                  >
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${STATUS_COLORS[cam.status]}`} />
                    <span className="truncate">{cam.name}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="dark:bg-gray-800 bg-white border dark:border-gray-700 border-gray-200 rounded-lg p-16 text-center dark:text-gray-400 text-gray-500">
          Select a camera from the grid to view details.
        </div>
      )}
    </div>
  );
}
