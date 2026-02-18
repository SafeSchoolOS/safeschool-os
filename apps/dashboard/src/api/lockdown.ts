import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from './client';

interface ActiveLockdownsResponse {
  lockdowns: any[];
  operatingMode: string;
}

export function useActiveLockdowns() {
  return useQuery<ActiveLockdownsResponse>({
    queryKey: ['lockdowns', 'active'],
    queryFn: () => apiClient.get('/api/v1/lockdown/active'),
    refetchInterval: 5000,
  });
}

export function useInitiateLockdown() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { scope: string; targetId: string; alertId?: string; trainingMode?: boolean }) =>
      apiClient.post('/api/v1/lockdown', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lockdowns'] });
      qc.invalidateQueries({ queryKey: ['doors'] });
    },
  });
}

export function useReleaseLockdown() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/api/v1/lockdown/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lockdowns'] });
      qc.invalidateQueries({ queryKey: ['doors'] });
    },
  });
}
