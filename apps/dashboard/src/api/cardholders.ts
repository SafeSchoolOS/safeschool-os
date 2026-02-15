import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from './client';

export function useCardholders(params?: { siteId?: string; personType?: string; isActive?: string; search?: string }) {
  const searchParams = new URLSearchParams();
  if (params?.siteId) searchParams.set('siteId', params.siteId);
  if (params?.personType) searchParams.set('personType', params.personType);
  if (params?.isActive) searchParams.set('isActive', params.isActive);
  if (params?.search) searchParams.set('search', params.search);
  const qs = searchParams.toString();

  return useQuery({
    queryKey: ['cardholders', params],
    queryFn: () => apiClient.get(`/api/v1/cardholders${qs ? `?${qs}` : ''}`),
    refetchInterval: 30000,
  });
}

export function useCardholder(id: string) {
  return useQuery({
    queryKey: ['cardholders', id],
    queryFn: () => apiClient.get(`/api/v1/cardholders/${id}`),
    enabled: !!id,
  });
}

export function useCreateCardholder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      siteId?: string;
      personType: string;
      firstName: string;
      lastName: string;
      email?: string;
      phone?: string;
      company?: string;
      title?: string;
      userId?: string;
      visitorId?: string;
      notes?: string;
    }) => apiClient.post('/api/v1/cardholders', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cardholders'] }),
  });
}

export function useUpdateCardholder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string; firstName?: string; lastName?: string; email?: string; phone?: string; company?: string; title?: string; isActive?: boolean; notes?: string }) =>
      apiClient.put(`/api/v1/cardholders/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cardholders'] }),
  });
}

export function useProvisionCredential() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ cardholderId, ...data }: {
      cardholderId: string;
      credentialType: string;
      cardNumber?: string;
      facilityCode?: string;
      zoneIds?: string[];
      expiresAt?: string;
    }) => apiClient.post(`/api/v1/cardholders/${cardholderId}/credentials`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cardholders'] }),
  });
}

export function useRevokeCredential() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ cardholderId, credentialId }: { cardholderId: string; credentialId: string }) =>
      apiClient.delete(`/api/v1/cardholders/${cardholderId}/credentials/${credentialId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cardholders'] }),
  });
}

export function useAccessZones(siteId?: string) {
  return useQuery({
    queryKey: ['accessZones', siteId],
    queryFn: () => apiClient.get(`/api/v1/cardholders/zones${siteId ? `?siteId=${siteId}` : ''}`),
  });
}

export function useCreateZone() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { siteId?: string; name: string; description?: string; doorIds?: string[] }) =>
      apiClient.post('/api/v1/cardholders/zones', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['accessZones'] }),
  });
}
