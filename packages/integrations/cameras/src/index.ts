/**
 * Camera / VMS Integration Module
 *
 * Provides a unified interface for managing IP cameras and video
 * management systems. Supports ONVIF-compliant cameras (WS-Discovery,
 * RTSP, PTZ) and Genetec Security Center VMS (HLS, REST API).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Camera {
  id: string;
  name: string;
  model: string;
  manufacturer: string;
  location: {
    buildingId?: string;
    floor?: number;
    zone?: string;
    description?: string;
  };
  status: 'ONLINE' | 'OFFLINE' | 'ERROR' | 'UNKNOWN';
  capabilities: {
    ptz: boolean;
    audio: boolean;
    analytics: boolean;
    ir: boolean;
  };
}

export interface StreamInfo {
  url: string;
  protocol: 'rtsp' | 'hls' | 'webrtc';
}

export interface PTZCommand {
  pan?: number;   // -1.0 (left) to 1.0 (right)
  tilt?: number;  // -1.0 (down) to 1.0 (up)
  zoom?: number;  // -1.0 (wide) to 1.0 (tele)
}

export interface MotionEvent {
  cameraId: string;
  timestamp: Date;
  region: string;
  confidence: number;
}

export interface CameraConfig {
  type: string;
  /** ONVIF: camera IP/hostname; Genetec: VMS base URL */
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  /** Genetec OAuth2 */
  clientId?: string;
  clientSecret?: string;
  /** Additional vendor-specific options */
  options?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Adapter Interface
// ---------------------------------------------------------------------------

export interface CameraAdapter {
  name: string;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  getCameras(): Promise<Camera[]>;
  getStream(cameraId: string): Promise<StreamInfo>;
  getSnapshot(cameraId: string): Promise<Buffer>;
  ptzControl(cameraId: string, command: PTZCommand): Promise<void>;
  onMotionEvent(callback: (event: MotionEvent) => void): void;
}

// ---------------------------------------------------------------------------
// Adapter Exports
// ---------------------------------------------------------------------------

export { OnvifAdapter } from './adapters/onvif.js';
export { GenetecVmsAdapter } from './adapters/genetec-vms.js';
export { discoverOnvifDevices, type DiscoveredDevice } from './onvif-discovery.js';

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

import { OnvifAdapter } from './adapters/onvif.js';
import { GenetecVmsAdapter } from './adapters/genetec-vms.js';

const adapterRegistry: Record<string, new (config: CameraConfig) => CameraAdapter> = {
  onvif: OnvifAdapter,
  genetec: GenetecVmsAdapter,
};

/**
 * Create a camera adapter by type name.
 */
export function createCameraAdapter(type: string, config: CameraConfig): CameraAdapter {
  const AdapterClass = adapterRegistry[type.toLowerCase()];
  if (!AdapterClass) {
    throw new Error(
      `Unknown camera adapter: ${type}. Supported: ${Object.keys(adapterRegistry).join(', ')}`,
    );
  }
  return new AdapterClass(config);
}
