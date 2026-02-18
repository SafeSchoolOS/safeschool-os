import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from './client';

export function useDoorHealthEvents(params?: { doorId?: string; severity?: string }) {
  const search = new URLSearchParams();
  if (params?.doorId) search.set('doorId', params.doorId);
  if (params?.severity) search.set('severity', params.severity);
  const qs = search.toString();
  return useQuery({ queryKey: ['door-health', params], queryFn: () => apiClient.get(`/api/v1/door-health${qs ? `?${qs}` : ''}`) });
}

export function useDoorHealthSummary() {
  return useQuery({ queryKey: ['door-health-summary'], queryFn: () => apiClient.get('/api/v1/door-health/summary') });
}

export function useWorkOrders(params?: { status?: string; priority?: string }) {
  const search = new URLSearchParams();
  if (params?.status) search.set('status', params.status);
  if (params?.priority) search.set('priority', params.priority);
  const qs = search.toString();
  return useQuery({ queryKey: ['work-orders', params], queryFn: () => apiClient.get(`/api/v1/door-health/work-orders${qs ? `?${qs}` : ''}`) });
}

export function useCreateWorkOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => apiClient.post('/api/v1/door-health/work-orders', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['work-orders'] }),
  });
}

export function useCompleteWorkOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.post(`/api/v1/door-health/work-orders/${id}/complete`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['work-orders'] }),
  });
}
