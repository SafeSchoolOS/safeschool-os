import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from './client';

export function useIntegrationHealth() {
  return useQuery({ queryKey: ['integration-health'], queryFn: () => apiClient.get('/api/v1/integration-health'), refetchInterval: 60000 });
}

export function useIntegrationDetail(name: string) {
  return useQuery({ queryKey: ['integration-health', name], queryFn: () => apiClient.get(`/api/v1/integration-health/${name}`), enabled: !!name });
}

export function useForceHealthCheck() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => apiClient.post(`/api/v1/integration-health/${name}/check`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['integration-health'] }),
  });
}
