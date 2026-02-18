import { useQuery } from '@tanstack/react-query';
import { apiClient } from './client';

export interface WeatherAlert {
  id: string;
  event: string;
  severity: 'Extreme' | 'Severe' | 'Moderate' | 'Minor' | 'Unknown';
  urgency: string;
  headline: string;
  description: string;
  onset: string;
  expires: string;
}

export function useWeatherAlerts(siteId: string | undefined) {
  return useQuery<WeatherAlert[]>({
    queryKey: ['weather', siteId],
    queryFn: () => apiClient.get(`/api/v1/weather/${siteId}/alerts`),
    enabled: !!siteId,
    refetchInterval: 5 * 60 * 1000, // 5 minutes
    staleTime: 4 * 60 * 1000,       // consider data stale after 4 min
  });
}
