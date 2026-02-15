import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from './client';

export function useBuses(siteId?: string) {
  return useQuery({
    queryKey: ['buses', siteId],
    queryFn: () => apiClient.get(`/api/v1/transportation/buses`),
    refetchInterval: 30_000,
  });
}

export function useBusRoutes() {
  return useQuery({
    queryKey: ['bus-routes'],
    queryFn: () => apiClient.get('/api/v1/transportation/routes'),
  });
}

export function useBusRoute(id: string) {
  return useQuery({
    queryKey: ['bus-routes', id],
    queryFn: () => apiClient.get(`/api/v1/transportation/routes/${id}`),
    enabled: !!id,
  });
}

export function useStudentStatus(cardId: string) {
  return useQuery({
    queryKey: ['student-status', cardId],
    queryFn: () => apiClient.get(`/api/v1/transportation/student/${cardId}/status`),
    enabled: !!cardId,
  });
}

export function useCreateBus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { busNumber: string; capacity?: number; hasRfidReader?: boolean }) =>
      apiClient.post('/api/v1/transportation/buses', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['buses'] }),
  });
}

export function useSubmitGps() {
  return useMutation({
    mutationFn: (data: { busId: string; latitude: number; longitude: number; speed?: number }) =>
      apiClient.post('/api/v1/transportation/gps', data),
  });
}

export function useSubmitRfidScan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { cardId: string; busId: string; scanType: 'BOARD' | 'EXIT' }) =>
      apiClient.post('/api/v1/transportation/scan', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['buses'] }),
  });
}
