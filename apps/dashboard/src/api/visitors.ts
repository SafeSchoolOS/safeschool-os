import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from './client';

export function useVisitors(siteId?: string, status?: string) {
  return useQuery({
    queryKey: ['visitors', siteId, status],
    queryFn: () => apiClient.get(`/api/v1/visitors?${siteId ? `siteId=${siteId}&` : ''}${status ? `status=${status}` : ''}`),
    refetchInterval: 15000,
  });
}

export function useActiveVisitors() {
  return useQuery({
    queryKey: ['visitors', 'active'],
    queryFn: () => apiClient.get('/api/v1/visitors/active'),
    refetchInterval: 10000,
  });
}

export function useVisitor(id: string) {
  return useQuery({
    queryKey: ['visitors', id],
    queryFn: () => apiClient.get(`/api/v1/visitors/${id}`),
    enabled: !!id,
  });
}

export function usePreRegisterVisitor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      firstName: string;
      lastName: string;
      purpose: string;
      destination: string;
      hostUserId?: string;
    }) => apiClient.post('/api/v1/visitors', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['visitors'] }),
  });
}

export function useCheckInVisitor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.post(`/api/v1/visitors/${id}/check-in`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['visitors'] }),
  });
}

export function useCheckOutVisitor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.post(`/api/v1/visitors/${id}/check-out`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['visitors'] }),
  });
}
