import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from './client';

export interface PanicDevice {
  id: string;
  name: string;
  email: string;
  role: string;
  wearableDeviceId: string;
  sites: { id: string; name: string }[];
}

export interface UnassignedStaff {
  id: string;
  name: string;
  email: string;
  role: string;
}

export function usePanicDevices() {
  return useQuery({
    queryKey: ['panic-devices'],
    queryFn: () => apiClient.get('/api/v1/panic-devices') as Promise<PanicDevice[]>,
    refetchInterval: 30000,
  });
}

export function useUnassignedStaff() {
  return useQuery({
    queryKey: ['panic-devices', 'unassigned-staff'],
    queryFn: () => apiClient.get('/api/v1/panic-devices/unassigned-staff') as Promise<UnassignedStaff[]>,
  });
}

export function useAssignDevice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ badgeId, userId }: { badgeId: string; userId: string }) =>
      apiClient.put(`/api/v1/panic-devices/${encodeURIComponent(badgeId)}/assign`, { userId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['panic-devices'] });
    },
  });
}

export function useUnassignDevice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (badgeId: string) =>
      apiClient.delete(`/api/v1/panic-devices/${encodeURIComponent(badgeId)}/assign`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['panic-devices'] });
    },
  });
}
