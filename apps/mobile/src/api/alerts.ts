import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './client';

export function useAlerts(siteId?: string) {
  return useQuery({
    queryKey: ['alerts', siteId],
    queryFn: () => api.get(`/alerts${siteId ? `?siteId=${siteId}` : ''}`),
    refetchInterval: 5000,
  });
}

export function useCreateAlert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { level: string; buildingId: string; source?: string; message?: string }) =>
      api.post('/alerts', { ...data, source: data.source || 'MOBILE_APP' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['alerts'] }),
  });
}

export function useUpdateAlertStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api.patch(`/alerts/${id}`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['alerts'] }),
  });
}
