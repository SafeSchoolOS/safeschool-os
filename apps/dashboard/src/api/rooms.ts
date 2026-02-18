import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from './client';

export function useCreateRoom() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ siteId, data }: {
      siteId: string;
      data: {
        buildingId: string; name: string; number: string;
        floor?: number; type?: string; mapX?: number; mapY?: number; mapW?: number; mapH?: number;
      };
    }) => apiClient.post(`/api/v1/sites/${siteId}/rooms`, data),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['site-detail', vars.siteId] });
    },
  });
}

export function useUpdateRoom() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ siteId, roomId, data }: {
      siteId: string; roomId: string;
      data: { name?: string; number?: string; floor?: number; type?: string; mapX?: number; mapY?: number; mapW?: number; mapH?: number };
    }) => apiClient.put(`/api/v1/sites/${siteId}/rooms/${roomId}`, data),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['site-detail', vars.siteId] });
    },
  });
}

export function useDeleteRoom() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ siteId, roomId }: { siteId: string; roomId: string }) =>
      apiClient.delete(`/api/v1/sites/${siteId}/rooms/${roomId}`),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['site-detail', vars.siteId] });
    },
  });
}
