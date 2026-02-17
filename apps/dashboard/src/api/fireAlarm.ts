import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from './client';

// ---- Fire Alarm Zones ----

export function useFireAlarmZones(siteId?: string) {
  return useQuery({
    queryKey: ['fire-alarm-zones', siteId],
    queryFn: () => apiClient.get(`/api/v1/fire-alarm/zones${siteId ? `?siteId=${siteId}` : ''}`).then(r => r.data),
  });
}

export function useCreateFireAlarmZone() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      siteId: string;
      buildingId?: string;
      name: string;
      zoneNumber: string;
      floor?: number;
      description?: string;
      hasPullStations?: boolean;
      hasSmokeDetectors?: boolean;
      hasHeatDetectors?: boolean;
      hasSprinklers?: boolean;
    }) => apiClient.post('/api/v1/fire-alarm/zones', data).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['fire-alarm-zones'] }),
  });
}

// ---- Fire Alarm Events (PAS History) ----

export function useFireAlarmEvents(siteId?: string, status?: string) {
  return useQuery({
    queryKey: ['fire-alarm-events', siteId, status],
    queryFn: () => {
      const params = new URLSearchParams();
      if (siteId) params.set('siteId', siteId);
      if (status) params.set('status', status);
      return apiClient.get(`/api/v1/fire-alarm/events?${params}`).then(r => r.data);
    },
  });
}

export function useActiveFireAlarmEvent(siteId?: string) {
  return useQuery({
    queryKey: ['fire-alarm-events', 'active', siteId],
    queryFn: () => apiClient.get(`/api/v1/fire-alarm/events/active${siteId ? `?siteId=${siteId}` : ''}`).then(r => r.data),
    refetchInterval: 5000, // Poll every 5s during active events
  });
}

// ---- PAS Decision Mutations ----

export function useAcknowledgeFire() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (alertId: string) =>
      apiClient.post(`/api/v1/fire-alarm/${alertId}/acknowledge`, {}).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['alerts'] });
      qc.invalidateQueries({ queryKey: ['fire-alarm-events'] });
    },
  });
}

export function useConfirmFire() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      alertId: string;
      directedEvacuation?: boolean;
      evacuateZones?: string[];
      avoidZones?: string[];
    }) => apiClient.post(`/api/v1/fire-alarm/${data.alertId}/confirm`, data).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['alerts'] });
      qc.invalidateQueries({ queryKey: ['fire-alarm-events'] });
    },
  });
}

export function useDismissFire() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (alertId: string) =>
      apiClient.post(`/api/v1/fire-alarm/${alertId}/dismiss`, {}).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['alerts'] });
      qc.invalidateQueries({ queryKey: ['fire-alarm-events'] });
    },
  });
}

export function useExtendFireInvestigation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { alertId: string; reason: string }) =>
      apiClient.post(`/api/v1/fire-alarm/${data.alertId}/extend`, { reason: data.reason }).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['alerts'] });
      qc.invalidateQueries({ queryKey: ['fire-alarm-events'] });
    },
  });
}

// ---- Evacuation Routes ----

export function useEvacuationRoutes(siteId?: string) {
  return useQuery({
    queryKey: ['evacuation-routes', siteId],
    queryFn: () => apiClient.get(`/api/v1/fire-alarm/evacuation-routes${siteId ? `?siteId=${siteId}` : ''}`).then(r => r.data),
  });
}

export function useCreateEvacuationRoute() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      siteId: string;
      buildingId?: string;
      name: string;
      description?: string;
      fromZones: string[];
      toExit?: string;
      doorIds: string[];
      avoidZones?: string[];
      isDefault?: boolean;
    }) => apiClient.post('/api/v1/fire-alarm/evacuation-routes', data).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['evacuation-routes'] }),
  });
}
