import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from './client';

export function useActiveRollCall() {
  return useQuery({ queryKey: ['roll-call-active'], queryFn: () => apiClient.get('/api/v1/roll-call/active'), refetchInterval: 5000 });
}

export function useRollCall(id: string) {
  return useQuery({ queryKey: ['roll-call', id], queryFn: () => apiClient.get(`/api/v1/roll-call/${id}`), enabled: !!id, refetchInterval: 5000 });
}

export function useInitiateRollCall() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { incidentId: string }) => apiClient.post('/api/v1/roll-call', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['roll-call-active'] }),
  });
}

export function useSubmitRollCallReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ rollCallId, ...data }: any) => apiClient.post(`/api/v1/roll-call/${rollCallId}/report`, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['roll-call-active'] }); qc.invalidateQueries({ queryKey: ['roll-call'] }); },
  });
}

export function useCompleteRollCall() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.post(`/api/v1/roll-call/${id}/complete`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['roll-call-active'] }),
  });
}
