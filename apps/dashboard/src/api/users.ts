import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from './client';

export interface User {
  id: string;
  email: string;
  name: string;
  role: string;
  phone: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt?: string;
  sites: { id: string; name: string }[];
}

export interface CreateUserPayload {
  email: string;
  name: string;
  role: string;
  phone?: string;
  password: string;
  siteIds?: string[];
}

export interface UpdateUserPayload {
  name?: string;
  email?: string;
  role?: string;
  phone?: string;
  isActive?: boolean;
  siteIds?: string[];
}

export function useUsers() {
  return useQuery<User[]>({
    queryKey: ['users'],
    queryFn: () => apiClient.get('/api/v1/users'),
  });
}

export function useCreateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateUserPayload) => apiClient.post('/api/v1/users', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });
}

export function useUpdateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: UpdateUserPayload & { id: string }) =>
      apiClient.put(`/api/v1/users/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });
}

export function useResetPassword() {
  return useMutation({
    mutationFn: ({ id, password }: { id: string; password: string }) =>
      apiClient.post(`/api/v1/users/${id}/reset-password`, { password }),
  });
}

export function useDeactivateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/api/v1/users/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });
}

const API_BASE = import.meta.env.VITE_API_URL || '';

export function useImportUsers() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ file, dryRun }: { file: File; dryRun?: boolean }) => {
      const formData = new FormData();
      formData.append('file', file);
      const qs = dryRun ? '?dryRun=true' : '';
      const token = localStorage.getItem('safeschool_token');
      const res = await fetch(`${API_BASE}/api/v1/users/import${qs}`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Import failed: ${res.status}`);
      }
      return res.json();
    },
    onSuccess: (_data, variables) => {
      if (!variables.dryRun) {
        qc.invalidateQueries({ queryKey: ['users'] });
      }
    },
  });
}
