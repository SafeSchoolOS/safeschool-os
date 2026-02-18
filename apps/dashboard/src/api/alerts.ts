import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from './client';

export function useAlerts(siteId?: string) {
  return useQuery({
    queryKey: ['alerts', siteId],
    queryFn: () => apiClient.get(`/api/v1/alerts${siteId ? `?siteId=${siteId}` : ''}`),
    refetchInterval: 10_000,
  });
}

export function useAlert(id: string) {
  return useQuery({
    queryKey: ['alerts', id],
    queryFn: () => apiClient.get(`/api/v1/alerts/${id}`),
    enabled: !!id,
  });
}

export function useCreateAlert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { level: string; buildingId: string; source?: string; floor?: number; roomId?: string; message?: string; trainingMode?: boolean }) =>
      apiClient.post('/api/v1/alerts', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['alerts'] }),
  });
}

export function useUpdateAlertStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      apiClient.patch(`/api/v1/alerts/${id}`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['alerts'] }),
  });
}

export function useConfirmFire() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (alertId: string) => apiClient.post(`/api/v1/alerts/${alertId}/confirm-fire`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['alerts'] }),
  });
}

export function useDismissFire() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (alertId: string) => apiClient.post(`/api/v1/alerts/${alertId}/dismiss-fire`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['alerts'] }),
  });
}
