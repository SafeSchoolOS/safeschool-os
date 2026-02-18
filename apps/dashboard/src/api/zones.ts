import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from './client';

export interface AccessZone {
  id: string;
  siteId: string;
  name: string;
  description: string | null;
  type: string;
  isRestrictedArea: boolean;
  requiresApproval: boolean;
  accessSchedule: AccessWindow[] | null;
  doorAssignments: { door: { id: string; name: string; status?: string; buildingId?: string } }[];
  _count: { doorAssignments: number; credentials: number };
}

export interface AccessWindow {
  days: number[];
  startTime: string;
  endTime: string;
}

export interface AccessCheckResult {
  allowed: boolean;
  reason: string;
  schedule?: AccessWindow[];
}

export function useZones(type?: string) {
  return useQuery({
    queryKey: ['zones', type],
    queryFn: () => {
      const params = type ? `?type=${type}` : '';
      return apiClient.get(`/api/v1/zones${params}`) as Promise<AccessZone[]>;
    },
    refetchInterval: 30000,
  });
}

export function useZone(id: string | null) {
  return useQuery({
    queryKey: ['zones', id],
    queryFn: () => apiClient.get(`/api/v1/zones/${id}`) as Promise<AccessZone>,
    enabled: !!id,
  });
}

export function useCreateZone() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      name: string;
      description?: string;
      type?: string;
      isRestrictedArea?: boolean;
      requiresApproval?: boolean;
      accessSchedule?: AccessWindow[];
      doorIds?: string[];
    }) => apiClient.post('/api/v1/zones', data) as Promise<AccessZone>,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['zones'] });
    },
  });
}

export function useUpdateZone() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: {
      id: string;
      name?: string;
      description?: string;
      type?: string;
      isRestrictedArea?: boolean;
      requiresApproval?: boolean;
      accessSchedule?: AccessWindow[] | null;
    }) => apiClient.put(`/api/v1/zones/${id}`, data) as Promise<AccessZone>,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['zones'] });
    },
  });
}

export function useDeleteZone() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/api/v1/zones/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['zones'] });
    },
  });
}

export function useUpdateZoneDoors() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ zoneId, doorIds }: { zoneId: string; doorIds: string[] }) =>
      apiClient.put(`/api/v1/zones/${zoneId}/doors`, { doorIds }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['zones'] });
    },
  });
}

export function useZoneLockdown() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ zoneId, trainingMode }: { zoneId: string; trainingMode?: boolean }) =>
      apiClient.post(`/api/v1/zones/${zoneId}/lockdown`, { trainingMode }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['zones'] });
    },
  });
}

export function useAccessCheck(zoneId: string | null) {
  return useQuery({
    queryKey: ['zones', zoneId, 'access-check'],
    queryFn: () => apiClient.get(`/api/v1/zones/${zoneId}/access-check`) as Promise<AccessCheckResult>,
    enabled: !!zoneId,
    refetchInterval: 60000,
  });
}
