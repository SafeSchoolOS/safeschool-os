import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from './client';

export function useNotificationLog(siteId?: string) {
  return useQuery({
    queryKey: ['notification-log', siteId],
    queryFn: () => apiClient.get(`/api/v1/notifications/log${siteId ? `?siteId=${siteId}` : ''}`),
  });
}

export function useSendNotification() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      channels: string[];
      message: string;
      recipientScope: 'all-staff' | 'all-parents' | 'specific-users';
    }) => apiClient.post('/api/v1/notifications/send', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notification-log'] }),
  });
}

export function useSendTestNotification() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiClient.post('/api/v1/notifications/test', {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notification-log'] }),
  });
}
