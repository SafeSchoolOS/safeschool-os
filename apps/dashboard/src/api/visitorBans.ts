import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from './client';

export function useVisitorBans(params?: { q?: string }) {
  const search = new URLSearchParams();
  if (params?.q) search.set('q', params.q);
  const qs = search.toString();
  return useQuery({ queryKey: ['visitor-bans', params], queryFn: () => apiClient.get(`/api/v1/visitor-bans${qs ? `?${qs}` : ''}`) });
}

export function useCreateVisitorBan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => apiClient.post('/api/v1/visitor-bans', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['visitor-bans'] }),
  });
}

export function useUpdateVisitorBan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: any) => apiClient.put(`/api/v1/visitor-bans/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['visitor-bans'] }),
  });
}

export function useDeleteVisitorBan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/api/v1/visitor-bans/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['visitor-bans'] }),
  });
}

export function useCheckVisitorBan() {
  return useMutation({
    mutationFn: (data: { firstName: string; lastName: string }) => apiClient.post('/api/v1/visitor-bans/check', data),
  });
}
