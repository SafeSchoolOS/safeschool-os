import { useQuery } from '@tanstack/react-query';
import { apiClient } from './client';

export function useSystemHealth() {
  return useQuery({ queryKey: ['system-health'], queryFn: () => apiClient.get('/api/v1/system-health'), refetchInterval: 30000 });
}

export function useActionConfirmations(params?: { status?: string }) {
  const search = new URLSearchParams();
  if (params?.status) search.set('status', params.status);
  const qs = search.toString();
  return useQuery({ queryKey: ['confirmations', params], queryFn: () => apiClient.get(`/api/v1/system-health/confirmations${qs ? `?${qs}` : ''}`) });
}

export function useHeartbeats() {
  return useQuery({ queryKey: ['heartbeats'], queryFn: () => apiClient.get('/api/v1/system-health/heartbeats'), refetchInterval: 60000 });
}
