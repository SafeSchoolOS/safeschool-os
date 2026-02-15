import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from './client';

export interface EdgeDevice {
  id: string;
  siteId: string;
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
