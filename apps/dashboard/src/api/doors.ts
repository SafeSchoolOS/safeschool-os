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
