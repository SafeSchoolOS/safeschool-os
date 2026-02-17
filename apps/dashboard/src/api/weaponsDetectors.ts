import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from './client';

export interface WeaponsDetector {
  detectorId: string;
  detectorName: string;
  vendor: string;
  entrance: string;
  lastSeen: string;
  eventCount: number;
}

export interface DetectionEvent {
  alertId: string;
  level: string;
  status: string;
  message: string;
  timestamp: string;
  buildingName: string;
  vendor: string;
  threatLevel: string;
  confidence: number | null;
  detectorName: string | null;
  operatorAction: string | null;
  imageUrl: string | null;
}

export function useWeaponsDetectors() {
  return useQuery({
    queryKey: ['weapons-detectors'],
    queryFn: () => apiClient.get('/api/v1/weapons-detectors') as Promise<WeaponsDetector[]>,
    refetchInterval: 30000,
  });
}

export function useDetectionEvents() {
  return useQuery({
    queryKey: ['weapons-detectors', 'events'],
    queryFn: () => apiClient.get('/api/v1/weapons-detectors/events') as Promise<DetectionEvent[]>,
    refetchInterval: 15000,
  });
}

export function useTestDetection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiClient.post('/api/v1/weapons-detectors/test', {}) as Promise<{ alertId: string; message: string }>,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['weapons-detectors'] });
    },
  });
}
