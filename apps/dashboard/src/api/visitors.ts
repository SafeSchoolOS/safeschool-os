import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from './client';

export function useVisitors(siteId?: string, status?: string) {
  return useQuery({
    queryKey: ['visitors', siteId, status],
    queryFn: () => apiClient.get(`/api/v1/visitors?${siteId ? `siteId=${siteId}&` : ''}${status ? `status=${status}` : ''}`),
    refetchInterval: 30_000,
  });
}

export function useActiveVisitors() {
  return useQuery({
    queryKey: ['visitors', 'active'],
    queryFn: () => apiClient.get('/api/v1/visitors/active'),
    refetchInterval: 30_000,
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

// Visitor Settings hooks

export function useVisitorSettings() {
  return useQuery({
    queryKey: ['visitor-settings'],
    queryFn: () => apiClient.get('/api/v1/visitor-settings'),
  });
}

export function useUpdateVisitorSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => apiClient.put('/api/v1/visitor-settings', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['visitor-settings'] }),
  });
}

export function useVisitorPolicies() {
  return useQuery({
    queryKey: ['visitor-policies'],
    queryFn: () => apiClient.get('/api/v1/visitor-settings/policies'),
  });
}

export function useCreateVisitorPolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { title: string; body: string }) => apiClient.post('/api/v1/visitor-settings/policies', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['visitor-policies'] }),
  });
}

export function useUpdateVisitorPolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string; title?: string; body?: string; isActive?: boolean }) =>
      apiClient.put(`/api/v1/visitor-settings/policies/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['visitor-policies'] }),
  });
}

export function useDeleteVisitorPolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/api/v1/visitor-settings/policies/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['visitor-policies'] }),
  });
}

export function useCreateVisitorGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => apiClient.post('/api/v1/visitors/group', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['visitors'] }),
  });
}

// Analytics hooks

export function useVisitorAnalyticsSummary() {
  return useQuery({
    queryKey: ['visitor-analytics', 'summary'],
    queryFn: () => apiClient.get('/api/v1/visitor-analytics/summary'),
  });
}

export function useVisitorAnalyticsPeakTimes(days?: number) {
  return useQuery({
    queryKey: ['visitor-analytics', 'peak-times', days],
    queryFn: () => apiClient.get(`/api/v1/visitor-analytics/peak-times?days=${days || 30}`),
  });
}

export function useVisitorAnalyticsFrequent(limit?: number) {
  return useQuery({
    queryKey: ['visitor-analytics', 'frequent', limit],
    queryFn: () => apiClient.get(`/api/v1/visitor-analytics/frequent?limit=${limit || 20}`),
  });
}
