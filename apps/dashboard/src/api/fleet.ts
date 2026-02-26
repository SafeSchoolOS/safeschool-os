import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from './client';

export interface EdgeDevice {
  id: string;
  siteId: string;
  name: string | null;
  activationKey: string | null;
  currentVersion: string | null;
  targetVersion: string | null;
  operatingMode: string | null;
  pendingChanges: number;
  upgradeStatus: 'IDLE' | 'PENDING' | 'IN_PROGRESS' | 'SUCCESS' | 'FAILED';
  upgradeError: string | null;
  hostname: string | null;
  ipAddress: string | null;
  nodeVersion: string | null;
  diskUsagePercent: number | null;
  memoryUsageMb: number | null;
  lastHeartbeatAt: string;
  createdAt: string;
  updatedAt: string;
  site: { id: string; name: string; district: string };
}

export interface CreateDeviceResponse {
  device: EdgeDevice;
  activationKey: string;
  siteId: string;
  siteName: string;
  setupInstructions: string[];
}

export interface DeviceSetupInfo {
  activationKey: string | null;
  siteId: string;
  siteName: string;
  deviceName: string | null;
  ipAddress: string | null;
}

export interface FleetSummary {
  total: number;
  online: number;
  stale: number;
  versionCounts: Record<string, number>;
  statusCounts: Record<string, number>;
}

export function useFleetDevices() {
  return useQuery<EdgeDevice[]>({
    queryKey: ['fleet', 'devices'],
    queryFn: () => apiClient.get('/api/v1/fleet/devices'),
    refetchInterval: 30000,
  });
}

export function useFleetSummary() {
  return useQuery<FleetSummary>({
    queryKey: ['fleet', 'summary'],
    queryFn: () => apiClient.get('/api/v1/fleet/summary'),
    refetchInterval: 30000,
  });
}

export function useUpgradeDevice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, targetVersion }: { id: string; targetVersion: string }) =>
      apiClient.post(`/api/v1/fleet/devices/${id}/upgrade`, { targetVersion }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fleet'] });
    },
  });
}

export function useUpgradeAll() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (targetVersion: string) =>
      apiClient.post('/api/v1/fleet/upgrade-all', { targetVersion }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fleet'] });
    },
  });
}

export interface FleetRelease {
  tag: string;
  name: string;
  published: string;
  prerelease: boolean;
  body: string;
  assets: number;
}

export function useFleetReleases() {
  return useQuery<{ releases: FleetRelease[]; error?: string }>({
    queryKey: ['fleet', 'releases'],
    queryFn: () => apiClient.get('/api/v1/fleet/releases'),
    staleTime: 60_000,
  });
}

export function useUpgradeSelected() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ deviceIds, targetVersion }: { deviceIds: string[]; targetVersion: string }) =>
      apiClient.post('/api/v1/fleet/upgrade-selected', { deviceIds, targetVersion }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fleet'] });
    },
  });
}

export function useCreateEdgeDevice() {
  const qc = useQueryClient();
  return useMutation<CreateDeviceResponse, Error, { siteId: string; name?: string; operatingMode?: string }>({
    mutationFn: (data) => apiClient.post('/api/v1/fleet/devices', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fleet'] });
    },
  });
}

export function useUpdateEdgeDevice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string; name?: string; operatingMode?: string; regenerateKey?: boolean }) =>
      apiClient.put(`/api/v1/fleet/devices/${id}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fleet'] });
    },
  });
}

export function useDeleteEdgeDevice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/api/v1/fleet/devices/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fleet'] });
    },
  });
}

export function useDeviceSetup(deviceId: string | null) {
  return useQuery<DeviceSetupInfo>({
    queryKey: ['fleet', 'setup', deviceId],
    queryFn: () => apiClient.get(`/api/v1/fleet/devices/${deviceId}/setup`),
    enabled: !!deviceId,
  });
}
