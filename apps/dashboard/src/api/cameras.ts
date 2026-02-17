import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from './client';

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

export interface CameraHealth {
  total: number;
  online: number;
  offline: number;
  error: number;
  ptzCapable: number;
  analyticsEnabled: number;
  adapter: string;
}

export interface DiscoveredDevice {
  serviceUrl: string;
  ipAddress: string;
  scopes: string[];
}

export interface RecordingResult {
  cameraId: string;
  recordings: { id: string; startTime: string; endTime: string; duration: number }[];
  message?: string;
  nvrAccess?: Record<string, string>;
}

export function useCameras() {
  return useQuery({
    queryKey: ['cameras'],
    queryFn: () => apiClient.get('/api/v1/cameras') as Promise<Camera[]>,
    refetchInterval: 30000,
  });
}

export function useCameraHealth() {
  return useQuery({
    queryKey: ['cameras', 'health'],
    queryFn: () => apiClient.get('/api/v1/cameras/health') as Promise<CameraHealth>,
    refetchInterval: 30000,
  });
}

export function useCameraStream(cameraId: string | null) {
  return useQuery({
    queryKey: ['cameras', cameraId, 'stream'],
    queryFn: () => apiClient.get(`/api/v1/cameras/${cameraId}/stream`) as Promise<StreamInfo>,
    enabled: !!cameraId,
  });
}

export function useCameraRecordings(cameraId: string | null) {
  return useQuery({
    queryKey: ['cameras', cameraId, 'recordings'],
    queryFn: () => apiClient.get(`/api/v1/cameras/${cameraId}/recordings`) as Promise<RecordingResult>,
    enabled: !!cameraId,
  });
}

export function usePtzControl() {
  return useMutation({
    mutationFn: ({ cameraId, pan, tilt, zoom }: { cameraId: string; pan?: number; tilt?: number; zoom?: number }) =>
      apiClient.post(`/api/v1/cameras/${cameraId}/ptz`, { pan, tilt, zoom }),
  });
}

export function useDiscoverCameras() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (timeoutMs?: number) =>
      apiClient.post('/api/v1/cameras/discover', { timeoutMs }) as Promise<{ devices: DiscoveredDevice[]; count: number }>,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cameras'] });
    },
  });
}

export function getSnapshotUrl(cameraId: string): string {
  const baseUrl = (import.meta as any).env?.VITE_API_URL || '';
  return `${baseUrl}/api/v1/cameras/${cameraId}/snapshot`;
}
