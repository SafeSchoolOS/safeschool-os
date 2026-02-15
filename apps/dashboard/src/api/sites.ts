import { useQuery } from '@tanstack/react-query';
import { apiClient } from './client';

export function useSites() {
  return useQuery({
    queryKey: ['sites'],
    queryFn: () => apiClient.get('/api/v1/sites'),
    staleTime: Infinity,
  });
}

export function useSite(id: string) {
  return useQuery({
    queryKey: ['sites', id],
    queryFn: () => apiClient.get(`/api/v1/sites/${id}`),
    enabled: !!id,
  });
}
