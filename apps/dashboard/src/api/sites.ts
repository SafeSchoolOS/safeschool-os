import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from './client';

const API_BASE = import.meta.env.VITE_API_URL || '';

export function useSites() {
  return useQuery({
    queryKey: ['sites'],
    queryFn: () => apiClient.get('/api/v1/sites'),
    staleTime: Infinity,
  });
}

export function useSite(id: string) {
  return useQuery({
    queryKey: ['sites', id],
    queryFn: () => apiClient.get(`/api/v1/sites/${id}`),
    enabled: !!id,
  });
}

export function getSiteLogoUrl(siteId: string) {
  return `${API_BASE}/api/v1/sites/${siteId}/logo`;
}

export function useUploadSiteLogo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ siteId, file }: { siteId: string; file: File }) => {
      const formData = new FormData();
      formData.append('file', file);
      const token = localStorage.getItem('safeschool_token');
      const res = await fetch(`${API_BASE}/api/v1/sites/${siteId}/logo`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Upload failed');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sites'] });
      queryClient.invalidateQueries({ queryKey: ['site-logo'] });
    },
  });
}

export function useDeleteSiteLogo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (siteId: string) => {
      return apiClient.delete(`/api/v1/sites/${siteId}/logo`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sites'] });
      queryClient.invalidateQueries({ queryKey: ['site-logo'] });
    },
  });
}
