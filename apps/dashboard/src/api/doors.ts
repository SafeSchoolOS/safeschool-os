import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from './client';

export function useDoors(siteId?: string) {
  return useQuery({
    queryKey: ['doors', siteId],
    queryFn: () => apiClient.get(`/api/v1/doors${siteId ? `?siteId=${siteId}` : ''}`),
    refetchInterval: 5000,
  });
}

export function useLockDoor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (doorId: string) => apiClient.post(`/api/v1/doors/${doorId}/lock`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['doors'] }),
  });
}

export function useUnlockDoor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (doorId: string) => apiClient.post(`/api/v1/doors/${doorId}/unlock`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['doors'] }),
  });
}

export function useCreateDoor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ siteId, data }: {
      siteId: string;
      data: {
        buildingId: string; name: string;
        floor?: number; isExterior?: boolean; isEmergencyExit?: boolean;
        mapX?: number; mapY?: number;
      };
    }) => apiClient.post(`/api/v1/sites/${siteId}/doors`, data),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['doors'] });
      qc.invalidateQueries({ queryKey: ['site-detail', vars.siteId] });
    },
  });
}

export function useUpdateDoor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ siteId, doorId, data }: {
      siteId: string; doorId: string;
      data: { name?: string; floor?: number; isExterior?: boolean; isEmergencyExit?: boolean; mapX?: number; mapY?: number };
    }) => apiClient.put(`/api/v1/sites/${siteId}/doors/${doorId}`, data),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['doors'] });
      qc.invalidateQueries({ queryKey: ['site-detail', vars.siteId] });
    },
  });
}

export function useDeleteDoor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ siteId, doorId }: { siteId: string; doorId: string }) =>
      apiClient.delete(`/api/v1/sites/${siteId}/doors/${doorId}`),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['doors'] });
      qc.invalidateQueries({ queryKey: ['site-detail', vars.siteId] });
    },
  });
}
